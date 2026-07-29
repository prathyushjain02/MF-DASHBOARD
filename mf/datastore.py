"""Loads the built dataset, runs the engine once, and serves derived views.

Everything downstream of the ETL is computed here: the scored universe, the
framework-constructed whitelist (§9), holdings overlap analytics, and the
IPS-guardrail check (§10).
"""

from __future__ import annotations

import json
import os
import threading
from collections import defaultdict

from . import framework as fw
from . import scoring

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

_lock = threading.Lock()
_state = None


def _read(name, fallback):
    path = os.path.join(DATA_DIR, name)
    if not os.path.exists(path):
        return fallback
    with open(path) as fh:
        return json.load(fh)


def load(force=False):
    """Load and evaluate. Thread-safe, computed once per process."""
    global _state
    with _lock:
        if _state is not None and not force:
            return _state

        funds = _read("funds.json", [])
        benchmarks = _read("benchmarks.json", {})
        holdings = _read("holdings.json", {})
        whitelist = _read("whitelist.json", [])
        meta = _read("meta.json", {})

        evaluated = scoring.evaluate_universe(funds, benchmarks, holdings)
        by_key = {r["key"]: r for r in evaluated}

        _state = {
            "meta": meta,
            "funds": evaluated,
            "byKey": by_key,
            "holdings": holdings,
            "benchmarks": benchmarks,
            "houseWhitelist": whitelist,
            "categories": sorted({r["category"] for r in evaluated}),
        }
        return _state


# --------------------------------------------------------------------------- #
# §9 — whitelist construction
# --------------------------------------------------------------------------- #

def build_whitelist(state=None, depth_override=None):
    """Construct the whitelist rather than accumulate it (§9).

    Six rules govern construction. Three are machine-enforceable from this data —
    depth, the two-funds-per-AMC-per-category cap, and the 25% AMC share of the
    full whitelist. Cooling-in, re-entry lockout and tax-aware exits need decision
    history, so they are reported as standing obligations instead of applied.
    """
    state = state or load()
    candidates = defaultdict(list)
    for record in state["funds"]:
        if not record["gatesPassed"]:
            continue
        # Classification produces candidates; only Core and Satellite are eligible.
        if record["classification"]["tone"] not in ("core", "satellite"):
            continue
        candidates[record["category"]].append(record)

    selected, notes = [], []
    amc_counts = defaultdict(int)

    for category in fw.POLICY_CATEGORIES:
        pool = sorted(candidates.get(category, []),
                      key=lambda r: -r["composite"]["final"])
        if not pool:
            notes.append({"category": category, "type": "empty",
                          "message": "No fund cleared the gates and reached Satellite "
                                     "or better this cycle."})
            continue

        lo, hi = fw.CATEGORY_DEFINITIONS[category]["depth"]
        target = depth_override or hi
        picked, per_amc = [], defaultdict(int)

        for record in pool:
            if len(picked) >= target:
                break
            amc = record.get("amc") or "Unattributed"
            if per_amc[amc] >= fw.MAX_FUNDS_PER_AMC_PER_CATEGORY:
                notes.append({
                    "category": category, "type": "amc_cap", "fund": record["name"],
                    "message": f"Skipped — {amc} already has "
                               f"{fw.MAX_FUNDS_PER_AMC_PER_CATEGORY} funds in this "
                               f"category (rank {record['categoryRank']}, score "
                               f"{record['composite']['final']:.1f})."})
                continue
            per_amc[amc] += 1
            amc_counts[amc] += 1
            picked.append(record)

        if len(picked) < lo:
            notes.append({
                "category": category, "type": "under_depth",
                "message": f"Only {len(picked)} fund(s) admitted against a depth "
                           f"guideline of {lo}–{hi}. Depth is a guideline, not a "
                           f"quota — an empty slot beats a weak fund."})
        selected.extend(picked)

    # The 25% single-AMC ceiling across the whole whitelist.
    total = len(selected) or 1
    amc_share = [{"amc": amc, "count": n, "pct": round(n / total * 100, 1),
                  "breach": n / total * 100 > fw.MAX_AMC_SHARE_OF_WHITELIST}
                 for amc, n in sorted(amc_counts.items(), key=lambda kv: -kv[1])]

    house_keys = {e["key"] for e in state["houseWhitelist"]}
    framework_keys = {r["key"] for r in selected}
    amc_capped = {n["fund"] for n in notes if n["type"] == "amc_cap"}

    return {
        "funds": [_slim(r) for r in selected],
        "count": len(selected),
        "byCategory": {c: sum(1 for r in selected if r["category"] == c)
                       for c in fw.POLICY_CATEGORIES},
        "amcConcentration": amc_share,
        "notes": notes,
        "standingRules": [r for r in fw.WHITELIST_RULES
                          if r["rule"] in ("Cooling-in", "Re-entry lockout",
                                           "Tax-aware exits", "Share class")],
        "reconciliation": reconcile(state, framework_keys, house_keys, amc_capped),
    }


