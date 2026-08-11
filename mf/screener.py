"""The screener engine.

Turns a universe of fund records into scored, ranked, banded output following
`mf/framework.py`.

The shape of the model:

    raw metric  ->  0-100 metric score  ->  block score  ->  composite  ->  band

Metric scores use one of four scales, chosen per metric in the framework:

    percentile   rank within the fund's own category, ties share the mid rank.
                 Used for everything comparative: returns, ratios, capture.
    curve        a piecewise-linear map from the raw value to 0-100. Used for
                 AUM, where the shape differs by category and "good" is not
                 simply "more".
    band         distance from a target band, so both ends are marked down. Used
                 for the effective number of stocks.
    absolute     the raw value is already a meaningful 0-100. Used for mandate
                 fit, where full compliance means 100 and nothing else does.

Missing data is never filled with a neutral middle value. A block reweights over
the metrics it actually has, the composite reweights over the blocks that
scored, and every fund reports the share of the model's weight that was
evidenced. A gap narrows the evidence base; it does not nudge a fund toward the
median.
"""

from __future__ import annotations

from collections import defaultdict

from . import framework as fw

RF = 0.07  # risk free, used only where a ratio has to be reconstructed


def _f(v):
    """Coerce to float, treating blanks and junk as absent."""
    if v is None or v == "" or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if f != f else f  # NaN


# ---------------------------------------------------------------------------
# Scales
# ---------------------------------------------------------------------------

def percentile(value, population, direction="high"):
    """Percentile of `value` within `population`, 0-100, ties sharing a mid rank.

    Returns None if there is nothing to compare against. A single-fund category
    would otherwise hand that fund a 50 or a 100 out of thin air.
    """
    vals = [v for v in population if v is not None]
    if value is None or len(vals) < 3:
        return None
    below = sum(1 for v in vals if v < value)
    equal = sum(1 for v in vals if v == value)
    pct = 100.0 * (below + 0.5 * equal) / len(vals)
    return pct if direction == "high" else 100.0 - pct


def curve_score(value, points):
    """Piecewise-linear interpolation over (x, score) points, flat outside."""
    if value is None:
        return None
    pts = sorted(points)
    if value <= pts[0][0]:
        return float(pts[0][1])
    if value >= pts[-1][0]:
        return float(pts[-1][1])
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= value <= x1:
            if x1 == x0:
                return float(y0)
            t = (value - x0) / (x1 - x0)
            return float(y0 + t * (y1 - y0))
    return float(pts[-1][1])


def band_score(value, low, high):
    """100 inside the band, decaying either side. Both ends are marked down:
    an over-diversified book and an over-concentrated one are each a departure
    from what the mandate implies."""
    if value is None:
        return None
    if low <= value <= high:
        return 100.0
    if value < low:
        span = max(low * 0.6, 1e-9)
        return max(0.0, 100.0 * (1 - (low - value) / span))
    span = max(high * 1.2, 1e-9)
    return max(0.0, 100.0 * (1 - (value - high) / span))


# ---------------------------------------------------------------------------
# Portfolio metrics, derived from the holdings book
# ---------------------------------------------------------------------------

_CAP_KEYS = {"large cap": "large", "mid cap": "mid", "small cap": "small"}
_NON_EQUITY = ("treps", "net receivable", "net payable", "cash", "reverse repo",
               "clearing corporation", "triparty")


def equity_book(rows):
    """The invested equity sleeve, renormalised to 100.

    Cash, TREPS and receivables are dropped first, so concentration and overlap
    are read on the money actually at work rather than diluted by cash.
    """
    book = []
    for r in rows or []:
        name = (r.get("s") or "").strip()
        if not name:
            continue
        low = name.lower()
        if any(tok in low for tok in _NON_EQUITY):
            continue
        ins = (r.get("ins") or "").strip().lower()
        if ins and ins not in ("equity", "equity shares", "share", "shares"):
            continue
        w = _f(r.get("pct"))
        if w is None or w <= 0:
            continue
        book.append({"name": name, "sector": r.get("sec") or "Unclassified",
                     "cap": _CAP_KEYS.get((r.get("mc") or "").strip().lower()),
                     "weight": w, "isin": r.get("isin")})
    total = sum(b["weight"] for b in book)
    if total <= 0:
        return []
    for b in book:
        b["weight"] = 100.0 * b["weight"] / total
    book.sort(key=lambda b: -b["weight"])
    return book


