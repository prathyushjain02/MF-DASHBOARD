/* The Filter, a mutual fund screener.
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
// The page opens on the method rather than on a ranked list. A reader who has
// not been told how a fund got to the top of a table has no reason to believe
// the table, and the first tab is where that is answered.
const state = { mode: 'client', plan: 'direct', view: 'approach', fw: null,
                meta: null, fund: null, category: null, returnView: null,
                gloss: {}, picked: [] };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* Formatters are built once per decimal count and kept.
   `toLocaleString` looks cheap and is not: it resolves a locale and builds a
   formatter on every call, and this function runs on nearly every cell of every
   table, every axis label and every figure on every card. Over the five hundred
   row table that was a hundred and forty milliseconds of formatting against
   five with the formatter kept, which was the largest single cost in drawing
   the page. */
const _FMT = new Map();
function numFormatter(d) {
  let f = _FMT.get(d);
  if (!f) {
    f = new Intl.NumberFormat('en-IN',
      { minimumFractionDigits: d, maximumFractionDigits: d });
    _FMT.set(d, f);
  }
  return f;
}
const num = (v, d = 1) =>
  (v === null || v === undefined || Number.isNaN(v)) ? '—'
    : numFormatter(d).format(Number(v));
/* House formatting: 'cr' lowercase, 'INR' rather than a rupee glyph or 'Rs',
   per the template's formatting guidelines. */
const cr = (v) => v == null ? '—'
  : (v >= 100000 ? `INR ${num(v / 100000, 2)} lakh cr` : `INR ${num(v, 0)} cr`);
/* The analyst view is switched off at the front door rather than taken out.
   Everything it draws, every block score, every rank, every piece of the
   methodology page, is still here and still correct; the toggle that reached it
   is gone, so nothing renders it and nothing asks the server for it. Flip this
   to read `state.mode === 'analyst'` and put the buttons back to have it
   again. */
const ANALYST_ENABLED = false;
const isAnalyst = () => ANALYST_ENABLED && state.mode === 'analyst';

/* The horizons every point to point return is shown over, everywhere, as label
   and field pairs. They come from the framework so there is one list rather than
   one per table: six lists drift, and the same fund read on three pages then
   answers three different questions without saying which. Pairs rather than
   labels because year to date is `returnCYTD` in the feed, and that exception
   belongs on the model's side. The literal is the fallback for the moment before
   the framework has loaded. */
const RETURN_FALLBACK = ['1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y'].map((h) =>
  ({ label: h, field: h === 'YTD' ? 'returnCYTD' : 'return' + h }));
const RETURN_COLUMNS = () =>
  (state.fw && state.fw.returnColumns) || RETURN_FALLBACK;

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

/* A term with its meaning attached. The dotted underline is the affordance.
   An entry is a short list of points, carried through the attribute joined on a
   pipe: no entry contains one, and the build checks that. */
function term(label, extra, key) {
  const meaning = glossFor(key || label) || [];
  const points = [...meaning, ...(extra ? [extra] : [])];
  if (!points.length) return esc(label);
  return `<span class="term" data-gloss="${esc(points.join('|'))}"
    tabindex="0">${esc(label)}</span>`;
}

/* Escape first, then turn *stars* into bold. Doing it in that order means a
   glossary entry can emphasise a phrase without being able to inject markup. */
function glossHtml(text) {
  return esc(text).replace(/\*([^*]+)\*/g, '<b>$1</b>');
}

function wireGlossary(root) {
  root.querySelectorAll('[data-gloss]').forEach((el) => {
    const html = `<strong>${esc(el.textContent.trim())}</strong>
      <ul class="tt-note">${el.dataset.gloss.split('|')
        .map((p) => `<li>${glossHtml(p)}</li>`).join('')}</ul>`;
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
  // Still stamped, because it is what hides the analyst-only cells in CSS.
  document.body.dataset.mode = isAnalyst() ? 'analyst' : 'client';
}

/* Direct or regular, which is a real distinction and not a presentation one: the
   two plans of a scheme are different products with different expense ratios and
   therefore different returns, and the feed carries one of them. The toggle is
   here and does nothing until the other plan's figures arrive. Saying so on the
   button is better than a switch that silently shows the same numbers twice. */
function applyPlan() {
  const bar = $('#plantoggle');
  if (!bar) return;
  bar.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.plan === state.plan;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.disabled = b.dataset.plan !== 'direct';
    b.title = b.dataset.plan === 'direct'
      ? 'Direct plan figures, which is what the feed carries'
      : 'Regular plan figures are not in the feed yet';
  });
}

function setView(v) {
  state.view = v;
  $('#tabs').querySelectorAll('button').forEach((b) =>
    b.classList.toggle('on', b.dataset.view === v));
  render();
}

/* ------------------------------------------------------------- selection */

/* Funds are ticked where they are found and carried to the compare tab, so the
   reader can build a comparison out of two different lists without writing any
   names down. The order they were ticked in is kept, because it decides the
   colour each one takes on the chart. */
const isPicked = (k) => state.picked.includes(k);

function togglePick(key) {
  state.picked = isPicked(key)
    ? state.picked.filter((k) => k !== key)
    : [...state.picked, key];
  drawPickbar();
  const on = isPicked(key);
  document.querySelectorAll(`[data-pick="${CSS.escape(key)}"]`)
    .forEach((b) => { b.checked = on; });
  // The fund page's own control is the same selection wearing a button, so it
  // follows the same state rather than keeping a second copy of it.
  document.querySelectorAll(`[data-picklabel="${CSS.escape(key)}"]`)
    .forEach((el) => paintPickButton(el, on));
}

function paintPickButton(el, on) {
  el.classList.toggle('picked', on);
  el.innerHTML = on ? '&check; Selected' : 'Select this fund';
  el.title = on ? 'Click again to take it out of the selection'
                : 'Adds it to the selection at the foot of the page';
}

function pickBox(key) {
  return `<input type="checkbox" class="pickbox" data-pick="${esc(key)}"
    ${isPicked(key) ? 'checked' : ''} aria-label="Select for comparison">`;
}

/* One handler on the table rather than one per row, so a redraw cannot leave
   half the boxes wired. The click is stopped before it reaches the row, which
   would otherwise open the fund.

   Wired once per element, because the tables that call this redraw their rows
   into a wrapper that survives: a second listener on the same wrapper toggled
   every tick twice and a third toggled it three times, so ticking a fund in All
   funds silently stopped working after the first filter or sort. */
function wirePicks(root) {
  if (root.dataset.picksWired) return;
  root.dataset.picksWired = '1';
  root.addEventListener('click', (e) => {
    const box = e.target.closest('[data-pick]');
    if (!box) return;
    e.stopPropagation();
    togglePick(box.dataset.pick);
  });
}

function drawPickbar() {
  let bar = $('#pickbar');
  // Not on the compare tab: the selection has arrived, the chips are the record
  // of it now, and a bar floating over the chart is in the way.
  if (!state.picked.length || state.view === 'compare'
      || state.view === 'portfolio') {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'pickbar';
    document.body.appendChild(bar);
  }
  const n = state.picked.length;
  bar.innerHTML = `
    <span class="pickbar-n"><b>${n}</b> ${n === 1 ? 'fund' : 'funds'} selected</span>
    <button class="pickbar-go" id="pick-compare">Compare</button>
    <button class="pickbar-go" id="pick-portfolio">Build portfolio</button>
    <button class="pickbar-clear" id="pick-clear">Clear</button>`;
  /* Two destinations, because the same tick answers two questions: read these
     side by side, or hold them together.

     They add to what is already on that tab rather than replacing it. A reader
     who sends two funds to compare, then reads a third and sends that, means
     three: replacing meant the second trip quietly threw the first away. */
  $('#pick-compare').onclick = () => {
    const b = builder('compare');
    b.keys = [...new Set([...b.keys, ...state.picked])];
    setView('compare');
  };
  $('#pick-portfolio').onclick = (e) =>
    buildPortfolio(e.currentTarget, [...state.picked], true);
  $('#pick-clear').onclick = () => {
    state.picked = [];
    drawPickbar();
    document.querySelectorAll('[data-pick]').forEach((b) => { b.checked = false; });
  };
}

/* Building a portfolio out of a set of ticks asks for the weights first and
   opens the tab after, because the allocation is the thing being decided and
   the page behind it is only the result. Names are fetched before the form
   rather than after, so the lines are labelled with schemes and not with keys.
   Closing the form without creating leaves the reader where they were: the tick
   selection is untouched and nothing has been built. */
async function buildPortfolio(opener, keys, append) {
  keys = keys || [...state.picked];
  if (!keys.length) return;
  const b = builder('portfolio');
  /* From the tick bar the ticks are the selection, so they replace what was
     there. From a fund page the reader is adding one to what they already have,
     so it joins the end rather than wiping it. */
  b.keys = append ? [...new Set([...b.keys, ...keys])] : keys;
  if (!append) b.weights = null;

  let names = {};
  try {
    const meta = await get('/compare?keys=' + b.keys.map(encodeURIComponent).join(','));
    names = Object.fromEntries((meta.funds || []).map((f) => [f.key, f.name]));
  } catch (e) { /* the form falls back to the keys, which is worse but works */ }
  b.names = { ...(b.names || {}), ...names };

  openWeights(opener, {
    create: 'Build portfolio',
    target: b,
    focusKey: append ? keys[0] : null,
    onSave: () => setView('portfolio'),
  });
}

/* A count on the two tabs that hold a selection. Without it, adding from a fund
   page is an action with no visible result anywhere on the screen. */
function drawTabCounts() {
  ['compare', 'portfolio'].forEach((v) => {
    const btn = document.querySelector(`#tabs [data-view="${v}"]`);
    if (!btn) return;
    const n = (state[v === 'portfolio' ? 'pf' : 'cmp'] || {}).keys?.length || 0;
    const old = btn.querySelector('.tabcount');
    if (old) old.remove();
    if (n) btn.insertAdjacentHTML('beforeend',
      ` <span class="tabcount">${n}</span>`);
  });
}

/* ------------------------------------------- 1. how we look at funds */

/* Three bands: the funnel from the feed to the shortlist, the six factors, and
   the weighting behind the composite. Each factor opens in a modal over the page
   rather than expanding underneath it, so the reader never loses their place,
   and the backdrop or Escape closes it.
 *
 * Figures come from the live universe each request rather than being written
 * into the copy. */

/* Kept, unreferenced, for the same reason the analyst view is (5.9): the process
   figures and the table that draws them are correct and one line from being back
   on the page. `/process` still answers. */
let processStats = null;

