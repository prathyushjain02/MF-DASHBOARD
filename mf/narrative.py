"""Writes the analyst remark for a single fund.

Everything here is assembled from the evaluated record — the composite, the
parameter scores and their evidence type, the gate results, the holdings
statistics and the fund's standing among its category peers. Nothing is
generalised from the fund's name, its AMC's reputation or the category's
fashion; if a sentence appears it is because a number in the record supports it,
and the number is quoted alongside it.

The remark deliberately separates four things the policy keeps separate:
what the fund *is* (standing), what it does *well* and *badly* (evidence), what
the framework has *not* seen (open items), and what would *change* the view.
"""

from __future__ import annotations

from . import framework as fw


def _pctile(value, population, higher_is_better=True):
    """Percentile of a value within a peer population. 100 = best."""
    pop = [p for p in population if p is not None]
    if value is None or len(pop) < 4:
        return None
    below = sum(1 for p in pop if p < value)
    rank = below / len(pop) * 100.0
    return rank if higher_is_better else 100.0 - rank


def _band(p):
    """Plain-language position from a percentile."""
    if p is None:
        return None
    if p >= 90:
        return "top decile"
    if p >= 75:
        return "top quartile"
    if p >= 55:
        return "above median"
    if p >= 45:
        return "around the median"
    if p >= 25:
        return "below median"
    return "bottom quartile"


def _f(v):
    try:
        return None if v is None else float(v)
    except (TypeError, ValueError):
        return None


