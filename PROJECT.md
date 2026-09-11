# The mutual fund screener, end to end

What the project is, where it stands, what the dashboard puts on screen, and why
each thing is drawn the way it is.

This is the long account. `README.md` is the short one: clone, run, deploy.

---

## 1. What this is

An active equity mutual fund screener for Indian schemes, built as a Flask API
with a plain-JavaScript dashboard in front of it. It does two jobs that usually
live in two different documents:

1. **Rank.** Score every actively managed equity scheme against the other
   schemes in its own category, on seven weighted blocks, and order a shortlist.
2. **Present.** Show that shortlist the way a client should see it, with a
   written rationale, and keep the number itself behind an analyst toggle.

The central design commitment is that **a fund is only ever compared with its
true peers**. Nothing is scored on an absolute scale. A small cap fund is not
marked against a large cap fund, and a category-wide drawdown does not push a
whole category down the list, because every metric becomes a percentile inside
its own category before it is scored.

The second commitment is that **a gap in the data is reported, never filled**.
No missing value is replaced with a neutral middle. A block reweights over the
metrics it actually has, the composite reweights over the blocks that scored,
and every fund carries the share of the model's weight that was evidenced.

### At a glance, as of the 8 September 2026 build

| | |
|---|---|
| Schemes in the feed | 606 |
| In scope after the category and AMC rules | 211 |
| Carrying a composite score | 175 |
| Not rated for want of evidence | 36 |
| Categories | 9 (Dividend Yield currently has no scheme in scope) |
| Fund houses represented | 32 |
| Bands | A 21 · B 51 · C 76 · Review 27 |
| Median evidence across the universe | 100% |
| Daily NAV series held | 211 funds, 4 indices, 8 category averages |
| Disclosed holdings books | 210 of 211 in scope |

---

## 2. Where it stands

**Working and in daily use.** The dashboard is complete across five views, the
model is stable, and the data refreshes itself every morning at 05:00 IST
through a GitHub Actions workflow that rebuilds `data/*.json` and commits them.
The commit is what triggers a redeploy, so nothing on the running service has to
be touched for the numbers to move.

**What has been built, in the order it was built.** The scoring engine and the
category shortlists came first, then the fund detail page, then the NAV history
and the growth chart, then the six-factor selection staircase that explains the
approach, then the compare tab, which replaced an earlier portfolio look-through
tab that asked for weights before it would say anything.

**What is deliberately not there.** There is no login, no database, no build
step for the front end, and no server-side state. The dataset is a handful of
committed JSON files, loaded once per process at boot. That is a real constraint
and it shapes everything below.

### Known gaps

These are gaps in the evidence, not in the code. Each is handled by narrowing
what the model claims rather than by guessing.

| Gap | What it costs | How it is handled |
|---|---|---|
| No holdings file from a year earlier | Name retention cannot be computed | The metric is wired but carries **zero weight**, so it cannot silently move a score |
| No benchmark constituent weights | True active share is unavailable | Differentiation is proxied by overlap against the category's own average book |
| Expense ratio is thin: 94 of 211 | Cost cannot be scored | It is a context field only, printed where known and dashed where not |
| 22 of 211 have no manager record | Tenure and cycles unknown | The manager block is reported unscored rather than guessed |
| The monthly series starts June 2018 | Rolling windows cannot see further back | Fund age is recovered separately from manager appointment dates |
| Only three benchmark series are published in the feed | Three categories have no exact benchmark | They are read against the closest available series, which is labelled an **index** rather than a benchmark wherever it appears |

---

## 3. Where the numbers come from

Three sources, joined on a normalised scheme key, plus two live services for
price history.

### 3.1 The quantitative feed (Sheety)

```
https://api.sheety.co/.../allFundsQuantData/allFunds
```

A Google Sheet published as JSON, edited by hand every few weeks. It carries
every ratio and return the model scores: median rolling returns at 1, 3, 5, 7
and 10 years, Sharpe, Sortino, Information Ratio and Treynor at each horizon,
upside and downside capture, maximum drawdown, standard deviation, beta, AUM,
NAV, net flow and the deciles.

The sheet has a **two-row header**: row 1 is the metric, row 2 is the horizon.
Sheety turns row 1 into the JSON key and hands row 2 back as the first data row.
The ETL reads that horizon rather than assuming it, which is not cosmetic — a
past version of this feed published a 1Y median rolling return where the
previous one published 3Y, and a hardcoded suffix would have relabelled a
one-year number as a three-year one and scored it as such.

