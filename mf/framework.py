"""The Equity MF Selection & Monitoring Policy, encoded as data.

Source of truth: Equity_MF_Selection_Policy.docx v2.0 (11 Jul 2026) together with
its companion workbook Equity_MF_Selection_Scorecard_MASTER.xlsx. The policy is
explicit that the workbook's Weights tab is the single source of truth for every
weight, band and threshold — so those live here as editable constants and nowhere
else in the codebase.

Section references in the comments point back to the policy document.
"""

from __future__ import annotations

# --------------------------------------------------------------------------- #
# §4  Category universe
# --------------------------------------------------------------------------- #

POLICY_CATEGORIES = [
    "Large Cap", "Large & Mid Cap", "Flexi Cap", "Multi Cap", "Mid Cap",
    "Small Cap", "Focused", "Value / Contra", "Dividend Yield", "ELSS",
    "Sectoral / Thematic",
]

# Maps the category label used by the data feed onto the policy vocabulary.
# Anything absent is out of scope for this framework (index funds, ETFs, FoFs,
# hybrids) and is excluded from the scored universe rather than failed on a gate.
CATEGORY_MAP = {
    "Large Cap Fund": "Large Cap",
    "Large & Mid Cap Fund": "Large & Mid Cap",
    "Flexi Cap Fund": "Flexi Cap",
    "Multi Cap Fund": "Multi Cap",
    "Mid Cap Fund": "Mid Cap",
    "Small cap Fund": "Small Cap",
    "Small Cap Fund": "Small Cap",
    "Focused Fund": "Focused",
    "Value Fund": "Value / Contra",
    "Contra Fund": "Value / Contra",
    "Dividend Yield Fund": "Dividend Yield",
    "ELSS": "ELSS",
    "Sectoral": "Sectoral / Thematic",
    "Thematic": "Sectoral / Thematic",
}

CATEGORY_DEFINITIONS = {
    "Large Cap": {
        "mandate": "≥80% in large-cap equity",
        "benchmark": "Nifty 100 TRI", "role": "Core anchor", "horizon": "5+ yrs",
        "depth": [2, 3],
        "note": "Alpha dispersion is thin and shrinking since TRI benchmarking; "
                "cost and the avoidance of closet indexers decide outcomes.",
    },
    "Large & Mid Cap": {
        "mandate": "≥35% large + ≥35% mid",
        "benchmark": "NIFTY LargeMidcap 250 TRI", "role": "Core", "horizon": "5–7 yrs",
        "depth": [2, 3],
        "note": "Balanced mandate; the mid sleeve is where the manager earns the fee.",
    },
    "Flexi Cap": {
        "mandate": "≥65% equity, dynamic across caps",
        "benchmark": "Nifty 500 TRI", "role": "Core; default one-fund equity",
        "horizon": "5+ yrs", "depth": [3, 4],
        "note": "The truest test of manager skill — the manager controls the "
                "capitalisation allocation, so style integrity asks whether cap "
                "moves are deliberate or drift.",
    },
    "Multi Cap": {
        "mandate": "≥75% equity; ≥25% each in large/mid/small",
        "benchmark": "NIFTY500 Multicap 50:25:25 TRI", "role": "Core-plus",
        "horizon": "5–7 yrs", "depth": [2, 3],
        "note": "Not interchangeable with Flexi Cap. The structural 25% floors give "
                "it permanently higher small-cap exposure, volatility and drawdowns.",
    },
    "Mid Cap": {
        "mandate": "≥65% in mid-cap equity",
        "benchmark": "Nifty Midcap 150 TRI", "role": "Satellite growth",
        "horizon": "7+ yrs", "depth": [2, 3],
        "note": "Capacity scored hard — past roughly ₹25–30,000 cr, impact costs "
                "erode exactly the alpha the fund was bought for.",
    },
    "Small Cap": {
        "mandate": "≥65% in small-cap equity",
        "benchmark": "Nifty Smallcap 250 TRI", "role": "Satellite; highest risk-reward",
        "horizon": "7–10 yrs", "depth": [2, 3],
        "note": "Dominant failure modes are drawdown damage, illiquid tails and AUM "
                "outgrowing the strategy — not insufficient upside.",
    },
    "Focused": {
        "mandate": "≤30 stocks; ≥65% equity; stated focus",
        "benchmark": "Nifty 500 TRI (per focus)", "role": "Satellite; high conviction",
        "horizon": "5–7 yrs", "depth": [2, 2],
        "note": "Concentration is the mandate, so C2 judgement inverts.",
    },
    "Value / Contra": {
        "mandate": "≥65% equity; value or contrarian style",
        "benchmark": "Nifty 500 Value 50 TRI / Nifty 500 TRI",
        "role": "Satellite; style diversifier", "horizon": "7+ yrs", "depth": [2, 2],
        "note": "Consistency of the value discipline is judged across a full style "
                "cycle; penalising a value fund for growth-led headwinds is a "
                "framework error, not a fund failure.",
    },
    "Dividend Yield": {
        "mandate": "≥65% equity, predominantly dividend-yielding",
        "benchmark": "Nifty Dividend Opportunities 50 TRI",
        "role": "Satellite; defensive tilt", "horizon": "5+ yrs", "depth": [1, 2],
        "note": "Thin, defensive category where cost is a larger differentiator and "
                "peer sets are too small for percentile logic.",
    },
    "ELSS": {
        "mandate": "≥80% equity; 3-year lock-in per unit",
        "benchmark": "Nifty 500 TRI", "role": "Core, tax-linked (80C old regime)",
        "horizon": "Lock 3; hold 5+", "depth": [1, 2],
        "note": "Positioned on merit first and tax second — an ELSS recommendation "
                "that cannot stand without the deduction should not be made.",
    },
    "Sectoral / Thematic": {
        "mandate": "≥80% in stated sector/theme",
        "benchmark": "Sector / theme index TRI", "role": "Tactical only",
        "horizon": "3–5 yrs", "depth": [1, 2],
        "note": "The framework ranks funds within a theme; it does not validate the "
                "theme. NFO waves cluster near sector peaks — treated as a "
                "contrarian signal, not a menu.",
    },
}

