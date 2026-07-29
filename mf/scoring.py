"""The three-stage selection engine.

Stage 1  Hard gates      — can this fund be considered at all?
Stage 2  21-parameter scoring — how good is it relative to its category peers?
Stage 3  Composite, overlay, risk cap, classification — what do we do with it?

Two conventions from the policy govern everything below and are worth stating up
front, because they are what stop the engine from quietly inventing numbers:

  * §6.2 — where a parameter's data is unavailable the parameter scores 3 and is
    flagged. An analyst never guesses, and a data gap is never allowed to silently
    punish or reward a fund. Every such parameter is returned with
    `source: "default"` so the UI can show exactly how much of a score is
    evidenced and how much is convention.

  * §12 — the category median is computed over gate-passing funds rather than the
    full universe, so that a flood of young funds cannot distort the peer standard.

Everything the engine can measure from the available data is measured; everything
it cannot is returned as an explicit, visible gap rather than an assumption.
"""

from __future__ import annotations

from statistics import median

from . import framework as fw


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def _f(value):
    """Return a usable float, or None."""
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return None if v != v else v


def _pct_rank(value, population, ascending=True):
    """Percentile of `value` within `population`. 0 = lowest value in the set."""
    pop = [p for p in population if p is not None]
    if not pop or value is None:
        return None
    below = sum(1 for p in pop if p < value)
    equal = sum(1 for p in pop if p == value)
    rank = (below + equal / 2.0) / len(pop) * 100.0
    return rank if ascending else 100.0 - rank


def _interpolate(score_lo, score_hi, at_lo, at_hi, value, lower_is_better=False):
    """Scores 2 and 4 interpolate between the published bands (§6.2)."""
    if value is None:
        return None
    if at_hi == at_lo:
        return score_hi
    t = (value - at_lo) / (at_hi - at_lo)
    t = max(0.0, min(1.0, t))
    raw = score_lo + t * (score_hi - score_lo)
    return max(1, min(5, int(round(raw))))


# --------------------------------------------------------------------------- #
# holdings-derived analytics
# --------------------------------------------------------------------------- #

EQUITY_INSTRUMENTS = {"equity", "equity share", "shares", "stock", "warrant"}
CASH_SECTORS = {"current assets", "cash", "cash & others", "cash and others",
                "treps", "net receivables"}


def portfolio_stats(book):
    """Derive the holdings analytics Pillar C needs from one fund's book."""
    if not book:
        return None

    equity, cash_pct = [], 0.0
    sectors, caps = {}, {"Large Cap": 0.0, "Mid Cap": 0.0, "Small Cap": 0.0}

    for h in book:
        pct = _f(h.get("pct")) or 0.0
        sector = (h.get("sec") or "").strip()
        instrument = (h.get("ins") or "").strip().lower()

        if sector.lower() in CASH_SECTORS or instrument in {"cash", "trep", "treps"}:
            cash_pct += pct
            continue

        is_equity = (not instrument) or any(k in instrument for k in EQUITY_INSTRUMENTS)
        if is_equity:
            equity.append((h.get("s") or "", pct))
            sectors[sector or "Unclassified"] = sectors.get(sector or "Unclassified", 0.0) + pct
            cap = (h.get("mc") or "").strip()
            if cap in caps:
                caps[cap] += pct

    if not equity:
        return None

    equity.sort(key=lambda x: -x[1])
    equity_pct = sum(p for _, p in equity)
    top10 = sum(p for _, p in equity[:10])
    top_sectors = sorted(sectors.items(), key=lambda kv: -kv[1])

    # Herfindahl on stock weights, rescaled to the equity sleeve — a
    # concentration read that does not depend on the count of tail positions.
    hhi = sum((p / equity_pct * 100) ** 2 for _, p in equity) if equity_pct else None

    classified = sum(caps.values())
    return {
        "holdingCount": len(equity),
        "equityPct": round(equity_pct, 2),
        "cashPct": round(cash_pct, 2),
        "top1": round(equity[0][1], 2),
        "top1Name": equity[0][0],
        "top5": round(sum(p for _, p in equity[:5]), 2),
        "top10": round(top10, 2),
        "top10Names": [n for n, _ in equity[:10]],
        "hhi": round(hhi, 1) if hhi else None,
        "sectorCount": len(sectors),
        "topSector": top_sectors[0][0] if top_sectors else None,
        "topSectorPct": round(top_sectors[0][1], 2) if top_sectors else None,
        "top3SectorPct": round(sum(p for _, p in top_sectors[:3]), 2),
        "sectors": [{"name": n, "pct": round(p, 2)} for n, p in top_sectors[:12]],
        # Cap split from the holdings book, normalised over classified equity.
        "capSplit": ({k: round(v / classified * 100, 2) for k, v in caps.items()}
                     if classified > 0 else None),
    }