def portfolio_stats(book, category):
    """Concentration, cap mix and mandate fit for one fund's book."""
    if not book:
        return {}
    ws = [b["weight"] / 100.0 for b in book]
    hhi = sum(w * w for w in ws)
    caps = defaultdict(float)
    for b in book:
        if b["cap"]:
            caps[b["cap"]] += b["weight"]
    sectors = defaultdict(float)
    for b in book:
        sectors[b["sector"]] += b["weight"]
    top_sectors = sorted(sectors.items(), key=lambda kv: -kv[1])[:3]

    bands = fw.MANDATE.get(category, {}).get("bands", {})
    shortfalls = []
    for bucket, (lo, _hi) in bands.items():
        have = caps.get(bucket, 0.0)
        if have + 0.5 < lo:  # half a point of tolerance for disclosure rounding
            shortfalls.append({"bucket": bucket, "required": lo, "actual": round(have, 1)})
    penalty = sum(min(100.0, s["required"] - s["actual"]) for s in shortfalls)
    mandate_fit = max(0.0, 100.0 - penalty) if bands else 100.0

    return {
        "holdingCount": len(book),
        "effectiveStocks": round(1.0 / hhi, 1) if hhi > 0 else None,
        "top10": round(sum(b["weight"] for b in book[:10]), 1),
        "largestPosition": round(book[0]["weight"], 2),
        "capMix": {k: round(v, 1) for k, v in caps.items()},
        "topSectors": [{"sector": s, "weight": round(w, 1)} for s, w in top_sectors],
        "mandateFit": round(mandate_fit, 1),
        "mandateShortfalls": shortfalls,
    }


def category_book(books):
    """The average book of a category: mean weight per stock across its funds.

    This is what 'differentiation' is measured against. It is the portfolio you
    would hold by owning the whole category, so overlap against it is the share
    of a fund that is not a differentiated position.
    """
    agg = defaultdict(float)
    n = max(1, len(books))
    for book in books:
        for b in book:
            agg[b["name"]] += b["weight"]
    return {k: v / n for k, v in agg.items()}


def overlap_with(book, other):
    """Sum of min(weight) over shared names, 0-100."""
    if not book or not other:
        return None
    return round(sum(min(b["weight"], other.get(b["name"], 0.0)) for b in book), 1)


def pairwise_overlap(a, b):
    if not a or not b:
        return None
    bw = {x["name"]: x["weight"] for x in b}
    return round(sum(min(x["weight"], bw.get(x["name"], 0.0)) for x in a), 1)


# ---------------------------------------------------------------------------
# Derived inputs
# ---------------------------------------------------------------------------

def derive_inputs(fund, holdings_rows):
    """Everything the blocks need that is not already a field on the record."""
    out = {}

    # Vintage. The feed carries no inception date, so the live record is read off
    # the longest return series present. That makes it a bucket, not a precise
    # age, and it is reported as such rather than dressed up with decimals.
    for horizon, years in ((("return5Y",), 5.0), (("return3Y",), 3.0),
                           (("return2Y",), 2.0), (("return1Y",), 1.0)):
        if any(_f(fund.get(h)) is not None for h in horizon):
            out["vintageYears"] = years
            out["vintageBasis"] = f"at least {years:.0f}Y of live record evidenced"
            break
    else:
        out["vintageYears"] = None
        out["vintageBasis"] = "no return series in the feed"

    # Manager tenure and cycles are analyst inputs. If nobody has supplied them
    # the metrics stay absent and the manager block reports as unscored.
    for f in ("managerYears", "managerExperienceYears", "managerCycles"):
        v = _f(fund.get(f))
        if v is not None:
            out[f] = v

    book = equity_book(holdings_rows)
    out["_book"] = book
    out.update(portfolio_stats(book, fund.get("category")))
    return out


