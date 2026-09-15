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

from . import classify
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
    "netFlow1YPct", "cyBeatPct", "rated", "scored", "upsideCapture3Y",
    "managerExperienceYears", "vintageBasis", "rollingHitRate3Y",
    "inceptionDate",
)


def public(fund):
    """The full record, minus internal working state."""
    return {k: v for k, v in fund.items() if k not in _PRIVATE}


def row(fund):
    out = {k: fund.get(k) for k in _ROW_FIELDS}
    out["flags"] = [f["label"] for f in fund.get("flags", [])]
    return out


# What the All funds table reads, and nothing else. That table is the one place
# that asks for five hundred funds at once, and it was being sent sixty four
# fields each to draw fifteen columns: most of a megabyte of JSON, of which
# three quarters was never looked at. Every other list is a dozen rows, where
# the full record costs nothing worth saving.
_LIST_FIELDS = (
    "key", "name", "category", "amc", "band", "composite", "evidence",
    "categoryRank", "aumCr", "ter", "managerYears",
    "medianRolling3Y", "medianRolling5Y", "rollingHitRate3Y", "return3Y",
    "sortino3Y", "informationRatio3Y",
    "downsideCapture3Y", "upsideCapture3Y", "maxDrawdown3Y",
    "hasHoldings", "rated", "scored",
)


def list_row(fund):
    out = {k: fund.get(k) for k in _LIST_FIELDS}
    # One flag is shown against the name; the rest are on the fund page.
    flags = fund.get("flags") or []
    out["flags"] = [flags[0]["label"]] if flags else []
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
    # The page carries these on its face rather than behind a card, so they
    # travel with the record instead of costing a second request each.
    rec["returns"] = returns_table(fund, state)
    rec["drawdowns"] = drawdowns(fund, state)
    rec["sectors"] = top_sectors(fund, limit=8)
    rec["topFive"] = top_weight(fund, 5)
    return rec


def top_weight(fund, n):
    """Share of the equity book in its n largest positions."""
    book = sorted((fund.get("_book") or []), key=lambda b: -b["weight"])[:n]
    return round(sum(b["weight"] for b in book), 1) if book else None


def top_sectors(fund, limit=3):
    """The book's largest sectors, as shares of the equity book."""
    agg = defaultdict(float)
    for b in (fund.get("_book") or []):
        agg[b["sector"]] += b["weight"]
    out = sorted(({"sector": k, "weight": round(v, 1)} for k, v in agg.items()),
                 key=lambda r: -r["weight"])
    return out[:limit]


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
        # Daily NAV is collected for the universe the model scores. Carrying it
        # for every index fund and ETF as well would quadruple a file that is
        # committed and redeployed every morning, for a chart of a line that is,
        # by construction, its index.
        return {"period": period, "series": [],
                "unavailable": ("No NAV history on file. It is collected for the "
                                "actively managed universe."
                                if not fw.is_scored(fund.get("category"))
                                else "No NAV history on file.")}

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


# ---------------------------------------------------------------------------
# Returns
# ---------------------------------------------------------------------------

# The horizons the card carries. Short enough a reader holds all five in their
# head, long enough that the last two say something about a process rather than
# about a quarter.
RETURN_ROWS = (("1M", "1M"), ("3M", "3M"), ("1Y", "1Y"), ("3Y", "3Y"), ("5Y", "5Y"))


def returns_table(fund, state=None):
    """Point to point and median rolling returns, each against the benchmark.

    The gap is printed rather than left to be worked out. Both halves are stated
    on the same horizon and never mixed: a point to point three year number and
    a median three year window are different questions about the same fund, and
    the table answers both rather than choosing.
    """
    state = state or load()
    name, kind = fw.benchmark_for(fund.get("category"))
    bm = (state.get("benchmarks") or {}).get(name) or {}

    def pair(prefix, horizon):
        field = f"{prefix}{horizon}"
        f_v, b_v = fund.get(field), bm.get(field)
        return {"fund": f_v, "bench": b_v,
                "alpha": (round(f_v - b_v, 2)
                          if f_v is not None and b_v is not None else None)}

    return {
        "benchmark": name, "benchmarkKind": kind,
        "rows": [{"label": label,
                  "p2p": pair("return", h),
                  "rolling": pair("medianRolling", h)}
                 for label, h in RETURN_ROWS],
    }


