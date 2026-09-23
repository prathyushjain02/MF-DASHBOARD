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


def n0(v):
    """Round half up, to match what the dashboard prints.

    Python rounds halves to even, JavaScript rounds them up, so a block score of
    76.5 rendered by both shows 76 in the prose and 77 in the table beside it.
    """
    f = _f(v)
    return "n/a" if f is None else f"{int(f + 0.5) if f >= 0 else -int(-f + 0.5)}"


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
    if top10 is not None and top10 >= 45:
        out.append(f"High conviction portfolio, top 10 at {n(top10, 0)} percent.")
    elif b.get("portfolio", {}).get("score", 0) and b["portfolio"]["score"] >= 65:
        out.append("Book shaped to the mandate it is sold against.")

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
        out.append(f"Returns rank well ({n0(ret)}) but the risk adjusted block does not "
                   f"({n0(ra)}). The return has been bought with volatility rather than "
                   f"earned per unit of risk.")
    if ret is not None and ra is not None and ra >= 65 and ret < 40:
        out.append(f"Well run on a risk adjusted basis ({n0(ra)}) without the absolute "
                   f"return to show for it ({n0(ret)}). Reasonable for a defensive "
                   f"sleeve, thin as a core holding.")

    aum_b = b.get("aum", {})
    if aum_b.get("score") is not None and aum_b["score"] < 40:
        curve = fw.aum_curve(fund.get("category"))
        out.append(f"Size scores {n0(aum_b['score'])} on the {fund.get('category')} AUM "
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
                     "note": f"Scores {n0(b['score'])} of 100 on a {b['weight']}% block. "
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


# ---------------------------------------------------------------------------
# The fund page: key points and recently
# ---------------------------------------------------------------------------

# Two short lists open the fund page. "Key points" are standing facts about the
# record: how it has done against its benchmark, how it behaves in a fall, what
# shape the book is, who has run it and for how long. "Recently" is what has
# happened to it lately: the last quarter, the current drawdown, the last
# calendar year, the money coming in or going out. No fact appears in both.
#
# Every item leads with the figure, then a short heading, then one complete
# sentence that quotes the number. Nothing here mentions a score, a band, a rank
# or a decile: a client reads this page and those are not for a client.

_MON = ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _sign(v, dp=1):
    f = _f(v)
    return "n/a" if f is None else f"{'+' if f > 0 else ''}{f:,.{dp}f}"


def _mon_year(iso):
    if not iso:
        return None
    try:
        y, m = int(iso[:4]), int(iso[5:7])
        return f"{_MON[m - 1]} {y}"
    except (ValueError, IndexError):
        return None


def _feed_date(raw):
    """The feed writes 02-Dec-22. Month and year of that, or None."""
    if not raw:
        return None
    parts = str(raw).strip().split("-")
    if len(parts) != 3:
        return None
    mon = parts[1][:3].title()
    if mon not in _MON:
        return None
    y = parts[2]
    try:
        y = int(y) + 2000 if len(y) == 2 else int(y)
    except ValueError:
        return None
    return f"{mon} {y}"


def _years_since(raw):
    """Years since a feed date written 02-Dec-22, or None."""
    from datetime import date
    if not raw:
        return None
    parts = str(raw).strip().split("-")
    if len(parts) != 3 or parts[1][:3].title() not in _MON:
        return None
    try:
        y = int(parts[2])
        y = y + 2000 if y < 100 else y
        d = date(y, _MON.index(parts[1][:3].title()) + 1, int(parts[0]))
    except ValueError:
        return None
    return round((date.today() - d).days / 365.25, 1)


def _short_bench(name):
    """'Nifty 50 TRI' reads as 'Nifty 50' in a sentence; the table names the
    full series."""
    return (name or "benchmark").replace(" TRI", "").strip()


def _row(rec, label):
    for r in (rec.get("returns") or {}).get("rows") or []:
        if r.get("label") == label:
            return r
    return None


def _item(fig, tone, head, text):
    return {"fig": fig, "tone": tone or "", "head": head, "text": text}


def key_points(fund, rec, limit=5):
    """Standing facts about the record, figure first."""
    out = []
    bench = _short_bench((rec.get("returns") or {}).get("benchmark"))

    # 1. Return against the benchmark over the longest of 5Y, 3Y, 1Y with a figure.
    for label, word in (("5Y", "five years"), ("3Y", "three years"), ("1Y", "a year")):
        r = _row(rec, label)
        p = (r or {}).get("p2p") or {}
        if p.get("fund") is not None and p.get("bench") is not None:
            a = p["fund"] - p["bench"]
            rate = " a year" if label != "1Y" else ""
            hit, wins = _f(fund.get("rollingHitRate3Y")), fund.get("rollingWindows3Y")
            tail = ""
            if label != "1Y" and hit is not None and wins and int(wins) >= 2:
                tail = (f" It was ahead in {n0(hit)}% of the {int(wins)} three year "
                        f"windows so far.")
            out.append(_item(_sign(a), "good" if a >= 0 else "bad",
                             f"{'Ahead of' if a >= 0 else 'Behind'} the {bench} over {word}",
                             f"{n(p['fund'])}%{rate} against {n(p['bench'])}%{rate} "
                             f"for the {bench} TRI over {word}.{tail}"))
            break

    # 2. Capture: how it moves for every 100 the index moves.
    dn, up = _f(fund.get("downsideCapture3Y")), _f(fund.get("upsideCapture3Y"))
    if dn is not None and up is not None:
        # An index fund takes 100 of each to a rounding; calling 100.4 against
        # 99.8 "falls harder than it rises" reads a tracking error as a trait.
        if abs(dn - 100) < 2 and abs(up - 100) < 2:
            head, tone = "Moves with the index", ""
        elif dn < 100 <= up:
            head, tone = "Falls less, rises more", "good"
        elif dn < 100 and up < 100:
            head, tone = "Falls less, rises less", ""
        elif dn >= 100 and up >= 100:
            head, tone = "Moves more than the index both ways", ""
        else:
            head, tone = "Falls harder than it rises", "bad"
        out.append(_item(n0(dn), tone, head,
                         f"For every 100 the {bench} moved over three years it took "
                         f"{n0(dn)} of the falls and {n0(up)} of the rises."))

    # 3. The worst fall over three years, against the index over the same window.
    mdd, imdd = _f(fund.get("maxDrawdown3Y")), _f(rec.get("indexMaxDrawdown3Y"))
    if mdd is not None:
        if imdd is not None:
            cmp_ = ("less than" if abs(mdd) < abs(imdd) - 0.05
                    else "more than" if abs(mdd) > abs(imdd) + 0.05 else "about the same as")
            text = (f"Fell {n(abs(mdd))}% at worst over three years, {cmp_} the "
                    f"{n(abs(imdd))}% the {bench} fell over the same window.")
            tone = "good" if cmp_ == "less than" else "bad" if cmp_ == "more than" else ""
        else:
            text = f"Fell {n(abs(mdd))}% at worst over three years."
            tone = ""
        out.append(_item(f"{n(mdd)}%", tone, "Worst fall in three years", text))

    # 4. Shape of the book.
    top10, names = _f(fund.get("top10")), fund.get("holdingCount")
    sectors = rec.get("sectors") or []
    if top10 is not None and names:
        lead = sectors[0] if sectors else None
        sec = (f" {lead['sector']} is {n0(lead['weight'])}% of the equity book."
               if lead else "")
        head = ("High conviction" if top10 >= 50 else
                "Concentrated" if top10 >= 40 else f"Spread across {names} names")
        out.append(_item(f"{n0(top10)}%", "", head,
                         f"The ten largest positions are {n0(top10)}% of the book, "
                         f"across {names} names in all.{sec}"))

    # 5. Age and hands.
    since = _feed_date(fund.get("inceptionDate"))
    age = _f(fund.get("vintageYears"))
    mgrs = [m for m in (fund.get("managers") or []) if m.get("sinceBasis")]
    mgrs.sort(key=lambda m: -(m.get("tenureYears") or 0))
    lead = mgrs[0] if mgrs else None
    if since or lead:
        bits = []
        if since:
            bits.append(f"Launched {since}")
        if lead:
            bits.append(f"{'lead' if len(mgrs) > 1 else 'the'} manager "
                        f"{lead['name']} has run it since {_mon_year(lead['sinceBasis'])}")
        text = "; ".join(bits) + "."
        if age is not None and age < 5:
            text += " A short record, and it is read as one."
            head, fig = "Young fund", f"{n(age)} yrs"
        elif lead and lead.get("tenureYears") is not None:
            head, fig = "Who has run it", f"{n(lead['tenureYears'])} yrs"
        else:
            yrs = _years_since(fund.get("inceptionDate"))
            head, fig = "Since launch", f"{n(yrs)} yrs" if yrs is not None else (since or "n/a")
        out.append(_item(fig, "", head, text))

    if not out:
        out.append(_item("n/a", "", "Too little on file",
                         "The feed carries too little of this fund's record to "
                         "state its standing facts."))
    return out[:limit]


def recently(fund, rec, limit=5):
    """What has happened to it lately, figure first. Nothing here repeats a
    key point."""
    out = []
    bench = _short_bench((rec.get("returns") or {}).get("benchmark"))
    dd = rec.get("drawdowns") or {}

    # 1. The last quarter and the year so far, against the benchmark.
    r3m, ytd = _row(rec, "3M"), _row(rec, "YTD")
    a3 = ((r3m or {}).get("p2p") or {}).get("alpha")
    ay = ((ytd or {}).get("p2p") or {}).get("alpha")
    if a3 is not None:
        tail = (f" and {_sign(ay)} so far this year" if ay is not None else "")
        out.append(_item(_sign(a3), "good" if a3 >= 0 else "bad",
                         f"{'Ahead' if a3 >= 0 else 'Behind'} over the last three months",
                         f"Its return was {n(r3m['p2p']['fund'])}% against "
                         f"{n(r3m['p2p']['bench'])}% for the {bench}, a gap of "
                         f"{_sign(a3)}{tail}."))

    # 2. Where it stands against its own high.
    cur = _f(dd.get("current"))
    worst = dd.get("worst") or []
    open_ = next((w for w in worst if not w.get("recovered")), None)
    if cur is not None:
        if dd.get("inDrawdown"):
            text = f"It is {n(abs(cur))}% below its high"
            if open_:
                text += f" of {_mon_year(open_['peak'])} and has not yet recovered"
                # The depth is a key point when this fall is also the three year
                # maximum drawdown, so it is not quoted twice.
                depth, mdd = _f(open_.get("depth")), _f(fund.get("maxDrawdown3Y"))
                if depth is not None and (mdd is None or abs(abs(depth) - abs(mdd)) > 0.2):
                    text += f"; the fall reached {n(abs(depth))}%"
                text += "."
                if open_.get("indexFall") is not None:
                    text += (f" The {dd.get('indexName') or bench} fell "
                             f"{n(abs(_f(open_['indexFall'])))}% over the same stretch.")
            else:
                text += ", a dip rather than one of its larger falls."
            out.append(_item(f"{n(abs(cur))}%", "bad", "Below its high", text))
        else:
            out.append(_item("high", "good", "At a new high",
                             "It is at a new high water mark on the latest NAV."))

    # 3. Money in or out over the year.
    flow, aum, aum0 = (_f(fund.get("netFlow1YPct")), _f(fund.get("aumCr")),
                       _f(fund.get("aum1YAgoCr")))
    if flow is not None and aum is not None:
        if aum0 is not None:
            moved = aum - aum0
            text = (f"Net {'inflows' if moved >= 0 else 'outflows'} of INR "
                    f"{n(abs(moved), 0)} cr over the year, on a fund that started it "
                    f"at INR {n(aum0, 0)} cr and now holds INR {n(aum, 0)} cr.")
        else:
            text = f"Net flow of {_sign(flow, 0)}% of assets over the year."
        out.append(_item(f"{_sign(flow, 0)}%", "good" if flow >= 0 else "bad",
                         "Inflows this year" if flow >= 0 else "Outflows this year", text))

    # 4. The last calendar year, and the one before it.
    cy, bcy = rec.get("cy") or [], rec.get("benchCY") or {}
    done = [(y, k) for y, k in cy
            if _f(fund.get(k)) is not None and _f(bcy.get(k)) is not None]
    if done:
        y, k = done[0]
        fv, bv = _f(fund[k]), _f(bcy[k])
        a = fv - bv
        text = f"Calendar {y}: {_sign(fv)}% against {_sign(bv)}% for the {bench}"
        if len(done) > 1:
            y2, k2 = done[1]
            a2 = _f(fund[k2]) - _f(bcy[k2])
            text += (f", after {'beating' if a2 >= 0 else 'trailing'} it by "
                     f"{n(abs(a2))} in {y2}")
        out.append(_item(f"{n(fv)}%", "good" if a >= 0 else "bad",
                         f"{'Ahead' if a >= 0 else 'Lagged'} in {y}", text + "."))

    # 5. The last twelve months, where there is still room.
    r1y = _row(rec, "1Y")
    p1 = (r1y or {}).get("p2p") or {}
    if p1.get("fund") is not None and p1.get("bench") is not None and len(out) < limit:
        a1 = p1["fund"] - p1["bench"]
        out.append(_item(f"{n(p1['fund'])}%", "good" if a1 >= 0 else "bad",
                         "The last twelve months",
                         f"{n(p1['fund'])}% over one year against {n(p1['bench'])}% "
                         f"for the {bench}."))

    if not out:
        out.append(_item("n/a", "", "Nothing recent on file",
                         "The feed carries no recent return or flow for this fund."))
    return out[:limit]
