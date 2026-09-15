"""Read a scheme's category out of its own name.

The quant feed carries a category column and it cannot be used: its "Flexi Cap
Fund" bucket holds consumption, manufacturing, business cycle and quant funds,
several ETFs and three PMS products. Everything in this model is a percentile
inside a category, so a thematic fund sitting in the flexicap peer group does
not merely mislabel that one row, it moves the score of every flexicap fund
measured against it.

The name is the more reliable source because a scheme's name is regulated: SEBI
requires the category in it. So the name decides, and the feed's column is kept
only to report the disagreements.

Order matters, and it is the reverse of how it reads. A passive scheme is
checked first because its name carries a cap word it does not mean: "HDFC Nifty
Smallcap 250 Index Fund" is not a small cap fund, it is an index fund. The
active categories are checked before the themes for the opposite reason: "Quant
Flexi Cap Fund" is the house called Quant running a flexicap, while "Axis Quant
Fund" is a quant strategy, and the presence of a SEBI category word is what
separates them.
"""

from __future__ import annotations

import re

# Categories the seven block model scores. Everything else is shown, not scored.
SCORED = ("Flexicap", "Largecap", "Large & Midcap", "Multicap", "Midcap",
          "Smallcap", "Focused", "Value / Contra", "Dividend Yield")

# Shown but not scored. Each is a real peer group, they are simply not groups
# this model has anything to say about: an index fund is not trying to beat the
# index, so ranking it on alpha would be answering a question nobody asked.
SHOWN = ("Smart beta / Passive", "Sectoral / Thematic", "ELSS", "Fund of funds")

CATEGORIES = SCORED + SHOWN


_PLAN = re.compile(r"\s[-–]\s*(Dir|Direct|Reg|Regular)\s*[-–]?\s*(Growth|IDCW)?\s*$", re.I)


def _clean(name):
    """Drop the plan and option suffix. The feed spells it four ways."""
    n = " " + re.sub(r"\s+", " ", str(name or "")).strip() + " "
    return " " + _PLAN.sub(" ", n).strip() + " "


def _is_scheme(raw, n):
    """Whether this row is a mutual fund at all.

    Every mutual fund in the feed carries a plan and option suffix, because that
    is how a scheme is named once it has both. Exchange traded funds are the
    exception: they have one class and no plan, so they are admitted on their own
    name. What is left over is the portfolio management and alternative products
    the sheet also carries, which are a different regime and not what a screener
    of mutual funds is for."""
    if _PLAN.search(" " + re.sub(r"\s+", " ", str(raw or "")).strip() + " "):
        return True
    return bool(_has(n, "ETF", "exchange traded"))


def _has(n, *words):
    return any(re.search(r"\b" + w + r"\b", n, re.I) for w in words)


# A theme is a subject, not a mandate. The list is the subjects the feed
# actually carries; anything not on it and not an active category is reported
# rather than filed away somewhere convenient.
_THEMES = (
    "bank", "banking", "financial services", "finserv", "pharma", "healthcare",
    "technology", "digital", "infotech", "information technology", "IT",
    "infrastructure", "infra", "consumption", "consumer", "manufacturing",
    "business cycles?", "defence", "PSU", "energy", "power", "transportation",
    "logistics", "housing", "MNC", "innovation", "special opportunit\\w*",
    "services", "realty", "real estate", "metal", "mining", "auto",
    "automotive", "commodit\\w*", "ESG", "rural", "export", "tourism",
    "travel", "resources", "capital markets", "internet", "telecom", "media",
    "entertainment", "quant", "momentum", "alpha", "low volatilit\\w*",
    "quality", "value 50", "equal weight", "military", "aerospace",
    "electric", "EV", "new age", "pharma and health",
    # A scheme named for an opportunity set rather than a mandate is thematic:
    # SEBI files India Opportunities and its cousins under thematic, and the
    # name is telling the reader the same thing.
    "opportunit\\w*", "ethical", "emergent", "emerging", "global",
    "international", "overseas", "china", "japan", "world", "asian", "asean",
    "europe", "brazil", "taiwan", "US bluechip", "conglomerates?",
    "multi[- ]?factor", "minimum variance", "sector rotation", "IPO", "FMCG",
    "health and wellness", "manufacture", "build",
)