async function renderApproach(host) {
  const fw = state.fw;

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
  const blocks = (n.blocks || []).map((c) =>
    state.fw.blocks.find((b) => b.code === c)).filter(Boolean);

  /* What the step is and what it covers, and nothing else. The figures that used
     to sit beside it answered a different question: this page is what we look
     for, and how many schemes cleared a bar last night is a fact about the
     universe rather than about the method. It is a tab away in All funds, where
     somebody asking it can also filter it. */
  openModal(`
    <div class="np-head">
      <span class="np-n">${n.n}</span>
      <h3>${esc(n.name)}</h3>
    </div>
    <p class="np-means">${esc(n.means)}</p>
    <h5>What it covers</h5>
    <ul class="ticks">${n.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
    ${blocks.length ? `
      <h5 class="analyst-only" style="margin-top:14px">Where it lands in the score</h5>
      <div class="np-blocks analyst-only">${blocks.map((b) => `
        <span class="chip">${esc(b.name)} <em>${b.weight}%</em></span>`).join('')}
        <span class="np-total">${blocks.reduce((s, b) => s + b.weight, 0)}% of the
        composite</span></div>` : ''}`, document.activeElement);
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

  /* The passive category sits alongside the scored ones but is read a different
     way, so it gets a tile and its own panel rather than a place in a table it
     does not belong in. */
  const tiles = [...catData.categories.map((c) => c.category), PASSIVE_CAT];
  const openCat = state.category || tiles[0];

  host.innerHTML = `
    <section>
      <div class="section-head section-head-split section-head-bare">
        ${openCat === PASSIVE_CAT ? '' : `
          <div id="cat-modes" class="segmented catmodes" role="group"
               aria-label="How to read the category">
            <button data-mode="shortlist" class="${
              state.catMode === 'calendar' ? '' : 'on'}">Category top funds</button>
            <button data-mode="calendar" class="${
              state.catMode === 'calendar' ? 'on' : ''}">Calendar year look through</button>
          </div>`}
      </div>
      <div class="tiles">
        ${tiles.map((c) => `
          <button class="tile${c === openCat ? ' on' : ''}${
            c === PASSIVE_CAT ? ' tile-passive' : ''}"
                  data-cat="${esc(c)}" aria-pressed="${c === openCat}">
            <span class="tile-open">&rsaquo;</span>
            <h3>${esc(c)}</h3>
          </button>`).join('')}
      </div>
      <div id="catpanel" class="catpanel"></div>
    </section>`;

  host.querySelectorAll('.tile').forEach((el) => el.onclick = () => {
    state.category = el.dataset.cat;
    state.fund = null;
    renderShortlists(host);
  });
  const cal = $('#cat-modes');
  if (cal) cal.querySelectorAll('button').forEach((b) => b.onclick = () => {
    state.catMode = b.dataset.mode;
    renderShortlists(host);
  });
  drawCategoryPanel(openCat);
  wireGlossary(host);
}

/* Three names, then a count. A seven manager scheme written out in full is a
   paragraph in a cell and reads as noise rather than as seven people; the three
   longest serving are the ones the question is about, and the rest are on the
   fund's own page. */
function managerCell(f) {
  const names = f.leadManagers || [];
  if (!names.length) return '—';
  const rest = (f.managerCount || names.length) - names.length;
  return esc(names.join(', '))
    + (rest > 0 ? ` <span class="muted">and ${rest} more</span>` : '');
}

