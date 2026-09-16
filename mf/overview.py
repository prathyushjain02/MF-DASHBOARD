"""The Equity overview page, as data.

The landing page reads three kinds of figure and says which is which:

    live     the broad benchmarks from navs.json: index prices refreshed
             nightly, and the monthly total return series behind the
             calendar year quilt. Everything here is computed on request from
             the series already in memory.
    house    the AWM House View for the quarter, hand entered into
             data/overview.json when the edition changes.
    deck     the long Sensex history from the Listed Equities deck, used
             until the nightly build has carried enough month-end history to
             replace it (see build_navs.py, `history`).

Nothing on this page carries a score, rank or quartile.
"""

from __future__ import annotations

import datetime as dt
import json
import os
from statistics import median

from . import datastore as ds

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

# The four broad benchmarks, in the order the page reads them.
INDICES = ("Nifty 50", "Nifty 500", "Nifty Midcap 150", "Nifty Smallcap 250")
PERIODS = ("YTD", "1Y", "3Y", "5Y", "7Y")

# How many falls to report per index, and how shallow a dip is ignored.
FALLS = 3
FALL_FLOOR = 8.0


def _static():
    with open(os.path.join(DATA_DIR, "overview.json"), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _date(iso):
    return dt.date.fromisoformat(iso)


def _at_or_after(days, iso):
    """Index of the first observation on or after a date."""
    for i, d in enumerate(days):
        if d >= iso:
            return i
    return None


def _returns(days, vals):
    end = _date(days[-1])
    out = {}
    for p in PERIODS:
        if p == "YTD":
            start = dt.date(end.year, 1, 1)
        else:
            y = int(p[0])
            start = dt.date(end.year - y, end.month, end.day)
        i = _at_or_after(days, start.isoformat())
        if i is None or i == 0 and _date(days[0]) > start + dt.timedelta(days=10):
            out[p] = {"total": None, "pa": None}
            continue
        # The series may start after the window opens; say so by leaving the
        # figure out rather than quietly rebasing on a later day.
        if _date(days[i]) > start + dt.timedelta(days=10):
            out[p] = {"total": None, "pa": None}
            continue
        total = vals[-1] / vals[i] - 1
        years = (end - _date(days[i])).days / 365.25
        pa = (1 + total) ** (1 / years) - 1 if years > 1.05 else None
        out[p] = {"total": round(total * 100, 1),
                  "pa": None if pa is None else round(pa * 100, 1)}
    return out


def _underwater(days, vals):
    peak = vals[0]
    uw = []
    for v in vals:
        peak = max(peak, v)
        uw.append(round((v / peak - 1) * 100, 2))
    return uw


def _falls(days, vals):
    """The deepest falls from a running high, peak to trough to recovery."""
    peak_i = trough_i = 0
    in_fall = False
    episodes = []
    for i, v in enumerate(vals):
        if v >= vals[peak_i]:
            if in_fall:
                episodes.append((peak_i, trough_i, i))
                in_fall = False
            peak_i = i
        elif not in_fall:
            in_fall, trough_i = True, i
        elif v < vals[trough_i]:
            trough_i = i
    if in_fall:
        episodes.append((peak_i, trough_i, None))
    out = []
    for p, t, r in episodes:
        depth = (vals[t] / vals[p] - 1) * 100
        if depth > -FALL_FLOOR:
            continue
        out.append({"peak": days[p], "trough": days[t],
                    "recovered": days[r] if r is not None else None,
                    "depth": round(depth, 1)})
    out.sort(key=lambda e: e["depth"])
    return sorted(out[:FALLS], key=lambda e: e["peak"])


def _thin(days, vals, keep=520):
    """Weekly is enough for a line a few hundred pixels wide."""
    if len(days) <= keep:
        return days, vals
    step = max(1, len(days) // keep)
    d = days[::step]
    v = vals[::step]
    if d[-1] != days[-1]:
        d.append(days[-1])
        v.append(vals[-1])
    return d, v


def _indices(navs):
    out = {}
    for name in INDICES:
        rec = (navs.get("indices") or {}).get(name)
        if not rec or not rec.get("d"):
            continue
        days, vals = rec["d"], rec["v"]
        td, tv = _thin(days, vals)
        uw = _underwater(days, vals)
        ud, uv = _thin(days, uw)
        out[name] = {
            "from": days[0], "to": days[-1],
            "source": rec.get("source"), "ticker": rec.get("ticker"),
            "returns": _returns(days, vals),
            "falls": _falls(days, vals),
            "series": {"d": td, "v": tv},
            "uw": {"d": ud, "v": uv},
        }
    return out


def _quilt(navs):
    """Calendar year returns of the total return series, last eight years,
    the current year to date."""
    out = {}
    for name, rec in (navs.get("benchmarks") or {}).items():
        days, vals = rec.get("d") or [], rec.get("v") or []
        if len(days) < 13:
            continue
        by_year = {}
        for d, v in zip(days, vals):
            by_year[d[:4]] = v          # last observation in each year
        years = sorted(by_year)
        prev = None
        cy = {}
        for y in years:
            if prev is not None:
                cy[y] = round((by_year[y] / by_year[prev] - 1) * 100, 1)
            prev = y
        out[name] = dict(list(cy.items())[-8:])
    return out


def _pair(state, key):
    f = (state.get("byKey") or {}).get(key)
    if not f:
        return None
    return {
        "aumCr": f.get("aumCr"), "ret1": f.get("return1Y"), "ret3": f.get("return3Y"),
        "ret5": f.get("return5Y"), "hit": f.get("rollingHitRate3Y"),
        "dd": f.get("maxDrawdown3Y"), "down": f.get("downsideCapture3Y"),
        "vol": f.get("stdDev3Y"), "flow": f.get("netFlow1YPct"),
        "cash": f.get("cashPct"), "ten": f.get("managerYears"),
        "category": f.get("category"),
    }


def build(state=None):
    state = state or ds.load()
    navs = state.get("navs") or {}
    static = _static()
    indices = _indices(navs)
    as_of = max((r["to"] for r in indices.values()), default=None)
    pairs = {}
    for k, p in (static.get("pairs") or {}).items():
        a, b = _pair(state, p["A"]), _pair(state, p["B"])
        if a and b:
            pairs[k] = {"label": p["label"], "A": a, "B": b}
    return {
        "asOf": as_of,
        "builtAt": navs.get("builtAt"),
        "indices": indices,
        "quilt": _quilt(navs),
        "tri": {n: {"from": r["d"][0], "to": r["d"][-1]}
                for n, r in (navs.get("benchmarks") or {}).items() if r.get("d")},
        "history": {n: {"from": r["d"][0], "to": r["d"][-1], "n": len(r["d"])}
                    for n, r in (navs.get("history") or {}).items() if r.get("d")},
        "pairs": pairs,
        **{k: static[k] for k in ("crises", "rolling", "matrix", "landscape",
                                  "hv", "sensex", "india", "web") if k in static},
    }
