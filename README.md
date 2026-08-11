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
| Return and consistency | 27% | Median rolling return 3Y and 5Y, plus the share of rolling 3Y windows that actually beat the benchmark. |
| Risk adjusted | 24% | Sharpe, Sortino and Information Ratio, 3Y and 5Y. IR carries the most weight inside the block. |
| Capture and drawdown | 18% | Upside capture, downside capture, maximum drawdown. |
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
produces a number that looks exactly like a real one. 177 of 559 schemes are Not
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
| How we look at funds | The methodology, generated from the same object the engine scores with, so it cannot drift from the code. |
| Category top funds | The shortlist per category, each with its written rationale. |
| All funds | Every scheme, filterable, with a full detail card per fund. |
| Portfolio | Look-through of a weighted set: combined book, sector exposure, pairwise overlap. |

The **Client / Analyst toggle** is a presentation switch. In client view the
composite and block scores are removed from the DOM, not dimmed, so a screenshot
cannot leak them. The data and the rationale stay visible in both.

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