def reconcile(state, framework_keys, house_keys, amc_capped=()):
    """Compare the framework's output against the live house whitelist.

    For a house-only fund the useful answer is not its classification but the
    specific rule that kept it off the constructed list — a failed gate, the
    two-per-AMC cap, or simply being ranked below the category's depth.
    """
    by_key = state["byKey"]

    def why_excluded(record):
        if not record["gatesPassed"]:
            gates = {g["code"]: g for g in record["gates"]}
            reasons = [f"{c} {gates[c]['name']}: {gates[c]['detail']}"
                       for c in record["failedGates"] if c in gates]
            return "Rejected at Stage 1 — " + "; ".join(reasons)
        tone = record["classification"]["tone"]
        if tone not in ("core", "satellite"):
            return (f"Classified {record['classification']['label']} "
                    f"({record['composite']['final']:.1f}) — not a whitelist candidate")
        if record["name"] in amc_capped:
            return (f"Eligible and well scored, but {record.get('amc')} already had two "
                    f"funds in {record['category']} — the per-AMC cap held it out")
        depth = fw.CATEGORY_DEFINITIONS[record["category"]]["depth"][1]
        return (f"Ranked {record.get('categoryRank')} of {record.get('categoryCount')} "
                f"eligible in {record['category']}; depth guidance stops at {depth}")

    def describe(key, source):
        record = by_key.get(key)
        entry = next((e for e in state["houseWhitelist"] if e["key"] == key), None)
        if not record:
            return {"key": key, "name": (entry or {}).get("name", key),
                    "category": (entry or {}).get("category"),
                    "source": source, "score": None,
                    "reason": "Not present in the quantitative feed — scored manually."}
        cls = record["classification"]
        return {
            "key": key, "name": record["name"], "category": record["category"],
            "amc": record.get("amc"), "source": source,
            "score": record["composite"]["final"],
            "classification": cls["label"],
            "categoryRank": record.get("categoryRank"),
            "categoryCount": record.get("categoryCount"),
            "failedGates": record["failedGates"],
            "reason": why_excluded(record) if source == "house" else (cls["reason"] or cls["label"]),
        }

    return {
        "both": [describe(k, "both") for k in sorted(framework_keys & house_keys)],
        "frameworkOnly": sorted(
            [describe(k, "framework") for k in framework_keys - house_keys],
            key=lambda d: -(d["score"] or 0)),
        "houseOnly": sorted(
            [describe(k, "house") for k in house_keys - framework_keys],
            key=lambda d: -(d["score"] or 0)),
    }


