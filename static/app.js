/* Mutual Fund Screener.
 *
 * Four views: the methodology page, the per-category shortlists, the full table
 * with a fund detail card, and a portfolio look-through.
 *
 * The Client / Analyst toggle decides what the page is *for*, not just how much
 * of it shows.
 *
 *   Client   the fund, in plain terms. Why we like it, what to watch, who runs
 *            it, the numbers grouped the way they are actually read, and what it
 *            holds. No score, no weight, no band, no internal tag.
 *   Analyst  all of that plus the model: composite, band, block scores and
 *            weights, coverage, evidence, where the remaining points are, and
 *            every flag the engine raised.
 *
 * Anything score-bearing is removed from the DOM in client view rather than
 * dimmed, so a screenshot of client view cannot leak it.
 *
 * Every technical term the page prints carries its plain-English meaning on
 * hover, from the glossary in mf/framework.py. A number nobody can read is not
 * disclosure.
 */

const API = '/api/mf';
const $ = (s, r = document) => r.querySelector(s);
const state = { mode: 'client', view: 'shortlist', fw: null, meta: null, fund: null,
                gloss: {} };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 1) =>
  (v === null || v === undefined || Number.isNaN(v)) ? '—' : Number(v).toLocaleString('en-IN',
    { minimumFractionDigits: d, maximumFractionDigits: d });
const cr = (v) => v == null ? '—' : (v >= 1000 ? `₹${num(v / 1000, 1)}k cr` : `₹${num(v, 0)} cr`);
const isAnalyst = () => state.mode === 'analyst';

const BAND_TONE = { A: 'good', B: 'warning', C: 'serious', Review: 'critical',
                    'Not rated': 'neutral' };