def add_deciles(funds):
    """Category deciles on 3Y and 5Y CAGR. Decile 1 is the best."""
    by_cat = defaultdict(list)
    for f in funds:
        by_cat[f.get("category")].append(f)
    for cat, group in by_cat.items():
        for src, dst in (("return3Y", "decile3Y"), ("return5Y", "decile5Y")):
            vals = sorted((v for v in (_f(f.get(src)) for f in group)
                           if v is not None), reverse=True)
            for f in group:
                v = _f(f.get(src))
                if v is None or not vals:
                    f[dst] = None
                    continue
                better = sum(1 for x in vals if x > v)
                f[dst] = max(1, min(10, int(better * 10 / len(vals)) + 1))


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def score_universe(funds, holdings):
    """Score every fund. Mutates and returns the list."""
    in_scope = [f for f in funds if f.get("category") in fw.CATEGORIES]

    # Derived inputs first: the category book needs every fund's book in hand
    # before differentiation can be measured for any of them.
    by_cat = defaultdict(list)
    for f in in_scope:
        f.update(derive_inputs(f, holdings.get(f["key"])))
        by_cat[f["category"]].append(f)

    for cat, group in by_cat.items():
        cbook = category_book([f["_book"] for f in group if f.get("_book")])
        # In a category that is a label rather than a peer group, "differentiation
        # versus the category book" is trivially high for everyone and measures the
        # spread of themes, not the manager. It is left unscored there, and the
        # portfolio block reweights over its remaining metrics.
        loose = fw.loose_peer_group(cat)
        for f in group:
            ov = overlap_with(f.get("_book"), cbook)
            f["categoryOverlap"] = ov
            f["loosePeerGroup"] = loose
            f["differentiation"] = (None if ov is None or loose
                                    else round(100.0 - ov, 1))

    add_deciles(in_scope)

    # Metric scores, then blocks, then composite.
    for cat, group in by_cat.items():
        pops = {}
        for block in fw.BLOCKS:
            for m in block["metrics"]:
                if m["direction"] in ("high", "low"):
                    pops[m["field"]] = [_f(f.get(m["field"])) for f in group]
        for f in group:
            _score_fund(f, pops)

    _rank(in_scope)
    return in_scope


def _metric_score(fund, m, pops):
    field, direction = m["field"], m["direction"]
    raw = _f(fund.get(field))
    if direction in ("high", "low"):
        return raw, percentile(raw, pops.get(field, []), direction), "percentile"
    if direction == "curve":
        return raw, curve_score(raw, fw.aum_curve(fund.get("category"))["points"]), "curve"
    if direction == "band":
        lo, hi = fw.EFFECTIVE_N_BAND.get(fund.get("category"), (20, 50))
        return raw, band_score(raw, lo, hi), "band"
    return raw, (None if raw is None else max(0.0, min(100.0, raw))), "absolute"


def _score_fund(fund, pops):
    blocks, earned, available = [], 0.0, 0.0
    for block in fw.BLOCKS:
        rows, bw_have, bw_all = [], 0.0, 0.0
        acc = 0.0
        for m in block["metrics"]:
            raw, score, scale = _metric_score(fund, m, pops)
            rows.append({"field": m["field"], "label": m["label"], "weight": m["weight"],
                         "raw": raw, "score": None if score is None else round(score, 1),
                         "scale": scale, "unit": m.get("unit", ""),
                         "note": m.get("note")})
            bw_all += m["weight"]
            if score is not None and m["weight"] > 0:
                acc += score * m["weight"]
                bw_have += m["weight"]
        bscore = round(acc / bw_have, 1) if bw_have > 0 else None
        # Coverage is measured against the metrics that carry weight, so a metric
        # parked at zero weight (name retention today) cannot dilute it.
        weighted_all = sum(m["weight"] for m in block["metrics"] if m["weight"] > 0)
        blocks.append({
            "code": block["code"], "name": block["name"], "weight": block["weight"],
            "why": block["why"], "score": bscore,
            "coverage": round(100.0 * bw_have / weighted_all, 0) if weighted_all else 0,
            "metrics": rows,
        })
        if bscore is not None:
            earned += bscore * block["weight"]
            available += block["weight"]

    # Renormalising over whichever blocks scored is only honest while most of the
    # model is present. Below the floor the fund keeps its block scores and its
    # data but carries no composite, so it cannot rank against funds that were
    # measured on the full model.
    composite = (round(earned / available, 1)
                 if available >= fw.MIN_EVIDENCE else None)
    band = fw.band_for(composite)

    fund["blocks"] = blocks
    fund["blockScore"] = {b["code"]: b["score"] for b in blocks}
    fund["composite"] = composite
    fund["evidence"] = round(available, 0)          # share of model weight scored
    fund["rated"] = composite is not None
    fund["band"] = band["code"]
    fund["bandMeaning"] = band["meaning"]
    fund["flags"] = _flags(fund)
    return fund


