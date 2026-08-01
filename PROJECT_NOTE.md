# Project Note — Equity MF Selection & Monitoring Dashboard

A plain-language record of what was asked, what was built, what was left out, and
how a fund's score is actually arrived at. Written for someone who has not read
the code.

---

## 1. What was asked

Build a working dashboard that implements the **Equity MF Selection & Monitoring
Policy v2.0** and its companion scorecard workbook — not a summary of the policy,
but the policy running as a system against real fund data.

Asked for, in the order it came up:

1. Put the whole framework into software: the hard gates, the 21-parameter
   scorecard, the category-adjusted weights, the classification bands, the
   whitelist construction rules, the portfolio guardrails, the monitoring triggers.
2. Drive it from the real data — the Sheety `dataPack` APIs, the Avendus
   Automation workbook, the house Mutual Fund Whitelist PDF.
3. A **"Rate a fund"** page: pick any scheme, see where it stacks under the
   framework, and get a written remark about it.
4. A **"How we think about this"** page explaining the evaluation philosophy.
5. Answer explicitly: what are the holdings used for — are they scored, or just
   displayed?
6. Make it deployable, with step-by-step instructions for GitHub + Render.

---

## 2. What was done

### The universe

| | Count |
|---|---|
| Schemes in the feed | 1,221 |
| Inside the eleven SEBI equity categories (in scope) | 567 |
| With a disclosed security-level book | 563 |
| Security-level positions loaded | 34,035 |
| Schemes on the live house whitelist (for reconciliation) | 39 |

Data as of: metrics 01-Apr-26, NAV 29-May-26, holdings 31-May-26.

### The result of running the framework

| Outcome | Funds |
|---|---|
| Passed all testable gates | 239 |
| Rejected at Stage 1 | 328 |
| → on G1 vintage | 245 |
| → on G2 AUM floor | 91 |
| → on G7 concentration sanity | 77 |
| → on G5 mandate compliance | 28 |
| **Core Whitelist** | 73 |
| **Satellite / Watch-in** | 112 |
| **Hold — no fresh flows** | 53 |
| **Exit / Reject** | 1 |

(Gate counts overlap — a fund can fail more than one.)

### What was built

| Piece | What it is |
|---|---|
| `etl/build_dataset.py` | Merges four sources into `data/*.json`. Run offline, output committed. |
| `mf/framework.py` | The policy encoded as data — every gate, weight, band, threshold. Single source of truth. |
| `mf/scoring.py` | The three-stage engine: gates → 21 parameters → composite, risk cap, classification, triggers. |
| `mf/narrative.py` | Writes the analyst remark for one fund, entirely from that fund's evaluated record. |
| `mf/datastore.py` | Evaluates the universe once; whitelist construction, overlap, look-through, guardrail checks. |
| `mf/api.py` | Ten JSON endpoints under `/api/mf`. |
| `static/` | Ten-tab dashboard. No build step, no external JS libraries, charts hand-rolled in SVG. |
| `server.py`, `render.yaml`, `Procfile` | Production wiring. Health check at `/health`. |

The ten tabs: Overview, **Rate a fund**, Whitelist, Screener, Categories,
Holdings, Portfolio, Monitoring, **Our approach**, Reference.

### Rate a fund

Pick any of the 567 schemes; the framework runs it end to end and then writes it
up. The remark is assembled from the evaluated record only — nothing is inferred
from the fund's name, its AMC's reputation, or the category's current fashion.
Every sentence quotes the number behind it.

It answers, in order: the verdict and what to do about it; strengths and concerns,
each tagged to the parameter that evidenced it; percentile standing within its own
category on seven metrics; pillar scores against the category median; gate results;
**what the framework has not seen**, with the exact share of the score resting on
convention; what would move the score; triggers currently firing; what it holds;
and all 21 parameters in full.

It says uncomfortable things when the data supports them. A fund with excellent
downside capture and weak upside capture is told it will trail in rallies. A fund
scoring 83 that fails the vintage gate is told the score is irrelevant this cycle.

### Holdings — the answer to the direct question

The 34,035 positions are **scoring inputs, not a display feature**. Four of five
Pillar C parameters and one hard gate are computed from them:

| Use | What it reads |
|---|---|
| **C1** mandate fidelity | Headroom over the SEBI cap minimums (562 funds) |
| **C2** concentration | Top-10, largest position, top-3 sectors vs category norms; inverted for Focused (563) |
| **C3** liquidity | Small-cap share of the equity sleeve weighted by AUM (556) |
| **C4** active share | Book structure — holding count against top-10 concentration (563) |
| **G7** concentration sanity | Top-10 ≤ 60%, single stock ≤ 10% — **77 funds rejected here** |
| **G5** fallback | Cap split when the attribute sheet has no mid/small breakdown |

