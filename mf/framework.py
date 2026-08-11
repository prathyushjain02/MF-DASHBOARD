"""The screener framework, encoded as data.

This is the single source of truth for the model described in
`MF_Screener_Instructions.md`: the seven scoring blocks and their weights, which
metrics are scored and which are shown for context only, the per-category AUM
curves, the band cuts, and the methodology copy that fronts the dashboard.

Design notes that matter, because they are choices and not accidents:

*   Every scored metric becomes a 0-100 percentile **within its own category**, so
    a fund is only ever compared against its true peers. Nothing is scored on an
    absolute scale.
*   Standard deviation, semi standard deviation and Treynor are deliberately not
    scored. They move almost in lockstep with Sortino and downside capture, so
    scoring them would weight volatility several times over. They stay visible.
*   Point to point and CAGR figures are shown for context. The return block scores
    the rolling median, because a point to point number can hang on one lucky
    start or end date.
*   Vintage is a weight, not a gate. Short manager tenure is a flag, not a reject.

House style for anything user facing in this file: no em dashes.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------

# Scope is actively managed equity. Index funds, ETFs and fund of funds are out.
CATEGORIES = [
    "Flexicap",
    "Largecap",
    "Large & Midcap",
    "Multicap",
    "Midcap",
    "Smallcap",
    "Focused",
    "Value / Contra",
    "Dividend Yield",
    "ELSS",
    "Sectoral / Thematic",
]

# Feed category label -> screener category. Anything not listed is out of scope.
CATEGORY_MAP = {
    "flexi cap fund": "Flexicap",
    "flexi cap": "Flexicap",
    "flexicap": "Flexicap",
    "large cap fund": "Largecap",
    "large cap": "Largecap",
    "largecap": "Largecap",
    "large & mid cap fund": "Large & Midcap",
    "large and mid cap fund": "Large & Midcap",
    "large & mid cap": "Large & Midcap",
    "multi cap fund": "Multicap",
    "multi cap": "Multicap",
    "multicap": "Multicap",
    "mid cap fund": "Midcap",
    "mid cap": "Midcap",
    "midcap": "Midcap",
    "small cap fund": "Smallcap",
    "small cap": "Smallcap",
    "smallcap": "Smallcap",
    "focused fund": "Focused",
    "focused": "Focused",
    "value fund": "Value / Contra",
    "contra fund": "Value / Contra",
    "value": "Value / Contra",
    "contra": "Value / Contra",
    "dividend yield fund": "Dividend Yield",
    "dividend yield": "Dividend Yield",
    "elss": "ELSS",
    "elss funds": "ELSS",
    "equity linked savings scheme": "ELSS",
    "tax saver": "ELSS",
    "sectoral / thematic": "Sectoral / Thematic",
    "sectoral/thematic": "Sectoral / Thematic",
    "sectoral": "Sectoral / Thematic",
    "thematic": "Sectoral / Thematic",
    "sectoral funds": "Sectoral / Thematic",
    "thematic funds": "Sectoral / Thematic",
    "thematic fund": "Sectoral / Thematic",
    "sector fund": "Sectoral / Thematic",
}

# Mandate shape by category, used by the portfolio block to test cap-mix fit.
# `floor` is the SEBI minimum in the named bucket; `shape` is what the model
# expects a faithful book to look like. Bounds are share of the equity sleeve.
MANDATE = {
    "Flexicap":            {"note": "Go anywhere, minimum 65% equity.", "bands": {}},
    "Largecap":            {"note": "Minimum 80% in the top 100 by market cap.",
                            "bands": {"large": (80, 100)}},
    "Large & Midcap":      {"note": "Minimum 35% large cap and 35% mid cap.",
                            "bands": {"large": (35, 100), "mid": (35, 100)}},
    "Multicap":            {"note": "Minimum 25% each in large, mid and small.",
                            "bands": {"large": (25, 100), "mid": (25, 100), "small": (25, 100)}},
    "Midcap":              {"note": "Minimum 65% in mid cap.",
                            "bands": {"mid": (65, 100)}},
    "Smallcap":            {"note": "Minimum 65% in small cap.",
                            "bands": {"small": (65, 100)}},
    "Focused":             {"note": "Maximum 30 stocks, any market cap.", "bands": {}},
    "Value / Contra":      {"note": "Minimum 65% equity following a value or contrarian process.",
                            "bands": {}},
    "Dividend Yield":      {"note": "Minimum 65% in dividend yielding stocks.", "bands": {}},
    "ELSS":                {"note": "Minimum 80% equity, three year lock in.", "bands": {}},
    "Sectoral / Thematic": {"note": "Minimum 80% in the stated sector or theme.", "bands": {}},
}

# Categories that are a SEBI label rather than a peer group. Everything in the
# model is scored relative to category peers, and that only means something when
# the peers are doing the same job. Sectoral and thematic funds share a label and
# nothing else: a Taiwan equity fund, a pharma fund and a defence fund sit in one
# bucket, so a percentile inside it compares unlike things and the differentiation
# metric degenerates because no two books overlap.
#
# They are still scored, because execution within a theme is a fair question, but
# the caveat travels with the number everywhere it is shown.
LOOSE_PEER_GROUPS = {
    "Sectoral / Thematic":
        "A SEBI label, not a peer group. These funds hold unrelated universes, so a "
        "percentile inside the category compares a pharma fund with a Taiwan equity "
        "fund. Read the rank as execution within a theme, never as a reason to prefer "
        "one theme over another. Differentiation is not scored here, because two funds "
        "on different themes trivially have no overlap.",
}


def loose_peer_group(category):
    return LOOSE_PEER_GROUPS.get(category)


# Effective number of stocks: the band a faithful book for this category sits in.
# Scored as distance from the band, so both over-diversification and
# over-concentration are marked down. Focused is deliberately tight.
EFFECTIVE_N_BAND = {
    "Flexicap": (20, 45),
    "Largecap": (20, 45),
    "Large & Midcap": (25, 55),
    "Multicap": (30, 60),
    "Midcap": (25, 55),
    "Smallcap": (30, 70),
    "Focused": (12, 25),
    "Value / Contra": (20, 50),
    "Dividend Yield": (20, 45),
    "ELSS": (20, 50),
    "Sectoral / Thematic": (15, 45),
}

# ---------------------------------------------------------------------------
# The seven blocks
# ---------------------------------------------------------------------------
#
# `weight` is the share of the composite. `metrics` lists the inputs, each with
# its own weight *inside* the block and the direction that counts as good.
#
#   direction  "high"  larger raw value scores better
#              "low"   smaller raw value scores better
#              "band"  scored by distance from a target band, handled in code
#
# A block reweights over whichever of its metrics are actually present for a
# fund, and the composite reweights over whichever blocks scored. Nothing is
# filled with a neutral middle value: a gap narrows the evidence base and is
# reported as coverage, it never quietly pushes a fund toward the median.

BLOCKS = [
    {
        "code": "return",
        "name": "Return and consistency",
        "weight": 27,
        "why": "Median rolling return over 3 and 5 years. We read the distribution, "
               "not a single point to point number that can hang on one lucky endpoint.",
        "metrics": [
            {"field": "medianRolling3Y", "label": "Median rolling 3Y", "weight": 55,
             "direction": "high", "unit": "%"},
            {"field": "medianRolling5Y", "label": "Median rolling 5Y", "weight": 45,
             "direction": "high", "unit": "%"},
        ],
    },
    {
        "code": "riskAdj",
        "name": "Risk adjusted",
        "weight": 24,
        "why": "Sharpe, Sortino and Information Ratio over 3 and 5 years. Information "
               "Ratio carries the most weight, since it is return earned per unit of "
               "active risk taken away from the benchmark.",
        "metrics": [
            {"field": "informationRatio3Y", "label": "Information Ratio 3Y", "weight": 24,
             "direction": "high"},
            {"field": "informationRatio5Y", "label": "Information Ratio 5Y", "weight": 20,
             "direction": "high"},
            {"field": "sortino3Y", "label": "Sortino 3Y", "weight": 16,
             "direction": "high"},
            {"field": "sortino5Y", "label": "Sortino 5Y", "weight": 14,
             "direction": "high"},
            {"field": "sharpe3Y", "label": "Sharpe 3Y", "weight": 14,
             "direction": "high"},
            {"field": "sharpe5Y", "label": "Sharpe 5Y", "weight": 12,
             "direction": "high"},
        ],
    },
    {
        "code": "capture",
        "name": "Capture and drawdown",
        "weight": 18,
        "why": "Upside capture, downside capture and maximum drawdown. Rewards funds "
               "that fall less than the market and recover better.",
        "metrics": [
            {"field": "downsideCapture3Y", "label": "Downside capture", "weight": 40,
             "direction": "low", "unit": "%"},
            {"field": "upsideCapture3Y", "label": "Upside capture", "weight": 30,
             "direction": "high", "unit": "%"},
            {"field": "maxDrawdown3Y", "label": "Maximum drawdown", "weight": 30,
             "direction": "high", "unit": "%"},
        ],
    },
    {
        "code": "portfolio",
        "name": "Portfolio",
        "weight": 12,
        "why": "From the holdings file: concentration (effective number of stocks), fit "
               "to the category mandate by market cap, and differentiation measured as "
               "overlap against the category book.",
        "metrics": [
            {"field": "effectiveStocks", "label": "Effective number of stocks", "weight": 34,
             "direction": "band"},
            {"field": "mandateFit", "label": "Cap mix fit to mandate", "weight": 33,
             "direction": "absolute", "unit": "%"},
            {"field": "differentiation", "label": "Differentiation vs category book",
             "weight": 33, "direction": "high", "unit": "%"},
            {"field": "nameRetention", "label": "Name retention vs a year earlier",
             "weight": 0, "direction": "absolute", "unit": "%",
             "note": "Needs a holdings file from about a year earlier. Not in the "
                     "current build, so it carries no weight rather than a guess."},
        ],
    },
    {
        "code": "manager",
        "name": "Manager",
        "weight": 8,
        "why": "Tenure on this scheme and the number of market cycles actually run "
               "through. Not years in the industry, but years running this money.",
        "metrics": [
            {"field": "managerYears", "label": "Tenure on this scheme", "weight": 60,
             "direction": "high", "unit": "yrs"},
            {"field": "managerCycles", "label": "Market cycles run", "weight": 40,
             "direction": "high"},
        ],
    },
    {
        "code": "vintage",
        "name": "Track record length",
        "weight": 6,
        "why": "Longer live history scores higher, but this is a weight and not a gate. "
               "A strong young fund is not excluded, its shorter record simply counts "
               "for less.",
        "metrics": [
            {"field": "vintageYears", "label": "Live track record", "weight": 100,
             "direction": "high", "unit": "yrs"},
        ],
    },
    {
        "code": "aum",
        "name": "AUM (category adjusted)",
        "weight": 5,
        "why": "Size is read against the mandate. Small cap rewards nimble AUM and flags "
               "capacity. Mid cap prefers a middle band. Large cap and flexi reward "
               "scale, with a floor so a very small fund is marked down for viability.",
        "metrics": [
            {"field": "aumCr", "label": "AUM", "weight": 100,
             "direction": "curve", "unit": "Cr"},
        ],
    },
]

BLOCK_BY_CODE = {b["code"]: b for b in BLOCKS}

# ---------------------------------------------------------------------------
# AUM curves
# ---------------------------------------------------------------------------
#
# Each curve maps AUM in crore to a 0-100 score. `shape` names the intent so the
# dashboard can explain it; `points` is a piecewise-linear curve, interpolated
# between the listed (aumCr, score) pairs and flat outside them.

AUM_CURVES = {
    "Smallcap": {
        "shape": "nimble",
        "note": "Capacity is the binding constraint. The score falls as AUM rises, with "
                "a floor below which the fund is too small to be viable.",
        "points": [(100, 45), (500, 85), (2000, 100), (8000, 70), (20000, 40), (40000, 15)],
    },
    "Midcap": {
        "shape": "middle band",
        "note": "A middle band is preferred. Very small is a viability risk, very large "
                "is a capacity risk in a shallower market.",
        "points": [(100, 40), (750, 80), (3000, 100), (15000, 80), (35000, 45), (60000, 25)],
    },
    "Focused": {
        "shape": "middle band",
        "note": "A concentrated book in size is harder to move. Middle band preferred.",
        "points": [(100, 40), (750, 80), (4000, 100), (20000, 75), (45000, 45)],
    },
    "Sectoral / Thematic": {
        "shape": "middle band",
        "note": "Narrow universes hit capacity sooner than diversified ones.",
        "points": [(50, 35), (500, 80), (3000, 100), (15000, 75), (35000, 45)],
    },
    "Dividend Yield": {
        "shape": "middle band",
        "note": "A narrow universe of yielding names, so capacity binds earlier.",
        "points": [(50, 40), (400, 85), (2500, 100), (10000, 75), (25000, 50)],
    },
    "_default": {
        "shape": "scale",
        "note": "Capacity is rarely the binding constraint. Scale is rewarded, with a "
                "floor so a very small fund is marked down for viability.",
        "points": [(100, 30), (500, 55), (2000, 75), (8000, 92), (25000, 100), (80000, 100)],
    },
}

# Large cap, flexi, multicap, large & mid, value, ELSS all use the scale curve.
for _c in ("Largecap", "Flexicap", "Multicap", "Large & Midcap", "Value / Contra", "ELSS"):
    AUM_CURVES[_c] = AUM_CURVES["_default"]


def aum_curve(category):
    return AUM_CURVES.get(category, AUM_CURVES["_default"])


# ---------------------------------------------------------------------------
# Bands
# ---------------------------------------------------------------------------
#
# Bands are cut on the composite. They are intentionally wide: the model orders a
# shortlist, it does not select, and a 71 against a 68 is not a real difference.

# A composite is only meaningful if most of the model actually scored. Below this
# share of total block weight the fund is reported as Not rated rather than being
# given a number: renormalising over two minor blocks would otherwise let a fund
# with no return history at all top its category on portfolio shape and size.
MIN_EVIDENCE = 55

BANDS = [
    {"code": "A", "label": "A", "min": 72, "tone": "good",
     "meaning": "Shortlist. Ranks well across most blocks, not on one number alone."},
    {"code": "B", "label": "B", "min": 58, "tone": "warning",
     "meaning": "Investable, with something specific to discuss. Read the rationale."},
    {"code": "C", "label": "C", "min": 42, "tone": "serious",
     "meaning": "Below the category standard on more than one block. Hold, do not add."},
    {"code": "Review", "label": "Review", "min": -1, "tone": "critical",
     "meaning": "Weak across the blocks that scored. Needs an analyst before it goes "
                "in front of anyone."},
]

NOT_RATED = {
    "code": "Not rated", "label": "Not rated", "min": None, "tone": "neutral",
    "meaning": f"Less than {MIN_EVIDENCE}% of the model could be scored for this "
               f"scheme, so it does not carry a composite. The data it does have is "
               f"shown in full. This is a gap in the feed, not a verdict on the fund.",
}


def band_for(score):
    if score is None:
        return NOT_RATED
    for b in BANDS:
        if score >= b["min"]:
            return b
    return BANDS[-1]


# A composite difference smaller than this is not a real difference. Used to group
# funds into equal-rank tiers rather than pretending to rank them 1, 2, 3.
MEANINGFUL_GAP = 3.0

# ---------------------------------------------------------------------------
# Metrics shown but not scored
# ---------------------------------------------------------------------------

CONTEXT_METRICS = [
    {"field": "return1Y", "label": "Point to point 1Y", "unit": "%",
     "why": "Shown for context. A single point to point figure can hang on one lucky "
            "start or end date, so the return block scores the rolling median instead."},
    {"field": "return3Y", "label": "CAGR 3Y", "unit": "%", "why": "Context."},
    {"field": "return5Y", "label": "CAGR 5Y", "unit": "%", "why": "Context."},
    {"field": "stdDev3Y", "label": "Standard deviation", "unit": "%",
     "why": "Shown, not scored. Moves almost in lockstep with Sortino and downside "
            "capture, so scoring it would weight volatility several times over."},
    {"field": "semiStdDev3Y", "label": "Semi standard deviation", "unit": "%",
     "why": "Shown, not scored, for the same reason as standard deviation."},
    {"field": "treynor3Y", "label": "Treynor", "unit": "",
     "why": "Shown, not scored. Highly correlated with Sharpe once beta is stable."},
    {"field": "beta3Y", "label": "Beta", "unit": "", "why": "Context."},
    {"field": "ter", "label": "Expense ratio (direct)", "unit": "%",
     "why": "Context. Direct plan TER, already net of the return series shown."},
    {"field": "decile3Y", "label": "Category decile 3Y", "unit": "",
     "why": "Derived within category from the 3Y CAGR. Context for the block scores."},
    {"field": "decile5Y", "label": "Category decile 5Y", "unit": "",
     "why": "Derived within category from the 5Y CAGR."},
]

# ---------------------------------------------------------------------------
# Methodology copy (Tab 1 of the workbook)
# ---------------------------------------------------------------------------

PROCESS = [
    {"name": "AMC",
     "text": "AUM and flows. Parent group and franchise stability. Track record of "
             "coming through difficult periods."},
    {"name": "Investment Team",
     "text": "Stability of the team and number of exits. Size and bench strength. Years "
             "the team has worked together. Incentives aligned to fund outperformance "
             "against the benchmark."},
    {"name": "Quantitative Factors",
     "text": "Portfolio strategy and attributes. Long term consistent performance versus "
             "peer group. Volatility and drawdowns. Risk adjusted returns (Sharpe, "
             "Sortino, Information Ratio). Capture ratios and the shape of the book."},
]

CATEGORY_ADJUSTMENTS = [
    {"name": "Vintage is weighted, not gated",
     "text": "A fund with a short live history is not thrown out. Its track record simply "
             "counts for less, through the 6% track record block. A genuinely strong "
             "young fund still ranks well, because that block is small and the fund can "
             "win on the other six."},
    {"name": "Manager tenure is a flag, not a reject",
     "text": "A recently appointed manager lowers the manager block and raises a New "
             "Manager flag on the fund. It never removes the fund from the list."},
    {"name": "AUM is scored by category",
     "text": "Size means different things in different mandates, so the AUM score uses a "
             "different curve per category. Small cap rewards nimble AUM and flags large "
             "size as a capacity risk. Mid cap and focused prefer a middle band. Large "
             "cap and flexi reward scale, with a floor for viability."},
    {"name": "Everything is percentiled within its own category",
     "text": "A fund is only ever compared to its true peers. No metric is scored on an "
             "absolute scale, so a category-wide drawdown does not push a whole category "
             "down the list."},
]

HOW_TO_USE = [
    "Category Top Funds lists the shortlist per category with a written rationale for "
    "each pick. The number score sits behind the Analyst view.",
    "All Funds carries every scheme. Filter by category, search by name, or pick a fund "
    "to open its full detail card.",
    "Set the view toggle to Analyst to reveal the block scores and composite. Client view "
    "shows the data and the rationale only.",
    "Scores order the shortlist and frame the discussion. A 71 against a 68 is not a real "
    "difference, and the model groups funds into equal-rank tiers to say so. Judgement on "
    "the manager and the process sits above the number.",
]

# What the model does not do, stated so nobody has to infer it.
LIMITS = [
    {"name": "It does not select",
     "text": "The score orders a shortlist and frames a discussion. The written rationale "
             "leads, the number follows."},
    {"name": "It is mostly backward looking",
     "text": "Six of the seven blocks read what already happened. The portfolio block is "
             "the only one that reads what the fund owns now, which is the only thing "
             "that determines what happens next."},
    {"name": "It does not do allocation",
     "text": "How much equity a portfolio should hold, and in which categories, sits "
             "outside this model."},
    {"name": "It does not validate a theme",
     "text": "Sectoral and thematic funds are scored against each other on execution. "
             "Whether the theme is worth owning is a separate question."},
    {"name": "It does not cover debt or hybrid",
     "text": "Equity ratios do not carry over. Net yield after cost, credit look through "
             "and duration adherence are the spine of that model, and it is not this one."},
]

NEXT_UP = [
    {"name": "Active share",
     "text": "Needs the benchmark constituents and weights. Today differentiation is "
             "proxied by overlap against the category book, which is directionally right "
             "and free from what we already have. Benchmark holdings would upgrade it to "
             "true active share."},
    {"name": "Name retention",
     "text": "Needs a holdings file from about a year earlier. The metric is wired and "
             "carries zero weight until that file exists, so it cannot silently move a "
             "score."},
    {"name": "A manager claims check",
     "text": "Capture two or three structured claims from each manager meeting (cash "
             "policy, number of names, style) and test them against the holdings every "
             "month. The write up then reports where the pitch and the portfolio "
             "disagree, which is the one genuinely forward looking signal in the system."},
    {"name": "Debt and hybrid",
     "text": "A separate model, on a separate spine."},
]
