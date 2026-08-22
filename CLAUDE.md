# CLAUDE.md

Guidance for Claude Code and other AI assistants working in this repository.

## What this is

An actively managed Indian equity mutual fund screener: a Flask JSON API over a
committed dataset, plus a dependency-free static dashboard that reads it. The
model ranks every scheme inside its own SEBI category on seven weighted blocks,
bands the result, and presents the same universe two ways behind a Client /
Analyst toggle.

There is no database, no build step for the frontend, and no live API call at
request time. `data/*.json` is committed to the repo and is the whole input.

## Running it

```bash
pip install -r requirements.txt
python -m flask --app server run --port 5000        # http://127.0.0.1:5000
# or exactly as production runs it:
gunicorn server:app --bind 0.0.0.0:5000 --workers 2 --preload --timeout 120
```

`/health` returns `ok` with the fund count, or `503 degraded` when the dataset
failed to load. The universe is scored once at import (`server.py` calls
`datastore.load()` at module level) so `--preload` shares it copy-on-write
across gunicorn workers and the health check only passes once data is ready.

Deployment is Render, via `render.yaml` (blueprint) or `Procfile`. Python 3.11.

There are no tests, no linter config and no CI beyond the nightly data refresh.
Verify changes by starting the server and hitting the endpoints or the page.

## Layout

```
server.py               Flask app: static file serving, /health, legacy yfinance
                        equity endpoints. Registers the mf blueprint.
mf/framework.py         The model as data. Single source of truth: categories,
                        blocks and weights, mandates, benchmarks, AUM curves,
                        bands, glossary, methodology copy.
mf/screener.py          The engine: scales, holdings-derived metrics, block
                        scores, composite, flags, ranking and tiers.
mf/datastore.py         Loads data/*.json once, scores it, holds the derived
                        views (category books, growth series, look-through).
mf/narrative.py         Why we like it / What to watch, generated from the
                        fund's own record.
mf/api.py               Flask blueprint, everything under /api/mf.
etl/build_dataset.py    Feed + workbook + manager master -> data/*.json. Offline.
etl/build_navs.py       Daily NAV history -> data/navs.json. Offline.
static/                 The dashboard: index.html, app.js, charts.js, styles.css.
data/                   The committed dataset. history/<date>/ holds snapshots.
.github/workflows/      Nightly NAV refresh.
```

## Data flow

```
Sheety quant feed ─┐
Underlying.xlsx    ├─ etl/build_dataset.py ─> data/funds.json, holdings.json,
fundmgr_master.xlsx┘                          benchmarks.json, meta.json
api.mfapi.in + Yahoo ─ etl/build_navs.py ───> data/navs.json

data/*.json ─> mf.datastore.load() ─> mf.screener.score_universe() ─>
               in-memory scored universe ─> mf.api ─> static/app.js
```

The ETL is run by hand (or by the nightly workflow for NAVs) and its output is
committed. The server never writes data.

## The model, in brief

Seven blocks, weights summing to 100, defined in `framework.BLOCKS`:

| Code | Block | Weight |
|---|---|---|
| `return` | Return and consistency | 27 |
| `riskAdj` | Risk adjusted | 24 |
| `capture` | Capture and drawdown | 18 |
| `portfolio` | Portfolio | 12 |
| `manager` | Manager | 8 |
| `vintage` | Track record length | 6 |
| `aum` | AUM (category adjusted) | 5 |

Pipeline: `raw metric -> 0-100 metric score -> block score -> composite -> band`.

Four scales, chosen per metric by its `direction` field: `high` / `low` become a
**percentile within the fund's own category**, `curve` maps AUM through a
per-category piecewise curve, `absolute` clamps a value that is already 0-100
(mandate fit), and band-style scoring is handled in code.

Rules that are load-bearing and must not be quietly relaxed:

- **Nothing is imputed.** A missing metric narrows the evidence base; it never
  fills with a neutral middle value. Blocks reweight over the metrics present,
  the composite reweights over the blocks that scored.
- **`MIN_EVIDENCE = 60`.** Below 60% of block weight scored, a fund carries no
  composite, is banded `Not rated` and is excluded from ranking. It keeps all
  its block scores and data.
- **Support metrics cannot stand a block up alone.** Metrics flagged
  `"support": True` (recent 6M and 1Y) tilt the return block but a block with
  only support metrics present scores `None`.
- **`percentile()` needs at least 3 peers**, otherwise it returns `None` rather
  than inventing a 50 or a 100.
- **`MEANINGFUL_GAP = 3.0`.** Funds within 3 composite points of their tier
  leader share a tier. The model orders a shortlist, it does not select.
