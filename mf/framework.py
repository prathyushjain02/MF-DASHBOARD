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
*   The return block is built on the rolling median, because a single point to
    point number can hang on one lucky start or end date. It also carries a small
    weight on the trailing 6M and 1Y so that a fund lagging right now is not fully
    masked by a strong lifetime record; those recent windows are percentiled
    against category peers, so the question they ask is "is this fund behind its
    peers today", not "did the market go up". The longer CAGR figures stay context.
*   Vintage is a weight, not a gate. Short manager tenure is a flag, not a reject.

House style for anything user facing in this file: no em dashes.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------

# The categories the seven block model scores: actively managed equity, where
# beating a benchmark is the job and a percentile against peers doing the same
# job is a fair way to ask whether it was done.
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
]

# Shown, not scored. These are real peer groups and they belong in the universe,
# but this model has nothing to say about them: an index fund is not trying to
# beat its index, so ranking it on alpha answers a question nobody asked, and a
# thematic fund's return is a call on its theme rather than a manager's record.
# They carry every figure the feed publishes and no composite.
SHOWN_CATEGORIES = [
    "Smart beta / Passive",
    "Sectoral / Thematic",
    "ELSS",
    "Fund of funds",
]

ALL_CATEGORIES = CATEGORIES + SHOWN_CATEGORIES

# Categories that get a shortlist page of their own. Dividend yield is scored
# and ranked like any other category and a fund in it carries its composite, but
# twelve schemes chasing a yield is a corner of the market rather than a shelf
# anybody is choosing from, so it does not get a tile.
NO_SHORTLIST = {"Dividend Yield"}
SHORTLIST_CATEGORIES = [c for c in CATEGORIES if c not in NO_SHORTLIST]


def is_scored(category):
    return category in CATEGORIES


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
}

# Categories that are a SEBI label rather than a peer group. Everything in the
# model is scored relative to category peers, and that only means something when
# the peers are doing the same job. Nothing in the current scope trips this, but
# the mechanism stays: the caveat travels with the number wherever it applies.
LOOSE_PEER_GROUPS = {}


def loose_peer_group(category):
    return LOOSE_PEER_GROUPS.get(category)


# What each category is read against. The feed carries no benchmark column, so
# without this every fund defaults to one broad index and a small cap fund gets
# compared to the Nifty 500.
#
# Only three index series are published in the feed. Six categories have their
# natural benchmark among them; three do not and are read against the closest
# available series instead. Those are labelled "index" rather than "benchmark"
# wherever they appear, because a proxy that is not named as one is worse than
# no comparison at all: Nifty 50 is 50 names against a large cap mandate that
# runs to 100, and BSE MidSmallCap spans both mid and small.
BENCHMARKS = {
    "Flexicap":       ("Nifty 500 TRI", "benchmark"),
    "Multicap":       ("Nifty 500 TRI", "benchmark"),
    "Focused":        ("Nifty 500 TRI", "benchmark"),
    "Value / Contra": ("Nifty 500 TRI", "benchmark"),
    "Large & Midcap": ("Nifty 500 TRI", "benchmark"),
    "Dividend Yield": ("Nifty 500 TRI", "benchmark"),
    "Largecap":       ("Nifty 50 TRI", "index"),
    "Midcap":         ("BSE MidSmallCap TRI", "index"),
    "Smallcap":       ("BSE MidSmallCap TRI", "index"),
}

DEFAULT_BENCHMARK = ("Nifty 500 TRI", "benchmark")


def benchmark_for(category):
    """(name, kind) for a category. kind is 'benchmark' where the series is the
    category's own, 'index' where it is the closest available stand-in.

    The categories this model does not score get no benchmark rather than the
    default one. A banking ETF read against the Nifty 500 is not being measured,
    it is being mismeasured, and naming a benchmark for it would invite exactly
    that reading."""
    if category in SHOWN_CATEGORIES:
        return None, None
    return BENCHMARKS.get(category, DEFAULT_BENCHMARK)


