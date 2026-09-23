/* The fund page.
 *
 * Loaded after app.js. It declares `renderFundPage` again, which replaces the
 * one in app.js (a later classic script's function declaration wins), and
 * leans on app.js for everything shared: `get`, `esc`, `num`, `cr`, `state`,
 * `setView`, `togglePick`, `paintPickButton`, `isPicked`, `superseded`,
 * `fmtDay`, `fmtInception`, `sameHands`, `wireGlossary`, `VIEW_LABEL`,
 * `PERIOD_LABEL`, `fundRec`, and `Chart` from charts.js. Everything new here
 * is prefixed `fp` so nothing collides with an app.js global.
 *
 * The layout, the order of the cards and the wording are the locked mock:
 * returns on top, growth over drawdown on one timeline with the three worst
 * falls lettered A to F, risk and the book beside it, the top holdings against
 * the category's other books, the managers with their own record on the
 * scheme, and two lists of plain sentences. No score, band, rank or decile is
 * drawn anywhere on it.
 */

const FP_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FP_INK = { fund: '#2c3441', index: '#9ab3db', category: '#cc1919' };
const FP_DASH = { category: '4 3' };

/* Signed, and signed as printed: -0.04 at one decimal is 0.0, not -0.0. */
const fpRound = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d || 0;
const fpSign = (v, d = 1) => v == null || Number.isNaN(v) ? '—'
  : (fpRound(v, d) > 0 ? '+' : '') + num(fpRound(v, d), d);
const fpPct = (v, d = 1) => v == null || Number.isNaN(v) ? '—' : num(v, d) + '%';
const fpMonY = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return `${FP_MON[d.getMonth()]} ${d.getFullYear()}`;
};
/* "Nifty 50 TRI" is the series; "Nifty 50" is how a sentence names it. */
const fpShort = (name) => String(name || 'benchmark').replace(/\s*TRI$/, '');
/* The letter for an episode's start (A, C, E) or end (B, D, F). */
const fpLetter = (i, end) => String.fromCharCode(65 + i * 2 + (end ? 1 : 0));

/* The width a chart is drawn at is the width it is shown at. A fixed 820 wide
   drawing shrunk to a phone took its 11px labels down to 5px with it. */
const fpChartWidth = (host) => Math.round(Math.min(820, Math.max(300, host.clientWidth || 820)));

const fpSvgText = (x, y, t, anchor = 'start', size = 11) =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" fill="#808285" `
  + `font-family="var(--font_primary)">${t}</text>`;

/* ------------------------------------------------------------- the page */

