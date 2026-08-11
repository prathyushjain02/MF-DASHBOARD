# Mutual Fund Screener

An active equity fund screener built to `MF_Screener_Instructions.md`. One model
with two jobs: rank the funds in each category and surface the shortlist, then
present that shortlist the way a client should see it, with a written rationale
and the number kept behind an analyst toggle.

567 actively managed equity schemes, scored on seven weighted blocks, every metric
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
| Return and consistency | 27% | Median rolling return 3Y and 5Y. The distribution is read, not a point to point number. |
| Risk adjusted | 24% | Sharpe, Sortino and Information Ratio, 3Y and 5Y. IR carries the most weight inside the block. |
| Capture and drawdown | 18% | Upside capture, downside capture, maximum drawdown. |
| Portfolio | 12% | Effective number of stocks, cap mix fit to mandate, differentiation vs the category book. |
| Manager | 8% | Tenure on this scheme and market cycles run. |
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
| `percentile` | returns, ratios, capture, vintage, manager | Comparative by nature. Ranked inside the fund's own category, ties share a mid rank. |
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
weight that was evidenced. The median fund evidences 92%.

**2. Below 55% evidence a fund carries no composite at all.** It is reported as
*Not rated*, keeps its block scores and all its data, and is excluded from ranking.
Without this floor a fund with no return history at all tops its category on
portfolio shape and size alone, because renormalising over two minor blocks
produces a number that looks exactly like a real one. 189 of 567 schemes are Not
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

## Refreshing the data

```bash
pip install -r etl/requirements.txt
python etl/build_dataset.py --workbook <Avendus_Automation.xlsx> --snapshot --diff
git commit -am "Refresh dataset"
```

Arguments are independent: omit `--workbook` to refresh only the feed and leave the
holdings as they are.

Three things the refresh does that are worth knowing:

- **Column matching is by synonym, not exact string**, so a header renamed upstream
  does not silently drop a metric. Anything unmatched is printed at the end of the
  run under *unmapped columns*, which is the one place a quiet data loss would hide.
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

## Known gaps

| Gap | Effect |
|---|---|
| Manager tenure and cycles are not in the feed | The 8% manager block is unscored for every fund and reported as such. It is an analyst input; supply it and the block scores itself. |
| No holdings file from a year earlier | Name retention is wired but carries **zero weight**, so it cannot silently move a score. |
| No benchmark constituent weights | Differentiation is proxied by overlap against the category book. Benchmark holdings would upgrade it to true active share. |
| Rolling 5Y, and the 5Y ratios | Absent from the current feed, so those blocks score on their 3Y metrics and report ~55% coverage. |
| Vintage is bucketed | The feed carries no inception date, so live record is read off the longest return series: 5Y, 3Y, 2Y or 1Y. |

## The quantitative feed

```
https://api.sheety.co/26381234f19b00348c9bb3d7604a8d84/dataPack/sheet1
```

**This endpoint is not currently serving.** It has returned, in order, a 500
(`Cannot read property '0' of undefined`, meaning the sheet exists but Sheety cannot
parse its header row) and then a 404 (`No project found matching that name`). The
committed dataset is the previous good pull, remapped onto the new category labels,
so the app runs and every number on screen is real. The ETL points at the new
endpoint and will pick it up the moment it serves; it fails with a diagnosis rather
than a traceback until then.