# ---------------------------------------------------------------------------
# Drawdowns
# ---------------------------------------------------------------------------

# A dip this shallow is the market breathing, not an episode anybody sat
# through, and counting them would bury the three that matter in a list of
# eighty that do not.
DRAWDOWN_FLOOR = 8.0

# How many of the worst to report.
DRAWDOWN_COUNT = 3


def _underwater(days, vals):
    """Depth below the running peak, as a negative percent, on every day."""
    out, peak = [], None
    for v in vals:
        peak = v if peak is None or v > peak else peak
        out.append(round(100.0 * (v / peak - 1.0), 2) if peak else 0.0)
    return out


def _episodes(days, vals):
    """Every fall below the floor, with what it cost and how long it took.

    An episode opens on the day the last peak was set, bottoms at its lowest
    point, and closes on the day the fund next reaches that peak again. One that
    never reaches it is reported as ongoing rather than given a recovery figure
    the fund has not yet earned.
    """
    out = []
    peak_v, peak_i = vals[0], 0
    trough_v, trough_i = vals[0], 0
    for i, v in enumerate(vals):
        if v >= peak_v:
            depth = 100.0 * (trough_v / peak_v - 1.0)
            if depth <= -DRAWDOWN_FLOOR:
                out.append({"peak": days[peak_i], "trough": days[trough_i],
                            "recovered": days[i], "depth": round(depth, 1)})
            peak_v, peak_i = v, i
            trough_v, trough_i = v, i
        elif v < trough_v:
            trough_v, trough_i = v, i
    depth = 100.0 * (trough_v / peak_v - 1.0)
    if depth <= -DRAWDOWN_FLOOR:
        out.append({"peak": days[peak_i], "trough": days[trough_i],
                    "recovered": None, "depth": round(depth, 1)})
    return out


def _best_run(days, vals):
    """The strongest stretch between a low and a later high.

    A page that only lists falls describes half the record. This is the other
    half on the same terms: from which day to which day, how far, how long.
    """
    if len(vals) < 2:
        return None
    low_v, low_i = vals[0], 0
    best = None
    for i, v in enumerate(vals):
        if v < low_v:
            low_v, low_i = v, i
        gain = 100.0 * (v / low_v - 1.0) if low_v else 0.0
        if best is None or gain > best["gain"]:
            best = {"gain": round(gain, 1), "from": days[low_i], "to": days[i]}
    if not best or best["gain"] <= 0:
        return None
    best["months"] = _months(best["from"], best["to"])
    return best


def _months(a, b):
    if not a or not b:
        return None
    d1, d2 = _date.fromisoformat(a), _date.fromisoformat(b)
    return round((d2 - d1).days / 30.44, 1)


def _fall_between(series, start, end):
    """What another series did over the same stretch, peak date to trough date.
    Not its own worst fall over the window: the question is what the market was
    doing while this fund was falling, and its own worst fall would be a
    different window and a different question."""
    if not series:
        return None
    a = _series_at_or_before(series["d"], series["v"], start)
    b = _series_at_or_before(series["d"], series["v"], end)
    return round(100.0 * (b / a - 1.0), 1) if a and b else None


