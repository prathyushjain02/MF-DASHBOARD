"""Flask blueprint serving the mutual-fund selection dashboard."""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from . import datastore as ds
from . import framework as fw
from . import narrative

bp = Blueprint("mf", __name__, url_prefix="/api/mf")


def _num_arg(name, default=None):
    raw = request.args.get(name)
    if raw in (None, ""):
        return default
    try:
        return float(raw)
    except ValueError:
        return default


@bp.route("/meta")
def meta():
    state = ds.load()
    counts = {}
    for record in state["funds"]:
        counts.setdefault(record["category"], {"total": 0, "eligible": 0, "core": 0})
        counts[record["category"]]["total"] += 1
        if record["gatesPassed"]:
            counts[record["category"]]["eligible"] += 1
        if record["classification"]["tone"] == "core" and record["gatesPassed"]:
            counts[record["category"]]["core"] += 1

    return jsonify({
        "meta": state["meta"],
        "policy": fw.POLICY_META,
        "categories": counts,
        "benchmarks": state["benchmarks"],
        "houseWhitelistCount": len(state["houseWhitelist"]),
        "scoredFunds": len(state["funds"]),
        "eligibleFunds": sum(1 for r in state["funds"] if r["gatesPassed"]),
    })


@bp.route("/framework")
def framework():
    """The policy itself, so every number on screen can be traced to its rule."""
    return jsonify({
        "policy": fw.POLICY_META,
        "principles": fw.PRINCIPLES,
        "approach": fw.APPROACH,
        "categories": fw.CATEGORY_DEFINITIONS,
        "categoryOrder": fw.POLICY_CATEGORIES,
        "gates": fw.GATES,
        "aumFloors": fw.AUM_FLOOR_CR,
        "softFlags": fw.SOFT_FLAGS,
        "pillars": fw.PILLARS,
        "pillarWeights": fw.PILLAR_WEIGHTS,
        "weightRationale": fw.WEIGHT_RATIONALE,
        "parameters": fw.PARAMETERS,
        "effectiveWeights": {c: {k: round(v, 3) for k, v in fw.effective_weights(c).items()}
                             for c in fw.POLICY_CATEGORIES},
        "classificationBands": fw.CLASSIFICATION_BANDS,
        "overlayCap": fw.OVERLAY_CAP,
        "riskCap": {"parameter": fw.RISK_CAP_PARAM, "score": fw.RISK_CAP_SCORE,
                    "label": fw.RISK_CAP_LABEL},
        "quantBands": fw.QUANT_BANDS,
        "whitelistRules": fw.WHITELIST_RULES,
        "guardrails": fw.IPS_GUARDRAILS,
        "cadence": fw.MONITORING_CADENCE,
        "triggers": fw.TRIGGERS,
        "conventions": fw.METHODOLOGY_CONVENTIONS,
        "riskFreeRate": fw.RISK_FREE_RATE,
    })


@bp.route("/funds")
def funds():
    """The scored universe, filtered and sorted server-side."""
    state = ds.load()
    rows = state["funds"]

    category = request.args.get("category")
    if category and category != "all":
        rows = [r for r in rows if r["category"] == category]

    classification = request.args.get("classification")
    if classification and classification != "all":
        rows = [r for r in rows if r["classification"]["label"] == classification]

    if request.args.get("eligibleOnly") == "true":
        rows = [r for r in rows if r["gatesPassed"]]
    if request.args.get("whitelistOnly") == "true":
        rows = [r for r in rows if r.get("onHouseWhitelist")]

    query = (request.args.get("q") or "").strip().lower()
    if query:
        rows = [r for r in rows
                if query in r["name"].lower() or query in (r.get("amc") or "").lower()]

    min_score = _num_arg("minScore")
    if min_score is not None:
        rows = [r for r in rows if r["composite"]["final"] >= min_score]
    min_aum = _num_arg("minAum")
    if min_aum is not None:
        rows = [r for r in rows if (r.get("aumCr") or 0) >= min_aum]
    max_dc = _num_arg("maxDownsideCapture")
    if max_dc is not None:
        rows = [r for r in rows
                if r.get("downsideCapture3Y") is not None
                and r["downsideCapture3Y"] <= max_dc]

    sort = request.args.get("sort", "score")
    reverse = request.args.get("order", "desc") == "desc"

    def sort_key(r):
        if sort == "score":
            return r["composite"]["final"]
        if sort == "name":
            return r["name"].lower()
        if sort in ("aumCr", "ter"):
            return r.get(sort) if r.get(sort) is not None else (-1e18 if reverse else 1e18)
        value = r.get(sort)
        if value is None:
            return -1e18 if reverse else 1e18
        return value

    rows = sorted(rows, key=sort_key, reverse=reverse)

    limit = int(_num_arg("limit", 0) or 0)
    total = len(rows)
    if limit:
        rows = rows[:limit]

    return jsonify({"total": total, "count": len(rows),
                    "funds": [ds._slim(r) for r in rows]})


