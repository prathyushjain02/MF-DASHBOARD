# Mutual Fund Screener

An active equity fund screener built to `MF_Screener_Instructions.md`. One model
with two jobs: rank the funds in each category and surface the shortlist, then
present that shortlist the way a client should see it, with a written rationale
and the number kept behind an analyst toggle.

559 actively managed equity schemes, scored on seven weighted blocks, every metric
percentiled inside its own category.

## Running it

The app is self-contained: `data/*.json` is committed, so it needs no live API call
at boot. Clone and run.

```bash
git clone -b claude/mutual-fund-dashboard-f4ew40 \
    https://github.com/prathyushjain02/nse-backend.git
cd nse-backend
pip install -r requirements.txt
python -m flask --app server run --port 5000     # http://127.0.0.1:5000
```

Deploying: `render.yaml` and `Procfile` are included. On Render, New -> Blueprint,
point at the repo, free plan is enough. `/health` is the health check path.

## The model

| Block | Weight | What it uses |
|---|---|---|
| Return and consistency | 27% | Every median rolling return the feed carries, 1 through 10 years, plus the share of rolling 3Y windows that actually beat the benchmark. Longer windows weigh more. |
| Risk adjusted | 24% | Sharpe, Sortino and Information Ratio at 3Y, 5Y, 7Y and 10Y. IR carries the most weight inside the block. |
| Capture and drawdown | 18% | Upside capture, downside capture and maximum drawdown at 3Y, 5Y, 7Y and 10Y. Downside weighs more than upside. |
| Portfolio | 12% | Effective number of stocks, cap mix fit to mandate, differentiation vs the category book. |
| Manager | 8% | Tenure on this scheme and market cycles run. From the fund manager master. |
| Track record length | 6% | Longer live history scores higher. A weight, not a gate. |
| AUM, category adjusted | 5% | Size read against the mandate, on a different curve per category. |

Standard deviation, semi standard deviation and Treynor are shown but not scored:
they move almost in lockstep with Sortino and downside capture, so scoring them
would weight volatility several times over. Point to point and CAGR are shown for
context; the return block scores the rolling median.

**Vintage is weighted, not gated.** A short live history counts for less through
the 6% block, it does not remove the fund. Short manager tenure is a flag, never a
reject. This is the main behavioural difference from a gated model: WhiteOak Flexi
Cap tops Flexicap here on merit, where a 5-year vintage gate would have discarded it.

**AUM is scored by category.** Six distinct curves. Smallcap rewards nimble AUM and
marks down size as a capacity risk; Midcap, Focused, Sectoral and Dividend Yield
prefer a middle band; Largecap, Flexicap, Multicap, Large & Midcap, Value and ELSS
reward scale with a floor for viability.

## House style

Colour and type follow the Avendus landscape template: primaries `#000000`
`#323132` `#708090` `#C3DFF4` `#CC1919` `#808083`, Univia Pro for titles and
Franklin Gothic for body, tables ruled top and bottom in red with a zebra body
and square corners. Numbers follow the template's formatting guidelines: `cr`
lowercase, `INR` rather than a rupee glyph, sentence case in headings.

Two notes on taking a slide template into charts:

- The template's **Chart Colour Sequence** (`#A6A6A6 #F8D0D1 #A6B0BA #C3DFF4
  #F9A1A3 #EBEAEB`) is a set of pastel fills for bar segments that carry their
  own value labels. Tested as a categorical data palette it fails on lightness
  band, chroma floor and normal-vision separation — `#C3DFF4` against `#A6B0BA`
  is ΔE 13.9, below the 15 floor for full colour vision. It is used only where a
  direct label sits on the mark.
- Almost every chart here encodes **magnitude, not identity**, so it wants a
  sequential ramp. That ramp is built from the brand's own blue and slate and is
  monotonic in OKLab lightness (0.956 → 0.315). Marks stop one step short of the
  darkest value, which is reserved for text: a row of high scores at full
  strength renders as one black slab rather than as a chart.

Quality bands run blue → grey → red, a diverging pair using the brand's own
accent rather than an off-brand green, and every use ships with a text label
beside the swatch. Univia Pro and Franklin Gothic are licensed fonts, so the CSS
names them first and falls back to the nearest system stacks where they are not
installed.