# --------------------------------------------------------------------------- #
# Stage 1 — hard gates (§5)
# --------------------------------------------------------------------------- #

def _cap_allocation(fund, stats):
    """Best available large/mid/small split, preferring the disclosed attributes."""
    large, mid, small = (_f(fund.get("largeCapPct")), _f(fund.get("midCapPct")),
                         _f(fund.get("smallCapPct")))
    if large is not None and (mid is not None or small is not None):
        return large, mid or 0.0, small or 0.0, "attributes"
    if stats and stats.get("capSplit"):
        cs = stats["capSplit"]
        return cs["Large Cap"], cs["Mid Cap"], cs["Small Cap"], "holdings"
    if large is not None:
        return large, None, None, "attributes"
    return None, None, None, None


def apply_gates(fund, stats):
    """Run the seven hard gates. Returns (results, passed, unassessable_codes).

    Gates the available data cannot test (G3 manager tenure beyond a name, G4
    regulatory record) return status 'manual' — they are neither passed nor
    failed by the machine. The policy makes these an analyst responsibility, and
    silently passing them would misrepresent the eligible universe.
    """
    category = fund.get("category")
    results = []

    # -- G1 Vintage ---------------------------------------------------------
    # Vintage is inferred from the longest return series the feed carries: a 5Y
    # figure evidences at least five years live, a 3Y figure at least three.
    required = fw.VINTAGE_YEARS_PREFERRED.get(category, fw.VINTAGE_YEARS)
    has5y, has3y = _f(fund.get("return5Y")) is not None, _f(fund.get("return3Y")) is not None
    if not fund.get("navDate"):
        # The scheme carries no performance record in the feed at all, so the
        # absence of a 5Y figure is a data gap, not evidence of a short life.
        evidenced, g1 = None, "manual"
        g1_note = ("No performance record in the feed — confirm the live track record "
                   "against the SID before scoring")
    elif has5y:
        evidenced, g1 = 5, "pass"
        g1_note = f"≥5Y track record evidenced (category prefers {required}Y)"
    elif has3y:
        evidenced, g1 = 3, "fail"
        g1_note = "Only a 3Y record — below the 5Y vintage gate. Eligible only if the " \
                  "named manager has a verifiable ≥5Y identical-strategy record."
    else:
        evidenced, g1 = 0, "fail"
        g1_note = "No 3Y or 5Y return series — below the vintage gate; incubation list."
    # A 5-year record clears the base gate; the 7-year preference for Mid, Small
    # and Value/Contra is a preference, so it is flagged rather than failed.
    results.append({"code": "G1", "name": "Vintage", "status": g1, "detail": g1_note,
                    "value": evidenced,
                    "flag": g1 == "pass" and required > (evidenced or 0)})

    # -- G2 AUM floor -------------------------------------------------------
    floor = fw.AUM_FLOOR_CR.get(category, 500)
    aum = _f(fund.get("aumCr"))
    if aum is None:
        g2, g2_note = "manual", "AUM not available in the feed — confirm against AMFI"
    elif aum >= floor:
        g2, g2_note = "pass", f"₹{aum:,.0f} cr vs ₹{floor:,} cr floor"
    else:
        g2, g2_note = "fail", f"₹{aum:,.0f} cr is below the ₹{floor:,} cr floor"
    results.append({"code": "G2", "name": "AUM floor", "status": g2, "detail": g2_note,
                    "value": aum})

    # -- G3 Manager tenure --------------------------------------------------
    manager = fund.get("fundManager")
    results.append({
        "code": "G3", "name": "Manager tenure",
        "status": "manual",
        "detail": (f"Named FM: {manager}. Tenure is not in the feed — confirm ≥3 years "
                   f"on this fund or a team process that survived its last transition."
                   if manager else
                   "No named fund manager in the feed — confirm before scoring Pillar D."),
        "value": manager})

    # -- G4 Regulatory record ----------------------------------------------
    results.append({
        "code": "G4", "name": "Regulatory record", "status": "manual",
        "detail": "No SEBI enforcement feed is wired in. Research confirms a clean "
                  "3-year record for the AMC and scheme before admission.",
        "value": None})

    # -- G5 Mandate compliance ---------------------------------------------
    large, mid, small, cap_src = _cap_allocation(fund, stats)
    minimums = fw.MANDATE_MINIMUMS.get(category, {})
    breaches, checked = [], False
    equity_pct = None
    if large is not None:
        equity_pct = large + (mid or 0.0) + (small or 0.0)
    for bucket, floor_pct in minimums.items():
        actual = {"large": large, "mid": mid, "small": small,
                  "equity": equity_pct}.get(bucket)
        if actual is None:
            continue
        checked = True
        if actual < floor_pct - 1.0:   # 1pp tolerance for month-end drift
            breaches.append(f"{bucket} {actual:.1f}% vs ≥{floor_pct}%")
    if not checked:
        g5, g5_note = "manual", "Mandate is stylistic or allocation unavailable — " \
                                "assess against the SID and 8 quarters of portfolios"
    elif breaches:
        g5, g5_note = "fail", "Mandate minimum breached: " + "; ".join(breaches)
    else:
        g5, g5_note = "pass", f"Allocation within the SEBI mandate ({cap_src} basis)"
    results.append({"code": "G5", "name": "Mandate compliance", "status": g5,
                    "detail": g5_note,
                    "value": {"large": large, "mid": mid, "small": small}})

    # -- G6 Structure -------------------------------------------------------
    # The universe is built from direct-growth rows only, so structure is
    # evidenced by construction for any fund that reached this point.
    is_mf = fund.get("vehicle", "MF") == "MF"
    results.append({
        "code": "G6", "name": "Structure",
        "status": "pass" if is_mf else "fail",
        "detail": ("Open-ended direct-growth plan present in the universe"
                   if is_mf else "Not an open-ended mutual fund scheme"),
        "value": fund.get("vehicle", "MF")})

    # -- G7 Concentration sanity -------------------------------------------
    limits = fw.CONCENTRATION_LIMITS.get(category, fw.CONCENTRATION_LIMITS["default"])
    if not stats:
        g7, g7_note = "manual", "No holdings disclosure available for this scheme"
    else:
        issues = []
        if stats["top10"] > limits["top10"]:
            issues.append(f"top-10 {stats['top10']:.1f}% vs ≤{limits['top10']}%")
        if stats["top1"] > limits["single"]:
            issues.append(f"largest holding {stats['top1']:.1f}% vs ≤{limits['single']}%")
        if issues:
            g7, g7_note = "fail", "Concentration beyond category norms: " + "; ".join(issues)
        else:
            g7, g7_note = "pass", (f"Top-10 {stats['top10']:.1f}%, largest "
                                   f"{stats['top1']:.1f}% — within norms")
    results.append({"code": "G7", "name": "Concentration sanity", "status": g7,
                    "detail": g7_note,
                    "value": stats["top10"] if stats else None})

    failed = [r["code"] for r in results if r["status"] == "fail"]
    manual = [r["code"] for r in results if r["status"] == "manual"]
    return results, not failed, failed, manual