def _slim(record):
    """The fund shape the dashboard lists — full detail comes from /fund/<key>."""
    return {
        "key": record["key"], "name": record["name"], "amc": record.get("amc"),
        "category": record["category"], "amfiCode": record.get("amfiCode"),
        "aumCr": record.get("aumCr"), "ter": record.get("ter"),
        "benchmark": record.get("benchmark"),
        "fundManager": record.get("fundManager"),
        "score": record["composite"]["final"],
        "rawScore": record["composite"]["raw"],
        "overlay": record["composite"]["overlay"],
        "pillars": record["composite"]["pillars"],
        "classification": record["classification"],
        "gatesPassed": record["gatesPassed"],
        "failedGates": record["failedGates"],
        "manualGates": record["manualGates"],
        "categoryRank": record.get("categoryRank"),
        "categoryCount": record.get("categoryCount"),
        "triggerCount": len(record["triggers"]),
        "triggers": record["triggers"],
        "evidence": record["evidence"],
        "onHouseWhitelist": record.get("onHouseWhitelist", False),
        "hasHoldings": record.get("hasHoldings", False),
        "metrics": {
            "medianRolling3Y": record.get("medianRolling3Y"),
            "return1Y": record.get("return1Y"),
            "return3Y": record.get("return3Y"),
            "return5Y": record.get("return5Y"),
            "sharpe3Y": record.get("sharpe3Y"),
            "sortino3Y": record.get("sortino3Y"),
            "informationRatio3Y": record.get("informationRatio3Y"),
            "stdDev3Y": record.get("stdDev3Y"),
            "maxDrawdown3Y": record.get("maxDrawdown3Y"),
            "downsideCapture3Y": record.get("downsideCapture3Y"),
            "upsideCapture3Y": record.get("upsideCapture3Y"),
            "captureRatio3Y": record.get("captureRatio3Y"),
            "beta3Y": record.get("beta3Y"),
            "alpha": record.get("alpha"),
        },
        "portfolio": ({"top10": record["portfolio"]["top10"],
                       "holdingCount": record["portfolio"]["holdingCount"],
                       "topSector": record["portfolio"]["topSector"],
                       "capSplit": record["portfolio"].get("capSplit")}
                      if record.get("portfolio") else None),
    }


# --------------------------------------------------------------------------- #
# holdings overlap (§10 — 'beyond roughly ten, overlap makes the portfolio an
# expensive index fund')
# --------------------------------------------------------------------------- #

def _equity_book(state, key):
    """{security: weight} for the equity sleeve of one fund."""
    book = state["holdings"].get(key) or []
    out = defaultdict(float)
    for h in book:
        sector = (h.get("sec") or "").lower()
        if sector in scoring.CASH_SECTORS:
            continue
        name = h.get("s")
        if name:
            out[name] += float(h.get("pct") or 0)
    return dict(out)


def overlap(key_a, key_b, state=None):
    """Weight-based overlap between two funds: Σ min(w_a, w_b) over common names."""
    state = state or load()
    a, b = _equity_book(state, key_a), _equity_book(state, key_b)
    if not a or not b:
        return None
    common = set(a) & set(b)
    score = sum(min(a[n], b[n]) for n in common)
    shared = sorted(({"security": n, "a": round(a[n], 2), "b": round(b[n], 2),
                      "min": round(min(a[n], b[n]), 2)} for n in common),
                    key=lambda d: -d["min"])
    return {
        "overlapPct": round(score, 2),
        "commonHoldings": len(common),
        "countA": len(a), "countB": len(b),
        "topShared": shared[:15],
    }


def overlap_matrix(keys, state=None):
    """Pairwise overlap across a set of funds, plus the look-through book."""
    state = state or load()
    keys = [k for k in keys if state["holdings"].get(k)]
    matrix = []
    for i, a in enumerate(keys):
        row = []
        for j, b in enumerate(keys):
            if i == j:
                row.append(100.0)
            elif j < i:
                row.append(matrix[j][i])
            else:
                result = overlap(a, b, state)
                row.append(result["overlapPct"] if result else None)
        matrix.append(row)
    return {
        "keys": keys,
        "names": [state["byKey"][k]["name"] if k in state["byKey"] else k for k in keys],
        "matrix": matrix,
    }


def look_through(weights, state=None):
    """Aggregate a client portfolio to stock and sector level.

    `weights` maps a fund key to its share of the equity portfolio (%).
    """
    state = state or load()
    stocks, sectors = defaultdict(float), defaultdict(float)
    caps = defaultdict(float)
    covered = 0.0

    for key, w in weights.items():
        book = state["holdings"].get(key)
        if not book:
            continue
        covered += w
        for h in book:
            pct = float(h.get("pct") or 0) * w / 100.0
            sector = h.get("sec") or "Unclassified"
            if sector.lower() in scoring.CASH_SECTORS:
                sectors["Cash & equivalents"] += pct
                continue
            stocks[h.get("s") or "Unnamed"] += pct
            sectors[sector] += pct
            if h.get("mc"):
                caps[h["mc"]] += pct

    top = sorted(stocks.items(), key=lambda kv: -kv[1])
    return {
        "coveragePct": round(covered, 1),
        "distinctStocks": len(stocks),
        "topStocks": [{"security": n, "pct": round(p, 2)} for n, p in top[:30]],
        "top10Pct": round(sum(p for _, p in top[:10]), 2),
        "sectors": [{"name": n, "pct": round(p, 2)}
                    for n, p in sorted(sectors.items(), key=lambda kv: -kv[1])],
        "capSplit": {k: round(v, 2) for k, v in sorted(caps.items(), key=lambda kv: -kv[1])},
    }


