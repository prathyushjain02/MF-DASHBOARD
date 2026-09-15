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
   Passive, thematic, ELSS and fund of funds schemes are carried in full and
   deliberately not scored: an index fund is not trying to beat its index, so
   ranking it on alpha would answer a question nobody asked of it.
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
| Rows in the feed | 1,231 |
| Mutual funds in the universe | 1,177 |
| Inside the model, actively managed equity | 280 |
| Carrying a composite score | 225 |
| Shown but not scored | 897 |
| Categories | 9 scored, 4 shown |
| Bands | A 32 · B 62 · C 95 · Review 36 · Not rated 55 · Not scored 897 |
| Daily NAV series held | the scored universe, 4 indices, 8 category averages |

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
| The feed's category column is unreliable | Peer groups would be wrong | Category is read from the scheme name; every disagreement is reported by the build |
| No NAV history for the 897 unscored schemes | No growth chart on their pages | Deliberate: carrying daily NAV for every ETF as well would quadruple a file committed and redeployed each morning, for a chart of a line that is by construction its index |
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
https://api.sheety.co/.../fundQuantDataAll/flexiCap
```

A Google Sheet published as JSON, edited by hand every few weeks. 1,231 rows and
105 columns covering every scheme the sheet tracks, active and passive: median
rolling returns at 1 through 10 years, Sharpe, Sortino, Information Ratio and
Treynor at each horizon, upside and downside capture, maximum drawdown, standard
deviation, beta, the calendar year series, AUM and its date, net flow, the cap
allocation, the AMFI code and the inception date.

Columns are matched **by synonym, not by exact string**, and anything unmatched
is printed at the end of the run under "unmapped columns". That is the one place
a quiet data loss would otherwise hide. The parser reads the horizon out of the
column rather than assuming it — `sharpe [3Y]` and `3MP2P` both resolve without
a list of names — which is why a feed with an entirely different shape from its
predecessor mapped 103 of its 105 columns on the first run.

**The category column is not used.** Its "Flexi Cap Fund" bucket holds 190 rows,
of which 80 are thematic funds, 21 are index funds and ETFs, and the remainder
includes every Quant and Quantum scheme whatever its actual category: Quant
Small Cap, Quant Value, Quant Focused and Quant Large Cap are all filed as flexi
cap. Every score in this model is a percentile inside a category, so one misfiled
row does not merely mislabel itself, it moves the score of every fund measured
against it. The category is read from the scheme's own name instead, which is
regulated: SEBI requires the category to be in it. See `mf/classify.py`.

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

A tile per category, then that category's shortlist as a table: the six return
horizons (6.2), 3Y
and 5Y returns, median rolling 3Y and 5Y, AUM, and the named managers. The
category's **benchmark travels in the table footer**, on the same columns, so
every row above it can be read against the same line rather than against a
number held somewhere else.

Funds can be **ticked** in this table and carried to Compare. See 5.7.

**Calendar year look through** is the second way to read a category, behind a
button beside the shortlist. Its leading fifteen funds against every calendar
year they have, as a heat map, with no heading and no preamble over it: the
selected tile says which category this is, and the table explains itself. A composite says how a fund has done; a row of
calendar years says *when*, and the two are different questions — a fund can
carry a strong record because it was extraordinary in one year and ordinary in
nine, and only the row shows it. Year to date leads and the years run
backwards from it, because the question a reader brings to a row of years is
what has been happening lately. Every year is coloured on its own range, worst
figure red through that year's middle in yellow to its best in green, because
2020 and 2022 were not the same market and a shared scale would colour the years
rather than the funds. The three stops sit on the column's own worst, median and
best rather than on zero: in a year the whole category fell, the fund that fell
least is still the one to find, and anchoring on zero would paint the column red
and hide it. The category's benchmark sits on the foot of
the table on the same columns, uncoloured, so a year can be read against the
market it happened in rather than only against the other funds in the column:
shading it would rank it among them, which is the one thing it is not doing. The
years stop at 2015, before which the feed thins out into a handful of survivors
and the row reads as a record of who was around rather than of who did well.

**Beat count** sits beside the name: completed calendar years the fund finished
ahead of its benchmark, out of the years both were alive for, to a maximum of
ten. The denominator is the fund's own years and never a flat ten, because a
fund with four years on the board that won three of them has done something,
and printing that as 3 out of 10 would report the years before it launched as
years it lost. The year in progress is left out on the same principle: it has
not finished happening. It reads green at six in ten or better and red below
four, and it sorts on the rate rather than the count, because four out of four
is a better record than five out of ten; ties go to the longer record, which is
the same rate on more evidence. A row of years says what happened in each; this
says how the decade went, and the two are meant to be read together rather than
by counting green cells.

Any year sorts the table, and a fund with no
figure for it sinks to the bottom whichever way the column points: a blank is a
fund that had not launched, not a fund that came last.

Dividend Yield is scored and ranked like any other category, and a fund in it
carries its composite, but it gets no tile: twelve schemes chasing a yield is a
corner of the market rather than a shelf anyone is choosing from. Smart beta and
passive gets no calendar view either — the calendar years of an index fund are
the calendar years of its index.

Categories are offered in one order everywhere they are listed, and it is not
the order the model holds them in. It runs down the size ladder first, because
that is the question somebody arrives with: **large, flexi, mid, small**. The
mandates that are a shape rather than a size follow, and the categories the
model does not score come last.

### 5.3 All funds

Every in-scope scheme, filterable by search, category, AMC, band, minimum AUM,
maximum downside capture, holdings and rated-only, sortable on any column. One
click on any column shows the best of it: the sort direction that puts "good"
first is declared per column, so the reader never has to work out which way is
up. Missing values always sink to the bottom whichever way the column points, so
an empty cell never wins a "best downside capture" sort.

With the analyst view on (5.9) the table runs to 18 columns and has to scroll sideways, so the
**scheme name is pinned to the left edge** — a row of figures whose name has
scrolled away belongs to nobody.

### 5.4 The fund page

A one-page snapshot in three columns, sized to fit one screen. Each column is a
stack of its own rather than a row of a grid, so a short card ends where its
content ends instead of being held to the height of its neighbours.

What goes in which column follows the question being asked.

**Left — the record.**

| Card | Shows |
|---|---|
| Growth of 100 rupees | The fund, its category's index and the category average, rebased to zero on the same day, over a selectable window |
| How it has done | The six return horizons (6.2) across the top; fund, index and alpha down the side. Point to point across all six, median rolling at 3Y and 5Y only. The alpha row is set heavier than the two it is drawn from, green where the fund is ahead and red where it is behind |
| Shape of the equity book | Top 5 weight, top 10 weight, largest position, names held |
| Cap mix | Large / mid / small / cash as a ring with its key beside it, and the equity share through the hole |

**Middle — the fund as an object.**

| Card | Shows |
|---|---|
| Size and cost | AUM, net flow over 1Y, expense ratio |
| Largest sectors | The eight largest, as shares of the equity book |
| Top holdings | The fifteen largest positions and their weights |

**Right — risk, and who is taking it.**

| Card | Shows |
|---|---|
| Return per unit of risk | Sharpe, Sortino, Information Ratio, Beta |
| Drawdown periods | Time below the high water mark as an underwater chart, and the worst three falls: when each began, how deep it went, how long until it was over |
| How it behaves in a fall | Upside and downside capture against the benchmark at 100, plus maximum drawdown |
| Who runs it | The three longest-serving managers with their tenure, how many more there are, the scheme's inception, market cycles run, and how much of the fund's own life the longest-serving manager has been on it |

Each card opens its full detail in a modal — every horizon, the peer comparison,
the decile, the definitions. The page stays readable at a glance and nothing is
buried.

Three of these deserve a note.

**How it has done** runs periods across and measures down, because the question
a reader brings is "how did it do over three years" and that question is one
column of six figures here rather than a row picked out of two halves. Point to
point and median rolling are stacked on the same columns rather than being
chosen between: they are different questions about the same fund, one asking
what a pair of dates paid and the other what a typical window of that length
paid, and a fund can look strong on one and ordinary on the other. Beyond a year
both are annualised, so a 3Y column is a rate and not a total. The alpha row is
printed rather than left to be worked out in the reader's head.

**Who runs it** is the desk rather than one name. A single bold name over "7
managers" says almost nothing: on a team that size the question is how much of it
has been there a while, and whether the people running the money now are the ones
who earned its record. So the three longest-serving are listed with their tenure,
and **same hands for N% of its life** reads the longest tenure against the
scheme's inception date rather than against `vintageYears`, which is itself
derived from manager tenure and would be answering its own question. A ten year
record run by somebody who arrived last year is a record of somebody else's work,
and a tenure figure alone does not say which it is.

**Drawdown periods** exists because a maximum drawdown is one number for a whole
record and says nothing about how long the hole lasted, which is the part an
investor actually sits through. A fall counts as an episode when it passes 8%
below a high water mark; the worst three are reported with the date the fall
started, its depth, and how long the whole round trip took, or `still down`
where the fund has not got back yet. The three are marked on the underwater
chart, so the picture and the table are naming the same three things rather
than five hand-written era labels the data does not itself assert.

Both drawdown figures on the page **name their window**, because they are two
answers to what looks like one question: this card reads the fund's whole NAV
record, and the maximum drawdown under *how it behaves in a fall* is the feed's
three year figure. Without the labels the underwater chart's floor and the
capture card's footer read as a contradiction.

The card face stops there on purpose. What the index did over the same stretch,
the split between months down and months back, and the best run on the other
side are all in the modal: on a card a third of a screen wide they made five
columns of small figures out of a question that has a three column answer. The
index figure there is deliberately not the index's own worst fall over the
window, because the question is what the market was doing while this fund was
falling.

With the analyst view on (5.9) a further card runs the full width beneath: **the score**, as
seven weighted blocks with coverage on each, plus the flags.

### 5.5 Compare

Any number of funds against up to two benchmarks. There is no ceiling on the
funds: past a handful the chart is a thicket, but that is a judgement for
whoever is reading it, and a portfolio of twelve is a real thing.

Compare asks how these funds differ. Holding them together is a different
question and it has its own tab (5.6), because carrying both on one screen meant
every reader of the first had to look past the machinery of the second.

- **The chart.** Every selection rebased to zero on one day, funds in colour,
  benchmarks grey and dashed because they are the backdrop rather than entrants.
  The window is pulled forward to the youngest fund in the selection and says
  so: lines rebased on different days are not a comparison. The legend carries
  the annualised rate with the window's total beneath it, and a small table
  under it gives the gap to the benchmark (see 6.4).
- **The table.** Funds as rows, metrics as columns, in four groups behind
  checkboxes: the six return horizons (6.2), rolling 3Y and 5Y medians, risk metrics, capture
  ratios. The best figure in each column is marked among the funds only — a
  benchmark is the thing being measured against, not a competitor in the race.
- **Stock overlap.** A triangular matrix of the weight each pair holds in
  common: the smaller of the two positions in every stock, summed. It answers
  *how much of this am I buying twice*, which is the question two funds in one
  portfolio actually raises. Above 40% the cell is shaded. Every figure opens
  the stocks behind it, with each fund's weight and the common part.
- **Download CSV** and **PDF.** See 5.8.

### 5.6 Portfolio builder

Its own tab. It runs on the same machinery as compare and keeps a **separate
selection**, because picking three funds to read side by side and picking three
to hold are different acts and one should not overwrite the other. The tick bar
offers both destinations.

Weights are entered in **rupees or percent** — the same question once the total
is divided out, so the form takes either, shows each line's share as it is typed,
and nothing has to add to a round sum. *Split evenly* is there for the common
case. **Every holding needs a figure** before the form will build: a line left
blank is not a zero weight holding, it is one somebody has not decided about
yet, and building around it would quietly drop it.

The form is asked for **at the moment a holding arrives**, not left for later:

- Ticking funds in a list and pressing **Build portfolio** opens the weights over
  the list and switches to the builder once they are set. The allocation is the
  thing being decided and the page behind it is only the result, so it comes
  first. Scheme names are fetched before the form opens rather than after, so
  the lines are labelled with funds and not with keys. Dismissing it leaves the
  reader where they were with the tick selection untouched and nothing built.
- Adding a fund by **search inside the builder** opens the same form with the
  existing weights kept and the new line blank and focused. A holding with no
  share is not a holding.

Weights can be changed at any time from *Edit weights*. If a reader dismisses the
form the tab still draws, on an equal split that says so: it is a real allocation
and a common one, and an even split nobody looked at is a default rather than a
decision, so it does not come back into the form as if they had typed it.

The top band is the line on the left and four tiles beside it — what a portfolio
holds is not what its funds hold listed four times.

- **One line.** The portfolio is drawn bold and black, its holdings hidden
  behind a *show holdings* switch that brings them back thin and pale. Any
  benchmark stays available. The line is **bought once at the start of the
  window and held**, so the weights drift: no rebalancing is assumed, because
  assuming one would quietly add a return the investor never earned.
- **What it comes to.** **Effective holdings**, the inverse Herfindahl of the
  combined book, beside the distinct name count, the top-10 weight and the
  largest single position. Four funds of sixty names each are not 240 positions,
  because they own many of the same ones, and the plain count will not say so.
- **Cap mix**, as a ring, read off **the underlying stocks and not the funds'
  categories**. A flexi cap fund holding small caps is holding small caps
  whatever the label on it says, and a portfolio built out of three mandates can
  be a different shape from any of them. What the feed does not band — overseas
  names, mostly — is shown as unclassified rather than dropped, so the ring is
  the whole book.
- **Largest sectors**, five of them, as shares of the combined book.
- **Top holdings.** The five largest positions in the combination. The same
  stock bought by three of the funds is one position at the sum of its three
  weights, and only the combined book says how big that position actually is.

Both lists stop at five so the two lower tiles are the same height: the four are
a block beside the chart, and the block only reads as one thing while its halves
line up. The full lists are in the CSV.

Below the band, the same metric table and overlap matrix as compare, with two
differences:

- **A row of its own.** The portfolio leads the metric table, with its returns
  and rolling medians read off its own series rather than averaged from the
  holdings — averaging point-to-point returns of things bought on different days
  is not a portfolio return. Risk and capture stay blank for the same reason a
  price index's do: they need a benchmark to be measured against.
- **Overlap reads as duplication** rather than as resemblance: on this tab the
  question is not how alike two funds are but how much of the money is in the
  same stock twice.

### 5.7 Ticking funds anywhere

Every row in **Category top funds** and **All funds** carries a tick box. A bar
appears at the foot of the page as soon as anything is ticked — *N funds
selected · Compare · Build portfolio · Clear* — and the selection survives moving
between the two tabs, so a comparison can be built out of two different lists
without writing any names down. Two destinations, because the same tick answers
two questions: read these side by side, or hold them together. The order things were ticked in is kept, because it decides the
colour each one takes on the chart.

### 5.8 Taking it away

- **CSV.** The whole comparison as a spreadsheet: every metric for every
  selection whatever the checkboxes say, the overlap for each pair, and the
  chart's series at full resolution. With a portfolio on, it also carries the
  portfolio's own row, each holding's weight, the effective holdings, the
  combined book's largest 25 names and the sector exposure.
- **PDF.** A print stylesheet lays the page out to **one A4 landscape sheet** —
  chart, metric table, look-through and overlap — and strips everything that is
  a control rather than a finding. The button opens the print dialog, where
  *Save as PDF* produces the file. The PDF is the page itself rather than a
  second rendering of it that could drift.

### 5.9 The bar

Everything above the page sits on one line: the wordmark, a vertical rule, the
five tabs, and the plan switch at the right. The name stacks — **THE** small,
grey and set back over **Filter** in the house red — so it fits the height of the
bar rather than sitting above it, which is what lets the tabs come up beside it
instead of costing a second row. Below 760px the bar wraps into two: the name and
the switch above, the tabs underneath.

Nothing else is up there. The universe count that used to sit at the right was a
fact about the build rather than about anything the reader had asked for, and it
was the first thing their eye met on every page.

No page repeats its own tab as a heading, and none of them explains itself in a
line underneath. The tab says which page this is; a heading saying it again and
a sentence saying a list can be clicked are both telling the reader what is
already in front of them.

#### Direct or regular

The bar carries one toggle: **Direct** or **Regular**. It is a real
distinction and not a presentation one. The two plans of a scheme are different
products with different expense ratios and therefore different returns, and the
feed currently carries the direct plan. **Regular is present and disabled** until
the other plan's figures arrive: a toggle that silently showed the same numbers
under both labels would be worse than no toggle at all.

#### The analyst view, switched off

There was a second toggle here, **Client / Analyst**, deciding what the page was
for rather than how much of it showed: the analyst side carried the composite,
the band, the rank and tier, the seven block scores with their weights and
coverage, where the remaining points were, the engine flags, the rank column and
the band filter, and the methodology tables.

It is **switched off at the front door rather than taken out**. Every one of
those views is still in the code and still correct; what is gone is the toggle
that reached them, so nothing renders them and nothing asks for them. One
constant in `app.js` does it:

```js
const ANALYST_ENABLED = false;
const isAnalyst = () => ANALYST_ENABLED && state.mode === 'analyst';
```

Flip that to `true` and put the two buttons back in the masthead to have it
again. The server side never changed: the model still scores every fund, the
`/funds` list still carries the composite, band, rank and evidence, and the
methodology endpoints still answer. Scoring is what produces the ordering the
client view depends on, so there is nothing to switch off there and nothing to
be gained by trying.

Anything score-bearing is **removed from the DOM** rather than dimmed, so a
screenshot cannot leak it.

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

### 6.2 One set of return horizons

Every point to point return, everywhere, is shown over **1M, 3M, 6M, 1Y, 3Y and
5Y**. One list, defined once in `framework.py` as `RETURN_HORIZONS`, served to
the front end through `/framework` and read from there by every table that draws
returns.

It is one list because six lists drift. The fund page carried 1M to 5Y, the
shortlist 3M to 5Y, the comparison 3M to 7Y and the detail modal all of those
plus a year to date, so the same fund read on three pages answered three
different questions and none of them said which.

A month is noise and a decade is a different fund, but the short end is what
somebody arriving has just watched happen and the long end is the only part that
says anything about a process, so both are in. What is gone is 2Y and 7Y, which
are neither, and the year to date, which is a calendar question answered
properly by the calendar look through.

Rolling returns are a different question and keep their own horizons: a rolling
window needs several of itself to have a median, so the short end has none.

### 6.3 Tables

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

### 6.4 Charts

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
- **Beyond a year the rate leads and the total follows it.** A three year chart
  reading "+94%" beside a fund page stating 24.9 is the same fund twice in two
  different currencies, and the one the rest of the dashboard is stated in is
  the one that should be in bold. The unit sits with the number, not under it:
  a bold rate and a bold total are indistinguishable once they are the same
  size and shape. Inside a year there is nothing to annualise, so the total
  stands alone.
- **The gap to the benchmark is printed, not left to be subtracted.** A chart
  shows a fund clearing its benchmark and the eye can see it, but saying by how
  much is arithmetic the reader should not be doing. It sits in a small boxed
  table above the plot and hard right, in the space the card header leaves
  empty, rather than as a third figure beneath every name in the key,
  which turned the key into a wall of numbers with the one that answers the
  question buried in it. One basis for every row, so the column can be read
  down: annualised where the window is long enough, on the window's own total
  where it is not, and the caption says which. A negative alpha takes the
  accent colour. The reference is the category's index on a fund's page and the
  first benchmark on a comparison. Under the key it was the last thing on the
  card and read as a footnote, when the question it answers is the first one
  asked of the chart.
- **The category average is a line, not a band.** It is dashed, because it is a
  reference and not a fund you could have bought.
- **Capture is drawn against 100**, the benchmark's own level, with downside in
  the serious tone and upside in the sequential ramp.

### 6.5 Words

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
| `GET /api/mf/portfolio/growth` | The weighted holding as one line, with its holdings |
| `GET /api/mf/portfolio/lookthrough` | What the combination holds, and how many positions it behaves like |
| `GET /health` | Health check, used by the deploy platform |

The front end is three files and no framework: `index.html`, `styles.css`,
`app.js` and `charts.js`. State lives in one object; views render into one
`<main>`; there is no router, no virtual DOM and nothing to install.

#### What makes it quick

Three things, each found by measuring rather than by guessing. The numbers below
are for All funds, the only view that asks for five hundred rows at once.

- **Responses are gzipped** on the way out. They are tables of numbers written as
  text, which is close to the best case for deflate: the fund list goes from
  833 KB to 41 KB on the wire, the passive families from 252 KB to 20 KB.
  Nothing upstream does this, so without it every reader on a slow connection
  paid full price for a table they were about to filter down to twenty rows.
- **The fund list carries what the table reads and nothing else.** It was sending
  all sixty four fields of every record to draw fifteen columns, including a
  narrative sentence built per fund and never displayed. Twenty four fields now,
  which halves the JSON before it is even compressed. Every other list is a
  dozen rows, where the full record costs nothing worth saving.
- **Number formatters are built once and kept.** `toLocaleString` looks cheap and
  is not: it resolves a locale and constructs a formatter on every call, and the
  format helper runs on nearly every cell of every table, every axis label and
  every figure on every card. Over seven and a half thousand cells that was
  143 ms against 5 ms with the formatter kept, and it was the single largest cost
  in drawing any page.

Together: the All funds table went from **324 ms to about 200 ms** to render, on
**41 KB instead of 833 KB**.

One plausible culprit turned out not to be one, which is worth recording so
nobody spends the afternoon on it again. Auto table layout has to measure every
cell before it can size a column, so a 7,500 cell table looked like an obvious
target for `table-layout: fixed`. Measured head to head on the same markup it
made no difference at all — 125 ms against 121 ms — and it would have cost
ellipsis clipping on every long scheme name. It is not in the code.

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