# --------------------------------------------------------------------------- #
# Stage 2 — the 21 parameters (§6)
# --------------------------------------------------------------------------- #

def _score(code, value, source, note):
    return {"code": code, "score": value, "source": source, "note": note}


def score_fund(fund, peers, bench, stats):
    """Score all 21 parameters for one fund against its category peer set.

    `peers` is the category's gate-passing peer statistics (see build_peer_stats).
    Returns {code: {score, source, note}} where source is one of:
      quant     — computed from measured data
      holdings  — computed from the disclosed portfolio
      default   — no data; scored 3 and flagged per §6.2
    """
    out = {}
    category = fund.get("category")

    def default(code, why):
        out[code] = _score(code, 3, "default", f"Scored 3 and flagged — {why}")

    # ---------------- Pillar A: performance quality ------------------------
    # A1 — median rolling 3Y CAGR vs benchmark TRI and category median.
    roll = _f(fund.get("medianRolling3Y"))
    bench_roll = _f((bench or {}).get("medianRolling3Y"))
    if roll is not None and bench_roll is not None:
        excess = roll - bench_roll
        cat_med = peers.get("medianRolling3Y")
        if excess >= 3:
            s = 5
        elif excess <= -2:
            s = 1
        elif excess >= 1:
            s = 4
        elif excess >= -0.5:
            s = 3
        else:
            s = 2
        # The band is defined against the TRI; the category median is the
        # tie-breaker the policy asks for alongside it.
        if cat_med is not None and s < 5 and roll > cat_med + 2:
            s = min(5, s + 1)
        out["A1"] = _score("A1", s, "quant",
                           f"Median rolling 3Y CAGR {roll:.2f}% vs benchmark "
                           f"{bench_roll:.2f}% ({excess:+.2f} pp)"
                           + (f", category median {cat_med:.2f}%" if cat_med else ""))
    else:
        default("A1", "no median rolling-return series for this scheme")

    # A2 — rolling-return consistency. The parameter wants the share of 3Y
    # rolling windows that beat the benchmark, which needs a daily-rolled NAV
    # series. The information ratio is the closest available stand-in: excess
    # return divided by its own tracking error is precisely a measure of how
    # reliably, rather than how much, a fund beats its benchmark. An IR near zero
    # implies excess return that averages out — the ~50% hit rate the policy
    # scores 3.
    info_ratio = _f(fund.get("informationRatio3Y"))
    r_2017 = _f(fund.get("medianRolling3Y2017"))
    if info_ratio is not None:
        if info_ratio >= 1.0:
            s = 5
        elif info_ratio >= 0.6:
            s = 4
        elif info_ratio >= 0.15:
            s = 3
        elif info_ratio >= -0.25:
            s = 2
        else:
            s = 1
        note = (f"3Y information ratio {info_ratio:.2f} — a stand-in for the share "
                f"of rolling windows beating the benchmark, which needs the NAV "
                f"pipeline.")
        # The two rolling medians the feed carries corroborate the read, but only
        # when the 2017 cutoff actually changes the window — for funds launched
        # after 2017 the two figures are the same number and say nothing.
        if r_2017 is not None and roll is not None and abs(roll - r_2017) > 0.01:
            drift = r_2017 - roll
            note += (f" Rolling median moves {drift:+.2f} pp on the 2017 cutoff "
                     f"({roll:.2f}% full history vs {r_2017:.2f}%), so the record "
                     f"is {'start-point sensitive' if abs(drift) > 3 else 'stable across start points'}.")
            if abs(drift) > 3 and s > 1:
                s -= 1
        out["A2"] = _score("A2", s, "quant", note)
    else:
        default("A2", "information ratio and rolling window series unavailable")

    # A3 — Jensen's alpha. Derived from the CAPM identity using the feed's beta
    # and the policy risk-free rate, against the pack benchmark.
    beta, rf = _f(fund.get("beta3Y")), fw.RISK_FREE_RATE
    if roll is not None and bench_roll is not None and beta is not None:
        alpha = (roll - rf) - beta * (bench_roll - rf)
        if alpha > 2.5:
            s = 5
        elif alpha > 1.0:
            s = 4
        elif alpha >= 0:
            s = 3
        elif alpha >= -1.5:
            s = 2
        else:
            s = 1
        out["A3"] = _score("A3", s, "quant",
                           f"Jensen's alpha {alpha:+.2f}% p.a. (β {beta:.2f}, "
                           f"rf {rf:.1f}%) vs {fund.get('benchmark')}")
        fund["_alpha"] = alpha
    else:
        default("A3", "beta or rolling-return series unavailable")

    # A4 — behaviour across cycles. The feed gives one calendar-year window
    # (CYTD) plus point-to-point CAGRs; quartile position across each is the
    # available read on cycle behaviour, short of a 7-year quartile history.
    cy_rank = _pct_rank(_f(fund.get("returnCYTD")), peers.get("returnCYTD_pop", []))
    r3_rank = _pct_rank(_f(fund.get("return3Y")), peers.get("return3Y_pop", []))
    r5_rank = _pct_rank(_f(fund.get("return5Y")), peers.get("return5Y_pop", []))
    ranks = [r for r in (cy_rank, r3_rank, r5_rank) if r is not None]
    if ranks:
        avg = sum(ranks) / len(ranks)
        s = 5 if avg >= 80 else 4 if avg >= 60 else 3 if avg >= 40 else 2 if avg >= 20 else 1
        out["A4"] = _score("A4", s, "quant",
                           f"Average category percentile {avg:.0f} across "
                           f"{len(ranks)} horizon(s) (CYTD / 3Y / 5Y). A full "
                           f"7-year calendar-quartile history is not in the feed.")
    else:
        default("A4", "no calendar-year or multi-horizon returns available")

    # ---------------- Pillar B: risk & downside ----------------------------
    # B1 — downside capture. Straight off the Quant Helper bands.
    dc = _f(fund.get("downsideCapture3Y"))
    s = fw.band_score("B1", dc)
    if s is not None:
        out["B1"] = _score("B1", s, "quant",
                           f"3Y downside capture {dc:.1f}% vs {fund.get('benchmark')}"
                           + (" — above 115, triggers the automatic Hold cap"
                              if dc > 115 else ""))
    else:
        default("B1", "downside capture unavailable")

    # B2 — max drawdown vs benchmark.
    mdd, bench_mdd = _f(fund.get("maxDrawdown3Y")), _f((bench or {}).get("maxDrawdown3Y"))
    if mdd is not None and bench_mdd not in (None, 0):
        ratio = abs(mdd) / abs(bench_mdd)
        if ratio <= 0.85:
            s = 5
        elif ratio <= 0.95:
            s = 4
        elif ratio <= 1.10:
            s = 3
        elif ratio <= 1.25:
            s = 2
        else:
            s = 1
        out["B2"] = _score("B2", s, "quant",
                           f"3Y max drawdown {mdd:.1f}% vs benchmark {bench_mdd:.1f}% "
                           f"({ratio:.2f}×). Recovery time is not in the feed.")
        fund["_mddRatio"] = ratio
    else:
        default("B2", "max drawdown unavailable")

    # B3 — SD vs category median.
    sd, cat_sd = _f(fund.get("stdDev3Y")), peers.get("stdDev3Y")
    if sd is not None and cat_sd:
        ratio = sd / cat_sd
        s = fw.band_score("B3", ratio)
        out["B3"] = _score("B3", s, "quant",
                           f"3Y SD {sd:.2f}% vs category median {cat_sd:.2f}% "
                           f"({ratio:.2f}×)")
    else:
        default("B3", "standard deviation or category median unavailable")

    # B4 — Sortino vs category median.
    sortino, cat_sortino = _f(fund.get("sortino3Y")), peers.get("sortino3Y")
    if sortino is not None and cat_sortino:
        ratio = sortino / cat_sortino if cat_sortino > 0 else None
        s = fw.band_score("B4", ratio)
        if s is not None:
            out["B4"] = _score("B4", s, "quant",
                               f"3Y Sortino {sortino:.2f} vs category median "
                               f"{cat_sortino:.2f} ({ratio:.2f}×)")
        else:
            default("B4", "category median Sortino is not positive")
    else:
        default("B4", "Sortino or category median unavailable")

    # B5 — beta stability. A rolling 1Y beta band needs the NAV pipeline; the
    # distance of the point beta from 1.0 is scored as a partial read and the
    # gap is stated rather than hidden.
    if beta is not None:
        drift = abs(beta - 1.0)
        s = 5 if drift <= 0.05 else 4 if drift <= 0.10 else 3 if drift <= 0.20 else 2 if drift <= 0.35 else 1
        out["B5"] = _score("B5", s, "quant",
                           f"3Y beta {beta:.2f} ({drift:.2f} from 1.00). Partial read — "
                           f"the rolling 1Y beta band needs the NAV pipeline.")
    else:
        default("B5", "beta unavailable")

    # ---------------- Pillar C: portfolio & style integrity ----------------
    large, mid, small, cap_src = _cap_allocation(fund, stats)
    minimums = fw.MANDATE_MINIMUMS.get(category, {})
    if large is not None and minimums:
        headroom = []
        for bucket, floor_pct in minimums.items():
            actual = {"large": large, "mid": mid, "small": small,
                      "equity": (large + (mid or 0) + (small or 0))}.get(bucket)
            if actual is not None:
                headroom.append(actual - floor_pct)
        if headroom:
            worst = min(headroom)
            s = 5 if worst >= 10 else 4 if worst >= 5 else 3 if worst >= 0 else 2 if worst >= -2 else 1
            out["C1"] = _score("C1", s, "holdings",
                               f"Closest mandate minimum cleared by {worst:+.1f} pp "
                               f"({cap_src} basis). Style-box drift over 12 quarters "
                               f"needs a holdings history.")
        else:
            default("C1", "mandate minimums not testable from the disclosed allocation")
    else:
        default("C1", "market-cap allocation unavailable")

    # C2 — concentration. Judgement inverts for Focused funds, where
    # concentration is the mandate rather than a risk.
    if stats:
        t10 = stats["top10"]
        if category == "Focused":
            s = 5 if t10 >= 45 else 4 if t10 >= 38 else 3 if t10 >= 30 else 2
            note = (f"Top-10 {t10:.1f}% — read as conviction, not risk, for a "
                    f"Focused mandate ({stats['holdingCount']} equity holdings)")
        else:
            s = 5 if t10 < 40 else 4 if t10 < 45 else 3 if t10 <= 55 else 2 if t10 <= 60 else 1
            note = (f"Top-10 {t10:.1f}%, largest holding {stats['top1']:.1f}%, "
                    f"top-3 sectors {stats['top3SectorPct']:.1f}% across "
                    f"{stats['holdingCount']} equity holdings")
        if stats["topSectorPct"] and stats["topSectorPct"] > 45 and category != "Sectoral / Thematic":
            s = max(1, s - 1)
            note += f" — {stats['topSector']} at {stats['topSectorPct']:.1f}% dominates"
        out["C2"] = _score("C2", s, "holdings", note)
    else:
        default("C2", "no holdings disclosure available")

    # C3 — portfolio liquidity. Days-to-liquidate needs ADTV per security, which
    # is not in this dataset. The small-cap share of the book and the size of the
    # position tail are the available proxy, and the gap is stated.
    if stats and stats.get("capSplit") and _f(fund.get("aumCr")) is not None:
        small_share = stats["capSplit"]["Small Cap"]
        aum = _f(fund.get("aumCr"))
        # Illiquidity scales with both the small-cap share and the rupees behind it.
        illiquid_cr = small_share / 100.0 * aum
        if small_share <= 10:
            s = 5
        elif small_share <= 25:
            s = 4
        elif small_share <= 45:
            s = 3
        elif small_share <= 65:
            s = 2
        else:
            s = 1
        if illiquid_cr > 15000 and s > 1:
            s -= 1
        out["C3"] = _score("C3", s, "holdings",
                           f"Small-cap sleeve {small_share:.1f}% of equity "
                           f"(≈₹{illiquid_cr:,.0f} cr). Proxy only — days-to-liquidate "
                           f"at 20% of ADTV needs security-level volume data.")
    else:
        default("C3", "cap split or AUM unavailable for a liquidity read")

    # C4 — active share. A true active share needs index constituent weights;
    # holding count and the tail's dispersion versus a large-cap-dominated book
    # is the available signal, so this stays a flagged default unless the book
    # is unambiguous.
    if stats and stats["holdingCount"] >= 1:
        n, t10 = stats["holdingCount"], stats["top10"]
        if category == "Large Cap":
            # A large-cap book with a wide tail and low top-10 is the classic
            # closet-indexer signature.
            if n > 70 and t10 < 45:
                s, note = 2, "Wide book with a low top-10 — closet-index risk"
            elif n <= 45 and t10 > 45:
                s, note = 4, "Compact, concentrated book — genuinely active"
            else:
                s, note = 3, "Book structure in line with the category"
        else:
            if n <= 35 and t10 > 45:
                s, note = 4, "Compact, concentrated book"
            elif n > 90:
                s, note = 2, "Very wide book — differentiation likely thin"
            else:
                s, note = 3, "Book structure in line with the category"
        out["C4"] = _score("C4", s, "holdings",
                           f"{note} ({n} holdings, top-10 {t10:.1f}%). Proxy — true "
                           f"active share needs benchmark constituent weights.")
    else:
        default("C4", "no holdings disclosure for an active-share read")

    # C5 — turnover. Not in any of the wired sources.
    default("C5", "portfolio turnover is not in the wired data sources")

    # ---------------- Pillar D: fund house & manager -----------------------
    default("D1", "FM tenure and attributable prior record are analyst-sourced")
    default("D2", "AMC process and team depth come from AMC meetings")

    # D3 — AUM adequacy & capacity. Fully measurable, and the soft capacity
    # ceilings of §5.1 bite here rather than at the gate.
    aum = _f(fund.get("aumCr"))
    floor = fw.AUM_FLOOR_CR.get(category, 500)
    ceiling = fw.SOFT_FLAGS["capacity_ceiling_cr"].get(category)
    if aum is not None:
        if aum < floor:
            s, note = 1, f"₹{aum:,.0f} cr is sub-scale against the ₹{floor:,} cr floor"
        elif ceiling and aum > ceiling:
            s = 1 if aum > ceiling * 1.5 else 2
            note = (f"₹{aum:,.0f} cr is beyond the ₹{ceiling:,} cr soft capacity "
                    f"ceiling for {category} — alpha decay and impact costs")
        elif ceiling and aum > ceiling * 0.75:
            s, note = 3, (f"₹{aum:,.0f} cr approaching the ₹{ceiling:,} cr capacity "
                          f"ceiling — watch the growth pace")
        elif aum < floor * 2:
            s, note = 3, f"₹{aum:,.0f} cr — adequate but not comfortably scaled"
        else:
            s, note = 4, f"₹{aum:,.0f} cr — comfortably within capacity"
        out["D3"] = _score("D3", s, "quant", note
                           + ". Willingness to soft-close is an analyst input.")
    else:
        default("D3", "AUM unavailable")

    default("D4", "governance and compliance history is analyst-sourced")

    # ---------------- Pillar E: cost & operations --------------------------
    # E1 — TER percentile within the gate-passing category peer set.
    ter = _f(fund.get("ter"))
    pctile = _pct_rank(ter, peers.get("ter_pop", []))
    if pctile is not None:
        s = fw.band_score("E1", pctile)
        cat_ter = peers.get("ter")
        out["E1"] = _score("E1", s, "quant",
                           f"Direct TER {ter:.2f}% — {pctile:.0f}th percentile of the "
                           f"category (median {cat_ter:.2f}%)" if cat_ter else
                           f"Direct TER {ter:.2f}% — {pctile:.0f}th percentile")
        # §5.1 soft flag
        if cat_ter is not None and (ter - cat_ter) * 100 > fw.SOFT_FLAGS["ter_above_median_bps"]:
            fund["_terFlag"] = round((ter - cat_ter) * 100, 0)
    else:
        default("E1", "TER unavailable")

    # E2 — net-of-cost alpha. The feed's returns are already net of TER, so the
    # alpha computed in A3 is a net-of-cost figure by construction.
    alpha = fund.get("_alpha")
    if alpha is not None:
        s = 5 if alpha > 2.0 else 4 if alpha > 1.0 else 3 if alpha > 0 else 2 if alpha > -1.5 else 1
        out["E2"] = _score("E2", s, "quant",
                           f"Net-of-cost alpha {alpha:+.2f}% p.a. — NAV-based returns "
                           f"are already net of the {ter:.2f}% TER"
                           if ter is not None else
                           f"Net-of-cost alpha {alpha:+.2f}% p.a.")
    else:
        default("E2", "alpha could not be computed")

    default("E3", "disclosure and reporting quality is an analyst assessment")

    # Any parameter the branches above did not reach falls back to the convention.
    for p in fw.PARAMETERS:
        if p["code"] not in out:
            default(p["code"], "not computed")
    return out


