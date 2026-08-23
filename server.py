"""The Equity MF selection dashboard.

Serves the static front end and the screener API. Everything it answers comes
from data/*.json, which is built offline by etl/ and committed, so nothing here
makes an outbound call: a request is a read of state already in memory.
"""

import os
import traceback

from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS

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
        "service": "Equity MF selection framework",
        "scoredFunds": len(_state["funds"]),
        "builtAt": _state["meta"].get("builtAt"),
        # The dataset holds every scheme the feed carries; the scored universe is
        # what survives the framework's scope rules, so report that.
        "universeInFile": _state["meta"].get("inScopeFunds"),
    })


@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory(STATIC_DIR, filename)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3001))
    app.run(host='0.0.0.0', port=port)