# --------------------------------------------------------------------------- #
# §10 — IPS guardrail check
# --------------------------------------------------------------------------- #

def check_guardrails(weights, state=None):
    """Test a proposed client portfolio against the IPS-layer guardrails."""
    state = state or load()
    rows = []
    for key, w in weights.items():
        record = state["byKey"].get(key)
        if not record:
            continue
        rows.append({
            "key": key, "name": record["name"], "weight": w,
            "amc": record.get("amc") or "Unattributed",
            "category": record["category"],
            "classification": record["classification"]["label"],
            "tone": record["classification"]["tone"],
            "score": record["composite"]["final"],
        })

    total = sum(r["weight"] for r in rows) or 1.0
    by_amc = defaultdict(float)
    for r in rows:
        by_amc[r["amc"]] += r["weight"]

    core = sum(r["weight"] for r in rows
               if r["category"] in fw.CORE_CATEGORIES and r["tone"] == "core")
    satellite = sum(r["weight"] for r in rows if r["category"] in fw.SATELLITE_CATEGORIES)
    tactical = sum(r["weight"] for r in rows if r["category"] in fw.TACTICAL_CATEGORIES)
    worst_amc = max(by_amc.items(), key=lambda kv: kv[1], default=("—", 0.0))
    worst_scheme = max(rows, key=lambda r: r["weight"], default=None)

    def pct(v):
        return round(v / total * 100, 1)

    checks = []
    for rule in fw.IPS_GUARDRAILS:
        test = rule.get("test")
        if test == "amc_max":
            actual, ok = pct(worst_amc[1]), pct(worst_amc[1]) <= rule["limit"]
            detail = f"Largest AMC exposure: {worst_amc[0]} at {actual}%"
        elif test == "scheme_max":
            actual = pct(worst_scheme["weight"]) if worst_scheme else 0
            ok = actual <= rule["limit"]
            detail = (f"Largest scheme: {worst_scheme['name']} at {actual}%"
                      if worst_scheme else "No schemes")
        elif test == "core_floor":
            actual, ok = pct(core), pct(core) >= rule["limit"]
            detail = f"Core-classified Large / Flexi / L&M / ELSS: {actual}%"
        elif test == "satellite_cap":
            actual, ok = pct(satellite), pct(satellite) <= rule["limit"]
            detail = f"Mid + Small + Focused + Value + Multi: {actual}%"
        elif test == "tactical_cap":
            actual, ok = pct(tactical), pct(tactical) <= rule["limit"]
            detail = f"Sectoral / Thematic: {actual}%"
        elif test == "fund_count":
            actual, ok = len(rows), 6 <= len(rows) <= rule["limit"]
            detail = f"{len(rows)} schemes"
        else:
            checks.append({**rule, "status": "manual",
                           "detail": "Assessed against the client's IPS bands at review."})
            continue
        checks.append({**rule, "status": "pass" if ok else "breach",
                       "actual": actual, "detail": detail})

    return {
        "holdings": sorted(rows, key=lambda r: -r["weight"]),
        "totalWeight": round(total, 1),
        "checks": checks,
        "breaches": [c for c in checks if c["status"] == "breach"],
        "amcExposure": [{"amc": a, "pct": pct(w)}
                        for a, w in sorted(by_amc.items(), key=lambda kv: -kv[1])],
        "lookThrough": look_through({r["key"]: r["weight"] for r in rows}, state),
        "overlap": overlap_matrix([r["key"] for r in rows], state),
    }