async function get(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

/* ---------------------------------------------------------------- glossary */

/* Match a printed label to a glossary entry. Labels carry a horizon ("Sortino
   3Y") and sometimes a qualifier, so the lookup walks from the most specific
   form down to the bare term rather than needing an entry per horizon. */
function glossFor(label) {
  const g = state.gloss;
  let k = String(label || '').toLowerCase().trim();
  if (g[k]) return g[k];
  k = k.replace(/\s*\b\d+\s*y(ea)?rs?\b/g, '').replace(/\s+/g, ' ').trim();
  if (g[k]) return g[k];
  k = k.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (g[k]) return g[k];
  const hit = Object.keys(g).filter((t) => t.length > 4 && k.includes(t))
    .sort((a, b) => b.length - a.length)[0];
  return hit ? g[hit] : null;
}

/* A term with its meaning attached. The dotted underline is the affordance. */
function term(label, extra) {
  const meaning = glossFor(label);
  if (!meaning && !extra) return esc(label);
  const body = [meaning, extra].filter(Boolean).join(' ');
  return `<span class="term" data-gloss="${esc(body)}" tabindex="0">${esc(label)}</span>`;
}

function wireGlossary(root) {
  root.querySelectorAll('[data-gloss]').forEach((el) => {
    const html = `<strong>${esc(el.textContent.trim())}</strong>
      <div class="tt-note">${esc(el.dataset.gloss)}</div>`;
    el.addEventListener('mouseenter', (e) => Chart.showTip(e, html));
    el.addEventListener('mousemove', (e) => Chart.showTip(e, html));
    el.addEventListener('mouseleave', Chart.hideTip);
    el.addEventListener('focus', (e) => Chart.showTip(
      { clientX: el.getBoundingClientRect().left,
        clientY: el.getBoundingClientRect().bottom }, html));
    el.addEventListener('blur', Chart.hideTip);
  });
}

/* ------------------------------------------------------------------ chrome */

function bandPill(band) {
  return `<span class="pill ${BAND_TONE[band] || 'neutral'}"><span class="dot"></span>${esc(band)}</span>`;
}

function applyMode() {
  document.body.dataset.mode = state.mode;
  $('#viewtoggle').querySelectorAll('button').forEach((b) => {
    const on = b.dataset.mode === state.mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

function setView(v) {
  state.view = v;
  $('#tabs').querySelectorAll('button').forEach((b) =>
    b.classList.toggle('on', b.dataset.view === v));
  render();
}

/* ------------------------------------------- 1. how we look at funds */

function renderApproach(host) {
  const fw = state.fw;
  host.innerHTML = `
    <section class="prose">
      <h2>How we look at mutual funds</h2>
      <p class="lede">Actively managed equity. One model with two jobs: rank the funds
      in each category and surface the shortlist, then present that shortlist the way
      a client should see it, with a written rationale leading and the number behind
      the analyst toggle.</p>

      <h3>Fund selection process</h3>
      <div class="cards">
        ${fw.process.map((p) => `
          <div class="card"><h4>${esc(p.name)}</h4><p>${esc(p.text)}</p></div>`).join('')}
      </div>

      <div class="analyst-only">
        <h3>What we score, and why</h3>
        <div id="weightchart" class="chart-host"></div>
        <table class="grid">
          <thead><tr><th>Block</th><th class="r">Weight</th>
            <th>What it uses and why it matters</th></tr></thead>
          <tbody>${fw.blocks.map((b) => `
            <tr>
              <td><strong>${esc(b.name)}</strong></td>
              <td class="r mono">${b.weight}%</td>
              <td class="muted">${esc(b.why)}</td>
            </tr>
            <tr class="sub"><td></td><td></td><td>
              ${b.metrics.map((m) => `<span class="chip${m.weight ? '' : ' off'}">${term(m.label)}
                <em>${m.weight ? m.weight + '%' : 'no weight'}</em></span>`).join('')}
            </td></tr>`).join('')}
          </tbody>
        </table>

        <h3>Shown, but not scored</h3>
        <p>Some fields earn their place on the page without earning a place in the
        score. Scoring them would count the same thing twice.</p>
        <table class="grid">
          <thead><tr><th>Field</th><th>Why it is not scored</th></tr></thead>
          <tbody>${Object.entries(fw.notScoredWhy).map(([f, why]) => `
            <tr><td><strong>${term(labelForField(f) || f)}</strong></td>
              <td class="muted">${esc(why)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>

      <h3>Category adjustments</h3>
      <div class="cards">
        ${fw.categoryAdjustments.map((c) => `
          <div class="card"><h4>${esc(c.name)}</h4><p>${esc(c.text)}</p></div>`).join('')}
      </div>

      <h3>Market cycles</h3>
      <p>The manager block counts cycles actually run, and the cycles come from the
      benchmark's own monthly history rather than a remembered list of corrections. A
      cycle is a peak to trough fall of at least 12 percent.</p>
      <table class="grid">
        <thead><tr><th>Peak</th><th>Trough</th><th class="r">Depth</th>
          <th>Recovered</th></tr></thead>
        <tbody>${(state.meta.marketCycles || []).map((c) => `
          <tr><td class="mono">${esc(c.peak)}</td><td class="mono">${esc(c.trough)}</td>
            <td class="r mono">${num(c.depthPct, 1)}%</td>
            <td class="mono muted">${esc(c.recovered || 'not yet')}</td></tr>`).join('')
          || '<tr><td colspan="4" class="muted">No monthly series in this build.</td></tr>'}
        </tbody>
      </table>

      <h3>Where a category is not a peer group</h3>
      <p>Everything here is scored against category peers, which only means something
      when the peers are doing the same job. Where that does not hold, the caveat
      travels with the number.</p>
      ${Object.entries(fw.loosePeerGroups || {}).map(([cat, why]) => `
        <div class="caveat"><strong>${esc(cat)}.</strong> ${esc(why)}</div>`).join('')
        || '<p class="muted">None flagged.</p>'}

      <div class="analyst-only">
        <h3>Bands</h3>
        <table class="grid">
          <thead><tr><th>Band</th><th class="r">${term('Composite')}</th>
            <th>What it means</th></tr></thead>
          <tbody>${fw.bands.map((b) => `
            <tr><td>${bandPill(b.code)}</td>
            <td class="r mono">${b.min >= 0 ? b.min + ' and above'
              : 'below ' + fw.bands[fw.bands.length - 2].min}</td>
            <td class="muted">${esc(b.meaning)}</td></tr>`).join('')}
            <tr><td>${bandPill('Not rated')}</td><td class="r mono">n/a</td>
            <td class="muted">Less than ${fw.minEvidence}% of the model could be scored,
            so the fund carries no composite. A gap in the feed, not a verdict.</td></tr>
          </tbody>
        </table>
        <p class="note">A composite difference below ${fw.meaningfulGap} points is not a
        real difference. Funds inside that distance of their tier leader are shown as
        equally ranked, because the model orders a shortlist, it does not select.</p>
      </div>

      <h3>How to use this</h3>
      <ul class="ticks">${fw.howToUse.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
    </section>`;

  if (isAnalyst()) {
    Chart.bars($('#weightchart'), fw.blocks.map((b) => ({ label: b.name, value: b.weight })),
      { suffix: '%', decimals: 0, colorFor: (r) => Chart.seqColor(r.value / 27) });
  }
  wireGlossary(host);
}

function labelForField(f) {
  for (const b of state.fw.blocks) {
    const m = b.metrics.find((x) => x.field === f);
    if (m) return m.label;
  }
  const c = (state.fw.contextMetrics || []).find((x) => x.field === f);
  return c ? c.label : null;
}

/* --------------------------------------------------- 2. category shortlists */

/* One horizontal strip per category rather than a grid of boxes. Each fund is a
   bubble: position is the median rolling 3Y return, area is AUM. Clicking one
   opens its full card in place, so the shortlist and the fund sit on the same
   page instead of a tab apart. */

async function renderShortlists(host) {
  host.innerHTML = '<div class="loading">Building shortlists…</div>';
  const data = await get('/shortlists');
  host.innerHTML = `
    <section>
      <div class="section-head">
        <h2>Category top funds</h2>
        <p class="lede">The shortlist per category. Each bubble is a fund: further
        right is a higher ${term('median rolling return')} over three years, and a
        bigger bubble is a larger fund. Click one to open it.</p>
      </div>
      <div id="cat-detail" class="detail" hidden></div>
      <div class="strips">
        ${data.categories.map((c, i) => `
          <div class="stripwrap">
            <div class="striphead">
              <h3>${esc(c.category)}</h3>
              <span class="muted">${c.count} schemes${
                c.mandate ? ' · ' + esc(c.mandate) : ''}</span>
            </div>
            ${c.caveat ? `<div class="caveat">${esc(c.caveat)}</div>` : ''}
            <div id="strip-${i}" class="chart-host"></div>
            <div class="striplegend">
              <span>x: ${term('Median rolling 3Y')}</span>
              <span>bubble area: ${term('AUM')}</span>
              <span>labelled: top ${Math.min(3, c.funds.length)} by rolling return</span>
            </div>
          </div>`).join('')}
      </div>
    </section>`;

  data.categories.forEach((c, i) => {
    const rows = c.funds.map((f) => ({
      key: f.key, name: f.name, short: shortName(f.name, f.amc),
      x: f.medianRolling3Y, size: f.aumCr || 0, fund: f,
    }));
    Chart.bubbleStrip($('#strip-' + i), rows, {
      onClick: (p) => openFund(p.key, '#cat-detail'),
      tipFor: (p) => {
        const f = p.fund;
        return `<strong>${esc(f.name)}</strong>
          <div class="tt-note">${esc(f.amc || '')}</div>
          <div class="tt-row"><span>Median rolling 3Y</span><span>${num(f.medianRolling3Y, 1)}%</span></div>
          <div class="tt-row"><span>Downside capture</span><span>${num(f.downsideCapture3Y, 0)}</span></div>
          <div class="tt-row"><span>Sortino</span><span>${num(f.sortino3Y, 2)}</span></div>
          <div class="tt-row"><span>AUM</span><span>${cr(f.aumCr)}</span></div>
          ${isAnalyst() ? `<div class="tt-row"><span>Composite</span><span>${
            num(f.composite, 1)} (${esc(f.band)})</span></div>` : ''}`;
      },
    });
  });
  wireGlossary(host);
}

/* Inside one category every scheme name ends in the same words, so the house is
   the only part that identifies it. "Parag Parikh Flexi Cap Fund" in Flexicap is
   just "Parag Parikh"; trimming from the other end would leave three funds all
   labelled "Flexi Cap". */
function shortName(name, amc) {
  const house = String(amc || '')
    .replace(/\s*(Mutual Fund|Asset Management|AMC|MF)\s*$/i, '').trim();
  const label = house || String(name || '');
  return label.length > 22 ? label.slice(0, 21) + '…' : label;
}

/* ------------------------------------------------------------ 3. all funds */

/* Columns the table can sort on. `field` is what the API sorts by; `dir` is the
   direction that puts "good" first, so one click on any column shows the best of
   it rather than making the reader work out which way is up. */
const COLUMNS = [
  { field: 'categoryRank', label: '#', analyst: true, dir: 'asc', fmt: (f) => f.categoryRank ?? '—' },
  { field: 'name', label: 'Fund', dir: 'asc', text: true },
  { field: 'category', label: 'Category', dir: 'asc', text: true },
  { field: 'band', label: 'Band', analyst: true, dir: 'asc', text: true },
  { field: 'composite', label: 'Composite', analyst: true, dir: 'desc', d: 1 },
  { field: 'medianRolling3Y', label: 'Median rolling 3Y', dir: 'desc', d: 1 },
  { field: 'medianRolling5Y', label: 'Median rolling 5Y', dir: 'desc', d: 1 },
  { field: 'rollingHitRate3Y', label: 'Hit rate', dir: 'desc', d: 0 },
  { field: 'return3Y', label: 'CAGR 3Y', dir: 'desc', d: 1 },
  { field: 'sortino3Y', label: 'Sortino', dir: 'desc', d: 2 },
  { field: 'informationRatio3Y', label: 'Information Ratio', dir: 'desc', d: 2 },
  { field: 'downsideCapture3Y', label: 'Downside capture', dir: 'asc', d: 0 },
  { field: 'upsideCapture3Y', label: 'Upside capture', dir: 'desc', d: 0 },
  { field: 'maxDrawdown3Y', label: 'Maximum drawdown', dir: 'desc', d: 1 },
  { field: 'ter', label: 'Expense ratio', dir: 'asc', d: 2 },
  { field: 'managerYears', label: 'Tenure on this scheme', dir: 'desc', d: 1 },
  { field: 'aumCr', label: 'AUM', dir: 'desc', money: true },
  { field: 'evidence', label: 'Evidence', analyst: true, dir: 'desc', d: 0 },
];

const filters = { category: 'All', band: 'All', amc: 'All', q: '',
                  minAum: '', maxDownside: '', hasHoldings: false, ratedOnly: false,
                  sort: 'medianRolling3Y', dir: 'desc' };

async function renderAll(host) {
  const amcs = state.meta.amcs || [];
  host.innerHTML = `
    <section>
      <div class="section-head"><h2>All funds</h2></div>
      <div class="filterbar">
        <label>Search
          <input id="f-q" type="search" placeholder="Scheme, AMC or manager"
                 value="${esc(filters.q)}" autocomplete="off">
        </label>
        <label>Category
          <select id="f-cat">${['All', ...state.fw.categories].map((c) =>
            `<option${c === filters.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
        </label>
        <label>AMC
          <select id="f-amc">${['All', ...amcs].map((c) =>
            `<option${c === filters.amc ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
        </label>
        <label class="analyst-only">Band
          <select id="f-band">${['All', 'A', 'B', 'C', 'Review', 'Not rated'].map((c) =>
            `<option${c === filters.band ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
        </label>
        <label>Min AUM (₹ cr)
          <input id="f-aum" type="number" min="0" step="100" placeholder="any"
                 value="${esc(filters.minAum)}"></label>
        <label>Max downside capture
          <input id="f-dn" type="number" min="0" step="5" placeholder="any"
                 value="${esc(filters.maxDownside)}"></label>
        <label class="chk"><input id="f-hold" type="checkbox"${
          filters.hasHoldings ? ' checked' : ''}> Has holdings</label>
        <label class="chk analyst-only"><input id="f-rated" type="checkbox"${
          filters.ratedOnly ? ' checked' : ''}> Rated only</label>
        <span class="spacer"></span>
        <button id="f-reset" class="ghost">Reset</button>
      </div>
      <div id="detail" class="detail" hidden></div>
      <div id="tablewrap" class="tablewrap"></div>
    </section>`;

  const bind = (id, key, prop = 'value') => {
    const el = $('#' + id);
    if (!el) return;
    const handler = debounce(() => { filters[key] = el[prop]; loadTable(); }, 220);
    el.oninput = handler; el.onchange = handler;
  };
  bind('f-q', 'q'); bind('f-cat', 'category'); bind('f-amc', 'amc');
  bind('f-band', 'band'); bind('f-aum', 'minAum'); bind('f-dn', 'maxDownside');
  bind('f-hold', 'hasHoldings', 'checked'); bind('f-rated', 'ratedOnly', 'checked');
  $('#f-reset').onclick = () => {
    Object.assign(filters, { category: 'All', band: 'All', amc: 'All', q: '',
      minAum: '', maxDownside: '', hasHoldings: false, ratedOnly: false });
    renderAll(host);
  };

  await loadTable();
  if (state.fund) openFund(state.fund);
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function sortBy(field) {
  const col = COLUMNS.find((c) => c.field === field);
  if (!col) return;
  // First click on a column uses its natural direction; clicking the active
  // column flips it.
  filters.dir = filters.sort === field
    ? (filters.dir === 'asc' ? 'desc' : 'asc')
    : (col.dir || 'desc');
  filters.sort = field;
  loadTable();
}

async function loadTable() {
  const p = new URLSearchParams({ limit: '500', sort: filters.sort, dir: filters.dir });
  if (filters.category !== 'All') p.set('category', filters.category);
  if (filters.band !== 'All') p.set('band', filters.band);
  if (filters.amc !== 'All') p.set('amc', filters.amc);
  if (filters.q) p.set('q', filters.q);
  if (filters.minAum) p.set('minAum', filters.minAum);
  if (filters.maxDownside) p.set('maxDownside', filters.maxDownside);
  if (filters.hasHoldings) p.set('hasHoldings', '1');
  if (filters.ratedOnly) p.set('rated', '1');

  const data = await get('/funds?' + p);
  const cols = COLUMNS.filter((c) => !c.analyst || isAnalyst());
  const wrap = $('#tablewrap');
  const arrow = (c) => filters.sort === c.field
    ? `<span class="arrow">${filters.dir === 'asc' ? '▲' : '▼'}</span>`
    : '<span class="arrow">↕</span>';

  wrap.innerHTML = `
    <div class="tablemeta">${data.funds.length} of ${data.total} shown ·
      sorted by ${esc(COLUMNS.find((c) => c.field === filters.sort)?.label || filters.sort)}
      ${filters.dir === 'asc' ? 'ascending' : 'descending'}</div>
    <table class="grid dense sticky">
      <thead><tr>${cols.map((c) => `
        <th class="sortable${c.text || c.field === 'categoryRank' ? '' : ' r'}${
          filters.sort === c.field ? ' on' : ''}" data-sort="${esc(c.field)}"
          title="Sort by ${esc(c.label)}">${term(c.label)}${arrow(c)}</th>`).join('')}
      </tr></thead>
      <tbody>${data.funds.map((f) => `
        <tr data-fund="${esc(f.key)}" tabindex="0">${cols.map((c) => {
          if (c.field === 'name') {
            return `<td class="fundcell"><strong>${esc(f.name)}</strong>${f.flags.length
              ? `<span class="flag sm analyst-only">${esc(f.flags[0])}</span>` : ''}</td>`;
          }
          if (c.field === 'category') return `<td class="muted">${esc(f.category)}</td>`;
          if (c.field === 'band') return `<td>${bandPill(f.band)}</td>`;
          if (c.field === 'categoryRank') return `<td class="mono dim">${f.categoryRank ?? '—'}</td>`;
          if (c.money) return `<td class="r mono">${cr(f.aumCr)}</td>`;
          const v = f[c.field];
          return `<td class="r mono${c.field === 'evidence' ? ' dim' : ''}">${
            num(v, c.d ?? 1)}${c.field === 'evidence' ? '%' : ''}</td>`;
        }).join('')}</tr>`).join('')}
      </tbody>
    </table>`;
  wrap.querySelectorAll('th[data-sort]').forEach((th) =>
    th.onclick = () => sortBy(th.dataset.sort));
  wrap.querySelectorAll('[data-fund]').forEach((el) =>
    el.onclick = () => openFund(el.dataset.fund));
  wireGlossary(wrap);
}

/* --------------------------------------------------------- the detail card */

/* The numbers, grouped the way they are actually read rather than in feed
   order: what the fund returned over holding periods, what it returned between
   two dates, and what that cost in risk. Each group is a block of the model, so
   the client page and the analyst page are looking at the same structure. */
function numberGroups(f) {
  const byBlock = {};
  (f.blocks || []).forEach((b) => { byBlock[b.code] = b; });
  const ctx = (f.context || []);
  const ctxIn = (g) => ctx.filter((m) => m.group === g && m.value != null);

  const fromBlock = (code) => (byBlock[code]?.metrics || [])
    .filter((m) => m.raw != null && m.weight > 0)
    .map((m) => ({ label: m.label, value: m.raw, unit: m.unit, score: m.score }));

  return [
    { title: 'Rolling returns', why: 'What a typical holding period actually delivered.',
      rows: fromBlock('return') },
    { title: 'Risk adjusted', why: 'What the return cost in risk taken.',
      rows: fromBlock('riskAdj') },
    { title: 'Capture and drawdown', why: 'How it behaves when the market moves.',
      rows: fromBlock('capture') },
    { title: 'Risk', why: 'Shown for context, deliberately not scored.',
      rows: ctxIn('risk').map((m) => ({ label: m.label, value: m.value, unit: m.unit,
                                        extra: m.notScoredWhy })) },
    { title: 'CAGR', why: 'Point to point, so it depends on the two dates chosen.',
      rows: ctxIn('cagr').map((m) => ({ label: m.label, value: m.value, unit: m.unit })) },
    { title: 'The fund', why: '', rows: ctxIn('fund').map((m) =>
      ({ label: m.label, value: m.value, unit: m.unit })) },
  ].filter((g) => g.rows.length);
}

async function openFund(key, hostSel = '#detail') {
  state.fund = key;
  const host = $(hostSel);
  if (!host) { setView('all'); return; }
  host.hidden = false;
  host.innerHTML = '<div class="loading">Scoring…</div>';
  host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const f = await get('/fund/' + encodeURIComponent(key));
  const r = f.remark;
  const analyst = isAnalyst();

  const groups = numberGroups(f);

  host.innerHTML = `
    <button class="close" aria-label="Close">×</button>
    <div class="detail-head">
      <div>
        <h3>${esc(f.name)}</h3>
        <p class="muted">${esc(f.category)} · ${esc(f.amc || '')}${
          f.fundManager ? ' · ' + esc(f.fundManager) : ''}</p>
      </div>
      ${analyst ? `<div class="detail-score">
        ${bandPill(f.band)}
        <div class="big">${num(f.composite, 1)}</div>
        <div class="muted sm">${f.categoryRank
          ? `rank ${f.categoryRank} of ${f.categoryCount}` : 'unranked'}</div>
      </div>` : ''}
    </div>

    ${analyst ? `<p class="verdict">${esc(r.verdict)}</p>
      ${f.loosePeerGroup ? `<div class="caveat">${esc(f.loosePeerGroup)}</div>` : ''}` : ''}

    <div class="two">
      <div class="panel">
        <h4>Why we like it</h4>
        <p class="rationale big-rationale">${esc(r.whyWeLikeIt)}</p>
      </div>
      <div class="panel">
        <h4>What to watch</h4>
        <p class="rationale">${esc(r.whatToWatch)}</p>
      </div>
    </div>

    ${analyst && f.flags.length ? `<div class="flagrow">${f.flags.map((x) => `
      <div class="flagcard ${esc(x.tone)}"><strong>${esc(x.label)}</strong>
      <span>${esc(x.why)}</span></div>`).join('')}</div>` : ''}

    ${(f.managers || []).length ? `
    <h4>Who runs it</h4>
    <table class="grid dense">
      <thead><tr><th>Manager</th><th class="r">${term('Tenure on this scheme')}</th>
        <th class="r">Industry experience</th><th>Since</th></tr></thead>
      <tbody>${f.managers.map((m) => `
        <tr><td>${esc(m.name)}</td>
          <td class="r mono">${m.tenureYears == null ? '—' : num(m.tenureYears, 1) + ' yrs'}</td>
          <td class="r mono dim">${m.experienceYears == null ? '—'
            : num(m.experienceYears, 0) + ' yrs'}</td>
          <td class="muted">${esc(m.sinceBasis || 'not stated')}</td></tr>`).join('')}
      </tbody>
    </table>
    <p class="muted sm">${term('Market cycles run')}: ${num(f.managerCycles, 0)}.
      ${term('Live track record')}: ${esc(f.vintageBasis || '—')}.</p>` : ''}

    ${analyst ? `
    <h4>Block scores <span class="muted sm">bar height is the score, bar width is the
      weight in the composite, hatched means not scored</span></h4>
    <div id="blockbar" class="chart-host"></div>
    <table class="grid dense">
      <thead><tr><th>Block</th><th class="r">Weight</th><th class="r">Score</th>
        <th class="r">Category median</th><th class="r">${term('Coverage')}</th></tr></thead>
      <tbody>${f.peers.map((p) => `
        <tr><td>${esc(p.name)}</td><td class="r mono">${p.weight}%</td>
          <td class="r mono"><strong>${p.score == null ? 'not scored' : num(p.score, 0)}</strong></td>
          <td class="r mono dim">${p.categoryMedian == null ? '—' : num(p.categoryMedian, 0)}</td>
          <td class="r mono dim">${num(p.coverage, 0)}%</td></tr>`).join('')}
      </tbody>
    </table>` : ''}

    <h4>The numbers</h4>
    <div class="numgrid">
      ${groups.map((g) => `
        <div class="numgroup">
          <h5>${esc(g.title)}${g.why ? `<span class="muted sm">${esc(g.why)}</span>` : ''}</h5>
          <table class="grid dense kv">
            <tbody>${g.rows.map((row) => `
              <tr><td>${term(row.label, row.extra)}</td>
                <td class="r mono">${num(row.value, Math.abs(row.value) < 10 ? 2 : 1)}${
                  esc(row.unit || '')}</td>
                ${analyst ? `<td class="r mono dim pctile">${row.score == null ? ''
                  : num(row.score, 0)}</td>` : ''}</tr>`).join('')}
            </tbody>
          </table>
        </div>`).join('')}
    </div>
    ${analyst ? `<p class="muted sm">The third column is the fund's ${term('percentile')}
      within its category on that measure.</p>` : ''}

    ${analyst ? `
    <h4>Where the points are</h4>
    <p class="muted sm">Ordered by composite points still available, so the top row is
    what would actually change the answer.</p>
    <table class="grid dense">
      <thead><tr><th>Block</th><th class="r">Score</th>
        <th class="r">Points on the table</th><th>Note</th></tr></thead>
      <tbody>${r.movers.map((m) => `
        <tr><td>${esc(m.block)}</td>
          <td class="r mono">${m.score == null ? '—' : num(m.score, 0)}</td>
          <td class="r mono">${m.available == null ? '—' : num(m.available, 1)}</td>
          <td class="muted">${esc(m.note)}</td></tr>`).join('')}
      </tbody>
    </table>` : ''}

    <div class="two">
      <div class="panel">
        <h4>What it holds <span class="muted sm">top 15 of ${f.holdingCount ?? 0}</span></h4>
        <div id="holdbars" class="chart-host"></div>
        <div class="holdfoot">
          <span>${term('Cash and others')} <b>${num(f.cashPct, 1)}%</b></span>
          <span>${term('Top 10 weight')} <b>${num(f.top10, 0)}%</b></span>
          <span>${term('Effective number of stocks')} <b>${num(f.effectiveStocks, 0)}</b></span>
        </div>
        <p class="muted sm">${esc(f.mandate.note || '')}</p>
      </div>
      <div class="panel">
        <h4>Closest books in the category</h4>
        <p class="muted sm">If this fund were dropped, this is what already holds the
        same exposure.</p>
        <table class="grid dense">
          <thead><tr><th>Fund</th><th class="r">Overlap</th>
            <th class="r analyst-only">Composite</th></tr></thead>
          <tbody>${f.closest.map((c) => `
            <tr data-fund="${esc(c.key)}" tabindex="0"><td>${esc(c.name)}</td>
              <td class="r mono">${num(c.overlap, 0)}%</td>
              <td class="r mono analyst-only">${num(c.composite, 1)}</td></tr>`).join('')
            || '<tr><td colspan="3" class="muted">No disclosed book to compare.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;

  if (analyst) Chart.blockBar($('#blockbar'), f.blocks);

  /* Cash sits outside the equity book everywhere else in the model, so it is
     drawn here as an explicit final bar rather than mixed into the holdings. */
  const bars = f.holdings.map((h) => ({ label: h.name, value: h.weight, cash: false }));
  if (f.cashPct != null) bars.push({ label: 'Cash and others', value: f.cashPct, cash: true });
  Chart.bars($('#holdbars'), bars, {
    suffix: '%', decimals: 2,
    colorFor: (x) => x.cash ? 'var(--axis)' : Chart.seqColor(x.value / 10),
    tipFor: (x) => {
      if (x.cash) return `<strong>Cash and others</strong>
        <div class="tt-note">${esc(glossFor('cash and others') || '')}</div>`;
      const h = f.holdings.find((z) => z.name === x.label) || {};
      return `<strong>${esc(x.label)}</strong>
        <div class="tt-row"><span>Weight</span><span>${num(x.value, 2)}%</span></div>
        <div class="tt-row"><span>Sector</span><span>${esc(h.sector || '—')}</span></div>
        <div class="tt-row"><span>Cap</span><span>${esc(h.cap || '—')}</span></div>`;
    },
  });
  host.querySelector('.close').onclick = () => { host.hidden = true; state.fund = null; };
  host.querySelectorAll('[data-fund]').forEach((el) =>
    el.onclick = () => openFund(el.dataset.fund));
  wireGlossary(host);
}

/* ------------------------------------------------------------ 4. portfolio */

async function renderPortfolio(host) {
  host.innerHTML = `
    <section>
      <div class="section-head">
        <h2>Portfolio</h2>
        <p class="lede">Add schemes with weights to see the combined book: what it
        actually owns once the funds are looked through, and how much of it is bought
        twice.</p>
      </div>
      <div class="pf-build">
        <label>Add a fund
          <input id="pf-lookup" type="search" placeholder="Type a scheme name" autocomplete="off">
          <div id="pf-suggest" class="suggest" hidden></div>
        </label>
        <div id="pf-list" class="pf-list"></div>
        <button id="pf-run" class="primary">Look through</button>
      </div>
      <div id="pf-out"></div>
    </section>`;

  const picked = new Map();
  const redraw = () => {
    $('#pf-list').innerHTML = [...picked.entries()].map(([k, v]) => `
      <div class="pf-row">
        <span>${esc(v.name)}</span>
        <input type="number" min="0" step="1" value="${v.weight}" data-k="${esc(k)}">
        <span class="muted">%</span>
        <button data-del="${esc(k)}" aria-label="Remove">×</button>
      </div>`).join('') || '<p class="muted">Nothing added yet.</p>';
    $('#pf-list').querySelectorAll('input').forEach((i) =>
      i.onchange = () => { picked.get(i.dataset.k).weight = Number(i.value) || 0; });
    $('#pf-list').querySelectorAll('[data-del]').forEach((b) =>
      b.onclick = () => { picked.delete(b.dataset.del); redraw(); });
  };
  redraw();

  const input = $('#pf-lookup'), box = $('#pf-suggest');
  input.oninput = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { box.hidden = true; return; }
    const data = await get('/funds?limit=10&hasHoldings=1&q=' + encodeURIComponent(q));
    box.innerHTML = data.funds.map((f) => `
      <div class="opt" data-k="${esc(f.key)}" data-n="${esc(f.name)}">
        <span>${esc(f.name)}</span><span class="muted">${esc(f.category)}</span></div>`).join('');
    box.hidden = !data.funds.length;
    box.querySelectorAll('.opt').forEach((el) => el.onclick = () => {
      picked.set(el.dataset.k, { name: el.dataset.n, weight: 10 });
      box.hidden = true; input.value = ''; redraw();
    });
  }, 200);

  $('#pf-run').onclick = async () => {
    const weights = {};
    picked.forEach((v, k) => { if (v.weight > 0) weights[k] = v.weight; });
    if (!Object.keys(weights).length) return;
    const out = $('#pf-out');
    out.innerHTML = '<div class="loading">Looking through…</div>';
    const r = await fetch(API + '/portfolio', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weights }),
    }).then((x) => x.json());
    renderLookThrough(out, r);
  };
}

function renderLookThrough(host, r) {
  host.innerHTML = `
    <div class="stats">
      <div class="stat"><span class="k">Schemes</span><span class="v">${r.funds.length}</span></div>
      <div class="stat"><span class="k">Distinct stocks</span><span class="v">${r.distinctStocks}</span></div>
      <div class="stat"><span class="k">Top 10 weight</span><span class="v">${num(r.topTen, 1)}%</span></div>
      <div class="stat"><span class="k">Heaviest overlap</span><span class="v">${
        r.pairs.length ? num(r.pairs[0].overlap, 0) + '%' : '—'}</span></div>
    </div>
    ${r.notes.length ? `<ul class="notes">${r.notes.map((n) =>
      `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <div class="two">
      <div class="panel"><h4>Combined top holdings</h4><div id="lt-stocks" class="chart-host"></div></div>
      <div class="panel"><h4>Sector exposure</h4><div id="lt-sectors" class="chart-host"></div></div>
    </div>
    <h4>Pairwise overlap</h4>
    <table class="grid dense">
      <thead><tr><th>Fund</th><th>Fund</th><th class="r">Overlap</th></tr></thead>
      <tbody>${r.pairs.map((p) => `<tr><td>${esc(p.aName)}</td><td>${esc(p.bName)}</td>
        <td class="r mono">${num(p.overlap, 0)}%</td></tr>`).join('')}</tbody>
    </table>`;
  Chart.bars($('#lt-stocks'), r.stocks.slice(0, 15).map((s) =>
    ({ label: s.name, value: s.weight })),
    { suffix: '%', decimals: 2, colorFor: (x) => Chart.seqColor(x.value / 6) });
  Chart.bars($('#lt-sectors'), r.sectors.slice(0, 12).map((s) =>
    ({ label: s.sector, value: s.weight })),
    { suffix: '%', decimals: 1, colorFor: (x) => Chart.seqColor(x.value / 35) });
}

/* ------------------------------------------------------------------- boot */

async function render() {
  const host = $('#main');
  host.innerHTML = '<div class="loading">Loading…</div>';
  try {
    if (state.view === 'approach') renderApproach(host);
    else if (state.view === 'shortlist') await renderShortlists(host);
    else if (state.view === 'all') await renderAll(host);
    else await renderPortfolio(host);
  } catch (e) {
    host.innerHTML = `<div class="error"><strong>Could not load.</strong>
      <span>${esc(e.message)}</span></div>`;
  }
}

(async function boot() {
  applyMode();
  $('#viewtoggle').querySelectorAll('button').forEach((b) =>
    b.onclick = () => {
      state.mode = b.dataset.mode;
      applyMode();
      render();          // the two modes render different content, not just CSS
    });
  $('#tabs').querySelectorAll('button').forEach((b) =>
    b.onclick = () => setView(b.dataset.view));
  try {
    [state.fw, state.meta] = await Promise.all([get('/framework'), get('/meta')]);
    state.gloss = state.fw.glossary || {};
    const m = state.meta;
    $('#buildmeta').innerHTML = `${m.inScope} schemes in scope · ${m.withHoldings} with a
      disclosed book`;
    render();
  } catch (e) {
    $('#main').innerHTML = `<div class="error"><strong>Backend unavailable.</strong>
      <span>${esc(e.message)}</span></div>`;
  }
})();
