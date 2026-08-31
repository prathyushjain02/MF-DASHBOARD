"""Load the built dataset once, score it, and hold the derived views.

Everything the API serves comes from here. The dataset on disk is inert JSON;
this module is where it becomes a scored, ranked universe. It is deliberately
loaded and evaluated a single time per process, at import or at first call,
because the scoring is pure and the inputs do not change while the server runs.
"""

from __future__ import annotations

import json
import os
import threading
from collections import defaultdict
from datetime import date as _date, timedelta as _timedelta

from . import framework as fw
from . import narrative
from .screener import (pairwise_overlap, score_universe)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")

_LOCK = threading.Lock()
_STATE = None


def _read(name, default):
    path = os.path.join(DATA_DIR, name)
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load(force=False):
    global _STATE
    with _LOCK:
        if _STATE is not None and not force:
            return _STATE
        funds = _read("funds.json", [])
        holdings = _read("holdings.json", {})
        meta = _read("meta.json", {})
        benchmarks = _read("benchmarks.json", {})
        navs = _read("navs.json", {})

        scored = score_universe(funds, holdings)

        by_key = {f["key"]: f for f in scored}
        by_cat = defaultdict(list)
        for f in scored:
            by_cat[f["category"]].append(f)
        for group in by_cat.values():
            group.sort(key=lambda f: (f["composite"] is None, -(f["composite"] or 0)))

        _STATE = {
            "funds": scored,
            "byKey": by_key,
            "byCategory": dict(by_cat),
            "holdings": holdings,
            "benchmarks": benchmarks,
            "navs": navs,
            "meta": meta,
            "universeCount": len(funds),
        }
        return _STATE


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------

# Fields that are internal working state rather than part of the fund record.
_PRIVATE = ("_book",)

# The compact row used by the tables. The detail card asks for the full record.
_ROW_FIELDS = (
    "key", "name", "category", "amc", "fundManager", "band", "bandMeaning",
    "composite", "evidence", "overallRank", "categoryRank", "categoryCount",
    "tier", "tierSize", "aumCr", "nav", "navDate",
    "return3M", "return6M", "return1Y", "return2Y", "return3Y",
    "return5Y", "return7Y",
    "medianRolling3Y", "medianRolling5Y",
    "sharpe3Y", "sortino3Y", "informationRatio3Y", "treynor3Y",
    "upsideCapture3Y", "downsideCapture3Y", "maxDrawdown3Y",
    "stdDev3Y", "semiStdDev3Y", "beta3Y", "ter",
    "decile3Y", "decile5Y", "vintageYears", "managerYears", "managerCycles",
    "top10", "holdingCount", "mandateFit", "differentiation",
    "categoryOverlap", "capMix", "hasHoldings", "loosePeerGroup", "cashPct",
    "benchmark", "benchmarkKind",
    "netFlow1YPct", "cyBeatPct", "rated", "upsideCapture3Y",
    "managerExperienceYears", "vintageBasis", "rollingHitRate3Y",
)


def public(fund):
    """The full record, minus internal working state."""
    return {k: v for k, v in fund.items() if k not in _PRIVATE}


def row(fund):
    out = {k: fund.get(k) for k in _ROW_FIELDS}
    out["blockScore"] = fund.get("blockScore", {})
    out["flags"] = [f["label"] for f in fund.get("flags", [])]
    out["whyWeLikeIt"] = narrative.why_we_like_it(fund)
    return out