async function renderFundPage(host, token) {
  host.innerHTML = '<div class="loading">Reading the record…</div>';
  const f = await get('/fund/' + encodeURIComponent(state.fund));
  if (superseded(token)) return;
  fundRec = f;
  fpBook = null;                                   // the full book, fetched on demand
  const back = state.returnView || 'shortlist';
  const rows = (f.returns || {}).rows || [];
  const bench = fpShort((f.returns || {}).benchmark);
  const dd = f.drawdowns || {};
  const rec = (label) => rows.find((r) => r.label === label) || { p2p: {}, rolling: {} };
  // The band quotes three years; a fund younger than that quotes the longest
  // horizon it has, and says which.
  const long = ['3Y', '1Y', '6M'].map(rec).find((r) => r.p2p.fund != null) || rec('3Y');

  host.innerHTML = `
  <div class="fundpage">
    <button class="backlink fp-back" id="fp-back">&lsaquo; Back to ${
      esc(VIEW_LABEL[back] || 'the list')}</button>

    <section class="fp-band" id="fp-band">
      <button class="fp-pdf" id="fp-pdf" title="Print, or save as PDF"
              aria-label="Print, or save as PDF">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>
          <path d="M14 3v5h5"/><path d="M12 11v6"/><path d="M9.5 14.5 12 17l2.5-2.5"/>
        </svg></button>
      <div>
        <span class="fp-tag ondark">${esc(f.category)}${f.amc ? '  ·  ' + esc(f.amc) : ''}</span>
        <h1>${esc(f.name)}</h1>
      </div>
      <div class="fp-keystats" id="fp-keystats"></div>
      <div class="fp-actions">
        <button class="fp-btn_cta${isPicked(f.key) ? ' ghost' : ''}" id="fp-pick">
          <span class="arrow"><svg width="16" height="12" viewBox="0 0 16 12" fill="none">
            <path d="M1 6h13M9 1l5 5-5 5" stroke="#fff" stroke-width="1.6"
                  stroke-linecap="round" stroke-linejoin="round"/></svg></span>
          <span class="fp-picklabel" data-picklabel="${esc(f.key)}"></span>
        </button>
      </div>
    </section>

    <div class="fp-grid fp-stagger">
      <section class="fp-card fp-c12">
        <div class="eye"><span class="fp-tag">Returns</span>
          <span class="note">against ${esc((f.returns || {}).benchmark || 'the benchmark')}</span></div>
        <div class="fp-scroll">${fpReturnsTable(f)}</div>
        <div class="foot">Point to point is annualised beyond one year; median rolling is
          the middle of every window of that length; calendar years are not annualised.
          Alpha is the gap to the ${esc(bench)} on the same basis.</div>
      </section>
    </div>

    <div class="fp-grid fp-reveal">
      <section class="fp-card fp-c8">
        <div class="eye"><span class="fp-tag">Growth and drawdowns</span>
          <span class="note" id="fp-g-note"></span></div>
        <div class="fp-periods" id="fp-periods"></div>
        <div class="fp-combo">
          <div id="fp-c-growth"></div>
          <div class="fp-key" id="fp-g-key"></div>
          <div class="lab" id="fp-uw-lab"></div>
          <div id="fp-c-under"></div>
        </div>
        <div class="fp-episodes" id="fp-episodes"></div>
      </section>
      <div class="fp-c4 fp-stack">
        <section class="fp-card opens" tabindex="0" data-fpmodal="risk">
          <div class="eye"><span class="fp-tag">Risk</span><span class="note">last three years</span></div>
          <div class="fp-stats four">${[['Sharpe', f.sharpe3Y], ['Sortino', f.sortino3Y],
              ['Information ratio', f.informationRatio3Y], ['Beta', f.beta3Y]].map(([d, v]) =>
              `<div class="stat"><div class="n num">${num(v, 2)}</div><div class="d">${d}</div></div>`).join('')}
          </div>
          <div class="fp-bars" id="fp-capture">${fpCaptureBars(f)}</div>
          <dl class="fp-kv">
            <dt class="fp-kv-note">Capture: for every 100 the ${esc(bench)} moved, how much
              this fund moved, in rises and in falls</dt>
            <dt>Maximum drawdown, 3Y</dt><dd class="num">${num(f.maxDrawdown3Y, 1)}%</dd>
            <dt>3Y windows beating the index</dt><dd class="num">${f.rollingHitRate3Y == null ? '—'
              : num(f.rollingHitRate3Y, 0) + '%'}</dd>
          </dl>
          <div class="corner"></div>
        </section>
        <section class="fp-card opens" tabindex="0" data-fpmodal="holds">
          <div class="eye"><span class="fp-tag">The book</span><span class="note">shape and cap mix</span></div>
          <div class="fp-holds">
            <div class="ring"><div class="fp-donut" id="fp-donut"></div>
              <div class="fp-donutkey" id="fp-donutkey"></div></div>
            <div class="fp-shape4">${[[fpPct(f.topFive, 0), 'Top 5 weight'],
                [fpPct(f.top10, 0), 'Top 10 weight'],
                [fpPct(f.largestPosition, 1), 'Largest position'],
                [num(f.holdingCount, 0), 'Names held']].map(([v, d]) =>
                `<div><div class="n num">${v}</div><div class="d">${d}</div></div>`).join('')}
            </div>
          </div>
          <dl class="fp-kv">
            <dt>In common with the average ${esc(f.category)} book</dt>
              <dd class="num">${fpPct(f.categoryOverlap, 0)}</dd>
            <dt>Meets the ${esc(f.category)} mandate</dt>
              <dd class="num">${f.mandateFit == null ? '—'
                : f.mandateFit >= 100 ? 'yes' : num(f.mandateFit, 0) + '%'}</dd>
          </dl>
          <div class="corner"></div>
        </section>
      </div>
    </div>

    <div class="fp-grid fp-reveal">
      <section class="fp-card fp-c7 opens" tabindex="0" data-fpmodal="book">
        <div class="eye"><span class="fp-tag">Top holdings</span>
          <span class="note">${f.holdingCount
            ? `largest ${(f.holdings || []).length} of ${f.holdingCount} · peers: average of ${
                num(f.peerCount, 0)} ${esc(f.category)} funds`
            : 'no disclosed book'}</span></div>
        <div class="fp-scroll">${fpHoldingsTable(f)}</div>
        <div class="corner"></div>
      </section>
      <div class="fp-c5 fp-stack">
        <section class="fp-card">
          <div class="eye"><span class="fp-tag">Largest sectors</span><span class="note">of the equity book</span></div>
          <div class="fp-bars fp-secbars">${fpSectorBars(f)}</div>
        </section>
        <section class="fp-card opens" tabindex="0" data-fpmodal="who">
          <div class="eye"><span class="fp-tag">Who runs it</span>
            <span class="note">the managers with a dated start on the fund</span></div>
          ${fpManagerTable(f)}
          <div class="corner"></div>
        </section>
      </div>
    </div>

    <div class="fp-grid fp-reveal">
      <section class="fp-card fp-c6">
        <div class="eye"><span class="fp-tag">Key points</span><span class="note">from the record</span></div>
        <div class="fp-pts2 tight">${fpPoints(f.about)}</div>
      </section>
      <section class="fp-card fp-c6">
        <div class="eye"><span class="fp-tag">Recently</span><span class="note">what has happened to it</span></div>
        <div class="fp-pts2 tight">${fpPoints(f.recent)}</div>
      </section>
    </div>
  </div>`;

  // --- the band's figures ------------------------------------------------
  fpKeystats(f, long, bench);

  // --- the visuals -------------------------------------------------------
  fpDonut(f);
  fpUnderwater(f);
  fpDrawGrowth(f.key, state.growthPeriod || '1y', bench);

  // --- wiring ------------------------------------------------------------
  $('#fp-back').onclick = () => { state.fund = null; setView(back); };
  $('#fp-pdf').onclick = () => window.print();
  const pick = $('#fp-pick');
  paintPickButton(pick.querySelector('[data-picklabel]'), isPicked(f.key));
  pick.onclick = () => togglePick(f.key);
  host.querySelectorAll('[data-fpmodal]').forEach((c) => {
    c.onclick = (e) => {
      if (e.target.closest('.term, a, button')) return;
      fpOpenModal(c.dataset.fpmodal, c);
    };
    c.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fpOpenModal(c.dataset.fpmodal, c); }
    };
  });
  fpReveal(host);
  fpCrumb(f.name);
  wireGlossary(host);
}

/* ------------------------------------------------------------- the band */