@bp.route("/fund/<key>")
def fund(key):
    """Full scorecard for one fund — every parameter, its band and its evidence."""
    state = ds.load()
    record = state["byKey"].get(key)
    if not record:
        return jsonify({"error": f"No scored fund with key '{key}'"}), 404

    overlay = _num_arg("overlay")
    if overlay is not None:
        from . import scoring
        comp = scoring.composite(record["scores"], record["category"], overlay)
        classification = scoring.classify_fund(
            comp, record["scores"], record["gatesPassed"], record["failedGates"])
        record = {**record, "composite": comp, "classification": classification}

    weights = fw.effective_weights(record["category"])
    detail = []
    for param in fw.PARAMETERS:
        scored = record["scores"].get(param["code"], {})
        detail.append({
            **param,
            "score": scored.get("score"),
            "sourceType": scored.get("source"),
            "note": scored.get("note"),
            "effectiveWeight": round(weights[param["code"]], 3),
            "earned": round((scored.get("score") or 3) / 5 * weights[param["code"]], 3),
        })

    peers = [r for r in state["funds"]
             if r["category"] == record["category"] and r["gatesPassed"]]
    peers.sort(key=lambda r: -r["composite"]["final"])

    bench = state["benchmarks"].get(record.get("benchmark"))
    return jsonify({
        "fund": ds._slim(record),
        "remark": narrative.build_remark(record, peers, bench),
        "raw": {k: v for k, v in record.items()
                if k not in ("gates", "scores", "composite", "classification",
                             "triggers", "portfolio")},
        "gates": record["gates"],
        "parameters": detail,
        "composite": record["composite"],
        "classification": record["classification"],
        "triggers": record["triggers"],
        "portfolio": record["portfolio"],
        "categoryDefinition": fw.CATEGORY_DEFINITIONS.get(record["category"]),
        "weightRationale": fw.WEIGHT_RATIONALE.get(record["category"]),
        "peers": [{"key": p["key"], "name": p["name"], "amc": p.get("amc"),
                   "score": p["composite"]["final"],
                   "classification": p["classification"]["label"],
                   "downsideCapture3Y": p.get("downsideCapture3Y"),
                   "upsideCapture3Y": p.get("upsideCapture3Y"),
                   "medianRolling3Y": p.get("medianRolling3Y"),
                   "sortino3Y": p.get("sortino3Y"),
                   "maxDrawdown3Y": p.get("maxDrawdown3Y"),
                   "stdDev3Y": p.get("stdDev3Y"), "ter": p.get("ter"),
                   "aumCr": p.get("aumCr"),
                   "isSelf": p["key"] == record["key"]}
                  for p in peers],
        "benchmark": bench,
        "pillarComparison": _pillar_comparison(record, peers),
        "holdingsOverlap": _peer_overlap(state, record, peers),
    })


