"""Flask blueprint for the screener, served under /api/mf."""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from . import datastore as ds
from . import framework as fw

bp = Blueprint("mf", __name__, url_prefix="/api/mf")


def _f(v):
    try:
        return None if v in (None, "") else float(v)
    except (TypeError, ValueError):
        return None


@bp.get("/meta")
def meta():
    return jsonify(ds.meta_summary())


@bp.get("/framework")
def framework():
    """The whole model as data, so the methodology page is generated from the
    same object the engine scores with and cannot drift away from it."""
    return jsonify({
        "blocks": fw.BLOCKS,
        "categories": fw.CATEGORIES,
        "mandate": fw.MANDATE,
        "aumCurves": {c: fw.aum_curve(c) for c in fw.CATEGORIES},
        "effectiveStocksBand": fw.EFFECTIVE_N_BAND,
        "loosePeerGroups": fw.LOOSE_PEER_GROUPS,
        "bands": fw.BANDS,
        "meaningfulGap": fw.MEANINGFUL_GAP,
        "minEvidence": fw.MIN_EVIDENCE,
        "notRated": fw.NOT_RATED,
        "contextMetrics": fw.CONTEXT_METRICS,
        "process": fw.PROCESS,
        "categoryAdjustments": fw.CATEGORY_ADJUSTMENTS,
        "howToUse": fw.HOW_TO_USE,
        "limits": fw.LIMITS,
        "nextUp": fw.NEXT_UP,
    })


@bp.get("/funds")
def funds():
    """All Funds, with the filters the table needs."""
    state = ds.load()
    rows = state["funds"]

    cat = request.args.get("category")
    if cat and cat != "All":
        rows = [f for f in rows if f.get("category") == cat]
    band = request.args.get("band")
    if band and band != "All":
        rows = [f for f in rows if f.get("band") == band]
    q = (request.args.get("q") or "").strip().lower()
    if q:
        rows = [f for f in rows
                if q in (f.get("name") or "").lower() or q in (f.get("amc") or "").lower()
                or q in (f.get("fundManager") or "").lower()]
    min_aum = _f(request.args.get("minAum"))
    if min_aum is not None:
        rows = [f for f in rows if (_f(f.get("aumCr")) or 0) >= min_aum]
    max_dn = _f(request.args.get("maxDownside"))
    if max_dn is not None:
        rows = [f for f in rows
                if _f(f.get("downsideCapture3Y")) is not None
                and _f(f["downsideCapture3Y"]) <= max_dn]
    if request.args.get("hasHoldings") == "1":
        rows = [f for f in rows if f.get("holdingCount")]

    sort = request.args.get("sort") or "composite"
    reverse = request.args.get("dir", "desc") != "asc"
    rows = sorted(rows, key=lambda f: (f.get(sort) is None,
                                       -(_f(f.get(sort)) or 0) if reverse else (_f(f.get(sort)) or 0)))
    limit = int(request.args.get("limit") or 0)
    total = len(rows)
    if limit:
        rows = rows[:limit]
    return jsonify({"total": total, "funds": [ds.row(f) for f in rows]})


@bp.get("/fund/<key>")
def fund(key):
    state = ds.load()
    f = state["byKey"].get(key)
    if not f:
        return jsonify({"error": "unknown fund", "key": key}), 404
    return jsonify(ds.detail(f, state))


@bp.get("/category/<path:name>")
def category(name):
    state = ds.load()
    if name not in state["byCategory"] and name not in fw.CATEGORIES:
        return jsonify({"error": "unknown category", "category": name}), 404
    return jsonify(ds.category_dossier(name, state))


@bp.get("/shortlists")
def shortlists():
    """Category Top Funds: the shortlist for every category in one payload."""
    state = ds.load()
    out = []
    for c in fw.CATEGORIES:
        group = state["byCategory"].get(c, [])
        if not group:
            continue
        out.append({
            "category": c,
            "mandate": fw.MANDATE.get(c, {}).get("note"),
            "caveat": fw.loose_peer_group(c),
            "count": len(group),
            "funds": [ds.row(f) for f in ds.shortlist(c, state)],
        })
    return jsonify({"categories": out})