Columns are matched **by synonym, not by exact string**, and anything unmatched
is printed at the end of the run under "unmapped columns". That is the one place
a quiet data loss would otherwise hide.

### 3.2 The Underlying workbook (optional, for a full rebuild)

Supplies what the feed does not: AMC, cap split, expense ratio, security-level
holdings, and two sheets that do more than fill gaps.

- **Mom Performance** — 97 months of returns per scheme, June 2018 onward. This
  makes the rolling figures *computed* rather than taken on trust: 62 rolling
  three-year windows and 38 five-year ones per fund, plus the **rolling hit
  rate**, the share of three-year windows that actually beat the benchmark. A
  fund can carry a strong median while losing most of its windows, if one great
  stretch pulls the average up; the hit rate separates the two.
- **BMMom Performance** — the same for 13 benchmarks. It supplies the hit rate's
  comparison line and **derives the market cycles** the manager block counts: a
  cycle is a peak-to-trough fall of at least 12% in the index's own monthly
  series, so the dates come from the data rather than from a remembered list.

### 3.3 The fund manager master

Tenure and industry experience per manager per scheme. Tenure is taken from the
**longest-serving** manager, because the question is how long this money has
been run by the people running it now.

It also fixes something it was not collected for. Fund age was being read off
the length of the return series, which pinned a large part of the universe at
the same ceiling and stopped the track record block discriminating at all. A
manager cannot have run a fund before the fund existed, so a dated appointment
older than the return window is a hard lower bound on the fund's age.

### 3.4 Daily NAV history (mfapi.in)

The feed carries summary returns but no NAV series, so the growth chart would
have nothing to plot. `etl/build_navs.py` fetches the daily NAV of every
in-scope scheme from the public AMFI mirror, keyed on the AMFI scheme code the
feed already carries.

Resolution is deliberately mixed: **every trading day inside the last two years,
one point a week before that**, capped at eight years. A five-year chart is a
few hundred pixels wide, so daily points that far back are bytes nobody can see,
and the recent end is where the shape actually gets read.

The category average line is built from **daily returns rather than rebased
NAVs**, so a fund that launched part way through the window joins the average on
the day it starts instead of dragging the whole line down to its own base.

### 3.5 Index history (Yahoo, through yfinance)

The market line on every chart. Yahoo rejects cold clients with a 429, so the
build primes a session against `fc.yahoo.com` before asking for anything.

Several tickers are listed per index because Yahoo's coverage of the Indian mid
and small cap series is uneven; the build tries them in order and keeps the first
usable history, so a symbol that goes away downgrades the chart rather than
breaking the build. Where none resolves, it falls back to an AMFI index tracking
scheme read from the same NAV source as the funds.

**These are price indices.** They exclude the dividends a fund's NAV already
contains, so they read low against the funds by roughly the market's dividend
yield a year. That is stated on every chart that draws one, because a comparison
whose basis is not stated is worse than no comparison.

---

## 4. The model

```
raw metric  ->  0-100 metric score  ->  block score  ->  composite  ->  band
```

### 4.1 The seven blocks

| Block | Weight | What it reads |
|---|---|---|
| Return and consistency | 27% | Median rolling returns at 1/3/5/7/10Y, the share of rolling 3Y windows beating the benchmark, plus small support weights on trailing 6M and 1Y |
| Risk adjusted | 24% | Information Ratio, Sortino and Sharpe at 3/5/7/10Y. IR carries the most weight inside the block |
| Capture and drawdown | 18% | Upside capture, downside capture and maximum drawdown at 3/5/7/10Y. Downside weighs more than upside |
| Portfolio | 12% | Cap-mix fit to the SEBI mandate, and differentiation against the category's average book |
| Manager | 8% | Tenure on this scheme and market cycles actually run |
| Track record length | 6% | Longer live history scores higher |
| AUM, category adjusted | 5% | Size read against the mandate, on a different curve per category |

**Why the return block is built on rolling medians.** A single point-to-point
number can hang on one lucky start or end date. Taking every window of a given
length and reporting the middle one answers "what did a typical holding period
actually deliver", which is the question a client is really asking.

**Why Information Ratio carries the most weight of the three ratios.** It is
return earned per unit of risk taken *away from the benchmark*, which is
precisely the thing an active fee is charged for.

**Why standard deviation, semi standard deviation and Treynor are shown but not
scored.** They move almost in lockstep with Sortino and downside capture, so
scoring them would weight volatility three or four times over. They stay
visible, with a note saying why they are not scored.