# --------------------------------------------------------------------------- #
# §5  Stage 1 — hard gates
# --------------------------------------------------------------------------- #

GATES = [
    {
        "code": "G1", "name": "Vintage",
        "threshold": "≥5 years live track record in the current mandate; ≥7 years "
                     "preferred for Mid, Small and Value/Contra (the record must span "
                     "a full drawdown such as 2018–20). ≥3 years acceptable only where "
                     "the named manager has a verifiable ≥5-year record in an "
                     "identical strategy.",
        "rationale": "Three-year numbers earned in a bull market are close to noise. "
                     "A fund should have been tested by at least one cycle it did not enjoy.",
        "automated": True,
    },
    {
        "code": "G2", "name": "AUM floor",
        "threshold": "≥₹1,000 cr for Large/Flexi/L&M/ELSS; ≥₹750 cr for Multi; "
                     "≥₹500 cr for Mid/Small/Focused/Value; ≥₹250 cr for Dividend "
                     "Yield and Sectoral/Thematic.",
        "rationale": "Filters viability and institutional-neglect risk, not quality. "
                     "Sub-scale funds face TER pressure and forced-merger risk.",
        "automated": True,
    },
    {
        "code": "G3", "name": "Manager tenure",
        "threshold": "Named FM ≥3 years on this fund, or a documented team-based "
                     "process that survived its last transition.",
        "rationale": "Otherwise the track record scored in Pillar A belongs to someone "
                     "who no longer runs the money.",
        "automated": False,
    },
    {
        "code": "G4", "name": "Regulatory record",
        "threshold": "No material SEBI enforcement action against the AMC or fund in "
                     "the last 3 years (front-running, mis-selling, NAV manipulation).",
        "rationale": "Governance failures are portfolio risks that never show in NAV "
                     "until they do.",
        "automated": False,
    },
    {
        "code": "G5", "name": "Mandate compliance",
        "threshold": "No breach of the SEBI category definition in the last 8 quarters; "
                     "no unexplained style drift.",
        "rationale": "A mislabeled fund corrupts every category-relative comparison "
                     "downstream of it.",
        "automated": True,
    },
    {
        "code": "G6", "name": "Structure",
        "threshold": "Open-ended, daily liquidity, direct plan and growth option "
                     "available.",
        "rationale": "Advisory hygiene; the research universe is direct-growth only.",
        "automated": True,
    },
    {
        "code": "G7", "name": "Concentration sanity",
        "threshold": "Top-10 holdings ≤60% (diversified categories); single stock ≤10% "
                     "with no persistent hugging of the cap. Judged against "
                     "Focused-category norms for Focused funds.",
        "rationale": "Extreme books make peer scoring meaningless and embed exit risk.",
        "automated": True,
    },
]

# §5 G2 — AUM floors in ₹ cr.
AUM_FLOOR_CR = {
    "Large Cap": 1000, "Flexi Cap": 1000, "Large & Mid Cap": 1000, "ELSS": 1000,
    "Multi Cap": 750,
    "Mid Cap": 500, "Small Cap": 500, "Focused": 500, "Value / Contra": 500,
    "Dividend Yield": 250, "Sectoral / Thematic": 250,
}

# §5 G1 — vintage in years; categories needing a longer record are listed separately.
VINTAGE_YEARS = 5
VINTAGE_YEARS_PREFERRED = {"Mid Cap": 7, "Small Cap": 7, "Value / Contra": 7}

# §5 G5 — SEBI market-cap mandate minimums that can be tested against the
# disclosed allocation. Value/Contra, Focused and Sectoral mandates are stylistic
# and are not machine-testable, so they are not listed.
MANDATE_MINIMUMS = {
    "Large Cap": {"large": 80},
    "Large & Mid Cap": {"large": 35, "mid": 35},
    "Multi Cap": {"large": 25, "mid": 25, "small": 25},
    "Mid Cap": {"mid": 65},
    "Small Cap": {"small": 65},
    "Flexi Cap": {"equity": 65},
    "ELSS": {"equity": 80},
    "Dividend Yield": {"equity": 65},
    "Sectoral / Thematic": {"equity": 80},
    "Focused": {"equity": 65},
    "Value / Contra": {"equity": 65},
}

# §5 G7 — concentration ceilings. Focused funds are judged against Focused norms.
CONCENTRATION_LIMITS = {
    "default": {"top10": 60, "single": 10},
    "Focused": {"top10": 85, "single": 12},
}

# §5.1 — soft flags. These lower scores; they never remove eligibility.
SOFT_FLAGS = {
    "ter_above_median_bps": 30,
    "capacity_ceiling_cr": {"Mid Cap": 30000, "Small Cap": 20000},
}

# --------------------------------------------------------------------------- #
# §6  Stage 2 — scoring architecture
# --------------------------------------------------------------------------- #

PILLARS = {
    "A": {
        "name": "Performance quality",
        "what": "Rolling returns vs benchmark TRI and category; consistency of rolling "
                "windows; Jensen's alpha; behaviour across calendar-year cycles.",
        "base": 30,
    },
    "B": {
        "name": "Risk & downside",
        "what": "Downside capture, maximum drawdown vs benchmark, volatility, Sortino, "
                "beta stability — how the fund loses money matters more than how it "
                "makes it.",
        "base": 24,
    },
    "C": {
        "name": "Portfolio & style integrity",
        "what": "Mandate fidelity, concentration, liquidity of underlying holdings, "
                "active share, turnover.",
        "base": 20,
    },
    "D": {
        "name": "Fund house & manager",
        "what": "Attributable manager record, AMC process and team depth, AUM adequacy "
                "and capacity discipline, governance history.",
        "base": 16,
    },
    "E": {
        "name": "Cost & operations",
        "what": "Direct-plan TER vs category, net-of-cost alpha, disclosure quality.",
        "base": 10,
    },
}

