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
        "why": "Every median rolling return the feed carries, 1 through 10 years, plus "
               "the share of rolling three year windows that actually beat the "
               "benchmark. We read the whole distribution rather than one point to "
               "point number that can hang on a lucky start or end date, and the hit "
               "rate separates a fund that wins often from one that won once by a lot. "
               "Longer windows carry more weight than shorter ones.",
        "metrics": [
            {"field": "medianRolling1Y", "label": "Median rolling 1Y", "weight": 8,
             "direction": "high", "unit": "%"},
            {"field": "medianRolling3Y", "label": "Median rolling 3Y", "weight": 20,
             "direction": "high", "unit": "%"},
            {"field": "medianRolling5Y", "label": "Median rolling 5Y", "weight": 20,
             "direction": "high", "unit": "%"},
            {"field": "medianRolling7Y", "label": "Median rolling 7Y", "weight": 15,
             "direction": "high", "unit": "%"},
            {"field": "medianRolling10Y", "label": "Median rolling 10Y", "weight": 15,
             "direction": "high", "unit": "%"},
            {"field": "rollingHitRate3Y", "label": "Rolling 3Y windows beating benchmark",
             "weight": 22, "direction": "high", "unit": "%"},
        ],
    },
    {
        "code": "riskAdj",
        "name": "Risk adjusted",
        "weight": 24,
        "why": "Sharpe, Sortino and Information Ratio at every horizon published. "
               "Information Ratio carries the most weight, since it is return earned "
               "per unit of active risk taken away from the benchmark, which is the "
               "thing an active fee is charged for.",
        "metrics": [
            {"field": "informationRatio3Y", "label": "Information Ratio 3Y", "weight": 13,
             "direction": "high"},
            {"field": "informationRatio5Y", "label": "Information Ratio 5Y", "weight": 11,
             "direction": "high"},
            {"field": "informationRatio7Y", "label": "Information Ratio 7Y", "weight": 6,
             "direction": "high"},
            {"field": "informationRatio10Y", "label": "Information Ratio 10Y", "weight": 6,
             "direction": "high"},
            {"field": "sortino3Y", "label": "Sortino 3Y", "weight": 12, "direction": "high"},
            {"field": "sortino5Y", "label": "Sortino 5Y", "weight": 10, "direction": "high"},
            {"field": "sortino7Y", "label": "Sortino 7Y", "weight": 5, "direction": "high"},
            {"field": "sortino10Y", "label": "Sortino 10Y", "weight": 5, "direction": "high"},
            {"field": "sharpe3Y", "label": "Sharpe 3Y", "weight": 12, "direction": "high"},
            {"field": "sharpe5Y", "label": "Sharpe 5Y", "weight": 10, "direction": "high"},
            {"field": "sharpe7Y", "label": "Sharpe 7Y", "weight": 5, "direction": "high"},
            {"field": "sharpe10Y", "label": "Sharpe 10Y", "weight": 5, "direction": "high"},
        ],
    },
    {
        "code": "capture",
        "name": "Capture and drawdown",
        "weight": 18,
        "why": "Upside capture, downside capture and maximum drawdown at every horizon "
               "published. Rewards funds that fall less than the market and recover "
               "better. Downside carries more weight than upside, because a loss needs "
               "a larger gain to undo it.",
        "metrics": [
            {"field": "downsideCapture3Y", "label": "Downside capture 3Y", "weight": 16,
             "direction": "low", "unit": "%"},
            {"field": "downsideCapture5Y", "label": "Downside capture 5Y", "weight": 12,
             "direction": "low", "unit": "%"},
            {"field": "downsideCapture7Y", "label": "Downside capture 7Y", "weight": 6,
             "direction": "low", "unit": "%"},
            {"field": "downsideCapture10Y", "label": "Downside capture 10Y", "weight": 6,
             "direction": "low", "unit": "%"},
            {"field": "upsideCapture3Y", "label": "Upside capture 3Y", "weight": 12,
             "direction": "high", "unit": "%"},
            {"field": "upsideCapture5Y", "label": "Upside capture 5Y", "weight": 9,
             "direction": "high", "unit": "%"},
            {"field": "upsideCapture7Y", "label": "Upside capture 7Y", "weight": 5,
             "direction": "high", "unit": "%"},
            {"field": "upsideCapture10Y", "label": "Upside capture 10Y", "weight": 4,
             "direction": "high", "unit": "%"},
            {"field": "maxDrawdown3Y", "label": "Maximum drawdown 3Y", "weight": 12,
             "direction": "high", "unit": "%"},
            {"field": "maxDrawdown5Y", "label": "Maximum drawdown 5Y", "weight": 9,
             "direction": "high", "unit": "%"},
            {"field": "maxDrawdown7Y", "label": "Maximum drawdown 7Y", "weight": 5,
             "direction": "high", "unit": "%"},
            {"field": "maxDrawdown10Y", "label": "Maximum drawdown 10Y", "weight": 4,
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
        "code": "aum", "tier": "amc",
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
    {"field": "return1Y", "label": "CAGR 1Y", "unit": "%", "group": "cagr"},
    {"field": "return2Y", "label": "CAGR 2Y", "unit": "%", "group": "cagr"},
    {"field": "return3Y", "label": "CAGR 3Y", "unit": "%", "group": "cagr"},
    {"field": "return5Y", "label": "CAGR 5Y", "unit": "%", "group": "cagr"},
    {"field": "return7Y", "label": "CAGR 7Y", "unit": "%", "group": "cagr"},
    {"field": "returnCYTD", "label": "Calendar year to date", "unit": "%", "group": "cagr"},
    {"field": "cyBeatPct", "label": "Calendar years beating benchmark", "unit": "%",
     "group": "cagr"},

    {"field": "stdDev3Y", "label": "Standard deviation 3Y", "unit": "%", "group": "risk"},
    {"field": "semiStdDev3Y", "label": "Semi standard deviation 3Y", "unit": "%",
     "group": "risk"},
    {"field": "beta3Y", "label": "Beta 3Y", "unit": "", "group": "risk"},
    {"field": "treynor3Y", "label": "Treynor 3Y", "unit": "", "group": "risk"},

    {"field": "aumCr", "label": "AUM", "unit": " cr", "group": "fund"},
    {"field": "netFlow1YPct", "label": "Net flow over 1Y", "unit": "%", "group": "fund"},
    {"field": "ter", "label": "Expense ratio (direct)", "unit": "%", "group": "fund"},
    {"field": "vintageYears", "label": "Live track record", "unit": " yrs", "group": "fund"},
]

# Why the three shown-but-not-scored risk fields are not scored. Kept separate
# from the glossary because this is a modelling choice, not a definition.
NOT_SCORED_WHY = {
    "stdDev3Y": "Shown, not scored. Moves almost in lockstep with Sortino and downside "
                "capture, so scoring it would weight volatility several times over.",
    "semiStdDev3Y": "Shown, not scored, for the same reason as standard deviation.",
    "treynor3Y": "Shown, not scored. Highly correlated with Sharpe once beta is stable.",
    "beta3Y": "Context. Feeds Treynor, and reads as market sensitivity rather than skill.",
}

# ---------------------------------------------------------------------------
# Glossary
# ---------------------------------------------------------------------------
#
# Every technical term the dashboard prints has an entry here, and the UI attaches
# it on hover. A number nobody can read is not disclosure.

GLOSSARY = {
    "median rolling return":
        "Take every possible window of the stated length across the fund's life, work "
        "out the annualised return of each, and report the middle one. It answers "
        "'what did a typical holding period actually deliver', instead of the single "
        "answer you get from one start date to one end date.",
    "rolling 3y windows beating benchmark":
        "Of all the three year windows in the fund's life, the share where it finished "
        "ahead of its benchmark. A fund can carry a strong median while losing most "
        "windows, if one great stretch pulls the average up. This separates the two.",
    "cagr":
        "Compound annual growth rate: the single yearly rate that would have taken you "
        "from the start value to the end value. It depends entirely on the two dates "
        "chosen, which is why it is shown here for context rather than scored.",
    "calendar year to date":
        "Return from 1 January of the current year to the data date.",
    "calendar years beating benchmark":
        "The share of completed calendar years in which the fund finished ahead of its "
        "benchmark.",
    "sharpe":
        "Return above the risk free rate, divided by total volatility. Higher is "
        "better: it is how much return the fund earned for each unit of bumpiness. It "
        "treats upward and downward moves as equally bad, which is its main weakness.",
    "sortino":
        "Like Sharpe, but it only counts downward volatility. Usually the fairer "
        "measure, because investors do not mind the fund going up sharply.",
    "information ratio":
        "Return above the benchmark, divided by how much the fund's path wanders away "
        "from the benchmark. It is return per unit of active risk, which is precisely "
        "what an active management fee is charged for. This is why it carries the most "
        "weight inside the risk adjusted block.",
    "treynor":
        "Return above the risk free rate per unit of market sensitivity (beta), rather "
        "than per unit of total volatility.",
    "beta":
        "How much the fund tends to move when the market moves. Beta of 1 means it "
        "moves with the market, below 1 means it is steadier, above 1 means it swings "
        "harder. It measures sensitivity, not skill.",
    "standard deviation":
        "How much the fund's returns bounce around their own average. Higher means a "
        "rougher ride, in both directions.",
    "semi standard deviation":
        "The same idea as standard deviation but counting only returns below the "
        "average, so it measures the rough part of the ride rather than all of it.",
    "upside capture":
        "In the months the benchmark rose, how much of that rise the fund captured. "
        "110 means it gained 10 percent more than the benchmark in up months.",
    "downside capture":
        "In the months the benchmark fell, how much of that fall the fund took. 85 "
        "means it lost 15 percent less than the benchmark in down months, so lower is "
        "better. Below zero means the fund actually rose while the benchmark fell.",
    "capture ratio":
        "Upside capture divided by downside capture. Above 100 means the fund captures "
        "more of the rises than it does of the falls.",
    "maximum drawdown":
        "The worst peak to trough fall over the period. This is the loss an investor "
        "would have had to sit through, and it is the number to size a position "
        "against rather than the average year.",
    "effective number of stocks":
        "How many holdings the fund effectively has once position sizes are accounted "
        "for. A book of 60 names where the top 10 are half the portfolio behaves like "
        "far fewer than 60, and this number says how many.",
    "top 10 weight":
        "Share of the equity book held in its ten largest positions. Higher means more "
        "conviction and more single stock risk.",
    "mandate fit":
        "Whether the disclosed book meets the SEBI minimums for its category. 100 means "
        "full compliance, anything less is the size of the shortfall.",
    "differentiation":
        "How little the fund's book overlaps the average portfolio of its category. "
        "High means you are buying something the category does not already give you.",
    "cash and others":
        "The share of the fund not invested in equities: cash, treasury bills, TREPS "
        "and receivables. Concentration and overlap here are computed on the invested "
        "book, so this sits outside them.",
    "aum":
        "Assets under management, the size of the fund in crore.",
    "net flow over 1y":
        "Money in minus money out over the last year, as a share of where the fund "
        "started. Large positive flows into a small or mid cap fund are a capacity "
        "question, not just a popularity one.",
    "expense ratio":
        "The annual fee, already deducted from every return figure shown here.",
    "live track record":
        "How long the fund has actually been running. Where a named manager has run it "
        "since before the return series begins, that appointment date is used, because "
        "a manager cannot have run a fund before it existed.",
    "tenure on this scheme":
        "How long the longest serving current manager has run this particular fund. Not "
        "years in the industry.",
    "market cycles run":
        "How many peak to trough falls of at least 12 percent in the broad market the "
        "manager has run this fund through. The falls are found in the index's own "
        "monthly history rather than taken from a list.",
    "decile":
        "Where the fund sits in its category on that measure, 1 being the best tenth "
        "and 10 the worst.",
    "composite":
        "The weighted total of the seven block scores, out of 100. It orders a "
        "shortlist. It does not select, and a gap of less than three points is not a "
        "real difference.",
    "coverage":
        "How much of a block could actually be measured for this fund. Missing inputs "
        "are never filled with a middle value; the block simply reweights over what is "
        "there and reports it here.",
    "evidence":
        "The share of the model's total weight that could be scored for this fund. "
        "Below 55 percent no composite is published at all.",
    "percentile":
        "Rank within the fund's own category on that measure, 0 to 100, where 100 is "
        "the best in the category.",
}

# ---------------------------------------------------------------------------
# Methodology copy (Tab 1 of the workbook)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# The selection process, as shown to clients
# ---------------------------------------------------------------------------
#
# Two views of the same process, both taken from the Avendus deck.
#
#   SELECTION_NODES  the six factor diamond: three basic requirements and three
#                    performance drivers.
#   PROCESS_TIERS    the three tier screen (AMC, investment team, quantitative
#                    factors) across equity, debt and international.
#
# Each node names what the model can measure and what stays an analyst's call.
# `stat` keys are resolved against live universe figures at request time, so the
# page reports what the current build actually knows rather than a fixed claim.

SELECTION_NODES = [
    {
        "n": 1, "group": "basic", "code": "performance", "tier": "quant",
        "name": "Past performance and risk analytics",
        "points": ["Long term consistent performance",
                   "Drawdowns and volatility in line with or lower than the market"],
        "blocks": ["return", "capture"],
        "means": "Whether the fund has delivered over holding periods rather than "
                 "between two flattering dates, and what that cost on the way down. "
                 "We read every rolling window in the fund's life and ask how often "
                 "it beat the benchmark, not just by how much on average.",
        "stat": "performance",
    },
    {
        "n": 2, "group": "basic", "code": "aum", "tier": "amc",
        "name": "Assets under management",
        "points": ["Alpha reduces non-linearly as AUM rises"],
        "blocks": ["aum"],
        "means": "Size changes what a manager can do. A small cap fund that doubles "
                 "cannot hold the same names in the same weights, so the same process "
                 "produces a different result. Size is read against the mandate: what "
                 "is nimble for one category is sub-scale for another.",
        "stat": "aum",
    },
    {
        "n": 3, "group": "basic", "code": "quant", "tier": "quant",
        "name": "Detailed quant factors",
        "points": ["Historical track record",
                   "Volatility and drawdowns",
                   "Risk adjusted returns: Sharpe ratio, Information ratio",
                   "Market capitalisation, deviations from the benchmark",
                   "Portfolio turnover ratio"],
        "blocks": ["riskAdj", "portfolio", "vintage"],
        "means": "Whether the return was earned or simply bought with risk. "
                 "Information Ratio carries the most weight of the three ratios, "
                 "because it is return per unit of risk taken away from the "
                 "benchmark, which is the thing an active fee is charged for.",
        "stat": "quant",
    },
    {
        "n": 4, "group": "driver", "code": "fmType", "tier": "team",
        "name": "Type of fund manager",
        "points": ["Number of people in the investment team",
                   "Dependence on third party brokers against in-house analysis"],
        "blocks": ["manager"],
        "means": "Who is actually doing the work. A large team running one book "
                 "behaves differently from a single manager, and a house that "
                 "underwrites its own ideas behaves differently from one that buys "
                 "them in.",
        "stat": "fmType",
    },
    {
        "n": 5, "group": "driver", "code": "attitude", "tier": "team",
        "name": "Attitude of investment team",
        "points": ["Hunger", "Age", "Ability to learn from mistakes",
                   "Personal investment in equities"],
        "blocks": [],
        "means": "The part of a process that never shows up in a return series. "
                 "Whether the team still has something to prove, whether it revisits "
                 "its own mistakes, and whether the people running the money own it "
                 "themselves. This is what the written view is for.",
        "stat": "attitude",
    },
    {
        "n": 6, "group": "driver", "code": "stability", "tier": "team",
        "name": "Stability of investment team",
        "points": ["Number of exits", "Years of working together",
                   "Incentive structure"],
        "blocks": ["manager"],
        "means": "A track record belongs to the people who produced it. Tenure on "
                 "this scheme, years the team has worked together and how they are "
                 "paid decide whether the record still describes the fund you would "
                 "be buying.",
        "stat": "stability",
    },
]

# The one line the merged view exists to make.
PROCESS_INSIGHT = (
    "The three tiers and the six factors are the same framework at two "
    "resolutions. Every factor sits in one tier, and they do not fall evenly: "
    "the basic requirements come out of the AMC and quantitative tiers, while "
    "all three performance drivers sit with the investment team. The numbers "
    "tell you whether a fund qualifies. The team tells you whether it repeats."
)

SELECTION_GROUPS = {
    "basic": {"label": "Basic requirement", "range": "1 to 3",
              "note": "What a fund has to clear before the discussion starts."},
    "driver": {"label": "Performance drivers", "range": "4 to 6",
               "note": "What explains whether the record repeats."},
}

# The three tier screen, and the six factors sitting inside it. The two views in
# the deck are the same framework at different resolutions: every one of the six
# factors belongs to exactly one tier, and the split between them is not
# arbitrary. Factors 1 to 3, the basic requirements, come out of the AMC and
# quantitative tiers. Factors 4 to 6, the performance drivers, are all three in
# the investment team tier.
#
# That is the observation worth putting in front of a reader: the numbers tell
# you whether a fund qualifies, and the team tells you whether it repeats.
PROCESS_TIERS = [
    {
        "code": "amc", "name": "AMCs", "order": 1,
        "points": ["AUM and flows", "Parent group support",
                   "Ability to come out of difficult situations"],
        "means": "The house behind the fund. Flows tell you whether the AMC is "
                 "gathering or bleeding assets, and how it behaved through a bad "
                 "cycle tells you what it will do in the next one.",
    },
    {
        "code": "team", "name": "Investment team", "order": 2,
        "points": ["Stability of team: number of exits",
                   "Number of people in the investment team",
                   "Years the team has worked together"],
        "means": "Depth and continuity. A record produced by people who have since "
                 "left is a record of a fund that no longer exists in the same form.",
    },
    {
        "code": "quant", "name": "Quantitative factors", "order": 3,
        "points": ["Portfolio strategy, attributes",
                   "Long term consistent performance, peer group comparison",
                   "Volatility, drawdowns",
                   "Risk adjusted returns: Sharpe ratio, Information ratio, "
                   "excess returns",
                   "Tracking error, expense ratios",
                   "Portfolio turnover ratio"],
        "means": "Everything the numbers can settle. Read against the fund's own "
                 "category throughout, because a peer comparison only means something "
                 "when the peers are doing the same job.",
    },
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
