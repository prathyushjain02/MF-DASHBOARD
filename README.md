# Equity Mutual Fund Selection & Monitoring Dashboard

An operational implementation of the **Equity MF Selection & Monitoring Policy v2.0**
and its companion scorecard workbook. The policy is a document; this is the same
policy as a running system — 567 SEBI equity schemes put through the seven hard
gates, scored on all 21 parameters with category-adjusted weights, classified,
constructed into a whitelist, and monitored against the event triggers.

```
python etl/build_dataset.py --workbook <Avendus_Automation.xlsx> \
                            --whitelist-pdf <Mutual_Fund_Whitelist.pdf>
python -m flask --app server run     # dashboard at /
```

## What it does

| Stage | Policy | Implementation |
|---|---|---|
| Universe | §4 | 1,221 schemes from the feed, 567 inside the eleven SEBI equity categories |
| Stage 1 — gates | §5 | Seven gates; G1/G2/G5/G6/G7 tested from data, G3/G4 returned as `manual` |
| Stage 2 — scoring | §6–7 | 21 parameters, category-adjusted pillar weights, Quant Helper bands |
| Stage 3 — classification | §8 | Composite, ±5 IC overlay, the B1 downside-capture risk cap, four bands |
| Whitelist | §9 | Constructed by depth + per-AMC caps, reconciled against the live house list |
| Guardrails | §10 | Portfolio tested for AMC/scheme caps, core floor, satellite and tactical caps |
| Monitoring | §11 | Automatable triggers (T3–T7) run across the universe as an exception log |

## Rate a fund

Pick any of the 567 in-scope schemes and the framework runs it end to end, then
writes it up. The remark (`mf/narrative.py`) is assembled from the evaluated
record — nothing is generalised from the fund's name, its AMC's reputation or the
category's fashion. If a sentence appears, a number in the record supports it and
the number is quoted alongside.

The page answers, in order: the verdict and what to do about it; what the fund
does well and what gives pause, each tagged to the parameter that evidenced it;
where it stacks as a percentile within its own category on seven metrics; its
pillar scores against the category median; the gate results; **what the framework
has not seen**, with the exact share of the score resting on convention; what
would move the score, with the points available on each parameter; the triggers
firing; what it actually holds; and every parameter in full.

The remark says uncomfortable things when the data supports them. A fund with
excellent downside capture and weak upside capture is told it will trail in
rallies and that the client should hear so before buying, not after. A fund that
scores 83 and fails the vintage gate is told the score is irrelevant this cycle.

## Holdings — what they are used for

The 34,035 security-level positions are not a display feature; they are scoring
inputs. Four of the five Pillar C parameters and one hard gate are computed from
them:

| Use | Where |
|---|---|
| **C1** mandate fidelity | Headroom over the SEBI cap minimums, from the disclosed allocation — 562 funds |
| **C2** concentration | Top-10, largest position, top-3 sector weights against category norms; inverted for Focused — 563 funds |
| **C3** liquidity | Small-cap share of the equity sleeve weighted by AUM — 556 funds |
| **C4** active share | Book structure: holding count against top-10 concentration — 563 funds |
| **G7** concentration sanity | Top-10 ≤60% and single stock ≤10%; **77 funds are rejected on this gate** |
| **G5** mandate compliance | Fallback cap split when the attribute sheet has no mid/small breakdown |

Beyond scoring they drive the overlap analytics: pairwise overlap as Σ min(weight)
over shared names, the substitution check against a fund's top-scoring peers, and
portfolio look-through to stock, sector and market-cap level. That is what turns
§10's "beyond roughly ten schemes, overlap makes the portfolio an expensive index
fund" from a maxim into a number you can see before the allocation is made.

Cash, TREPS and receivables are excluded from the equity sleeve throughout, so
concentration and overlap are computed on the invested book rather than diluted
by cash.

## Our approach

A written page (`fw.APPROACH`) covering how funds are evaluated and why: the three
questions kept separate, rolling over point-to-point, the downside asymmetry, why
gates beat scores, why comparison is category-relative, why data gaps are
disclosed rather than filled, why the whitelist is constructed, why bands beat
percentile ranks, and how the framework audits itself. Each section names the
mechanism that enforces it, plus a section on what the framework deliberately does
*not* do — allocation, theme validation, forecasting.

## Architecture

