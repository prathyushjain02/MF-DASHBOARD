"""Written rationale for a single fund.

Two lines are produced for every scheme:

    whyWeLikeIt   the strengths, in the tone of the remarks pages. This is what a
                  client sees, and it leads the presentation.
    whatToWatch   the specific thing to discuss. Band B means "investable, with
                  something to discuss", and this is that something.

Both are assembled only from the fund's own scored record. Nothing is inferred
from the scheme's name, its AMC's reputation or the category's current fashion.
Every clause that appears quotes the number behind it, so a reader can disagree
with the sentence by disagreeing with the figure.

House style: no em dashes, plain declaratives, numbers written out with the unit.
"""

from __future__ import annotations

from . import framework as fw


def _f(v):
    try:
        return None if v is None else float(v)
    except (TypeError, ValueError):
        return None


def n(v, dp=1):
    f = _f(v)
    return "n/a" if f is None else f"{f:,.{dp}f}"


def _blocks(fund):
    return {b["code"]: b for b in fund.get("blocks", [])}


# ---------------------------------------------------------------------------
# Why we like it
# ---------------------------------------------------------------------------

def why_we_like_it(fund):
    b = _blocks(fund)
    out = []

    ret = b.get("return", {}).get("score")
    d3, d5 = fund.get("decile3Y"), fund.get("decile5Y")
    if ret is not None:
        if ret >= 80 and (d3 or 9) <= 3 and (d5 or 9) <= 3:
            out.append("Consistent top decile rolling returns across 3 and 5 years.")
        elif ret >= 90:
            out.append("Rolling returns in the top tenth of the category over the "
                       "windows we can read.")
        elif ret >= 75:
            out.append("Rolling returns in the top quartile of the category over the "
                       "windows we can read.")
        elif ret >= 60:
            out.append("Steady returns, holding above the category median through cycles.")

    ra = b.get("riskAdj", {}).get("score")
    if ra is not None and ra >= 60:
        srt, ir = fund.get("sortino3Y"), fund.get("informationRatio3Y")
        bits = []
        if srt is not None:
            bits.append(f"Sortino {n(srt, 1)}")
        if ir is not None:
            bits.append(f"Information Ratio {n(ir, 2)}")
        detail = f" ({', '.join(bits)})" if bits else ""
        out.append(f"Strong risk adjusted profile{detail}.")

    cap = b.get("capture", {}).get("score")
    dn, up = _f(fund.get("downsideCapture3Y")), _f(fund.get("upsideCapture3Y"))
    if cap is not None and cap >= 55 and dn is not None and dn < 100:
        if dn < 0:
            # A negative downside capture means the fund rose in the months the
            # benchmark fell. Describing that as "protects well" understates it and
            # also hides that it usually signals a book with little in common with
            # the benchmark rather than skill at defending.
            out.append(f"Rose on average in the months the benchmark fell (downside "
                       f"capture {n(dn, 0)}), which says the book has little in common "
                       f"with the index rather than that it defends well.")
        elif up is not None:
            out.append(f"Protects well on the way down (downside capture {n(dn, 0)}, "
                       f"upside {n(up, 0)}).")
        else:
            out.append(f"Protects well on the way down (downside capture {n(dn, 0)}).")

    top10 = _f(fund.get("top10"))
    effn = _f(fund.get("effectiveStocks"))
    if top10 is not None and top10 >= 45:
        out.append(f"High conviction portfolio, top 10 at {n(top10, 0)} percent.")
    elif effn is not None and b.get("portfolio", {}).get("score", 0) and \
            b["portfolio"]["score"] >= 65:
        out.append(f"Book shaped to the mandate, effective holdings of "
                   f"{n(effn, 0)} stocks.")

    diff = _f(fund.get("differentiation"))
    if diff is not None and diff >= 70 and not fw.loose_peer_group(fund.get("category")):
        ov = 100 - diff
        if ov < 5:
            out.append("The book has almost nothing in common with the average "
                       "portfolio in the category.")
        else:
            out.append(f"Differentiated book, only {n(ov, 0)} percent overlap with "
                       f"the average portfolio in the category.")

    my, cy = _f(fund.get("managerYears")), _f(fund.get("managerCycles"))
    if my is not None and my >= 5 and cy is not None and cy >= 2:
        out.append(f"Seasoned manager, has run this strategy through {cy:.0f} market "
                   f"cycles ({my:.0f} year tenure).")
    elif my is not None and my < 3:
        out.append("Manager tenure is short, so the track record carries less weight, "
                   "but early signals are constructive.")

    v = _f(fund.get("vintageYears"))
    if v is not None and v < 5:
        out.append("Relatively new fund, vintage is weighted down accordingly.")

    if not out:
        out.append("Nothing in the scored blocks stands out against the category. The "
                   "fund is carried for completeness, not as a recommendation.")
    return " ".join(out)


# ---------------------------------------------------------------------------
# What to watch
# ---------------------------------------------------------------------------