def detail(fund, state=None):
    """Everything the detail card needs for one fund."""
    state = state or load()
    rec = public(fund)
    rec["remark"] = narrative.build_remark(fund)
    rec["mandate"] = fw.MANDATE.get(fund.get("category"), {})
    rec["loosePeerGroup"] = fw.loose_peer_group(fund.get("category"))
    rec["aumCurve"] = fw.aum_curve(fund.get("category"))
    rec["context"] = [
        {**m, "value": fund.get(m["field"]),
         "notScoredWhy": fw.NOT_SCORED_WHY.get(m["field"])}
        for m in fw.CONTEXT_METRICS
    ]
    # Cash sits outside the equity book by design, so it is reported next to the
    # holdings rather than folded into them.
    rec["cashPct"] = fund.get("cashPct")
    # The benchmark the feed quotes this fund against, so the page can put the
    # two side by side instead of asking the reader to hold one in their head.
    bm = (state.get("benchmarks") or {}).get(fund.get("benchmark"))
    rec["benchmark"] = {"name": fund.get("benchmark"),
                        "kind": fund.get("benchmarkKind")
                                or fw.benchmark_for(fund.get("category"))[1],
                        **{k: bm.get(k) for k in
                           ("return3M", "return6M", "return1Y", "return3Y",
                            "return5Y", "return7Y", "returnCYTD")}} if bm else None
    rec["peers"] = category_comparison(fund, state)
    rec["closest"] = closest_books(fund, state, limit=5)
    rec["holdings"] = top_holdings(fund, limit=15)
    return rec


# ---------------------------------------------------------------------------
# Growth series
# ---------------------------------------------------------------------------

# What each period button asks for, in days. `None` means the fund's whole life.
PERIODS = {"1m": 30, "3m": 91, "6m": 182, "1y": 365, "3y": 1095, "5y": 1826,
           "ytd": None, "all": None}

# A series has to reach back to the start of the window to be drawn against the
# others. Anything that begins later would be rebased on a different day, and two
# lines rebased on different days are not a comparison. A week of slack absorbs
# the usual gap between a start date and the next traded day.
_START_SLACK_DAYS = 7

# No chart is more than a thousand pixels wide, so beyond a few hundred points
# the extra ones are bytes nobody can see.
_MAX_POINTS = 400


def _slice_from(series, start_iso):
    d, v = series.get("d") or [], series.get("v") or []
    for i, day in enumerate(d):
        if day >= start_iso:
            return d[i:], v[i:]
    return [], []


def _downsample(days, vals, limit=_MAX_POINTS):
    n = len(days)
    if n <= limit:
        return days, vals
    step = (n - 1) / float(limit - 1)
    idx = sorted({int(round(i * step)) for i in range(limit)} | {n - 1})
    return [days[i] for i in idx], [vals[i] for i in idx]


def _rebased(series, start_iso):
    """Percent growth from the first traded day on or after `start_iso`."""
    days, vals = _slice_from(series, start_iso)
    if len(days) < 2 or not vals[0]:
        return None
    base = vals[0]
    days, vals = _downsample(days, vals)
    return {"days": days, "values": [round(100.0 * (v / base - 1.0), 2) for v in vals]}


