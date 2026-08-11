"""Build the screener dataset.

Two sources, merged on a normalised scheme key:

  1. The Sheety dataPack sheet  -> every quantitative field
  2. The Avendus Automation workbook (optional) -> AUM, manager, holdings

Run:

    python etl/build_dataset.py                          # quant only
    python etl/build_dataset.py --workbook <file.xlsx>   # quant + holdings
    python etl/build_dataset.py --snapshot               # also archive this build

Both arguments are independent: whichever sources are supplied get refreshed, the
rest are left as they are on disk.

The API's column headers are matched by synonym rather than by exact string, so a
header being renamed upstream does not silently drop a metric. Anything that
cannot be matched is printed at the end of the run under "unmapped columns",
which is the one place a quiet data loss would otherwise hide.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mf.framework import CATEGORY_MAP, CATEGORIES  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
HISTORY_DIR = os.path.join(DATA_DIR, "history")

SHEETY_URL = "https://api.sheety.co/26381234f19b00348c9bb3d7604a8d84/dataPack/sheet1"

DEFAULT_BENCHMARK = "Nifty 500 TRI"


# --------------------------------------------------------------------------- #
# column matching
# --------------------------------------------------------------------------- #
#
# Each target field lists the header forms it answers to. Matching is done on a
# squashed form of the header (lowercase, alphanumerics only), so "Sharpe Ratio
# 3Y", "sharpeRatio3Y" and "sharpe_ratio_3y" all land in the same place.

FIELD_SYNONYMS = {
    "fundName":            ["fundname", "scheme", "schemename", "fund", "name"],
    "category":            ["category", "schemecategory", "cat", "categoryname"],
    "amfiCode":            ["amficode", "amfi", "schemecode", "code"],
    "benchmark":           ["benchmark", "benchmarkname", "benchmarkindex"],

    "aumCr":               ["aumcr", "aum", "aumincr", "aumrscr", "corpus", "corpuscr",
                            "aumcrore", "aumcrores", "netassets"],
    "nav":                 ["nav", "navrs"],
    "navDate":             ["navdate", "asofdate", "asof", "date", "dataasof"],
    "fundManager":         ["fundmanager", "manager", "fundmanagers", "fmname"],
    "amc":                 ["amc", "amcname", "fundhouse", "mutualfund"],
    "ter":                 ["ter", "expenseratio", "expenseratiodirect", "terdirect",
                            "expense"],

    "return1Y":            ["ptp1y", "pointtopoint1y", "return1y", "cagr1y", "oneyear",
                            "r1y", "trailing1y"],
    "return3Y":            ["cagr3y", "return3y", "ptp3y", "threeyear", "r3y",
                            "trailing3y"],
    "return5Y":            ["cagr5y", "return5y", "ptp5y", "fiveyear", "r5y",
                            "trailing5y"],
    "return2Y":            ["cagr2y", "return2y", "twoyear", "r2y"],
    "returnCYTD":          ["cytd", "ytd", "calendarytd", "returnytd"],

    "medianRolling3Y":     ["roll3y", "rolling3y", "medianrolling3y", "medianrollingreturn3y",
                            "medianrollingreturns3y", "rollingmedian3y", "medianroll3y"],
    "medianRolling5Y":     ["roll5y", "rolling5y", "medianrolling5y", "medianrollingreturn5y",
                            "medianrollingreturns5y", "rollingmedian5y", "medianroll5y"],

    "sharpe3Y":            ["sharpe3y", "sharperatio3y", "sharpe"],
    "sharpe5Y":            ["sharpe5y", "sharperatio5y"],
    "sortino3Y":           ["sortino3y", "sortinoratio3y", "sortino"],
    "sortino5Y":           ["sortino5y", "sortinoratio5y"],
    "informationRatio3Y":  ["ir3y", "informationratio3y", "inforatio3y", "informationratio",
                            "ir"],
    "informationRatio5Y":  ["ir5y", "informationratio5y", "inforatio5y"],
    "treynor3Y":           ["treynor", "treynor3y", "treynorratio", "treynorratio3y"],

    "upsideCapture3Y":     ["upcap", "upsidecapture", "upsidecapture3y", "upcapture",
                            "upsidecaptureratio"],
    "downsideCapture3Y":   ["dncap", "downcap", "downsidecapture", "downsidecapture3y",
                            "downcapture", "downsidecaptureratio"],
    "captureRatio3Y":      ["captureratio", "captureratio3y"],
    "maxDrawdown3Y":       ["maxdd", "maxdrawdown", "maximumdrawdown", "maxdrawdown3y",
                            "mdd"],
    "stdDev3Y":            ["stddev", "standarddeviation", "stddev3y", "sd", "sd3y",
                            "volatility"],
    "semiStdDev3Y":        ["semistddev", "semistandarddeviation", "semisd",
                            "semistddev3y", "downsidedeviation"],
    "beta3Y":              ["beta", "beta3y"],
    "alpha3Y":             ["alpha", "alpha3y", "jensensalpha"],

    "decile3Y":            ["decile3y", "categorydecile3y", "quartile3y"],
    "decile5Y":            ["decile5y", "categorydecile5y", "quartile5y"],

    "largeCapPct":         ["largecap", "largecappct", "largecapallocation", "large"],
    "midCapPct":           ["midcap", "midcappct", "midcapallocation", "mid"],
    "smallCapPct":         ["smallcap", "smallcappct", "smallcapallocation", "small"],
    "cashPct":             ["cash", "cashpct", "cashandothers", "cashequivalents"],

    "managerYears":        ["mgryrs", "manageryears", "managertenure", "tenure",
                            "tenureyears", "managertenureyears"],
    "managerExperienceYears": ["expyrs", "experienceyears", "managerexperience",
                               "industryexperience", "experience"],
    "managerCycles":       ["cycles", "marketcycles", "managercycles", "cyclesrun"],
    "vintageYears":        ["vintageyrs", "vintageyears", "vintage", "trackrecord",
                            "trackrecordyears", "ageyears", "inceptionyears"],
    "inceptionDate":       ["inceptiondate", "launchdate", "inception"],
}

# Fields that stay text rather than being coerced to a number.
TEXT_FIELDS = {"fundName", "category", "benchmark", "fundManager", "amc",
               "navDate", "inceptionDate"}


def squash(s):
    return re.sub(r"[^a-z0-9]+", "", str(s or "").lower())


def build_header_map(sample_row):
    """Map the API's own column keys onto our field names."""
    lookup = {}
    for field, syns in FIELD_SYNONYMS.items():
        for s in syns:
            lookup.setdefault(s, field)

    mapping, unmapped = {}, []
    for col in sample_row:
        if col == "id":
            continue
        sq = squash(col)
        field = lookup.get(sq)
        if field is None:
            # Second pass: allow a header that merely contains a synonym, longest
            # synonym first so "downsidecapture" wins over "capture".
            for s in sorted(lookup, key=len, reverse=True):
                if len(s) >= 5 and s in sq:
                    field = lookup[s]
                    break
        if field is None:
            unmapped.append(col)
        elif field not in mapping.values():
            mapping[col] = field
        else:
            unmapped.append(col)  # a second column claiming a taken field
    return mapping, unmapped