- **Vintage is weighted, not gated. Manager tenure is a flag, never a reject.**
- **`EXCLUDED_AMCS`** (15 fund houses) is a coverage decision applied when the
  universe is assembled, never expressed as a score. Note Quant and Quantum are
  different houses; only Quantum is held out.

## API surface

All under `/api/mf` (`mf/api.py`):

| Endpoint | Returns |
|---|---|
| `GET /meta` | Universe counts, bands, categories, build metadata |
| `GET /framework` | The whole model as data, for the methodology page |
| `GET /process` | Live figures behind each of the six selection factors |
| `GET /funds` | Filtered, sorted table rows (`category`, `band`, `amc`, `q`, `minAum`, `maxDownside`, `hasHoldings`, `rated`, `sort`, `dir`, `limit`) |
| `GET /fund/<key>` | Full detail record for one fund |
| `GET /nav/<key>?period=` | Rebased growth: fund, index, category average |
| `GET /category/<name>` | Category dossier |
| `GET /shortlists` | Every category's shortlist in one payload |
| `GET /holdings/<key>` | Full equity book plus portfolio stats |
| `GET /overlap?keys=` | Pairwise overlap across funds |
| `POST /portfolio` | Look-through for `{"weights": {"<key>": pct}}` |
| `GET /compare?keys=` | Side by side on blocks and headline metrics |

Outside the blueprint, `server.py` also carries `/health`, `/api/marketStatus`
and two legacy `yfinance`-backed equity endpoints that predate the screener.
`yfinance` is imported defensively and may be absent.

The methodology page is generated from `/framework`, which serves
`framework.py` objects directly. That is deliberate: the page cannot drift away
from the engine. Do not hardcode model copy or weights in `app.js`.

## Frontend conventions

- **No build step, no dependencies.** `index.html` loads `charts.js` then
  `app.js` as plain scripts. Charts are hand-written SVG in `charts.js`
  (`bars`, `blockBar`, `growthLines`, `scatter`, `histogram`, `rangeStrip`,
  `funnel`, plus `seqColor` / `seqInk` and the shared tooltip). Do not add a
  bundler, a framework or a CDN chart library.
- **Client / Analyst mode decides what the page is for.** Anything score-bearing
  (composite, band, rank, tier, block scores, weights, coverage, evidence, engine
  flags, methodology tables) must be **removed from the DOM** in client view, not
  hidden with CSS, so a screenshot of client view cannot leak it. Gate on
  `isAnalyst()` when building the HTML string.
- **Every technical term carries its meaning on hover.** Wrap printed labels in
  `term(label)`; it resolves against `framework.GLOSSARY` served through
  `/framework`, walking from the specific form ("Sortino 5Y") down to the bare
  term. Call `wireGlossary(host)` after rendering.
- **Always `esc()` interpolated values.** The views build HTML strings.
- **House style (Avendus template).** Light only, `color-scheme: light`, square
  corners, tables ruled in red with a zebra body. Colour tokens live at the top
  of `styles.css`: `--seq-*` is the sequential ramp for magnitude, `--series-*`
  is a fixed categorical order used only where a mark carries a direct label,
  `--good/--warning/--serious/--critical` are status. Magnitude gets a
  sequential ramp; identity gets the categorical set; never cycle the latter.
  Marks stop one step short of the darkest token, which is reserved for text.
- **Number formatting:** `cr` lowercase, `INR` rather than a rupee glyph,
  sentence case in headings, `—` for missing values (`num()`, `cr()` handle it).
- **No em dashes** anywhere user facing, in code comments or in copy. This is a
  house rule stated in `framework.py` and followed throughout.

## Refreshing the data

```bash
pip install -r etl/requirements.txt

# full rebuild
python etl/build_dataset.py --workbook <Underlying.xlsx> \
    --managers <fundmgr_master.xlsx> --snapshot --diff

# NAV history only (what the nightly job runs)
python etl/build_navs.py --refresh --workers 8
```

Every argument is independent: omit `--workbook` and only the feed refreshes,
holdings are left as they are. Flags worth knowing:

- `--snapshot` archives the build to `data/history/<date>/`. Point-in-time
  snapshots cannot be reconstructed later, so a refresh without one is evidence
  permanently lost.
- `--diff` reports funds added and dropped, band changes, and composite moves of
  5 points or more against the last snapshot.
- Validation can **refuse the write**: `validate()` checks join rate, field
  coverage and universe size against the previous build and aborts rather than
  writing a broken dataset. `--force` overrides. `build_navs.py` has its own
  guard and leaves yesterday's file in place if fewer than 80% of schemes
  returned a series.
- **Unmapped columns are printed** at the end of a `build_dataset` run and
  recorded in `meta.json`. That is the one place a quiet upstream rename would
  otherwise hide. Column headers are parsed generically (stem + `[horizon]` +
  optional `Decile`), not matched against a list of full names.

