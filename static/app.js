/* Mutual Fund Screener.
 *
 * Four views: the methodology page, the per-category shortlists, the full table
 * with a fund detail card, and a side by side comparison.
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
                category: null, returnView: null, gloss: {} };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 1) =>
  (v === null || v === undefined || Number.isNaN(v)) ? '—' : Number(v).toLocaleString('en-IN',
    { minimumFractionDigits: d, maximumFractionDigits: d });
/* House formatting: 'cr' lowercase, 'INR' rather than a rupee glyph or 'Rs',
   per the template's formatting guidelines. */
const cr = (v) => v == null ? '—'
  : (v >= 100000 ? `INR ${num(v / 100000, 2)} lakh cr` : `INR ${num(v, 0)} cr`);
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

/* Three bands: the funnel from the feed to the shortlist, the six factors, and
   the weighting behind the composite. Each factor opens in a modal over the page
   rather than expanding underneath it, so the reader never loses their place,
   and the backdrop or Escape closes it.
 *
 * Figures come from the live universe each request rather than being written
 * into the copy. */

let processStats = null;

async function renderApproach(host) {
  const fw = state.fw;
  if (!processStats) processStats = await get('/process');

  host.innerHTML = `
    <section>
      <div class="section-head">
        <h2>Fund selection process: mutual funds</h2>
      </div>
      <div class="stairs" id="stairs"></div>
    </section>`;

  drawStairs();
  wireGlossary(host);
}

/* The staircase. One tread per factor, each a step higher than the last, with
   its heading and description standing above it on a dropped leader.

   The reference art was an isometric block per step in four brand colours. The
   house palette has one accent, so the rise is carried by the sequential ramp
   from pale blue up into brand red, which also marks where the basic
   requirements end and the performance drivers begin. */
const FACTOR_INK = ['var(--seq-200)', 'var(--seq-300)', 'var(--seq-450)',
                    'var(--seq-550)', 'var(--serious)', 'var(--red)'];
/* The isometric side and top faces, darkened and lightened off each tread. */
const FACTOR_SIDE = ['#9fc4e2', '#7593ab', '#5a6774', '#3c4653', '#d98486',
                     '#a11313'];

function drawStairs() {
  const host = $('#stairs');
  if (!host) return;
  const nodes = state.fw.selectionNodes;
  const ns = 'http://www.w3.org/2000/svg';
  const mk = (t, a, txt) => { const e = document.createElementNS(ns, t);
    Object.entries(a).forEach(([k, v]) => e.setAttribute(k, v));
    if (txt != null) e.textContent = txt; return e; };

  const n = nodes.length;
  const W = 1240, H = 470;
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart stairs-svg',
                          role: 'img', 'aria-label': 'The six factors, in order' });

  const padL = 10, padR = 6;
  const tread = (W - padL - padR) / (n + 0.42);   // room for the last step's depth
  const depth = tread * 0.26;                     // isometric offset
  const rise = 40;                                // how much each step climbs
  const slab = 24;                                // thickness of a tread
  const baseY = H - 34;                           // front-top edge of the first step
  const capH = 104;                               // caption box

  nodes.forEach((node, i) => {
    const x = padL + i * tread;
    const y = baseY - i * rise;
    const g = mk('g', { class: 'step', tabindex: 0, role: 'button',
                        'aria-label': node.name });

    // top face, then front and right side, so the tread reads as a solid block
    g.appendChild(mk('path', {
      d: `M${x},${y} L${x + tread},${y} L${x + tread + depth},${y - depth} `
         + `L${x + depth},${y - depth} Z`, fill: FACTOR_INK[i],
    }));
    g.appendChild(mk('rect', { x, y, width: tread, height: slab,
                               fill: FACTOR_SIDE[i] }));
    g.appendChild(mk('path', {
      d: `M${x + tread},${y} L${x + tread + depth},${y - depth} `
         + `L${x + tread + depth},${y - depth + slab} L${x + tread},${y + slab} Z`,
      fill: FACTOR_SIDE[i], 'fill-opacity': 0.7,
    }));

    /* The caption climbs far more slowly than the tread beneath it, so the lower
       a step is the further its text stands above it and the longer its leader
       runs. Tracking the step exactly put the first caption down at the foot of
       the diagram with a stub of a leader; this keeps the row of headings close
       to level while still rising left to right. */
    /* Every caption shares one top edge, so the six headings read as a row
       rather than a ragged stagger. The leader then does the work of tying each
       one to its own tread: the lower the step, the longer its leader runs. The
       edge is measured off the highest tread, which is the only one the text
       could otherwise land on. */
    const lx = x + depth + 10;
    const topY = baseY - (n - 1) * rise;          // the highest tread
    const capBottom = topY - depth - 20;
    g.appendChild(mk('line', { x1: lx, y1: y - depth - 4, x2: lx, y2: capBottom + 4,
                               stroke: FACTOR_INK[i], 'stroke-width': 1.5,
                               'stroke-dasharray': '3 3' }));
    g.appendChild(mk('circle', { cx: lx, cy: y - depth - 4, r: 3.5,
                                 fill: FACTOR_INK[i] }));

    const fo = mk('foreignObject', { x: lx - 4, y: capBottom - capH,
                                     width: tread - 6, height: capH });
    const div = document.createElement('div');
    div.className = 'stepcap';
    div.innerHTML = `<b>${esc(node.name)}</b><span>${
      (node.points || []).slice(0, 2).map(esc).join('. ')}.</span>`;
    fo.appendChild(div);
    g.appendChild(fo);

    Chart.hoverable(g, `<strong>${esc(node.name)}</strong>
      <div class="tt-note">Click to open</div>`);
    g.onclick = () => openNodeModal(node.code);
    g.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); openNodeModal(node.code); } };
    svg.appendChild(g);
  });

  host.innerHTML = '';
  host.appendChild(svg);
}

/* ------------------------------------------------------------------ modal */

/* One modal for the whole app. The backdrop and Escape both close it, focus
   moves in on open and returns to whatever opened it on close. */
function openModal(html, opener) {
  closeModal();
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1">
      <button class="modal-close" aria-label="Close">&times;</button>
      ${html}
    </div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('modal-open');

  const box = wrap.querySelector('.modal');
  box.focus();
  // A click that starts inside the panel and ends on the backdrop, which is what
  // a text selection drag does, must not count as a click outside.
  let downOnBackdrop = false;
  wrap.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === wrap; });
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap && downOnBackdrop) closeModal();
  });
  wrap.querySelector('.modal-close').onclick = closeModal;
  wrap._opener = opener || null;
  document.addEventListener('keydown', escClose);
  wireGlossary(box);
}

function escClose(e) { if (e.key === 'Escape') closeModal(); }

function closeModal() {
  const wrap = document.querySelector('.modal-backdrop');
  if (!wrap) return;
  const opener = wrap._opener;
  wrap.remove();
  document.body.classList.remove('modal-open');
  document.removeEventListener('keydown', escClose);
  if (opener && opener.focus) opener.focus();
}