function fpKeystats(f, long, bench) {
  const el = $('#fp-keystats');
  if (!el) return;
  const KS = [
    ['AUM', f.aumCr, 0, 'INR ', 'cr'],
    [`${long.label} return`, long.p2p.fund, 1, '', '%'],
    [`Alpha, ${long.label}`, long.p2p.alpha, 1, '+', `vs ${esc(bench)}`],
    ['Downside capture', f.downsideCapture3Y, 0, '', 'of the index'],
  ];
  const text = (v, d, pre) => v == null ? '—'
    : (pre === '+' ? (v > 0 ? '+' : '') : pre) + num(v, d);
  el.innerHTML = KS.map(([k, v, d, pre, suf], i) => `<div><span class="k">${k}</span>
    <span class="v num" data-i="${i}">${text(v, d, pre)}<small>${suf}</small></span></div>`).join('');
  // The figures settle in over half a second rather than appearing.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  KS.forEach(([k, v, d, pre, suf], i) => {
    if (v == null || v === 0) return;
    const node = el.querySelector(`[data-i="${i}"]`);
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 500), e = 1 - Math.pow(1 - p, 3);
      node.innerHTML = `${text(v * e, d, pre)}<small>${suf}</small>`;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/* ------------------------------------------------------------ returns */

/* Point to point, median rolling and calendar years on one row each for the
   fund, the benchmark and the gap. An alpha cell is tinted by how far ahead
   or behind it is, so a row of five years reads as a shape before it reads as
   five numbers. */
function fpReturnsTable(f) {
  const rows = (f.returns || {}).rows || [];
  if (!rows.length) return '<p class="fp-empty">No return record on file.</p>';
  const roll = rows.filter((r) => ['3Y', '5Y'].includes(r.label));
  const cy = f.cy || [];
  const benchCY = f.benchCY || {};
  const cell = (v, sep) => v == null ? `<td class="na${sep ? ' sep' : ''}">—</td>`
    : `<td class="num${sep ? ' sep' : ''}">${num(v, 1)}</td>`;
  const alpha = (v, sep) => {
    if (v == null) return `<td class="na${sep ? ' sep' : ''}">—</td>`;
    const a = Math.min(0.26, Math.abs(v) / 8 * 0.26).toFixed(3);
    const tint = v >= 0 ? `rgba(47,125,95,${a})` : `rgba(192,0,0,${a})`;
    return `<td class="num ${v >= 0 ? 'up' : 'down'}${sep ? ' sep' : ''}" style="background:${tint}">${fpSign(v, 1)}</td>`;
  };
  const line = (label, pick, isAlpha) => {
    const fmt = isAlpha ? alpha : cell;
    return `<tr${isAlpha ? ' class="alpha"' : ''}><td>${label}</td>${
      rows.map((r) => fmt(pick(r.p2p))).join('')}${
      roll.map((r, i) => fmt(pick(r.rolling), i === 0)).join('')}${
      cy.map(([y, k], i) => {
        const fv = f[k], bv = benchCY[k];
        const v = isAlpha ? (fv != null && bv != null ? fv - bv : null)
          : label === 'Fund' ? fv : bv;
        return fmt(v, i === 0);
      }).join('')}</tr>`;
  };
  return `<table class="fp-rettable">
    <thead>
      <tr class="grp"><th></th><th colspan="${rows.length}">Point to point · % a year past 1Y</th>
        <th colspan="${roll.length}">Median rolling</th><th colspan="${cy.length}">Calendar year</th></tr>
      <tr><th></th>${rows.map((r) => `<th>${esc(r.label)}</th>`).join('')}${
        roll.map((r, i) => `<th class="${i ? '' : 'sep'}">${esc(r.label)}</th>`).join('')}${
        cy.map(([y], i) => `<th class="${i ? '' : 'sep'}">${esc(y)}</th>`).join('')}</tr>
    </thead>
    <tbody>${line('Fund', (h) => h.fund)}${
      line(esc((f.returns || {}).benchmark || 'Benchmark'), (h) => h.bench)}${
      line('Alpha', (h) => h.alpha, true)}</tbody>
  </table>`;
}

/* ------------------------------------------------------------- growth */

let fpNavSeq = 0;

async function fpDrawGrowth(key, period, bench) {
  const host = $('#fp-c-growth');
  if (!host) return;
  const mine = ++fpNavSeq;
  host.innerHTML = '<div class="loading sm">Reading NAV history…</div>';
  let g;
  try {
    g = await get(`/nav/${encodeURIComponent(key)}?period=${encodeURIComponent(period)}`);
  } catch (e) {
    host.innerHTML = '<div class="fp-empty">Could not load NAV history.</div>';
    return;
  }
  if (state.fund !== key || mine !== fpNavSeq || !$('#fp-c-growth')) return;
  state.growthPeriod = g.period || period;

  const bar = $('#fp-periods');
  if (bar) {
    bar.innerHTML = (g.periods || ['1y']).map((p) =>
      `<span class="${p === state.growthPeriod ? 'on' : ''}" data-period="${p}" role="button"
         tabindex="0" aria-pressed="${p === state.growthPeriod}">${PERIOD_LABEL[p] || p}</span>`).join('');
    bar.querySelectorAll('[data-period]').forEach((b) => {
      b.onclick = () => fpDrawGrowth(key, b.dataset.period, bench);
      b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.click(); } };
    });
  }
  if (!g.series || !g.series.length) {
    host.innerHTML = `<div class="fp-empty">${esc(g.unavailable || 'No NAV history')}</div>`;
    $('#fp-g-key').innerHTML = '';
    return;
  }
  fpGrowthSvg(host, g, bench);
}

/* Growth of 100, the fund's line drawn over a green or red wash for the gap to
   the index on each day. The fund's own line draws itself left to right. */
