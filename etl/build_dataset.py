"""Build the mutual-fund dashboard dataset.

Merges four source systems into a single normalised set of JSON files under data/:

  1. Sheety `dataPack` APIs (flexiCap / largeCap / smid / others)  -> quantitative metrics
  2. Avendus Automation workbook (Performance, Equity Attribute,
     Underlying Portfolio sheets)                                 -> AUM, manager, holdings
  3. Mutual Fund Whitelist PDF                                    -> the live house whitelist
  4. Equity MF Selection Policy / Scorecard MASTER                -> encoded in mf/framework.py

Run:  python etl/build_dataset.py --workbook <xlsx> --whitelist-pdf <pdf>

Every argument is optional: whichever sources are supplied get refreshed, the rest
are left as they are on disk. The API pull needs no arguments.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mf.framework import CATEGORY_MAP, POLICY_CATEGORIES  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")

SHEETY_BASE = "https://api.sheety.co/26381234f19b00348c9bb3d7604a8d84/dataPack"
SHEETY_PACKS = ["flexiCap", "largeCap", "smid", "others"]

# The Sheety sheets carry a two-row header. Row 1 becomes the JSON key, row 2 is
# returned as the first data row and tells us which sub-column survived the flatten.
API_FIELD_MAP = {
    "aum &Flows (₹Cr)": "asOfDate",
    "": "cashAndOthers",
    "pointToPointReturns (%)": "return1M",
    "calendarYearReturns (%)": "returnCYTD",
    "medianRollingReturns (%)": "medianRolling3Y",
    "medianRollingReturns2017Cutoff (%)": "medianRolling3Y2017",
    "sharpeRatio": "sharpe3Y",
    "treynorRatio": "treynor3Y",
    "informationRatio": "informationRatio3Y",
    "sortinoRatio": "sortino3Y",
    "stdDev (ann %)": "stdDev3Y",
    "semiStdDev (ann %)": "semiStdDev3Y",
    "maxDrawdown (%)": "maxDrawdown3Y",
    "upsideCapture (%)": "upsideCapture3Y",
    "downsideCapture (%)": "downsideCapture3Y",
    "captureRatio (%)": "captureRatio3Y",
    "beta": "beta3Y",
    "marketCapAllocation (%)": "largeCapPct",
    "expenseRatio (%)": "ter",
}

# Which benchmark each Sheety pack is quoted against.
PACK_BENCHMARK = {
    "largeCap": "Nifty 50 TRI",
    "flexiCap": "Nifty 500 TRI",
    "smid": "BSE MidSmallCap TRI",
    "others": "Nifty 500 TRI",
}


# --------------------------------------------------------------------------- #
# name normalisation — the join key across all four sources
# --------------------------------------------------------------------------- #

_PLAN_SUFFIX = re.compile(
    r"\s*-\s*(dir|direct|reg|regular)\b.*$", re.IGNORECASE)
_NOISE_WORDS = re.compile(
    r"\b(fund|funds|scheme|plan|growth|gr|dir|direct|regular|reg|option|"
    r"payout|idcw|dividend\s+reinvestment|and)\b", re.IGNORECASE)

# Schemes the whitelist deck still calls by a former name, or spells differently
# from the data feed. Keyed on the normalised form so the fix survives further
# punctuation drift.
_KEY_ALIASES = {
    "kotakequityopportunities": "kotaklargemidcap",   # renamed to Large & Midcap
    "trustflexicap": "trustmfflexicap",
    "trustsmalllcap": "trustmfsmallcap",              # deck typo: 'Smalllcap'
    "trustsmallcap": "trustmfsmallcap",
    "trustmidcap": "trustmfmidcap",
    "trustmulticap": "trustmfmulticap",
}


def fund_key(name) -> str:
    """Collapse a scheme name to a stable join key.

    'Aditya Birla Sun Life Large Cap Fund - Dir - Growth' and
    'Aditya Birla Sun Life Large Cap Fund' both collapse to
    'adityabirlasunlifelargecap'.
    """
    s = str(name or "")
    s = _PLAN_SUFFIX.sub("", s)
    s = _NOISE_WORDS.sub(" ", s)
    s = re.sub(r"[^a-z0-9]+", "", s.lower())
    return _KEY_ALIASES.get(s, s)


def clean_display_name(name) -> str:
    """Strip the plan suffix for display but keep the scheme's real words."""
    return _PLAN_SUFFIX.sub("", str(name or "")).strip()