function statTable(stat) {
  if (!stat) return '';
  // Not every factor has a number to lead with. An em dash in a 36px slot reads
  // as a broken element, so the headline is dropped and the caption carries it.
  const hasNumber = stat.headline && stat.headline !== '\u2014';
  return `
    <div class="np-live">
      ${hasNumber ? `<div class="np-headline">${esc(stat.headline)}</div>` : ''}
      <div class="np-caption${hasNumber ? '' : ' lead'}">${esc(stat.caption || '')}</div>
      <table class="grid dense kv">
        <tbody>${(stat.rows || []).map(([k, v]) => `
          <tr><td class="np-k">${esc(k)}</td>
            <td class="r mono np-v">${esc(String(v))}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function openNodeModal(code) {
  const n = state.fw.selectionNodes.find((x) => x.code === code);
  if (!n) return;
  const stat = (processStats || {})[n.stat];
  const blocks = (n.blocks || []).map((c) =>
    state.fw.blocks.find((b) => b.code === c)).filter(Boolean);

  openModal(`
    <div class="np-head">
      <span class="np-n">${n.n}</span>
      <h3>${esc(n.name)}</h3>
    </div>
    <p class="np-means">${esc(n.means)}</p>
    <div class="np-grid">
      <div class="np-col">
        <h5>What it covers</h5>
        <ul class="ticks">${n.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
        ${blocks.length ? `
          <h5 class="analyst-only" style="margin-top:14px">Where it lands in the score</h5>
          <div class="np-blocks analyst-only">${blocks.map((b) => `
            <span class="chip">${esc(b.name)} <em>${b.weight}%</em></span>`).join('')}
            <span class="np-total">${blocks.reduce((s, b) => s + b.weight, 0)}% of the
            composite</span></div>` : ''}
      </div>
      <div class="np-col">
        <h5>The universe today</h5>
        ${statTable(stat)}
      </div>
    </div>`, document.activeElement);
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

/* A tile per category. Clicking one opens its shortlist below, and clicking a
   fund in that shortlist opens the full card in place, so category, shortlist
   and fund all sit on one page rather than a tab apart. */

let catData = null;

async function renderShortlists(host) {
  host.innerHTML = '<div class="loading">Building shortlists…</div>';
  if (!catData) catData = await get('/shortlists');

  const openCat = state.category
    || (catData.categories[0] && catData.categories[0].category);

  host.innerHTML = `
    <section>
      <div class="section-head">
        <h2>Category top funds</h2>
        <p class="lede">Pick a category to see its shortlist. Click a fund for the
        full view.</p>
      </div>
      <div class="tiles">
        ${catData.categories.map((c) => `
          <button class="tile${c.category === openCat ? ' on' : ''}"
                  data-cat="${esc(c.category)}" aria-pressed="${c.category === openCat}">
            <span class="tile-open">&rsaquo;</span>
            <h3>${esc(c.category)}</h3>
          </button>`).join('')}
      </div>
      <div id="catpanel" class="catpanel"></div>
    </section>`;

  host.querySelectorAll('.tile').forEach((el) => el.onclick = () => {
    state.category = el.dataset.cat;
    state.fund = null;
    renderShortlists(host);
  });
  drawCategoryPanel(openCat);
  wireGlossary(host);
}

function drawCategoryPanel(category) {
  const c = catData.categories.find((x) => x.category === category);
  const panel = $('#catpanel');
  if (!c) { panel.innerHTML = ''; return; }
  panel.innerHTML = `
    <div class="catpanel-head">
      <h3>${esc(c.category)}</h3>
      <span class="muted">top ${c.funds.length} of ${c.count} schemes</span>
    </div>
    ${c.caveat ? `<div class="caveat">${esc(c.caveat)}</div>` : ''}
    <div class="tablewrap">
      <table class="grid dense">
        <thead>
          <tr>
            <th rowspan="2">Fund</th>
            <th class="r grouped" colspan="5">Returns</th>
            <th class="r grouped" colspan="2">${term('Median rolling return')}</th>
            <th class="r" rowspan="2">${term('AUM')}</th>
            <th rowspan="2">Fund manager</th>
          </tr>
          <tr>
            <th class="r sub2">3M</th><th class="r sub2">6M</th>
            <th class="r sub2">1Y</th><th class="r sub2">3Y</th>
            <th class="r sub2">5Y</th>
            <th class="r sub2">3Y</th><th class="r sub2">5Y</th>
          </tr>
        </thead>
        <tbody>${c.funds.map((f) => `
          <tr>
            <td class="fundcell">
              <button class="fundlink" data-fund="${esc(f.key)}">${esc(f.name)}</button>
              <span class="muted sm">${esc(f.amc || '')}</span>
            </td>
            <td class="r mono">${num(f.return3M, 1)}</td>
            <td class="r mono">${num(f.return6M, 1)}</td>
            <td class="r mono">${num(f.return1Y, 1)}</td>
            <td class="r mono">${num(f.return3Y, 1)}</td>
            <td class="r mono">${num(f.return5Y, 1)}</td>
            <td class="r mono roll">${num(f.medianRolling3Y, 1)}</td>
            <td class="r mono roll">${num(f.medianRolling5Y, 1)}</td>
            <td class="r mono">${cr(f.aumCr)}</td>
            <td class="mgr">${esc(f.fundManager || '—')}</td>
          </tr>`).join('') || '<tr><td colspan="10" class="muted">No scored funds in this category.</td></tr>'}
        </tbody>
        ${c.benchmark ? `<tfoot>
          <tr class="bmrow">
            <td class="fundcell">
              <span class="bmname">${esc(c.benchmark.name)}</span>
              <span class="muted sm">${c.benchmark.kind === 'index'
                ? 'closest available index' : 'category benchmark'}</span>
            </td>
            <td class="r mono">${num(c.benchmark.return3M, 1)}</td>
            <td class="r mono">${num(c.benchmark.return6M, 1)}</td>
            <td class="r mono">${num(c.benchmark.return1Y, 1)}</td>
            <td class="r mono">${num(c.benchmark.return3Y, 1)}</td>
            <td class="r mono">${num(c.benchmark.return5Y, 1)}</td>
            <td class="r mono roll">—</td>
            <td class="r mono roll">—</td>
            <td class="r mono">—</td>
            <td class="mgr">—</td>
          </tr>
        </tfoot>` : ''}
      </table>
    </div>
    <p class="muted sm">Returns are point to point and annualised beyond one year.
    Rolling figures are the median of every window of that length in the fund's
    life. Click a fund for the full view.</p>`;
  panel.querySelectorAll('[data-fund]').forEach((el) =>
    el.onclick = () => openFund(el.dataset.fund));
  wireGlossary(panel);
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

/* Only categories with funds in them. The framework defines eleven; the current
   feed carries no Dividend Yield scheme at all, and a filter option that can
   never return a row is a dead end rather than a choice. */
function liveCategories() {
  return (state.meta.categories || [])
    .filter((c) => c.count > 0).map((c) => c.name);
}

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
          <select id="f-cat">${['All', ...liveCategories()].map((c) =>
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

/* A fund is a page of its own, not a panel inside a list. Opening one records
   where the reader came from so the way back lands them on the same category or
   the same filtered table rather than at the top of the app. */
function openFund(key) {
  state.fund = key;
  if (state.view !== 'fund') state.returnView = state.view;
  state.view = 'fund';
  $('#tabs').querySelectorAll('button').forEach((b) => b.classList.remove('on'));
  render();
  window.scrollTo({ top: 0 });
}

const VIEW_LABEL = { shortlist: 'category top funds', all: 'all funds',
                     compare: 'compare', approach: 'how we look at funds' };

/* The fund page is a one page snapshot: a card per question, each showing the
   headline and nothing more. The detail behind every card is a click away in a
   modal, so the page stays readable at a glance and nothing is buried. */

let fundRec = null;

async function renderFundPage(host) {
  host.innerHTML = '<div class="loading">Scoring…</div>';
  const f = await get('/fund/' + encodeURIComponent(state.fund));
  fundRec = f;
  const analyst = isAnalyst();
  const back = state.returnView || 'shortlist';
  const bm = f.benchmark || {};
  const mgrs = f.managers || [];
  const lead = mgrs.reduce((a, m) =>
    (m.tenureYears || 0) > (a?.tenureYears || 0) ? m : a, null);

  host.innerHTML = `
    <button class="backlink" id="fund-back">&lsaquo; Back to ${
      esc(VIEW_LABEL[back] || 'the list')}</button>

    <div class="fundhead">
      <div>
        <h2>${esc(f.name)}</h2>
        <p class="muted">${esc(f.category)} · ${esc(f.amc || '')}</p>
      </div>
      ${analyst ? `<div class="fundhead-score">
        ${bandPill(f.band)}
        <span class="big">${num(f.composite, 1)}</span>
        <span class="muted sm">${f.categoryRank
          ? `rank ${f.categoryRank} of ${f.categoryCount}` : 'unranked'}</span>
      </div>` : ''}
    </div>

    <div class="snapshot">
      <section class="snapcard chartcard">
        <span class="snapcard-head">
          <span class="snapcard-title">Growth of 100 rupees</span>
          <span class="snapcard-sub" id="growth-sub">daily NAV, rebased to zero
            at the start of the window</span>
          <button class="chart-more" data-card="done">Every period &rsaquo;</button>
        </span>
        <div class="periodbar" id="periodbar" role="group"
             aria-label="Chart period"></div>
        <div id="c-growth"></div>
        <p class="cardnote muted sm" id="growth-note"></p>
      </section>

      ${card('holds', 'What it holds', `${f.holdingCount || 0} names`,
             '<div id="c-caps"></div>' +
             `<div class="cardfoot">
                <span>${term('Top 10 weight')}</span><b>${num(f.top10, 0)}%</b>
                <span>Largest</span><b>${num(f.largestPosition, 1)}%</b></div>`)}

      ${card('rolling', 'What a holding period gave',
             'median of every window of that length',
             '<div id="c-rolling"></div>')}

      ${card('risk', 'How it behaves in a fall', 'capture against the benchmark at 100',
             '<div id="c-capture"></div>' +
             `<div class="cardfoot"><span>${term('Maximum drawdown')}</span>
                <b>${num(f.maxDrawdown3Y, 1)}%</b></div>`)}

      ${card('who', 'Who runs it', mgrs.length === 1 ? 'one manager'
              : `${mgrs.length} managers`,
             `<div class="bigstat name">
                <span class="v">${esc(lead ? lead.name : 'Not on file')}</span>
                <span class="k">${lead && lead.tenureYears != null
                  ? num(lead.tenureYears, 1) + ' yrs on this scheme'
                  : 'tenure not stated'}</span>
              </div>
              <div class="cardfoot">
                <span>${term('Market cycles run')}</span>
                  <b>${num(f.managerCycles, 0)}</b>
                ${mgrs.length > 1 ? `<span>and ${mgrs.length - 1} more</span>` : ''}</div>`)}

      ${card('ratios', 'Return per unit of risk', 'three years, against category peers',
             `<div class="ratiogrid">
                <div><span class="k">${term('Sharpe')}</span>
                     <span class="v">${num(f.sharpe3Y, 2)}</span></div>
                <div><span class="k">${term('Sortino')}</span>
                     <span class="v">${num(f.sortino3Y, 2)}</span></div>
                <div><span class="k">${term('Information ratio')}</span>
                     <span class="v">${num(f.informationRatio3Y, 2)}</span></div>
                <div><span class="k">${term('Beta')}</span>
                     <span class="v">${num(f.beta3Y, 2)}</span></div>
              </div>`)}

      ${card('size', 'Size and cost', esc(f.vintageBasis || ''),
             `<div class="bigstat label-first">
                <span class="k">${term('AUM')}</span>
                <span class="v">${cr(f.aumCr)}</span>
              </div>
              <div class="cardfoot">
                <span>${term('Net flow over 1Y')}</span>
                  <b>${f.netFlow1YPct == null ? '—'
                       : (f.netFlow1YPct > 0 ? '+' : '') + num(f.netFlow1YPct, 0) + '%'}</b>
                <span>${term('Expense ratio')}</span>
                  <b>${f.ter == null ? '—' : num(f.ter, 2) + '%'}</b></div>`)}

      ${analyst ? card('score', 'The score', 'seven blocks, weighted',
             '<div id="c-blocks"></div>') : ''}
    </div>

    ${analyst && f.flags.length ? `<div class="flagrow">${f.flags.map((x) => `
      <div class="flagcard ${esc(x.tone)}"><strong>${esc(x.label)}</strong>
      <span>${esc(x.why)}</span></div>`).join('')}</div>` : ''}`;

  // --- the visuals -------------------------------------------------------
  Chart.bars($('#c-rolling'),
    [['1Y', 'medianRolling1Y'], ['3Y', 'medianRolling3Y'], ['5Y', 'medianRolling5Y'],
     ['7Y', 'medianRolling7Y'], ['10Y', 'medianRolling10Y']]
      .map(([lab, k]) => ({ label: lab, value: f[k] })),
    { suffix: '%', decimals: 1, colorFor: () => 'var(--seq-550)' });

  Chart.bars($('#c-capture'), [
    { label: 'Upside', value: f.upsideCapture3Y || 0 },
    { label: 'Downside', value: f.downsideCapture3Y || 0 },
  ], { suffix: '', decimals: 0, max: Math.max(100, f.upsideCapture3Y || 0,
       f.downsideCapture3Y || 0),
       colorFor: (x) => x.label === 'Downside' ? 'var(--serious)' : 'var(--seq-550)' });

  /* The feed's allocation, not the holdings-derived cap mix. Both exist and they
     are on different denominators: capMix is a share of the equity sleeve and
     sums to less than 100, while these four are shares of the whole fund and sum
     to exactly 100, which is the only basis on which cash belongs beside them. */
  Chart.bars($('#c-caps'), [
    { label: 'Large cap', value: f.largeCapPct || 0 },
    { label: 'Mid cap', value: f.midCapPct || 0 },
    { label: 'Small cap', value: f.smallCapPct || 0 },
    { label: 'Cash and others', value: f.cashPct || 0, cash: true },
  ], { suffix: '%', decimals: 0, max: 100,
       // Parts of one book, not magnitudes to rank against each other: a
       // sequential ramp made the 3% slice almost invisible while saying nothing
       // the bar length was not already saying.
       colorFor: (x) => x.cash ? 'var(--axis)' : 'var(--seq-450)' });

  if (analyst) Chart.blockBar($('#c-blocks'), f.blocks);

  drawGrowth(f.key, state.growthPeriod || '1y');

  // --- wiring ------------------------------------------------------------
  $('#fund-back').onclick = () => { state.fund = null; setView(back); };
  host.querySelectorAll('[data-card]').forEach((el) =>
    el.onclick = (e) => {
      if (e.target.closest('.term')) return;   // a glossary hover is not a click
      openCardModal(el.dataset.card);
    });
  wireGlossary(host);
}

/* The growth chart, its period buttons and the note under it. Kept out of the
   card modal machinery because this card is read in place rather than opened:
   the period buttons and the crosshair are the detail view. */

const PERIOD_LABEL = { '1m': '1M', '3m': '3M', '6m': '6M', ytd: 'YTD',
                       '1y': '1Y', '3y': '3Y', '5y': '5Y', all: 'All' };

async function drawGrowth(key, period) {
  const host = $('#c-growth');
  if (!host) return;
  host.innerHTML = '<div class="loading sm">Reading NAV history…</div>';
  let g;
  try {
    g = await get(`/nav/${encodeURIComponent(key)}?period=${encodeURIComponent(period)}`);
  } catch (e) {
    host.innerHTML = `<div class="empty">Could not load NAV history.</div>`;
    return;
  }
  if (state.fund !== key) return;          // the reader moved on while it loaded
  state.growthPeriod = g.period || period;

  const bar = $('#periodbar');
  if (bar) {
    bar.innerHTML = (g.periods || ['1y']).map((p) =>
      `<button class="pbtn${p === state.growthPeriod ? ' on' : ''}" data-period="${p}"
        aria-pressed="${p === state.growthPeriod}">${PERIOD_LABEL[p] || p}</button>`).join('');
    bar.querySelectorAll('.pbtn').forEach((b) =>
      b.onclick = () => drawGrowth(key, b.dataset.period));
  }

  if (!g.series || !g.series.length) {
    host.innerHTML = `<div class="empty">${esc(g.unavailable || 'No NAV history')}</div>`;
    return;
  }
  Chart.growthLines(host, g.series);

  const sub = $('#growth-sub');
  if (sub) sub.textContent = `${fmtDay(g.start)} to ${fmtDay(g.end)}, `
    + 'daily NAV rebased to zero';
  /* The market line is either the index itself or a scheme tracking it, and the
     two are not read the same way: a price index leaves out the dividends a NAV
     already contains, while a tracking scheme carries its own cost. Whichever is
     on the chart, the note says which. */
  const idx = (g.series || []).find((s) => s.code === 'index');
  const note = $('#growth-note');
  if (note) {
    const caveat = !idx ? ''
      : idx.source === 'benchmark'
        ? `${idx.label} is the category's total return index, so dividends sit `
          + 'inside it exactly as they do inside the fund NAV. It is published '
          + 'monthly, so the line steps by month while the fund moves daily.'
      : idx.source === 'index'
        ? `${idx.label} is a price index, so it excludes dividends while the `
          + 'fund NAV includes them.'
        : `${idx.label} is a scheme tracking the index, so it carries that `
          + 'scheme’s cost and tracking error.';
    note.textContent = [...(g.notes || []), caveat].filter(Boolean).join(' ');
  }
}

function fmtDay(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug',
    'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getFullYear()}`;
}

function card(code, title, sub, body) {
  return `
    <button class="snapcard" data-card="${esc(code)}">
      <span class="snapcard-head">
        <span class="snapcard-title">${esc(title)}</span>
        <span class="snapcard-sub">${sub}</span>
        <span class="snapcard-go" aria-hidden="true">&rsaquo;</span>
      </span>
      <span class="snapcard-body">${body}</span>
    </button>`;
}

/* ---------------------------------------------------- the card modals */

function kvTable(rows) {
  return `<table class="grid dense kv"><tbody>${rows.filter(Boolean).map(([k, v]) => `
    <tr><td>${k}</td><td class="r mono">${v}</td></tr>`).join('')}</tbody></table>`;
}

function openCardModal(code) {
  const f = fundRec;
  if (!f) return;
  const bm = f.benchmark || {};
  const analyst = isAnalyst();
  const head = (t, s) => `<div class="np-head"><h3>${esc(t)}</h3></div>
    ${s ? `<p class="np-means">${s}</p>` : ''}`;

  if (code === 'done') {
    const cy = Object.keys(f).filter((k) => /^returnCY\d\d$/.test(k))
      .sort().reverse().filter((k) => f[k] != null);
    return openModal(head('How it has done',
      `Point to point, annualised beyond one year. Against ${esc(bm.name || 'the benchmark')}` +
      (bm.kind === 'index' ? ', the closest index the feed publishes for this category ' +
       'rather than the category\'s own benchmark.' : '.')) +
      `<div class="np-grid">
        <div class="np-col"><h5>Every period</h5>
          ${kvTable([['3M', num(f.return3M, 2) + '%'], ['6M', num(f.return6M, 2) + '%'],
                     ['1Y', num(f.return1Y, 2) + '%'], ['2Y', num(f.return2Y, 2) + '%'],
                     ['3Y', num(f.return3Y, 2) + '%'], ['5Y', num(f.return5Y, 2) + '%'],
                     ['7Y', num(f.return7Y, 2) + '%'],
                     ['Calendar year to date', num(f.returnCYTD, 2) + '%']])}</div>
        <div class="np-col"><h5>Calendar years</h5>
          ${cy.length ? kvTable(cy.map((k) =>
            ['20' + k.slice(-2), num(f[k], 1) + '%'])) : '<p class="muted">Not published.</p>'}
          ${f.cyBeatPct != null ? `<p class="muted sm">Beat the benchmark in
            ${num(f.cyBeatPct, 0)}% of completed calendar years.</p>` : ''}</div>
      </div>`);
  }

  if (code === 'ratios') {
    return openModal(head('Return per unit of risk',
      'What the return cost in risk, at every horizon the feed publishes. ' +
      'Information Ratio carries the most weight of the three inside the model, ' +
      'because it is return earned per unit of risk taken away from the ' +
      'benchmark, which is the thing an active fee is charged for.') +
      `<div class="np-grid">
        <div class="np-col"><h5>${term('Sharpe')} and ${term('Sortino')}</h5>
          ${kvTable([['Sharpe 3Y', num(f.sharpe3Y, 2)], ['Sharpe 5Y', num(f.sharpe5Y, 2)],
                     ['Sharpe 7Y', num(f.sharpe7Y, 2)], ['Sharpe 10Y', num(f.sharpe10Y, 2)],
                     ['Sortino 3Y', num(f.sortino3Y, 2)], ['Sortino 5Y', num(f.sortino5Y, 2)],
                     ['Sortino 7Y', num(f.sortino7Y, 2)],
                     ['Sortino 10Y', num(f.sortino10Y, 2)]])}</div>
        <div class="np-col"><h5>${term('Information ratio')} and market sensitivity</h5>
          ${kvTable([['Information Ratio 3Y', num(f.informationRatio3Y, 2)],
                     ['Information Ratio 5Y', num(f.informationRatio5Y, 2)],
                     ['Information Ratio 7Y', num(f.informationRatio7Y, 2)],
                     ['Information Ratio 10Y', num(f.informationRatio10Y, 2)],
                     ['Beta 3Y', num(f.beta3Y, 2)],
                     ['Standard deviation 3Y', num(f.stdDev3Y, 2) + '%'],
                     ['Semi standard deviation 3Y', num(f.semiStdDev3Y, 2) + '%'],
                     ['Treynor 3Y', num(f.treynor3Y, 2)]])}
          <p class="muted sm">Standard deviation, semi standard deviation and
          Treynor are shown, not scored: they move almost in lockstep with
          Sortino and downside capture, so scoring them would weight volatility
          several times over.</p></div>
      </div>`);
  }

  if (code === 'rolling') {
    return openModal(head('What a holding period gave',
      'Every window of that length in the fund\'s life, and the middle one. ' +
      'It answers what a typical holding period delivered rather than what one ' +
      'lucky pair of dates did.') +
      `<div class="np-grid">
        <div class="np-col"><h5>Median rolling return</h5>
          ${kvTable([['1Y', num(f.medianRolling1Y, 2) + '%'],
                     ['3Y', num(f.medianRolling3Y, 2) + '%'],
                     ['5Y', num(f.medianRolling5Y, 2) + '%'],
                     ['7Y', num(f.medianRolling7Y, 2) + '%'],
                     ['10Y', num(f.medianRolling10Y, 2) + '%']])}</div>
        <div class="np-col"><h5>Consistency</h5>
          ${kvTable([['Share of 3Y windows beating the benchmark',
                      f.rollingHitRate3Y == null ? '—' : num(f.rollingHitRate3Y, 1) + '%'],
                     ['Windows measured', num(f.rollingWindows3Y, 0)],
                     ['Category decile 3Y', num(f.decile3Y, 0)],
                     ['Category decile 5Y', num(f.decile5Y, 0)]])}</div>
      </div>`);
  }

  if (code === 'risk') {
    const row = (label, base) => [label,
      [3, 5, 7, 10].map((y) => f[base + y + 'Y'] == null ? null
        : `${y}Y ${num(f[base + y + 'Y'], 0)}`).filter(Boolean).join(' · ') || '—'];
    return openModal(head('How it behaves in a fall',
      'Capture is measured against the benchmark at 100. Downside below 100 means ' +
      'it fell less than the market; upside below 100 means it also rose less.') +
      `<div class="np-grid">
        <div class="np-col"><h5>Across every horizon</h5>
          ${kvTable([row('Downside capture', 'downsideCapture'),
                     row('Upside capture', 'upsideCapture'),
                     row('Maximum drawdown', 'maxDrawdown')])}</div>
        <div class="np-col"><h5>Volatility, shown not scored</h5>
          ${kvTable([['Standard deviation 3Y', num(f.stdDev3Y, 2) + '%'],
                     ['Semi standard deviation 3Y', num(f.semiStdDev3Y, 2) + '%'],
                     ['Beta 3Y', num(f.beta3Y, 2)],
                     ['Sortino 3Y', num(f.sortino3Y, 2)],
                     ['Sharpe 3Y', num(f.sharpe3Y, 2)],
                     ['Information Ratio 3Y', num(f.informationRatio3Y, 2)]])}</div>
      </div>`);
  }

  if (code === 'holds') {
    return openModal(head('What it holds',
      esc(f.mandate?.note || '') + ' Cash sits outside the equity book, so ' +
      'concentration is read on the money at work.') +
      `<div class="np-grid">
        <div class="np-col"><h5>Top holdings</h5>
          ${kvTable((f.holdings || []).map((h) =>
            [esc(h.name), num(h.weight, 2) + '%']))}</div>
        <div class="np-col"><h5>Allocation, share of the fund</h5>
          ${kvTable([['Large cap', num(f.largeCapPct, 1) + '%'],
                     ['Mid cap', num(f.midCapPct, 1) + '%'],
                     ['Small cap', num(f.smallCapPct, 1) + '%'],
                     ['Cash and others', num(f.cashPct, 1) + '%']])}
          <h5 style="margin-top:14px">Shape of the equity book</h5>
          ${kvTable([['Holdings', num(f.holdingCount, 0)],
                     ['Top 10 weight', num(f.top10, 0) + '%'],
                     ['Largest position', num(f.largestPosition, 2) + '%'],
                     ['Cap mix fit to mandate', num(f.mandateFit, 0) + '%'],
                     ['Overlap with the category book', num(f.categoryOverlap, 0) + '%']])}
          ${(f.topSectors || []).length ? `<h5 style="margin-top:14px">Largest sectors</h5>
            ${kvTable(f.topSectors.map((x) => [esc(x.sector), num(x.weight, 1) + '%']))}` : ''}
        </div>
      </div>`);
  }

  if (code === 'who') {
    return openModal(head('Who runs it',
      'Tenure is time on this scheme, not years in the industry. The manager view ' +
      'takes the longest serving name, because the question is how long this money ' +
      'has been run by the people running it now.') +
      `<table class="grid dense">
        <thead><tr><th>Manager</th><th class="r">Tenure on this scheme</th>
          <th class="r">Industry experience</th><th>Since</th></tr></thead>
        <tbody>${(f.managers || []).map((m) => `
          <tr><td>${esc(m.name)}</td>
            <td class="r mono">${m.tenureYears == null ? '—' : num(m.tenureYears, 1) + ' yrs'}</td>
            <td class="r mono dim">${m.experienceYears == null ? '—'
              : num(m.experienceYears, 0) + ' yrs'}</td>
            <td class="muted">${esc(m.sinceBasis || 'not stated')}</td></tr>`).join('')
          || '<tr><td colspan="4" class="muted">No manager record on file.</td></tr>'}
        </tbody></table>
      <p class="muted sm">Market cycles run: ${num(f.managerCycles, 0)}.
        Live record: ${esc(f.vintageBasis || '—')}.</p>`);
  }

  if (code === 'size') {
    return openModal(head('Size and cost',
      'Size is read against the mandate: what is nimble in one category is ' +
      'sub-scale in another.') +
      `<div class="np-grid">
        <div class="np-col"><h5>Size</h5>
          ${kvTable([['Assets under management', cr(f.aumCr)],
                     ['A year earlier', cr(f.aum1YAgoCr)],
                     ['Net flow over 1Y', f.netFlow1YPct == null ? '—'
                       : num(f.netFlow1YPct, 1) + '%'],
                     ['Live track record', esc(f.vintageBasis || '—')]])}</div>
        <div class="np-col"><h5>Cost</h5>
          ${kvTable([['Expense ratio, direct', f.ter == null ? 'not published'
                       : num(f.ter, 2) + '%'],
                     ['NAV', f.nav == null ? '—' : num(f.nav, 2)],
                     ['NAV date', esc(f.navDate || '—')]])}
          ${analyst ? `<p class="muted sm">${esc(f.aumCurve?.note || '')}</p>` : ''}</div>
      </div>`);
  }

  if (code === 'score') {
    return openModal(head('The score', 'Seven blocks, weighted, every metric ' +
      'percentiled inside this fund\'s own category.') +
      `<table class="grid dense">
        <thead><tr><th>Block</th><th class="r">Weight</th><th class="r">Score</th>
          <th class="r">Category median</th><th class="r">Coverage</th>
          <th class="r">Points on the table</th></tr></thead>
        <tbody>${f.peers.map((p) => {
          const m = f.remark.movers.find((x) => x.block === p.name) || {};
          return `<tr><td>${esc(p.name)}</td><td class="r mono">${p.weight}%</td>
            <td class="r mono"><strong>${p.score == null ? 'not scored'
              : num(p.score, 0)}</strong></td>
            <td class="r mono dim">${p.categoryMedian == null ? '—'
              : num(p.categoryMedian, 0)}</td>
            <td class="r mono dim">${num(p.coverage, 0)}%</td>
            <td class="r mono">${m.available == null ? '—' : num(m.available, 1)}</td>
          </tr>`; }).join('')}
        </tbody></table>
      <p class="muted sm">${esc(f.remark.verdict)}</p>`);
  }
}

/* -------------------------------------------------------------- 4. compare */

/* Several funds on one rebased chart, then the same funds as columns of a table
   the reader turns on a group at a time.
 *
 * The portfolio look-through this replaced answered a different question: what
 * do I own once these are combined. Its endpoints are still there; only the tab
 * is gone.
 *
 * Selection lives on `state` rather than in the DOM, so switching tabs and
 * coming back does not lose the comparison. */

const MAX_CMP_FUNDS = 5;
const MAX_CMP_MARKS = 2;

/* The table's rows, grouped the way the checkboxes group them. `dir` is which
   way is better, used to mark the leading fund in a row; beta has none, because
   a beta of 1.2 is not better or worse than 0.8, it is a different fund. */
const CMP_GROUPS = [
  { id: 'returns', label: 'Returns', note: 'annualised beyond one year', rows: [
    ['3M', 'return3M', '%', 1, 'high'], ['6M', 'return6M', '%', 1, 'high'],
    ['1Y', 'return1Y', '%', 1, 'high'], ['2Y', 'return2Y', '%', 1, 'high'],
    ['3Y', 'return3Y', '%', 1, 'high'], ['5Y', 'return5Y', '%', 1, 'high'],
    ['7Y', 'return7Y', '%', 1, 'high']] },
  { id: 'rolling', label: 'Rolling returns', note: 'median of every window of that length', rows: [
    ['Median rolling 3Y', 'medianRolling3Y', '%', 1, 'high'],
    ['Median rolling 5Y', 'medianRolling5Y', '%', 1, 'high']] },
  { id: 'risk', label: 'Risk metrics', note: 'three years', rows: [
    ['Sharpe', 'sharpe3Y', '', 2, 'high'], ['Sortino', 'sortino3Y', '', 2, 'high'],
    ['Information ratio', 'informationRatio3Y', '', 2, 'high'],
    ['Beta', 'beta3Y', '', 2, null]] },
  { id: 'capture', label: 'Capture ratios', note: 'against the benchmark at 100', rows: [
    ['Upside capture', 'upsideCapture3Y', '', 0, 'high'],
    ['Downside capture', 'downsideCapture3Y', '', 0, 'low']] },
];

function cmpState() {
  if (!state.cmp) {
    state.cmp = { keys: [], marks: [], period: '3y',
                  groups: new Set(CMP_GROUPS.map((g) => g.id)) };
  }
  return state.cmp;
}

const cmpInk = (i) => Chart.COMPARE_INK[i % Chart.COMPARE_INK.length];

async function renderCompare(host) {
  const c = cmpState();
  host.innerHTML = `
    <section>
      <div class="section-head">
        <h2>Compare</h2>
        <p class="lede">Put up to ${MAX_CMP_FUNDS} funds on one chart, against up
        to ${MAX_CMP_MARKS} benchmarks, and read them side by side.</p>
      </div>

      <div class="cmp-pickers">
        <div class="cmp-pick">
          <label class="cmp-lab" for="cmp-lookup">Funds
            <span class="muted">up to ${MAX_CMP_FUNDS}</span></label>
          <div class="cmp-search">
            <input id="cmp-lookup" type="search" autocomplete="off"
                   placeholder="Type a scheme name">
            <div id="cmp-suggest" class="suggest" hidden></div>
          </div>
          <div id="cmp-chips" class="cmp-chips"></div>
        </div>
        <div class="cmp-pick">
          <span class="cmp-lab">Benchmarks
            <span class="muted">up to ${MAX_CMP_MARKS}</span></span>
          <div id="cmp-marks" class="cmp-marks"></div>
        </div>
      </div>

      <div id="cmp-body"></div>
    </section>`;

  const meta = await get('/compare');
  c.available = meta.available || [];
  drawCmpMarks();
  wireCmpSearch();
  drawCmpChips();
  await drawCmpBody();
  wireGlossary(host);
}

function wireCmpSearch() {
  const c = cmpState();
  const input = $('#cmp-lookup'), box = $('#cmp-suggest');
  if (!input) return;
  input.oninput = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { box.hidden = true; return; }
    const data = await get('/funds?limit=10&q=' + encodeURIComponent(q));
    const rows = data.funds.filter((f) => !c.keys.includes(f.key));
    box.innerHTML = rows.map((f) => `
      <div class="opt" data-k="${esc(f.key)}">
        <span>${esc(f.name)}</span><span class="muted">${esc(f.category)}</span></div>`).join('')
      || '<div class="opt muted">Nothing else matches</div>';
    box.hidden = false;
    box.querySelectorAll('.opt[data-k]').forEach((el) => el.onclick = () => {
      if (c.keys.length >= MAX_CMP_FUNDS) return;
      c.keys.push(el.dataset.k);
      box.hidden = true; input.value = '';
      drawCmpChips(); drawCmpBody();
    });
  }, 200);
}

function drawCmpChips() {
  const c = cmpState();
  const host = $('#cmp-chips');
  if (!host) return;
  host.innerHTML = c.keys.map((k, i) => {
    const name = (c.names && c.names[k]) || k;
    return `<span class="cmp-chip"><i style="background:${cmpInk(i)}"></i>
      ${esc(name)}<button data-del="${esc(k)}" aria-label="Remove">&times;</button></span>`;
  }).join('') || '<span class="muted sm">No funds selected yet.</span>';
  host.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
    c.keys = c.keys.filter((k) => k !== b.dataset.del);
    drawCmpChips(); drawCmpBody();
  });
  const input = $('#cmp-lookup');
  if (input) {
    const full = c.keys.length >= MAX_CMP_FUNDS;
    input.disabled = full;
    input.placeholder = full ? `${MAX_CMP_FUNDS} is the maximum, remove one to add another`
                             : 'Type a scheme name';
  }
}

function drawCmpMarks() {
  const c = cmpState();
  const host = $('#cmp-marks');
  if (!host) return;
  host.innerHTML = (c.available || []).map((m) => {
    const on = c.marks.includes(m.id);
    return `<button class="cmp-mark${on ? ' on' : ''}" data-mark="${esc(m.id)}"
      aria-pressed="${on}">${esc(m.label)}</button>`;
  }).join('');
  host.querySelectorAll('[data-mark]').forEach((b) => b.onclick = () => {
    const id = b.dataset.mark;
    if (c.marks.includes(id)) c.marks = c.marks.filter((x) => x !== id);
    else if (c.marks.length < MAX_CMP_MARKS) c.marks.push(id);
    else return;
    drawCmpMarks(); drawCmpBody();
  });
}

async function drawCmpBody() {
  const c = cmpState();
  const host = $('#cmp-body');
  if (!host) return;
  if (!c.keys.length) {
    host.innerHTML = `<div class="cmp-empty">Add a fund above to start a
      comparison.</div>`;
    return;
  }
  host.innerHTML = `
    <section class="snapcard chartcard cmp-chart">
      <span class="snapcard-head">
        <span class="snapcard-title">Growth of 100 rupees</span>
        <span class="snapcard-sub" id="cmp-sub">rebased to zero at the start of
          the window</span>
      </span>
      <div class="periodbar" id="cmp-periods" role="group" aria-label="Chart period"></div>
      <div id="cmp-growth"></div>
      <p class="cardnote muted sm" id="cmp-note"></p>
    </section>

    <div class="cmp-groupbar" id="cmp-groupbar">
      ${CMP_GROUPS.map((g) => `
        <label class="cmp-group"><input type="checkbox" data-group="${g.id}"
          ${c.groups.has(g.id) ? 'checked' : ''}> ${esc(g.label)}</label>`).join('')}
    </div>
    <div class="tablewrap" id="cmp-tablewrap"></div>

    <div id="cmp-overlap"></div>`;

  $('#cmp-groupbar').querySelectorAll('[data-group]').forEach((b) =>
    b.onchange = () => {
      if (b.checked) c.groups.add(b.dataset.group);
      else c.groups.delete(b.dataset.group);
      drawCmpTable();
    });

  await Promise.all([drawCmpGrowth(), drawCmpTable(), drawCmpOverlap()]);
}

async function drawCmpGrowth() {
  const c = cmpState();
  const host = $('#cmp-growth');
  if (!host) return;
  host.innerHTML = '<div class="loading sm">Reading NAV history…</div>';
  const qs = `keys=${c.keys.map(encodeURIComponent).join(',')}`
    + `&marks=${c.marks.map(encodeURIComponent).join(',')}`
    + `&period=${encodeURIComponent(c.period)}`;
  const g = await get('/compare/growth?' + qs);
  c.period = g.period || c.period;

  const bar = $('#cmp-periods');
  if (bar) {
    bar.innerHTML = (g.periods || ['3y']).map((p) =>
      `<button class="pbtn${p === c.period ? ' on' : ''}" data-period="${p}"
        aria-pressed="${p === c.period}">${PERIOD_LABEL[p] || p}</button>`).join('');
    bar.querySelectorAll('.pbtn').forEach((b) => b.onclick = () => {
      c.period = b.dataset.period; drawCmpGrowth();
    });
  }

  if (!g.series || !g.series.length) {
    host.innerHTML = `<div class="empty">${esc(g.unavailable || 'No NAV history')}</div>`;
    return;
  }
  /* Funds take the categorical set in the order they were added, so a fund keeps
     its colour between the chip, the chart and the table. Benchmarks are grey
     and dashed, which reads as the backdrop they are. */
  let fi = 0;
  const series = g.series.map((s) => s.code === 'fund'
    ? { ...s, ink: cmpInk(fi++) }
    : { ...s, ink: Chart.MARK_INK, dash: '5 3', width: 1.5 });
  Chart.growthLines(host, series, { height: 300 });

  c.names = Object.fromEntries(g.series.filter((s) => s.code === 'fund')
    .map((s) => [s.key, s.label]));
  drawCmpChips();

  const sub = $('#cmp-sub');
  if (sub) sub.textContent = `${fmtDay(g.start)} to ${fmtDay(g.end)}, `
    + 'daily NAV rebased to zero';
  const note = $('#cmp-note');
  if (note) {
    note.textContent = (g.notes || []).join(' ')
      || 'Benchmarks are price indices, so they exclude dividends while a fund '
         + 'NAV includes them.';
  }
}

async function drawCmpTable() {
  const c = cmpState();
  const wrap = $('#cmp-tablewrap');
  if (!wrap) return;
  const qs = `keys=${c.keys.map(encodeURIComponent).join(',')}`
    + `&marks=${c.marks.map(encodeURIComponent).join(',')}`;
  const t = await get('/compare?' + qs);

  /* A fund is the subject here, so it gets the row: the eye runs along one
     scheme's record left to right, and down a single metric to rank on it.
     Benchmarks sit underneath the funds, in the same columns. */
  const rows = [
    ...t.funds.map((f, i) => ({ key: f.key, label: f.name, sub: f.category,
                                metrics: f.metrics, ink: cmpInk(i), fund: true })),
    ...t.marks.map((m) => ({ label: m.label,
                             sub: m.metrics ? m.metricsLabel : 'no published metrics',
                             metrics: m.metrics || {}, ink: Chart.MARK_INK })),
  ];
  const priced = rows.some((r) => /price index$/.test(r.sub || ''));
  const groups = CMP_GROUPS.filter((g) => c.groups.has(g.id));
  if (!groups.length) {
    wrap.innerHTML = '<p class="muted sm">Tick a group above to show its metrics.</p>';
    return;
  }
  const cols = groups.flatMap((g) => g.rows);

  // The leader is marked among the funds only: a benchmark is the thing being
  // measured against, not a competitor in the race.
  const best = cols.map(([, field, , , dir]) => {
    if (!dir) return null;
    const vals = rows.filter((r) => r.fund && r.metrics[field] != null)
      .map((r) => r.metrics[field]);
    return vals.length > 1 ? (dir === 'high' ? Math.max(...vals) : Math.min(...vals))
                           : null;
  });

  wrap.innerHTML = `
    <table class="grid dense cmp-table">
      <thead>
        <tr class="cmp-grouphead">
          <th></th>
          ${groups.map((g) => `<th colspan="${g.rows.length}" class="c">
            ${esc(g.label)} <span class="muted sm">${esc(g.note)}</span></th>`).join('')}
        </tr>
        <tr>
          <th class="cmp-namehead">Fund</th>
          ${cols.map(([label]) => `<th class="r">${term(label)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `<tr class="${r.fund ? '' : 'cmp-markrow'}">
          <td class="cmp-name">
            <span class="cmp-colhead"><i style="background:${r.ink}"></i>
              ${esc(r.label)}</span>
            <span class="muted sm">${esc(r.sub || '')}</span></td>
          ${cols.map(([, field, suffix, dp], i) => {
            const v = r.metrics[field];
            return `<td class="r mono${
              best[i] !== null && r.fund && v === best[i] ? ' cmp-best' : ''}">${
              v == null ? '—' : num(v, dp) + suffix}</td>`;
          }).join('')}
        </tr>`).join('')}
      </tbody>
    </table>
    <p class="muted sm">Returns are point to point and annualised beyond one year.
    A bold figure is the best of the funds shown in that column; benchmarks are not
    ranked against them.${priced ? ' A benchmark read off a price index excludes '
      + 'dividends and carries returns only, because risk and capture have to be '
      + 'measured against something.' : ''}</p>`;
  wireGlossary(wrap);
}

/* --------------------------------------------------------------- overlap */

async function drawCmpOverlap() {
  const c = cmpState();
  const host = $('#cmp-overlap');
  if (!host) return;
  const o = await get('/compare/overlap?keys='
    + c.keys.map(encodeURIComponent).join(','));
  const f = o.funds || [];
  if (f.length < 2) {
    host.innerHTML = f.length && (o.missing || []).length
      ? `<p class="muted sm">${esc(o.missing.join(', '))} has no disclosed book,
         so it cannot be read for overlap.</p>`
      : '';
    return;
  }

  /* Columns are numbered rather than named. Five scheme names across a header
     is unreadable at any width, and the number is already in the row label. */
  const cell = (i, j) => {
    const v = o.matrix[i][j];
    if (i === j) return '<td class="ov-self"></td>';
    if (v == null) return '<td class="r mono muted">—</td>';
    return `<td class="r ov-cell${v >= o.heavy ? ' ov-heavy' : ''}">
      <button class="ov-btn mono" data-a="${esc(f[i].key)}" data-b="${esc(f[j].key)}"
        >${num(v, 1)}%</button></td>`;
  };

  host.innerHTML = `
    <section class="snapcard cmp-ovcard">
      <span class="snapcard-head">
        <span class="snapcard-title">How much of the same book</span>
        <span class="snapcard-sub">weight held in common, the smaller of the two
          positions in every stock, summed</span>
      </span>
      <div class="tablewrap">
        <table class="grid dense ov-table">
          <thead><tr><th class="cmp-namehead">Fund</th>
            ${f.map((x, i) => `<th class="r mono">${i + 1}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${f.map((x, i) => `<tr>
              <td class="cmp-name"><span class="cmp-colhead">
                <i style="background:${cmpInk(c.keys.indexOf(x.key))}"></i>
                ${i + 1}. ${esc(x.name)}</span>
                <span class="muted sm">${esc(x.category)} ·
                  ${x.holdingCount || '—'} holdings</span></td>
              ${f.map((y, j) => cell(i, j)).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="cardnote muted sm">Shaded above ${o.heavy} percent, where two
      funds are largely the same holding bought twice. Click a figure for the
      stocks behind it.${(o.missing || []).length
        ? ` ${esc(o.missing.join(', '))} left out for want of a disclosed book.`
        : ''}</p>
    </section>`;

  host.querySelectorAll('.ov-btn').forEach((b) =>
    b.onclick = () => openOverlapPair(b.dataset.a, b.dataset.b, b));
}

async function openOverlapPair(a, b, opener) {
  openModal('<div class="loading">Loading…</div>', opener);
  let d;
  try {
    d = await get(`/overlap/pair?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
  } catch (e) {
    const box = document.querySelector('.modal');
    if (box) box.innerHTML = `<div class="error">${esc(e.message)}</div>`;
    return;
  }
  const box = document.querySelector('.modal');
  if (!box) return;                       // closed while the request was in flight
  box.innerHTML = `
    <button class="modal-close" aria-label="Close">&times;</button>
    <div class="ov-modal">
      <h3>${esc(d.a.name)} and ${esc(d.b.name)}</h3>
      <p class="muted sm">${num(d.overlap, 1)} percent of weight in common across
      ${d.sharedNames} shared ${d.sharedNames === 1 ? 'stock' : 'stocks'},
      out of ${d.a.holdingCount} and ${d.b.holdingCount} holdings. The common
      column is the smaller of the two positions, which is the part that is
      genuinely owned twice.</p>
      <div class="tablewrap ov-modaltable">
        <table class="grid dense">
          <thead><tr>
            <th>Stock</th><th>Sector</th>
            <th class="r">${esc(d.a.name)}</th>
            <th class="r">${esc(d.b.name)}</th>
            <th class="r">Common</th>
          </tr></thead>
          <tbody>
            ${d.shared.map((r) => `<tr>
              <td>${esc(r.name)}</td>
              <td class="muted sm">${esc(r.sector || '—')}</td>
              <td class="r mono">${num(r.a, 2)}%</td>
              <td class="r mono">${num(r.b, 2)}%</td>
              <td class="r mono b">${num(r.common, 2)}%</td>
            </tr>`).join('') || `<tr><td colspan="5" class="muted">
              Nothing held in common.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
  box.querySelector('.modal-close').onclick = closeModal;
}

/* ------------------------------------------------------------------- boot */

async function render() {
  const host = $('#main');
  host.innerHTML = '<div class="loading">Loading…</div>';
  try {
    if (state.view === 'fund') await renderFundPage(host);
    else if (state.view === 'approach') await renderApproach(host);
    else if (state.view === 'shortlist') await renderShortlists(host);
    else if (state.view === 'all') await renderAll(host);
    else await renderCompare(host);
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