# The market line on the growth chart. The feed publishes no series for an index,
# so it is fetched separately, and there are two ways to get one:
#
#   tickers   the index itself, from Yahoo via yfinance. Long history, and it is
#             the actual index rather than something tracking it. These are price
#             indices: they exclude dividends, while a fund's NAV includes them.
#             That understates the index by roughly the market's dividend yield a
#             year, so the series is labelled a price index wherever it appears.
#   fallback  an AMFI index tracking scheme, read from the same NAV source as the
#             funds. Dividends are inside the NAV so it is comparable like for
#             like, but it carries the scheme's expense and tracking error, and
#             the Nifty 500 schemes only launched in 2023.
#
# Several tickers are listed per index because Yahoo's coverage of the Indian
# mid and small cap series is uneven. The build tries them in order and keeps the
# first that returns a usable history, so a symbol that has gone away downgrades
# the chart rather than breaking the build.
INDEX_PROXIES = {
    "Nifty 500": {
        "tickers": ["^CRSLDX", "NIFTY500.NS"],
        "fallback": 152106, "fallbackLabel": "Nifty 500 Index Fund",
    },
    "Nifty 50": {
        "tickers": ["^NSEI", "NIFTY50.NS"],
        "fallback": 118741, "fallbackLabel": "Nifty 50 Index Fund",
    },
    "Nifty Midcap 150": {
        "tickers": ["NIFTYMIDCAP150.NS", "^NSEMDCP50"],
        "fallback": 148726, "fallbackLabel": "Nifty Midcap 150 Index Fund",
    },
    "Nifty Smallcap 250": {
        "tickers": ["NIFTYSMLCAP250.NS", "^CNXSC"],
        "fallback": 148519, "fallbackLabel": "Nifty Smallcap 250 Index Fund",
    },
}

# The true benchmark series, month on month, from the source workbook's own
# benchmark sheet. These are total return indices, so dividends are inside them
# exactly as they are inside a fund's NAV, and they reach back to 2018. That
# makes them the right line for any window of a year or more.
#
# They are monthly, so a one or three month window would draw them as two or
# three points. Short windows keep the daily tracking scheme above instead, and
# the chart says which of the two it is showing.
BENCHMARK_SERIES = {
    "Flexicap":       "Nifty 500 TRI",
    "Multicap":       "Nifty 500 TRI",
    "Focused":        "Nifty 500 TRI",
    "Value / Contra": "Nifty 500 TRI",
    "Large & Midcap": "Nifty 500 TRI",
    "Dividend Yield": "Nifty 500 TRI",
    "Largecap":       "Nifty 50 TRI",
    "Midcap":         "Nifty Midcap 100 TRI",
    "Smallcap":       "Nifty Smallcap 250 TRI",
}

# Below this many days a monthly series has too few points to draw as a line.
MONTHLY_MIN_DAYS = 300


def benchmark_series_for(category):
    return BENCHMARK_SERIES.get(category, "Nifty 500 TRI")


# Mid and small cap get their own index rather than the blended BSE MidSmallCap
# series the summary table uses: a mid cap fund read against a mid-and-small
# blend is being marked against exposure it does not hold.
INDEX_BY_CATEGORY = {
    "Flexicap":       "Nifty 500",
    "Multicap":       "Nifty 500",
    "Focused":        "Nifty 500",
    "Value / Contra": "Nifty 500",
    "Large & Midcap": "Nifty 500",
    "Dividend Yield": "Nifty 500",
    "Largecap":       "Nifty 50",
    "Midcap":         "Nifty Midcap 150",
    "Smallcap":       "Nifty Smallcap 250",
}


def index_name_for(category):
    return INDEX_BY_CATEGORY.get(category, "Nifty 500")


def index_proxy(category):
    name = index_name_for(category)
    return {"name": name, **INDEX_PROXIES[name]}


# Every fund house the feed carries is in the universe. An earlier build held a
# dozen of them out as a coverage decision taken outside the model, which meant
# a reader looking for a scheme could not find out that it existed. A judgement
# about a house belongs next to the fund, not in front of it.
EXCLUDED_AMCS = set()


def excluded_amc(amc):
    return False


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
               "Longer windows carry more weight than shorter ones. A small weight sits "
               "on the trailing 6M and 1Y as well, so a fund that is lagging its peers "
               "right now is not fully hidden behind a strong lifetime record.",
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
            {"field": "return6M", "label": "Recent 6M return", "weight": 6,
             "direction": "high", "unit": "%", "support": True},
            {"field": "return1Y", "label": "Recent 1Y return", "weight": 10,
             "direction": "high", "unit": "%", "support": True},
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
        "why": "From the holdings file: fit to the category mandate by market cap, and "
               "differentiation measured as overlap against the category book.",
        "metrics": [
            {"field": "mandateFit", "label": "Cap mix fit to mandate", "weight": 50,
             "direction": "absolute", "unit": "%"},
            {"field": "differentiation", "label": "Differentiation vs category book",
             "weight": 50, "direction": "high", "unit": "%"},
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
                "floor so a very small fund is marked down for viability, and a mild "
                "taper at the very top: even here a genuinely enormous book carries "
                "some capacity drag, so it is marked down slightly rather than scored "
                "identically to a fund a fifth its size.",
        "points": [(100, 30), (500, 55), (2000, 75), (8000, 92), (25000, 100),
                   (60000, 92), (150000, 80)],
    },
}