# --------------------------------------------------------------------------- #
# name normalisation - the join key across sources
# --------------------------------------------------------------------------- #

_PLAN_SUFFIX = re.compile(r"\s*-\s*(dir|direct|reg|regular)\b.*$", re.IGNORECASE)
_NOISE_WORDS = re.compile(
    r"\b(fund|funds|scheme|plan|growth|gr|dir|direct|regular|reg|option|"
    r"payout|idcw|dividend\s+reinvestment|and)\b", re.IGNORECASE)

_KEY_ALIASES = {
    "kotakequityopportunities": "kotaklargemidcap",
    "trustflexicap": "trustmfflexicap",
    "trustsmalllcap": "trustmfsmallcap",
    "trustsmallcap": "trustmfsmallcap",
    "trustmidcap": "trustmfmidcap",
    "trustmulticap": "trustmfmulticap",
}


def fund_key(name) -> str:
    s = _PLAN_SUFFIX.sub("", str(name or ""))
    s = _NOISE_WORDS.sub(" ", s)
    s = re.sub(r"[^a-z0-9]+", "", s.lower())
    return _KEY_ALIASES.get(s, s)


def clean_display_name(name) -> str:
    return _PLAN_SUFFIX.sub("", str(name or "")).strip()


def num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        f = float(v)
        return None if f != f else f
    s = str(v).strip().replace(",", "").replace("%", "")
    if s in ("", "--", "-", "N/A", "#N/A", "NA", "nan", "None", "#DIV/0!", "#VALUE!"):
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
    return str(v).strip() or None