**The support metrics.** Trailing 6M and 1Y returns sit in the return block at
small weight and are marked `support`. They exist so a fund lagging its peers
*right now* is not entirely hidden behind a strong lifetime record. They are
marked support because a block that scored on nothing but support metrics is not
evidence: a seven-month-old fund once reached the top of its category on a
single six-month data point, and the guard exists because of it.

### 4.2 The four scales

| Scale | Used for | How |
|---|---|---|
| `percentile` | everything comparative: returns, ratios, capture | Rank within the fund's own category, 0-100, ties sharing a mid rank. Returns `None` below three peers, because a single-fund category would otherwise be handed a 50 out of thin air |
| `curve` | AUM | Piecewise-linear map from the raw value to 0-100, flat outside the end points, with a different curve per category |
| `absolute` | mandate fit | The raw value is already a meaningful 0-100: full compliance is 100 and nothing else is |
| `band` | — | Distance from a target range. Currently unused |

### 4.3 AUM is scored by category

Six distinct curves, because size means different things in different mandates.

| Shape | Categories | Reading |
|---|---|---|
| Nimble | Smallcap | Score falls as AUM rises. Capacity is the binding constraint, with a floor below which the fund is too small to be viable |
| Middle band | Midcap, Focused, Dividend Yield (and Sectoral / Thematic, defined but out of scope today) | Very small is a viability risk, very large is a capacity risk in a shallower market |
| Scale | Largecap, Flexicap, Multicap, Large & Midcap, Value / Contra | Scale is rewarded, with a floor for viability and a mild taper at the very top so a genuinely enormous book is not scored identically to one a fifth its size |

### 4.4 Missing data, evidence and the rating floor

Nothing is imputed. A block reweights over the metrics present; the composite
reweights over the blocks that scored; **evidence** is the share of the model's
total weight that could be measured.

Below **60% evidence** no composite is published at all and the fund reads *Not
rated*. Sixty is not arbitrary: the risk-adjusted block (24) and the capture
block (18) are 42 points between them, and a fund that can be measured for
neither risk-adjusted return nor drawdown behaviour is not a fund that can be
ranked. A young fund missing just one of them still clears the floor.

A `Not rated` fund is not hidden. Every figure it does have is shown in full,
with a flag explaining that this is a gap in the feed and not a verdict.

### 4.5 Bands and tiers

| Band | Composite | Meaning |
|---|---|---|
| A | 72+ | Shortlist. Ranks well across most blocks, not on one number alone |
| B | 58-71 | Investable, with something specific to discuss |
| C | 42-57 | Below the category standard on more than one block. Hold, do not add |
| Review | below 42 | Weak across the blocks that scored. Needs an analyst first |
| Not rated | — | Under the evidence floor |

The bands are intentionally wide. A gap of less than **3 points** is not a real
difference, so funds inside that distance are grouped into equal-rank tiers
rather than being ranked 1, 2, 3 as though the model could tell them apart.

### 4.6 Flags

Flags are engine observations attached to a fund, never rejections:

- **New Manager** — under three years on this scheme
- **Manager tenure not captured** — no manager record on file, block unscored
- **Short record** — five years or less of live history
- **Mandate shortfall** — the disclosed book is under a SEBI minimum, with the size of the shortfall
- **Capacity watch / Size watch** — AUM scores under 40 on that category's curve
- **Thin evidence** — under 80% of the model's weight scored
- **Not rated** — under the 60% floor, listing which blocks are unscored

### 4.7 Two rules that change the output

**Vintage is weighted, not gated.** A short live history counts for less through
the 6% track record block; it does not remove the fund. This is the main
behavioural difference from a gated model — a strong young fund can still rank
well, because that block is small and the fund can win on the other six.

**Manager tenure is a flag, not a reject.** A recent appointment lowers the
manager block and raises a flag. It never removes the fund from the list.

---

## 5. What the dashboard shows

Five views behind a tab bar, plus a fund page reached from any table.

### 5.1 How we look at funds

The six-factor selection process as a **staircase**: three basic requirements
that a fund has to clear before the discussion starts, then three performance
drivers that explain whether the record repeats. The treads climb left to right
through the brand's sequential ramp into red, each with its heading on a dropped
leader above it.

Every step opens a modal carrying what the factor covers, what it means, which
scoring blocks it maps to, and **live figures from the current build** — the
median hit rate, how many funds sit where size starts to work against the
mandate, the median Information Ratio. Those figures are computed per request,
so the page reports the universe as it stands rather than a claim written into
the copy once and left there.