def growth(fund, period="1y", state=None):
    """The fund, its category's index tracker and the category average, each
    rebased to zero on the same day so the three are directly comparable.

    A line that cannot reach the start of the window is left out rather than
    rebased on a later day, and the reason is reported so the chart can say why.
    """
    state = state or load()
    navs = state.get("navs") or {}
    key, cat = fund["key"], fund.get("category")
    own = (navs.get("funds") or {}).get(key)
    if not own or len(own.get("d") or []) < 2:
        return {"period": period, "series": [], "unavailable": "No NAV history on file."}

    first, last = own["d"][0], own["d"][-1]
    period = period if period in PERIODS else "1y"
    if period == "all":
        start = first
    elif period == "ytd":
        start = last[:4] + "-01-01"
    else:
        end = _date.fromisoformat(last)
        start = (end - _timedelta(days=PERIODS[period])).isoformat()
    # The fund anchors the window: asking for five years of a three year old fund
    # gives three years, not an empty chart.
    start = max(start, first)

    out, notes = [], []
    f_line = _rebased(own, start)
    if not f_line:
        return {"period": period, "series": [], "unavailable": "Not enough NAV history."}
    out.append({"code": "fund", "label": fund["name"], **f_line})

    """
    The market line, in order of preference:

      the index      daily closes of the index itself, from Yahoo. Deepest
                     history and it is the actual index rather than a stand-in,
                     but it is a price index, so it excludes the dividends a NAV
                     already contains.
      the benchmark  the category's total return index from the workbook,
                     monthly. Dividends are inside it, but it is monthly, so it
                     only stands up over a window of a year or more.
      the fund       a daily tracking scheme, the last resort.

    Whichever is drawn is labelled, since the three are not the same thing.
    """
    span_days = (_date.fromisoformat(last) - _date.fromisoformat(start)).days
    limit = _shift(start, _START_SLACK_DAYS)

    bm_name = (navs.get("benchmarkByCategory") or {}).get(cat)
    bm = (navs.get("benchmarks") or {}).get(bm_name or "")
    idx_name = (navs.get("indexByCategory") or {}).get(cat)
    idx = (navs.get("indices") or {}).get(idx_name or "")

    picked = None
    if idx and idx["d"][0] <= limit:
        picked = {"series": idx, "label": idx["label"],
                  "source": idx.get("source"), "dividends": idx.get("dividends")}
    elif bm and span_days >= fw.MONTHLY_MIN_DAYS and bm["d"][0] <= limit:
        picked = {"series": bm, "label": bm["label"], "source": "benchmark",
                  "dividends": True}

    if picked:
        line = _rebased(picked["series"], start)
        if line:
            out.append({"code": "index", "label": picked["label"],
                        "source": picked["source"],
                        "dividends": picked["dividends"], **line})
    elif idx or bm:
        first_seen = min(s["d"][0] for s in (idx, bm) if s)
        notes.append(f"No market series reaches back to {_month_name(start)}; "
                     f"the earliest on file starts in {_month_name(first_seen)}.")

    avg = (navs.get("categoryAverage") or {}).get(cat)
    if avg and avg["d"][0] <= _shift(start, _START_SLACK_DAYS):
        line = _rebased(avg, start)
        if line:
            out.append({"code": "category", "label": f"{cat} average", **line})

    return {
        "period": period, "start": start, "end": last,
        "series": out, "notes": notes,
        "asOf": last,
        "periods": [p for p in ("1m", "3m", "6m", "ytd", "1y", "3y", "5y", "all")
                    if p in ("ytd", "all") or _has_room(first, last, PERIODS[p])],
    }


def _shift(iso, days):
    return (_date.fromisoformat(iso) + _timedelta(days=days)).isoformat()


def _has_room(first, last, days):
    if not days:
        return True
    return (_date.fromisoformat(last) - _date.fromisoformat(first)).days >= days * 0.6


_MONTHS = ("January", "February", "March", "April", "May", "June", "July",
           "August", "September", "October", "November", "December")


def _month_name(iso):
    d = _date.fromisoformat(iso)
    return f"{_MONTHS[d.month - 1]} {d.year}"