# --------------------------------------------------------------------------- #
# 1. the quantitative feed
# --------------------------------------------------------------------------- #

def fetch_pack(cache_path=None):
    """Pull the dataPack sheet. Falls back to a local cache when the API is down,
    so a build is never blocked by an upstream outage."""
    import urllib.request

    try:
        req = urllib.request.Request(SHEETY_URL, headers={"User-Agent": "mf-screener/3"})
        with urllib.request.urlopen(req, timeout=180) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        rows = next((v for v in payload.values() if isinstance(v, list)), None)
        if not rows:
            raise ValueError(f"no row array in response: {list(payload)[:5]}")
        if cache_path:
            os.makedirs(os.path.dirname(cache_path), exist_ok=True)
            with open(cache_path, "w", encoding="utf-8") as fh:
                json.dump(payload, fh)
        print(f"  fetched {len(rows)} rows from the dataPack sheet")
        return rows
    except Exception as exc:  # noqa: BLE001 - an offline rebuild is a valid mode
        print(f"  live fetch failed: {exc}")
        if cache_path and os.path.exists(cache_path):
            with open(cache_path, encoding="utf-8") as fh:
                payload = json.load(fh)
            rows = next(v for v in payload.values() if isinstance(v, list))
            print(f"  used cache: {len(rows)} rows")
            return rows
        raise SystemExit(
            f"\nCould not read the quantitative feed and there is no cache to fall "
            f"back on.\n\n  {SHEETY_URL}\n  {exc}\n\n"
            f"Sheety's own error text tells you which end is broken:\n"
            f"  'No project found matching that name'  the project id in the URL is "
            f"wrong or the project was deleted.\n"
            f"  'No sheet found matching that name'    the project is fine, the sheet "
            f"name at the end of the URL is not.\n"
            f"  'Cannot read property ... of undefined' the sheet exists but Sheety "
            f"cannot parse it, which is almost always a blank header row, a blank "
            f"first column, or a merged cell in row 1.\n\n"
            f"Fix the sheet or the URL, then re-run. Nothing was written, so the "
            f"dataset already on disk is untouched.")


def parse_pack(rows):
    """Turn API rows into fund records, splitting benchmarks out as we go."""
    if not rows:
        return {}, {}, []
    mapping, unmapped = build_header_map(rows[0].keys())
    print(f"  mapped {len(mapping)} columns; {len(unmapped)} unmapped")

    funds, benchmarks = {}, {}
    for r in rows:
        rec = {}
        for col, field in mapping.items():
            v = r.get(col)
            rec[field] = as_date(v) if field in TEXT_FIELDS else num(v)
        name = (rec.get("fundName") or "").strip()
        if not name:
            continue
        category = (rec.get("category") or "").strip()

        if category.lower().startswith("benchmark") or "index" in category.lower() \
                and "fund" not in category.lower():
            benchmarks[name] = {**rec, "name": name}
            continue

        # Most rows carry a numeric AMFI code. PMS and AIF vehicles carry a
        # sentinel instead, and they are not SEBI mutual fund schemes, so they
        # are kept out of the scored universe rather than ranked against it.
        try:
            amfi_code, vehicle = int(rec.get("amfiCode")), "MF"
        except (TypeError, ValueError):
            amfi_code, vehicle = None, "PMS/AIF"

        rec["key"] = fund_key(name)
        rec["name"] = clean_display_name(name)
        rec["rawName"] = name
        rec["amfiCode"] = amfi_code
        rec["vehicle"] = vehicle
        rec["sourceCategory"] = category
        rec["category"] = (CATEGORY_MAP.get(category.strip().lower())
                           if vehicle == "MF" else None)
        rec.setdefault("benchmark", None)
        rec["benchmark"] = rec.get("benchmark") or DEFAULT_BENCHMARK
        funds[rec["key"]] = rec

    return funds, benchmarks, unmapped


