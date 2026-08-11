"""Build the NAV history file that the growth chart is drawn from.

The quant feed carries summary returns but no NAV series, so the growth chart
would have nothing to plot. This step fetches the daily NAV of every in-scope
scheme from the public AMFI mirror at api.mfapi.in, keyed on the AMFI scheme code
the feed already carries, and writes one compact file.

Three series end up on the chart, and each is built here:

    fund        the scheme's own daily NAV.
    index       an index tracking scheme, one per category. The feed publishes no
                NAV for an index itself, so the market line is a real scheme and
                carries that scheme's tracking error and expense. It is labelled
                as an index fund on the chart for exactly that reason.
    category    the average of every scored fund in the category. Built from
                daily returns rather than by rebasing NAVs, so a fund that
                launched part way through the window joins the average on the day
                it starts instead of dragging the whole line to its own base.

Resolution is deliberately mixed: every trading day inside the last two years,
one point a week before that. A five year chart is a few hundred pixels wide, so
daily points that far back are bytes nobody can see, and the recent end is where
the shape actually gets read.

Usage:
    python etl/build_navs.py            # incremental, uses the on-disk cache
    python etl/build_navs.py --refresh  # ignore the cache and refetch everything
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from mf import framework as fw  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", "navs")

API = "https://api.mfapi.in/mf/{code}"

# How far back to keep, and where daily resolution gives way to weekly.
MAX_YEARS = 8
DAILY_DAYS = 730


def _log(msg):
    print(f"[navs] {msg}", flush=True)


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------

def fetch_one(code, session, refresh=False):
    """Raw mfapi payload for one scheme code, cached on disk."""
    path = os.path.join(CACHE_DIR, f"{code}.json")
    if not refresh and os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except (ValueError, OSError):
            pass  # a truncated cache entry is refetched rather than trusted
    last = None
    for attempt in range(4):
        try:
            r = session.get(API.format(code=code), timeout=45)
            if r.status_code == 200:
                payload = r.json()
                os.makedirs(CACHE_DIR, exist_ok=True)
                with open(path, "w", encoding="utf-8") as fh:
                    json.dump(payload, fh, separators=(",", ":"))
                return payload
            last = f"HTTP {r.status_code}"
        except Exception as e:                      # network, JSON, timeout
            last = str(e)
        time.sleep(2 ** attempt)
    _log(f"  scheme {code} failed: {last}")
    return None


def parse_series(payload):
    """mfapi payload -> [(date, nav)] ascending, cleaned."""
    if not payload or not payload.get("data"):
        return []
    out = []
    for row in payload["data"]:
        try:
            d = dt.datetime.strptime(row["date"], "%d-%m-%Y").date()
            v = float(row["nav"])
        except (KeyError, ValueError, TypeError):
            continue
        if v > 0:
            out.append((d, v))
    out.sort(key=lambda t: t[0])
    return out


def thin(series, today):
    """Daily inside the recent window, weekly before it, capped at MAX_YEARS.

    Weekly points are taken as the last observation in each ISO week, so the
    thinned series still ends each week on a real traded NAV.
    """
    if not series:
        return []
    floor = today - dt.timedelta(days=int(365.25 * MAX_YEARS))
    daily_from = today - dt.timedelta(days=DAILY_DAYS)
    recent, older = [], {}
    for d, v in series:
        if d < floor:
            continue
        if d >= daily_from:
            recent.append((d, v))
        else:
            older[(d.isocalendar()[0], d.isocalendar()[1])] = (d, v)
    out = sorted(older.values()) + recent
    return out


# ---------------------------------------------------------------------------
# Category average
# ---------------------------------------------------------------------------

def category_average(series_list):
    """Average daily return across funds, compounded into an index.

    Averaging returns rather than rebased levels means a fund that launched part
    way through the window contributes only from its own start date, instead of
    forcing the whole category line to rebase around it.
    """
    rets = {}          # date -> [return, ...]
    for series in series_list:
        prev = None
        for d, v in series:
            if prev is not None and prev[1] > 0:
                gap = (d - prev[0]).days
                if 0 < gap <= 10:          # skip across long holes in a series
                    rets.setdefault(d, []).append(v / prev[1] - 1.0)
            prev = (d, v)
    if not rets:
        return []
    out, level = [], 100.0
    for d in sorted(rets):
        vals = rets[d]
        if len(vals) < 3:                  # too thin an average to publish
            continue
        level *= (1.0 + sum(vals) / len(vals))
        out.append((d, level))
    return out


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def encode(series):
    return {"d": [d.isoformat() for d, _ in series],
            "v": [round(v, 4) for _, v in series]}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refresh", action="store_true",
                    help="ignore the on-disk cache and refetch every scheme")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    with open(os.path.join(DATA_DIR, "funds.json"), "r", encoding="utf-8") as fh:
        funds = json.load(fh)

    in_scope = [f for f in funds
                if f.get("category") in fw.CATEGORIES
                and not fw.excluded_amc(f.get("amc"))
                and f.get("amfiCode")]
    _log(f"{len(in_scope)} in-scope schemes carry an AMFI code")

    index_codes = {}
    for cat in fw.CATEGORIES:
        p = fw.index_proxy(cat)
        index_codes[p["code"]] = p["label"]

    jobs = {f["amfiCode"]: f["key"] for f in in_scope}
    for code in index_codes:
        jobs.setdefault(code, None)

    raw = {}
    session = requests.Session()
    session.headers["User-Agent"] = "nse-backend/1.0 (dataset build)"
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(fetch_one, c, session, args.refresh): c for c in jobs}
        done = 0
        for fut in as_completed(futs):
            code = futs[fut]
            raw[code] = fut.result()
            done += 1
            if done % 50 == 0:
                _log(f"  fetched {done}/{len(jobs)}")
    _log(f"fetched {len(jobs)} schemes")

    today = dt.date.today()
    by_key, per_cat = {}, {}
    missing = []
    for f in in_scope:
        s = thin(parse_series(raw.get(f["amfiCode"])), today)
        if len(s) < 30:
            missing.append(f["key"])
            continue
        by_key[f["key"]] = encode(s)
        per_cat.setdefault(f["category"], []).append(s)

    indices = {}
    for code, label in index_codes.items():
        s = thin(parse_series(raw.get(code)), today)
        if len(s) < 30:
            _log(f"  index {code} ({label}) has no usable series")
            continue
        indices[str(code)] = {"label": label, "code": code, **encode(s)}

    cat_avg = {}
    for cat, series_list in per_cat.items():
        avg = category_average(series_list)
        if avg:
            cat_avg[cat] = encode(avg)

    payload = {
        "builtAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "source": "https://api.mfapi.in",
        "resolution": f"daily for {DAILY_DAYS} days, weekly before that, "
                      f"capped at {MAX_YEARS} years",
        "funds": by_key,
        "indices": indices,
        "indexByCategory": {c: str(fw.index_proxy(c)["code"]) for c in fw.CATEGORIES},
        "categoryAverage": cat_avg,
    }
    out = os.path.join(DATA_DIR, "navs.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))

    size = os.path.getsize(out) / 1e6
    _log(f"wrote {out} ({size:.1f} MB)")
    _log(f"  funds with a series : {len(by_key)}")
    _log(f"  indices             : {len(indices)}")
    _log(f"  category averages   : {len(cat_avg)}")
    if missing:
        _log(f"  no usable series    : {len(missing)} ({', '.join(missing[:6])}"
             f"{' ...' if len(missing) > 6 else ''})")


if __name__ == "__main__":
    main()