function fpGrowthSvg(host, g, bench) {
  const live = g.series.filter((s) => s.days && s.days.length > 1);
  const f = live.find((s) => s.code === 'fund');
  if (!f) { host.innerHTML = '<div class="fp-empty">No NAV history</div>'; return; }
  const W = fpChartWidth(host), H = W < 600 ? 200 : 250, m = { l: 44, r: 14 }, mt = 12, mb = 8;
  const t0 = Date.parse(f.days[0]), t1 = Date.parse(f.days[f.days.length - 1]);
  const sx = (d) => m.l + (Date.parse(d) - t0) / ((t1 - t0) || 1) * (W - m.l - m.r);
  const all = live.flatMap((s) => s.values);
  let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad; hi += pad;
  const sy = (v) => mt + (H - mt - mb) * (1 - (v - lo) / (hi - lo));
  let svg = `<svg class="fp-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Growth of 100 rupees">`;
  const step = (hi - lo) > 60 ? 20 : (hi - lo) > 30 ? 10 : 5;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const y = sy(v);
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="${v === 0 ? '#cfcfd0' : '#eceef1'}" stroke-width="${v === 0 ? 1.2 : 1}"/>`
      + fpSvgText(m.l - 7, y + 3.5, `${v > 0 ? '+' : ''}${v}%`, 'end');
  }
  const path = (s) => s.days.map((d, i) =>
    `${i ? 'L' : 'M'}${sx(d).toFixed(1)},${sy(s.values[i]).toFixed(1)}`).join('');
  const ix = live.find((s) => s.code === 'index');
  if (ix) {
    const at = (d) => {
      let a = 0, b = ix.days.length - 1;
      while (a < b) { const c = (a + b + 1) >> 1; if (ix.days[c] <= d) a = c; else b = c - 1; }
      return ix.values[a];
    };
    for (let i = 1; i < f.days.length; i++) {
      const a0 = f.values[i - 1], a1 = f.values[i], b0 = at(f.days[i - 1]), b1 = at(f.days[i]);
      const up = (a0 - b0) + (a1 - b1) >= 0;
      svg += `<path d="M${sx(f.days[i - 1]).toFixed(1)},${sy(a0).toFixed(1)} L${sx(f.days[i]).toFixed(1)},${sy(a1).toFixed(1)} L${sx(f.days[i]).toFixed(1)},${sy(b1).toFixed(1)} L${sx(f.days[i - 1]).toFixed(1)},${sy(b0).toFixed(1)} Z" fill="${up ? '#2f7d5f' : '#c00000'}" opacity=".16" stroke="none"/>`;
    }
  }
  live.filter((s) => s.code !== 'fund').forEach((s) => {
    svg += `<path d="${path(s)}" fill="none" stroke="${FP_INK[s.code] || '#808285'}" stroke-width="1.4" ${
      FP_DASH[s.code] ? `stroke-dasharray="${FP_DASH[s.code]}"` : ''} stroke-linejoin="round"/>`;
  });
  svg += `<path class="fp-fundline draw" d="${path(f)}" fill="none" stroke="#2c3441" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<circle cx="${sx(f.days[f.days.length - 1])}" cy="${sy(f.values[f.values.length - 1])}" r="4" fill="#2c3441" stroke="#fff" stroke-width="1.5"/>`
    + `<line class="fp-rule" x1="0" x2="0" y1="${mt}" y2="${H - mb}" stroke="#46556b" stroke-width="1" opacity="0"/>`
    + `<rect class="fp-hit" x="${m.l}" y="${mt}" width="${W - m.l - m.r}" height="${H - mt - mb}" fill="transparent"/></svg>`;
  host.innerHTML = svg;
  const p = host.querySelector('.fp-fundline');
  p.style.setProperty('--len', p.getTotalLength());

  // The pointer reads a date off every line.
  const hit = host.querySelector('.fp-hit'), rule = host.querySelector('.fp-rule');
  const svgEl = host.querySelector('svg');
  const idxAt = (s, t) => {
    let a = 0, b = s.days.length - 1;
    while (a < b) { const c = (a + b + 1) >> 1; if (Date.parse(s.days[c]) <= t) a = c; else b = c - 1; }
    return a;
  };
  hit.addEventListener('mousemove', (e) => {
    const box = svgEl.getBoundingClientRect();
    const px = (e.clientX - box.left) / box.width * W;
    const t = t0 + (px - m.l) / (W - m.l - m.r) * (t1 - t0);
    const j = idxAt(f, t);
    rule.setAttribute('x1', sx(f.days[j])); rule.setAttribute('x2', sx(f.days[j]));
    rule.setAttribute('opacity', 1);
    const rowsHtml = live.map((s) => `<div class="tt-row"><span><i class="swatch" style="background:${
      FP_INK[s.code] || '#808285'}"></i>${esc(s.label)}</span><span>${
      fpSign(s.values[idxAt(s, t)], 1)}%</span></div>`).join('');
    Chart.showTip(e, `<strong>${fmtDay(f.days[j])}</strong>${rowsHtml}`);
  });
  hit.addEventListener('mouseleave', () => { rule.setAttribute('opacity', 0); Chart.hideTip(); });

  const ixEnd = ix ? ix.values[ix.values.length - 1] : null;
  $('#fp-g-key').innerHTML = live.map((s) => {
    const end = s.values[s.values.length - 1];
    return `<span><i style="background:${FP_INK[s.code] || '#808285'}"></i>${esc(s.label)}<b>${fpSign(end)}%</b>${
      s.code === 'fund' && ixEnd != null
        ? `<b style="color:${end - ixEnd >= 0 ? 'var(--up)' : 'var(--down)'}">${fpSign(end - ixEnd)} vs ${esc(ix.label)}</b>` : ''}</span>`;
  }).join('');
  const note = $('#fp-g-note');
  if (note) note.textContent = `${fmtDay(g.start)} to ${fmtDay(g.end)}${
    ix ? ` · green ahead of the ${fpShort(ix.label)}, red behind` : ''}`;
}

/* --------------------------------------------------------- underwater */

/* The whole record as time below its previous high, with each of the three
   worst falls shaded from the letter where it began to the letter where it was
   back at its high. A dotted end is a fall still open. */
function fpUnderwater(f) {
  const host = $('#fp-c-under'), lab = $('#fp-uw-lab'), eps = $('#fp-episodes');
  const D = f.drawdowns || {};
  if (!host) return;
  if (D.unavailable || !(D.days || []).length) {
    host.innerHTML = `<div class="fp-empty">${esc(D.unavailable || 'No NAV history')}</div>`;
    lab.textContent = 'Time below its previous high';
    eps.innerHTML = '';
    return;
  }
  const days = D.days, vals = D.values, worst = D.worst || [];
  const W = fpChartWidth(host), H = 118, m = { l: 44, r: 14 }, mt = 8, mb = 20;
  const T0 = Date.parse(days[0]), T1 = Date.parse(days[days.length - 1]);
  const ux = (d) => m.l + (Date.parse(d) - T0) / ((T1 - T0) || 1) * (W - m.l - m.r);
  const lo = Math.min(-1, ...vals);
  const sy = (v) => mt + (H - mt - mb) * v / lo;
  let svg = `<svg class="fp-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Time below the high water mark">`;
  worst.forEach((w) => {
    const x0 = ux(w.peak), x1 = ux(w.recovered || days[days.length - 1]);
    svg += `<rect x="${x0}" y="${mt}" width="${Math.max(2, x1 - x0)}" height="${H - mt - mb}" fill="#cc1919" opacity=".07"/>`;
  });
  [0, lo].forEach((v) => {
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(v)}" y2="${sy(v)}" stroke="#eceef1"/>`
      + fpSvgText(m.l - 7, sy(v) + 3.5, `${Math.round(v)}%`, 'end');
  });
  // Year lines go down under the line and the letters, so a fall that begins
  // in January keeps its letter on top. A year too close to "today" to print
  // beside it is left off.
  svg += fpSvgText(m.l, H - 5, fpMonY(days[0]));
  for (let y = new Date(T0).getFullYear() + 1; y <= new Date(T1).getFullYear(); y++) {
    const x = ux(`${y}-01-01`);
    if (x - m.l < 70 || W - m.r - x < 72) continue;
    svg += `<line x1="${x}" x2="${x}" y1="${mt}" y2="${H - mb}" stroke="#eceef1"/>` + fpSvgText(x + 3, H - 5, y);
  }
  const p = vals.map((v, i) => `${i ? 'L' : 'M'}${ux(days[i]).toFixed(1)},${sy(v).toFixed(1)}`).join('');
  svg += `<path d="${p} L${ux(days[days.length - 1])},${sy(0)} L${ux(days[0])},${sy(0)} Z" fill="#cc1919" opacity=".1"/>`
    + `<path d="${p}" fill="none" stroke="#cc1919" stroke-width="1.2"/>`;
  /* One fall can end a few weeks before the next begins (D and E), which put
     their two letters on top of each other. A letter that would touch the one
     before it drops a row instead. */
  const marks = worst.flatMap((w, i) => [
    { x: ux(w.peak), t: fpLetter(i, false), open: false },
    { x: ux(w.recovered || days[days.length - 1]), t: fpLetter(i, true), open: !w.recovered },
  ]).sort((a, b) => a.x - b.x);
  marks.forEach((k, i) => {
    const prev = marks[i - 1];
    k.row = prev && !prev.row && k.x - prev.x < 20 ? 1 : 0;
  });
  marks.forEach(({ x, t, open, row }) => {
    const y = mt - 1 + row * 16;
    svg += `<line x1="${x}" x2="${x}" y1="${mt}" y2="${H - mb}" stroke="#2c3441" stroke-width="1" ${open ? 'stroke-dasharray="2 3"' : ''}/>`
      + `<rect x="${x - 7}" y="${y}" width="14" height="14" rx="3" fill="${open ? '#fff' : '#2c3441'}" stroke="#2c3441"/>`
      + `<text x="${x}" y="${y + 11}" text-anchor="middle" font-size="9.5" font-weight="500" fill="${
        open ? '#2c3441' : '#fff'}" font-family="var(--font_primary)">${t}</text>`;
  });
  svg += fpSvgText(W - m.r, H - 5, 'today', 'end') + '</svg>';
  host.innerHTML = svg;

  lab.innerHTML = `Time below its previous high, whole record since ${fpMonY(days[0])}${
    worst.length ? ` · <span class="lab-plain">each shaded stretch is one of the ${
      worst.length === 1 ? 'worst fall' : worst.length + ' worst falls'}: from the letter where it began to the letter where it was back at its high; a dotted end is a fall still open</span>` : ''}`;
  const idxName = fpShort(D.indexName || 'index');
  eps.innerHTML = worst.length ? worst.map((w, i) => {
    const back = w.recovered
      ? `was back at its previous high ${num(w.toRecover, 0)} months later`
      : 'has not yet returned to that high';
    const idx = w.indexFall == null ? ''
      : ` The ${esc(idxName)} fell ${num(Math.abs(w.indexFall), 1)}% over the same stretch.`;
    return `<div class="ep"><span class="ep-h">${fpLetter(i, false)} to ${fpLetter(i, true)} · ${
      fpMonY(w.peak)} to ${w.recovered ? fpMonY(w.recovered) : 'today'}</span>
      <b class="num">${num(w.depth, 1)}%</b>
      <p>Fell for ${num(w.toBottom, 0)} months to this low and ${back}.${idx}</p></div>`;
  }).join('')
    : `<div class="ep"><span class="ep-h">No fall past ${num(D.floor || 8, 0)}%</span>
        <p>Nothing on the record has fallen further than ${num(D.floor || 8, 0)}% from a high.</p></div>`;
}