# Large cap, flexi, multicap, large & mid and value all use the scale curve.
for _c in ("Largecap", "Flexicap", "Multicap", "Large & Midcap", "Value / Contra"):
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
#
# Set at 60 so a fund missing both the risk adjusted block (24) and the capture
# block (18) cannot be rated: those two together are 42 of the 100, and a fund we
# can measure for neither risk adjusted return nor drawdown behaviour is not a
# fund we can rank. A young fund missing just one of them still clears the floor.
MIN_EVIDENCE = 60

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

# A fund the model does not attempt to score, as against one it tried and could
# not. The distinction matters to the reader: Not rated is a gap in the evidence,
# Not scored is a statement that the question does not apply.
NOT_SCORED = {
    "code": "Not scored", "label": "Not scored", "min": None, "tone": "neutral",
    "meaning": "This model ranks actively managed equity on whether it beat its "
               "benchmark. That is not what this scheme is for, so it carries "
               "every figure the feed publishes and no score.",
}

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

# Each entry is two short points, because a definition nobody finishes reading is
# not disclosure either. The first says what the number is, the second says how to
# read it or what it will not tell you. `*stars*` mark the words that carry the
# point; the dashboard renders them bold and escapes everything else, so an entry
# can emphasise without being able to inject markup.
GLOSSARY = {
    "median rolling return": [
        "Every window of that length across the fund's life, with the *middle one* reported.",
        "Answers what a *typical holding period* gave, not what one lucky start date gave.",
    ],
    "rolling 3y windows beating benchmark": [
        "Share of all three year windows where the fund *finished ahead* of its benchmark.",
        "Separates a fund that wins *often* from one that won *once by a lot*.",
    ],
    "cagr": [
        "The single yearly rate that takes you from the *start value to the end value*.",
        "Depends entirely on the *two dates chosen*, which is why it is context here and not scored.",
    ],
    "calendar year to date": [
        "Return from *1 January* of the current year to the data date.",
        "A part year figure, so it is *not annualised* and not comparable to a CAGR.",
    ],
    "calendar years beating benchmark": [
        "Share of *completed calendar years* the fund finished ahead of its benchmark.",
        "January boundaries are arbitrary, so read it beside the *rolling hit rate*.",
    ],
    "sharpe": [
        "Return above the risk free rate, per unit of *total volatility*.",
        "Treats a sharp *rise as badly as a fall*, which is its main weakness.",
    ],
    "sortino": [
        "Sharpe, but counting only *downward* volatility.",
        "Usually the *fairer* measure: nobody minds the fund going up sharply.",
    ],
    "information ratio": [
        "Return above the benchmark, per unit of *active risk* taken away from it.",
        "Precisely what an *active fee* buys, so it carries the most weight in its block.",
    ],
    "treynor": [
        "Return above the risk free rate per unit of *market sensitivity*, not total volatility.",
        "Shown, *not scored*: it tracks Sharpe closely once beta is stable.",
    ],
    "beta": [
        "How much the fund moves when the *market* moves. One means it moves with it.",
        "Measures *sensitivity, not skill*. A high beta fund is not a better fund.",
    ],
    "standard deviation": [
        "How far returns *bounce around their own average*.",
        "Counts up and down moves alike, so a *strong rally* raises it too.",
    ],
    "semi standard deviation": [
        "Standard deviation counting only the returns *below the average*.",
        "Measures the *rough part* of the ride rather than all of it.",
    ],
    "upside capture": [
        "In the months the benchmark *rose*, how much of that rise the fund caught.",
        "*110* means it gained ten percent more than the benchmark in up months.",
    ],
    "downside capture": [
        "In the months the benchmark *fell*, how much of that fall the fund took.",
        "*Lower is better*: 85 means it lost fifteen percent less than the benchmark.",
    ],
    "capture ratio": [
        "Upside capture divided by downside capture.",
        "*Above 100* means the fund catches more of the rises than it does of the falls.",
    ],
    "maximum drawdown": [
        "The worst *peak to trough* fall over the period.",
        "The loss an investor had to *sit through*, so size a position against it.",
    ],
    "effective holdings": [
        "What the book behaves like it holds, rather than how many names are in it.",
        "Ten names that are two thirds of the money is *not* a two hundred stock portfolio.",
    ],
    "top 10 weight": [
        "Share of the equity book held in its *ten largest* positions.",
        "Higher means more *conviction* and more *single stock risk*.",
    ],
    "mandate fit": [
        "Whether the disclosed book meets the *SEBI minimums* for its category.",
        "*100 is full compliance*; anything less is the size of the shortfall.",
    ],
    "differentiation": [
        "How little the book *overlaps the average portfolio* of its category.",
        "High means you are buying something the category *does not already give you*.",
    ],
    "cash and others": [
        "The share *not invested in equities*: cash, treasury bills, TREPS and receivables.",
        "Concentration and overlap are computed on the *invested book*, so this sits outside them.",
    ],
    "aum": [
        "*Assets under management*: the size of the fund, in crore.",
        "Read *against the mandate*, since nimble for one category is sub scale for another.",
    ],
    "net flow over 1y": [
        "Money in minus money out over the year, as a share of where the fund *started*.",
        "Large inflows into a small or mid cap fund are a *capacity* question, not just a popular one.",
    ],
    "expense ratio": [
        "The annual fee, *already deducted* from every return figure shown here.",
        "The *direct plan* figure. The feed carries it for under half the universe.",
    ],
    "live track record": [
        "How long the fund has *actually been running*.",
        "A *weight, not a gate*: a short record counts for less, it does not exclude the fund.",
    ],
    "tenure on this scheme": [
        "How long the *longest serving* current manager has run this particular fund.",
        "Not years in the industry: a record belongs to the *people who produced it*.",
    ],
    "market cycles run": [
        "Falls of at least *12 percent* in the broad market that the manager ran this fund through.",
        "Found in the *index's own history*, rather than taken from a remembered list.",
    ],
    "decile": [
        "Where the fund sits in its category on that measure, *1 being the best tenth*.",
        "Ranked *within the category only*, never against the whole universe.",
    ],
    "composite": [
        "The *weighted total* of the seven block scores, out of 100.",
        "It *orders a shortlist*. A gap of under three points is not a real difference.",
    ],
    "coverage": [
        "How much of a block could *actually be measured* for this fund.",
        "Missing inputs are *never filled* with a middle value; the block reweights over what is there.",
    ],
    "evidence": [
        "The share of the model's *total weight* that could be scored for this fund.",
        f"Below *{MIN_EVIDENCE} percent* no composite is published at all.",
    ],
    "percentile": [
        "Rank *within the fund's own category* on that measure, 0 to 100.",
        "*100 is the best* in the category. Nothing here is scored on an absolute scale.",
    ],
}