# --------------------------------------------------------------------------- #
# 2. the workbook (AUM, manager, holdings)
# --------------------------------------------------------------------------- #

def parse_workbook(path, funds):
    import openpyxl

    print(f"  opening workbook {os.path.basename(path)} ...")
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    sheets = set(wb.sheetnames)

    if "Performance" in sheets:
        matched = 0
        for row in wb["Performance"].iter_rows(min_row=5, max_col=13, values_only=True):
            name = row[0]
            if not name or not re.search(r"-\s*Dir\b", str(name)):
                continue
            fund = funds.get(fund_key(name))
            if not fund:
                continue
            matched += 1
            for field, val in (("nav", num(row[1])), ("navDate", as_date(row[2])),
                               ("aumCr", num(row[3])), ("aumDate", as_date(row[4])),
                               ("fundManager", str(row[5]).strip() if row[5] else None),
                               ("return3M", num(row[7])), ("return6M", num(row[8])),
                               ("return1Y", num(row[9])), ("return2Y", num(row[10])),
                               ("return3Y", num(row[11])), ("return5Y", num(row[12]))):
                # The API is authoritative where it carries a value; the workbook
                # only fills the holes.
                if fund.get(field) is None and val is not None:
                    fund[field] = val
        print(f"  Performance: enriched {matched} funds")

    if "Equity Attribute" in sheets:
        matched = 0
        for row in wb["Equity Attribute"].iter_rows(min_row=5, max_col=10, values_only=True):
            name = row[0]
            if not name or re.search(r"-\s*Reg\b", str(name)):
                continue
            fund = funds.get(fund_key(name))
            if not fund:
                continue
            matched += 1
            for field, val in (("amc", str(row[1]).strip() if row[1] else None),
                               ("attrDate", as_date(row[2])), ("ter", num(row[3])),
                               ("largeCapPct", num(row[4])), ("midCapPct", num(row[5])),
                               ("smallCapPct", num(row[6])), ("cashPct", num(row[7]))):
                if fund.get(field) is None and val is not None:
                    fund[field] = val
        print(f"  Equity Attribute: enriched {matched} funds")

    holdings = defaultdict(list)
    if "Underlying Portfolio" in sheets:
        rows_seen = 0
        in_scope = {k for k, f in funds.items() if f.get("category") in CATEGORIES}
        for row in wb["Underlying Portfolio"].iter_rows(min_row=5, max_col=15,
                                                        values_only=True):
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
            rec = {"s": str(row[1]).strip() if row[1] else "",
                   "sec": str(row[3]).strip() if row[3] else "Unclassified",
                   "pct": round(pct, 3)}
            if row[2]:
                rec["isin"] = str(row[2]).strip()
            if row[4]:
                rec["ins"] = str(row[4]).strip()
            if row[10]:
                rec["mc"] = str(row[10]).strip()
            holdings[key].append(rec)
        for key in holdings:
            holdings[key].sort(key=lambda h: -h["pct"])
        print(f"  Underlying Portfolio: {rows_seen} rows across {len(holdings)} funds")

    wb.close()
    return dict(holdings)