/* ------------------------------------------------------- risk and book */

function fpCaptureBars(f) {
  const up = f.upsideCapture3Y, dn = f.downsideCapture3Y;
  if (up == null && dn == null) return '<p class="fp-empty">No capture figures on file.</p>';
  const max = Math.max(100, up || 0, dn || 0);
  return [['Upside capture', up, '#2c3441'], ['Downside capture', dn, '#f28275']].map(([l, v, ink]) =>
    `<div class="bar"><span class="l">${l}</span><span class="t">
      <span class="f" style="width:${(v || 0) / max * 100}%;background:${ink}"></span>
      <span class="hund" style="left:${100 / max * 100}%"></span></span>
      <span class="v num">${num(v, 0)}</span></div>`).join('');
}

function fpDonut(f) {
  const host = $('#fp-donut'), key = $('#fp-donutkey');
  if (!host) return;
  const sl = [['Large cap', f.largeCapPct, '#2c3441'], ['Mid cap', f.midCapPct, '#7e94b6'],
              ['Small cap', f.smallCapPct, '#c3dff4'], ['Cash and others', f.cashPct, '#e7e8ea']];
  const slices = sl.map(([label, value, ink]) => ({ label, value: value || 0, ink }));
  if (!slices.some((s) => s.value > 0)) {
    host.innerHTML = '<p class="fp-empty">No allocation on file.</p>';
    return;
  }
  Chart.donut(host, slices, { size: 104, thickness: 18,
    centreLabel: `${num(100 - (f.cashPct || 0), 0)}%`, centreNote: 'in equities' });
  key.innerHTML = sl.map(([l, v, ink]) =>
    `<span><i style="background:${ink}"></i>${l}<b class="num">${num(v, 0)}%</b></span>`).join('');
}

