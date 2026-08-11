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
    "return1Y", "return3Y", "return5Y", "medianRolling3Y", "medianRolling5Y",
    "sharpe3Y", "sortino3Y", "informationRatio3Y", "treynor3Y",
    "upsideCapture3Y", "downsideCapture3Y", "maxDrawdown3Y",
    "stdDev3Y", "semiStdDev3Y", "beta3Y", "ter",
    "decile3Y", "decile5Y", "vintageYears", "managerYears", "managerCycles",
    "effectiveStocks", "top10", "holdingCount", "mandateFit", "differentiation",
    "categoryOverlap", "capMix", "hasHoldings", "loosePeerGroup", "cashPct",
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
    rec["peers"] = category_comparison(fund, state)
    rec["closest"] = closest_books(fund, state, limit=5)
    rec["holdings"] = top_holdings(fund, limit=15)
    return rec


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
        "effectiveStocksBand": fw.EFFECTIVE_N_BAND.get(category),
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
    """Live figures for each node of the selection process.

    The page states what this build actually knows rather than what the process
    aspires to, so the numbers are read off the scored universe every request
    instead of being written into the copy.
    """
    state = state or load()
    funds = state["funds"]
    rated = [f for f in funds if f.get("rated")]
    n = len(funds)

    def block_median(code):
        return _median([f["blockScore"].get(code) for f in rated])

    caps = sum(1 for f in funds
               if any(x["code"] == "capacity" for x in f.get("flags", [])))
    new_mgr = sum(1 for f in funds
                  if any(x["code"] == "new-manager" for x in f.get("flags", [])))
    no_mgr = sum(1 for f in funds if f.get("managerYears") is None)
    mgr_count = _median([len(f.get("managers") or []) or None for f in funds])

    return {
        "performance": {
            "headline": f"{_coverage(funds, 'medianRolling3Y')}%",
            "caption": "of the universe carries a three year rolling record",
            "rows": [
                ["Funds with a 10 year rolling record",
                 f"{sum(1 for f in funds if f.get('medianRolling10Y') is not None)} of {n}"],
                ["Median rolling 3Y across rated funds",
                 f"{_median([f.get('medianRolling3Y') for f in rated])}%"],
                ["Median share of 3Y windows beating the benchmark",
                 f"{_median([f.get('rollingHitRate3Y') for f in rated])}%"],
                ["Median downside capture",
                 f"{_median([f.get('downsideCapture3Y') for f in rated])}"],
            ],
        },
        "aum": {
            "headline": f"{caps}",
            "caption": "funds carry a size or capacity flag on their category curve",
            "rows": [
                ["Median AUM across rated funds",
                 f"INR {_median([f.get('aumCr') for f in rated]):,.0f} cr"
                 if _median([f.get('aumCr') for f in rated]) else "n/a"],
                ["Largest fund in the universe",
                 f"INR {max((f.get('aumCr') or 0) for f in funds):,.0f} cr"],
                ["Distinct AUM curves in use", "6, one per category shape"],
                ["Median AUM block score", f"{block_median('aum')} of 100"],
            ],
        },
        "quant": {
            "headline": f"{state and len([m for b in fw.BLOCKS for m in b['metrics'] if m['weight']])}",
            "caption": "weighted metrics behind the score",
            "rows": [
                ["Horizons scored", "3Y, 5Y, 7Y and 10Y wherever published"],
                ["Median Information Ratio 3Y",
                 f"{_median([f.get('informationRatio3Y') for f in rated])}"],
                ["Funds with a disclosed book",
                 f"{sum(1 for f in funds if f.get('holdingCount'))} of {n}"],
                ["Median overlap with the category book",
                 f"{_median([f.get('categoryOverlap') for f in rated])}%"],
            ],
        },
        "fmType": {
            "headline": f"{_coverage(funds, 'managerYears')}%",
            "caption": "of the universe has named managers with dated tenure on file",
            "rows": [
                ["Median managers per scheme", f"{mgr_count:.0f}" if mgr_count else "n/a"],
                ["Funds with no manager record", f"{no_mgr} of {n}"],
                ["In-house against bought-in research", "Not in any feed"],
            ],
        },
        "attitude": {
            "headline": "0%",
            "caption": "of the score rests on this, because none of it is measurable",
            "rows": [
                ["Weight carried in the composite", "None"],
                ["Where it belongs", "The written view, and the meeting note behind it"],
            ],
        },
        "stability": {
            "headline": f"{new_mgr}",
            "caption": "funds flagged New Manager, under three years on the scheme",
            "rows": [
                ["Median tenure of the longest serving manager",
                 f"{_median([f.get('managerYears') for f in funds])} yrs"],
                ["Median market cycles run",
                 f"{_median([f.get('managerCycles') for f in funds])}"],
                ["Team exits and incentive structure", "An analyst's call"],
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