# ---------------------------------------------------------------------------
# Methodology copy (Tab 1 of the workbook)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# The selection process, as shown to clients
# ---------------------------------------------------------------------------
#
# SELECTION_NODES is the six factor view from the deck: three basic requirements
# and three performance drivers. Each node says what the factor covers and what
# it means; `stat` keys are resolved against live universe figures at request
# time, so the page reports the current build rather than a fixed claim.

SELECTION_NODES = [
    {
        "n": 1, "group": "basic", "code": "performance",
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
        "n": 2, "group": "basic", "code": "aum",
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
        "n": 3, "group": "basic", "code": "quant",
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
        "n": 4, "group": "driver", "code": "fmType",
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
        "n": 5, "group": "driver", "code": "attitude",
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
        "n": 6, "group": "driver", "code": "stability",
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

SELECTION_GROUPS = {
    "basic": {"label": "Basic requirement", "range": "1 to 3",
              "note": "What a fund has to clear before the discussion starts."},
    "driver": {"label": "Performance drivers", "range": "4 to 6",
               "note": "What explains whether the record repeats."},
}

SELECTION_GROUPS = {
    "basic": {"label": "Basic requirement", "range": "1 to 3",
              "note": "What a fund has to clear before the discussion starts."},
    "driver": {"label": "Performance drivers", "range": "4 to 6",
               "note": "What explains whether the record repeats."},
}

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
             "cap and flexi reward scale, with a floor for viability and a mild taper at "
             "the very top so a genuinely enormous book is not scored the same as one a "
             "fifth its size."},
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