function fpSectorBars(f) {
  const s = (f.sectors || []).slice(0, 6);
  if (!s.length) return '<p class="fp-empty">No sector detail on file.</p>';
  const max = s[0].weight || 1;
  return s.map((x, i) => `<div class="bar"><span class="l" title="${esc(x.sector)}">${esc(x.sector)}</span>
    <span class="t"><span class="f ${i ? '' : 'lead'}" style="width:${x.weight / max * 100}%"></span></span>
    <span class="v num">${num(x.weight, 0)}%</span></div>`).join('');
}

function fpHoldingsTable(f) {
  const h = (f.holdings || []).slice(0, 10);
  if (!h.length) return '<p class="fp-empty">No security level holdings are collected for this scheme.</p>';
  // Membership is read off a Nifty 50 index fund's book. Without one on file
  // every row would be a dash, so the column is left off rather than drawn empty.
  const hasN50 = h.some((x) => x.inNifty50 != null);
  const n50 = (x) => x.inNifty50 == null ? '<span class="na">—</span>'
    : x.inNifty50 ? '<span class="n50">Nifty 50</span>' : '<span class="na">no</span>';
  return `<table class="fp-htable"><thead><tr><th>#</th><th class="left">Holding</th><th>Fund</th>
      <th>${esc(f.category)} peers</th><th>Difference</th>${hasN50 ? '<th>In Nifty 50</th>' : ''}</tr></thead>
    <tbody>${h.map((x, i) => {
      const d = x.peerWeight == null ? null : fpRound(x.weight - x.peerWeight, 1);
      return `<tr><td class="num idx">${i + 1}</td>
        <td>${esc(x.name)}<small>${esc(x.sector || '')}</small></td>
        <td class="num">${num(x.weight, 1)}%</td>
        <td class="num dim">${x.peerWeight == null ? '—' : num(x.peerWeight, 1) + '%'}</td>
        <td class="num ${d == null ? 'na' : d > 0 ? 'up' : d < 0 ? 'down' : 'dim'}">${d == null ? '—' : fpSign(d, 1)}</td>
        ${hasN50 ? `<td class="mid">${n50(x)}</td>` : ''}</tr>`; }).join('')}</tbody></table>`;
}

/* ------------------------------------------------------------ managers */

/* Longest serving first. Only a manager with a dated start on the scheme gets a
   row, because the row is their record on it; the rest are named underneath. */
function fpManagers(f) {
  const all = [...(f.managers || [])].sort((a, b) => (b.tenureYears || 0) - (a.tenureYears || 0));
  return { all, main: all.filter((m) => m.sinceBasis), rest: all.filter((m) => !m.sinceBasis) };
}

function fpManagerTable(f) {
  const { all, main, rest } = fpManagers(f);
  if (!all.length) return '<p class="fp-empty">No manager record on file for this scheme.</p>';
  const extra = (name) => (f.managerExtra || []).find((e) => e.name === name) || {};
  const bench = (main.map((m) => (extra(m.name).record || {}).indexName).find(Boolean)) || 'the index';
  const body = main.map((m, i) => {
    const r = extra(m.name).record;
    return `<tr><td>${esc(m.name)}${i === 0 ? ' <span class="fp-pill">lead</span>' : ''}
        <small>since ${fpMonY(m.sinceBasis)} · ${num(m.tenureYears, 1)} yrs</small></td>
      <td class="num">${m.experienceYears == null ? '—' : num(m.experienceYears, 0) + ' yrs'}</td>
      <td class="num">${r ? `<span class="${r.index == null ? '' : r.fund >= r.index ? 'up' : 'down'} strong">${
        fpSign(r.fund)}%</span>${r.index == null ? '' : ` vs ${fpSign(r.index)}%`}${
        r.annualised ? '<small class="pa">a year</small>' : ''}` : '<span class="na">—</span>'}</td></tr>`;
  }).join('');
  const also = rest.length ? `<tr><td colspan="3" class="also">${main.length ? 'Also named' : 'Named, without a dated start'}: ${
    rest.map((m) => esc(m.name)).join(', ')}.</td></tr>` : '';
  const longest = all[0];
  const same = sameHands(f, longest);
  return `<table class="fp-mtable"><thead><tr><th>Manager</th><th>Exp.</th>
      <th>Since joining · vs ${esc(fpShort(bench))}</th></tr></thead>
    <tbody>${body}${also}</tbody></table>
    <dl class="fp-kv"><dt>Fund since</dt><dd>${fmtInception(f.inceptionDate)}</dd>${
      same != null ? `<dt>Same hands for</dt><dd class="num">${num(same, 0)}% of its life</dd>` : ''}</dl>`;
}