# §7 — category-adjusted pillar weights. Workbook Weights!B5:L9.
PILLAR_WEIGHTS = {
    #                     A   B   C   D   E
    "Large Cap":         {"A": 28, "B": 22, "C": 17, "D": 15, "E": 18},
    "Large & Mid Cap":   {"A": 30, "B": 24, "C": 18, "D": 16, "E": 12},
    "Flexi Cap":         {"A": 30, "B": 24, "C": 20, "D": 16, "E": 10},
    "Multi Cap":         {"A": 28, "B": 26, "C": 20, "D": 16, "E": 10},
    "Mid Cap":           {"A": 28, "B": 28, "C": 20, "D": 16, "E": 8},
    "Small Cap":         {"A": 24, "B": 32, "C": 22, "D": 16, "E": 6},
    "Focused":           {"A": 30, "B": 26, "C": 18, "D": 18, "E": 8},
    "Value / Contra":    {"A": 28, "B": 24, "C": 20, "D": 18, "E": 10},
    "Dividend Yield":    {"A": 26, "B": 24, "C": 18, "D": 16, "E": 16},
    "ELSS":              {"A": 30, "B": 24, "C": 18, "D": 16, "E": 12},
    "Sectoral / Thematic": {"A": 24, "B": 30, "C": 22, "D": 18, "E": 6},
}

WEIGHT_RATIONALE = {
    "Large Cap": "Alpha dispersion is thin since TRI benchmarking; cost (18%) and "
                 "active share decide outcomes. A large-cap fund charging 1% direct "
                 "TER needs exceptional evidence against an index fund at a tenth of "
                 "the price.",
    "Flexi Cap": "The truest test of manager skill — performance and risk carry full "
                 "weight, and style integrity asks whether cap moves are deliberate.",
    "Multi Cap": "Risk rises above Flexi (26%) for the structural small-cap floor; "
                 "forced 25/25/25 rebalancing makes turnover and liquidity informative.",
    "Mid Cap": "Risk at 28% and capacity (D3) scored hard — past ₹25–30,000 cr impact "
               "costs erode exactly the alpha the fund was bought for.",
    "Small Cap": "Risk rises to 32% with portfolio/liquidity at 22%. Cost falls to 6% "
                 "because a small-cap fund is never selected or rejected on TER.",
    "Focused": "Concentrated books amplify manager judgement, so Pillar D rises to 18%.",
    "Value / Contra": "Contrarian styles amplify manager judgement (D at 18%); the "
                      "value discipline is judged across a full style cycle.",
    "Dividend Yield": "A thin, defensive category where cost (16%) is a larger "
                      "differentiator and absolute bands do the work.",
    "ELSS": "Weights mirror Flexi with a higher cost weight (12%) since the three-year "
            "lock-in constrains the exit and raises the cost of a wrong selection.",
    "Sectoral / Thematic": "Risk 30%, portfolio/liquidity 22% — theme risk is the "
                           "dominant exposure and the theme call is made elsewhere.",
    "Large & Mid Cap": "Balanced weights; the mid sleeve carries the differentiation.",
}

