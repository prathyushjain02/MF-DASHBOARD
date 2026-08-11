from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from datetime import datetime, timedelta
import os
import traceback

try:
    import yfinance as yf
except ImportError:  # the MF dashboard has no yfinance dependency
    yf = None

from mf.api import bp as mf_bp
from mf import datastore

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

app = Flask(__name__, static_folder=None)
CORS(app)
app.register_blueprint(mf_bp)

# Evaluate the universe at boot rather than on the first request. Under gunicorn
# --preload this happens once before the workers fork, so they share the result
# copy-on-write instead of each building its own. It also means the health check
# only passes once the data is genuinely ready.
_BOOT_ERROR = None
try:
    _state = datastore.load()
    print(f"[mf] loaded {len(_state['funds'])} funds "
          f"(built {_state['meta'].get('builtAt', 'unknown')})")
except Exception as exc:  # noqa: BLE001 - never let a data fault stop the process
    _BOOT_ERROR = str(exc)
    traceback.print_exc()
    print("[mf] dataset failed to load; /health will report it")

def get_yf_symbol(symbol):
    """Try multiple suffix formats to find the right Yahoo Finance ticker"""
    s = symbol.strip().upper()
    # If already has suffix, use as-is
    if s.endswith('.NS') or s.endswith('.BO'):
        return [s]
    # Try NSE first, then BSE
    return [s + '.NS', s + '.BO']

@app.route('/')
def home():
    """Serve the Equity MF selection dashboard."""
    return send_from_directory(STATIC_DIR, 'index.html')


@app.route('/health')
def health():
    """Health check. Reports degraded rather than ok if the dataset is missing,
    so a bad deploy is visible at the platform level instead of only in the UI."""
    if _BOOT_ERROR:
        return jsonify({"status": "degraded", "error": _BOOT_ERROR,
                        "hint": "data/*.json missing or unreadable — rebuild with "
                                "etl/build_dataset.py and commit the result"}), 503
    return jsonify({
        "status": "ok",
        "service": "NSE Portfolio Backend + Equity MF selection framework",
        "scoredFunds": len(_state["funds"]),
        "builtAt": _state["meta"].get("builtAt"),
        # The dataset holds every scheme the feed carries; the scored universe is
        # what survives the framework's scope rules, so report that.
        "universeInFile": _state["meta"].get("inScopeFunds"),
        "yfinance": yf is not None,
    })


@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory(STATIC_DIR, filename)


@app.route('/api/marketStatus')
def market_status():
    return jsonify({"status": "ok", "message": "Backend is live"})

@app.route('/api/equity/<symbol>/historical')
def historical(symbol):
    try:
        start = request.args.get('start', (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%d'))
        end = request.args.get('end', (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d'))

        candidates = get_yf_symbol(symbol)
        df = None

        for yf_sym in candidates:
            try:
                print(f"Trying {yf_sym} from {start} to {end}")
                df = yf.download(yf_sym, start=start, end=end, progress=False, auto_adjust=True)
                if df is not None and not df.empty:
                    print(f"Got {len(df)} rows for {yf_sym}")
                    break
                else:
                    df = None
            except Exception as ex:
                print(f"Failed {yf_sym}: {ex}")
                continue

        if df is None or df.empty:
            # Last resort: try with period
            for yf_sym in candidates:
                try:
                    print(f"Trying {yf_sym} with period=1y")
                    df = yf.download(yf_sym, period='1y', progress=False, auto_adjust=True)
                    if df is not None and not df.empty:
                        print(f"Period fallback got {len(df)} rows for {yf_sym}")
                        break
                    else:
                        df = None
                except Exception as ex:
                    print(f"Period fallback failed {yf_sym}: {ex}")
                    continue

        if df is None or df.empty:
            return jsonify({"error": f"No data found for {symbol}. Tried: {', '.join(candidates)}"}), 404

        # Handle MultiIndex columns (happens with single ticker in newer yfinance)
        if hasattr(df.columns, 'levels'):
            df.columns = df.columns.get_level_values(0)

        records = []
        for date_idx in range(len(df)):
            row = df.iloc[date_idx]
            date_str = df.index[date_idx].strftime('%Y-%m-%d')
            close_val = float(row['Close']) if 'Close' in df.columns else 0
            open_val = float(row['Open']) if 'Open' in df.columns else 0
            high_val = float(row['High']) if 'High' in df.columns else 0
            low_val = float(row['Low']) if 'Low' in df.columns else 0
            vol_val = int(row['Volume']) if 'Volume' in df.columns else 0

            if close_val > 0:
                records.append({
                    "date": date_str,
                    "open": round(open_val, 2),
                    "high": round(high_val, 2),
                    "low": round(low_val, 2),
                    "close": round(close_val, 2),
                    "volume": vol_val
                })

        print(f"Returning {len(records)} records for {symbol}")
        return jsonify({"records": records, "symbol": symbol})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/api/equity/<symbol>')
def equity_info(symbol):
    try:
        candidates = get_yf_symbol(symbol)
        info = {}

        for yf_sym in candidates:
            try:
                ticker = yf.Ticker(yf_sym)
                info = ticker.info or {}
                if info.get('longName') or info.get('industry'):
                    break
            except:
                continue

        return jsonify({
            "info": {
                "companyName": info.get('longName', info.get('shortName', symbol)),
                "industry": info.get('industry', 'Unknown'),
                "sector": info.get('sector', 'Unknown'),
                "marketCap": info.get('marketCap', 0),
                "symbol": symbol,
                "currentPrice": info.get('currentPrice', info.get('regularMarketPrice', 0)),
            }
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({"info": {"companyName": symbol, "industry": "Unknown", "sector": "Unknown"}}), 200

if __name__ == '__main__':
    import os
    port = int(os.environ.get('PORT', 3001))
    app.run(host='0.0.0.0', port=port)