**Every technical term carries its meaning on hover.** The glossary lives in
`mf/framework.py` and the dashboard attaches it to any label that matches, walking
from the specific form ("Sortino 5Y") down to the bare term. A number nobody can
read is not disclosure.

### Scales

Not every metric is a percentile, and the ones that are not say so:

| Scale | Used for | Why |
|---|---|---|
| `percentile` | returns, hit rate, ratios, capture, vintage, manager | Comparative by nature. Ranked inside the fund's own category, ties share a mid rank. |
| `curve` | AUM | "Good" is not simply "more", and the shape differs by mandate. |
| `band` | effective number of stocks | Both over-diversification and over-concentration are departures from the mandate. |
| `absolute` | mandate fit | Full compliance means 100 and nothing else does. |

### Bands

A 72 and above, B 58, C 42, Review below that. Bands are wide on purpose. A
composite difference below **3 points is not a real difference**, so funds inside
that distance of their tier leader are shown as equally ranked. The model orders a
shortlist; it does not select.

## Two honesty rules that change the output

**1. Missing data is never filled with a neutral middle value.** A block reweights
over the metrics it actually has, and every fund reports the share of the model's
weight that was evidenced. The median fund now evidences 100%: every block scores.

**2. Below 55% evidence a fund carries no composite at all.** It is reported as
*Not rated*, keeps its block scores and all its data, and is excluded from ranking.
Without this floor a fund with no return history at all tops its category on
portfolio shape and size alone, because renormalising over two minor blocks
produces a number that looks exactly like a real one. 61 of 559 schemes are Not
rated on the current feed, almost all of them for having no quantitative history.

## Where a category is not a peer group

Everything is scored against category peers, which only means something when the
peers do the same job. **Sectoral / Thematic is a SEBI label, not a peer group**: a
Taiwan equity fund, a pharma fund and a defence fund share a bucket and nothing
else. Those funds are still scored, because execution within a theme is a fair
question, but the caveat travels with the number everywhere it appears, and
differentiation is left unscored there because two funds on different themes
trivially have no overlap.

## The pages

| Page | What it is |
|---|---|
| How we look at funds | The selection process as a single click-driven page: the six-factor diamond from the deck, and the three-tier screen across equity, debt and international. Every figure is read off the live universe. |
| Category top funds | A tile per category. Click one to open its shortlist below, click a fund to open its full card in place. |
| All funds | Every scheme. Filter by search, category, AMC, band, minimum AUM, maximum downside capture, holdings and rated-only; sort on any column. |
| Portfolio | Look-through of a weighted set: combined book, sector exposure, pairwise overlap. |

The **Client / Analyst toggle** decides what the page is for, not just how much of
it shows.

| | Client | Analyst |
|---|---|---|
| Why we like it, What to watch | yes | yes |
| Who runs it | yes | yes |
| The numbers, grouped by block | yes | yes, plus each metric's category percentile |
| Filter by band, rated-only, and the rank column | no | yes |
| What it holds, with cash | yes | yes |
| Composite, band, rank, tier | no | yes |
| Block scores, weights, coverage, evidence | no | yes |
| Where the remaining points are | no | yes |
| Engine flags: New Manager, Mandate shortfall, Capacity watch | no | yes |
| Peer-group caveat, methodology and band tables | no | yes |

Anything score-bearing is removed from the DOM in client view rather than dimmed,
so a screenshot of client view cannot leak it.

## Architecture

```
etl/build_dataset.py   Merges the feed and the workbook into data/*.json. Run offline.
mf/framework.py        The model as data: blocks, weights, curves, bands, copy.
mf/screener.py         The engine: scales, portfolio metrics, blocks, composite, tiers.
mf/narrative.py        Why we like it / What to watch, from the fund's own record.
mf/datastore.py        Loads and scores once; category books, overlap, look-through.
mf/api.py              Flask blueprint under /api/mf.
static/                The dashboard. No build step, no external dependencies.
```

## Known gaps