async function drawCategoryPanel(category) {
  if (category === PASSIVE_CAT) return drawPassivePanel();
  if (state.catMode === 'calendar') return drawCalendarPanel(category);
  const c = catData.categories.find((x) => x.category === category);
  const panel = $('#catpanel');
  if (!c) { panel.innerHTML = ''; return; }
  const hz = RETURN_COLUMNS();
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
            <th class="pickcell" rowspan="2"></th>
            <th rowspan="2">Fund</th>
            <th class="r grouped" colspan="${hz.length}">Returns</th>
            <th class="r grouped" colspan="2">${term('Median rolling return')}</th>
            <th class="r" rowspan="2">${term('AUM')}</th>
            <th rowspan="2">Fund manager</th>
          </tr>
          <tr>
            ${hz.map((h) => `<th class="r sub2">${esc(h.label)}</th>`).join('')}
            <th class="r sub2">3Y</th><th class="r sub2">5Y</th>
          </tr>
        </thead>
        <tbody>${c.funds.map((f) => `
          <tr>
            <td class="pickcell">${pickBox(f.key)}</td>
            <td class="fundcell">
              <button class="fundlink" data-fund="${esc(f.key)}">${esc(f.name)}</button>
              <span class="muted sm">${esc(f.amc || '')}</span>
            </td>
            ${hz.map((h) => `<td class="r mono">${num(f[h.field], 1)}</td>`).join('')}
            <td class="r mono roll">${num(f.medianRolling3Y, 1)}</td>
            <td class="r mono roll">${num(f.medianRolling5Y, 1)}</td>
            <td class="r mono">${cr(f.aumCr)}</td>
            <td class="mgr">${managerCell(f)}</td>
          </tr>`).join('') || `<tr><td colspan="${hz.length + 6}" class="muted">No scored funds in this category.</td></tr>`}
        </tbody>
        ${c.benchmark ? `<tfoot>
          <tr class="bmrow">
            <td class="pickcell"></td>
            <td class="fundcell">
              <span class="bmname">${esc(c.benchmark.name)}</span>
              <span class="muted sm">${c.benchmark.kind === 'index'
                ? 'closest available index' : 'category benchmark'}</span>
            </td>
            ${hz.map((h) => `<td class="r mono">${
              num(c.benchmark[h.field], 1)}</td>`).join('')}
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
  wirePicks(panel);
  wireGlossary(panel);
}


/* ------------------------------------------------------------ 3. all funds */

/* The bands of columns, each behind a checkbox. A thousand funds against every
   metric the feed publishes is a spreadsheet, and a spreadsheet with every
   column showing is one nobody reads. The reader says which question they are
   asking and the table answers that one.

   `on` is whether the band starts ticked. Returns, rolling and risk are what
   the page is for; the cap breakdown is a second question about the same funds
   and waits to be asked. */
const ALL_GROUPS = [
  { id: 'returns', label: 'Returns', on: true },
  { id: 'rolling', label: 'Rolling returns', on: true },
  { id: 'risk', label: 'Risk metrics', on: true },
  { id: 'capture', label: 'Capture ratios', on: true },
  { id: 'caps', label: 'Market cap breakdown', on: false },
  { id: 'size', label: 'Size and cost', on: true },
];

/* Columns the table can sort on. `field` is what the API sorts by; `dir` is the
   direction that puts "good" first, so one click on any column shows the best of
   it rather than making the reader work out which way is up. `group` is the
   checkbox it hides behind; a column with none is always there. */
const COLUMNS = () => [
  { field: 'categoryRank', label: '#', analyst: true, dir: 'asc', fmt: (f) => f.categoryRank ?? '—' },
  { field: 'name', label: 'Fund', dir: 'asc', text: true },
  { field: 'category', label: 'Category', dir: 'asc', text: true },
  { field: 'band', label: 'Band', analyst: true, dir: 'asc', text: true },
  { field: 'composite', label: 'Composite', analyst: true, dir: 'desc', d: 1 },
  /* Bare horizons: the group they sit in is named on the checkbox above, and
     the rolling columns beside them carry "Rolling" in their own labels, so the
     contrast does the work a repeated word would. The gloss says which kind of
     return these are for anybody who wants it spelled out. */
  ...RETURN_COLUMNS().map((c) => ({ field: c.field, label: c.label,
                                    dir: 'desc', d: 1, group: 'returns',
                                    gloss: 'point to point' })),
  { field: 'medianRolling3Y', label: 'Rolling 3Y', dir: 'desc', d: 1,
    group: 'rolling', gloss: 'median rolling return' },
  { field: 'medianRolling5Y', label: 'Rolling 5Y', dir: 'desc', d: 1,
    group: 'rolling', gloss: 'median rolling return' },
  { field: 'sortino3Y', label: 'Sortino', dir: 'desc', d: 2, group: 'risk' },
  { field: 'informationRatio3Y', label: 'Info ratio', dir: 'desc', d: 2,
    group: 'risk', gloss: 'information ratio' },
  { field: 'maxDrawdown3Y', label: 'Max drawdown', dir: 'desc', d: 1,
    group: 'risk', gloss: 'maximum drawdown' },
  { field: 'downsideCapture3Y', label: 'Down capture', dir: 'asc', d: 0,
    group: 'capture', gloss: 'downside capture' },
  { field: 'upsideCapture3Y', label: 'Up capture', dir: 'desc', d: 0,
    group: 'capture', gloss: 'upside capture' },
  /* Shares of the whole fund, cash included, which is why they add to a hundred
     and why cash is beside them rather than left out. */
  { field: 'largeCapPct', label: 'Large cap', dir: 'desc', d: 0, group: 'caps' },
  { field: 'midCapPct', label: 'Mid cap', dir: 'desc', d: 0, group: 'caps' },
  { field: 'smallCapPct', label: 'Small cap', dir: 'desc', d: 0, group: 'caps' },
  { field: 'cashPct', label: 'Cash', dir: 'desc', d: 0, group: 'caps',
    gloss: 'cash and others' },
  { field: 'ter', label: 'Expense', dir: 'asc', d: 2, group: 'size',
    gloss: 'expense ratio' },
  { field: 'aumCr', label: 'AUM', dir: 'desc', money: true, group: 'size' },
  { field: 'evidence', label: 'Evidence', analyst: true, dir: 'desc', d: 0 },
];

const visibleColumns = () => COLUMNS().filter((c) =>
  (!c.analyst || isAnalyst()) && (!c.group || filters.groups.has(c.group)));

/* Only categories with funds in them. The framework defines eleven; the current
   feed carries no Dividend Yield scheme at all, and a filter option that can
   never return a row is a dead end rather than a choice. */
function liveCategories() {
  return (state.meta.categories || [])
    .filter((c) => c.count > 0).map((c) => c.name);
}

const filters = { category: 'All', band: 'All', amc: 'All', q: '',
                  groups: new Set(ALL_GROUPS.filter((g) => g.on).map((g) => g.id)),
                  minAum: '', maxDownside: '', hasHoldings: false, ratedOnly: false,
                  sort: 'medianRolling3Y', dir: 'desc' };

async function renderAll(host) {
  const amcs = state.meta.amcs || [];
  host.innerHTML = `
    <section>
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
          <select id="f-band">${['All', 'A', 'B', 'C', 'Review', 'Not rated',
                                 'Not scored'].map((c) =>
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
      <div class="cmp-groupbar" id="all-groupbar">
        ${ALL_GROUPS.map((g) => `
          <label class="cmp-group"><input type="checkbox" data-group="${g.id}"
            ${filters.groups.has(g.id) ? 'checked' : ''}> ${esc(g.label)}</label>`).join('')}
      </div>
      <div class="tablemeta" id="tablemeta"></div>
      <div id="tablewrap" class="tablewrap frozen"></div>
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
  /* Turning a band off does not re-sort. The sort is a decision the reader made
     and the meta line above the table still says what it is, so a column leaving
     the view is not a reason to reorder the rows under them. */
  $('#all-groupbar').querySelectorAll('[data-group]').forEach((b) =>
    b.onchange = () => {
      if (b.checked) filters.groups.add(b.dataset.group);
      else filters.groups.delete(b.dataset.group);
      loadTable();
    });
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
  const col = COLUMNS().find((c) => c.field === field);
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
  const cols = visibleColumns();
  const wrap = $('#tablewrap');
  const arrow = (c) => filters.sort === c.field
    ? `<span class="arrow">${filters.dir === 'asc' ? '▲' : '▼'}</span>`
    : '<span class="arrow">↕</span>';

  // Outside the scroll pane: what the table is showing and what it is sorted by
  // should not scroll away from the table it describes.
  $('#tablemeta').innerHTML = `${data.funds.length} of ${data.total} shown ·
    sorted by ${esc(COLUMNS().find((c) => c.field === filters.sort)?.label || filters.sort)}
    ${filters.dir === 'asc' ? 'ascending' : 'descending'}`;
  wrap.innerHTML = `
    <table class="grid dense sticky">
      <thead><tr>
        <th class="pickcell"></th>
        ${cols.map((c) => `
        <th class="sortable${c.text || c.field === 'categoryRank' ? '' : ' r'}${
          c.field === 'name' ? ' namecell' : ''}${
          filters.sort === c.field ? ' on' : ''}" data-sort="${esc(c.field)}"
          title="Sort by ${esc(c.label)}">${term(c.label, null, c.gloss)}${
          arrow(c)}</th>`).join('')}
      </tr></thead>
      <tbody>${data.funds.map((f) => `
        <tr data-fund="${esc(f.key)}" tabindex="0">
          <td class="pickcell">${pickBox(f.key)}</td>
          ${cols.map((c) => {
          if (c.field === 'name') {
            return `<td class="fundcell namecell"><strong>${esc(f.name)}</strong>${f.flags.length
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
  /* One listener on the table rather than one per row. Five hundred handlers
     are five hundred closures to allocate and five hundred to throw away on the
     next keystroke, for a table where at most one row is ever clicked. */
  wrap.onclick = (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) return sortBy(th.dataset.sort);
    if (e.target.closest('.pickcell')) return;     // ticking is not opening
    const tr = e.target.closest('[data-fund]');
    if (tr) openFund(tr.dataset.fund);
  };
  wirePicks(wrap);
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

/* ------------------------------------------------ calendar year look through */

/* A composite says how a fund has done. A row of calendar years says when, and
   the two are different questions: a fund can carry a strong record because it
   was extraordinary in one year and ordinary in nine, and only the row shows it.

   Every year is coloured on its own scale. 2020 and 2022 were not the same
   market, and a shared range would colour the years rather than the funds. The
   scale is the house diverging pair, red below zero and slate above it, so the
   sign is read before the number is. */
function calState() {
  if (!state.cal) state.cal = { sort: null, dir: 'desc' };
  return state.cal;
}

/* Worst in the column red, middling yellow, best green. The three stops are
   anchored on the column's own worst, median and best rather than on zero: in a
   year where the whole category fell, the fund that fell least is still the one
   to find, and anchoring on zero would paint the column uniformly red and hide
   it. The text stays dark throughout because all three stops are light. */
const HEAT_STOPS = [[248, 105, 107], [255, 235, 132], [99, 190, 123]];

function mix(a, b, t) {
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
}

function heatTone(v, scale) {
  if (v == null) return { bg: 'transparent', fg: 'var(--text-muted)' };
  const { lo, mid, hi } = scale;
  const [red, yellow, green] = HEAT_STOPS;
  if (v <= mid) {
    const t = mid > lo ? (v - lo) / (mid - lo) : 1;
    return { bg: mix(red, yellow, t), fg: 'var(--text-primary)' };
  }
  const t = hi > mid ? (v - mid) / (hi - mid) : 0;
  return { bg: mix(yellow, green, t), fg: 'var(--text-primary)' };
}

async function drawCalendarPanel(category) {
  const panel = $('#catpanel');
  const c = calState();
  panel.innerHTML = '<div class="loading sm">Reading the calendar years…</div>';
  const d = await get('/calendar/' + encodeURIComponent(category));

  if (!d.years.length) {
    panel.innerHTML = `<p class="muted sm">No calendar year history is published
      for ${esc(category)}.</p>`;
    return;
  }

  // Each column's own range, so the colour describes the fund and not the year.
  const range = {};
  d.years.forEach((y) => {
    const vals = d.funds.map((f) => f.years[y.field])
      .filter((v) => v != null).sort((a, b) => a - b);
    range[y.field] = vals.length
      ? { lo: vals[0], mid: vals[Math.floor(vals.length / 2)], hi: vals[vals.length - 1] }
      : { lo: 0, mid: 0, hi: 0 };
  });

  /* Sorting on the beat count is on the rate, not the count: four out of four
     is a better record than five out of ten, and ordering on the numerator
     would put the fund with the longest life on top whatever it did with it.
     Ties go to the longer record, because it is the same rate on more
     evidence. */
  const beatKey = (f) => f.beat && f.beat.of
    ? f.beat.won / f.beat.of + f.beat.of / 1000 : null;
  const cellOf = (f) => c.sort === 'beat' ? beatKey(f) : f.years[c.sort];

  const funds = [...d.funds];
  if (c.sort) {
    // A fund with no figure for a year has not come last in it, so it sinks to
    // the bottom whichever way the column points rather than winning the sort.
    funds.sort((a, b) => {
      const x = cellOf(a), y = cellOf(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return c.dir === 'asc' ? x - y : y - x;
    });
  }

  const arrow = (field) => c.sort === field
    ? `<span class="arrow">${c.dir === 'asc' ? '▲' : '▼'}</span>`
    : '<span class="arrow">↕</span>';

  /* Won out of the years it was alive for, never out of a flat ten: a fund with
     four years on the board that won three of them has done something, and
     printing that as 3 of 10 would report the years before it launched as years
     it lost. */
  const beatCell = (f) => {
    const b = f.beat;
    if (!b || !b.of) return '<td class="beatcell muted">–</td>';
    const rate = b.won / b.of;
    const tone = rate >= 0.6 ? ' strong' : rate < 0.4 ? ' weak' : '';
    return `<td class="beatcell${tone}"><b>${b.won}</b><span>/${b.of}</span></td>`;
  };

  /* No heading and no preamble. The selected tile already says which category
     this is, and the table explains itself: the figures are years, the colour
     runs worst to best, the headers sort. What the reader does need to know is
     that these are the leading fifteen and not the whole category, and that
     sits with the rest of the small print underneath. */
  panel.innerHTML = `
    <div class="tablewrap">
      <table class="grid dense heat">
        <thead><tr>
          <th class="pickcell"></th>
          <th class="namecell">Fund</th>
          <th class="sortable${c.sort === 'beat' ? ' on' : ''}" data-year="beat"
            title="Sort on how often it beat the index">${
              term('Beat count')}${arrow('beat')}</th>
          ${d.years.map((y) => `<th class="r sortable${
            c.sort === y.field ? ' on' : ''}" data-year="${esc(y.field)}"
            title="Sort on ${esc(y.label)}">${esc(y.label)}${arrow(y.field)}</th>`).join('')}
        </tr></thead>
        <tbody>
          ${funds.map((f) => `<tr data-fund="${esc(f.key)}" tabindex="0">
            <td class="pickcell">${pickBox(f.key)}</td>
            <td class="fundcell namecell"><strong>${esc(f.name)}</strong></td>
            ${beatCell(f)}
            ${d.years.map((y) => {
              const v = f.years[y.field];
              const t = heatTone(v, range[y.field]);
              return `<td class="r mono heatcell" style="background:${t.bg};color:${t.fg}"
                >${v == null ? '–' : num(v, 1)}</td>`;
            }).join('')}
          </tr>`).join('')}
        </tbody>
        ${d.benchmark ? `<tfoot>
          <tr class="bmrow">
            <td class="pickcell"></td>
            <td class="fundcell namecell">
              <span class="bmname">${esc(d.benchmark.name)}</span>
              <span class="muted sm">${d.benchmark.kind === 'index'
                ? 'closest available index' : 'category benchmark'}</span>
            </td>
            <td class="beatcell"></td>
            ${d.years.map((y) => {
              const v = d.benchmark.years[y.field];
              // The benchmark is what the column is read against, so it is not
              // coloured on the column's own scale: shading it would rank it
              // among the funds, which is the one thing it is not doing.
              return `<td class="r mono heatcell bmcell">${
                v == null ? '–' : num(v, 1)}</td>`;
            }).join('')}
          </tr>
        </tfoot>` : ''}
      </table>
    </div>
    <p class="muted sm">${d.benchmark
      ? `Read against ${esc(d.benchmark.name)}, on the foot of the table and not
         coloured: it is what the column is measured against rather than an
         entrant in it. Beat count is completed calendar years the fund finished
         ahead of it, out of the years both were alive for, to a maximum of ten.
         ` : ''}The leading ${d.funds.length} of ${d.count} schemes in
    ${esc(category)}, by composite. Calendar year returns, not annualised.
    Colour runs from the worst figure in each year through that year's middle to
    its best, so it ranks the funds within a year and never compares one year to
    another. Click a year to sort on it. A blank is a year the fund had not
    launched into, or had not completed.</p>`;

  panel.querySelectorAll('th[data-year]').forEach((th) => th.onclick = () => {
    const c2 = calState();
    // Same column again reverses it; a new column opens on its best first.
    c2.dir = c2.sort === th.dataset.year && c2.dir === 'desc' ? 'asc' : 'desc';
    c2.sort = th.dataset.year;
    drawCalendarPanel(category);
  });
  panel.querySelectorAll('[data-fund]').forEach((el) =>
    el.onclick = (e) => {
      if (e.target.closest('.pickcell')) return;
      openFund(el.dataset.fund);
    });
  wirePicks(panel);
  wireGlossary(panel);
}

const PASSIVE_CAT = 'Smart beta / Passive';

/* Index funds and ETFs, grouped by the index each one tracks and ranked inside
   that group. There is no alpha to rank a tracker on and no need for one: two
   funds on the same index are the same product, so what separates them is how
   much of the index they hand back, and that arrives in the return. Nothing
   crosses families, because a Nifty 50 fund against a Nifty Bank fund is two
   market calls rather than two trackers. */
async function drawPassivePanel() {
  const panel = $('#catpanel');
  panel.innerHTML = '<div class="loading sm">Grouping the trackers…</div>';
  const d = await get('/passive');
  const bad = d.families.flatMap((g) =>
    g.implausible.map((x) => ({ ...x, index: g.index })));

  panel.innerHTML = `
    <div class="catpanel-head">
      <h3>${esc(PASSIVE_CAT)}</h3>
      <span class="muted">${d.families.length} indices with
        ${d.minFamily} or more funds tracking them</span>
    </div>
    <p class="lede sm">A tracker is not trying to beat its index, so there is no
    alpha to rank it on. What separates two funds on the same index is how much
    of it they hand back: cost and tracking error, which arrive together in the
    return. Each group below is one index, best tracker first, and the spread is
    what the choice inside that group was worth.</p>

    <div class="fam-grid">
      ${d.families.map((g) => `
        <section class="fam">
          <div class="fam-head">
            <h4>${esc(g.index)}</h4>
            <span class="muted sm">${g.measured} funds &middot; over ${esc(g.window)}</span>
          </div>
          <table class="grid dense fam-table">
            <tbody>
              ${g.funds.map((f, i) => `
                <tr data-fund="${esc(f.key)}" tabindex="0">
                  <td class="fam-rank">${i + 1}</td>
                  <td class="fam-name">${esc(f.name)}</td>
                  <td class="r mono">${num(f[g.field], 2)}%</td>
                </tr>`).join('')}
            </tbody>
          </table>
          <p class="fam-foot muted sm">Best to worst in this group:
            <b>${num(g.spread, 2)}</b> percentage points a year</p>
        </section>`).join('')}
    </div>

    ${bad.length ? `<p class="muted sm fam-note">${bad.length} figures were left
      out of these rankings as impossible: two funds tracking one index cannot be
      ${d.implausibleGap} percentage points apart, so a gap that size is an error
      in the source rather than a tracking difference.
      ${bad.map((b) => `${esc(b.name)} at ${num(b.value, 1)}%`).join('; ')}.
      They are still listed in All funds, with the figure the feed published.</p>`
      : ''}`;

  panel.querySelectorAll('[data-fund]').forEach((el) =>
    el.onclick = () => openFund(el.dataset.fund));
  wireGlossary(panel);
}

const VIEW_LABEL = { shortlist: 'category top funds', all: 'all funds',
                     compare: 'compare', portfolio: 'the portfolio builder',
                     sectors: 'sectors', approach: 'how we look at funds' };

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
        <p class="muted">${esc(f.category)}${f.amc ? ' · ' + esc(f.amc) : ''}</p>
      </div>
      <div class="fundhead-right">
        ${analyst ? `<div class="fundhead-score">
          ${bandPill(f.band)}
          <span class="big">${num(f.composite, 1)}</span>
          <span class="muted sm">${f.categoryRank
            ? `rank ${f.categoryRank} of ${f.categoryCount}` : 'unranked'}</span>
        </div>` : ''}
        <!-- The tick box from the lists, wearing a button. Same selection, same
             bar at the foot, same two destinations: a fund gathered here and a
             fund gathered from a table are the same fund in the same place. -->
        <div class="fundhead-add">
          <button class="cmp-ghost" id="fund-pick"
                  data-picklabel="${esc(f.key)}"></button>
        </div>
      </div>
    </div>

    <div class="snapshot">
      <div class="snapcol">
        <section class="snapcard chartcard">
          <span class="snapcard-head">
            <span class="snapcard-title">Growth of 100 rupees</span>
            <span class="snapcard-sub" id="growth-sub">daily NAV, rebased to zero
              at the start of the window</span>
            <button class="chart-more" data-card="returns">Every period &rsaquo;</button>
          </span>
          <div class="periodbar" id="periodbar" role="group"
               aria-label="Chart period"></div>
          <div id="c-growth"></div>
          <p class="cardnote muted sm" id="growth-note"></p>
        </section>

        ${returnsCard(f)}

        ${card('holds', 'Shape of the equity book',
                 f.holdingCount ? 'concentration of the disclosed book'
                   : 'no disclosed book',
                 f.holdingCount
                   ? `<div class="shapegrid">
                        <div><span class="k">${term('Top 5 weight')}</span>
                             <span class="v">${num(f.topFive, 0)}%</span></div>
                        <div><span class="k">${term('Top 10 weight')}</span>
                             <span class="v">${num(f.top10, 0)}%</span></div>
                        <div><span class="k">Largest</span>
                             <span class="v">${num(f.largestPosition, 1)}%</span></div>
                        <div><span class="k">Names held</span>
                             <span class="v">${num(f.holdingCount, 0)}</span></div>
                      </div>`
                   // Four bars all reading zero look like a broken card rather than
                   // an absent one, so the card says which it is.
                   : `<p class="muted sm nobook">No security level holdings are
                      collected for this scheme, so its concentration cannot be
                      read.</p>`)}
      </div>

      <div class="snapcol">
        ${card('size', 'Size and cost', 'assets, flow and what it charges',
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

        ${card('holds', 'Largest sectors', 'share of the equity book',
               (f.sectors || []).length ? '<div id="c-sectors"></div>'
                 : '<p class="muted sm nobook">No sector detail on file.</p>')}

        ${card('holds', 'Top holdings',
               f.holdingCount ? `largest ${(f.holdings || []).length} of ${f.holdingCount}`
                 : 'no disclosed book',
               bookList(f))}

        ${card('holds', 'Cap mix', 'share of the whole fund',
               `<div class="donutwrap"><div id="c-caps"></div>
                  <div class="donutkey" id="c-caps-key"></div></div>`)}
      </div>

      <div class="snapcol">
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

        ${drawdownCard(f)}

        ${card('risk', 'How it behaves in a fall',
               'three years, capture against the benchmark at 100',
               '<div id="c-capture"></div>' +
               // Named for its window. The card above reads the whole NAV
               // record and this one reads three years, so without the label
               // they look like two answers to one question.
               `<div class="cardfoot"><span>${term('Maximum drawdown')} over 3Y</span>
                  <b>${num(f.maxDrawdown3Y, 1)}%</b></div>`)}

        ${card('who', 'Who runs it', mgrs.length === 1 ? 'one manager'
                : `${mgrs.length} managers, longest serving first`,
               managerList(f, mgrs))}
      </div>
    </div>

    ${analyst && f.scored ? `<div class="scorerow">${
      card('score', 'The score', 'seven blocks, weighted',
           '<div id="c-blocks"></div>')}</div>` : ''}

    ${analyst && f.flags.length ? `<div class="flagrow">${f.flags.map((x) => `
      <div class="flagcard ${esc(x.tone)}"><strong>${esc(x.label)}</strong>
      <span>${esc(x.why)}</span></div>`).join('')}</div>` : ''}`;

  // --- the visuals -------------------------------------------------------
  Chart.bars($('#c-capture'), [
    { label: 'Upside', value: f.upsideCapture3Y || 0 },
    { label: 'Downside', value: f.downsideCapture3Y || 0 },
  ], { suffix: '', decimals: 0, max: Math.max(100, f.upsideCapture3Y || 0,
       f.downsideCapture3Y || 0),
       colorFor: (x) => x.label === 'Downside' ? 'var(--serious)' : 'var(--seq-550)' });

  /* The feed's allocation, not the holdings-derived cap mix. Both exist and they
     are on different denominators: capMix is a share of the equity sleeve and
     sums to less than 100, while these four are shares of the whole fund and sum
     to exactly 100, which is the only basis on which cash belongs beside them.
     A ring rather than four bars, because these are parts of one book and the
     bars were inviting the eye to rank them against each other. */
  const slices = capSlices(f);
  if (slices.some((x) => x.value > 0)) {
    Chart.donut($('#c-caps'), slices, {
      size: 104, thickness: 19,
      centreLabel: `${num(100 - (f.cashPct || 0), 0)}%`, centreNote: 'in equities' });
    $('#c-caps-key').innerHTML = slices.map((x) => `<span>
      <i style="background:${x.ink}"></i>${esc(x.label)}
      <b>${num(x.value, 0)}%</b></span>`).join('');
  } else if ($('#c-caps')) {
    $('#c-caps').innerHTML = `<p class="muted sm nobook">No allocation is
      published for this scheme.</p>`;
  }

  if ((f.sectors || []).length) Chart.bars($('#c-sectors'),
    f.sectors.map((x) => ({ label: x.sector, value: x.weight })),
    { suffix: '%', decimals: 0,
      max: Math.max(...f.sectors.map((x) => x.weight)),
      colorFor: () => 'var(--seq-450)' });

  drawDrawdown(f);

  if (analyst && f.scored) Chart.blockBar($('#c-blocks'), f.blocks);

  drawGrowth(f.key, state.growthPeriod || '1y');

  // --- wiring ------------------------------------------------------------
  $('#fund-back').onclick = () => { state.fund = null; setView(back); };

  paintPickButton($('#fund-pick'), isPicked(f.key));
  $('#fund-pick').onclick = () => togglePick(f.key);
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
  /* Shorter than it was. The chart used to be the page and could take the room;
     it is now the top of a column with a return table and the book under it, and
     a 390px plot pushed those past the foot of the other two columns. */
  Chart.growthLines(host, g.series, { height: 150, alpha: false });

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

/* ------------------------------------------------- the fund page cards */

/* Periods across, measures down. A reader scanning a return table is asking
   "how did it do over three years", and that question is one column here rather
   than a row picked out of seven. The two halves are stacked on the same
   columns, so the point to point figure and the median window sit directly
   above and below each other on one horizon.

   Beyond a year both are annualised, so a 3Y column is a rate and not a total.
   The alpha row is printed rather than left to be worked out in the reader's
   head. */
function returnsCard(f) {
  const t = f.returns || {};
  const rows = t.rows || [];
  if (!rows.length) return '';

  const pc = (v) => v == null ? '<td class="mono muted">—</td>'
    : `<td class="mono">${num(v, 1)}</td>`;
  const al = (v) => v == null ? '<td class="mono muted">—</td>'
    : `<td class="mono alpha ${v >= 0 ? 'up' : 'down'}">${
        v > 0 ? '+' : ''}${num(v, 1)}</td>`;

  /* A rolling window needs several of itself to have a median, so the short
     horizons have none and never will. Rather than three rows of dashes under
     1M and 3M, the block starts where its figures do and the columns it does not
     reach are left open. The horizons still line up, which is the whole reason
     the table is laid out this way. */
  const skip = (n) => n ? `<td class="na" colspan="${n}"></td>` : '';
  const block = (label, pick, from) => {
    const n = from ? rows.findIndex((r) => r.label === from) : 0;
    const keep = rows.slice(n);
    const half = (get, fmtOne) =>
      skip(n) + keep.map((r) => fmtOne(get(pick(r)))).join('');
    return `
      <tr class="grp"><th colspan="${rows.length + 1}">${label}</th></tr>
      <tr><th>Fund</th>${half((h) => h.fund, pc)}</tr>
      <tr class="band"><th>Index</th>${half((h) => h.bench, pc)}</tr>
      <tr class="alpharow"><th>Alpha</th>${half((h) => h.alpha, al)}</tr>`;
  };

  return `
    <button class="snapcard" data-card="returns">
      <span class="snapcard-head">
        <span class="snapcard-title">How it has done</span>
        <span class="snapcard-sub">% a year past 1Y, against ${
          esc(t.benchmark || 'the benchmark')}</span>
        <span class="snapcard-go" aria-hidden="true">&rsaquo;</span>
      </span>
      <span class="snapcard-body">
        <table class="rettable">
          <colgroup><col class="stub">${
            rows.map(() => '<col>').join('')}</colgroup>
          <thead><tr><th></th>${rows.map((r) =>
            `<th class="per">${esc(r.label)}</th>`).join('')}</tr></thead>
          <tbody>
            ${block(term('Point to point'), (r) => r.p2p)}
            ${block(term('Median rolling') + ' <span class="grp-note">3Y and 5Y</span>',
                    (r) => r.rolling, '3Y')}
          </tbody>
        </table>
      </span>
    </button>`;
}

/* The four cap buckets as parts of one ring. Kept in one place so the ring and
   its key cannot drift apart. */
function capSlices(f) {
  // Large to small is an ordered scale, so the ink is one ramp running light as
  // the companies get smaller. Four shades of slate were technically distinct
  // and useless at a glance. Cash steps out of the ramp entirely, because it is
  // not a smaller kind of company.
  return [
    { label: 'Large cap', value: f.largeCapPct || 0, ink: '#3d4f5c' },
    { label: 'Mid cap', value: f.midCapPct || 0, ink: '#6e93ab' },
    { label: 'Small cap', value: f.smallCapPct || 0, ink: '#b5d0e2' },
    { label: 'Cash and others', value: f.cashPct || 0, ink: '#dcdcd8' },
  ];
}

/* Who runs it, as the record rather than as one name. A single bold name over
   "7 managers" says almost nothing: on a team that size the question is how much
   of it has been there a while, and whether the people running the money now are
   the ones who earned its record. So: the three longest serving with their
   tenure, the scheme's own age beside the longest tenure on it, and the number of
   market cycles that tenure spans. A manager who has not run money through a
   fall has not been tested by one. */
const WHO_SHOWN = 3;

function managerList(f, mgrs) {
  const ranked = [...(mgrs || [])].sort(
    (a, b) => (b.tenureYears || 0) - (a.tenureYears || 0));
  const shown = ranked.slice(0, WHO_SHOWN);
  const rest = ranked.length - shown.length;
  const longest = ranked[0];

  if (!ranked.length) {
    return `<p class="muted sm nobook">No manager record on file for this
      scheme.</p>`;
  }
  return `
    <ul class="mgrlist">
      ${shown.map((m) => `<li>
        <span>${esc(m.name)}</span>
        <b>${m.tenureYears == null ? '—' : num(m.tenureYears, 1)}<em>yrs</em></b>
      </li>`).join('')}
      ${rest > 0 ? `<li class="more"><span>and ${rest} more</span>
        <b>${num(ranked[WHO_SHOWN].tenureYears, 1)}<em>or less</em></b></li>` : ''}
    </ul>
    <div class="cardfoot">
      <span>Fund since</span><b>${fmtInception(f.inceptionDate)}</b>
      <span>${term('Market cycles run')}</span><b>${num(f.managerCycles, 0)}</b>
      ${sameHands(f, longest) != null
        ? `<span>Same hands for</span><b>${num(sameHands(f, longest), 0)}%</b>
           <span>of its life</span>` : ''}
    </div>`;
}

/* How much of the fund's own life the longest serving manager has been on it.
   A ten year record run by somebody who arrived last year is a record of
   somebody else's work, and the tenure figure alone does not say which it is.
   Read against inception rather than against `vintageYears`, which is itself
   derived from manager tenure and would answer its own question. */
function sameHands(f, longest) {
  const age = fundAgeYears(f.inceptionDate);
  if (!age || !longest || longest.tenureYears == null) return null;
  return Math.min(100, 100 * longest.tenureYears / age);
}

function fundAgeYears(raw) {
  const d = parseFeedDate(raw);
  return d ? (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000) : null;
}

const FEED_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
                      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/* The feed writes inception as 28-May-13, which is three ways ambiguous read
   cold. Two digit years here are always this century: the oldest scheme in the
   universe is from the nineties and would arrive as a four digit year. */
function parseFeedDate(raw) {
  if (!raw) return null;
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(String(raw).trim());
  if (!m) return null;
  const mo = FEED_MONTHS[m[2].toLowerCase()];
  if (mo == null) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return new Date(y, mo, Number(m[1]));
}

function fmtInception(raw) {
  const d = parseFeedDate(raw);
  if (!d) return raw ? esc(String(raw)) : '—';
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
             'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getFullYear()}`;
}

function bookList(f) {
  const h = f.holdings || [];
  if (!h.length) return `<p class="muted sm nobook">No security level holdings
    are collected for this scheme.</p>`;
  return `<ol class="booklist">${h.map((x) => `<li>
    <span>${esc(x.name)}</span><b>${num(x.weight, 1)}%</b></li>`).join('')}</ol>`;
}

/* A maximum drawdown is one number for a whole record. It says how deep the
   hole was and nothing about how long the reader sat in it, which is the part
   that decides whether a fund gets held. So: the shape of every fall, and the
   three worst with how far down and how long back. What the index did over the
   same stretch, and the best run on the other side, are a click away rather
   than crowded onto a card a third of a screen wide. */
function drawdownCard(f) {
  const d = f.drawdowns || {};
  const body = d.unavailable
    ? `<p class="muted sm nobook">${esc(d.unavailable)}</p>`
    : `<div id="c-underwater"></div>
       <table class="ddtable">
         <thead><tr><th>Fall began</th><th class="r">Depth</th>
           <th class="r">Back in</th></tr></thead>
         <tbody>${(d.worst || []).map((w) => `<tr>
           <td class="mono">${mon(w.peak)}</td>
           <td class="r mono down">${num(w.depth, 1)}%</td>
           <td class="r mono">${w.recovered
              ? num(w.toRecover + (w.toBottom || 0), 0) + ' months'
              : '<em>still down</em>'}</td></tr>`).join('')}</tbody>
       </table>`;

  return `
    <button class="snapcard" data-card="drawdown">
      <span class="snapcard-head">
        <span class="snapcard-title">Drawdown periods</span>
        <span class="snapcard-sub">the whole record since ${mon(d.from)}${
          d.inDrawdown ? ` &middot; ${num(Math.abs(d.current), 1)}% below its high today`
            : ' &middot; at a new high today'}</span>
        <span class="snapcard-go" aria-hidden="true">&rsaquo;</span>
      </span>
      <span class="snapcard-body">${body}</span>
    </button>`;
}

function drawDrawdown(f) {
  const host = $('#c-underwater');
  const d = f.drawdowns || {};
  if (!host || d.unavailable) return;
  Chart.underwater(host, d.days, d.values, {
    height: 124,
    marks: (d.worst || []).map((w) => ({ date: w.trough, label: mon(w.trough) })),
  });
}

/* "Feb 20" — month and two digit year. Long enough to place an episode, short
   enough to sit in a five column table a third of a screen wide. */
function mon(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
             'Oct', 'Nov', 'Dec'][d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
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

  if (code === 'returns') {
    const cy = Object.keys(f).filter((k) => /^returnCY\d\d$/.test(k))
      .sort().reverse().filter((k) => f[k] != null);
    return openModal(head('How it has done',
      `Point to point, annualised beyond one year. Against ${esc(bm.name || 'the benchmark')}` +
      (bm.kind === 'index' ? ', the closest index the feed publishes for this category ' +
       'rather than the category\'s own benchmark.' : '.')) +
      `<div class="np-grid three">
        <div class="np-col"><h5>Every period</h5>
          ${kvTable(RETURN_COLUMNS().map((c) =>
            [c.label, num(f[c.field], 2) + '%']))}
          <p class="muted sm">Against ${esc(bm.name || 'the benchmark')}:
            ${RETURN_COLUMNS().map((c) => `${c.label} ${num(bm[c.field], 1)}%`)
              .join(' · ')}</p></div>
        <div class="np-col"><h5>Median rolling return</h5>
          ${kvTable([['1Y', num(f.medianRolling1Y, 2) + '%'],
                     ['3Y', num(f.medianRolling3Y, 2) + '%'],
                     ['5Y', num(f.medianRolling5Y, 2) + '%'],
                     ['7Y', num(f.medianRolling7Y, 2) + '%'],
                     ['10Y', num(f.medianRolling10Y, 2) + '%']])}
          <h5 style="margin-top:14px">Consistency</h5>
          ${kvTable([['Share of 3Y windows beating the benchmark',
                      f.rollingHitRate3Y == null ? '—' : num(f.rollingHitRate3Y, 1) + '%'],
                     ['Windows measured', num(f.rollingWindows3Y, 0)],
                     ['Category decile 3Y', num(f.decile3Y, 0)],
                     ['Category decile 5Y', num(f.decile5Y, 0)]])}</div>
        <div class="np-col"><h5>Calendar years</h5>
          ${cy.length ? kvTable(cy.map((k) =>
            ['20' + k.slice(-2), num(f[k], 1) + '%'])) : '<p class="muted">Not published.</p>'}
          ${f.cyBeatPct != null ? `<p class="muted sm">Beat the benchmark in
            ${num(f.cyBeatPct, 0)}% of completed calendar years.</p>` : ''}</div>
      </div>`);
  }

  if (code === 'drawdown') {
    const d = f.drawdowns || {};
    const w = d.worst || [];
    return openModal(head('Drawdown periods',
      'Every fall of more than ' + num(d.floor || 8, 0) + '% from a high water ' +
      'mark, measured on daily NAV since ' + fmtDay(d.from || '') + '. The index ' +
      'column is what ' + esc(d.indexName || 'the market') + ' did over the same ' +
      'stretch, peak date to trough date, not its own worst fall.') +
      (w.length ? `<div class="np-grid">
        <div class="np-col"><h5>The worst ${w.length}</h5>
          ${kvTable(w.map((x) => [`${fmtDay(x.peak)} to ${fmtDay(x.trough)}`,
            `${num(x.depth, 1)}%${x.indexFall == null ? ''
              : `  ·  index ${num(x.indexFall, 1)}%`}`]))}</div>
        <div class="np-col"><h5>How long they lasted</h5>
          ${kvTable(w.flatMap((x) => [
            [`Down to the bottom, from ${mon(x.peak)}`,
             x.toBottom == null ? '—' : num(x.toBottom, 1) + ' months'],
            [`Back to the old high, from ${mon(x.peak)}`,
             x.recovered ? num(x.toRecover, 1) + ' months' : 'not yet'],
          ]))}
          ${d.best ? `<h5 style="margin-top:14px">The other side of it</h5>
            ${kvTable([['Best stretch', '+' + num(d.best.gain, 0) + '%'],
                       ['From', fmtDay(d.best.from)], ['To', fmtDay(d.best.to)],
                       ['Months', num(d.best.months, 0)]])}` : ''}</div>
      </div>` : `<p class="muted">${esc(d.unavailable
        || 'No fall past the floor on file.')}</p>`));
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

/* No ceiling on the funds. Past a handful the chart is a thicket, but that is a
   judgement for whoever is reading it: a portfolio of twelve is a real thing. */
const MAX_CMP_FUNDS = Infinity;
const MAX_CMP_MARKS = 2;

/* The table's rows, grouped the way the checkboxes group them. `dir` is which
   way is better, used to mark the leading fund in a row; beta has none, because
   a beta of 1.2 is not better or worse than 0.8, it is a different fund. */
/* Column labels are short because the group heading above them already says
   what they are: under "Rolling returns", a column called "3Y" is not
   ambiguous, and "Median rolling 3Y" only makes the column three times wider
   than the figure in it. The long name is kept for the glossary lookup.
   [label, field, suffix, decimals, direction to win, glossary term] */
const CMP_GROUPS = [
  { id: 'returns', label: 'Returns', note: 'annualised beyond one year',
    get rows() {
      return RETURN_COLUMNS().map((c) => [c.label, c.field, '%', 1, 'high']);
    } },
  { id: 'rolling', label: 'Rolling returns', note: 'median of every window', rows: [
    ['3Y', 'medianRolling3Y', '%', 1, 'high', 'median rolling return'],
    ['5Y', 'medianRolling5Y', '%', 1, 'high', 'median rolling return']] },
  { id: 'risk', label: 'Risk metrics', note: 'three years', rows: [
    ['Sharpe', 'sharpe3Y', '', 2, 'high'], ['Sortino', 'sortino3Y', '', 2, 'high'],
    ['Info ratio', 'informationRatio3Y', '', 2, 'high', 'information ratio'],
    ['Beta', 'beta3Y', '', 2, null]] },
  { id: 'capture', label: 'Capture ratios', note: 'benchmark at 100', rows: [
    ['Up', 'upsideCapture3Y', '', 0, 'high', 'upside capture'],
    ['Down', 'downsideCapture3Y', '', 0, 'low', 'downside capture']] },
];

/* Compare and the portfolio builder are the same machinery asking two
   questions, so they share every drawing function and keep two separate
   selections. Picking three funds to read side by side and picking three to
   hold are different acts, and one should not overwrite the other. */
function builder(view) {
  const k = (view || state.view) === 'portfolio' ? 'pf' : 'cmp';
  if (!state[k]) {
    state[k] = { keys: [], marks: [], period: '3y', weights: null, holdings: false,
                 groups: new Set(CMP_GROUPS.map((g) => g.id)) };
  }
  return state[k];
}

const cmpState = () => builder();
const isPortfolio = () => state.view === 'portfolio';

/* The weights travel in the query string as key:amount, so a portfolio view can
   be linked, exported and printed without a body to post. */
const cmpWeightQuery = () => {
  const w = cmpState().weights;
  return w ? '&w=' + Object.entries(w)
    .map(([k, v]) => `${encodeURIComponent(k)}:${v}`).join(',') : '';
};

const cmpInk = (i) => Chart.COMPARE_INK[i % Chart.COMPARE_INK.length];

async function renderCompare(host) {
  const c = cmpState();
  host.innerHTML = `
    <section>
      <div class="cmp-pickers">
        <div class="cmp-pick">
          <label class="cmp-lab" for="cmp-lookup">Funds
            <span class="muted">tick them in any list, or search here</span></label>
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
      <div class="opt" data-k="${esc(f.key)}" data-name="${esc(f.name)}">
        <span>${esc(f.name)}</span><span class="muted">${esc(f.category)}</span></div>`).join('')
      || '<div class="opt muted">Nothing else matches</div>';
    box.hidden = false;
    box.querySelectorAll('.opt[data-k]').forEach((el) => el.onclick = () => {
      if (c.keys.length >= MAX_CMP_FUNDS) return;
      const key = el.dataset.k;
      c.keys.push(key);
      // The name is on the option that was just clicked, so the weights form can
      // label the new line without waiting for the chart request to name it.
      c.names = { ...(c.names || {}), [key]: el.dataset.name || key };
      box.hidden = true; input.value = '';
      drawCmpChips();
      /* A holding with no share is not a holding. On the builder the weight is
         asked for as the fund goes in, rather than leaving it on an even split
         the reader never chose and may not notice. */
      if (isPortfolio()) openWeights(null, { focusKey: key });
      drawBody();
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
    drawCmpChips(); drawBody();
  });
  const input = $('#cmp-lookup');
  if (input) input.placeholder = 'Type a scheme name';
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
    drawCmpMarks(); drawBody();
  });
}

/* Both tabs share the pickers, the chips and the benchmark row, and each has
   its own body underneath. Every one of those three used to redraw the compare
   body whatever tab it was on, which replaced the builder's chart and tiles
   with the comparison as soon as anybody added a fund to a portfolio. */
const drawBody = () => isPortfolio() ? drawPfBody() : drawCmpBody();

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
      <div class="cmp-bar">
        <div class="periodbar" id="cmp-periods" role="group" aria-label="Chart period"></div>
      </div>
      <div id="cmp-growth"></div>
      <p class="cardnote muted sm" id="cmp-note"></p>
    </section>

    <div class="cmp-groupbar" id="cmp-groupbar">
      ${CMP_GROUPS.map((g) => `
        <label class="cmp-group"><input type="checkbox" data-group="${g.id}"
          ${c.groups.has(g.id) ? 'checked' : ''}> ${esc(g.label)}</label>`).join('')}
      <a id="cmp-csv" class="cmp-download" href="#" download
         title="Every metric, the overlap between each pair, and the daily series behind the chart, whichever groups are ticked">Download CSV</a>
      <button id="cmp-pdf" class="cmp-download"
         title="Lays the comparison out on one sheet and opens the print dialog, where Save as PDF gives you the file">PDF</button>
    </div>
    <div class="tablewrap" id="cmp-tablewrap"></div>

    <div id="cmp-overlap"></div>`;

  $('#cmp-groupbar').querySelectorAll('[data-group]').forEach((b) =>
    b.onchange = () => {
      if (b.checked) c.groups.add(b.dataset.group);
      else c.groups.delete(b.dataset.group);
      drawCmpTable();
    });

  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  /* The print stylesheet lays this page out as one sheet in the house format, so
     the PDF is the page rather than a second rendering of it that could drift. */
  on('#cmp-pdf', () => window.print());

  await Promise.all([drawCmpGrowth(), drawCmpTable(), drawCmpOverlap()]);
}

/* The export always carries the whole comparison, not the columns that happen
   to be ticked: a spreadsheet is opened to look at something the screen was not
   showing. */
function cmpQuery(withPeriod) {
  const c = cmpState();
  return `keys=${c.keys.map(encodeURIComponent).join(',')}`
    + `&marks=${c.marks.map(encodeURIComponent).join(',')}`
    + (withPeriod ? `&period=${encodeURIComponent(c.period)}` : '');
}

function setCmpCsvHref() {
  const a = $('#cmp-csv');
  if (a) a.href = API + '/compare.csv?' + cmpQuery(true) + cmpWeightQuery();
}

async function drawCmpGrowth() {
  const c = cmpState();
  const host = $('#cmp-growth');
  if (!host) return;
  host.innerHTML = '<div class="loading sm">Reading NAV history…</div>';
  const qs = `keys=${c.keys.map(encodeURIComponent).join(',')}`
    + `&marks=${c.marks.map(encodeURIComponent).join(',')}`
    + `&period=${encodeURIComponent(c.period)}`;
  const g = c.weights
    ? await get('/portfolio/growth?' + qs + cmpWeightQuery())
    : await get('/compare/growth?' + qs);
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
  const series = g.series.map((s) => {
    if (s.code === 'fund') return { ...s, ink: cmpInk(fi++) };
    // In portfolio mode the holdings are what the line is made of, not lines in
    // their own right, so they sit behind it thin and pale until asked for.
    if (s.code === 'holding') return { ...s, ink: cmpInk(fi++), width: 1, faint: true };
    if (s.code === 'portfolio') return { ...s, ink: 'var(--ink-strong)', width: 2.6 };
    return { ...s, ink: Chart.MARK_INK, dash: '5 3', width: 1.5 };
  }).filter((s) => s.code !== 'holding' || c.holdings);
  Chart.growthLines(host, series, { height: isPortfolio() ? 205 : 300 });

  c.names = Object.fromEntries(g.series
    .filter((s) => s.code === 'fund' || s.code === 'holding')
    .map((s) => [s.key, s.label]));
  drawCmpChips();
  setCmpCsvHref();

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
  const t = await get('/compare?' + qs + cmpWeightQuery());

  /* A fund is the subject here, so it gets the row: the eye runs along one
     scheme's record left to right, and down a single metric to rank on it.
     Benchmarks sit underneath the funds, in the same columns. */
  const rows = [
    /* The portfolio leads, because once there is one it is the subject and the
       holdings underneath are what it is made of. It is not marked best in any
       column: a weighted average of the rows below it is not competing with
       them. */
    ...(t.portfolio ? [{ label: t.portfolio.label, sub: t.portfolio.metricsLabel,
                         metrics: t.portfolio.metrics, ink: 'var(--ink-strong)',
                         lead: true }] : []),
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

  // The first column of each group carries the rule that separates the blocks,
  // so four sets of figures read as four sets rather than one long smear.
  const sep = [];
  groups.reduce((n, g) => { sep.push(n); return n + g.rows.length; }, 0);
  const cls = (i) => sep.includes(i) ? ' cmp-gsep' : '';

  /* Column widths come from a colgroup rather than the cells: the first row is
     the group heading, whose colspans tell the fixed layout nothing about the
     columns underneath, and it would otherwise hand a two column group the same
     width as a seven column one. */
  wrap.innerHTML = `
    <table class="grid dense cmp-table">
      <colgroup>
        <col class="cmp-namecol">
        ${cols.map(() => '<col>').join('')}
      </colgroup>
      <thead>
        <tr class="cmp-grouphead">
          <th></th>
          ${groups.map((g) => `<th colspan="${g.rows.length}" class="c cmp-gsep">
            ${esc(g.label)}
            <span class="muted sm">${esc(g.note)}</span></th>`).join('')}
        </tr>
        <tr>
          <th class="cmp-namehead">Fund</th>
          ${cols.map(([label, , , , , gloss], i) =>
            `<th class="r${cls(i)}">${term(label, null, gloss)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `<tr class="${
          r.lead ? 'cmp-leadrow' : r.fund ? '' : 'cmp-markrow'}">
          <td class="cmp-name" title="${esc(r.label)}">
            <span class="cmp-colhead"><i style="background:${r.ink}"></i>
              <span class="cmp-nametext">${esc(r.label)}</span></span>
            <span class="muted sm">${esc(r.sub || '')}</span></td>
          ${cols.map(([, field, suffix, dp], i) => {
            const v = r.metrics[field];
            return `<td class="r mono${cls(i)}${
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

/* ================================================================= sectors

   The other way round. Every other list starts from a fund and asks what it
   holds; this one starts from a sector and asks who holds it. That is the
   question somebody brings when they already have a view: too much banking,
   nothing in healthcare, a manager who says they avoid metals.

   Exposure is the share of the fund's own equity book, which is what the
   disclosed holdings sum to. A fund a third in cash reads lower against the
   whole of itself than the figure here, and the note under the table says so. */

const sectorState = () => (state.sec = state.sec
  || { name: null, lo: '', hi: '', list: null, sort: 'exposure', dir: 'desc' });

/* The columns, as data, so the header and the body are generated from one list
   and a sort can never point at a column the table is not drawing. `dir` is the
   direction that puts "good" first, the same rule All funds uses: one click on
   any heading shows the best of it. */
const SECTOR_COLUMNS = () => [
  { field: 'name', label: 'Fund', dir: 'asc', text: true, cls: 'fundcell namecell',
    cell: (f) => `<strong>${esc(f.name)}</strong>` },
  { field: 'category', label: 'Category', dir: 'asc', text: true, cls: 'muted' },
  { field: 'exposure', label: null, dir: 'desc', d: 1, suffix: '%', cls: 'r mono b' },
  ...RETURN_COLUMNS().filter((c) => ['1Y', '3Y', '5Y'].includes(c.label))
    .map((c) => ({ field: c.field, label: c.label, dir: 'desc', d: 1, cls: 'r mono' })),
  { field: 'maxDrawdown3Y', label: 'Max drawdown', dir: 'desc', d: 1, cls: 'r mono',
    gloss: 'maximum drawdown' },
  { field: 'aumCr', label: 'AUM', dir: 'desc', money: true, cls: 'r mono',
    gloss: 'aum' },
];

async function renderSectors(host) {
  const c = sectorState();
  if (!c.list) c.list = (await get('/sectors')).sectors || [];
  if (!c.name && c.list.length) c.name = c.list[0].name;

  host.innerHTML = `
    <section>
      <div class="filterbar">
        <label>Sector
          <select id="s-sector">${c.list.map((x) => `
            <option${x.name === c.name ? ' selected' : ''} value="${esc(x.name)}"
              >${esc(x.name)}</option>`).join('')}</select>
        </label>
        <!-- The label is a column flex, so its text has to be one element:
             a bare text node beside the glossary span becomes a second row. -->
        <label><span>${term('Exposure')} at least</span>
          <input id="s-lo" type="number" min="0" max="100" step="1"
                 placeholder="any" value="${esc(c.lo)}"></label>
        <label><span>and at most</span>
          <input id="s-hi" type="number" min="0" max="100" step="1"
                 placeholder="any" value="${esc(c.hi)}"></label>
        <span class="spacer"></span>
        <button id="s-reset" class="ghost">Reset</button>
      </div>
      <div class="tablemeta" id="s-meta"></div>
      <div id="s-table" class="tablewrap frozen"></div>
    </section>`;

  const redraw = debounce(() => {
    c.name = $('#s-sector').value;
    c.lo = $('#s-lo').value;
    c.hi = $('#s-hi').value;
    drawSectorTable();
  }, 220);
  ['#s-sector', '#s-lo', '#s-hi'].forEach((id) => {
    const el = $(id);
    el.oninput = redraw; el.onchange = redraw;
  });
  $('#s-reset').onclick = () => { c.lo = ''; c.hi = ''; renderSectors(host); };

  await drawSectorTable();
  wireGlossary(host);
}

async function drawSectorTable() {
  const c = sectorState();
  const wrap = $('#s-table');
  if (!wrap || !c.name) return;
  const p = new URLSearchParams({ limit: '300' });
  if (c.lo !== '') p.set('min', c.lo);
  if (c.hi !== '') p.set('max', c.hi);
  const d = await get(`/sector/${encodeURIComponent(c.name)}?` + p);

  const sorted = SECTOR_COLUMNS().find((x) => x.field === c.sort);
  $('#s-meta').innerHTML = `${d.matched} of ${d.total} funds with a disclosed
    book hold ${esc(d.sector)}${c.lo !== '' || c.hi !== ''
      ? ` at ${c.lo !== '' ? `${esc(c.lo)}% or more` : 'any weight'}${
          c.hi !== '' ? ` and ${esc(c.hi)}% or less` : ''}` : ''}
    &middot; sorted by ${esc(sorted && sorted.label ? sorted.label : 'exposure')}
    ${c.dir === 'asc' ? 'ascending' : 'descending'}`;

  if (!d.funds.length) {
    wrap.innerHTML = `<div class="cmp-empty">No fund's book sits in that range.</div>`;
    return;
  }

  const cols = SECTOR_COLUMNS();
  const col = cols.find((x) => x.field === c.sort) || cols[2];
  /* Three hundred rows are already here, so the sort is done on them rather than
     asked for again. A fund with no figure for a column has not come last in it,
     so it sinks to the bottom whichever way the column points. */
  const rows = [...d.funds].sort((a, b) => {
    const x = a[col.field], y = b[col.field];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    const cmp = col.text ? String(x).localeCompare(String(y)) : x - y;
    return c.dir === 'asc' ? cmp : -cmp;
  });

  const arrow = (f) => c.sort === f
    ? `<span class="arrow">${c.dir === 'asc' ? '▲' : '▼'}</span>`
    : '<span class="arrow">↕</span>';

  wrap.innerHTML = `
    <table class="grid dense sticky">
      <thead><tr>
        <th class="pickcell"></th>
        ${cols.map((x) => `<th class="sortable${x.text ? '' : ' r'}${
          x.field === 'name' ? ' namecell' : ''}${c.sort === x.field ? ' on' : ''}"
          data-sort="${esc(x.field)}" title="Sort by ${
            esc(x.label || d.sector)}">${
          x.label === null ? `In ${esc(d.sector)}`
            : term(x.label, null, x.gloss)}${arrow(x.field)}</th>`).join('')}
      </tr></thead>
      <tbody>${rows.map((f) => `
        <tr data-fund="${esc(f.key)}" tabindex="0">
          <td class="pickcell">${pickBox(f.key)}</td>
          ${cols.map((x) => `<td class="${x.cls}">${
            x.cell ? x.cell(f)
              : x.money ? cr(f[x.field])
              : x.text ? esc(f[x.field] || '—')
              : num(f[x.field], x.d ?? 1) + (x.suffix || '')}</td>`).join('')}
        </tr>`).join('')}
      </tbody>
    </table>`;

  wrap.onclick = (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) {
      // The same column again reverses it; a new one opens on its own best first.
      const f = th.dataset.sort;
      const next = cols.find((x) => x.field === f);
      c.dir = c.sort === f ? (c.dir === 'asc' ? 'desc' : 'asc') : (next.dir || 'desc');
      c.sort = f;
      return drawSectorTable();
    }
    if (e.target.closest('.pickcell')) return;
    const tr = e.target.closest('[data-fund]');
    if (tr) openFund(tr.dataset.fund);
  };
  wirePicks(wrap);
  wireGlossary(wrap);
}

/* ========================================================== portfolio builder

   Compare asks how these funds differ. The builder asks what they come to when
   they are all held: one line rather than several, one book rather than several
   books, and the overlap read as duplication rather than as resemblance.

   It runs on the same machinery as compare and keeps its own selection, because
   picking three funds to read side by side and picking three to hold are
   different acts and one should not overwrite the other. */

async function renderPortfolio(host) {
  const c = builder('portfolio');
  host.innerHTML = `
    <section>
      <div class="cmp-pickers">
        <div class="cmp-pick">
          <label class="cmp-lab" for="cmp-lookup">Holdings
            <span class="muted">tick them in any list, or search here</span></label>
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
  /* A portfolio with nothing to read it against is a line on its own, and the
     broad market is what almost anybody would pick first. Chosen once, so a
     reader who takes it off does not find it back the next time they open the
     tab. */
  if (!c.marksInit) {
    c.marksInit = true;
    const broad = c.available.find((m) => /nifty\s*500/i.test(m.label || m.id));
    if (broad && !c.marks.length) c.marks = [broad.id];
  }
  drawCmpMarks();
  wireCmpSearch();
  drawCmpChips();
  await drawPfBody();
  wireGlossary(host);
}

/* An unweighted portfolio is not a portfolio, so rather than showing an empty
   page until somebody fills a form, the tab opens on an equal split and says
   so. It is a real allocation and a common one, and it is one click from being
   replaced. */
function evenWeights(keys) {
  const each = Math.round(10000 / keys.length) / 100;
  return Object.fromEntries(keys.map((k) => [k, each]));
}

async function drawPfBody() {
  const c = cmpState();
  const host = $('#cmp-body');
  if (!host) return;
  if (!c.keys.length) {
    host.innerHTML = `<div class="cmp-empty">Add a fund above to start a
      portfolio.</div>`;
    return;
  }
  // Weights follow the holdings: a fund added after they were set has no share,
  // and a fund removed leaves its share stranded on nothing.
  const same = c.weights && c.keys.length === Object.keys(c.weights).length
    && c.keys.every((k) => c.weights[k] != null);
  if (!same) { c.weights = evenWeights(c.keys); c.even = true; }

  host.innerHTML = `
    <div class="pf-top">
      <section class="snapcard chartcard pf-chart">
        <span class="snapcard-head">
          <span class="snapcard-title">The portfolio, growth of 100 rupees</span>
          <span class="snapcard-sub" id="cmp-sub">rebased to zero at the start of
            the window</span>
        </span>
        <div class="cmp-bar">
          <div class="periodbar" id="cmp-periods" role="group"
               aria-label="Chart period"></div>
          <div class="cmp-pfbtns">
            <label class="cmp-group"><input type="checkbox" id="cmp-holdings"
              ${c.holdings ? 'checked' : ''}> Show holdings</label>
            <button class="cmp-ghost strong" id="cmp-editpf">${
              c.even ? 'Set weights' : 'Edit weights'}</button>
          </div>
        </div>
        <div id="cmp-growth"></div>
        <p class="cardnote muted sm" id="cmp-note"></p>
      </section>

      <div class="pf-tiles" id="pf-tiles">
        <div class="loading sm">Adding the books together…</div>
      </div>
    </div>

    <div class="cmp-groupbar" id="cmp-groupbar">
      ${CMP_GROUPS.map((g) => `
        <label class="cmp-group"><input type="checkbox" data-group="${g.id}"
          ${c.groups.has(g.id) ? 'checked' : ''}> ${esc(g.label)}</label>`).join('')}
      <a id="cmp-csv" class="cmp-download" href="#" download
         title="Every metric, the overlap between each pair, and the daily series behind the chart, whichever groups are ticked">Download CSV</a>
      <button id="cmp-pdf" class="cmp-download"
         title="Lays the portfolio out on one sheet and opens the print dialog, where Save as PDF gives you the file">PDF</button>
    </div>
    <div class="tablewrap" id="cmp-tablewrap"></div>

    <div id="cmp-overlap"></div>`;

  $('#cmp-groupbar').querySelectorAll('[data-group]').forEach((b) =>
    b.onchange = () => {
      if (b.checked) c.groups.add(b.dataset.group);
      else c.groups.delete(b.dataset.group);
      drawCmpTable();
    });
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on('#cmp-pdf', () => window.print());
  on('#cmp-editpf', () => openWeights());
  const hold = $('#cmp-holdings');
  if (hold) hold.onchange = () => { c.holdings = hold.checked; drawCmpGrowth(); };

  await Promise.all([drawCmpGrowth(), drawPfTiles(),
                     drawCmpTable(), drawCmpOverlap()]);
}

/* Four tiles beside the line. What a portfolio holds is not what its funds hold
   listed four times: the same stock bought by three of them is one position at
   the sum of its three weights, and only the combined book says how big that
   position actually is. The cap mix here is read off those underlying stocks
   rather than off the funds' categories, because a flexi cap fund holding small
   caps is holding small caps whatever the label on it says. */
const PF_CAP_INK = { large: '#3d4f5c', mid: '#6e93ab', small: '#b5d0e2' };
const PF_CAP_LABEL = { large: 'Large cap', mid: 'Mid cap', small: 'Small cap' };

async function drawPfTiles() {
  const host = $('#pf-tiles');
  if (!host) return;
  const c = cmpState();
  let d;
  try {
    d = await get('/portfolio/lookthrough?x=1' + cmpWeightQuery());
  } catch (e) {
    host.innerHTML = `<div class="empty sm">${esc(e.message)}</div>`;
    return;
  }
  if (!(d.funds || []).length) {
    host.innerHTML = `<div class="empty sm">None of these schemes has a
      disclosed book, so the combined holdings cannot be read.</div>`;
    return;
  }

  const capped = Object.values(d.capMix || {}).reduce((a, b) => a + b, 0);
  const slices = ['large', 'mid', 'small']
    .map((k) => ({ label: PF_CAP_LABEL[k], value: d.capMix[k] || 0,
                   ink: PF_CAP_INK[k] }))
    .concat(capped < 99.5
      ? [{ label: 'Unclassified', value: Math.max(0, 100 - capped),
           ink: '#dcdcd8' }] : []);

  /* Five and five. The four tiles are a block beside the chart, and the block
     only reads as one thing while its two halves are the same height. The long
     versions of both lists are a click away in the CSV. */
  const sectors = (d.sectors || []).slice(0, 5);
  const stocks = (d.stocks || []).slice(0, 5);
  const largest = d.stocks && d.stocks[0];

  host.innerHTML = `
    <section class="snapcard pf-tile">
      <span class="snapcard-head">
        <span class="snapcard-title">What it comes to</span>
        <span class="snapcard-sub">${d.funds.length} ${
          d.funds.length === 1 ? 'holding' : 'holdings'}, added together at weight</span>
      </span>
      <div class="shapegrid">
        <div><span class="k">${term('Effective holdings')}</span>
             <span class="v">${num(d.effectiveStocks, 0)}</span></div>
        <div><span class="k">Distinct names</span>
             <span class="v">${d.distinctStocks}</span></div>
        <div><span class="k">${term('Top 10 weight')}</span>
             <span class="v">${num(d.topTen, 0)}%</span></div>
        <div><span class="k">Largest</span>
             <span class="v">${num(largest ? largest.weight : null, 1)}%</span></div>
      </div>
    </section>

    <section class="snapcard pf-tile">
      <span class="snapcard-head">
        <span class="snapcard-title">Cap mix</span>
        <span class="snapcard-sub">the stocks underneath, not the mandates</span>
      </span>
      <div class="donutwrap"><div id="pf-caps"></div>
        <div class="donutkey" id="pf-caps-key"></div></div>
    </section>

    <section class="snapcard pf-tile">
      <span class="snapcard-head">
        <span class="snapcard-title">Largest sectors</span>
        <span class="snapcard-sub">share of the combined book</span>
      </span>
      <div id="pf-sectors"></div>
    </section>

    <section class="snapcard pf-tile pf-book">
      <span class="snapcard-head">
        <span class="snapcard-title">Top holdings</span>
        <span class="snapcard-sub">largest ${stocks.length} of ${d.distinctStocks}</span>
      </span>
      <ol class="booklist">${stocks.map((x) => `<li>
        <span>${esc(x.name)}</span><b>${num(x.weight, 1)}%</b></li>`).join('')}</ol>
    </section>`;

  Chart.donut($('#pf-caps'), slices, { size: 104, thickness: 19,
    centreLabel: `${num(d.capMix.large || 0, 0)}%`, centreNote: 'large cap' });
  $('#pf-caps-key').innerHTML = slices.map((x) => `<span>
    <i style="background:${x.ink}"></i>${esc(x.label)}
    <b>${num(x.value, 0)}%</b></span>`).join('');

  if (sectors.length) Chart.bars($('#pf-sectors'),
    sectors.map((x) => ({ label: x.sector, value: x.weight })),
    { suffix: '%', decimals: 0, max: Math.max(...sectors.map((x) => x.weight)),
      colorFor: () => 'var(--seq-450)' });

  if ((d.missing || []).length) {
    const note = document.createElement('p');
    note.className = 'muted sm pf-missnote';
    note.textContent = `${d.missing.length} of ${c.keys.length} schemes have no `
      + 'disclosed book and are left out of these four, though they are still in '
      + 'the line and the table.';
    host.appendChild(note);
  }
}

/* ------------------------------------------------------------- portfolio */

/* Weights are entered in whichever unit the reader thinks in. Rupees are what
   somebody actually holds; percentages are what an allocation is written as.
   Both are the same question once the total is divided out, so the form takes
   either and shows the share each line comes to as it is typed. Nothing has to
   add up to a round number. */
function openWeights(opener, opts = {}) {
  const c = opts.target || cmpState();
  const names = c.names || {};
  const unit = c.unit || '%';
  /* An even split the reader has not looked at is a default, not a decision, so
     it does not come back as if they had typed it. Weights they set themselves
     do. */
  const existing = (c.even ? null : c.weights) || {};
  const rows = c.keys.map((k) => ({ key: k, name: names[k] || k,
                                    value: existing[k] ?? '' }));

  openModal(`
    <div class="wt">
      <h3>Weights</h3>
      <p class="muted sm">Enter what each holding is worth, or what share of the
      whole it is. The two are read the same way: the total is divided out, so
      the figures do not have to add to a hundred or to any round sum. Every
      holding needs one.</p>
      <div class="wt-units segmented" role="group" aria-label="Units">
        <button data-unit="%" class="${unit === '%' ? 'on' : ''}">Percent</button>
        <button data-unit="INR" class="${unit === 'INR' ? 'on' : ''}">Rupees</button>
      </div>
      <div class="wt-rows">
        ${rows.map((r, i) => `
          <label class="wt-row">
            <span class="wt-name"><i style="background:${cmpInk(i)}"></i>
              ${esc(r.name)}</span>
            <input type="number" min="0" step="any" data-w="${esc(r.key)}"
                   value="${esc(r.value)}" inputmode="decimal">
            <span class="wt-share" data-share="${esc(r.key)}">—</span>
          </label>`).join('')}
      </div>
      <div class="wt-foot">
        <span class="wt-total" id="wt-total">Nothing entered yet</span>
        <span class="wt-actions">
          <button class="cmp-ghost" id="wt-even">Split evenly</button>
          <button class="wt-create" id="wt-create" disabled>${
            esc(opts.create || 'Save weights')}</button>
        </span>
      </div>
    </div>`, opener);

  const box = document.querySelector('.modal');
  const inputs = [...box.querySelectorAll('[data-w]')];
  let u = unit;

  const read = () => Object.fromEntries(inputs
    .map((el) => [el.dataset.w, parseFloat(el.value)])
    .filter(([, v]) => Number.isFinite(v) && v > 0));

  function refresh() {
    const w = read();
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    inputs.forEach((el) => {
      const share = total ? (w[el.dataset.w] || 0) / total * 100 : null;
      box.querySelector(`[data-share="${CSS.escape(el.dataset.w)}"]`).textContent =
        share ? num(share, 1) + '%' : '—';
    });
    const n = Object.keys(w).length;
    const missing = c.keys.length - n;
    /* Rupees here are rupees. The `cr` helper formats a fund's size, which is
       already in crore, and running an amount through it turns five lakh into
       five lakh crore. */
    /* Every line needs a figure. A holding left blank is not a zero weight
       holding, it is a holding somebody has not decided about yet, and creating
       the portfolio around it would quietly drop it. */
    $('#wt-total').textContent = missing > 0
      ? `${missing} ${missing === 1 ? 'holding still needs' : 'holdings still need'} a share`
      : u === 'INR' ? `${n} holdings, INR ${num(total, 0)} in total`
                    : `${n} holdings, entered as ${num(total, 1)}`;
    $('#wt-create').disabled = missing > 0;
  }

  inputs.forEach((el) => el.oninput = refresh);
  box.querySelectorAll('[data-unit]').forEach((b) => b.onclick = () => {
    u = b.dataset.unit;
    c.unit = u;
    box.querySelectorAll('[data-unit]').forEach((x) =>
      x.classList.toggle('on', x === b));
    refresh();
  });
  $('#wt-even').onclick = () => {
    const each = u === 'INR' ? 100000 : (100 / inputs.length);
    inputs.forEach((el) => { el.value = u === 'INR' ? each : each.toFixed(1); });
    refresh();
  };
  $('#wt-create').onclick = () => {
    const w = read();
    if (Object.keys(w).length < c.keys.length) return;
    // Stored as shares of the whole, so the unit is a thing the form worried
    // about and not a thing the rest of the app has to carry around.
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    c.weights = Object.fromEntries(Object.entries(w)
      .map(([k, v]) => [k, Math.round(v / total * 10000) / 100]));
    c.even = false;
    closeModal();
    if (opts.onSave) opts.onSave(c.weights);
    else drawPfBody();
  };
  refresh();
  /* The line that was just added is the one the reader came here to fill in, so
     the cursor is already in it. */
  if (opts.focusKey) {
    const el = box.querySelector(`[data-w="${CSS.escape(opts.focusKey)}"]`);
    if (el) el.focus();
  }
}

/* --------------------------------------------------------------- overlap */

async function drawCmpOverlap() {
  const c = cmpState();
  const host = $('#cmp-overlap');
  if (!host) return;
  const o = await get('/compare/overlap?keys='
    + c.keys.map(encodeURIComponent).join(',') + cmpWeightQuery());
  const f = o.funds || [];
  if (f.length < 2) {
    host.innerHTML = f.length && (o.missing || []).length
      ? `<p class="muted sm">${esc(o.missing.join(', '))} has no disclosed book,
         so it cannot be read for overlap.</p>`
      : '';
    return;
  }

  /* Overlap is symmetric, so only the upper triangle carries information and
     the mirror image below it is the same numbers read backwards. The first
     scheme never heads a column and the last never heads a row, which is what
     leaves the staircase of empty cells down the left. */
  const rows = f.slice(0, -1), cols = f.slice(1);
  const cell = (i, j) => {
    if (j + 1 <= i) return '<td class="ov-blank r muted">–</td>';
    const v = o.matrix[i][j + 1];
    if (v == null) return '<td class="r mono muted">–</td>';
    return `<td class="r ov-cell${v >= o.heavy ? ' ov-heavy' : ''}">
      <button class="ov-btn mono" data-a="${esc(f[i].key)}"
        data-b="${esc(f[j + 1].key)}"
        title="${esc(f[i].name)} and ${esc(f[j + 1].name)}"
        >${num(v, 2)}</button></td>`;
  };

  host.innerHTML = `
    <section class="snapcard cmp-ovcard">
      <span class="snapcard-head">
        <span class="snapcard-title">Stock overlap</span>
        <span class="snapcard-sub">percent of weight held in common, the smaller
          of the two positions in every stock, summed</span>
      </span>
      <div class="tablewrap">
        <table class="grid dense ov-table">
          <thead><tr>
            <th class="ov-namehead">Scheme name</th>
            ${cols.map((x) => `<th class="r ov-colhead" title="${esc(x.name)}">
              <span>${esc(x.name)}</span></th>`).join('')}
          </tr></thead>
          <tbody>
            ${rows.map((x, i) => `<tr>
              <td class="ov-name"><span class="cmp-colhead">
                <i style="background:${cmpInk(c.keys.indexOf(x.key))}"></i>
                ${esc(x.name)}</span></td>
              ${cols.map((y, j) => cell(i, j)).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="cardnote muted sm">Shaded where a pair overlaps more than
      ${o.heavy} percent, which is where two funds are largely the same holding
      bought twice. Click a figure for the stocks behind it.${(o.missing || []).length
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
          <colgroup><col><col class="ovm-sector"><col class="ovm-w">
            <col class="ovm-w"><col class="ovm-w"></colgroup>
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
    else if (state.view === 'sectors') await renderSectors(host);
    else if (state.view === 'portfolio') await renderPortfolio(host);
    else await renderCompare(host);
  } catch (e) {
    host.innerHTML = `<div class="error"><strong>Could not load.</strong>
      <span>${esc(e.message)}</span></div>`;
  }
  drawPickbar();          // the selection survives moving between tabs
  drawTabCounts();
}

(async function boot() {
  applyMode();
  applyPlan();
  $('#plantoggle').querySelectorAll('button').forEach((b) =>
    b.onclick = () => {
      if (b.disabled) return;
      state.plan = b.dataset.plan;
      applyPlan();
      render();          // the two plans are different numbers, not just a label
    });
  $('#tabs').querySelectorAll('button').forEach((b) =>
    b.onclick = () => setView(b.dataset.view));
  try {
    [state.fw, state.meta] = await Promise.all([get('/framework'), get('/meta')]);
    state.gloss = state.fw.glossary || {};
    render();
  } catch (e) {
    $('#main').innerHTML = `<div class="error"><strong>Backend unavailable.</strong>
      <span>${esc(e.message)}</span></div>`;
  }
})();