# §6.3 — the 21 parameters. 'share' is the share of the parameter within its
# pillar (workbook Weights!D14:D34).
PARAMETERS = [
    {"code": "A1", "pillar": "A", "share": 33.3333,
     "name": "Rolling 3Y/5Y returns vs benchmark & category",
     "measure": "Median of daily-rolled 3Y and 5Y CAGRs over the last 7–10 years vs "
                "benchmark TRI and category median. Never point-to-point.",
     "bands": {"5": "Median rolling CAGR > TRI +3% p.a.; top decile of category",
               "3": "Roughly in line with TRI / category median",
               "1": "Median rolling CAGR < TRI −2%; bottom quartile"},
     "source": "quant"},
    {"code": "A2", "pillar": "A", "share": 26.6667,
     "name": "Rolling-return consistency",
     "measure": "% of all 3Y rolling windows (daily roll, 7–10 yrs) beating benchmark TRI.",
     "bands": {"5": ">70% of windows", "3": "50–60% of windows", "1": "<40% of windows"},
     "source": "quant"},
    {"code": "A3", "pillar": "A", "share": 20,
     "name": "Alpha (Jensen's), 3Y & 5Y",
     "measure": "Regression alpha vs benchmark TRI on monthly data.",
     "bands": {"5": ">+2.5% p.a. both horizons, persistent", "3": "~0 to +1%",
               "1": "Negative at both horizons"},
     "source": "quant"},
    {"code": "A4", "pillar": "A", "share": 20,
     "name": "Performance across market cycles",
     "measure": "Calendar-year category quartiles over the last 7 years; behaviour in "
                "stress years (2020 fall, 2022, latest correction).",
     "bands": {"5": "≥5 of 7 yrs in top-2 quartiles; protected in stress years",
               "3": "3–4 of 7 yrs top-2 quartiles",
               "1": "≤2 of 7; bottom quartile in stress years"},
     "source": "quant"},

    {"code": "B1", "pillar": "B", "share": 28,
     "name": "Downside capture ratio",
     "measure": "3Y and 5Y downside capture vs benchmark TRI.",
     "bands": {"5": "<85", "3": "95–105", "1": ">115 — triggers automatic Hold cap"},
     "source": "quant"},
    {"code": "B2", "pillar": "B", "share": 20,
     "name": "Maximum drawdown vs benchmark",
     "measure": "Depth and recovery time of the 5-year maximum drawdown vs benchmark "
                "and category.",
     "bands": {"5": "Notably shallower, faster recovery", "3": "In line with benchmark",
               "1": "Deeper by >1.25×, slow recovery"},
     "source": "quant"},
    {"code": "B3", "pillar": "B", "share": 16,
     "name": "Standard deviation vs category",
     "measure": "3Y annualised SD vs category median.",
     "bands": {"5": "Lowest quartile", "3": "Around median", "1": "Highest quartile"},
     "source": "quant"},
    {"code": "B4", "pillar": "B", "share": 20,
     "name": "Sortino ratio",
     "measure": "3Y Sortino vs category median.",
     "bands": {"5": "Top quartile", "3": "Median", "1": "Bottom quartile"},
     "source": "quant"},
    {"code": "B5", "pillar": "B", "share": 16,
     "name": "Beta stability",
     "measure": "Rolling 1Y beta band width over 3 years.",
     "bands": {"5": "Band <0.10 — disciplined process", "3": "Band 0.15–0.25",
               "1": "Band >0.35 / erratic cash calls"},
     "source": "quant"},

    {"code": "C1", "pillar": "C", "share": 25,
     "name": "Style consistency / mandate fidelity",
     "measure": "Holdings-based drift vs the SEBI mandate; style-box drift over 12 quarters.",
     "bands": {"5": "Zero breaches; stable style through cycles",
               "3": "Minor drift, explained and reversed",
               "1": "Repeated or unexplained drift; closet large-cap flexi"},
     "source": "holdings"},
    {"code": "C2", "pillar": "C", "share": 20,
     "name": "Concentration",
     "measure": "Top-10 % and top-3 sector active weights vs category norms "
                "(judgement inverts for Focused).",
     "bands": {"5": "Top-10 <40%; disciplined sector actives", "3": "Top-10 45–55%",
               "1": "Top-10 >60% or single-sector active >12%"},
     "source": "holdings"},
    {"code": "C3", "pillar": "C", "share": 25,
     "name": "Portfolio liquidity",
     "measure": "Days to liquidate 50%/90% of the portfolio at 20% of ADTV; AMC "
                "stress-test disclosures.",
     "bands": {"5": ">90% liquidatable in 10 days", "3": "90% in 20–30 days",
               "1": "90% takes >60 days"},
     "source": "holdings"},
    {"code": "C4", "pillar": "C", "share": 15,
     "name": "Active share",
     "measure": "Active share vs benchmark — flags closet indexing, especially in Large Cap.",
     "bands": {"5": ">70% (Large Cap: >60%)", "3": "50–60%", "1": "<40% — closet indexer"},
     "source": "holdings"},
    {"code": "C5", "pillar": "C", "share": 15,
     "name": "Portfolio turnover",
     "measure": "Turnover vs stated process and category median.",
     "bands": {"5": "Consistent with process; below median", "3": "Around median, stable",
               "1": "Erratic spikes; churn without narrative"},
     "source": "judgement"},

    {"code": "D1", "pillar": "D", "share": 33.3333,
     "name": "FM tenure & attributable record",
     "measure": "Tenure on THIS fund plus verifiable prior identical-mandate record; "
                "co-PM continuity.",
     "bands": {"5": ">7 yrs with attributable alpha",
               "3": "3–5 yrs, or shorter with strong identical-mandate record",
               "1": "<2 yrs, no comparable record"},
     "source": "judgement"},
    {"code": "D2", "pillar": "D", "share": 33.3333,
     "name": "AMC process, team depth & stability",
     "measure": "Documented repeatable process; bench strength; CIO/team attrition; "
                "sponsor commitment.",
     "bands": {"5": "Institutionalised process; deep bench; low attrition",
               "3": "Adequate; some key-person dependence",
               "1": "Process = star manager; high attrition; sponsor uncertainty"},
     "source": "judgement"},
    {"code": "D3", "pillar": "D", "share": 20,
     "name": "AUM adequacy & capacity",
     "measure": "AUM vs strategy capacity; growth pace; willingness to soft-close.",
     "bands": {"5": "Comfortably within capacity; has capped funds before",
               "3": "Adequate; watch growth pace",
               "1": "Sub-scale, or bloated with no capacity discipline"},
     "source": "quant"},
    {"code": "D4", "pillar": "D", "share": 13.3334,
     "name": "Governance & compliance history",
     "measure": "SEBI actions, front-running, related-party issues, key-person exits "
                "under a cloud, side-pockets.",
     "bands": {"5": "Clean 5-yr record; strong compliance culture",
               "3": "Minor administrative observations only",
               "1": "Material SEBI action / governance events"},
     "source": "judgement"},

    {"code": "E1", "pillar": "E", "share": 50,
     "name": "TER (direct plan) vs category median",
     "measure": "Direct-plan TER percentile within category.",
     "bands": {"5": "Bottom quartile (cheapest)", "3": "Around median",
               "1": "Top quartile (most expensive)"},
     "source": "quant"},
    {"code": "E2", "pillar": "E", "share": 30,
     "name": "Net-of-cost alpha",
     "measure": "Rolling 3Y direct-plan alpha after TER.",
     "bands": {"5": "Clearly positive after costs", "3": "Marginally positive",
               "1": "Gross alpha fully consumed by TER"},
     "source": "quant"},
    {"code": "E3", "pillar": "E", "share": 20,
     "name": "Disclosure & reporting quality",
     "measure": "Factsheet depth, attribution disclosure, FM access, responsiveness.",
     "bands": {"5": "Detailed attribution; FM accessible", "3": "Standard disclosures",
               "1": "Opaque; poor responsiveness"},
     "source": "judgement"},
]

PARAM_BY_CODE = {p["code"]: p for p in PARAMETERS}

# --------------------------------------------------------------------------- #
# §8  Stage 3 — classification
# --------------------------------------------------------------------------- #