def category_comparison(fund, state=None):
    """Block scores against the category median, plus the fund's percentile on
    the headline metrics. This is what tells a reader whether a 62 is good."""
    state = state or load()
    group = [f for f in state["byCategory"].get(fund.get("category"), [])
             if f["key"] != fund["key"]]
    out = []
    for b in fund.get("blocks", []):
        peers = sorted(x["blockScore"].get(b["code"]) for x in group
                       if x["blockScore"].get(b["code"]) is not None)
        med = peers[len(peers) // 2] if peers else None
        out.append({"code": b["code"], "name": b["name"], "weight": b["weight"],
                    "score": b["score"], "categoryMedian": med,
                    "coverage": b["coverage"]})
    return out


def closest_books(fund, state=None, limit=5):
    """Funds whose portfolio most resembles this one. The substitution question:
    if this fund were dropped, what actually replaces the exposure."""
    state = state or load()
    book = fund.get("_book")
    if not book:
        return []
    out = []
    for other in state["byCategory"].get(fund.get("category"), []):
        if other["key"] == fund["key"] or not other.get("_book"):
            continue
        ov = pairwise_overlap(book, other["_book"])
        if ov is None:
            continue
        out.append({"key": other["key"], "name": other["name"], "overlap": ov,
                    "composite": other.get("composite"), "band": other.get("band")})
    out.sort(key=lambda r: -r["overlap"])
    return out[:limit]


def top_holdings(fund, limit=15):
    book = fund.get("_book") or []
    return [{"name": b["name"], "sector": b["sector"], "cap": b["cap"],
             "weight": round(b["weight"], 2)} for b in book[:limit]]


def shortlist(category, state=None, limit=8):
    """The category shortlist: the top tier or two, never more than `limit`."""
    state = state or load()
    group = [f for f in state["byCategory"].get(category, []) if f.get("composite") is not None]
    return group[:limit]


def category_dossier(category, state=None):
    state = state or load()
    group = state["byCategory"].get(category, [])
    scored = [f for f in group if f.get("composite") is not None]
    comps = sorted((f["composite"] for f in scored), reverse=True)
    return {
        "category": category,
        "mandate": fw.MANDATE.get(category, {}),
        "aumCurve": fw.aum_curve(category),
        "count": len(group),
        "scoredCount": len(scored),
        "best": comps[0] if comps else None,
        "median": comps[len(comps) // 2] if comps else None,
        "worst": comps[-1] if comps else None,
        "bands": {b["code"]: sum(1 for f in group if f.get("band") == b["code"])
                  for b in fw.BANDS},
        "shortlist": [row(f) for f in shortlist(category, state)],
        "table": [row(f) for f in group],
    }


def look_through(weights, state=None):
    """Stock, sector and cap exposure of a weighted set of funds, plus the
    pairwise overlap between them."""
    state = state or load()
    stock, sector, cap = defaultdict(float), defaultdict(float), defaultdict(float)
    used, missing, total = [], [], sum(weights.values()) or 1.0
    for key, w in weights.items():
        f = state["byKey"].get(key)
        if not f:
            missing.append(key)
            continue
        book = f.get("_book")
        if not book:
            missing.append(key)
            continue
        used.append(f)
        share = w / total
        for b in book:
            stock[b["name"]] += share * b["weight"]
            sector[b["sector"]] += share * b["weight"]
            if b["cap"]:
                cap[b["cap"]] += share * b["weight"]

    pairs = []
    for i, a in enumerate(used):
        for b in used[i + 1:]:
            ov = pairwise_overlap(a["_book"], b["_book"])
            if ov is not None:
                pairs.append({"a": a["key"], "aName": a["name"], "b": b["key"],
                              "bName": b["name"], "overlap": ov})
    pairs.sort(key=lambda p: -p["overlap"])

    top = sorted(stock.items(), key=lambda kv: -kv[1])
    return {
        "funds": [{"key": f["key"], "name": f["name"], "category": f["category"],
                   "weight": round(100 * weights[f["key"]] / total, 1),
                   "band": f["band"], "composite": f["composite"]} for f in used],
        "missing": missing,
        "stocks": [{"name": k, "weight": round(v, 2)} for k, v in top[:25]],
        "distinctStocks": len(stock),
        "sectors": sorted(({"sector": k, "weight": round(v, 1)}
                           for k, v in sector.items()),
                          key=lambda r: -r["weight"]),
        "capMix": {k: round(v, 1) for k, v in cap.items()},
        "pairs": pairs,
        "topTen": round(sum(v for _, v in top[:10]), 1),
    }


def _median(vals):
    vals = sorted(v for v in vals if v is not None)
    return round(vals[len(vals) // 2], 2) if vals else None


def _coverage(funds, field):
    if not funds:
        return 0
    return round(100.0 * sum(1 for f in funds if f.get(field) is not None) / len(funds))


def process_stats(state=None):
    """Live figures for each factor of the selection process.

    Descriptive facts about the universe as it stands, read fresh each request so
    the page reports the current build rather than a claim written into the copy.
    """
    state = state or load()
    funds = state["funds"]
    rated = [f for f in funds if f.get("rated")]
    n = len(funds)

    caps = sum(1 for f in funds
               if any(x["code"] == "capacity" for x in f.get("flags", [])))
    new_mgr = sum(1 for f in funds
                  if any(x["code"] == "new-manager" for x in f.get("flags", [])))
    seasoned = sum(1 for f in funds if (f.get("managerYears") or 0) >= 10)
    mgr_count = _median([len(f.get("managers") or []) or None for f in funds])
    aum_med = _median([f.get("aumCr") for f in rated])

    return {
        "performance": {
            "headline": f"{_median([f.get('rollingHitRate3Y') for f in rated]):.0f}%",
            "caption": "of three year windows beat the benchmark, for the median fund",
            "rows": [
                ["Median rolling 3Y return",
                 f"{_median([f.get('medianRolling3Y') for f in rated])}%"],
                ["Median rolling 10Y return",
                 f"{_median([f.get('medianRolling10Y') for f in rated])}%"],
                ["Median downside capture",
                 f"{_median([f.get('downsideCapture3Y') for f in rated])}"],
                ["Median maximum drawdown",
                 f"{_median([f.get('maxDrawdown3Y') for f in rated])}%"],
            ],
        },
        "aum": {
            "headline": f"{caps}",
            "caption": "funds sit where size starts to work against the mandate",
            "rows": [
                ["Median fund size", f"INR {aum_med:,.0f} cr" if aum_med else "n/a"],
                ["Largest fund",
                 f"INR {max((f.get('aumCr') or 0) for f in funds):,.0f} cr"],
                ["Smallest rated fund",
                 f"INR {min((f.get('aumCr') or 0) for f in rated):,.0f} cr" if rated else "n/a"],
                ["Size curves in use", "Six, one per category shape"],
            ],
        },
        "quant": {
            "headline": f"{_median([f.get('informationRatio3Y') for f in rated])}",
            "caption": "median Information Ratio over three years",
            "rows": [
                ["Horizons read", "3Y, 5Y, 7Y and 10Y wherever published"],
                ["Median Sortino 3Y", f"{_median([f.get('sortino3Y') for f in rated])}"],
                ["Median holdings per book",
                 f"{_median([f.get('holdingCount') for f in funds]):.0f}"
                 if _median([f.get('holdingCount') for f in funds]) else "n/a"],
                ["Median overlap with the category book",
                 f"{_median([f.get('categoryOverlap') for f in rated])}%"],
            ],
        },
        "fmType": {
            "headline": f"{mgr_count:.0f}" if mgr_count else "n/a",
            "caption": "named managers on the median scheme",
            "rows": [
                ["Schemes run by a single manager",
                 f"{sum(1 for f in funds if len(f.get('managers') or []) == 1)} of {n}"],
                ["Largest named team",
                 f"{max(len(f.get('managers') or []) for f in funds)} managers"],
                ["Distinct fund houses", f"{len({f.get('amc') for f in funds if f.get('amc')})}"],
            ],
        },
        "attitude": {
            "headline": "\u2014",
            "caption": "this is what the written view is for",
            "rows": [
                ["Where it is read", "Manager meetings, not a return series"],
                ["Where it appears here", "Why we like it, and What to watch"],
            ],
        },
        "stability": {
            "headline": f"{new_mgr}",
            "caption": "funds where the longest serving manager is under three years in",
            "rows": [
                ["Median tenure, longest serving manager",
                 f"{_median([f.get('managerYears') for f in funds])} yrs"],
                ["Funds with a manager past ten years", f"{seasoned} of {n}"],
                ["Median market cycles run",
                 f"{_median([f.get('managerCycles') for f in funds])}"],
                ["Cycles in the window", "Three falls of 12% or more since 2018"],
            ],
        },
    }


def meta_summary(state=None):
    state = state or load()
    scored = [f for f in state["funds"] if f.get("composite") is not None]
    return {
        "universeCount": state["universeCount"],
        "inScope": len(state["funds"]),
        "scored": len(scored),
        "withHoldings": sum(1 for f in state["funds"] if f.get("_book")),
        "categories": [
            {"name": c,
             "count": len(state["byCategory"].get(c, [])),
             "scored": sum(1 for f in state["byCategory"].get(c, [])
                           if f.get("composite") is not None)}
            for c in fw.CATEGORIES
        ],
        "bands": {b["code"]: sum(1 for f in state["funds"] if f.get("band") == b["code"])
                  for b in fw.BANDS},
        "notRated": sum(1 for f in state["funds"] if not f.get("rated")),
        "minEvidence": fw.MIN_EVIDENCE,
        "amcs": sorted({f["amc"] for f in state["funds"] if f.get("amc")}),
        "marketCycles": state["meta"].get("marketCycles", []),
        "medianEvidence": (sorted(f["evidence"] for f in state["funds"])[len(state["funds"]) // 2]
                           if state["funds"] else None),
        "build": state["meta"],
    }


# ---------------------------------------------------------------------------
# Compare
# ---------------------------------------------------------------------------

# What the benchmark picker offers. Each mark draws from the daily index series,
# which is the only one fine-grained enough for a short window, and takes its
# table numbers from the feed's own benchmark row where the feed publishes one.
#
# The two are not the same series and are deliberately not presented as one: the
# daily line is a price index, the feed's row is a total return index. Where no
# feed row exists the table shows nothing rather than borrowing a neighbouring
# index, because Nifty Midcap 150 and BSE MidSmallCap are different exposures.
COMPARE_MARKS = [
    {"id": "Nifty 500", "metricsFrom": "Nifty 500 TRI"},
    {"id": "Nifty 50", "metricsFrom": "Nifty 50 TRI"},
    {"id": "Nifty Midcap 150", "metricsFrom": None},
    {"id": "Nifty Smallcap 250", "metricsFrom": None},
]

# The columns the compare table can show, per fund and per mark.
_COMPARE_METRICS = (
    "return3M", "return6M", "return1Y", "return2Y", "return3Y", "return5Y",
    "return7Y", "medianRolling3Y", "medianRolling5Y",
    "sharpe3Y", "sortino3Y", "informationRatio3Y", "beta3Y",
    "upsideCapture3Y", "downsideCapture3Y",
)

MAX_COMPARE_FUNDS = 5
MAX_COMPARE_MARKS = 2


# Only two of the four marks come with a published metric row. The other two are
# read off their own series instead of being left blank: an empty column tells
# the reader nothing, and the arithmetic behind a point to point return is not
# the part of this that needs a vendor.
_RETURN_WINDOWS = (("return3M", 91), ("return6M", 182), ("return1Y", 365),
                   ("return2Y", 730), ("return3Y", 1095), ("return5Y", 1826),
                   ("return7Y", 2557))
_ANNUALISE_BEYOND = 400
_MIN_ROLLING_WINDOWS = 12


def _spacing(days):
    """Median gap between observations, so a monthly series is not judged by the
    tolerances of a daily one."""
    gaps = sorted((_date.fromisoformat(b) - _date.fromisoformat(a)).days
                  for a, b in zip(days, days[1:]))
    return gaps[len(gaps) // 2] if gaps else 1


def _nearest(days, vals, iso, tol):
    """The observation closest to `iso`, if one lands close enough. A window
    dated off a point a long way from where it should start is not the window it
    claims to be, so it is dropped rather than approximated: a monthly series
    cannot honestly answer a three month question."""
    lo, hi = 0, len(days)
    while lo < hi:
        mid = (lo + hi) // 2
        if days[mid] < iso:
            lo = mid + 1
        else:
            hi = mid
    want = _date.fromisoformat(iso)
    best, gap = None, None
    for i in (lo - 1, lo):
        if 0 <= i < len(days) and vals[i]:
            g = abs((_date.fromisoformat(days[i]) - want).days)
            if gap is None or g < gap:
                best, gap = vals[i], g
    return best if gap is not None and gap <= tol else None


def _window_return(days, vals, win_days, spacing, end):
    """Point to point over `win_days`, annualised beyond a year, in the same
    terms the funds' own return columns are stated."""
    v1 = vals[end]
    tol = min(max(7, spacing * 0.55), win_days * 0.08)
    v0 = _nearest(days[:end + 1], vals[:end + 1],
                  _shift(days[end], -win_days), tol)
    if not v0 or not v1:
        return None
    growth_ = v1 / v0
    if win_days > _ANNUALISE_BEYOND:
        growth_ = growth_ ** (365.25 / win_days)
    return round(100.0 * (growth_ - 1.0), 2)


def _rolling_median(days, vals, win_days, spacing, end):
    """Median of every window of that length, matching how the funds' own
    rolling figures are stated."""
    seen = []
    for j in range(end, -1, -1):
        if _shift(days[j], -win_days) < days[0]:
            break
        r = _window_return(days, vals, win_days, spacing, j)
        if r is not None:
            seen.append(r)
    if len(seen) < _MIN_ROLLING_WINDOWS:
        return None
    return _median(seen)


def _month_end_index(days):
    """The last observation of the last complete month. Published figures are
    stated to a month end, so a series read against them has to stop on one too
    or the two columns answer questions about different windows."""
    if not days:
        return None
    last = _date.fromisoformat(days[-1])
    if (last + _timedelta(days=1)).month != last.month:
        return len(days) - 1
    month = days[-1][:7]
    for i in range(len(days) - 1, -1, -1):
        if days[i][:7] < month:
            return i
    return None


def _series_metrics(series):
    """Returns and rolling returns off an index series. Risk and capture are
    left out: they need a benchmark to be measured against, and a benchmark
    measured against itself is a row of ones."""
    days, vals = series.get("d") or [], series.get("v") or []
    end = _month_end_index(days)
    if end is None or end < 8:
        return None
    spacing = _spacing(days)
    out = {k: None for k in _COMPARE_METRICS}
    for name, win in _RETURN_WINDOWS:
        out[name] = _window_return(days, vals, win, spacing, end)
    out["medianRolling3Y"] = _rolling_median(days, vals, 1095, spacing, end)
    out["medianRolling5Y"] = _rolling_median(days, vals, 1826, spacing, end)
    return out if any(v is not None for v in out.values()) else None


def _mark_metrics(mark, state):
    """Where a mark's figures come from: the published row for its total return
    index where the feed carries one, otherwise the price index itself, read to
    the same month end. A price index excludes dividends, so which basis was
    used travels with the numbers rather than being buried in a footnote."""
    row_ = (state.get("benchmarks") or {}).get(mark["metricsFrom"] or "")
    if row_:
        return {k: row_.get(k) for k in _COMPARE_METRICS}, mark["metricsFrom"]
    navs = state.get("navs") or {}
    m = _series_metrics((navs.get("indices") or {}).get(mark["id"]) or {})
    if m:
        return m, mark["id"] + " price index"
    return None, None


def compare_marks(state=None):
    """The selectable benchmarks, with what each one can actually do."""
    state = state or load()
    navs = state.get("navs") or {}
    indices = navs.get("indices") or {}
    out = []
    for m in COMPARE_MARKS:
        series = indices.get(m["id"])
        if not series:
            continue
        metrics, label = _mark_metrics(m, state)
        out.append({
            "id": m["id"],
            "label": m["id"],
            "from": series.get("d", [None])[0],
            "metricsLabel": label,
            "metrics": metrics,
        })
    return out


def compare_table(keys, marks=(), state=None):
    """Rows for the comparison table: the funds asked for, then the marks."""
    state = state or load()
    catalogue = {m["id"]: m for m in compare_marks(state)}
    funds = [state["byKey"][k] for k in keys[:MAX_COMPARE_FUNDS]
             if k in state["byKey"]]
    return {
        "funds": [{**row(f), "metrics": {k: f.get(k) for k in _COMPARE_METRICS}}
                  for f in funds],
        "marks": [{"id": m, "label": catalogue[m]["label"],
                   "metricsLabel": catalogue[m]["metricsLabel"],
                   "metrics": catalogue[m]["metrics"]}
                  for m in marks[:MAX_COMPARE_MARKS] if m in catalogue],
        "available": compare_marks(state),
        "maxFunds": MAX_COMPARE_FUNDS,
        "maxMarks": MAX_COMPARE_MARKS,
    }


# Above this, two funds are holding a large part of the same book. It is not a
# verdict, it is the level at which a reader should want to know why they own
# both, so the matrix marks it and leaves the judgement alone.
OVERLAP_HEAVY = 40


def compare_overlap(keys, state=None):
    """Pairwise overlap across the selected funds, as a matrix.

    Overlap is the weight the two books hold in common: for every stock, the
    smaller of the two positions, summed. It answers "how much of this am I
    buying twice", which is the question two funds in one portfolio raises.
    """
    state = state or load()
    funds, missing = [], []
    for k in keys[:MAX_COMPARE_FUNDS]:
        f = state["byKey"].get(k)
        if f and f.get("_book"):
            funds.append(f)
        elif f:
            missing.append(f["name"])
    matrix = [[None if i == j else pairwise_overlap(a["_book"], b["_book"])
               for j, b in enumerate(funds)] for i, a in enumerate(funds)]
    return {
        "funds": [{"key": f["key"], "name": f["name"], "category": f["category"],
                   "holdingCount": f.get("holdingCount")} for f in funds],
        "matrix": matrix,
        "missing": missing,
        "heavy": OVERLAP_HEAVY,
    }


def overlap_pair(a_key, b_key, state=None):
    """Every stock two funds both hold, with each side's weight and the part
    that counts towards the overlap."""
    state = state or load()
    a, b = state["byKey"].get(a_key), state["byKey"].get(b_key)
    if not a or not b:
        return None
    abook, bbook = a.get("_book") or [], b.get("_book") or []
    bw = {x["name"]: x for x in bbook}
    shared = []
    for x in abook:
        y = bw.get(x["name"])
        if not y:
            continue
        shared.append({
            "name": x["name"], "sector": x["sector"], "cap": x["cap"],
            "a": round(x["weight"], 2), "b": round(y["weight"], 2),
            "common": round(min(x["weight"], y["weight"]), 2),
        })
    shared.sort(key=lambda r: -r["common"])
    return {
        "a": {"key": a["key"], "name": a["name"], "category": a["category"],
              "holdingCount": len(abook)},
        "b": {"key": b["key"], "name": b["name"], "category": b["category"],
              "holdingCount": len(bbook)},
        "overlap": pairwise_overlap(abook, bbook),
        "sharedNames": len(shared),
        "shared": shared,
    }


def compare_growth(keys, marks=(), period="3y", state=None):
    """Every selected fund and mark on one rebased line chart.

    They must share a base date or the chart is not a comparison, so the window
    is pulled forward to the youngest fund in the selection. That is reported
    rather than done silently: adding a two year old fund to a five year window
    shortens the whole picture, and the reader has to know it was their choice
    that did it.
    """
    state = state or load()
    navs = state.get("navs") or {}
    fund_series = []
    for k in keys[:MAX_COMPARE_FUNDS]:
        f = state["byKey"].get(k)
        s = (navs.get("funds") or {}).get(k)
        if f and s and len(s.get("d") or []) >= 2:
            fund_series.append((f, s))
    if not fund_series:
        return {"period": period, "series": [], "notes": [],
                "unavailable": "No NAV history for the funds selected."}

    period = period if period in PERIODS else "3y"
    last = max(s["d"][-1] for _, s in fund_series)
    if period == "all":
        start = min(s["d"][0] for _, s in fund_series)
    elif period == "ytd":
        start = last[:4] + "-01-01"
    else:
        start = (_date.fromisoformat(last)
                 - _timedelta(days=PERIODS[period])).isoformat()

    # The youngest fund sets the floor for everyone.
    youngest = max(s["d"][0] for _, s in fund_series)
    notes = []
    if youngest > start:
        late = sorted((s["d"][0], f["name"]) for f, s in fund_series)[-1]
        notes.append(f"Window starts at {_month_name(youngest)} because "
                     f"{late[1]} has no history before it.")
        start = youngest

    out = []
    for f, s in fund_series:
        line = _rebased(s, start)
        if line:
            out.append({"code": "fund", "key": f["key"], "label": f["name"],
                        "category": f.get("category"), **line})

    catalogue = {m["id"]: m for m in compare_marks(state)}
    limit = _shift(start, _START_SLACK_DAYS)
    for mid in list(marks)[:MAX_COMPARE_MARKS]:
        series = (navs.get("indices") or {}).get(mid)
        if not series or mid not in catalogue:
            continue
        if series["d"][0] > limit:
            notes.append(f"{mid} starts in {_month_name(series['d'][0])}, "
                         f"so it cannot be drawn over this window.")
            continue
        line = _rebased(series, start)
        if line:
            out.append({"code": "mark", "key": mid, "label": mid, **line})

    return {"period": period, "start": start, "end": last,
            "series": out, "notes": notes,
            "periods": [p for p in ("1m", "3m", "6m", "ytd", "1y", "3y", "5y", "all")
                        if p in ("ytd", "all")
                        or _has_room(min(s["d"][0] for _, s in fund_series),
                                     last, PERIODS[p])]}