### 5.2 Category top funds

A tile per category, then that category's shortlist as a table: 3M, 6M, 1Y, 3Y
and 5Y returns, median rolling 3Y and 5Y, AUM, and the named managers. The
category's **benchmark travels in the table footer**, on the same columns, so
every row above it can be read against the same line rather than against a
number held somewhere else.

### 5.3 All funds

Every in-scope scheme, filterable by search, category, AMC, band, minimum AUM,
maximum downside capture, holdings and rated-only, sortable on any column. One
click on any column shows the best of it: the sort direction that puts "good"
first is declared per column, so the reader never has to work out which way is
up. Missing values always sink to the bottom whichever way the column points, so
an empty cell never wins a "best downside capture" sort.

In analyst view the table runs to 18 columns and has to scroll sideways, so the
**scheme name is pinned to the left edge** — a row of figures whose name has
scrolled away belongs to nobody.

### 5.4 The fund page

A one-page snapshot, sized to fit one screen. The growth chart is the hero down
the left; six cards sit beside it in two columns:

| Card | Shows |
|---|---|
| Growth of 100 rupees | The fund, its category's index and the category average, rebased to zero on the same day, over a selectable window |
| What it holds | Large / mid / small / cash as shares of the whole fund, plus top-10 weight and largest position |
| What a holding period gave | Median rolling return at 1, 3, 5, 7 and 10 years |
| How it behaves in a fall | Upside and downside capture against the benchmark at 100, plus maximum drawdown |
| Who runs it | The longest-serving manager, tenure, and cycles run |
| Return per unit of risk | Sharpe, Sortino, Information Ratio, Beta |
| Size and cost | AUM, net flow over 1Y, expense ratio |

Each card opens its full detail in a modal — every horizon, the peer comparison,
the decile, the definitions. The page stays readable at a glance and nothing is
buried.

In analyst view an eighth card runs the full width beneath: **the score**, as
seven weighted blocks with coverage on each, plus the flags.

### 5.5 Compare

Up to five funds against up to two benchmarks.

- **The chart.** Every selection rebased to zero on one day, funds in colour,
  benchmarks grey and dashed because they are the backdrop rather than entrants.
  The window is pulled forward to the youngest fund in the selection and says
  so: lines rebased on different days are not a comparison. The legend carries
  each total with its CAGR beneath.
- **The table.** Funds as rows, metrics as columns, in four groups behind
  checkboxes: returns 3M to 7Y, rolling 3Y and 5Y medians, risk metrics, capture
  ratios. The best figure in each column is marked among the funds only — a
  benchmark is the thing being measured against, not a competitor in the race.
- **Stock overlap.** A triangular matrix of the weight each pair holds in
  common: the smaller of the two positions in every stock, summed. It answers
  *how much of this am I buying twice*, which is the question two funds in one
  portfolio actually raises. Above 40% the cell is shaded. Every figure opens
  the stocks behind it, with each fund's weight and the common part.
- **Download CSV.** The whole comparison as a spreadsheet: every metric for
  every selection whatever the checkboxes say, the overlap for each pair, and
  the chart's series at full resolution.

### 5.6 The Client / Analyst toggle

The toggle decides what the page is *for*, not just how much of it shows.

| | Client | Analyst |
|---|---|---|
| Snapshot cards and their modals | yes | yes |
| What it holds, including cash | yes | yes |
| Composite, band, rank, tier | no | yes |
| Block scores, weights, coverage, evidence | no | yes |
| Where the remaining points are | no | yes |
| Engine flags | no | yes |
| Filter by band and rated-only, rank column | no | yes |
| Methodology and band tables | no | yes |

Anything score-bearing is **removed from the DOM** in client view rather than
dimmed, so a screenshot of a client view cannot leak it.

---

## 6. How it represents

The presentation rules are as deliberate as the model, and most of them exist to
stop a chart claiming more than the data supports.

### 6.1 Colour

The palette is the Avendus house set: `#000000`, `#323132`, `#708090`,
`#C3DFF4`, `#CC1919`, `#808083`. Light only — the dark mode was removed as
redundant.

Almost every chart here encodes **magnitude, not identity**, so it wants a
sequential ramp rather than a categorical set. The ramp is built from the
brand's own blue and slate and is monotonic in OKLab lightness. Marks stop one
step short of the darkest value, which is reserved for text: a row of high
scores at full strength renders as one black slab rather than as a chart.