CLASSIFICATION_BANDS = [
    {"min": 75, "label": "Core Whitelist", "tone": "core",
     "action": "Recommended for fresh allocations across client IPS mandates; eligible "
               "for model portfolios after one quarter of cooling-in."},
    {"min": 65, "label": "Satellite / Watch-in", "tone": "satellite",
     "action": "Usable selectively (satellite sleeves, specific mandates); reviewed for "
               "promotion each quarter."},
    {"min": 50, "label": "Hold — no fresh flows", "tone": "hold",
     "action": "Existing holdings retained subject to tax and exit-load economics; no "
               "new money."},
    {"min": 0, "label": "Exit / Reject", "tone": "exit",
     "action": "Structured, tax-aware, staggered exit for holders; rejected for prospects."},
]

OVERLAY_CAP = 5           # §8.2 — IC overlay, ± points, expires after 2 quarters
RISK_CAP_PARAM = "B1"     # §8.3 — downside capture
RISK_CAP_SCORE = 1        # a B1 score at or below this caps classification at Hold
RISK_CAP_LABEL = "Hold — no fresh flows"

# --------------------------------------------------------------------------- #
# §6.2  Quant Helper — raw metric → suggested band score
# Mirrors the workbook's Quant Helper formulas exactly.
# 'desc' means lower is better.
# --------------------------------------------------------------------------- #

QUANT_BANDS = {
    "A2": {"dir": "asc", "cuts": [70, 60, 50, 40],
           "label": "% of 3Y rolling windows beating benchmark"},
    "B1": {"dir": "desc", "cuts": [85, 95, 105, 115],
           "label": "Downside capture (%)"},
    "B3": {"dir": "desc", "cuts": [0.85, 0.95, 1.05, 1.15],
           "label": "SD ÷ category median SD"},
    "B4": {"dir": "asc", "cuts": [1.3, 1.1, 0.9, 0.7],
           "label": "Sortino ÷ category median Sortino"},
    "C3": {"dir": "desc", "cuts": [10, 20, 30, 60],
           "label": "Days to liquidate 90% of portfolio"},
    "C4": {"dir": "asc", "cuts": [70, 60, 50, 40], "label": "Active share (%)"},
    "E1": {"dir": "desc", "cuts": [25, 40, 60, 75],
           "label": "Direct TER percentile in category (0 = cheapest)"},
}


def band_score(code, value):
    """Convert a raw metric to a 1–5 band score using the Quant Helper cuts.

    Returns None when the metric is absent — the caller then applies the policy's
    'score 3 and flag' convention (§6.2) rather than guessing.
    """
    spec = QUANT_BANDS.get(code)
    if spec is None or value is None:
        return None
    cuts = spec["cuts"]
    if spec["dir"] == "asc":
        for i, cut in enumerate(cuts):
            if value >= cut:
                return 5 - i
        return 1
    for i, cut in enumerate(cuts):
        # The workbook uses < for the first two cuts and <= thereafter; the
        # distinction only matters exactly on a boundary.
        if (value < cut) if i < 2 else (value <= cut):
            return 5 - i
    return 1


# --------------------------------------------------------------------------- #
# §9–10  Whitelist construction & IPS guardrails
# --------------------------------------------------------------------------- #

WHITELIST_RULES = [
    {"rule": "Depth", "guideline": "Two to four funds per category.",
     "rationale": "Fewer concentrates advisor risk in a single manager; more dilutes "
                  "conviction and stretches monitoring quality."},
    {"rule": "Diversification of style and AMC",
     "guideline": "Prefer complementary styles within a category. No more than two "
                  "funds from one AMC per category, and no AMC above roughly 25% of "
                  "the full whitelist.",
     "rationale": "One GARP and one value large-cap fund serve a client better than "
                  "two momentum twins."},
    {"rule": "Share class", "guideline": "Direct plans, growth option, in advisory mandates.",
     "rationale": "Regular plans only where the engagement model requires it, and "
                  "disclosed as such."},
    {"rule": "Cooling-in",
     "guideline": "A newly admitted Core fund enters model portfolios only after one "
                  "full quarter on the whitelist.",
     "rationale": "One great quarter is not a promotion case."},
    {"rule": "Re-entry lockout",
     "guideline": "A fund that exits the whitelist cannot return for at least four "
                  "quarters, and only through the full admission process.",
     "rationale": "The framework's decisions must cost something, or they will be "
                  "reversed casually."},
    {"rule": "Tax-aware exits",
     "guideline": "Removal stops fresh flows immediately; client-level exits are "
                  "sequenced for LTCG efficiency, exit loads and redeployment.",
     "rationale": "A 'no fresh flows' state can legitimately persist for quarters; "
                  "client outcomes beat framework tidiness."},
]

IPS_GUARDRAILS = [
    {"rule": "Single-AMC cap", "limit": 25, "unit": "% of client MF assets",
     "guideline": "≤25% of client MF assets with one AMC.",
     "rationale": "Sponsor and governance event risk.", "test": "amc_max"},
    {"rule": "Single-scheme cap", "limit": 15, "unit": "% of client MF assets",
     "guideline": "≤15% of client MF assets in one scheme.",
     "rationale": "Manager, key-person and capacity risk.", "test": "scheme_max"},
    {"rule": "Core floor", "limit": 50, "unit": "% of equity",
     "guideline": "≥50–60% of equity in Core-classified funds from Large, Flexi, "
                  "Large & Mid, or ELSS.",
     "rationale": "The portfolio is anchored first; satellites earn their place on top.",
     "test": "core_floor"},
    {"rule": "Satellite cap", "limit": 40, "unit": "% of equity",
     "guideline": "Mid + Small + Focused + Value + Multi combined ≤40% of equity, "
                  "risk-profile dependent.",
     "rationale": "Bounds portfolio-level drawdown.", "test": "satellite_cap"},
    {"rule": "Tactical cap", "limit": 15, "unit": "% of equity",
     "guideline": "Sectoral/Thematic combined ≤10–15% of equity, with pre-agreed exit "
                  "triggers.",
     "rationale": "Theme-timing risk sits with the client; keep it survivable.",
     "test": "tactical_cap"},
    {"rule": "Fund count", "limit": 10, "unit": "schemes",
     "guideline": "6–10 schemes for most portfolios.",
     "rationale": "Beyond roughly ten, holdings overlap makes the portfolio an "
                  "expensive index fund.", "test": "fund_count"},
    {"rule": "Rebalancing", "limit": 5, "unit": "pp drift",
     "guideline": "Annual, or on ±5 percentage-point drift from IPS bands; fresh flows "
                  "deployed first.",
     "rationale": "Disciplined mean-reversion without unnecessary LTCG realisation.",
     "test": None},
]