# --------------------------------------------------------------------------- #
# validation
# --------------------------------------------------------------------------- #

def validate(funds, holdings, previous_meta, strict=True):
    """Refuse to write a build that has quietly fallen apart.

    Name-based joins degrade silently: a scheme gets renamed upstream, its key
    stops matching, and the fund simply loses its holdings and its AUM without
    anything failing. These checks turn that into a visible error.
    """
    problems, warnings = [], []
    in_scope = [f for f in funds.values() if f.get("category") in CATEGORIES]

    if not funds:
        problems.append("no funds parsed at all")
    if len(in_scope) < 50:
        problems.append(f"only {len(in_scope)} in-scope funds; expected a few hundred")

    join = 100.0 * len(holdings) / max(1, len(in_scope))
    if holdings and join < 50:
        problems.append(f"holdings joined to only {join:.0f}% of in-scope funds")

    for field, floor in (("medianRolling3Y", 40), ("sortino3Y", 40),
                         ("downsideCapture3Y", 40), ("aumCr", 60)):
        have = 100.0 * sum(1 for f in in_scope if f.get(field) is not None) / max(1, len(in_scope))
        if have < floor:
            warnings.append(f"{field} present on only {have:.0f}% of in-scope funds")

    prev = (previous_meta or {}).get("inScopeFunds")
    if prev and len(in_scope) < prev * 0.8:
        problems.append(f"in-scope count fell from {prev} to {len(in_scope)}, "
                        f"more than a fifth of the universe")

    for w in warnings:
        print(f"  warning: {w}")
    for p in problems:
        print(f"  PROBLEM: {p}")
    if problems and strict:
        raise SystemExit("build refused: the checks above would have written a "
                         "silently broken dataset. Re-run with --force to override.")
    return {"warnings": warnings, "problems": problems}


# --------------------------------------------------------------------------- #
# output
# --------------------------------------------------------------------------- #

def write_json(name, payload):
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    print(f"  wrote {name} ({os.path.getsize(path) / 1e6:.2f} MB)")


def snapshot():
    """Archive this build under data/history/<date>/.

    Point in time snapshots cannot be reconstructed after the fact. Every refresh
    that does not archive is a quarter of evidence permanently lost, and without
    the archive there is no way to ever ask whether the model's ranking predicted
    anything.
    """
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    dest = os.path.join(HISTORY_DIR, stamp)
    os.makedirs(dest, exist_ok=True)
    for name in ("funds.json", "meta.json"):
        src = os.path.join(DATA_DIR, name)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(dest, name))
    # Scores, so the archive answers "what did we say at the time" directly.
    try:
        from mf import datastore as ds
        state = ds.load(force=True)
        scores = [{"key": f["key"], "name": f["name"], "category": f["category"],
                   "composite": f.get("composite"), "band": f.get("band"),
                   "categoryRank": f.get("categoryRank"), "tier": f.get("tier"),
                   "evidence": f.get("evidence"),
                   "blocks": f.get("blockScore", {})}
                  for f in state["funds"]]
        with open(os.path.join(dest, "scores.json"), "w", encoding="utf-8") as fh:
            json.dump(scores, fh, separators=(",", ":"))
        print(f"  snapshot: {len(scores)} scored funds archived at data/history/{stamp}/")
    except Exception as exc:  # noqa: BLE001
        print(f"  snapshot: scores not archived ({exc})")