def _flags(fund):
    flags = []
    my = _f(fund.get("managerYears"))
    if my is None:
        flags.append({"code": "manager-unknown", "label": "Manager tenure not captured",
                      "tone": "warning",
                      "why": "Tenure and cycles are analyst inputs and none is on file, so "
                             "the manager block is unscored rather than guessed."})
    elif my < 3:
        flags.append({"code": "new-manager", "label": "New Manager", "tone": "warning",
                      "why": f"{my:.1f} years on this scheme. A flag, not a reject."})
    v = _f(fund.get("vintageYears"))
    if v is not None and v < 5:
        flags.append({"code": "short-record", "label": "Short record", "tone": "warning",
                      "why": f"{v:.0f}Y or less of live history. Counts for less through "
                             f"the track record block, it does not remove the fund."})
    fit = _f(fund.get("mandateFit"))
    if fit is not None and fit < 100:
        short = ", ".join(f"{s['bucket']} {s['actual']:.0f}% vs {s['required']:.0f}% required"
                          for s in fund.get("mandateShortfalls", []))
        flags.append({"code": "mandate", "label": "Mandate shortfall", "tone": "serious",
                      "why": f"Disclosed book is short of the SEBI minimum: {short}."})
    aum_block = next((b for b in fund.get("blocks", []) if b["code"] == "aum"), None)
    if aum_block and aum_block["score"] is not None and aum_block["score"] < 40:
        shape = fw.aum_curve(fund.get("category"))["shape"]
        aum = _f(fund.get("aumCr")) or 0
        flags.append({
            "code": "capacity", "label": "Capacity watch" if shape != "scale" else "Size watch",
            "tone": "warning",
            "why": f"AUM of Rs {aum:,.0f} cr scores {aum_block['score']:.0f} on the "
                   f"{fund.get('category')} curve, which is a {shape} curve."})
    ev = fund.get("evidence") or 0
    if ev < fw.MIN_EVIDENCE:
        unscored = [b["name"] for b in fund.get("blocks", []) if b["score"] is None]
        flags.append({"code": "not-rated", "label": "Not rated", "tone": "neutral",
                      "why": f"Only {ev:.0f}% of the model's weight could be scored, "
                             f"below the {fw.MIN_EVIDENCE}% floor for a composite. "
                             f"Unscored: {', '.join(unscored) or 'none'}."})
    elif ev < 80:
        flags.append({"code": "thin", "label": "Thin evidence", "tone": "serious",
                      "why": f"{ev:.0f}% of the model's weight was scored. The composite "
                             f"is a partial read."})
    return flags


def _rank(funds):
    """Rank overall and within category, then group into equal-rank tiers.

    A composite difference below `MEANINGFUL_GAP` is not a real difference, so
    funds inside that distance of the tier leader share a tier. The list is still
    ordered, but the model stops pretending that rank 4 beats rank 5.
    """
    scored = [f for f in funds if f.get("composite") is not None]
    unscored = [f for f in funds if f.get("composite") is None]
    scored.sort(key=lambda f: -f["composite"])
    for i, f in enumerate(scored, 1):
        f["overallRank"] = i
    for f in unscored:
        f["overallRank"] = None

    by_cat = defaultdict(list)
    for f in scored:
        by_cat[f["category"]].append(f)
    for cat, group in by_cat.items():
        tier, leader = 1, group[0]["composite"]
        for i, f in enumerate(group, 1):
            f["categoryRank"] = i
            f["categoryCount"] = len(group)
            if leader - f["composite"] > fw.MEANINGFUL_GAP:
                tier += 1
                leader = f["composite"]
            f["tier"] = tier
        for f in group:
            f["tierSize"] = sum(1 for g in group if g["tier"] == f["tier"])
    for f in unscored:
        f["categoryRank"] = None
        f["categoryCount"] = len(by_cat.get(f.get("category"), []))
        f["tier"] = None
        f["tierSize"] = 0