def classify(name, feed_category=None):
    """(category, why) for a scheme, or (None, why) where the name will not say."""
    n = _clean(name)

    if re.search(r"\bTRI\b", n):
        return None, "a benchmark series, not a scheme"

    # PMS and AIF products are not mutual funds and have no place in a screener
    # of them: different fee regime, different disclosure, different investor.
    if re.search(r"\bPMS\b|::", n) or _has(n, "AIF") or not _is_scheme(name, n):
        return None, "not a mutual fund"

    # 1. Passive first: these names carry cap words they do not mean.
    if _has(n, "ETF", "exchange traded") or re.search(r"\bindex\b", n, re.I):
        return "Smart beta / Passive", "named as an index fund or an ETF"

    # 2. Fund of funds, including the feeders into overseas strategies.
    if _has(n, "FOF", "fund of funds?", "feeder"):
        return "Fund of funds", "named as a fund of funds"

    # 3. ELSS carries its own lock-in and sits in its own SEBI category.
    if _has(n, "ELSS") or re.search(r"tax\s*(saver|saving|plan)", n, re.I):
        return "ELSS", "named as a tax saving scheme"

    # 4. The active categories, by the words SEBI requires in the name.
    if re.search(r"\bflexi\s*-?\s*cap\b", n, re.I):
        return "Flexicap", "named a flexi cap fund"
    if re.search(r"\blarge\s*(&|and)\s*mid\s*-?\s*cap\b", n, re.I):
        return "Large & Midcap", "named a large and mid cap fund"
    if re.search(r"\bmid\s*(&|and)\s*small\s*-?\s*cap\b", n, re.I):
        return "Large & Midcap", "named a mid and small cap fund"
    if re.search(r"\bmulti\s*-?\s*cap\b", n, re.I):
        return "Multicap", "named a multi cap fund"
    if re.search(r"\blarge\s*-?\s*cap\b", n, re.I):
        return "Largecap", "named a large cap fund"
    if re.search(r"\bmid\s*-?\s*cap\b", n, re.I):
        return "Midcap", "named a mid cap fund"
    if re.search(r"\bsmall\s*-?\s*cap\b", n, re.I):
        return "Smallcap", "named a small cap fund"
    if _has(n, "focused", "focussed"):
        return "Focused", "named a focused fund"
    if _has(n, "dividend yield"):
        return "Dividend Yield", "named a dividend yield fund"
    if _has(n, "contra", "value"):
        return "Value / Contra", "named a value or contra fund"

    # 5. A theme, where the name names one.
    for t in _THEMES:
        if _has(n, t):
            return "Sectoral / Thematic", f"named after a theme ({t})"

    # Everything above this line has been ruled out, and a diversified equity
    # scheme has to carry its SEBI category in its name, so what is left cannot
    # be one. It is read as a theme with a marketing name: Kotak Pioneer, SBI
    # Comma, DSP India Tiger. The reason is kept distinct from a named theme so
    # the build can list these rather than let them pass unseen.
    return "Sectoral / Thematic", "no category in the name, so read as a theme"


# ---------------------------------------------------------------------------
# The index a passive scheme tracks
# ---------------------------------------------------------------------------
#
# Two index funds on the same index are the same product, and the only thing
# separating them is how much of the index they hand back: cost and tracking
# error, which show up together in the return. So passive schemes are grouped by
# the index they name, and ranked inside that group. Ranking a Nifty 50 fund
# against a Nifty Bank fund would be ranking two market calls, not two trackers.

# Half the sheet writes "Nifty500" and the other half "Nifty 500", so the word
# boundary cannot be trusted after the family name and the digits are split back
# off below. Two spellings of one index are one index.
_INDEX_START = re.compile(
    r"\b(nifty|bse|sensex|s&p|msci|nasdaq|hang\s*seng|dow\s*jones|ftse)",
    re.I)

# Words that belong to the wrapper rather than to the index.
_WRAPPER = re.compile(
    r"\b(index|fund|etf|exchange\s*traded|scheme|plan|growth|idcw|dir|direct|"
    r"reg|regular|of\s*fund|fof|units?)\b", re.I)


def index_family(name):
    """The index a passive scheme tracks, or None where the name will not say."""
    n = _clean(name)
    m = _INDEX_START.search(n)
    if not m:
        return None
    tail = n[m.start():]
    tail = re.split(r"\s[-–]\s", tail)[0]          # drop a trailing plan clause
    tail = _WRAPPER.sub(" ", tail)
    tail = re.sub(r"[^A-Za-z0-9&\s:]+", " ", tail)
    tail = re.sub(r"(?i)\b(nifty|bse)(\d)", r"\1 \2", tail)
    tail = re.sub(r"\s+", " ", tail).strip()
    if not tail:
        return None
    # Title case the words that are words, leave the acronyms and numbers alone.
    parts = [w if (w.isupper() or any(c.isdigit() for c in w)) else w.capitalize()
             for w in tail.split()]
    return " ".join(parts)