# --------------------------------------------------------------------------- #
# peer statistics (§12 — computed over gate-passing funds)
# --------------------------------------------------------------------------- #

def build_peer_stats(funds):
    """Category medians and populations, over gate-passing funds only."""
    buckets = {}
    for fund in funds:
        cat = fund.get("category")
        if not cat or not fund.get("_gatesPassed"):
            continue
        buckets.setdefault(cat, []).append(fund)

    stats = {}
    for cat, members in buckets.items():
        def pop(field):
            return [_f(m.get(field)) for m in members if _f(m.get(field)) is not None]

        def med(field):
            vals = pop(field)
            return median(vals) if vals else None

        stats[cat] = {
            "n": len(members),
            "stdDev3Y": med("stdDev3Y"),
            "sortino3Y": med("sortino3Y"),
            "medianRolling3Y": med("medianRolling3Y"),
            "downsideCapture3Y": med("downsideCapture3Y"),
            "maxDrawdown3Y": med("maxDrawdown3Y"),
            "ter": med("ter"),
            "ter_pop": pop("ter"),
            "returnCYTD_pop": pop("returnCYTD"),
            "return3Y_pop": pop("return3Y"),
            "return5Y_pop": pop("return5Y"),
        }
    return stats


# --------------------------------------------------------------------------- #
# Stage 3 — composite, overlay, risk cap, classification (§8)
# --------------------------------------------------------------------------- #