def drawdowns(fund, state=None):
    """The fund's time below its own high water mark, and the worst three falls.

    A maximum drawdown is one number for the whole record and says nothing about
    how long the hole lasted, which is the part an investor actually sits
    through. This is the same record as a shape: how deep, how long down, how
    long back.
    """
    state = state or load()
    navs = state.get("navs") or {}
    own = (navs.get("funds") or {}).get(fund["key"])
    if not own or len(own.get("d") or []) < 30:
        return {"unavailable": "No NAV history on file."}

    days, vals = own["d"], own["v"]
    index_name = fw.index_name_for(fund.get("category"))
    index = (navs.get("indices") or {}).get(index_name)

    episodes = sorted(_episodes(days, vals), key=lambda e: e["depth"])
    worst = []
    for e in episodes[:DRAWDOWN_COUNT]:
        worst.append({
            **e,
            "toBottom": _months(e["peak"], e["trough"]),
            "toRecover": _months(e["trough"], e["recovered"]),
            "indexFall": _fall_between(index, e["peak"], e["trough"]),
        })

    under = _underwater(days, vals)
    d, u = _downsample(days, under)
    current = under[-1]
    return {
        "days": d, "values": u,
        "indexName": index_name,
        "worst": worst,
        "current": current,
        "best": _best_run(days, vals),
        "inDrawdown": current < -0.5,
        "floor": DRAWDOWN_FLOOR,
        "from": days[0],
    }


# ---------------------------------------------------------------------------
# Calendar years
# ---------------------------------------------------------------------------

# Below this many funds a column is one or two funds wide and the colour scale
# across it is describing nothing.
MIN_YEAR_COVERAGE = 5

# How many funds the look through shows. Enough to see a pattern hold or break,
# few enough to read across a row without losing the line.
CALENDAR_LIMIT = 15


# How far back the beat count reaches. A decade is long enough to contain a
# bull run, a crash and a rotation, which is what it takes before "beat the
# index more often than not" is a record rather than a streak.
BEAT_WINDOW = 10


def beat_count(fund, bm):
    """Completed calendar years the fund beat its benchmark, and out of how many.

    The denominator is the years both were alive for, never a flat ten: a fund
    with four years on the board that won three of them has done something, and
    printing that as 3 out of 10 would report the eleven months before it
    launched as years it lost. The year in progress is left out on the same
    principle, because it has not finished happening.
    """
    if not bm:
        return None
    won = have = 0
    for field, _label in _calendar_fields()[1:][:BEAT_WINDOW]:
        f_v, b_v = fund.get(field), bm.get(field)
        if f_v is None or b_v is None:
            continue
        have += 1
        won += f_v > b_v
    return {"won": won, "of": have, "window": BEAT_WINDOW} if have else None


def calendar_lookthrough(category, limit=CALENDAR_LIMIT, state=None):
    """A category's leading funds against every calendar year they have.

    A composite says how a fund has done. A row of calendar years says when, and
    the two are different questions: a fund can carry a strong record because it
    was extraordinary in one year and ordinary in nine, and only the row shows
    it. Every year stands on its own scale, because 2020 and 2022 were not the
    same market and colouring them against a common range would say more about
    the years than about the funds.
    """
    state = state or load()
    group = state["byCategory"].get(category, [])
    if not group:
        return {"category": category, "years": [], "funds": []}

    ranked = sorted(group, key=lambda f: (f.get("composite") is None,
                                          -(f.get("composite") or 0)))[:limit]

    years = []
    for field, label in _calendar_fields():
        have = sum(1 for f in ranked if f.get(field) is not None)
        if have >= MIN_YEAR_COVERAGE:
            years.append({"field": field, "label": label, "have": have})

    # The benchmark travels with the table, on the same columns, so a year can
    # be read against the market it happened in rather than only against the
    # other funds in the column.
    name, kind = fw.benchmark_for(category)
    bm = (state.get("benchmarks") or {}).get(name)

    return {
        "category": category,
        "scored": fw.is_scored(category),
        "count": len(group),
        "years": years,
        "funds": [{**row(f),
                   "years": {y["field"]: f.get(y["field"]) for y in years},
                   "beat": beat_count(f, bm)}
                  for f in ranked],
        "benchmark": ({"name": name, "kind": kind,
                       "years": {y["field"]: bm.get(y["field"]) for y in years}}
                      if bm else None),
    }