CORE_CATEGORIES = {"Large Cap", "Flexi Cap", "Large & Mid Cap", "ELSS"}
SATELLITE_CATEGORIES = {"Mid Cap", "Small Cap", "Focused", "Value / Contra", "Multi Cap"}
TACTICAL_CATEGORIES = {"Sectoral / Thematic"}

MAX_FUNDS_PER_AMC_PER_CATEGORY = 2
MAX_AMC_SHARE_OF_WHITELIST = 25  # %

# --------------------------------------------------------------------------- #
# §11  Monitoring & review governance
# --------------------------------------------------------------------------- #

MONITORING_CADENCE = [
    {"frequency": "Monthly",
     "activity": "Factsheet scan of whitelisted funds — portfolio changes, AUM moves, "
                 "manager changes, cash levels — plus a guardrail dashboard of "
                 "down-capture, volatility and drawdown against category bands.",
     "output": "Exception log only; no action unless a trigger fires."},
    {"frequency": "Quarterly",
     "activity": "Full scorecard refresh for all whitelisted and Watch funds; "
                 "classification changes minuted; the whole category universe screened "
                 "for new gate-passers.",
     "output": "IC memo; client-facing whitelist update."},
    {"frequency": "Semi-annual",
     "activity": "Qualitative refresh: AMC meetings, manager continuity, capacity; "
                 "impact of the AMFI market-cap reclassification (January and July lists).",
     "output": "Research and advisory note."},
    {"frequency": "Annual",
     "activity": "Full re-underwrite including AMC and manager meetings for every "
                 "whitelisted fund; review of the weight matrix itself; back-test of "
                 "the framework's own hit rate.",
     "output": "IC sign-off; workbook and policy version-controlled together."},
]

TRIGGERS = [
    {"code": "T1", "trigger": "Fund manager exit or change of named FM",
     "response": "Review within 15 days; fund to Watch; fresh flows frozen until the IC "
                 "re-approves.", "automated": False},
    {"code": "T2", "trigger": "AMC ownership change, sponsor exit, CIO exit",
     "response": "Full re-underwrite within one quarter.", "automated": False},
    {"code": "T3", "trigger": "Rolling 3Y alpha negative for 4 consecutive quarters",
     "response": "Watch, with a two-quarter cure period — distinguishing a style "
                 "headwind (hold) from process breakdown (exit).", "automated": True},
    {"code": "T4",
     "trigger": "Drawdown deeper than 1.25× the benchmark drawdown in a correction",
     "response": "Risk review; test whether the losses are consistent with the stated "
                 "style.", "automated": True},
    {"code": "T5",
     "trigger": "AUM doubles within 12 months, or falls >40% ex-market (mid/small/focused)",
     "response": "Capacity and liquidity review; establish who is buying or selling, "
                 "and why.", "automated": False},
    {"code": "T6", "trigger": "Style drift or mandate breach",
     "response": "Immediate Watch; exit if unremedied within two quarters.",
     "automated": True},
    {"code": "T7", "trigger": "Final score below 65 at the quarterly refresh",
     "response": "Watch; below 50 initiates the exit protocol.", "automated": True},
    {"code": "T8", "trigger": "Governance event (front-running, SEBI action)",
     "response": "Immediate suspension from the whitelist pending IC review.",
     "automated": False},
]

WATCH_MAX_QUARTERS = 2
REENTRY_LOCKOUT_QUARTERS = 4

# --------------------------------------------------------------------------- #
# §2  Philosophy — surfaced in the UI so the numbers stay attached to their reasons
# --------------------------------------------------------------------------- #

PRINCIPLES = [
    {"n": "2.1", "title": "Rolling returns, never point-to-point",
     "body": "Point-to-point returns are hostage to their start and end dates. Rolling "
             "analysis asks the only question that matters to a client who may invest "
             "on any given day."},
    {"n": "2.2", "title": "TRI benchmarks, direct plans, honest comparisons",
     "body": "Price-return indices overstate alpha by roughly the dividend yield; "
             "regular plans understate fund quality by embedding distribution costs. "
             "Both distortions are excluded by convention, not by analyst discretion."},
    {"n": "2.3", "title": "Losses matter more than gains",
     "body": "Downside behaviour is weighted at or above upside capture throughout. For "
             "UHNI portfolios the dominant destroyers of outcomes are permanent capital "
             "impairment and behavioural abandonment during drawdowns."},
    {"n": "2.4", "title": "Process over outcome",
     "body": "A five-year number tells you what happened; the process tells you whether "
             "it can happen again. 70–76% of every score is determined by how a fund "
             "earns returns, not by the returns themselves."},
    {"n": "2.5", "title": "Gates and triggers override scores",
     "body": "A fund can score well and still be rejected on gates; a whitelisted fund "
             "can be exited on triggers regardless of score."},
    {"n": "2.6", "title": "Auditability and self-correction",
     "body": "Every decision is minuted. Once a year the framework examines its own hit "
             "rate — a selection framework that never audits itself calcifies into a "
             "set of superstitions."},
]