def composite(scores, category, overlay=0.0):
    """Composite out of 100 = Σ (score ÷ 5) × effective weight (§8.1)."""
    weights = fw.effective_weights(category)
    pillar_totals = {k: {"earned": 0.0, "available": 0.0} for k in fw.PILLARS}
    total = 0.0
    contributions = []

    for param in fw.PARAMETERS:
        code = param["code"]
        weight = weights[code]
        score = (scores.get(code) or {}).get("score", 3)
        earned = score / 5.0 * weight
        total += earned
        pillar_totals[param["pillar"]]["earned"] += earned
        pillar_totals[param["pillar"]]["available"] += weight
        contributions.append({
            "code": code, "pillar": param["pillar"], "name": param["name"],
            "score": score, "weight": round(weight, 3), "earned": round(earned, 3),
            "source": (scores.get(code) or {}).get("source", "default"),
            "note": (scores.get(code) or {}).get("note", ""),
        })

    overlay = max(-fw.OVERLAY_CAP, min(fw.OVERLAY_CAP, overlay or 0.0))
    final = max(0.0, min(100.0, total + overlay))

    return {
        "raw": round(total, 2),
        "overlay": overlay,
        "final": round(final, 2),
        "pillars": {
            k: {"earned": round(v["earned"], 2), "available": round(v["available"], 2),
                "pct": round(v["earned"] / v["available"] * 100, 1) if v["available"] else None,
                "name": fw.PILLARS[k]["name"]}
            for k, v in pillar_totals.items()},
        "contributions": sorted(contributions, key=lambda c: -c["earned"]),
    }