```
etl/build_dataset.py   Merges four sources into data/*.json. Run offline.
mf/framework.py        The policy encoded as data — every weight, band, gate and
                       threshold. The single source of truth, matching the
                       workbook's Weights tab.
mf/scoring.py          The three-stage engine: gates, 21 parameters, composite,
                       risk cap, classification, triggers.
mf/narrative.py        Writes the analyst remark for a single fund, entirely from
                       its evaluated record.
mf/datastore.py        Loads and evaluates once; whitelist construction, holdings
                       overlap, look-through, IPS guardrail checks.
mf/api.py              Flask blueprint under /api/mf.
static/                The dashboard — no build step, no external dependencies.
```

### Data sources

| Source | Supplies |
|---|---|
| Sheety `dataPack` APIs (flexiCap / largeCap / smid / others) | Rolling returns, Sharpe / Sortino / Treynor / information ratio, SD, semi-SD, max drawdown, up/down capture, beta, TER, market-cap allocation, benchmarks |
| Avendus Automation workbook | AUM, NAV, fund manager, point-to-point returns, AMC, market-cap split, and 34,035 security-level holdings across 563 funds |
| Mutual Fund Whitelist PDF | The live Jul–Sep 2026 house whitelist, for reconciliation |
| Policy docx + Scorecard xlsx | The framework itself — `mf/framework.py` |

The four sources are joined on a normalised scheme key. Direct-growth plans only,
per gate G6.

## The honesty rule

The policy says that where a parameter's data is unavailable it scores 3 and is
flagged — an analyst never guesses, and a data gap never silently punishes or
rewards a fund (§6.2). The engine follows this literally and surfaces it: every
parameter reports whether its score was **measured**, derived from **holdings**,
or assigned by **convention**, and each fund carries an evidence figure — the
share of its total weight resting on measured data. Roughly 80% of a typical
score is evidenced; the remainder is Pillars D and E's analyst inputs (manager
tenure, AMC process, governance, disclosure), which are judgement calls by design
rather than gaps in the pipeline.

Three parameters are explicit proxies, and say so in their own notes rather than
in a footnote:

- **A2** (rolling-return consistency) uses the 3Y information ratio. The parameter
  wants the share of daily-rolled 3Y windows beating the benchmark, which needs a
  NAV pipeline; excess return over its own tracking error is the closest available
  measure of how *reliably* rather than how much a fund beats its benchmark.
- **C3** (portfolio liquidity) uses the small-cap share of the book weighted by
  AUM. Days-to-liquidate at 20% of ADTV needs security-level volume data.
- **C4** (active share) reads book structure — holding count against top-10
  concentration. True active share needs benchmark constituent weights.

Gates G3 and G4 are returned as *unassessable* rather than passed. Silently
passing a gate the data cannot test would misstate the eligible universe, which is
the one thing a selection framework must not do.

## API

| Endpoint | Returns |
|---|---|
| `GET /api/mf/meta` | Universe counts, category coverage, build metadata |
| `GET /api/mf/framework` | The whole encoded policy |
| `GET /api/mf/funds` | Scored universe; filters for category, classification, gates, AUM, downside capture, search |
| `GET /api/mf/fund/<key>` | Full scorecard plus the written remark, pillar comparison against category medians, and overlap with top peers. `?overlay=±5` re-runs Stage 3 with an IC overlay |
| `GET /api/mf/category/<name>` | Category dossier: mandate, weights and rationale, peer dispersion, league table |
| `GET /api/mf/whitelist` | Constructed whitelist, AMC concentration, construction notes, reconciliation against the house list |
| `GET /api/mf/holdings/<key>` | Security-level book with derived statistics |
| `GET /api/mf/overlap?keys=a,b,c` | Pairwise overlap matrix; shared positions for a pair |
| `POST /api/mf/portfolio` | `{"weights": {"<key>": pct}}` → guardrail checks, look-through, overlap |
| `GET /api/mf/monitoring` | Every automatable trigger currently firing |

## Rebuilding the data

`etl/requirements.txt` holds the extraction-only dependencies (`openpyxl`,
`pdfplumber`). The Flask app reads the built JSON and needs neither. Arguments
are independent — omit `--workbook` to refresh only the API metrics.

Changing a weight, band or threshold means editing `mf/framework.py` and the
companion workbook together. The policy calls changing one without the other a
breach, and the dashboard would disagree with the workbook it claims to implement.

## Notes on the current cycle

- 328 of 567 schemes are rejected at Stage 1, 245 of them on the vintage gate.
  Several score above 80 and are still rejected — that is the gate working as
  designed, not a scoring failure.
- The framework's constructed whitelist and the live house whitelist agree on 9
  names. Every disagreement is attributed to a specific rule: a failed gate, the
  two-per-AMC cap, or a rank below the category's depth guidance.