/* --------------------------------------------------------- the points */

function fpPoints(items) {
  if (!(items || []).length) return '<p class="fp-empty">Nothing to say yet.</p>';
  return items.map((x) => `<div><span class="fig num ${esc(x.tone || '')}">${esc(x.fig)}</span>
    <span class="txt"><b>${esc(x.head)}</b>${esc(x.text)}</span></div>`).join('');
}

/* ------------------------------------------------------------- modals */

/* The detail behind a card grows out of the card that was clicked and closes
   back into it: a FLIP from the card's rectangle to the panel's resting one. */
let fpBook = null;
let fpOpener = null;

function fpBackdrop() {
  let bd = $('#fp-backdrop');
  if (bd) return bd;
  bd = document.createElement('div');
  bd.id = 'fp-backdrop';
  bd.className = 'fp-backdrop';
  bd.setAttribute('aria-hidden', 'true');
  bd.innerHTML = '<div class="fp-modal" role="dialog" aria-modal="true" id="fp-modal"></div>';
  document.body.appendChild(bd);
  let downOn = false;
  bd.addEventListener('mousedown', (e) => { downOn = e.target === bd; });
  bd.addEventListener('click', (e) => { if (e.target === bd && downOn) fpCloseModal(); });
  return bd;
}

function fpEsc(e) { if (e.key === 'Escape') fpCloseModal(); }

async function fpOpenModal(code, card) {
  const f = fundRec;
  if (!f) return;
  fpOpener = card || null;
  const bd = fpBackdrop(), mo = $('#fp-modal');
  const html = await fpModalHtml(code, f);
  if (fundRec !== f) return;                          // the reader moved on
  mo.innerHTML = html;
  bd.classList.remove('closing');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce && card) {
    const from = card.getBoundingClientRect();
    bd.style.visibility = 'hidden'; bd.classList.add('on');
    const to = mo.getBoundingClientRect();
    bd.classList.remove('on'); bd.style.visibility = '';
    mo.style.transition = 'none';
    mo.style.transform = `translate(${from.left - to.left}px,${from.top - to.top}px) scale(${
      from.width / to.width},${from.height / to.height})`;
    void mo.offsetWidth;
    mo.style.transition = '';
  }
  bd.classList.add('on');
  bd.setAttribute('aria-hidden', 'false');
  document.body.classList.add('fp-modal-open');
  mo.querySelector('.x').onclick = fpCloseModal;
  mo.querySelector('.x').focus();
  document.addEventListener('keydown', fpEsc);
  wireGlossary(mo);
}

function fpCloseModal() {
  const bd = $('#fp-backdrop'), mo = $('#fp-modal');
  if (!bd || !bd.classList.contains('on')) return;
  bd.classList.add('closing');
  bd.classList.remove('on');
  bd.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('fp-modal-open');
  document.removeEventListener('keydown', fpEsc);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce && fpOpener && fpOpener.isConnected) {
    const from = fpOpener.getBoundingClientRect(), to = mo.getBoundingClientRect();
    mo.style.transform = `translate(${from.left - to.left}px,${from.top - to.top}px) scale(${
      from.width / to.width},${from.height / to.height})`;
  }
  if (fpOpener && fpOpener.isConnected && fpOpener.focus) fpOpener.focus();
  fpOpener = null;
}

async function fpFullBook(f) {
  if (fpBook && fpBook.key === f.key) return fpBook;
  try {
    fpBook = await get('/holdings/' + encodeURIComponent(f.key));
  } catch (e) {
    fpBook = { key: f.key, holdings: f.holdings || [] };
  }
  return fpBook;
}