def classify_fund(comp, scores, gates_passed, failed_gates):
    """Apply the two automatic rules that sit above the bands (§8.3)."""
    if not gates_passed:
        return {
            "label": "REJECTED — gate failure", "tone": "exit",
            "action": "A fund failing any hard gate is rejected for the cycle "
                      "regardless of its composite score.",
            "capped": False, "reason": f"Failed {', '.join(failed_gates)}",
        }

    band = fw.classify(comp["final"])
    b1 = (scores.get(fw.RISK_CAP_PARAM) or {}).get("score", 3)
    if b1 <= fw.RISK_CAP_SCORE and band["min"] > 50:
        return {
            "label": fw.RISK_CAP_LABEL, "tone": "hold",
            "action": next(b["action"] for b in fw.CLASSIFICATION_BANDS
                           if b["label"] == fw.RISK_CAP_LABEL),
            "capped": True,
            "reason": f"Risk cap: downside capture (B1) scored {b1}. Capped at Hold "
                      f"from {band['label']} — losses matter more than gains.",
        }
    return {"label": band["label"], "tone": band["tone"], "action": band["action"],
            "capped": False, "reason": None}


# --------------------------------------------------------------------------- #
# §11.2 — event triggers that can be tested from the data
# --------------------------------------------------------------------------- #