# The calendar view stops here. Before it the feed carries a few hundred funds
# at most and the columns thin out into a handful of survivors, which reads as a
# record of who was around rather than of who did well.
CALENDAR_FROM = 15


def _calendar_fields():
    """The calendar columns the feed carries, newest first.

    Year to date leads and the years run backwards from it, because the question
    a reader brings to a row of years is what has been happening lately, and a
    table that opens a decade ago makes them scroll to find out.
    """
    return ([("returnCYTD", "YTD")]
            + [(f"returnCY{y:02d}", f"20{y:02d}")
               for y in range(25, CALENDAR_FROM - 1, -1)])


# ---------------------------------------------------------------------------
# Passive
# ---------------------------------------------------------------------------

# A family has to have enough trackers in it for the spread between them to mean
# anything. Below this the "best" is one of two, which is a coin toss dressed up
# as a finding.
MIN_FAMILY = 3

# Longest first: a tracker is judged over the longest window it has, because a
# year of tracking error is noise and five is a record.
_PASSIVE_WINDOWS = (("return5Y", "5Y"), ("return3Y", "3Y"), ("return1Y", "1Y"))

# Two funds tracking one index cannot be this far apart. Cost and tracking error
# together run to a fraction of a percent a year, and a smart beta family with
# different rebalancing dates to perhaps a point or two. A figure this far from
# its own family is an error in the source, not a tracking difference, and
# ranking on it would put a broken row at one end of the table. They are counted
# and named rather than quietly dropped.
IMPLAUSIBLE_GAP = 5.0


def passive_families(state=None, limit=4):
    """Passive schemes grouped by the index each one names, best tracker first.

    There is no alpha to rank a tracker on, and there is no need for one. Two
    funds on the same index are the same product, so the only thing separating
    them is how much of the index they hand back: cost and tracking error, which
    arrive together in the return. The fund at the top of a family is the one
    that gave the investor most of its index, and the spread at the foot of each
    group is what the choice was worth.

    Nothing here crosses families. A Nifty 50 fund ranked against a Nifty Bank
    fund would be ranking two market calls rather than two trackers.
    """
    state = state or load()
    groups = defaultdict(list)
    for f in state["byCategory"].get("Smart beta / Passive", []):
        fam = classify.index_family(f["name"])
        if fam:
            groups[fam].append(f)

    out = []
    for fam, funds in groups.items():
        if len(funds) < MIN_FAMILY:
            continue
        field, label = next(
            ((fld, lab) for fld, lab in _PASSIVE_WINDOWS
             if sum(1 for f in funds if f.get(fld) is not None) >= MIN_FAMILY),
            (None, None))
        if not field:
            continue
        measured = [f for f in funds if f.get(field) is not None]
        mid = _median([f[field] for f in measured])
        ranked, broken = [], []
        for f in measured:
            (broken if abs(f[field] - mid) > IMPLAUSIBLE_GAP else ranked).append(f)
        ranked.sort(key=lambda f: -f[field])
        if len(ranked) < MIN_FAMILY:
            continue
        out.append({
            "index": fam,
            "window": label,
            "field": field,
            "count": len(funds),
            "measured": len(ranked),
            "spread": round(ranked[0][field] - ranked[-1][field], 2),
            "implausible": [{"name": f["name"], "value": f[field]} for f in broken],
            "funds": [row(f) for f in ranked[:limit]],
        })
    # The families a reader is most likely to be choosing inside come first.
    out.sort(key=lambda g: (-g["measured"], g["index"]))
    return out


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
        "effectiveStocks": effective_stocks(v for _, v in top),
    }