async function fpModalHtml(code, f) {
  const top = (tag, h) => `<div class="top"><div><span class="fp-tag">${tag}</span><h2>${h}</h2></div>
    <button class="x" aria-label="Close">&times;</button></div>`;
  const kv = (rows) => `<dl class="fp-kv">${rows.map(([k, v]) =>
    `<dt>${k}</dt><dd class="num">${v}</dd>`).join('')}</dl>`;

  if (code === 'risk') {
    const H = ['1Y', '2Y', '3Y', '5Y', '7Y', '10Y'];
    const M = [['Sharpe', 'sharpe', 2], ['Sortino', 'sortino', 2], ['Information ratio', 'informationRatio', 2],
               ['Beta', 'beta', 2], ['Standard deviation', 'stdDev', 1, '%'],
               ['Upside capture', 'upsideCapture', 0], ['Downside capture', 'downsideCapture', 0],
               ['Maximum drawdown', 'maxDrawdown', 1, '%']];
    const has = H.filter((h) => M.some(([, base]) => f[base + h] != null));
    return top('Risk', 'Every horizon the feed publishes') + `<table class="fp-modtable">
      <thead><tr><th></th>${has.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${M.map(([label, base, d, suf]) => `<tr><td>${label}</td>${has.map((h) =>
        f[base + h] == null ? '<td class="na">—</td>' : `<td class="num">${num(f[base + h], d)}${suf || ''}</td>`).join('')}</tr>`).join('')}
      </tbody></table>
      ${kv([['3Y windows beating the index', f.rollingHitRate3Y == null ? '—'
        : `${num(f.rollingHitRate3Y, 0)}% of ${num(f.rollingWindows3Y, 0)}`]])}
      <p class="fp-modnote">Capture is against the benchmark at 100. Standard deviation is shown for
        reference rather than judged on its own.</p>`;
  }
  if (code === 'holds') {
    const book = await fpFullBook(f);
    const agg = {};
    (book.holdings || []).forEach((h) => { agg[h.sector || 'Unclassified'] = (agg[h.sector || 'Unclassified'] || 0) + h.weight; });
    const sectors = Object.entries(agg).sort((a, b) => b[1] - a[1]);
    return top('The book', 'Every sector in the equity book')
      + (sectors.length ? kv(sectors.map(([s, w]) => [esc(s), num(w, 1) + '%']))
         : '<p class="fp-modnote">No security level holdings are collected for this scheme.</p>')
      + kv([['Large cap', num(f.largeCapPct, 1) + '%'], ['Mid cap', num(f.midCapPct, 1) + '%'],
            ['Small cap', num(f.smallCapPct, 1) + '%'], ['Cash and others', num(f.cashPct, 1) + '%']]);
  }
  if (code === 'book') {
    const book = await fpFullBook(f);
    const rows = book.holdings || [];
    return top('Top holdings', rows.length ? `Every position, ${rows.length} names` : 'No disclosed book')
      + (rows.length ? `<table class="fp-modtable left"><thead><tr><th>#</th><th class="left">Holding</th>
          <th class="left">Sector</th><th>Weight</th></tr></thead><tbody>${rows.map((h, i) =>
          `<tr><td class="num idx">${i + 1}</td><td class="left">${esc(h.name)}</td>
           <td class="left dim">${esc(h.sector || '')}</td><td class="num">${num(h.weight, 2)}%</td></tr>`).join('')}
        </tbody></table>` : '');
  }
  if (code === 'who') {
    const { all } = fpManagers(f);
    const worst = (f.drawdowns || {}).worst || [];
    const extra = (name) => (f.managerExtra || []).find((e) => e.name === name) || {};
    return top('Who runs it', 'Tenure on this scheme, not years in the industry') + `<table class="fp-modtable left">
      <thead><tr><th class="left">Manager</th><th class="left">Since</th><th>Tenure</th><th>Experience</th>
        <th>Record since joining</th>${worst.length ? '<th class="left">On the fund through</th>' : ''}</tr></thead>
      <tbody>${all.map((m) => {
        const x = extra(m.name), r = x.record;
        const through = worst.map((w, i) => x.through && x.through[i]
          ? `${fpLetter(i, false)}–${fpLetter(i, true)}` : null).filter(Boolean);
        return `<tr><td class="left">${esc(m.name)}</td>
          <td class="left">${m.sinceBasis ? fpMonY(m.sinceBasis) : '<span class="na">not stated</span>'}</td>
          <td class="num">${m.tenureYears == null ? '—' : num(m.tenureYears, 1) + ' yrs'}</td>
          <td class="num">${m.experienceYears == null ? '—' : num(m.experienceYears, 0) + ' yrs'}</td>
          <td class="num">${r ? `<span class="${r.index == null ? '' : r.fund >= r.index ? 'up' : 'down'}">${fpSign(r.fund)}%</span>${
            r.index == null ? '' : ` vs ${fpSign(r.index)}% ${esc(fpShort(r.indexName))}`}${r.annualised ? ' a year' : ''}` : '—'}</td>
          ${worst.length ? `<td class="left">${!m.sinceBasis ? '<span class="na">—</span>' : through.length ? through.join(', ') : 'none of the three'}</td>` : ''}</tr>`;
      }).join('')}</tbody></table>
      <p class="fp-modnote">Record since joining is the fund's return from the manager's start date to the
        latest NAV, annualised beyond a year, against the market index over the same stretch. The letters are
        the falls marked on the drawdown chart. Market cycles run: ${num(f.managerCycles, 0)}.</p>`;
  }
  return top('', '') + '<p class="fp-modnote">Nothing here.</p>';
}

/* --------------------------------------------------- scroll and header */

function fpReveal(host) {
  const rows = host.querySelectorAll('.fp-reveal');
  if (!('IntersectionObserver' in window)) { rows.forEach((r) => r.classList.add('in')); return; }
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -8% 0px' });
  rows.forEach((r) => io.observe(r));
}

/* The fund's name condenses into the header once its band has scrolled away.
   The element is added to the masthead here and taken out again the moment
   the page is no longer a fund page, so no other view ever carries it. */
let fpCrumbWatch = null;

function fpCrumb(name) {
  const head = $('#masthead'), band = $('#fp-band');
  if (!head || !band) return;
  let crumb = $('#fp-crumb');
  if (!crumb) {
    crumb = document.createElement('span');
    crumb.id = 'fp-crumb';
    crumb.className = 'fp-crumb';
    const brand = head.querySelector('.brand');
    if (brand && brand.nextSibling) head.insertBefore(crumb, brand.nextSibling);
    else head.appendChild(crumb);
  }
  crumb.textContent = name;
  crumb.classList.remove('on');
  const bo = new IntersectionObserver((es) => es.forEach((e) =>
    crumb.classList.toggle('on', !e.isIntersecting)), { threshold: 0 });
  bo.observe(band);
  if (fpCrumbWatch) fpCrumbWatch.disconnect();
  fpCrumbWatch = new MutationObserver(() => {
    if (document.querySelector('#main .fundpage')) return;
    bo.disconnect();
    crumb.remove();
    fpCrumbWatch.disconnect();
    fpCrumbWatch = null;
    fpCloseModal();
  });
  fpCrumbWatch.observe($('#main'), { childList: true });
}