def _pillar_comparison(record, peers):
    """This fund's pillar scores against the category's median pillar scores."""
    out = {}
    for key in fw.PILLARS:
        mine = record["composite"]["pillars"][key]["pct"]
        vals = sorted(p["composite"]["pillars"][key]["pct"] for p in peers
                      if p["composite"]["pillars"][key]["pct"] is not None)
        out[key] = {
            "name": fw.PILLARS[key]["name"],
            "weight": fw.PILLAR_WEIGHTS[record["category"]][key],
            "fund": mine,
            "categoryMedian": vals[len(vals) // 2] if vals else None,
            "best": vals[-1] if vals else None,
        }
    return out


def _peer_overlap(state, record, peers, top=6):
    """Overlap against the highest-scoring peers — the substitution question.

    Two funds a client could hold together are only diversifying if their books
    differ; this answers that before the allocation is made rather than after.
    """
    if not state["holdings"].get(record["key"]):
        return None
    rows = []
    for peer in peers[:top + 1]:
        if peer["key"] == record["key"] or not state["holdings"].get(peer["key"]):
            continue
        result = ds.overlap(record["key"], peer["key"], state)
        if result:
            rows.append({"key": peer["key"], "name": peer["name"],
                         "score": peer["composite"]["final"],
                         "overlapPct": result["overlapPct"],
                         "commonHoldings": result["commonHoldings"]})
    rows.sort(key=lambda r: -r["overlapPct"])
    return rows[:top]


@bp.route("/whitelist")
def whitelist():
    depth = _num_arg("depth")
    result = ds.build_whitelist(depth_override=int(depth) if depth else None)
    result["house"] = ds.load()["houseWhitelist"]
    return jsonify(result)


@bp.route("/holdings/<key>")
def holdings(key):
    state = ds.load()
    book = state["holdings"].get(key)
    if book is None:
        return jsonify({"error": f"No holdings disclosed for '{key}'"}), 404
    record = state["byKey"].get(key, {})
    return jsonify({
        "key": key,
        "name": record.get("name", key),
        "holdings": [{"security": h.get("s"), "sector": h.get("sec"),
                      "pct": h.get("pct"), "isin": h.get("isin"),
                      "instrument": h.get("ins"), "marketCap": h.get("mc")}
                     for h in book],
        "stats": record.get("portfolio"),
    })


@bp.route("/overlap")
def overlap():
    keys = [k for k in (request.args.get("keys") or "").split(",") if k]
    if len(keys) < 2:
        return jsonify({"error": "Pass at least two fund keys as ?keys=a,b,c"}), 400
    state = ds.load()
    result = ds.overlap_matrix(keys, state)
    if len(keys) == 2:
        result["pair"] = ds.overlap(keys[0], keys[1], state)
    return jsonify(result)


@bp.route("/portfolio", methods=["POST"])
def portfolio():
    """Test a proposed client portfolio against the §10 IPS guardrails."""
    payload = request.get_json(silent=True) or {}
    weights = payload.get("weights") or {}
    if not weights:
        return jsonify({"error": "Post {\"weights\": {\"<fundKey>\": <pct>}}"}), 400
    try:
        weights = {k: float(v) for k, v in weights.items() if float(v) > 0}
    except (TypeError, ValueError):
        return jsonify({"error": "Weights must be numeric"}), 400
    return jsonify(ds.check_guardrails(weights))


@bp.route("/monitoring")
def monitoring():
    """The exception log: every automatable trigger currently firing."""
    state = ds.load()
    scope = request.args.get("scope", "eligible")

    rows = state["funds"]
    if scope == "whitelist":
        rows = [r for r in rows if r.get("onHouseWhitelist")]
    elif scope == "eligible":
        rows = [r for r in rows if r["gatesPassed"]]

    firing = []
    for record in rows:
        for trigger in record["triggers"]:
            firing.append({
                "key": record["key"], "name": record["name"],
                "amc": record.get("amc"), "category": record["category"],
                "score": record["composite"]["final"],
                "classification": record["classification"]["label"],
                "onHouseWhitelist": record.get("onHouseWhitelist", False),
                **trigger,
            })

    order = {"exit": 0, "watch": 1, "review": 2}
    firing.sort(key=lambda t: (order.get(t["severity"], 3), t["score"]))

    return jsonify({
        "scope": scope,
        "count": len(firing),
        "fundsAffected": len({t["key"] for t in firing}),
        "bySeverity": {s: sum(1 for t in firing if t["severity"] == s)
                       for s in ("exit", "watch", "review")},
        "byTrigger": {t["code"]: sum(1 for x in firing if x["code"] == t["code"])
                      for t in fw.TRIGGERS},
        "triggers": firing,
        "cadence": fw.MONITORING_CADENCE,
        "catalogue": fw.TRIGGERS,
    })


@bp.route("/category/<path:category>")
def category(category):
    """Category dossier: definition, weights, peer distribution, league table."""
    state = ds.load()
    if category not in fw.CATEGORY_DEFINITIONS:
        return jsonify({"error": f"'{category}' is not a policy category"}), 404

    members = [r for r in state["funds"] if r["category"] == category]
    eligible = [r for r in members if r["gatesPassed"]]

    def spread(field):
        vals = sorted(r[field] for r in eligible if r.get(field) is not None)
        if not vals:
            return None
        n = len(vals)
        return {"min": vals[0], "p25": vals[n // 4], "median": vals[n // 2],
                "p75": vals[(3 * n) // 4], "max": vals[-1], "n": n}

    return jsonify({
        "category": category,
        "definition": fw.CATEGORY_DEFINITIONS[category],
        "pillarWeights": fw.PILLAR_WEIGHTS[category],
        "weightRationale": fw.WEIGHT_RATIONALE.get(category),
        "effectiveWeights": {k: round(v, 3) for k, v in fw.effective_weights(category).items()},
        "aumFloor": fw.AUM_FLOOR_CR.get(category),
        "universe": len(members),
        "eligible": len(eligible),
        "gateFailures": {g["code"]: sum(1 for r in members if g["code"] in r["failedGates"])
                         for g in fw.GATES},
        "spreads": {f: spread(f) for f in
                    ("medianRolling3Y", "downsideCapture3Y", "stdDev3Y",
                     "sortino3Y", "maxDrawdown3Y", "ter", "aumCr")},
        "funds": [ds._slim(r) for r in members],
        "benchmark": state["benchmarks"].get(
            (members[0].get("benchmark") if members else None)),
    })


@bp.route("/reload", methods=["POST"])
def reload_data():
    state = ds.load(force=True)
    return jsonify({"reloaded": True, "funds": len(state["funds"])})