def check_triggers(fund, comp, scores, stats, gates):
    """Return the automatable triggers currently firing for a fund."""
    fired = []

    alpha = fund.get("_alpha")
    if alpha is not None and alpha < 0:
        fired.append({
            "code": "T3", "trigger": "Rolling 3Y alpha negative",
            "detail": f"Jensen's alpha {alpha:+.2f}% p.a. Confirm whether this has "
                      f"persisted four consecutive quarters before opening the "
                      f"two-quarter cure period.",
            "severity": "watch"})

    ratio = fund.get("_mddRatio")
    if ratio is not None and ratio > 1.25:
        fired.append({
            "code": "T4", "trigger": "Drawdown deeper than 1.25× the benchmark",
            "detail": f"3Y max drawdown is {ratio:.2f}× the benchmark's. Risk review: "
                      f"test whether the losses are consistent with the stated style.",
            "severity": "review"})

    g5 = next((g for g in gates if g["code"] == "G5"), None)
    if g5 and g5["status"] == "fail":
        fired.append({
            "code": "T6", "trigger": "Style drift or mandate breach",
            "detail": g5["detail"] + ". Immediate Watch; exit if unremedied within "
                                     "two quarters.",
            "severity": "watch"})

    final = comp["final"]
    if final < 50:
        fired.append({
            "code": "T7", "trigger": "Final score below 50",
            "detail": f"Composite {final:.1f} initiates the exit protocol.",
            "severity": "exit"})
    elif final < 65:
        fired.append({
            "code": "T7", "trigger": "Final score below 65 at the quarterly refresh",
            "detail": f"Composite {final:.1f} places the fund on Watch.",
            "severity": "watch"})

    aum = _f(fund.get("aumCr"))
    ceiling = fw.SOFT_FLAGS["capacity_ceiling_cr"].get(fund.get("category"))
    if aum and ceiling and aum > ceiling:
        fired.append({
            "code": "T5", "trigger": "AUM beyond the category soft capacity ceiling",
            "detail": f"₹{aum:,.0f} cr against a ₹{ceiling:,} cr ceiling. Capacity and "
                      f"liquidity review; establish who is buying, and why.",
            "severity": "review"})

    return fired