They also drive the overlap analytics: pairwise overlap as Σ min(weight) over
shared names, the substitution check against top-scoring peers, and portfolio
look-through to stock, sector and cap level. That turns §10's "beyond roughly ten
schemes, overlap makes the portfolio an expensive index fund" into a number you
can see *before* the allocation is made.

Cash, TREPS and receivables are excluded from the equity sleeve throughout, so
concentration and overlap are computed on the invested book, not diluted by cash.

### Deployment

Self-contained at runtime — `data/*.json` is committed, so the server needs no
workbook, no PDF, no live API call at boot. Clone and run, or point Render at the
repo (New → Blueprint). The dataset warms at boot under `gunicorn --preload`, so
both workers share it copy-on-write; `/health` returns 503 rather than 200 if the
data is missing, so a bad deploy is visible at the platform level.

---

## 3. What was not done — the gaps

These are stated rather than papered over, because the one thing a selection
framework must not do is misstate its own eligible universe.

### Gates that cannot be tested from the data

| Gate | Why |
|---|---|
| **G3** manager tenure | The feed names the FM but carries no appointment date. Returned as `manual`, not silently passed. |
| **G4** regulatory / governance standing | No machine-readable source. Returned as `manual`. |

A fund shown as "gates passed" has passed the five testable gates. G3 and G4
remain an analyst's job.

### Parameters scored by convention, not measurement

Five of 21 have no data source in this pipeline and score 3 across the board,
flagged as `default` — per §6.2, a data gap must neither punish nor reward:

- **C5** style consistency
- **D1** AMC investment process
- **D2** manager track record and stability
- **D4** disclosure quality
- **E3** operational / servicing quality

These are Pillars D and E analyst inputs — judgement calls by design, not
pipeline failures. **The median fund has 81% of its score weight resting on
measured data.**

### Three explicit proxies

| Parameter | Wants | Uses instead | Why |
|---|---|---|---|
| **A2** rolling-return consistency | Share of daily-rolled 3Y windows beating benchmark | 3Y information ratio | Needs a NAV time-series pipeline |
| **C3** portfolio liquidity | Days-to-liquidate at 20% of ADTV | Small-cap share weighted by AUM | Needs security-level volume data |
| **C4** active share | Overlap vs benchmark constituent weights | Holding count vs top-10 concentration | Needs benchmark constituents |

**A4** is also partial: it averages category percentiles across three horizons
(CYTD / 3Y / 5Y) instead of a seven-year calendar-quartile history, which the
feed does not carry.

### Coverage gaps

- **189 of 567 funds** have no quantitative feed metrics — they sit outside the
  four `dataPack` endpoints (predominantly Sectoral / Thematic, which is 250 of
  the 567). Their Pillar A and B parameters fall to the convention score of 3,
  which drops their evidence share as low as 10%. They are still evaluated and
  still gated; they are simply thinly evidenced, and the dashboard says so.
- **4 funds** have no disclosed holdings, so C1–C4 default for them.
- The Sheety API flattens multi-column groups and only the first sub-column
  survives; AUM and the longer horizons were recovered from the workbook instead.

### Monitoring triggers

Four of eight run automatically (T3 alpha persistence, T4 drawdown, T6 style
drift, T7 score threshold). The other four — FM exit, AMC ownership change,
AUM capacity events, governance events — need a human or an event feed and are
listed as manual.

### Not built at all

- **No NAV time-series pipeline.** This is the single change that would upgrade
  A2 from a proxy to the real measurement, and unlock true rolling-window
  statistics throughout.
- **No scheduled data refresh.** Refreshing is a local step: re-run
  `etl/build_dataset.py`, commit the JSON. Deliberate — it keeps the deployed
  app free of runtime dependencies on the source systems.
- **No authentication, no persistence, no audit log.** Portfolio checks are
  stateless: post weights, get guardrail results back. Nothing is saved.
- **The IC overlay is a live control, not a stored decision.** You can re-run
  Stage 3 with ±5 to see the effect; the framework does not record who applied it
  or why.
- **No allocation advice, no theme validation, no forecasting.** Out of scope by
  design — the framework selects and monitors funds; it does not decide how much
  of a portfolio should sit in equity or whether a theme is worth owning.

---