def diff_against_previous(funds):
    """What changed since the last build. This is the monitoring layer: the model
    is recomputed from scratch every time, so movement is only visible if it is
    explicitly diffed."""
    stamps = sorted(os.listdir(HISTORY_DIR)) if os.path.isdir(HISTORY_DIR) else []
    prev_path = None
    for s in reversed(stamps):
        p = os.path.join(HISTORY_DIR, s, "scores.json")
        if os.path.exists(p):
            prev_path = p
            break
    if not prev_path:
        return None
    with open(prev_path, encoding="utf-8") as fh:
        prev = {r["key"]: r for r in json.load(fh)}

    from mf import datastore as ds
    state = ds.load(force=True)
    now = {f["key"]: f for f in state["funds"]}

    added = [now[k]["name"] for k in now if k not in prev]
    dropped = [prev[k]["name"] for k in prev if k not in now]
    moves, band_changes = [], []
    for k in set(now) & set(prev):
        a, b = prev[k].get("composite"), now[k].get("composite")
        if a is not None and b is not None and abs(b - a) >= 5:
            moves.append({"name": now[k]["name"], "from": a, "to": b,
                          "delta": round(b - a, 1)})
        if prev[k].get("band") != now[k].get("band"):
            band_changes.append({"name": now[k]["name"], "from": prev[k].get("band"),
                                 "to": now[k].get("band")})
    moves.sort(key=lambda m: -abs(m["delta"]))
    return {"since": os.path.basename(os.path.dirname(prev_path)),
            "added": added, "dropped": dropped,
            "bandChanges": band_changes, "bigMoves": moves[:25]}


# --------------------------------------------------------------------------- #

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--workbook", help="Avendus Automation xlsx (AUM, manager, holdings)")
    ap.add_argument("--snapshot", action="store_true",
                    help="archive this build under data/history/<date>/")
    ap.add_argument("--diff", action="store_true",
                    help="report what changed against the most recent snapshot")
    ap.add_argument("--offline", action="store_true",
                    help="skip the API and rebuild from the cached response")
    ap.add_argument("--force", action="store_true",
                    help="write the dataset even if the validation checks fail")
    args = ap.parse_args()

    cache = os.path.join(ROOT, "etl", "cache", "dataPack.json")
    prev_meta = {}
    meta_path = os.path.join(DATA_DIR, "meta.json")
    if os.path.exists(meta_path):
        with open(meta_path, encoding="utf-8") as fh:
            prev_meta = json.load(fh)

    print("1. quantitative feed")
    if args.offline:
        with open(cache, encoding="utf-8") as fh:
            rows = next(v for v in json.load(fh).values() if isinstance(v, list))
        print(f"  offline: {len(rows)} cached rows")
    else:
        rows = fetch_pack(cache)
    funds, benchmarks, unmapped = parse_pack(rows)
    in_scope = [f for f in funds.values() if f.get("category") in CATEGORIES]
    print(f"  {len(funds)} schemes, {len(in_scope)} inside the eleven equity categories")

    holdings = {}
    if args.workbook:
        print("2. workbook")
        holdings = parse_workbook(args.workbook, funds)
    else:
        print("2. workbook skipped; holdings left as they are on disk")
        hp = os.path.join(DATA_DIR, "holdings.json")
        if os.path.exists(hp):
            with open(hp, encoding="utf-8") as fh:
                holdings = json.load(fh)

    print("3. validation")
    checks = validate(funds, holdings, prev_meta, strict=not args.force)

    print("4. writing")
    write_json("funds.json", list(funds.values()))
    write_json("benchmarks.json", benchmarks)
    if args.workbook:
        write_json("holdings.json", holdings)
    write_json("meta.json", {
        "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "totalFunds": len(funds),
        "inScopeFunds": len(in_scope),
        "fundsWithHoldings": len(holdings),
        "categories": {c: sum(1 for f in in_scope if f["category"] == c)
                       for c in CATEGORIES},
        "source": SHEETY_URL,
        "unmappedColumns": unmapped,
        "checks": checks,
    })

    if unmapped:
        print(f"\n  unmapped columns ({len(unmapped)}), add a synonym if any of these "
              f"should be scored:")
        for c in unmapped:
            print(f"    - {c}")

    if args.snapshot:
        print("5. snapshot")
        snapshot()
    if args.diff:
        d = diff_against_previous(funds)
        print("\n" + (json.dumps(d, indent=2) if d else "  no earlier snapshot to diff against"))

    print("\ndone.")


if __name__ == "__main__":
    main()