# The reasoning behind the machinery, written out for the Approach page. Each
# section states a position, the failure mode it exists to prevent, and where in
# the framework it is actually enforced — so the page is an explanation of the
# working system rather than a mission statement sitting beside it.
APPROACH = [
    {
        "id": "question",
        "title": "We separate three questions that are usually asked as one",
        "lede": "Most fund debates go wrong because eligibility, quality and "
                "suitability get argued simultaneously.",
        "body": [
            "A committee that asks 'is this a good fund?' will end up debating a "
            "star performer's three-year return when the real issue is that its "
            "manager left last month. The framework refuses to let those questions "
            "merge. Stage 1 asks only whether a fund can be considered at all — "
            "seven pass/fail gates, no scores involved. Stage 2 asks how good it is "
            "against its own category peers. Stage 3 asks what to do with it for a "
            "client.",
            "Keeping them apart is what makes the answer explainable. When a fund is "
            "rejected you can say which gate and why; when it is ranked you can "
            "decompose the score to the parameter; when it is recommended you can "
            "point to the classification band and the client's IPS separately.",
        ],
        "enforced": "Stages 1–3 run in that order. A gate failure short-circuits the "
                    "classification regardless of composite.",
    },
    {
        "id": "rolling",
        "title": "Rolling returns, never point-to-point",
        "lede": "A single strong quarter at either end can reorder an entire "
                "category league table.",
        "body": [
            "Point-to-point returns are hostage to their start and end dates. Pick a "
            "different Tuesday and the ranking changes. That is not a measurement of "
            "skill; it is a measurement of when you happened to look.",
            "All return evaluation uses rolling windows — 3-year and 5-year CAGRs "
            "rolled daily over the trailing 7–10 years — against the benchmark Total "
            "Return Index and the category. The question this answers is the only one "
            "that matters to a client who may invest on any given day: what would "
            "this fund have done for me across all entry points, not just the one "
            "that flatters it.",
        ],
        "enforced": "A1 scores the median rolling CAGR against the benchmark TRI. A2 "
                    "scores the consistency of that record rather than its level.",
    },
    {
        "id": "downside",
        "title": "Losses matter more than gains",
        "lede": "For UHNI portfolios the dominant destroyers of outcomes are "
                "permanent capital impairment and behavioural abandonment.",
        "body": [
            "The framework weights downside behaviour at or above upside capture "
            "everywhere, and the risk pillar rises to 32% in Small Cap. The reason is "
            "client behaviour, not statistics. A fund that falls 60% and recovers has "
            "still cost the client who redeemed at the bottom — and that client is "
            "not a hypothetical.",
            "One parameter is given power over the whole scorecard. A fund whose "
            "downside capture exceeds 115% is capped at Hold no matter how high its "
            "composite. That cap is computed arithmetically rather than left to "
            "committee memory, because the single most predictable committee failure "
            "is forgiving bad downside behaviour in a fund whose headline number is "
            "attractive.",
        ],
        "enforced": "B1 carries 28% of the risk pillar and triggers the automatic "
                    "classification cap. B2–B5 cover drawdown, volatility, Sortino "
                    "and beta stability.",
    },
    {
        "id": "process",
        "title": "Process over outcome",
        "lede": "A five-year number tells you what happened; the process tells you "
                "whether it can happen again.",
        "body": [
            "Past performance is a screen, not a forecast. Between 70% and 76% of "
            "every fund's score is determined by how it earns its returns, what it "
            "costs and who runs it — not by the returns themselves. The Fund House & "
            "Manager and Portfolio & Style pillars together carry 32–40% because "
            "process quality, capacity discipline, team depth and mandate fidelity "
            "are the best forward-looking indicators available.",
            "This is a deliberate hedge against the industry's most reliable error, "
            "which is buying last cycle's winner at the moment its cycle ends.",
        ],
        "enforced": "Pillar A never exceeds 30% of the composite in any category.",
    },
    {
        "id": "category",
        "title": "Every comparison is category-relative",
        "lede": "A small-cap fund is never compared with a large-cap fund on any "
                "metric.",
        "body": [
            "Each category is a separate peer set with its own benchmark, its own "
            "risk expectations and its own pillar weights. Comparing across "
            "categories confuses an allocation decision — which belongs to the "
            "client's IPS — with a selection decision, which belongs here.",
            "The weights themselves move by category, because the same 'performance' "
            "number means different things in different places. In Large Cap, alpha "
            "dispersion is thin since TRI benchmarking, so cost rises to 18% and "
            "active share decides outcomes: a large-cap fund charging 1% needs "
            "exceptional evidence against an index fund at a tenth of the price. In "
            "Small Cap, cost falls to 6% because no small-cap fund is ever selected "
            "or rejected on TER, while risk rises to 32%.",
            "Category medians are computed over gate-passing funds only, so a flood "
            "of young launches cannot drag the peer standard down and make everything "
            "else look better than it is.",
        ],
        "enforced": "An 11 × 5 weight matrix, and every percentile in this dashboard "
                    "computed within category over eligible funds.",
    },
    {
        "id": "gates",
        "title": "Gates and triggers beat scores",
        "lede": "A fund can score 85 and still be rejected.",
        "body": [
            "The seven gates are eligibility tests, not quality measures. Vintage, "
            "AUM floor, manager tenure, regulatory record, mandate compliance, "
            "structure and concentration sanity. Failing any one removes a fund for "
            "the cycle regardless of its composite — and in the current universe "
            "several funds scoring above 80 are rejected on the five-year vintage "
            "gate alone. That is the gate working as designed. Three-year numbers "
            "earned in a bull market are close to noise; a fund should have been "
            "tested by at least one cycle it did not enjoy.",
            "The same asymmetry runs the other way after admission. Event triggers "
            "act between review cycles and override scores: a manager exit freezes "
            "fresh flows within fifteen days, a mandate breach means immediate Watch, "
            "a governance event means immediate suspension. The framework does not "
            "wait for the quarter when the facts change.",
        ],
        "enforced": "Stage 1 gates, and eight event triggers monitored continuously.",
    },
    {
        "id": "evidence",
        "title": "A data gap is disclosed, never filled",
        "lede": "Where a parameter has no data it scores 3 and is flagged. An "
                "analyst never guesses.",
        "body": [
            "This is the convention that keeps the framework honest, and this "
            "dashboard follows it literally. Every parameter reports whether its "
            "score was measured from data, derived from the disclosed portfolio, or "
            "assigned by convention — and every fund carries an evidence figure: the "
            "share of its total weight resting on measured evidence.",
            "Two gates are reported as unassessable rather than passed. Manager "
            "tenure and regulatory record cannot be tested from the wired sources, "
            "and silently passing a gate you have not tested would misstate the "
            "eligible universe — which is the one thing a selection framework must "
            "never do. Those stay with Research, visibly, on every scorecard.",
            "Where a metric stands in for another, the substitution is stated on the "
            "parameter itself rather than in a footnote. A2 uses the information "
            "ratio because a true rolling-window hit rate needs a NAV pipeline; C3 "
            "uses the small-cap share of the book because days-to-liquidate needs "
            "security-level volume data.",
        ],
        "enforced": "§6.2. Every score on this dashboard is tagged measured, "
                    "holdings-derived or conventional.",
    },
    {
        "id": "construct",
        "title": "The whitelist is constructed, not accumulated",
        "lede": "Classification produces candidates. It does not produce a list.",
        "body": [
            "Two to four funds per category — fewer concentrates advisor risk in a "
            "single manager, more dilutes conviction and stretches monitoring "
            "quality. No more than two funds from one AMC in a category, and no AMC "
            "above roughly a quarter of the whole list. Within a category, prefer "
            "complementary styles: one GARP and one value large-cap fund serve a "
            "client better than two momentum twins.",
            "Decisions are made to cost something. A newly admitted Core fund waits a "
            "full quarter before entering model portfolios, because one great quarter "
            "is not a promotion case. A fund that leaves cannot return for four "
            "quarters, and only through the full admission process — otherwise "
            "removals get reversed casually and the list becomes a record of recent "
            "performance rather than a set of decisions.",
            "Removal stops fresh flows immediately, but client exits are sequenced "
            "for tax, exit loads and redeployment. A 'no fresh flows' state can "
            "legitimately persist for quarters. Client outcomes beat framework "
            "tidiness.",
        ],
        "enforced": "Depth guidance and the per-AMC caps are applied when the "
                    "whitelist is built; cooling-in and lockout are minuted.",
    },
    {
        "id": "bands",
        "title": "Bands, not percentile ranks",
        "lede": "Percentile ranking is elegant and silently fragile.",
        "body": [
            "Both designs were built and compared. With a thin peer set — Dividend "
            "Yield has eleven funds — percentile ranks become coarse and volatile, "
            "and a fund's score changes depending on which peers the analyst happened "
            "to enter that quarter. Bands are stable, auditable, source-agnostic, and "
            "they force the firm to write down in advance what 'good' means for every "
            "parameter.",
            "The compromise is the Quant Helper: raw metrics convert to suggested band "
            "scores by formula, so the quantitative pillars are disciplined by data "
            "while remaining overridable with written rationale.",
        ],
        "enforced": "1–5 bands for all 21 parameters, with the Quant Helper "
                    "conversion for the seven automatable ones.",
    },
    {
        "id": "audit",
        "title": "The framework audits itself",
        "lede": "A selection framework that never audits itself calcifies into a set "
                "of superstitions.",
        "body": [
            "Once a year the back-test asks two questions of the previous three years "
            "of decisions: did funds the framework exit-listed actually underperform "
            "after removal, and did admissions outperform after addition? Persistent "
            "misses in either direction are treated as evidence against the weight "
            "matrix or the bands, and the amendment is debated with the back-test on "
            "the table.",
            "Discretion exists but is bounded. The Investment Committee may apply a "
            "documented overlay of up to ±5 points for forward-looking information "
            "the model cannot see — an impending manager change, a capacity "
            "commitment, deterioration observed in AMC meetings. It requires written "
            "rationale, expires after two quarters, and cannot lift a fund by more "
            "than one band. Unbounded discretion is how frameworks die.",
        ],
        "enforced": "±5 overlay cap enforced arithmetically; expiry and rationale "
                    "enforced by minute.",
    },
]