## 4. How a score is arrived at

Three stages, run in order. **Stage 1 can veto Stage 2** — this matters, and it
is the part most often misread.

### Stage 1 — Hard gates (pass/fail, no scoring)

Seven gates. Any failure rejects the fund regardless of how well it scores.

| | Gate | Test |
|---|---|---|
| G1 | Vintage | ≥5Y track record (category-dependent) |
| G2 | AUM floor | ≥ ₹500 cr (category-dependent) |
| G3 | Manager tenure | *manual* |
| G4 | Regulatory standing | *manual* |
| G5 | Mandate compliance | Cap allocation within SEBI category limits |
| G6 | Structure | Direct plan, growth option |
| G7 | Concentration sanity | Top-10 ≤ 60%, single stock ≤ 10% |

328 of 567 are rejected here. Several score above 80 and are still rejected —
that is the gate working as designed, not a scoring failure.

### Stage 2 — The 21-parameter scorecard

Each parameter is scored **1 to 5**, then weighted.

**How a raw number becomes a 1–5 band.** The Quant Helper approach: each metric
has cut thresholds, and the raw value falls into a band. Downside capture, for
example: below 85% scores 5, 85–95% scores 4, and so on. No percentile ranking —
a band is a stable statement about the fund itself, so a fund's score does not
move because its peers moved.

**Where each parameter's number comes from:**

- **`quant`** — straight from the feed (rolling returns, Sharpe, Sortino,
  information ratio, SD, semi-SD, max drawdown, up/down capture, beta, TER).
- **`holdings`** — derived from the security-level book (C1–C4, G7).
- **`default`** — no data, scores 3, flagged. Never guessed.

**Category-relative, not absolute.** Comparisons are always against the fund's own
category peers, and — per §12 — **the category median is computed over
gate-passing funds only**, so a flood of young funds cannot drag the peer standard
down.

**The five pillars, weighted by category.** Weights are a full 11 × 5 matrix, not
one global set — Small Cap weights risk and liquidity harder than Large Cap does;
Focused inverts the concentration penalty because concentration is the mandate.

| Pillar | | Example weight (Focused) |
|---|---|---|
| **A** | Performance quality | 30 |
| **B** | Risk & downside | 26 |
| **C** | Portfolio & style integrity | 18 |
| **D** | Fund house & manager | 18 |
| **E** | Cost & operations | 8 |

Each pillar's weight is distributed across its parameters. A parameter's
contribution is `(score ÷ 5) × parameter weight`. Sum them for the composite.

### Stage 3 — Composite, overlay, cap, classification

1. **Composite** = sum of weighted contributions, out of 100.
2. **IC overlay** — the Investment Committee may adjust by **±5 points**, and the
   adjustment is recorded separately from the raw score, never merged into it.
3. **Risk cap** — if **B1 (downside capture) scores 1**, the fund is capped at
   **Hold** no matter what the composite says. A fund that loses too much in
   drawdowns does not get onto the whitelist on the strength of its returns.
4. **Classification** into four bands: Core Whitelist / Satellite–Watch-in /
   Hold / Exit–Reject. A Stage 1 failure overrides all of it.

### Worked example

*Mahindra Manulife Focused Fund* — composite **86.3**, Core Whitelist, ranked 1st.

| Pillar | Earned / available | |
|---|---|---|
| A Performance | 30.0 / 30 | 100% |
| B Risk | 21.0 / 26 | 81% |
| C Portfolio | 16.4 / 18 | 91% |
| D Fund house | 11.5 / 18 | 64% |
| E Cost | 7.4 / 8 | 92% |

Sample parameter notes as the engine emits them:

- **A1 = 5** — "Median rolling 3Y CAGR 22.35% vs benchmark 13.86% (+8.49 pp),
  category median 16.95%"
- **A3 = 5** — "Jensen's alpha +9.14% p.a. (β 0.91, rf 7.0%) vs Nifty 500 TRI"
- **B1 = 4** — "3Y downside capture 87.0% vs Nifty 500 TRI"

Pillar D sits at 64% not because the fund house scored badly but because three of
its four parameters are convention scores of 3. Evidence: **16 of 21 parameters
measured, 81.3% of score weight**. The dashboard shows that figure on every fund,
so a high score built on thin evidence is never mistaken for a high score built
on thick evidence.

### The honesty rule, in one line

Every parameter reports whether its score was **measured**, derived from
**holdings**, or assigned by **convention** — and every fund carries the share of
its score weight resting on measured data. A gap is disclosed, never filled.
