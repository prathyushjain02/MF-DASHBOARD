/* Mutual Fund Screener.
 *
 * Four views, mirroring the workbook: the methodology page, the per-category
 * shortlists, the full table with a fund detail card, and a portfolio
 * look-through.
 *
 * The Client / Analyst toggle is a presentation switch, not a data switch. In
 * client mode the composite and the block scores are hidden and the written
 * rationale leads. Everything else stays visible in both, because the data is
 * not the part that needs an analyst to interpret it.
 */

const API = '/api/mf';
const $ = (s, r = document) => r.querySelector(s);
const state = { mode: 'client', view: 'shortlist', fw: null, meta: null, fund: null };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 1) =>
  (v === null || v === undefined || Number.isNaN(v)) ? '—' : Number(v).toLocaleString('en-IN',
    { minimumFractionDigits: d, maximumFractionDigits: d });
const cr = (v) => v == null ? '—' : (v >= 1000 ? `₹${num(v / 1000, 1)}k cr` : `₹${num(v, 0)} cr`);

const BAND_TONE = { A: 'good', B: 'warning', C: 'serious', Review: 'critical',
                    'Not rated': 'neutral' };

async function get(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

/* ------------------------------------------------------------------ chrome */

function bandPill(band) {
  return `<span class="pill ${BAND_TONE[band] || 'neutral'}"><span class="dot"></span>${esc(band)}</span>`;
}

/* Scores are hidden in client view. They are removed from the DOM rather than
   dimmed, so a screenshot of client view cannot leak them. */
function score(v, d = 1) {
  if (state.mode !== 'analyst') return '<span class="hidden-score" title="Analyst view">•••</span>';
  return num(v, d);
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

/* ------------------------------------------------- 1. how we look at funds */

function renderApproach(host) {
  const fw = state.fw;
  host.innerHTML = `
    <section class="prose">
      <h2>How we look at mutual funds</h2>
      <p class="lede">Actively managed equity. One model with two jobs: rank the funds
      in each category and surface the shortlist, then present that shortlist the way
      a client should see it, with a written rationale and the number kept behind an
      analyst toggle.</p>

      <h3>Fund selection process</h3>
      <div class="cards">
        ${fw.process.map((p) => `
          <div class="card"><h4>${esc(p.name)}</h4><p>${esc(p.text)}</p></div>`).join('')}
      </div>

      <h3>What we score, and why</h3>
      <div id="weightchart" class="chart-host"></div>
      <table class="grid">
        <thead><tr><th>Block</th><th class="r">Weight</th><th>What it uses and why it matters</th></tr></thead>
        <tbody>${fw.blocks.map((b) => `
          <tr>
            <td><strong>${esc(b.name)}</strong></td>
            <td class="r mono">${b.weight}%</td>
            <td class="muted">${esc(b.why)}</td>
          </tr>
          <tr class="sub"><td></td><td></td><td>
            ${b.metrics.map((m) => `<span class="chip${m.weight ? '' : ' off'}">${esc(m.label)}
              <em>${m.weight ? m.weight + '%' : 'no weight'}</em></span>`).join('')}
          </td></tr>`).join('')}
        </tbody>
      </table>

      <h3>Shown, but not scored</h3>
      <p>Some fields earn their place on the page without earning a place in the score.
      Scoring them would count the same thing twice.</p>
      <table class="grid">
        <thead><tr><th>Field</th><th>Why it is not scored</th></tr></thead>
        <tbody>${fw.contextMetrics.map((m) => `
          <tr><td><strong>${esc(m.label)}</strong></td><td class="muted">${esc(m.why)}</td></tr>`).join('')}
        </tbody>
      </table>

      <h3>Category adjustments</h3>
      <div class="cards">
        ${fw.categoryAdjustments.map((c) => `
          <div class="card"><h4>${esc(c.name)}</h4><p>${esc(c.text)}</p></div>`).join('')}
      </div>

      <h3>The AUM curve, by category</h3>
      <p>Size means different things in different mandates, so the AUM score uses a
      different curve per category. Same axes on every panel: AUM across, score up.</p>
      <div id="aumcurves" class="chart-host"></div>

      <h3>Where a category is not a peer group</h3>
      <p>Everything here is scored against category peers, which only means something
      when the peers are doing the same job. Where that does not hold, the caveat
      travels with the number.</p>
      ${Object.entries(fw.loosePeerGroups || {}).map(([cat, why]) => `
        <div class="caveat"><strong>${esc(cat)}.</strong> ${esc(why)}</div>`).join('')
        || '<p class="muted">None flagged.</p>'}

      <h3>Bands</h3>
      <table class="grid">
        <thead><tr><th>Band</th><th class="r">Composite</th><th>What it means</th></tr></thead>
        <tbody>${fw.bands.map((b) => `
          <tr><td>${bandPill(b.code)}</td><td class="r mono">${b.min >= 0 ? b.min + ' and above' : 'below ' + fw.bands[fw.bands.length - 2].min}</td>
          <td class="muted">${esc(b.meaning)}</td></tr>`).join('')}
          <tr><td>${bandPill('Not rated')}</td><td class="r mono">n/a</td>
          <td class="muted">Less than ${fw.minEvidence}% of the model could be scored, so the
          fund carries no composite. A gap in the feed, not a verdict.</td></tr>
        </tbody>
      </table>
      <p class="note">A composite difference below ${fw.meaningfulGap} points is not a real
      difference. Funds inside that distance of their tier leader are shown as equally
      ranked, because the model orders a shortlist, it does not select.</p>

      <h3>How to use this</h3>
      <ul class="ticks">${fw.howToUse.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>

      <h3>What this model does not do</h3>
      <div class="cards">
        ${fw.limits.map((l) => `
          <div class="card muted-card"><h4>${esc(l.name)}</h4><p>${esc(l.text)}</p></div>`).join('')}
      </div>

      <h3>What we add next</h3>
      <div class="cards">
        ${fw.nextUp.map((l) => `
          <div class="card"><h4>${esc(l.name)}</h4><p>${esc(l.text)}</p></div>`).join('')}
      </div>
    </section>`;

  Chart.bars($('#weightchart'), fw.blocks.map((b) => ({ label: b.name, value: b.weight })),
    { suffix: '%', decimals: 0, colorFor: (r) => Chart.seqColor(r.value / 27) });
  drawAumCurves($('#aumcurves'), fw.aumCurves);
}

/* Small multiples, one panel per distinct curve.
   There are six distinct AUM curves, which is past the categorical cap, and the
   reader's question is "how does my category treat size" rather than "which line
   is which". So each curve gets its own panel on shared axes in a single hue, and
   identity is carried by the panel title instead of by colour. Grouping is keyed
   on the curve's actual points, not on its shape name: several categories share a
   shape name while using different points, and folding those into one line would
   claim a sameness that is not there. */
function drawAumCurves(host, curves) {
  const groups = new Map();
  Object.entries(curves).forEach(([cat, c]) => {
    const sig = JSON.stringify(c.points);
    if (!groups.has(sig)) groups.set(sig, { ...c, cats: [] });
    groups.get(sig).cats.push(cat);
  });
  const ns = 'http://www.w3.org/2000/svg';
  const mk = (t, a, txt) => { const e = document.createElementNS(ns, t);
    Object.entries(a).forEach(([k, v]) => e.setAttribute(k, v));
    if (txt != null) e.textContent = txt; return e; };
  const minX = Math.log10(50), maxX = Math.log10(80000);

  host.innerHTML = '';
  host.className = 'chart-host multiples';
  [...groups.values()].forEach((g) => {
    const panel = document.createElement('figure');
    panel.className = 'multiple';
    panel.innerHTML = `<figcaption><strong>${esc(g.shape)}</strong>
      <span class="muted">${esc(g.cats.join(', '))}</span></figcaption>`;
    const w = 300, h = 168, pad = { l: 32, r: 12, t: 10, b: 30 };
    const sx = (v) => pad.l + (Math.log10(Math.max(50, v)) - minX) / (maxX - minX) * (w - pad.l - pad.r);
    const sy = (v) => pad.t + (1 - v / 100) * (h - pad.t - pad.b);
    const svg = mk('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart',
                            preserveAspectRatio: 'xMidYMid meet' });
    [0, 50, 100].forEach((gl) => {
      svg.appendChild(mk('line', { x1: pad.l, y1: sy(gl), x2: w - pad.r, y2: sy(gl),
                                   stroke: 'var(--grid)', 'stroke-width': 1 }));
      svg.appendChild(mk('text', { x: pad.l - 6, y: sy(gl) + 3.5, class: 'tick-label',
                                   'text-anchor': 'end' }, gl));
    });
    [100, 1000, 10000, 50000].forEach((t) => {
      svg.appendChild(mk('text', { x: sx(t), y: h - 16, class: 'tick-label',
                                   'text-anchor': 'middle' },
        t >= 1000 ? (t / 1000) + 'k' : String(t)));
    });
    svg.appendChild(mk('text', { x: (pad.l + w - pad.r) / 2, y: h - 3,
                                 class: 'tick-label dim', 'text-anchor': 'middle' },
                       'AUM Rs cr, log'));
    const d = g.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0])},${sy(p[1])}`).join(' ');
    svg.appendChild(mk('path', { d, fill: 'none', stroke: 'var(--series-1)',
                                 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    g.points.forEach((p) => {
      const dot = mk('circle', { cx: sx(p[0]), cy: sy(p[1]), r: 4.5,
        fill: 'var(--series-1)', stroke: 'var(--surface-2)', 'stroke-width': 2 });
      Chart.hoverable(dot, `<strong>Rs ${p[0].toLocaleString('en-IN')} cr</strong>
        <div class="tt-row"><span>AUM score</span><span>${p[1]}</span></div>`);
      svg.appendChild(dot);
    });
    panel.appendChild(svg);
    panel.insertAdjacentHTML('beforeend', `<p class="muted sm">${esc(g.note)}</p>`);
    host.appendChild(panel);
  });
}

/* --------------------------------------------------- 2. category shortlists */

async function renderShortlists(host) {
  host.innerHTML = '<div class="loading">Building shortlists…</div>';
  const data = await get('/shortlists');
  host.innerHTML = `
    <section>
      <div class="section-head">
        <h2>Category top funds</h2>
        <p class="lede">The shortlist per category, ranked, each with the reason it is
        there. Funds inside ${state.fw.meaningfulGap} points of their tier leader are
        treated as equally ranked.</p>
      </div>
      ${data.categories.map(catBlock).join('')}
    </section>`;
  host.querySelectorAll('[data-fund]').forEach((el) =>
    el.onclick = () => openFund(el.dataset.fund));
}

function catBlock(c) {
  return `
    <div class="catblock">
      <div class="catblock-head">
        <h3>${esc(c.category)}</h3>
        <span class="muted">${c.count} schemes${c.mandate ? ' · ' + esc(c.mandate) : ''}</span>
      </div>
      ${c.caveat ? `<div class="caveat">${esc(c.caveat)}</div>` : ''}
      <div class="shortlist">
        ${c.funds.map((f) => `
          <article class="pick" data-fund="${esc(f.key)}" tabindex="0">
            <div class="pick-head">
              <div class="pick-rank">${f.tierSize > 1 ? `T${f.tier}` : f.categoryRank}</div>
              <div class="pick-id">
                <h4>${esc(f.name)}</h4>
                <span class="muted">${esc(f.amc || '')}${f.fundManager ? ' · ' + esc(f.fundManager) : ''}</span>
              </div>
              <div class="pick-band">${bandPill(f.band)}
                <span class="composite">${score(f.composite, 1)}</span></div>
            </div>
            <p class="rationale">${esc(f.whyWeLikeIt)}</p>
            <div class="pick-stats">
              <span><b>${num(f.medianRolling3Y, 1)}%</b> rolling 3Y</span>
              <span><b>${num(f.downsideCapture3Y, 0)}</b> downside capture</span>
              <span><b>${num(f.sortino3Y, 2)}</b> Sortino</span>
              <span><b>${cr(f.aumCr)}</b> AUM</span>
            </div>
            ${f.flags.length ? `<div class="flags">${f.flags.map((x) =>
              `<span class="flag">${esc(x)}</span>`).join('')}</div>` : ''}
          </article>`).join('')}
      </div>
    </div>`;
}

/* ------------------------------------------------------------ 3. all funds */

async function renderAll(host) {
  host.innerHTML = `
    <section>
      <div class="section-head"><h2>All funds</h2></div>
      <div class="filters">
        <label>Fund lookup
          <input id="lookup" type="search" placeholder="Type a scheme, AMC or manager"
                 autocomplete="off">
          <div id="suggest" class="suggest" hidden></div>
        </label>
        <label>Category
          <select id="f-cat"><option>All</option>
            ${state.fw.categories.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
        </label>
        <label>Band
          <select id="f-band"><option>All</option>
            ${['A', 'B', 'C', 'Review', 'Not rated'].map((b) => `<option>${esc(b)}</option>`).join('')}</select>
        </label>
        <label>Min AUM (₹ cr)<input id="f-aum" type="number" min="0" step="100" placeholder="0"></label>
        <label class="chk"><input id="f-hold" type="checkbox"> Has holdings</label>
      </div>
      <div id="detail" class="detail" hidden></div>
      <div id="tablewrap" class="tablewrap"></div>
    </section>`;

  const reload = debounce(loadTable, 220);
  ['f-cat', 'f-band', 'f-aum', 'f-hold'].forEach((id) => $('#' + id).onchange = reload);
  wireLookup();
  await loadTable();
  if (state.fund) openFund(state.fund);
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

async function loadTable() {
  const p = new URLSearchParams({
    category: $('#f-cat').value, band: $('#f-band').value, limit: '400',
  });
  if ($('#f-aum').value) p.set('minAum', $('#f-aum').value);
  if ($('#f-hold').checked) p.set('hasHoldings', '1');
  const data = await get('/funds?' + p);
  const wrap = $('#tablewrap');
  wrap.innerHTML = `
    <div class="tablemeta">${data.funds.length} of ${data.total} shown</div>
    <table class="grid dense sticky">
      <thead><tr>
        <th>#</th><th>Fund</th><th>Category</th><th>Band</th>
        <th class="r analyst-only">Composite</th>
        <th class="r">Roll 3Y</th><th class="r">CAGR 3Y</th><th class="r">Sortino</th>
        <th class="r">IR</th><th class="r">Dn cap</th><th class="r">Max DD</th>
        <th class="r">AUM</th><th class="r">Eff N</th><th class="r">Evidence</th>
      </tr></thead>
      <tbody>${data.funds.map((f, i) => `
        <tr data-fund="${esc(f.key)}" tabindex="0">
          <td class="mono dim">${f.categoryRank ?? '—'}</td>
          <td><strong>${esc(f.name)}</strong>
            ${f.flags.length ? `<span class="flag sm">${esc(f.flags[0])}</span>` : ''}</td>
          <td class="muted">${esc(f.category)}</td>
          <td>${bandPill(f.band)}</td>
          <td class="r mono analyst-only">${score(f.composite, 1)}</td>
          <td class="r mono">${num(f.medianRolling3Y, 1)}</td>
          <td class="r mono">${num(f.return3Y, 1)}</td>
          <td class="r mono">${num(f.sortino3Y, 2)}</td>
          <td class="r mono">${num(f.informationRatio3Y, 2)}</td>
          <td class="r mono">${num(f.downsideCapture3Y, 0)}</td>
          <td class="r mono">${num(f.maxDrawdown3Y, 1)}</td>
          <td class="r mono">${cr(f.aumCr)}</td>
          <td class="r mono">${num(f.effectiveStocks, 0)}</td>
          <td class="r mono dim">${num(f.evidence, 0)}%</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  wrap.querySelectorAll('[data-fund]').forEach((el) =>
    el.onclick = () => openFund(el.dataset.fund));
}

function wireLookup() {
  const input = $('#lookup'), box = $('#suggest');
  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { box.hidden = true; return; }
    const data = await get('/funds?limit=12&q=' + encodeURIComponent(q));
    if (!data.funds.length) { box.hidden = true; return; }
    box.innerHTML = data.funds.map((f) => `
      <div class="opt" data-fund="${esc(f.key)}">
        <span>${esc(f.name)}</span>
        <span class="muted">${esc(f.category)} · ${bandPill(f.band)}</span>
      </div>`).join('');
    box.hidden = false;
    box.querySelectorAll('.opt').forEach((el) => el.onclick = () => {
      box.hidden = true; input.value = '';
      openFund(el.dataset.fund);
    });
  }, 200);
  input.oninput = run;
  document.addEventListener('click', (e) => {
    if (!box.contains(e.target) && e.target !== input) box.hidden = true;
  });
}

/* --------------------------------------------------------- the detail card */

async function openFund(key) {
  state.fund = key;
  if (state.view !== 'all') { setView('all'); return; }
  const host = $('#detail');
  host.hidden = false;
  host.innerHTML = '<div class="loading">Scoring…</div>';
  host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const f = await get('/fund/' + encodeURIComponent(key));
  const r = f.remark;

  host.innerHTML = `
    <button class="close" aria-label="Close">×</button>
    <div class="detail-head">
      <div>
        <h3>${esc(f.name)}</h3>
        <p class="muted">${esc(f.category)} · ${esc(f.amc || '')}${
          f.fundManager ? ' · ' + esc(f.fundManager) : ''}</p>
      </div>
      <div class="detail-score">
        ${bandPill(f.band)}
        <div class="big">${score(f.composite, 1)}</div>
        <div class="muted sm">${f.categoryRank ? `rank ${f.categoryRank} of ${f.categoryCount}` : 'unranked'}</div>
      </div>
    </div>

    <p class="verdict">${esc(r.verdict)}</p>
    ${f.loosePeerGroup ? `<div class="caveat">${esc(f.loosePeerGroup)}</div>` : ''}

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

    ${f.flags.length ? `<div class="flagrow">${f.flags.map((x) => `
      <div class="flagcard ${esc(x.tone)}"><strong>${esc(x.label)}</strong>
      <span>${esc(x.why)}</span></div>`).join('')}</div>` : ''}

    <h4>Block scores <span class="muted sm">bar height is the score, bar width is
      the weight in the composite, hatched means not scored</span></h4>
    <div id="blockbar" class="chart-host"></div>
    <div class="analyst-only">
      <table class="grid dense">
        <thead><tr><th>Block</th><th class="r">Weight</th><th class="r">Score</th>
          <th class="r">Category median</th><th class="r">Coverage</th></tr></thead>
        <tbody>${f.peers.map((p) => `
          <tr><td>${esc(p.name)}</td><td class="r mono">${p.weight}%</td>
            <td class="r mono"><strong>${p.score == null ? 'not scored' : num(p.score, 0)}</strong></td>
            <td class="r mono dim">${p.categoryMedian == null ? '—' : num(p.categoryMedian, 0)}</td>
            <td class="r mono dim">${num(p.coverage, 0)}%</td></tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="two">
      <div class="panel">
        <h4>The numbers</h4>
        <table class="grid dense kv">
          <tbody>${metricRows(f)}</tbody>
        </table>
      </div>
      <div class="panel">
        <h4>Shown, not scored</h4>
        <table class="grid dense kv">
          <tbody>${f.context.map((m) => `
            <tr><td>${esc(m.label)}</td>
              <td class="r mono">${m.value == null ? '—' : num(m.value, 2) + (m.unit || '')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="analyst-only">
      <h4>Where the points are</h4>
      <p class="muted sm">Ordered by composite points still available, so the top row is
      what would actually change the answer.</p>
      <table class="grid dense">
        <thead><tr><th>Block</th><th class="r">Score</th><th class="r">Points on the table</th>
          <th>Note</th></tr></thead>
        <tbody>${r.movers.map((m) => `
          <tr><td>${esc(m.block)}</td>
            <td class="r mono">${m.score == null ? '—' : num(m.score, 0)}</td>
            <td class="r mono">${m.available == null ? '—' : num(m.available, 1)}</td>
            <td class="muted">${esc(m.note)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="two">
      <div class="panel">
        <h4>What it holds <span class="muted sm">top 15 of ${f.holdingCount ?? 0}</span></h4>
        <div id="holdbars" class="chart-host"></div>
        <p class="muted sm">${esc(f.mandate.note || '')}
          Effective holdings ${num(f.effectiveStocks, 0)}, top 10 at ${num(f.top10, 0)}%,
          overlap with the average book in the category ${num(f.categoryOverlap, 0)}%.</p>
      </div>
      <div class="panel">
        <h4>Closest books in the category</h4>
        <p class="muted sm">If this fund were dropped, this is what already holds the
        same exposure.</p>
        <table class="grid dense">
          <thead><tr><th>Fund</th><th class="r">Overlap</th><th class="r analyst-only">Composite</th></tr></thead>
          <tbody>${f.closest.map((c) => `
            <tr data-fund="${esc(c.key)}" tabindex="0"><td>${esc(c.name)}</td>
              <td class="r mono">${num(c.overlap, 0)}%</td>
              <td class="r mono analyst-only">${score(c.composite, 1)}</td></tr>`).join('')
            || '<tr><td colspan="3" class="muted">No disclosed book to compare.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;

  Chart.blockBar($('#blockbar'), f.blocks);
  Chart.bars($('#holdbars'), f.holdings.map((h) => ({ label: h.name, value: h.weight })),
    { suffix: '%', decimals: 2, colorFor: (x) => Chart.seqColor(x.value / 10),
      tipFor: (x) => {
        const h = f.holdings.find((z) => z.name === x.label) || {};
        return `<strong>${esc(x.label)}</strong>
          <div class="tt-row"><span>Weight</span><span>${num(x.value, 2)}%</span></div>
          <div class="tt-row"><span>Sector</span><span>${esc(h.sector || '—')}</span></div>
          <div class="tt-row"><span>Cap</span><span>${esc(h.cap || '—')}</span></div>`;
      } });
  host.querySelector('.close').onclick = () => { host.hidden = true; state.fund = null; };
  host.querySelectorAll('[data-fund]').forEach((el) =>
    el.onclick = () => openFund(el.dataset.fund));
}

function metricRows(f) {
  const rows = [
    ['Median rolling 3Y', f.medianRolling3Y, '%'],
    ['Median rolling 5Y', f.medianRolling5Y, '%'],
    ['Sharpe 3Y', f.sharpe3Y, ''],
    ['Sortino 3Y', f.sortino3Y, ''],
    ['Information Ratio 3Y', f.informationRatio3Y, ''],
    ['Upside capture', f.upsideCapture3Y, ''],
    ['Downside capture', f.downsideCapture3Y, ''],
    ['Maximum drawdown', f.maxDrawdown3Y, '%'],
    ['AUM', f.aumCr, ' cr'],
    ['Live record', f.vintageYears, ' yrs'],
    ['Manager tenure', f.managerYears, ' yrs'],
    ['Effective holdings', f.effectiveStocks, ''],
    ['Top 10 weight', f.top10, '%'],
    ['Mandate fit', f.mandateFit, '%'],
    ['Differentiation', f.differentiation, '%'],
  ];
  return rows.map(([k, v, u]) => `<tr><td>${esc(k)}</td>
    <td class="r mono">${v == null ? '—' : num(v, 2) + u}</td></tr>`).join('');
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
    b.onclick = () => { state.mode = b.dataset.mode; applyMode(); });
  $('#tabs').querySelectorAll('button').forEach((b) =>
    b.onclick = () => setView(b.dataset.view));
  try {
    [state.fw, state.meta] = await Promise.all([get('/framework'), get('/meta')]);
    state.fw.minEvidence = state.meta.minEvidence ?? 55;
    const m = state.meta;
    $('#buildmeta').innerHTML = `${m.inScope} schemes in scope · ${m.scored} rated ·
      ${m.withHoldings} with a disclosed book`;
    render();
  } catch (e) {
    $('#main').innerHTML = `<div class="error"><strong>Backend unavailable.</strong>
      <span>${esc(e.message)}</span></div>`;
  }
})();