def effective_stocks(weights_pct):
    """How many stocks the book behaves like it holds.

    The inverse Herfindahl of the position weights. A book of 200 names where
    ten of them are two thirds of the money does not behave like 200 positions,
    and the count alone will not say so. Equal weights give back the plain
    count; concentration pulls it down.

    This is the number worth reading across a portfolio rather than a fund:
    holding four funds that each own 60 names is not 240 positions, because
    they own many of the same ones.
    """
    ws = [w / 100.0 for w in weights_pct if w and w > 0]
    tot = sum(ws)
    if not ws or tot <= 0:
        return None
    ws = [w / tot for w in ws]                  # the invested book, renormalised
    return round(1.0 / sum(w * w for w in ws), 1)


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
    """Two populations, counted separately.

    The universe is everything the feed carries that is a mutual fund. The
    scored part of it is actively managed equity. Every figure about the model
    below is asked of the scored part only: an evidence median that averaged in
    five hundred index funds the model never tried to score would describe
    nothing at all.
    """
    state = state or load()
    in_model = [f for f in state["funds"] if f.get("scored")]
    scored = [f for f in in_model if f.get("composite") is not None]
    evidence = sorted(f["evidence"] for f in in_model if f.get("evidence") is not None)
    return {
        "universeCount": state["universeCount"],
        "inScope": len(state["funds"]),
        "inModel": len(in_model),
        "scored": len(scored),
        "withHoldings": sum(1 for f in state["funds"] if f.get("_book")),
        "categories": [
            {"name": c,
             "count": len(state["byCategory"].get(c, [])),
             "scoredCategory": fw.is_scored(c),
             "scored": sum(1 for f in state["byCategory"].get(c, [])
                           if f.get("composite") is not None)}
            for c in fw.in_display_order(fw.ALL_CATEGORIES)
        ],
        "bands": {b["code"]: sum(1 for f in state["funds"] if f.get("band") == b["code"])
                  for b in fw.BANDS},
        "notRated": sum(1 for f in in_model if not f.get("rated")),
        "notScored": len(state["funds"]) - len(in_model),
        "minEvidence": fw.MIN_EVIDENCE,
        "amcs": sorted({f["amc"] for f in state["funds"] if f.get("amc")}),
        "marketCycles": state["meta"].get("marketCycles", []),
        "medianEvidence": evidence[len(evidence) // 2] if evidence else None,
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

# The comparison takes as many funds as the reader wants to put in it. Past a
# handful the chart is a thicket and the table scrolls a long way, but that is
# the reader's call to make and not a rule to enforce: a portfolio of twelve is
# a real thing somebody wants to look at. Benchmarks stay at two, because they
# are the backdrop and a third line of grey dashes reads as noise.
MAX_COMPARE_FUNDS = None
MAX_COMPARE_MARKS = 2


def _cap(seq, n):
    return list(seq) if n is None else list(seq)[:n]


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
    funds = [state["byKey"][k] for k in _cap(keys, MAX_COMPARE_FUNDS)
             if k in state["byKey"]]
    return {
        "funds": [{**row(f), "metrics": {k: f.get(k) for k in _COMPARE_METRICS}}
                  for f in funds],
        "marks": [{"id": m, "label": catalogue[m]["label"],
                   "metricsLabel": catalogue[m]["metricsLabel"],
                   "metrics": catalogue[m]["metrics"]}
                  for m in _cap(marks, MAX_COMPARE_MARKS) if m in catalogue],
        "available": compare_marks(state),
        "maxFunds": MAX_COMPARE_FUNDS,
        "maxMarks": MAX_COMPARE_MARKS,
    }


# Above this, two funds are holding a large part of the same book. It is not a
# verdict, it is the level at which a reader should want to know why they own
# both, so the matrix marks it and leaves the judgement alone.
OVERLAP_HEAVY = 40


# What the export carries, beyond the metrics the table shows. A download is
# read away from the screen that produced it, so it takes the identifying
# fields with it rather than a column of anonymous numbers.
_CSV_IDENTITY = (
    ("Category", "category"), ("AMC", "amc"), ("Fund manager", "fundManager"),
    ("Band", "band"), ("Composite", "composite"), ("Evidence", "evidence"),
    ("Rank in category", "categoryRank"), ("Schemes in category", "categoryCount"),
    ("AUM (Rs cr)", "aumCr"), ("Expense ratio %", "ter"),
    ("NAV", "nav"), ("NAV date", "navDate"),
)
_CSV_METRICS = (
    ("Return 3M %", "return3M"), ("Return 6M %", "return6M"),
    ("Return 1Y %", "return1Y"), ("Return 2Y %", "return2Y"),
    ("Return 3Y %", "return3Y"), ("Return 5Y %", "return5Y"),
    ("Return 7Y %", "return7Y"),
    ("Median rolling 3Y %", "medianRolling3Y"),
    ("Median rolling 5Y %", "medianRolling5Y"),
    ("Sharpe 3Y", "sharpe3Y"), ("Sortino 3Y", "sortino3Y"),
    ("Information ratio 3Y", "informationRatio3Y"), ("Beta 3Y", "beta3Y"),
    ("Upside capture 3Y", "upsideCapture3Y"),
    ("Downside capture 3Y", "downsideCapture3Y"),
    ("Max drawdown 3Y %", "maxDrawdown3Y"),
    ("Standard deviation 3Y %", "stdDev3Y"),
    ("Holdings", "holdingCount"), ("Top 10 weight %", "top10"),
    ("Mandate fit", "mandateFit"), ("Differentiation", "differentiation"),
)


def compare_csv(keys, marks=(), period="3y", state=None, weights=None):
    """The whole comparison as rows of a spreadsheet: the schemes and their
    figures, the overlap between every pair, and the rebased series behind the
    chart. Three sections in one file, separated by a blank line and a title,
    because what is on the screen is one comparison and splitting it across
    three downloads only makes the reader reassemble it."""
    state = state or load()
    catalogue = {m["id"]: m for m in compare_marks(state)}
    funds = [state["byKey"][k] for k in _cap(keys, MAX_COMPARE_FUNDS)
             if k in state["byKey"]]
    picked = [m for m in _cap(marks, MAX_COMPARE_MARKS) if m in catalogue]
    g = (portfolio_growth(weights, marks, period, state) if weights
         else compare_growth(keys, marks, period, state))

    out = [["The Filter, compare"],
           ["Built", (state.get("meta") or {}).get("builtAt")]]
    if g.get("start"):
        out.append(["Chart window", g["start"], g["end"]])
    for n in g.get("notes") or []:
        out.append(["Note", n])

    # 1. One row per scheme.
    out += [[], ["Metrics"],
            ["Type", "Name", "Figures from"]
            + [c[0] for c in _CSV_IDENTITY] + [c[0] for c in _CSV_METRICS]]
    if weights:
        shares, total = normalise_weights(weights)
        pm = portfolio_metrics(weights, state) or {}
        out.append(["Portfolio", "Portfolio", "from its own series"]
                   + [None for _ in _CSV_IDENTITY]
                   + [pm.get(k) for _, k in _CSV_METRICS])
    for f in funds:
        w = f" at {round(shares.get(f['key'], 0), 2)}%" if weights else ""
        out.append([("Holding" + w) if weights else "Fund",
                    f["name"], "published record"]
                   + [f.get(k) for _, k in _CSV_IDENTITY]
                   + [f.get(k) for _, k in _CSV_METRICS])
    for mid in picked:
        m = catalogue[mid]
        met = m["metrics"] or {}
        out.append(["Benchmark", m["label"], m["metricsLabel"] or "not published"]
                   + [None for _ in _CSV_IDENTITY]
                   + [met.get(k) for _, k in _CSV_METRICS])

    # 2. Every pair, once.
    if weights:
        lt = look_through(normalise_weights(weights)[0], state)
        out += [[], ["What the portfolio holds"],
                ["Effective holdings", lt["effectiveStocks"]],
                ["Distinct names", lt["distinctStocks"]],
                ["Top 10 weight %", lt["topTen"]]]
        out += [[], ["Combined book, largest 25"], ["Stock", "Weight %"]]
        out += [[r["name"], r["weight"]] for r in lt["stocks"]]
        out += [[], ["Sector exposure"], ["Sector", "Weight %"]]
        out += [[r["sector"], r["weight"]] for r in lt["sectors"]]

    ov = compare_overlap(keys, state)
    if len(ov["funds"]) > 1:
        out += [[], ["Stock overlap, percent of weight held in common"],
                ["Fund", "Fund", "Overlap %"]]
        for i, a in enumerate(ov["funds"]):
            for j, b in enumerate(ov["funds"]):
                if j > i and ov["matrix"][i][j] is not None:
                    out.append([a["name"], b["name"], ov["matrix"][i][j]])

    # 3. The chart itself, at full resolution rather than the points drawn.
    series = _csv_series(keys, picked, g.get("start"), state)
    if weights and g.get("start"):
        line, _ = portfolio_series(normalise_weights(weights)[0], g["start"], state)
        if line:
            series = [("Portfolio", _rebased_map(line, g["start"]))] + series
    if series:
        days = sorted({d for _, pairs in series for d in pairs})
        out += [[], ["Growth of 100 rupees, percent from the start of the window"],
                ["Date"] + [label for label, _ in series]]
        for d in days:
            out.append([d] + [pairs.get(d) for _, pairs in series])
    return out


def _csv_series(keys, marks, start, state):
    """Each line of the chart as {date: percent}, undownsampled. The screen only
    needs the few hundred points it can draw; a spreadsheet wants every one."""
    if not start:
        return []
    navs = state.get("navs") or {}
    out = []
    for k in _cap(keys, MAX_COMPARE_FUNDS):
        f, s = state["byKey"].get(k), (navs.get("funds") or {}).get(k)
        if f and s:
            out.append((f["name"], _rebased_map(s, start)))
    for mid in marks:
        s = (navs.get("indices") or {}).get(mid)
        if s:
            out.append((mid, _rebased_map(s, start)))
    return [(label, pairs) for label, pairs in out if pairs]


def _rebased_map(series, start_iso):
    days, vals = _slice_from(series, start_iso)
    if len(days) < 2 or not vals[0]:
        return {}
    base = vals[0]
    return {d: round(100.0 * (v / base - 1.0), 2) for d, v in zip(days, vals)}


# ---------------------------------------------------------------------------
# Portfolio
# ---------------------------------------------------------------------------
#
# A set of funds with weights against it, read as one holding.

def normalise_weights(weights):
    """Whatever the reader typed, as shares of the whole that sum to 100.

    They may be amounts in rupees or percentages, and percentages typed by hand
    rarely sum to exactly a hundred. Both are the same question once the total
    is divided out, so the shape is taken from the numbers and the units are
    the reader's business.
    """
    clean = {}
    for k, v in (weights or {}).items():
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if f > 0:
            clean[k] = f
    total = sum(clean.values())
    if not total:
        return {}, 0.0
    return {k: 100.0 * v / total for k, v in clean.items()}, total


def _series_at_or_before(days, vals, iso):
    """Step function: the last NAV published on or before this date. A fund that
    did not report on a day has not lost its value, it simply has not published,
    so the portfolio carries the last price forward rather than dropping the day."""
    lo, hi = 0, len(days)
    while lo < hi:
        mid = (lo + hi) // 2
        if days[mid] <= iso:
            lo = mid + 1
        else:
            hi = mid
    i = lo - 1
    return vals[i] if i >= 0 else None


def portfolio_series(weights, start, state=None):
    """The weighted holding as one daily series, indexed to 1.0 at `start`.

    Bought once at the start and held. Each holding's value moves with its own
    NAV and the weights drift from there, which is what actually happens to a
    portfolio nobody rebalances. No rebalancing is assumed because assuming one
    would quietly add a return the investor never earned.
    """
    state = state or load()
    navs = (state.get("navs") or {}).get("funds") or {}
    legs, missing = [], []
    for key, w in weights.items():
        s = navs.get(key)
        base = _series_at_or_before(s["d"], s["v"], start) if s else None
        if not s or not base:
            missing.append(key)
            continue
        legs.append({"key": key, "w": w / 100.0, "s": s, "base": base})
    if not legs:
        return None, missing

    days = sorted({d for leg in legs for d in leg["s"]["d"] if d >= start})
    out = []
    for d in days:
        v = 0.0
        for leg in legs:
            nav = _series_at_or_before(leg["s"]["d"], leg["s"]["v"], d)
            if nav is None:
                v = None
                break
            v += leg["w"] * nav / leg["base"]
        if v is not None:
            out.append((d, v))
    if len(out) < 2:
        return None, missing
    scale = sum(leg["w"] for leg in legs) or 1.0
    return ({"d": [d for d, _ in out], "v": [v / scale for _, v in out]}, missing)


def portfolio_growth(weights, marks=(), period="3y", state=None):
    """The portfolio as one line, its holdings behind it, and any benchmarks.

    The window is set by the holdings exactly as it is for a comparison: a
    portfolio cannot start before the youngest thing in it.
    """
    state = state or load()
    shares, _ = normalise_weights(weights)
    if not shares:
        return {"period": period, "series": [], "notes": [],
                "unavailable": "No weights given."}

    g = compare_growth(list(shares), marks, period, state)
    if not g.get("series"):
        return g
    start = g["start"]
    series, missing = portfolio_series(shares, start, state)
    if not series:
        g["notes"] = list(g.get("notes") or []) + [
            "No NAV history for the holdings, so the portfolio cannot be drawn."]
        return g

    line = _rebased(series, start)
    holdings = [dict(x, code="holding") for x in g["series"] if x["code"] == "fund"]
    marks_ = [x for x in g["series"] if x["code"] == "mark"]
    notes = list(g.get("notes") or [])
    if missing:
        names = [(state["byKey"].get(k) or {}).get("name", k) for k in missing]
        notes.append(f"{', '.join(names)} left out of the line for want of NAV "
                     f"history over this window, so the weights behind it are the "
                     f"rest of the portfolio rescaled.")
    notes.append("Bought once at the start of the window and held, so the weights "
                 "drift with the holdings. No rebalancing is assumed.")

    return {
        **g,
        "series": [{"code": "portfolio", "key": "_portfolio", "label": "Portfolio",
                    **line}] + holdings + marks_,
        "notes": notes,
        "weights": {k: round(v, 2) for k, v in shares.items()},
    }


def portfolio_metrics(weights, state=None):
    """The portfolio's own returns, read off its own series rather than averaged
    off the holdings': averaging point to point returns of things bought on
    different days is not a portfolio return."""
    state = state or load()
    shares, _ = normalise_weights(weights)
    if not shares:
        return None
    navs = (state.get("navs") or {}).get("funds") or {}
    firsts = [navs[k]["d"][0] for k in shares if navs.get(k) and navs[k].get("d")]
    if not firsts:
        return None
    series, _ = portfolio_series(shares, max(firsts), state)
    return _series_metrics(series) if series else None


def compare_overlap(keys, state=None):
    """Pairwise overlap across the selected funds, as a matrix.

    Overlap is the weight the two books hold in common: for every stock, the
    smaller of the two positions, summed. It answers "how much of this am I
    buying twice", which is the question two funds in one portfolio raises.
    """
    state = state or load()
    funds, missing = [], []
    for k in _cap(keys, MAX_COMPARE_FUNDS):
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
    for k in _cap(keys, MAX_COMPARE_FUNDS):
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
    for mid in _cap(marks, MAX_COMPARE_MARKS):
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