@bp.get("/holdings/<key>")
def holdings(key):
    state = ds.load()
    f = state["byKey"].get(key)
    if not f:
        return jsonify({"error": "unknown fund", "key": key}), 404
    book = f.get("_book") or []
    return jsonify({
        "key": key, "name": f["name"], "category": f["category"],
        "stats": {k: f.get(k) for k in
                  ("holdingCount", "effectiveStocks", "top10", "largestPosition",
                   "capMix", "topSectors", "mandateFit", "differentiation",
                   "categoryOverlap")},
        "mandate": fw.MANDATE.get(f["category"], {}),
        "holdings": [{"name": b["name"], "sector": b["sector"], "cap": b["cap"],
                      "weight": round(b["weight"], 2)} for b in book],
    })


@bp.get("/overlap")
def overlap():
    """Pairwise overlap across an arbitrary set of funds."""
    keys = [k for k in (request.args.get("keys") or "").split(",") if k.strip()]
    if len(keys) < 2:
        return jsonify({"error": "pass at least two keys"}), 400
    weights = {k: 1.0 for k in keys}
    lt = ds.look_through(weights)
    return jsonify({"pairs": lt["pairs"], "missing": lt["missing"],
                    "funds": lt["funds"]})


@bp.post("/portfolio")
def portfolio():
    """Look-through for a weighted portfolio: {"weights": {"<key>": pct}}."""
    body = request.get_json(silent=True) or {}
    weights = {k: _f(v) or 0 for k, v in (body.get("weights") or {}).items()}
    weights = {k: v for k, v in weights.items() if v > 0}
    if not weights:
        return jsonify({"error": "pass weights"}), 400
    lt = ds.look_through(weights)

    # Observations rather than pass/fail rules. This model orders a shortlist, it
    # does not run an IPS, so it reports what the combination looks like and
    # leaves the limits to whoever owns the mandate.
    notes = []
    heavy = [p for p in lt["pairs"] if p["overlap"] >= 55]
    if heavy:
        p = heavy[0]
        notes.append(f"{len(heavy)} pair(s) overlap 55 percent or more. The heaviest is "
                     f"{p['aName']} and {p['bName']} at {p['overlap']} percent. Holding "
                     f"both buys one exposure twice.")
    if lt["topTen"] >= 35:
        notes.append(f"The top ten stocks are {lt['topTen']} percent of the combined "
                     f"book. Read the concentration at the portfolio level, not the "
                     f"fund level.")
    if len(lt["funds"]) > 10:
        notes.append(f"{len(lt['funds'])} schemes in one portfolio. Beyond roughly ten, "
                     f"overlap tends to make the whole an expensive index fund.")
    bands = [f["band"] for f in lt["funds"]]
    weak = sum(1 for b in bands if b in ("C", "Review"))
    if weak:
        notes.append(f"{weak} of {len(bands)} schemes sit in band C or Review.")
    lt["notes"] = notes
    return jsonify(lt)


@bp.get("/compare")
def compare():
    """Side by side on blocks and headline metrics."""
    state = ds.load()
    keys = [k for k in (request.args.get("keys") or "").split(",") if k.strip()]
    funds_ = [state["byKey"][k] for k in keys if k in state["byKey"]]
    if not funds_:
        return jsonify({"error": "no known keys"}), 400
    return jsonify({
        "blocks": [{"code": b["code"], "name": b["name"], "weight": b["weight"]}
                   for b in fw.BLOCKS],
        "funds": [{**ds.row(f),
                   "blocks": [{"code": b["code"], "score": b["score"],
                               "coverage": b["coverage"]} for b in f["blocks"]],
                   "whatToWatch": ds.narrative.what_to_watch(f)}
                  for f in funds_],
    })