| Gap | Effect |
|---|---|
| No holdings file from a year earlier | Name retention is wired but carries **zero weight**, so it cannot silently move a score. |
| No benchmark constituent weights | Differentiation is proxied by overlap against the category book. Benchmark holdings would upgrade it to true active share. |
| Expense ratio is thin | The feed does not carry TER and the workbook fills it for about a fifth of the universe. It is a context field, not a scored one, so this does not move any score. |
| 67 in-scope schemes have no manager record | Their manager block is unscored and reported as such rather than guessed. |
| The monthly series starts June 2018 | Rolling windows and cycles cannot see further back than that. Fund age is recovered separately (below), but the rolling medians are 2018-onward. |

## Where the numbers come from

Three sources, joined on a normalised scheme key.

**1. The quantitative feed.**

```
https://api.sheety.co/26381234f19b00348c9bb3d7604a8d84/allFundsQuantData/allFunds
```

The sheet has a **two row header**. Sheety turns row 1 into the JSON key and hands
row 2 back as the first data row, which is where the horizon lives. The ETL reads
that horizon rather than assuming it, and this is not cosmetic: this feed publishes
a **1Y** median rolling return where the previous one published 3Y. Hardcoding the
suffix would have relabelled a one year number as a three year one and scored it as
such. All 21 columns currently map, 0 unmapped.

**2. The Underlying workbook** supplies AUM, NAV, point to point returns, AMC, cap
split, expense ratio, 33,345 security level holdings across 555 funds, and two
sheets that do more than fill gaps:

- **Mom Performance** — 97 months of returns per scheme, June 2018 to June 2026.
  This makes the rolling figures *computed* rather than proxied: 62 rolling three
  year windows and 38 five year ones per fund, plus the **rolling hit rate**, the
  share of three year windows that actually beat the benchmark. A fund can carry a
  high median while losing most windows, and this separates the two. Verified
  against the workbook's own published CAGR: Parag Parikh Flexi Cap computes to
  14.64 (3Y) and 14.66 (5Y) against a published 14.62 and 14.65.
- **BMMom Performance** — the same for 13 benchmarks. Used for the hit rate, the 5Y
  ratios, and to **derive the market cycles** the manager block counts against. A
  cycle is a peak to trough fall of at least 12% in the Nifty 500 TRI. Three fall
  inside the window: 2018-08 to 2018-10 (−12.3%), 2019-12 to 2020-03 (−28.9%), and
  2024-09 to 2025-02 (−17.7%). Deriving them from the index's own series means the
  dates come from the data rather than from a remembered list of corrections.

**3. The fund manager master** supplies tenure and industry experience per manager
per scheme. Tenure is taken from the **longest serving** manager, because the block
asks how long this money has been run by the people running it now, not how
recently somebody joined. It sets the manager block on 492 funds.

It also fixes a problem it was not collected for. Fund age was being read off the
length of the return series, which pinned **242 of 504 funds at the same 8.1 year
ceiling** and stopped the track record block discriminating for half the universe.
A manager cannot have run a fund before the fund existed, so a dated appointment
older than the return window is a hard lower bound on the fund's age. That lifts
vintage on 255 funds and spreads the distribution from 0 to 22 years. Parag Parikh
Flexi Cap now reads 13.2 years, from Rajeev Thakkar's appointment on 2013-05-24,
which is the fund's actual launch.

## Refreshing the data

```bash
pip install -r etl/requirements.txt
python etl/build_dataset.py \
    --workbook <Underlying.xlsx> \
    --managers <fundmgr_master.xlsx> \
    --snapshot --diff
git commit -am "Refresh dataset"
```

Every argument is independent: omit `--workbook` to refresh only the feed and leave
the holdings as they are.

Three things the refresh does that are worth knowing:

- **Unmapped columns are printed.** Anything the header map does not recognise is
  listed at the end of the run, which is the one place a quiet data loss would hide.
- **`--snapshot` archives the build** to `data/history/<date>/`. Point in time
  snapshots cannot be reconstructed later. Every refresh that does not archive is a
  period of evidence permanently lost, and without the archive there is no way to
  ever ask whether the ranking predicted anything.
- **Validation can refuse the write.** Name-based joins degrade silently: a scheme
  gets renamed, its key stops matching, and it simply loses its holdings and its AUM
  without anything failing. The build checks join rate, field coverage and universe
  size against the previous build and aborts rather than writing a broken dataset.
  `--force` overrides.

`--diff` reports what changed against the last snapshot: funds added and dropped,
band changes, and composite moves of 5 points or more.