def what_to_watch(fund):
    b = _blocks(fund)
    out = []

    caveat = fw.loose_peer_group(fund.get("category"))
    if caveat:
        out.append(f"This fund's rank is against {fund.get('category')} peers, and that "
                   f"is a weak comparison. {caveat}")

    dn, up = _f(fund.get("downsideCapture3Y")), _f(fund.get("upsideCapture3Y"))
    if dn is not None and dn > 105:
        out.append(f"Falls harder than the market in a drawdown (downside capture "
                   f"{n(dn, 0)}). That is the number to put in front of a client "
                   f"before the next correction, not after it.")
    elif dn is not None and up is not None and dn < 90 and up < 95:
        out.append(f"The protection is real but it is paid for. Downside capture of "
                   f"{n(dn, 0)} comes with upside capture of {n(up, 0)}, so the fund "
                   f"will trail in a strong rally. A client should hear that before "
                   f"buying, not after.")

    for s in fund.get("mandateShortfalls", []):
        out.append(f"The disclosed book holds {s['actual']:.0f} percent in {s['bucket']} "
                   f"cap against a {s['required']:.0f} percent minimum for the category. "
                   f"Check the date of the disclosure before treating it as a breach.")

    ret = b.get("return", {}).get("score")
    ra = b.get("riskAdj", {}).get("score")
    if ret is not None and ra is not None and ret >= 65 and ra < 40:
        out.append(f"Returns rank well ({ret:.0f}) but the risk adjusted block does not "
                   f"({ra:.0f}). The return has been bought with volatility rather than "
                   f"earned per unit of risk.")
    if ret is not None and ra is not None and ra >= 65 and ret < 40:
        out.append(f"Well run on a risk adjusted basis ({ra:.0f}) without the absolute "
                   f"return to show for it ({ret:.0f}). Reasonable for a defensive "
                   f"sleeve, thin as a core holding.")

    aum_b = b.get("aum", {})
    if aum_b.get("score") is not None and aum_b["score"] < 40:
        curve = fw.aum_curve(fund.get("category"))
        out.append(f"Size scores {aum_b['score']:.0f} on the {fund.get('category')} AUM "
                   f"curve at Rs {n(fund.get('aumCr'), 0)} cr. {curve['note']}")

    mdd = _f(fund.get("maxDrawdown3Y"))
    if mdd is not None and mdd < -25:
        out.append(f"Maximum drawdown of {n(mdd, 1)} percent over the window. Size the "
                   f"position for that, not for the average year.")

    ev = _f(fund.get("evidence"))
    if ev is not None and ev < 75:
        missing = [bl["name"] for bl in fund.get("blocks", []) if bl["score"] is None]
        tail = f" Unscored: {', '.join(missing)}." if missing else ""
        out.append(f"Only {ev:.0f} percent of the model's weight could be scored for "
                   f"this fund.{tail} The composite is a partial read, and the rest is "
                   f"an analyst's job rather than a gap the model has filled in.")

    if not out:
        out.append("Nothing specific. The blocks that scored are consistent with each "
                   "other and no single number is carrying the result.")
    return " ".join(out)


# ---------------------------------------------------------------------------
# Longer form, for the detail card
# ---------------------------------------------------------------------------

def verdict(fund):
    """One line placing the fund, used as the headline of the detail card."""
    comp, band = fund.get("composite"), fund.get("band")
    cat, rank, cnt = fund.get("category"), fund.get("categoryRank"), fund.get("categoryCount")
    tier, tsize = fund.get("tier"), fund.get("tierSize")
    if comp is None:
        return (f"Not scored. Too little of the model could be evidenced for this "
                f"scheme to carry a composite.")
    place = f"{rank} of {cnt} in {cat}" if rank else f"in {cat}"
    if tsize and tsize > 1:
        place += (f", inside a tier of {tsize} funds that the model treats as "
                  f"equally ranked")
    return (f"Band {band}, composite {n(comp, 1)}, {place}. "
            f"{fund.get('bandMeaning', '')}")


def score_movers(fund):
    """Where the points are, and where they are not. Ordered by points available,
    so the reader sees what would actually change the answer."""
    rows = []
    for b in fund.get("blocks", []):
        if b["score"] is None:
            rows.append({"block": b["name"], "score": None, "weight": b["weight"],
                         "available": None,
                         "note": "Not scored, so it carries no weight in the composite."})
            continue
        avail = round((100 - b["score"]) * b["weight"] / 100.0, 2)
        rows.append({"block": b["name"], "score": b["score"], "weight": b["weight"],
                     "available": avail,
                     "note": f"Scores {b['score']:.0f} of 100 on a {b['weight']}% block. "
                             f"{avail:.1f} composite points are still on the table here."})
    rows.sort(key=lambda r: -(r["available"] or -1))
    return rows


def build_remark(fund):
    return {
        "verdict": verdict(fund),
        "whyWeLikeIt": why_we_like_it(fund),
        "whatToWatch": what_to_watch(fund),
        "movers": score_movers(fund),
    }