METHODOLOGY_CONVENTIONS = [
    "All return metrics on direct-plan growth NAVs.",
    "Risk metrics from monthly returns over a 36-month window unless stated.",
    "Rolling windows rolled daily; risk-free rate 7.0%, reviewed against T-bill yields.",
    "Category median computed over gate-passing funds, not the full universe, so a "
    "flood of young funds cannot distort the peer standard.",
    "Where a benchmark has changed, the TRI series is stitched and the change noted.",
    "Data unavailable ⇒ score 3 and flag. An analyst never guesses.",
]

RISK_FREE_RATE = 7.0

POLICY_META = {
    "title": "Equity Mutual Fund Selection & Monitoring Policy",
    "owner": "Avendus Wealth — Investment Advisory",
    "version": "2.0 (Master)",
    "date": "11 July 2026",
    "companion": "Equity_MF_Selection_Scorecard_MASTER.xlsx",
    "scope": "All eleven SEBI equity scheme categories. Governs scheme selection only; "
             "client-level asset allocation, suitability and taxation are governed by "
             "each client's IPS, which always prevails at the point of recommendation.",
}


def effective_weights(category):
    """Effective parameter weight = pillar weight × share within pillar (§8.1)."""
    pw = PILLAR_WEIGHTS.get(category, {k: v["base"] for k, v in PILLARS.items()})
    return {p["code"]: pw[p["pillar"]] * p["share"] / 100.0 for p in PARAMETERS}


def classify(score):
    for band in CLASSIFICATION_BANDS:
        if score >= band["min"]:
            return band
    return CLASSIFICATION_BANDS[-1]