Where identity *is* the encoding — the compare chart, where five funds each need
their own line — a five-colour categorical set is used instead, and a fund keeps
its colour across its chip, its line and its column in the table.

Quality bands run blue → grey → red, a diverging pair using the brand's own
accent rather than an off-brand green, and every use ships with a text label
beside the swatch.

The slide template's own chart sequence is used only where a direct value label
sits on the mark. Tested as a categorical data palette it fails on lightness
band and separation: `#C3DFF4` against `#A6B0BA` is ΔE 13.9, under the 15 floor
for full colour vision.

### 6.2 Tables

Ruled top and bottom in red, zebra body, square corners, numbers in a monospace
face so digits line up in a column.

Two rules learned the hard way:

- **Column width comes from the figures, not the heading.** A column called
  "Median rolling 3Y" is three times the width of the number in it, and every
  value drifts away from the label it belongs to. Labels are cut to what the
  group heading does not already say — under *Rolling returns*, a column called
  "3Y" is not ambiguous — and the full term is kept for the glossary tooltip.
- **Where a table has to scroll, the identity column is pinned.** This applies
  in All funds and in the compare table. It needs an explicit per-row background,
  since an even row's own background is transparent and the columns would
  otherwise slide visibly underneath the name.

### 6.3 Charts

All charts are hand-drawn SVG or DOM in `static/charts.js`: horizontal bars, the
block bar, rebased growth lines with a crosshair, a scatter, a histogram, a range
strip and a funnel. No charting library, no build step, no external runtime
dependency.

Representation decisions that are worth stating:

- **Growth charts are rebased to zero**, not indexed to 100, and the axis is
  labelled in percent. The question is "what did this do over the window", and
  rebasing makes every line answer it on the same terms.
- **A line that cannot reach the start of the window is left out** rather than
  rebased on a later day, and the chart says why. Two lines rebased on different
  days are not a comparison.
- **Beyond a year, returns are annualised** and the chart prints `CAGR:` beneath
  the absolute figure rather than beside it, so the two are not mistaken for each
  other.
- **The category average is a line, not a band.** It is dashed, because it is a
  reference and not a fund you could have bought.
- **Capture is drawn against 100**, the benchmark's own level, with downside in
  the serious tone and upside in the sequential ramp.

### 6.4 Words

Every technical term the dashboard prints has a glossary entry, attached on
hover and on focus. A number nobody can read is not disclosure.

The written rationale per fund — *why we like it* and *what to watch* — is
generated from the fund's own record in `mf/narrative.py`, so it cannot drift
away from the figures beside it. The house style for anything user-facing is no
em dashes, `cr` lowercase, `INR` rather than a rupee glyph, sentence case in
headings.

Where a proxy is used, it is named as one. Three categories have no exact
benchmark in the feed and are read against the closest available series; those
are labelled **index** rather than **benchmark** everywhere they appear, because
Nifty 50 is fifty names against a large cap mandate that runs to a hundred.

---

## 7. Architecture

```
etl/build_dataset.py   Feed + workbook + managers  ->  data/*.json
etl/build_navs.py      mfapi.in + Yahoo            ->  data/navs.json
mf/framework.py        The model as data: blocks, weights, curves, bands, copy
mf/screener.py         The engine: scales, portfolio metrics, blocks, composite, tiers
mf/narrative.py        Why we like it / What to watch, from the fund's own record
mf/datastore.py        Loads and scores once; category books, overlap, growth, compare
mf/api.py              Flask blueprint under /api/mf
server.py              App factory, static files, /health
static/                The dashboard: one HTML file, one CSS file, two scripts
```

### 7.1 The runtime model

`data/*.json` is committed, so the app needs no live API call at boot. The whole
universe is loaded and scored **once per process**, into a module-level state
that every request reads. Under gunicorn the app runs with `--preload`, so the
scoring happens before the fork and both workers share it copy-on-write.

This is why the morning refresh is a *commit* rather than a call: the data
changes when the files change, and the files change when the workflow pushes.

### 7.2 The framework is data, not code

`mf/framework.py` holds the blocks, weights, metrics, curves, bands, glossary and
methodology copy as plain Python data, and `/api/mf/framework` serves the whole
object. The methodology page in the dashboard is **generated from the same object
the engine scores with**, so the two cannot drift apart. There is no second copy
of the weights anywhere.

### 7.3 The API