def build_remark(record, peers, benchmark):
    """Return the structured remark for one evaluated fund.

    `peers` is the list of evaluated, gate-passing funds in the same category.
    """
    name = record["name"]
    category = record["category"]
    comp = record["composite"]
    cls = record["classification"]
    scores = record["scores"]
    stats = record.get("portfolio")
    score = comp["final"]

    def peer_vals(field):
        return [_f(p.get(field)) for p in peers]

    # ---- standing among peers -------------------------------------------
    rank = record.get("categoryRank")
    count = record.get("categoryCount")
    roll = _f(record.get("medianRolling3Y"))
    bench_roll = _f((benchmark or {}).get("medianRolling3Y"))
    dcap = _f(record.get("downsideCapture3Y"))
    ucap = _f(record.get("upsideCapture3Y"))
    sd = _f(record.get("stdDev3Y"))
    sortino = _f(record.get("sortino3Y"))
    ter = _f(record.get("ter"))
    aum = _f(record.get("aumCr"))
    alpha = _f(record.get("alpha"))
    mdd_ratio = _f(record.get("mddRatio"))

    positions = [
        {"metric": "Median rolling 3Y CAGR", "value": roll, "unit": "%",
         "pctile": _pctile(roll, peer_vals("medianRolling3Y"), True)},
        {"metric": "Downside capture", "value": dcap, "unit": "%",
         "pctile": _pctile(dcap, peer_vals("downsideCapture3Y"), False)},
        {"metric": "Upside capture", "value": ucap, "unit": "%",
         "pctile": _pctile(ucap, peer_vals("upsideCapture3Y"), True)},
        {"metric": "Sortino ratio", "value": sortino, "unit": "",
         "pctile": _pctile(sortino, peer_vals("sortino3Y"), True)},
        {"metric": "Standard deviation", "value": sd, "unit": "%",
         "pctile": _pctile(sd, peer_vals("stdDev3Y"), False)},
        {"metric": "Max drawdown", "value": _f(record.get("maxDrawdown3Y")), "unit": "%",
         "pctile": _pctile(_f(record.get("maxDrawdown3Y")), peer_vals("maxDrawdown3Y"), True)},
        {"metric": "Direct TER", "value": ter, "unit": "%",
         "pctile": _pctile(ter, peer_vals("ter"), False)},
    ]
    for p in positions:
        p["band"] = _band(p["pctile"])

    # ---- headline --------------------------------------------------------
    if not record["gatesPassed"]:
        gates = {g["code"]: g for g in record["gates"]}
        failed = ", ".join(f"{c} {gates[c]['name']}" for c in record["failedGates"]
                           if c in gates)
        headline = (f"{name} is rejected for this cycle on {failed}. It scores "
                    f"{score:.1f}, but a gate failure is an eligibility verdict, "
                    f"not a quality one — no composite can compensate for it.")
    elif cls["capped"]:
        headline = (f"{name} scores {score:.1f} but is capped at Hold by the "
                    f"downside-capture rule. It loses too much of the benchmark's "
                    f"falls for its headline number to be trusted.")
    elif rank and count:
        headline = (f"{name} ranks {rank} of {count} eligible {category} funds with a "
                    f"composite of {score:.1f}, classified {cls['label']}.")
    else:
        headline = f"{name} scores {score:.1f} and is classified {cls['label']}."

    # ---- strengths and concerns, drawn from the scored parameters --------
    strengths, concerns = [], []

    def add(bucket, code, text):
        bucket.append({"code": code, "param": fw.PARAM_BY_CODE[code]["name"], "text": text})

    # Performance
    if roll is not None and bench_roll is not None:
        excess = roll - bench_roll
        pos = next(p for p in positions if p["metric"] == "Median rolling 3Y CAGR")
        if excess >= 1.5:
            add(strengths, "A1", f"Median rolling 3Y CAGR of {roll:.1f}% beats the "
                                 f"benchmark by {excess:+.1f} pp — {pos['band']} of the category.")
        elif excess <= -1.0:
            add(concerns, "A1", f"Median rolling 3Y CAGR of {roll:.1f}% trails the "
                                f"benchmark by {excess:.1f} pp. Rolling, not point-to-point — "
                                f"this is the shortfall across entry points, not one bad window.")

    ir = _f(record.get("informationRatio3Y"))
    if ir is not None:
        if ir >= 1.0:
            add(strengths, "A2", f"Information ratio of {ir:.2f} — the outperformance is "
                                 f"consistent, not the product of one or two good quarters.")
        elif ir < 0:
            add(concerns, "A2", f"Information ratio of {ir:.2f}: excess return is negative "
                                f"relative to its own tracking error, so the active risk is "
                                f"not being paid for.")

    if alpha is not None:
        if alpha >= 2.0:
            add(strengths, "A3", f"Jensen's alpha of {alpha:+.1f}% p.a. after costs — the "
                                 f"return is not simply beta being rewarded.")
        elif alpha < 0:
            add(concerns, "A3", f"Jensen's alpha of {alpha:+.1f}% p.a.: on a beta-adjusted "
                                f"basis the fund has not added value over the benchmark.")

    # Risk — the pillar the policy weights hardest
    if dcap is not None:
        if dcap < 85:
            add(strengths, "B1", f"Downside capture of {dcap:.1f}% — it gives up less than "
                                 f"85% of the benchmark's falls, the framework's top band on "
                                 f"the parameter it treats as decisive.")
        elif dcap > 115:
            add(concerns, "B1", f"Downside capture of {dcap:.0f}% is above the 115% ceiling. "
                                f"This alone caps the fund at Hold regardless of composite.")
        elif dcap > 105:
            add(concerns, "B1", f"Downside capture of {dcap:.0f}% — it falls more than the "
                                f"benchmark does, which is what clients abandon funds over.")

    if dcap is not None and ucap is not None:
        if ucap > 100 and dcap < 100:
            add(strengths, "B1", f"Asymmetric capture: {ucap:.1f}% of the upside against "
                                 f"{dcap:.1f}% of the downside. That combination is rare and "
                                 f"is what the risk pillar is designed to find.")
        elif ucap < 95 and dcap > 100:
            add(concerns, "B1", f"Adverse asymmetry: {ucap:.1f}% of the upside but "
                                f"{dcap:.1f}% of the downside — the wrong side of both.")
        elif ucap < 85 and dcap < 90:
            # Not a flaw, but the trade-off a client will feel in a rally and
            # should hear about before they buy, not after.
            add(concerns, "B1", f"Upside capture of {ucap:.1f}% means it lags materially "
                                f"in rallies. The framework accepts that trade at "
                                f"{dcap:.1f}% downside capture, but a client holding this "
                                f"should expect to trail in strong up-markets — and be "
                                f"told so before they buy, not after.")

    if mdd_ratio is not None:
        if mdd_ratio <= 0.85:
            add(strengths, "B2", f"Its worst 3Y drawdown is {mdd_ratio:.2f}× the benchmark's — "
                                 f"materially shallower.")
        elif mdd_ratio > 1.25:
            add(concerns, "B2", f"Its worst 3Y drawdown is {mdd_ratio:.2f}× the benchmark's, "
                                f"past the 1.25× trigger threshold.")

    pos_sd = next(p for p in positions if p["metric"] == "Standard deviation")
    if pos_sd["pctile"] is not None and sd is not None:
        if pos_sd["pctile"] >= 75:
            add(strengths, "B3", f"Volatility of {sd:.1f}% sits in the {pos_sd['band']} — "
                                 f"a calmer ride than most of the category.")
        elif pos_sd["pctile"] <= 25:
            add(concerns, "B3", f"Volatility of {sd:.1f}% is {pos_sd['band']} for the category.")

    # Cost
    pos_ter = next(p for p in positions if p["metric"] == "Direct TER")
    if ter is not None and pos_ter["pctile"] is not None:
        if pos_ter["pctile"] >= 75:
            add(strengths, "E1", f"Direct TER of {ter:.2f}% is {pos_ter['band']} — cheap for "
                                 f"the category.")
        elif pos_ter["pctile"] <= 25:
            note = (" In Large Cap, where cost carries 18% of the score, that is hard to "
                    "justify against an index fund." if category == "Large Cap" else "")
            add(concerns, "E1", f"Direct TER of {ter:.2f}% is {pos_ter['band']} — expensive "
                                f"for the category.{note}")

    # Capacity
    ceiling = fw.SOFT_FLAGS["capacity_ceiling_cr"].get(category)
    if aum is not None and ceiling and aum > ceiling:
        add(concerns, "D3", f"AUM of ₹{aum:,.0f} cr is past the ₹{ceiling:,} cr soft capacity "
                            f"ceiling for {category}. Impact costs start eroding exactly the "
                            f"alpha the fund is bought for.")
    elif aum is not None and aum < fw.AUM_FLOOR_CR.get(category, 500) * 1.5:
        add(concerns, "D3", f"AUM of ₹{aum:,.0f} cr is close to the category floor — viability "
                            f"and TER pressure rather than quality, but worth watching.")

    # Holdings-based reads
    if stats:
        t10 = stats["top10"]
        if category == "Focused":
            if t10 >= 45:
                add(strengths, "C2", f"Top-10 at {t10:.0f}% across {stats['holdingCount']} "
                                     f"names — genuine conviction, which is the Focused mandate.")
        else:
            if t10 < 40:
                add(strengths, "C2", f"Top-10 at {t10:.0f}% across {stats['holdingCount']} "
                                     f"names — diversified without being diffuse.")
            elif t10 > 55:
                add(concerns, "C2", f"Top-10 at {t10:.0f}% is concentrated for a diversified "
                                    f"mandate; the largest position alone is {stats['top1']:.1f}%.")
        if stats["topSectorPct"] and stats["topSectorPct"] > 40 and category != "Sectoral / Thematic":
            add(concerns, "C2", f"{stats['topSector']} accounts for {stats['topSectorPct']:.0f}% "
                                f"of the book — a sector call as much as a stock-selection one.")
        cs = stats.get("capSplit")
        if cs and cs["Small Cap"] > 30 and category in ("Flexi Cap", "Multi Cap", "Large & Mid Cap"):
            add(concerns, "C3", f"Small caps are {cs['Small Cap']:.0f}% of the equity book. "
                                f"On ₹{aum:,.0f} cr that is a real liquidity tail in a stressed "
                                f"market." if aum else
                                f"Small caps are {cs['Small Cap']:.0f}% of the equity book.")

    # ---- what the framework has not seen ---------------------------------
    open_items = []
    for gate in record["gates"]:
        if gate["status"] == "manual":
            open_items.append({"code": gate["code"], "kind": "gate",
                               "text": gate["detail"]})
    weights = fw.effective_weights(category)
    unmeasured = sorted(
        ((code, s) for code, s in scores.items() if s["source"] == "default"),
        key=lambda kv: -weights[kv[0]])
    for code, s in unmeasured:
        open_items.append({
            "code": code, "kind": "parameter",
            "text": f"{fw.PARAM_BY_CODE[code]['name']} — {s['note']} "
                    f"({weights[code]:.1f} of 100 points)."})

    unmeasured_weight = round(100 - record["evidence"]["weightPct"], 1)

    # ---- what would change the view --------------------------------------
    movers = []
    for code, s in scores.items():
        if s["source"] == "default":
            continue
        gap = (5 - s["score"]) / 5 * weights[code]
        if gap > 1.0:
            movers.append({
                "code": code, "param": fw.PARAM_BY_CODE[code]["name"],
                "score": s["score"], "upside": round(gap, 1),
                "band5": fw.PARAM_BY_CODE[code]["bands"]["5"],
            })
    movers.sort(key=lambda m: -m["upside"])

    # Distance to the next classification band up.
    next_band = None
    for band in reversed(fw.CLASSIFICATION_BANDS):
        if band["min"] > score:
            next_band = {"label": band["label"], "needed": round(band["min"] - score, 1)}
            break

    # ---- bottom line -----------------------------------------------------
    if not record["gatesPassed"]:
        bottom = ("Not eligible this cycle. It belongs on the incubation list, scoped "
                  "annually against the same parameters, so that when it does clear its "
                  "gates the firm already has years of notes on it.")
    elif cls["tone"] == "core":
        bottom = (f"Recommendable for fresh allocations, subject to the client's IPS. "
                  f"Model-portfolio eligible after one full quarter of cooling-in — one "
                  f"great quarter is not a promotion case.")
        if open_items:
            bottom += (f" {len(open_items)} item(s) still sit with Research before "
                       f"admission is signed off.")
    elif cls["tone"] == "satellite":
        bottom = (f"Usable selectively — satellite sleeves and specific mandates rather "
                  f"than a default allocation."
                  + (f" It needs {next_band['needed']:.1f} more points to reach "
                     f"{next_band['label']}." if next_band else ""))
    elif cls["tone"] == "hold":
        bottom = ("Existing holdings retained subject to tax and exit-load economics; no "
                  "new money. A 'no fresh flows' state can legitimately persist for "
                  "quarters — client outcomes beat framework tidiness.")
    else:
        bottom = ("Exit protocol: structured, tax-aware and staggered for existing "
                  "holders; rejected for prospects.")

    return {
        "headline": headline,
        "verdict": cls["label"],
        "tone": cls["tone"],
        "action": cls["action"],
        "capReason": cls["reason"],
        "standing": {
            "rank": rank, "count": count, "category": category,
            "score": score, "positions": [p for p in positions if p["value"] is not None],
        },
        "strengths": strengths,
        "concerns": concerns,
        "openItems": open_items,
        "unmeasuredWeight": unmeasured_weight,
        "movers": movers[:5],
        "nextBand": next_band,
        "bottomLine": bottom,
        "triggers": record["triggers"],
    }