def num(v):
    """Coerce a spreadsheet/API cell to float, mapping '--', '' and 'N/A' to None."""
    if v is None:
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        f = float(v)
        return None if f != f else f  # drop NaN
    s = str(v).strip().replace(",", "")
    if s in ("", "--", "-", "N/A", "#N/A", "NA", "nan", "None"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def as_date(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d")
    s = str(v).strip()
    return s or None


# --------------------------------------------------------------------------- #
# 1. Sheety quantitative packs
# --------------------------------------------------------------------------- #

def fetch_api_packs(cache_dir=None):
    """Pull the four dataPack endpoints. Falls back to a local cache when offline."""
    import urllib.request

    packs = {}
    for pack in SHEETY_PACKS:
        cache = os.path.join(cache_dir, f"{pack}.json") if cache_dir else None
        payload = None
        try:
            url = f"{SHEETY_BASE}/{pack}"
            with urllib.request.urlopen(url, timeout=120) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            if cache:
                with open(cache, "w") as fh:
                    json.dump(payload, fh)
            print(f"  fetched {pack}: {len(payload[pack])} rows")
        except Exception as exc:  # noqa: BLE001 - offline rebuild is a valid mode
            if cache and os.path.exists(cache):
                with open(cache) as fh:
                    payload = json.load(fh)
                print(f"  {pack}: live fetch failed ({exc}); used cache")
            else:
                raise
        packs[pack] = payload[pack]
    return packs


def parse_api_packs(packs):
    """Split the packs into fund records and benchmark records."""
    funds, benchmarks = {}, {}

    for pack, rows in packs.items():
        for row in rows:
            name = str(row.get("fundName") or "").strip()
            if not name:
                continue
            category = str(row.get("category") or "").strip()

            rec = {}
            for src, dst in API_FIELD_MAP.items():
                if src in row:
                    rec[dst] = num(row[src]) if dst != "asOfDate" else as_date(row[src])

            if category.startswith("Benchmark"):
                rec.update({"name": name, "category": category, "pack": pack})
                benchmarks[name] = rec
                continue

            amfi = row.get("amfiCode")
            if not amfi:
                continue

            # Most rows carry a numeric AMFI code; PMS/AIF vehicles carry a
            # 'PMS::<name>' sentinel instead. Those are not SEBI mutual fund
            # schemes, so they are kept out of the scored universe.
            try:
                amfi_code = int(amfi)
                vehicle = "MF"
            except (TypeError, ValueError):
                amfi_code = None
                vehicle = "PMS/AIF"

            key = fund_key(name)
            rec.update({
                "key": key,
                "name": clean_display_name(name),
                "rawName": name,
                "amfiCode": amfi_code,
                "vehicle": vehicle,
                "sourceCategory": category,
                "category": CATEGORY_MAP.get(category) if vehicle == "MF" else None,
                "pack": pack,
                "benchmark": PACK_BENCHMARK.get(pack),
            })
            # 'largeCapPct' is the surviving column of the market-cap allocation
            # block; mid/small are recovered from the Equity Attribute sheet.
            funds[key] = rec

    return funds, benchmarks


# --------------------------------------------------------------------------- #
# 2. Avendus Automation workbook
# --------------------------------------------------------------------------- #

def parse_workbook(path, funds):
    """Enrich fund records with AUM/manager/attributes and pull holdings."""
    import openpyxl

    print(f"  opening workbook {os.path.basename(path)} ...")
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)

    # -- Performance: NAV, corpus (AUM in Cr), fund manager, point-to-point ---
    matched_perf = 0
    ws = wb["Performance"]
    for row in ws.iter_rows(min_row=5, max_col=13, values_only=True):
        name = row[0]
        if not name:
            continue
        # The sheet holds both direct and regular plans; the policy universe is
        # direct-growth only (G6), so regular rows are ignored.
        if not re.search(r"-\s*Dir\b", str(name)):
            continue
        key = fund_key(name)
        fund = funds.get(key)
        if not fund:
            continue
        matched_perf += 1
        fund.update({
            "nav": num(row[1]),
            "navDate": as_date(row[2]),
            "aumCr": num(row[3]),
            "aumDate": as_date(row[4]),
            "fundManager": str(row[5]).strip() if row[5] else None,
            "return3M": num(row[7]),
            "return6M": num(row[8]),
            "return1Y": num(row[9]),
            "return2Y": num(row[10]),
            "return3Y": num(row[11]),
            "return5Y": num(row[12]),
        })
    print(f"  Performance: enriched {matched_perf} funds")

    # -- Equity Attribute: AMC, TER, market-cap split ------------------------
    matched_attr = 0
    ws = wb["Equity Attribute"]
    for row in ws.iter_rows(min_row=5, max_col=10, values_only=True):
        name = row[0]
        if not name:
            continue
        # Direct plans only (G6). Rows carrying no plan suffix at all (ETFs) are
        # kept, since they collapse to a distinct key anyway.
        if re.search(r"-\s*Reg\b", str(name)):
            continue
        key = fund_key(name)
        fund = funds.get(key)
        if not fund:
            continue
        matched_attr += 1
        ter = num(row[3])
        fund.update({
            "amc": str(row[1]).strip() if row[1] else None,
            "attrDate": as_date(row[2]),
            "largeCapPct": num(row[4]) if num(row[4]) is not None else fund.get("largeCapPct"),
            "midCapPct": num(row[5]),
            "smallCapPct": num(row[6]),
            "cashPct": num(row[7]),
        })
        if fund.get("ter") is None and ter is not None:
            fund["ter"] = ter
    print(f"  Equity Attribute: enriched {matched_attr} funds")

    # -- Underlying Portfolio: security-level holdings -----------------------
    holdings = defaultdict(list)
    rows_seen = 0
    ws = wb["Underlying Portfolio"]
    # Holdings are only carried for the scored universe — the eleven SEBI equity
    # categories. Index funds, ETFs, FoFs and hybrids are out of policy scope and
    # their books would triple the payload for no analytical use.
    in_scope = {k for k, f in funds.items() if f.get("category")}
    for row in ws.iter_rows(min_row=5, max_col=15, values_only=True):
        name = row[0]
        if not name:
            continue
        key = fund_key(name)
        if key not in in_scope:
            continue
        pct = num(row[9])
        if pct is None or pct <= 0:
            continue
        rows_seen += 1
        rec = {
            "s": str(row[1]).strip() if row[1] else "",
            "sec": str(row[3]).strip() if row[3] else "Unclassified",
            "pct": round(pct, 3),
        }
        if row[2]:
            rec["isin"] = str(row[2]).strip()
        if row[4]:
            rec["ins"] = str(row[4]).strip()
        if row[10]:
            rec["mc"] = str(row[10]).strip()
        holdings[key].append(rec)
    print(f"  Underlying Portfolio: {rows_seen} holding rows across {len(holdings)} funds")

    # Sort each book by weight; keep the full book (needed for honest overlap maths).
    for key in holdings:
        holdings[key].sort(key=lambda h: -h["pct"])

    wb.close()
    return dict(holdings)


# --------------------------------------------------------------------------- #
# 3. Whitelist PDF
# --------------------------------------------------------------------------- #

# Section headings in the PDF, mapped to the policy's category vocabulary.
_WL_SECTIONS = {
    "large cap": "Large Cap",
    "flexicap": "Flexi Cap",
    "large & midcap": "Large & Mid Cap",
    "midcap": "Mid Cap",
    "smallcap": "Small Cap",
    "focused": "Focused",
    "value/contra/sp situation": "Value / Contra",
    "thematic": "Sectoral / Thematic",
}
_STOP_SECTIONS = {
    "aggressive hybrid", "dynamic asset allocation / balanced advantage",
    "benchmark", "nifty –etf/index funds", "nifty -etf/index funds",
}

_NUM = r"(?:-?\d+\.\d+|--)"
# A scheme row: name, AUM, then six return figures.
_WL_ROW = re.compile(
    rf"^(?P<name>[A-Za-z][A-Za-z0-9&\.\,\'\-\/\(\) ]+?)\s+"
    rf"(?P<aum>\d[\d,]*)\s+(?P<rest>{_NUM}(?:\s+{_NUM}){{5}})\s*$")
# Long scheme names wrap: the figures land on their own line, with the head of
# the name on the line above (trailed by the riskometer band) and the tail on the
# line below (trailed by the word 'Riskometer').
_WL_NUMS_ONLY = re.compile(rf"^(?P<aum>\d[\d,]*)\s+(?P<rest>{_NUM}(?:\s+{_NUM}){{5}})\s*$")
_RISK_BAND = re.compile(
    r"\s*(Very\s+High|Moderately\s+High|High|Moderate|Low\s+to\s+Moderate|Low)\s*$",
    re.IGNORECASE)
_RISKOMETER = re.compile(r"\s*Riskometer\s*$", re.IGNORECASE)


def _wl_entry(name, section, aum, rest):
    vals = [num(v) for v in rest.split()]
    name = re.sub(r"\s+", " ", name).strip()
    return {
        "name": name,
        "key": fund_key(name),
        "pdfSection": section,
        "aumCr": num(aum),
        "pdfReturns": {"3M": vals[0], "6M": vals[1], "1Y": vals[2],
                       "2Y": vals[3], "3Y": vals[4], "5Y": vals[5]},
    }


def parse_whitelist_pdf(path):
    """Read the live house whitelist out of the quarterly PDF."""
    import pdfplumber

    entries = []
    section = None
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages[:8]:  # the equity whitelist tables lead the deck
            lines = [ln.strip() for ln in (page.extract_text() or "").split("\n")]
            for i, line in enumerate(lines):
                low = line.lower().rstrip(":")
                if low in _WL_SECTIONS:
                    section = _WL_SECTIONS[low]
                    continue
                if low in _STOP_SECTIONS:
                    section = None
                    continue
                if not section:
                    continue

                m = _WL_ROW.match(line)
                if m:
                    entries.append(_wl_entry(m.group("name"), section,
                                             m.group("aum"), m.group("rest")))
                    continue

                m = _WL_NUMS_ONLY.match(line)
                if m and i > 0:
                    head = _RISK_BAND.sub("", lines[i - 1])
                    tail = ""
                    if i + 1 < len(lines):
                        cand = lines[i + 1]
                        if _RISKOMETER.search(cand):
                            tail = _RISKOMETER.sub("", cand)
                    if head:
                        entries.append(_wl_entry(f"{head} {tail}", section,
                                                 m.group("aum"), m.group("rest")))

    # De-duplicate on key, keeping the first sighting.
    seen, unique = set(), []
    for e in entries:
        if e["key"] in seen:
            continue
        seen.add(e["key"])
        unique.append(e)

    print(f"  whitelist PDF: {len(unique)} equity schemes across "
          f"{len({e['pdfSection'] for e in unique})} deck sections")
    return unique


# --------------------------------------------------------------------------- #
# assembly
# --------------------------------------------------------------------------- #

def write(name, payload):
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, name)
    with open(path, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"), ensure_ascii=False)
    print(f"  wrote {name} ({os.path.getsize(path) / 1024:.0f} KB)")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--workbook", help="Avendus Automation .xlsx")
    ap.add_argument("--whitelist-pdf", help="Mutual Fund Whitelist .pdf")
    ap.add_argument("--cache-dir", help="directory for raw API responses")
    args = ap.parse_args()

    print("[1/4] Sheety dataPack APIs")
    packs = fetch_api_packs(args.cache_dir)
    funds, benchmarks = parse_api_packs(packs)
    print(f"  parsed {len(funds)} funds, {len(benchmarks)} benchmarks")

    holdings = {}
    if args.workbook:
        print("[2/4] Avendus Automation workbook")
        holdings = parse_workbook(args.workbook, funds)
    else:
        print("[2/4] workbook skipped")

    whitelist = []
    if args.whitelist_pdf:
        print("[3/4] Whitelist PDF")
        whitelist = parse_whitelist_pdf(args.whitelist_pdf)
    else:
        print("[3/4] whitelist PDF skipped")

    print("[4/4] writing data/")
    fund_list = sorted(funds.values(), key=lambda f: f["name"])

    # Mark funds that sit on the live house whitelist, so the dashboard can show
    # framework output against the incumbent list.
    by_key = {f["key"]: f for f in fund_list}
    wl_keys = {e["key"] for e in whitelist}
    for fund in fund_list:
        fund["onHouseWhitelist"] = fund["key"] in wl_keys
        fund["hasHoldings"] = fund["key"] in holdings

    # Resolve each whitelist row to its SEBI category. The deck groups schemes by
    # house presentation (Multi Cap funds sit under a 'Flexicap' heading, for
    # instance); the policy is category-relative, so the fund's own SEBI category
    # wins and the deck section is kept only for traceability.
    unmatched = 0
    for entry in whitelist:
        fund = by_key.get(entry["key"])
        entry["matched"] = bool(fund)
        entry["category"] = (fund or {}).get("category") or entry["pdfSection"]
        if not fund:
            unmatched += 1
    if unmatched:
        print(f"  note: {unmatched} whitelist schemes had no match in the quant feed")

    in_scope = [f for f in fund_list if f["category"]]
    as_of = next((f.get("asOfDate") for f in fund_list if f.get("asOfDate")), None)

    write("funds.json", fund_list)
    write("benchmarks.json", benchmarks)
    write("whitelist.json", whitelist)
    if holdings:
        write("holdings.json", holdings)

    write("meta.json", {
        "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "metricsAsOf": as_of,
        "navDate": next((f.get("navDate") for f in fund_list if f.get("navDate")), None),
        "totalFunds": len(fund_list),
        "inScopeFunds": len(in_scope),
        "fundsWithHoldings": len(holdings),
        "houseWhitelistCount": len(whitelist),
        "categories": {c: sum(1 for f in in_scope if f["category"] == c)
                       for c in POLICY_CATEGORIES},
        "sources": {
            "quantitative": "Sheety dataPack (flexiCap / largeCap / smid / others)",
            "holdings": os.path.basename(args.workbook) if args.workbook else None,
            "whitelist": os.path.basename(args.whitelist_pdf) if args.whitelist_pdf else None,
            "framework": "Equity MF Selection Policy v2.0 + Scorecard MASTER",
        },
    })
    print("done.")


if __name__ == "__main__":
    main()