# --------------------------------------------------------------------------- #
# the full pipeline
# --------------------------------------------------------------------------- #

def evaluate_universe(funds, benchmarks, holdings, overlays=None):
    """Score every in-scope fund. Returns the list of evaluated fund records.

    Gates run first so that peer medians are computed over gate-passing funds
    only (§12); the parameter scoring then runs against those medians.
    """
    overlays = overlays or {}
    in_scope = [f for f in funds if f.get("category")]

    # -- Stage 1 across the universe ---------------------------------------
    prepared = []
    for fund in in_scope:
        stats = portfolio_stats(holdings.get(fund["key"]))
        gates, passed, failed, manual = apply_gates(fund, stats)
        fund["_gatesPassed"] = passed
        prepared.append((fund, stats, gates, passed, failed, manual))

    # -- peer medians over gate-passing funds ------------------------------
    peer_stats = build_peer_stats(in_scope)

    # -- Stages 2 and 3 ----------------------------------------------------
    evaluated = []
    for fund, stats, gates, passed, failed, manual in prepared:
        category = fund["category"]
        peers = peer_stats.get(category, {})
        bench = benchmarks.get(fund.get("benchmark"))

        scores = score_fund(fund, peers, bench, stats)
        overlay = overlays.get(fund["key"], 0.0)
        comp = composite(scores, category, overlay)
        classification = classify_fund(comp, scores, passed, failed)
        triggers = check_triggers(fund, comp, scores, stats, gates)

        evidenced = sum(1 for s in scores.values() if s["source"] != "default")
        evidence_weight = sum(
            c["weight"] for c in comp["contributions"] if c["source"] != "default")

        record = {k: v for k, v in fund.items() if not k.startswith("_")}
        record.update({
            "gates": gates,
            "gatesPassed": passed,
            "failedGates": failed,
            "manualGates": manual,
            "scores": scores,
            "composite": comp,
            "classification": classification,
            "triggers": triggers,
            "portfolio": stats,
            "peerCount": peers.get("n"),
            "alpha": fund.get("_alpha"),
            "mddRatio": fund.get("_mddRatio"),
            "terFlagBps": fund.get("_terFlag"),
            "evidence": {
                "parameters": evidenced,
                "totalParameters": len(fw.PARAMETERS),
                "weightPct": round(evidence_weight, 1),
            },
        })
        evaluated.append(record)

    evaluated.sort(key=lambda r: -r["composite"]["final"])
    for i, record in enumerate(evaluated, 1):
        record["overallRank"] = i

    # Category ranks, over gate-passing funds only — a rejected fund does not
    # occupy a rank its peers have to beat.
    by_cat = {}
    for record in evaluated:
        if record["gatesPassed"]:
            by_cat.setdefault(record["category"], []).append(record)
    for members in by_cat.values():
        for i, record in enumerate(members, 1):
            record["categoryRank"] = i
            record["categoryCount"] = len(members)

    return evaluated