`.github/workflows/refresh-navs.yml` runs `build_navs.py` at 23:30 UTC (05:00
IST) and commits `data/navs.json`. GitHub only schedules workflows from the
repository's default branch; on any other branch it exists but never fires on
its own, so use Run workflow to trigger it by hand.

## Data files

| File | Shape |
|---|---|
| `funds.json` | List of ~606 scheme records, one flat dict each, keyed by `key` |
| `holdings.json` | `{fundKey: [{s, sec, pct, isin, ins, mc}, ...]}` |
| `benchmarks.json` | `{"Nifty 500 TRI": {...}, ...}` in the same shape as a fund |
| `navs.json` | `{funds, indices, indexByCategory, benchmarks, benchmarkByCategory, categoryAverage}`, each series encoded `{d: [iso...], v: [float...]}` |
| `meta.json` | Build timestamp, counts per category, market cycles, validation checks |

`funds.json` holds every scheme the feed carries; the scored universe is what
survives the scope rules (`category in CATEGORIES` and not an excluded AMC).
Current build: 606 total, 270 in scope. Read `data/meta.json` for live figures
rather than quoting numbers from memory.

Caps appear on two different denominators and must not be mixed: `capMix` is
derived from the holdings book and is a share of the **equity sleeve**, while
`largeCapPct` / `midCapPct` / `smallCapPct` / `cashPct` come from the feed and
are shares of the **whole fund**, summing to 100.

## Conventions

- **Commits**: sentence case, imperative, no prefixes or tags. Describe the
  change in the subject and put the reasoning in the body, with concrete figures
  where they make the case ("Annualise the growth readout past a year"). Bodies
  are prose, not bullet lists.
- **Comments explain why, not what.** Every non-obvious choice in this codebase
  carries a comment justifying it, usually naming the failure mode it prevents.
  Match that density when adding code; do not strip existing rationale.
- **Change the model in `framework.py`, not in the engine.** Weights, metrics,
  curves, bands, benchmarks and copy are data. `screener.py` should stay generic
  over whatever `BLOCKS` contains.
- **Python**: `from __future__ import annotations`, module docstrings that lay
  out the shape of the thing, no type annotations in most signatures, standard
  library only in `mf/` (Flask aside). Keep it that way; `mf/` must import
  without pandas, numpy or yfinance.
- Work happens on the branch named in the task. `etl/cache/` is gitignored.

## Gotchas

- **The README is partly stale. Code is the source of truth.** Known drift: it
  says the evidence floor is 55% (`MIN_EVIDENCE` is 60), quotes a 240-scheme
  universe (currently 270 in scope), and lists ELSS among the categories read
  against the Nifty 500. ELSS was removed from scope and appears nowhere in
  `mf/`; it survives only in `data/history/2026-08-11/`. If you touch behaviour
  the README describes, update the README in the same commit.
- `AUM_CURVES` still carries a `Sectoral / Thematic` entry although that category
  is out of scope. Harmless, but do not read it as evidence the category is live.
- `SELECTION_GROUPS` is defined twice, identically, in `framework.py`.
- The universe is scored **once per process**, at import. Editing `data/*.json`
  or the scoring code requires a server restart; `datastore.load(force=True)` is
  the only way to re-evaluate in place.
- `data/*.json` totals roughly 8 MB and is committed. Expect large diffs on any
  data refresh and keep code changes in separate commits from data refreshes.
- Categories that are a SEBI label rather than a real peer group would leave
  `differentiation` unscored via `LOOSE_PEER_GROUPS`; that dict is currently
  empty but the mechanism is wired and should stay.
- Two benchmark concepts coexist and are not interchangeable: `BENCHMARKS`
  (the summary series a category is read against, labelled `benchmark` or
  `index` depending on whether it is the real thing or the closest stand-in),
  and `BENCHMARK_SERIES` / `INDEX_BY_CATEGORY` (what the growth chart draws).
  A proxy must always be labelled as one wherever it appears.

## Where to make a change

| Task | File |
|---|---|
| Weights, metrics, bands, glossary, methodology copy | `mf/framework.py` |
| How a metric turns into a score, flags, ranking | `mf/screener.py` |
| A new derived view or growth-series behaviour | `mf/datastore.py` |
| A new endpoint or a filter on `/funds` | `mf/api.py` |
| Written rationale on a fund | `mf/narrative.py` |
| Page layout, cards, modals, client/analyst gating | `static/app.js` |
| A chart form or its hover behaviour | `static/charts.js` |
| Colour, type, spacing tokens | `static/styles.css` |
| Field mapping, joins, validation on rebuild | `etl/build_dataset.py` |
| NAV or index series | `etl/build_navs.py` |