| Route | Returns |
|---|---|
| `GET /api/mf/meta` | Universe summary: counts, bands, AMCs, build stamp |
| `GET /api/mf/framework` | The whole model as data |
| `GET /api/mf/process` | Live figures behind each of the six selection factors |
| `GET /api/mf/funds` | All Funds, with filtering and sorting |
| `GET /api/mf/fund/<key>` | Everything the detail page needs for one fund |
| `GET /api/mf/nav/<key>` | Fund, index and category average, rebased |
| `GET /api/mf/category/<name>` | Category dossier |
| `GET /api/mf/shortlists` | Every category's shortlist, with its benchmark |
| `GET /api/mf/holdings/<key>` | The disclosed book and its statistics |
| `GET /api/mf/overlap` | Pairwise overlap across an arbitrary set |
| `POST /api/mf/portfolio` | Look-through for a weighted portfolio |
| `GET /api/mf/compare` | The comparison table |
| `GET /api/mf/compare/growth` | Every selection on one rebased chart |
| `GET /api/mf/compare/overlap` | The overlap matrix for the selection |
| `GET /api/mf/overlap/pair` | The stocks behind one matrix cell |
| `GET /api/mf/compare/blocks` | Side by side on the model's own blocks |
| `GET /api/mf/compare.csv` | The whole comparison as a spreadsheet |
| `GET /health` | Health check, used by the deploy platform |

The front end is three files and no framework: `index.html`, `styles.css`,
`app.js` and `charts.js`. State lives in one object; views render into one
`<main>`; there is no router, no virtual DOM and nothing to install.

---

## 8. Operations

### 8.1 The morning refresh

`.github/workflows/refresh-data.yml`, at `30 23 * * *` UTC — 05:00 IST. AMFI
publishes the day's NAV late in the evening IST, so a five o'clock run reads a
settled file rather than racing the upload.

1. Refresh the quantitative feed (`build_dataset.py`, no `--workbook`, so
   everything the workbook contributes is carried forward from the last build)
2. Rebuild the NAV history (`build_navs.py --refresh`)
3. Commit `data/` if anything changed

Two guards: the dataset build **refuses to write** if its own validation fails —
join rate, field coverage and universe size are all checked against the previous
build, because a name-based join degrades silently and a renamed scheme would
otherwise just lose its holdings without anything failing. And the NAV build
aborts if fewer than 80% of in-scope funds return a series.

GitHub only runs a schedule from the repository's default branch. On any other
branch the workflow exists but never fires on its own.

### 8.2 A full rebuild

```bash
python etl/build_dataset.py \
    --workbook <Underlying.xlsx> \
    --managers <fundmgr_master.xlsx> \
    --snapshot --diff
```

Every argument is independent: whichever sources are supplied get refreshed and
the rest are left as they are on disk.

`--snapshot` archives the build to `data/history/<date>/`. Point-in-time
snapshots cannot be reconstructed later, so every refresh that does not archive
is a period of evidence permanently lost — and without the archive there is no
way to ever ask whether the ranking predicted anything. `--diff` reports funds
added and dropped, band changes, and composite moves of five points or more.

### 8.3 Running and deploying

```bash
pip install -r requirements.txt
python server.py            # http://127.0.0.1:3001
```

`render.yaml` and `Procfile` are committed. On Render: New → Blueprint, point at
the repo, free plan is enough, `/health` is the health check path. The served
runtime is Flask and gunicorn only; yfinance and the pandas stack under it are
ETL dependencies, not served ones.

---

## 9. The rules this thing is built on

If everything above were lost, these are the decisions worth keeping.

1. **Compare a fund only with its true peers.** Percentile within category,
   always. Never an absolute scale.
2. **Report a gap, never fill it.** Reweight over what is present and publish the
   coverage. An imputed median is a claim the data did not make.
3. **Refuse to rate below the evidence floor.** A composite built on a third of
   the model is not a composite.
4. **A rolling median beats a point-to-point number.** One start date and one end
   date is an anecdote.
5. **Weight, do not gate.** Short history and new managers change the score, not
   the universe.
6. **Name the proxy.** A stand-in that is not labelled as one is worse than no
   comparison at all.
7. **Say what the basis is.** Price index or total return, month end or day end,
   published figure or computed one.
8. **A small gap is not a difference.** Three points on the composite is noise,
   and the tiers say so.
9. **The model is data, and the page is generated from it.** Two copies of a
   weight is one copy too many.
10. **Judgement sits above the number.** The score orders a shortlist and frames
    the discussion. It does not select.
