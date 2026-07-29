/* Equity MF Selection & Monitoring dashboard.

   Every number rendered here traces to a rule in the policy: gates from §5,
   parameter scores and weights from §6–7, classification from §8, whitelist
   construction from §9, guardrails from §10 and triggers from §11. Where the
   engine had no data it says so rather than filling the gap — that visibility
   is the point, not a caveat. */

const S = {
  meta: null, fw: null, funds: null, whitelist: null,
  monitoring: null, categoryCache: {}, fundCache: {},
  portfolio: JSON.parse(localStorage.getItem('mf.portfolio') || '{}'),
  rendered: {},
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const api = async (path) => {
  const r = await fetch('/api/mf' + path);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
};
const post = async (path, body) => {
  const r = await fetch('/api/mf' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
};

/* ------------------------------------------------------------- formatting */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n1 = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v)) ? '—' : Number(v).toFixed(d);
const pct = (v, d = 1) => (v === null || v === undefined) ? '—' : Number(v).toFixed(d) + '%';
const cr = (v) => {
  if (v === null || v === undefined) return '—';
  if (v >= 100000) return '₹' + (v / 100000).toFixed(2) + ' L cr';
  if (v >= 1000) return '₹' + (v / 1000).toFixed(1) + 'k cr';
  return '₹' + Math.round(v).toLocaleString('en-IN') + ' cr';
};
const toneOf = (label) => {
  if (!label) return 'neutral';
  if (label.startsWith('REJECTED')) return 'exit';
  if (label.startsWith('Core')) return 'core';
  if (label.startsWith('Satellite')) return 'satellite';
  if (label.startsWith('Hold')) return 'hold';
  return 'exit';
};
const pill = (label) => `<span class="pill ${toneOf(label)}"><i class="dot"></i>${esc(label)}</span>`;
const evidenceChip = (src) => {
  const map = { quant: 'measured', holdings: 'holdings', default: 'no data — scored 3' };
  return `<span class="chip evidence-${src}">${map[src] || src}</span>`;
};

/* ------------------------------------------------------------- navigation */

function show(view) {
  $$('#tabs button').forEach(b => b.setAttribute(
    'aria-current', b.dataset.view === view ? 'page' : 'false'));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  location.hash = view;
  const fn = {
    overview: renderOverview, whitelist: renderWhitelist, screener: renderScreener,
    categories: renderCategories, holdings: renderHoldings, portfolio: renderPortfolio,
    monitoring: renderMonitoring, framework: renderFramework,
  }[view];
  if (fn) fn().catch(err => {
    $('#view-' + view).innerHTML = `<div class="card"><div class="empty">Could not load: ${esc(err.message)}</div></div>`;
  });
}

$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (btn) show(btn.dataset.view);
});

$('#theme-toggle').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : cur === 'light' ? '' : 'dark';
  if (next) document.documentElement.setAttribute('data-theme', next);
  else document.documentElement.removeAttribute('data-theme');
  localStorage.setItem('mf.theme', next);
  // Re-render the active view so SVG marks pick up the new custom properties.
  S.rendered = {};
  show(location.hash.slice(1) || 'overview');
});

/* ----------------------------------------------------------------- drawer */

const drawer = $('#drawer'), backdrop = $('#drawer-backdrop');
function closeDrawer() {
  drawer.classList.remove('open');
  backdrop.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
}
backdrop.addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

async function openFund(key) {
  drawer.classList.add('open');
  backdrop.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  drawer.innerHTML = '<div class="loading">Loading scorecard…</div>';
  let d;
  try {
    d = S.fundCache[key] || (S.fundCache[key] = await api('/fund/' + encodeURIComponent(key)));
  } catch (err) {
    drawer.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    return;
  }
  renderScorecard(d);
}

function renderScorecard(d) {
  const f = d.fund, c = d.composite, cls = d.classification;
  const inPortfolio = S.portfolio[f.key] !== undefined;

  drawer.innerHTML = `
    <header>
      <div>
        <h2>${esc(f.name)}</h2>
        <div class="muted" style="font-size:12.5px">
          ${esc(f.amc || 'AMC not disclosed')} · ${esc(f.category)} ·
          ${f.amfiCode ? 'AMFI ' + f.amfiCode : 'no AMFI code'} ·
          benchmark ${esc(f.benchmark || '—')}
        </div>
        <div style="margin-top:7px;display:flex;gap:7px;flex-wrap:wrap;align-items:center">
          ${pill(cls.label)}
          <span class="chip">Score ${n1(c.final, 1)} / 100</span>
          ${f.categoryRank ? `<span class="chip">Rank ${f.categoryRank} of ${f.categoryCount} eligible in ${esc(f.category)}</span>` : ''}
          ${f.onHouseWhitelist ? '<span class="chip">On the house whitelist</span>' : ''}
        </div>
      </div>
      <button class="icon-btn close" onclick="closeDrawer()">Close ✕</button>
    </header>
    <div class="body">
      <div class="callout ${cls.tone}">
        <strong>${esc(cls.label)}</strong>
        ${esc(cls.action)}
        ${cls.reason ? `<div style="margin-top:6px;color:var(--text-secondary)">${esc(cls.reason)}</div>` : ''}
      </div>

      <div class="grid g4">
        ${tile('Composite', n1(c.final, 1), `raw ${n1(c.raw, 1)}${c.overlay ? ` · overlay ${c.overlay > 0 ? '+' : ''}${c.overlay}` : ' · no IC overlay'}`)}
        ${tile('AUM', cr(f.aumCr), `floor ${cr(S.fw.aumFloors[f.category])}`)}
        ${tile('Direct TER', pct(f.ter, 2), 'net of which returns are quoted')}
        ${tile('Evidence', `${f.evidence.weightPct}%`, `${f.evidence.parameters} of ${f.evidence.totalParameters} parameters measured`)}
      </div>

      <div class="card">
        <header><h3>Score decomposition</h3>
          <span class="sub">Composite = Σ (score ÷ 5) × effective weight — §8.1</span></header>
        <div id="sc-pillar"></div>
        <div class="legend">
          ${['A', 'B', 'C', 'D', 'E'].map((k, i) => `<span><i style="background:${Chart.PILLAR_COLORS[i]}"></i>${k}. ${esc(S.fw.pillars[k].name)} — ${c.pillars[k].available} pts</span>`).join('')}
        </div>
        <p class="note">Filled portion is the weight earned; the grey remainder is
        the weight available. ${esc(d.weightRationale || '')}</p>
      </div>

      <div class="card">
        <header><h3>Stage 1 — hard gates</h3>
          <span class="sub">A fund failing any gate is rejected regardless of score (§5)</span></header>
        <div class="table-wrap"><table class="tight"><tbody>
          ${d.gates.map(g => `<tr>
            <td style="width:1%"><span class="gate ${g.status}"><span class="mark">${
              g.status === 'pass' ? '✓' : g.status === 'fail' ? '✕' : '?'}</span>${g.code}</span></td>
            <td style="width:1%;white-space:nowrap">${esc(g.name)}</td>
            <td>${esc(g.detail)}</td>
          </tr>`).join('')}
        </tbody></table></div>
        <p class="note"><strong>?</strong> marks a gate this data cannot test. The
        policy makes these an analyst responsibility — the engine neither passes
        nor fails them, because silently passing a gate would misstate the
        eligible universe.</p>
      </div>

      <div class="card">
        <header><h3>Stage 2 — the 21 parameters</h3>
          <span class="sub">Ranked by weight earned</span></header>
        ${d.parameters.slice().sort((a, b) => b.effectiveWeight - a.effectiveWeight)
          .map(p => paramRow(p)).join('')}
      </div>

      ${d.portfolio ? portfolioCard(d) : ''}

      <div class="card">
        <header><h3>Against the category</h3>
          <span class="sub">${esc(f.category)} — ${d.peers.length} gate-passing funds</span></header>
        <div id="sc-scatter"></div>
        <p class="note">Down and to the right is the wrong corner: high downside
        capture with a weak rolling return. The dashed line is the benchmark's
        median rolling 3Y CAGR; this fund is the orange mark.</p>
      </div>

      ${d.triggers.length ? `<div class="card">
        <header><h3>Event triggers firing</h3><span class="sub">§11.2 — triggers override scores</span></header>
        ${d.triggers.map(t => `<div class="callout ${t.severity === 'exit' ? 'exit' : t.severity === 'watch' ? 'hold' : 'satellite'}" style="margin-bottom:8px">
          <strong>${t.code} · ${esc(t.trigger)}</strong>${esc(t.detail)}</div>`).join('')}
      </div>` : ''}

      <div class="card">
        <header><h3>Measured inputs</h3><span class="sub">as fed to the engine</span></header>
        <div class="grid g2">
          <dl class="kv">
            <dt>Median rolling 3Y</dt><dd>${pct(f.metrics.medianRolling3Y, 2)}</dd>
            <dt>Jensen's alpha</dt><dd>${f.metrics.alpha === null || f.metrics.alpha === undefined ? '—' : (f.metrics.alpha > 0 ? '+' : '') + n1(f.metrics.alpha, 2) + '%'}</dd>
            <dt>1Y / 3Y / 5Y</dt><dd>${pct(f.metrics.return1Y)} · ${pct(f.metrics.return3Y)} · ${pct(f.metrics.return5Y)}</dd>
            <dt>Sharpe / Sortino</dt><dd>${n1(f.metrics.sharpe3Y, 2)} · ${n1(f.metrics.sortino3Y, 2)}</dd>
            <dt>Information ratio</dt><dd>${n1(f.metrics.informationRatio3Y, 2)}</dd>
          </dl>
          <dl class="kv">
            <dt>Downside capture</dt><dd>${pct(f.metrics.downsideCapture3Y)}</dd>
            <dt>Upside capture</dt><dd>${pct(f.metrics.upsideCapture3Y)}</dd>
            <dt>Std deviation</dt><dd>${pct(f.metrics.stdDev3Y, 2)}</dd>
            <dt>Max drawdown</dt><dd>${pct(f.metrics.maxDrawdown3Y, 2)}</dd>
            <dt>Beta</dt><dd>${n1(f.metrics.beta3Y, 2)}</dd>
          </dl>
        </div>
        <p class="note">Fund manager: ${esc(f.fundManager || 'not disclosed in the feed')}.
        Metrics are 3-year, direct-plan growth NAV basis, against
        ${esc(f.benchmark || 'the category benchmark')}.</p>
      </div>

      <div class="card">
        <header><h3>Model portfolio</h3></header>
        <div style="display:flex;gap:9px;align-items:flex-end;flex-wrap:wrap">
          <div class="field">
            <label for="pf-weight">Weight (% of equity)</label>
            <input id="pf-weight" type="number" min="0" max="100" step="0.5"
                   value="${inPortfolio ? S.portfolio[f.key] : 10}">
          </div>
          <button class="icon-btn" id="pf-add">${inPortfolio ? 'Update weight' : 'Add to portfolio'}</button>
          ${inPortfolio ? '<button class="icon-btn" id="pf-remove">Remove</button>' : ''}
        </div>
        <p class="note">Tested against the §10 IPS guardrails on the Portfolio tab.</p>
      </div>
    </div>`;

  Chart.pillarBar($('#sc-pillar'), c.pillars);
  Chart.scatter($('#sc-scatter'), d.peers.map(p => ({
    x: p.downsideCapture3Y, y: p.medianRolling3Y,
    label: p.name, highlight: p.isSelf, key: p.key,
    extra: `<div class="tt-row"><span>Score</span><span>${n1(p.score, 1)}</span></div>
            <div class="tt-row"><span>TER</span><span>${pct(p.ter, 2)}</span></div>`,
  })), {
    xLabel: 'Downside capture (%)', yLabel: 'Median rolling 3Y CAGR (%)',
    yRef: d.benchmark?.medianRolling3Y ?? null, xRef: 100,
    refLabel: 'Benchmark TRI',
    onClick: (p) => { if (p.key && !p.highlight) openFund(p.key); },
  });

  $('#pf-add').onclick = () => {
    const w = parseFloat($('#pf-weight').value);
    if (!(w > 0)) return;
    S.portfolio[f.key] = w;
    savePortfolio();
    closeDrawer();
    show('portfolio');
  };
  const rm = $('#pf-remove');
  if (rm) rm.onclick = () => { delete S.portfolio[f.key]; savePortfolio(); closeDrawer(); show('portfolio'); };
}

function paramRow(p) {
  const bars = [1, 2, 3, 4, 5].map(i =>
    `<i class="${i <= (p.score || 0) ? (p.sourceType === 'default' ? 'est' : 'on') : ''}"></i>`).join('');
  return `<div class="param-row">
    <div class="param-head">
      <span class="param-code">${p.code}</span>
      <span class="param-name">${esc(p.name)}</span>
      <span class="scorebar" title="Score ${p.score} of 5">${bars}</span>
      ${evidenceChip(p.sourceType)}
      <span class="num" style="min-width:76px">${n1(p.earned, 2)} / ${n1(p.effectiveWeight, 2)}</span>
    </div>
    <div class="param-note">${esc(p.note || '')}</div>
  </div>`;
}

function portfolioCard(d) {
  const s = d.portfolio;
  const caps = s.capSplit || {};
  return `<div class="card">
    <header><h3>Disclosed portfolio</h3>
      <span class="sub">${s.holdingCount} equity holdings · ${pct(s.equityPct)} equity · ${pct(s.cashPct)} cash</span></header>
    <div class="grid g2">
      <div>
        <h4 style="margin-bottom:8px">Top 10 holdings — ${pct(s.top10)}</h4>
        <div id="sc-top10"></div>
      </div>
      <div>
        <h4 style="margin-bottom:8px">Sector allocation</h4>
        <div id="sc-sectors"></div>
      </div>
    </div>
    ${Object.keys(caps).length ? `<div style="margin-top:12px">
      <h4 style="margin-bottom:8px">Market-cap split (holdings basis)</h4>
      <div class="legend">${Object.entries(caps).map(([k, v]) =>
        `<span><i style="background:var(--seq-${k === 'Large Cap' ? 700 : k === 'Mid Cap' ? 450 : 200})"></i>${esc(k)} ${pct(v)}</span>`).join('')}</div>
    </div>` : ''}
  </div>`;
}

/* ---------------------------------------------------------------- helpers */

function tile(label, value, foot) {
  return `<div class="tile"><div class="label">${esc(label)}</div>
    <div class="value">${value}</div>
    <div class="foot">${esc(foot || '')}</div></div>`;
}

function savePortfolio() {
  localStorage.setItem('mf.portfolio', JSON.stringify(S.portfolio));
  S.rendered.portfolio = false;
}

function fundRow(f, extraCols = []) {
  return `<tr class="clickable" data-key="${esc(f.key)}">
    <td class="name-cell">${esc(f.name)}
      <small>${esc(f.amc || '—')} · ${esc(f.category)}${f.onHouseWhitelist ? ' · on house whitelist' : ''}</small></td>
    <td class="num">${n1(f.score, 1)}</td>
    <td>${pill(f.classification.label)}</td>
    <td class="num">${f.categoryRank ? f.categoryRank + '/' + f.categoryCount : '—'}</td>
    <td class="num">${cr(f.aumCr)}</td>
    <td class="num">${pct(f.ter, 2)}</td>
    <td class="num">${pct(f.metrics.medianRolling3Y, 1)}</td>
    <td class="num">${pct(f.metrics.downsideCapture3Y, 0)}</td>
    <td class="num">${pct(f.metrics.maxDrawdown3Y, 1)}</td>
    ${extraCols.map(c => `<td class="num">${c(f)}</td>`).join('')}
  </tr>`;
}

const FUND_HEAD = `<tr>
  <th>Fund</th><th class="num">Score</th><th>Classification</th>
  <th class="num">Rank</th><th class="num">AUM</th><th class="num">TER</th>
  <th class="num">Roll 3Y</th><th class="num">Down cap</th><th class="num">Max DD</th></tr>`;

function wireRows(root) {
  $$('tr.clickable', root).forEach(tr => {
    tr.onclick = () => openFund(tr.dataset.key);
  });
}

/* --------------------------------------------------------------- overview */

async function renderOverview() {
  if (S.rendered.overview) return;
  const host = $('#view-overview');
  const [meta, funds] = await Promise.all([
    S.meta ? Promise.resolve(S.meta) : api('/meta'),
    S.funds ? Promise.resolve(S.funds) : api('/funds?limit=0'),
  ]);
  S.meta = meta; S.funds = funds;

  const rows = funds.funds;
  const eligible = rows.filter(r => r.gatesPassed);
  const core = eligible.filter(r => r.classification.tone === 'core');
  const satellite = eligible.filter(r => r.classification.tone === 'satellite');
  const gateFail = rows.length - eligible.length;
  const triggered = rows.filter(r => r.gatesPassed && r.triggerCount > 0);

  const gateCounts = {};
  rows.forEach(r => r.failedGates.forEach(g => { gateCounts[g] = (gateCounts[g] || 0) + 1; }));

  host.innerHTML = `
    <div class="grid g4" style="margin-bottom:16px">
      ${tile('Universe scored', rows.length, `${meta.meta.totalFunds} schemes in the feed; the rest are index, ETF, FoF or hybrid — outside policy scope`)}
      ${tile('Clear all testable gates', eligible.length, `${gateFail} rejected at Stage 1`)}
      ${tile('Core classified', core.length, `${satellite.length} Satellite / Watch-in`)}
      ${tile('Triggers firing', triggered.length, 'eligible funds with at least one §11.2 trigger')}
    </div>

    <div class="grid g2" style="margin-bottom:16px">
      <div class="card">
        <header><h3>The funnel</h3><span class="sub">§3 — three decisions, kept separate</span></header>
        <div id="ov-funnel"></div>
        <p class="note">The framework separates whether a fund can be considered
        at all, how good it is against its peers, and what to do with it for
        clients. Conflating them is how a committee ends up debating a star
        fund's three-year return when the real issue is that its manager left
        last month.</p>
      </div>
      <div class="card">
        <header><h3>Why funds are rejected</h3><span class="sub">Stage 1 gate failures across the universe</span></header>
        <div id="ov-gates"></div>
        <p class="note">Gates are eligibility tests, not quality scores. No
        composite can compensate for a failed gate — and a fund can score 85 and
        still be rejected, which is exactly what the vintage gate does to several
        strong recent launches.</p>
      </div>
    </div>

    <div class="grid g2" style="margin-bottom:16px">
      <div class="card">
        <header><h3>Composite score distribution</h3>
          <span class="sub">${eligible.length} gate-passing funds</span></header>
        <div id="ov-hist"></div>
        <div class="legend">
          <span><i style="background:var(--good)"></i>≥75 Core</span>
          <span><i style="background:var(--warning)"></i>65–74.9 Satellite</span>
          <span><i style="background:var(--serious)"></i>50–64.9 Hold</span>
          <span><i style="background:var(--critical)"></i>&lt;50 Exit</span>
        </div>
      </div>
      <div class="card">
        <header><h3>Evidence coverage</h3><span class="sub">how much of each score is measured, not conventional</span></header>
        <div id="ov-evidence"></div>
        <p class="note">Where a parameter has no data the policy scores it 3 and
        flags it (§6.2). Pillars D and E carry most of the judgement-scored
        parameters — manager tenure, AMC process, governance and disclosure are
        analyst inputs by design, not gaps in the pipeline. A bar here is the
        share of a category's weight that rests on measured evidence.</p>
      </div>
    </div>

    <div class="card">
      <header><h3>Category universe</h3>
        <span class="sub">click a row for the category dossier</span></header>
      <div class="table-wrap"><table>
        <thead><tr><th>Category</th><th class="num">Universe</th><th class="num">Eligible</th>
          <th class="num">Core</th><th class="num">AUM floor</th><th>Pillar weights A / B / C / D / E</th>
          <th>Role</th></tr></thead>
        <tbody>${S.fw.categoryOrder.map(c => {
          const stat = meta.categories[c] || { total: 0, eligible: 0, core: 0 };
          const w = S.fw.pillarWeights[c];
          return `<tr class="clickable" data-cat="${esc(c)}">
            <td style="font-weight:500">${esc(c)}</td>
            <td class="num">${stat.total}</td><td class="num">${stat.eligible}</td>
            <td class="num">${stat.core}</td>
            <td class="num">${cr(S.fw.aumFloors[c])}</td>
            <td class="num" style="letter-spacing:0.02em">${w.A} / ${w.B} / ${w.C} / ${w.D} / ${w.E}</td>
            <td class="muted" style="font-size:12px">${esc(S.fw.categories[c].role)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>`;

  Chart.funnel($('#ov-funnel'), [
    { label: 'Feed universe', value: meta.meta.totalFunds, note: 'All schemes in the four dataPack endpoints.' },
    { label: 'In policy scope', value: rows.length, note: 'The eleven SEBI equity categories.' },
    { label: 'Clear Stage 1 gates', value: eligible.length, note: 'Testable gates only — G3 and G4 stay with the analyst.' },
    { label: 'Core or Satellite', value: core.length + satellite.length, note: 'Candidates for whitelist construction.' },
    { label: 'Constructed whitelist', value: 0, note: 'Built on the Whitelist tab.' },
  ]);
  // Fill the last funnel stage once the whitelist is known.
  api('/whitelist').then(wl => {
    S.whitelist = wl;
    const rowsEl = $$('#ov-funnel .barrow');
    const last = rowsEl[rowsEl.length - 1];
    if (last) {
      last.querySelector('.val').textContent = wl.count;
      last.querySelector('.fill').style.width = ((wl.count / meta.meta.totalFunds) * 100) + '%';
    }
  }).catch(() => {});

  Chart.bars($('#ov-gates'), S.fw.gates.map(g => ({
    label: `${g.code} ${g.name}`, value: gateCounts[g.code] || 0,
    gate: g,
  })), {
    decimals: 0, color: 'var(--critical)',
    tipFor: (r) => `<strong>${esc(r.gate.code)} — ${esc(r.gate.name)}</strong>
      <div style="color:var(--text-secondary);margin:4px 0">${esc(r.gate.threshold)}</div>
      <div class="tt-row"><span>Funds failing</span><span>${r.value}</span></div>`,
  });

  Chart.histogram($('#ov-hist'), eligible.map(r => r.score), {
    xLabel: 'Composite score (0–100)',
    marks: [
      { at: 50, label: 'Hold', color: 'var(--serious)' },
      { at: 65, label: 'Satellite', color: 'var(--warning)' },
      { at: 75, label: 'Core', color: 'var(--good)' },
    ],
  });

  const byCat = {};
  eligible.forEach(r => {
    (byCat[r.category] = byCat[r.category] || []).push(r.evidence.weightPct);
  });
  Chart.bars($('#ov-evidence'), S.fw.categoryOrder.filter(c => byCat[c]).map(c => ({
    label: c,
    value: byCat[c].reduce((a, b) => a + b, 0) / byCat[c].length,
  })).sort((a, b) => b.value - a.value), {
    suffix: '%', max: 100,
    tipFor: r => `<strong>${esc(r.label)}</strong>
      <div class="tt-row"><span>Weight measured</span><span>${n1(r.value, 1)}%</span></div>
      <div class="tt-row"><span>Weight by convention</span><span>${n1(100 - r.value, 1)}%</span></div>`,
  });

  $$('#view-overview tr[data-cat]').forEach(tr => {
    tr.onclick = () => { show('categories'); setTimeout(() => selectCategory(tr.dataset.cat), 60); };
  });
  S.rendered.overview = true;
}

/* --------------------------------------------------------------- whitelist */

async function renderWhitelist() {
  if (S.rendered.whitelist) return;
  const host = $('#view-whitelist');
  const wl = S.whitelist || (S.whitelist = await api('/whitelist'));
  const rec = wl.reconciliation;

  const byCat = {};
  wl.funds.forEach(f => (byCat[f.category] = byCat[f.category] || []).push(f));

  host.innerHTML = `
    <div class="grid g4" style="margin-bottom:16px">
      ${tile('Constructed whitelist', wl.count, 'built by the framework this cycle')}
      ${tile('House whitelist', wl.house.length, 'live Jul–Sep 2026 deck')}
      ${tile('Agree', rec.both.length, 'on both lists')}
      ${tile('Disagree', rec.frameworkOnly.length + rec.houseOnly.length,
             `${rec.frameworkOnly.length} framework-only · ${rec.houseOnly.length} house-only`)}
    </div>

    <div class="card" style="margin-bottom:16px">
      <header><h3>Reconciliation against the live house whitelist</h3>
        <span class="sub">§9 — the whitelist is constructed, not accumulated</span></header>
      <p class="note" style="margin-top:0;margin-bottom:14px">The framework builds
      its list from gate-passing funds ranked by composite, capped at two funds
      per AMC per category and the category's depth guidance. Where it disagrees
      with the incumbent list, the reason is stated — most house-only names are
      recent launches that the five-year vintage gate excludes, which is the gate
      working as designed rather than a scoring failure.</p>
      <div class="grid g3">
        <div>
          <h4>On both lists (${rec.both.length})</h4>
          ${rec.both.length ? rec.both.map(d => `<div class="wl-slot">
            <div class="nm"><b>${esc(d.name)}</b><small>${esc(d.category || '')} · ${esc(d.amc || '')}</small></div>
            <span class="num">${n1(d.score, 1)}</span></div>`).join('') : '<div class="empty">None</div>'}
        </div>
        <div>
          <h4>Framework only (${rec.frameworkOnly.length})</h4>
          ${rec.frameworkOnly.map(d => `<div class="wl-slot">
            <div class="nm"><b>${esc(d.name)}</b><small>${esc(d.category || '')} · rank ${d.categoryRank}/${d.categoryCount}</small></div>
            <span class="num">${n1(d.score, 1)}</span></div>`).join('')}
        </div>
        <div>
          <h4>House only (${rec.houseOnly.length})</h4>
          ${rec.houseOnly.map(d => `<div class="wl-slot">
            <div class="nm"><b>${esc(d.name)}</b><small>${esc(d.reason)}</small></div>
            <span class="num">${d.score === null ? '—' : n1(d.score, 1)}</span></div>`).join('')}
        </div>
      </div>
    </div>

    <div class="grid g2" style="margin-bottom:16px">
      <div class="card">
        <header><h3>AMC concentration</h3>
          <span class="sub">no AMC above ~25% of the full whitelist (§9)</span></header>
        <div id="wl-amc"></div>
      </div>
      <div class="card">
        <header><h3>Construction notes</h3><span class="sub">what the rules did</span></header>
        ${wl.notes.length ? wl.notes.map(nt => `<div class="callout ${nt.type === 'empty' ? 'exit' : 'satellite'}" style="margin-bottom:8px">
          <strong>${esc(nt.category)}${nt.fund ? ' — ' + esc(nt.fund) : ''}</strong>${esc(nt.message)}</div>`).join('')
          : '<div class="empty">Every category filled to its depth guidance with no AMC-cap conflicts.</div>'}
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <header><h3>Standing rules the data cannot enforce</h3>
        <span class="sub">applied by minute, not by machine</span></header>
      <div class="grid g2">
        ${wl.standingRules.map(r => `<div>
          <h4>${esc(r.rule)}</h4>
          <div style="font-size:13px">${esc(r.guideline)}</div>
          <div class="note" style="margin-top:5px">${esc(r.rationale)}</div>
        </div>`).join('')}
      </div>
    </div>

    ${S.fw.categoryOrder.filter(c => byCat[c]).map(c => `
      <div class="card" style="margin-bottom:16px">
        <header><h3>${esc(c)}</h3>
          <span class="sub">depth guidance ${S.fw.categories[c].depth.join('–')} funds ·
          ${esc(S.fw.categories[c].benchmark)}</span></header>
        <div class="table-wrap"><table><thead>${FUND_HEAD}</thead>
          <tbody>${byCat[c].map(f => fundRow(f)).join('')}</tbody></table></div>
        <p class="note">${esc(S.fw.categories[c].note)}</p>
      </div>`).join('')}`;

  Chart.bars($('#wl-amc'), wl.amcConcentration.map(a => ({
    label: a.amc.replace(/ Mutual Fund$/, ''), value: a.pct, count: a.count, breach: a.breach,
  })), {
    suffix: '%', max: 30,
    colorFor: r => r.breach ? 'var(--critical)' : 'var(--series-1)',
    tipFor: r => `<strong>${esc(r.label)}</strong>
      <div class="tt-row"><span>Funds on whitelist</span><span>${r.count}</span></div>
      <div class="tt-row"><span>Share</span><span>${n1(r.value, 1)}%</span></div>
      ${r.breach ? '<div style="color:var(--critical);margin-top:4px">Above the 25% single-AMC ceiling</div>' : ''}`,
  });

  wireRows(host);
  S.rendered.whitelist = true;
}

/* ---------------------------------------------------------------- screener */

const screenerState = { category: 'all', classification: 'all', q: '',
                        eligibleOnly: false, whitelistOnly: false,
                        sort: 'score', order: 'desc', minAum: '', maxDC: '' };

async function renderScreener() {
  const host = $('#view-screener');
  if (!S.rendered.screener) {
    host.innerHTML = `
      <div class="filters">
        <div class="field"><label for="sc-q">Search</label>
          <input id="sc-q" type="search" placeholder="Fund or AMC name"></div>
        <div class="field"><label for="sc-cat">Category</label>
          <select id="sc-cat"><option value="all">All categories</option>
            ${S.fw.categoryOrder.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
        <div class="field"><label for="sc-cls">Classification</label>
          <select id="sc-cls"><option value="all">All</option>
            ${S.fw.classificationBands.map(b => `<option>${esc(b.label)}</option>`).join('')}
            <option>REJECTED — gate failure</option></select></div>
        <div class="field"><label for="sc-aum">Min AUM (₹ cr)</label>
          <input id="sc-aum" type="number" min="0" step="100" style="min-width:110px"></div>
        <div class="field"><label for="sc-dc">Max downside capture</label>
          <input id="sc-dc" type="number" min="0" step="5" style="min-width:110px"></div>
        <label class="check"><input id="sc-elig" type="checkbox"> Gate-passing only</label>
        <label class="check"><input id="sc-wl" type="checkbox"> House whitelist only</label>
        <div class="spacer" style="flex:1"></div>
        <button class="icon-btn" id="sc-csv">Export CSV</button>
      </div>
      <div class="card flush">
        <div class="table-wrap"><table id="sc-table">
          <thead>${FUND_HEAD.replace(/<th class="num">Score<\/th>/, '<th class="num sortable" data-sort="score">Score ▾</th>')
            .replace(/<th class="num">AUM<\/th>/, '<th class="num sortable" data-sort="aumCr">AUM</th>')
            .replace(/<th class="num">TER<\/th>/, '<th class="num sortable" data-sort="ter">TER</th>')
            .replace(/<th class="num">Roll 3Y<\/th>/, '<th class="num sortable" data-sort="medianRolling3Y">Roll 3Y</th>')
            .replace(/<th class="num">Down cap<\/th>/, '<th class="num sortable" data-sort="downsideCapture3Y">Down cap</th>')
            .replace(/<th class="num">Max DD<\/th>/, '<th class="num sortable" data-sort="maxDrawdown3Y">Max DD</th>')}</thead>
          <tbody><tr><td colspan="9"><div class="loading">Loading…</div></td></tr></tbody>
        </table></div>
      </div>
      <p class="note" id="sc-count"></p>`;

    const debounce = (fn, ms = 220) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
    const refresh = () => loadScreener();
    $('#sc-q').oninput = debounce(e => { screenerState.q = e.target.value; refresh(); });
    $('#sc-cat').onchange = e => { screenerState.category = e.target.value; refresh(); };
    $('#sc-cls').onchange = e => { screenerState.classification = e.target.value; refresh(); };
    $('#sc-aum').oninput = debounce(e => { screenerState.minAum = e.target.value; refresh(); });
    $('#sc-dc').oninput = debounce(e => { screenerState.maxDC = e.target.value; refresh(); });
    $('#sc-elig').onchange = e => { screenerState.eligibleOnly = e.target.checked; refresh(); };
    $('#sc-wl').onchange = e => { screenerState.whitelistOnly = e.target.checked; refresh(); };
    $('#sc-csv').onclick = exportScreenerCsv;
    $$('#sc-table th.sortable').forEach(th => {
      th.onclick = () => {
        const key = th.dataset.sort;
        if (screenerState.sort === key) screenerState.order = screenerState.order === 'desc' ? 'asc' : 'desc';
        else { screenerState.sort = key; screenerState.order = 'desc'; }
        $$('#sc-table th.sortable').forEach(o => { o.textContent = o.textContent.replace(/ [▾▴]$/, ''); });
        th.textContent += screenerState.order === 'desc' ? ' ▾' : ' ▴';
        refresh();
      };
    });
    S.rendered.screener = true;
  }
  await loadScreener();
}

let screenerRows = [];
async function loadScreener() {
  const s = screenerState;
  const qs = new URLSearchParams({
    category: s.category, classification: s.classification, sort: s.sort, order: s.order,
  });
  if (s.q) qs.set('q', s.q);
  if (s.eligibleOnly) qs.set('eligibleOnly', 'true');
  if (s.whitelistOnly) qs.set('whitelistOnly', 'true');
  if (s.minAum) qs.set('minAum', s.minAum);
  if (s.maxDC) qs.set('maxDownsideCapture', s.maxDC);

  const data = await api('/funds?' + qs.toString());
  screenerRows = data.funds;
  $('#sc-table tbody').innerHTML = data.funds.length
    ? data.funds.map(f => fundRow(f)).join('')
    : '<tr><td colspan="9"><div class="empty">No fund matches these filters.</div></td></tr>';
  $('#sc-count').textContent =
    `${data.total} of ${S.meta.scoredFunds} in-scope schemes match. Click any row for its full scorecard.`;
  wireRows($('#view-screener'));
}

function exportScreenerCsv() {
  const cols = ['name', 'amc', 'category', 'score', 'classification', 'categoryRank',
                'aumCr', 'ter', 'medianRolling3Y', 'downsideCapture3Y', 'maxDrawdown3Y',
                'sortino3Y', 'stdDev3Y', 'beta3Y', 'failedGates', 'evidenceWeightPct'];
  const line = (vals) => vals.map(v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',');
  const body = screenerRows.map(f => line([
    f.name, f.amc, f.category, f.score, f.classification.label, f.categoryRank,
    f.aumCr, f.ter, f.metrics.medianRolling3Y, f.metrics.downsideCapture3Y,
    f.metrics.maxDrawdown3Y, f.metrics.sortino3Y, f.metrics.stdDev3Y, f.metrics.beta3Y,
    f.failedGates.join(' '), f.evidence.weightPct,
  ]));
  const blob = new Blob([line(cols) + '\n' + body.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mf-screener.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* -------------------------------------------------------------- categories */

async function renderCategories() {
  if (!S.rendered.categories) {
    $('#view-categories').innerHTML = `
      <div class="filters">
        <div class="field"><label for="cat-pick">Category</label>
          <select id="cat-pick">${S.fw.categoryOrder.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
      </div>
      <div id="cat-body"><div class="loading">Loading…</div></div>`;
    $('#cat-pick').onchange = e => selectCategory(e.target.value);
    S.rendered.categories = true;
    await selectCategory('Flexi Cap');
  }
}

async function selectCategory(name) {
  $('#cat-pick').value = name;
  const host = $('#cat-body');
  host.innerHTML = '<div class="loading">Loading…</div>';
  const d = S.categoryCache[name] || (S.categoryCache[name] = await api('/category/' + encodeURIComponent(name)));
  const def = d.definition, w = d.pillarWeights;

  host.innerHTML = `
    <div class="grid g4" style="margin-bottom:16px">
      ${tile('Universe', d.universe, 'schemes in this SEBI category')}
      ${tile('Gate-passing', d.eligible, `${d.universe - d.eligible} rejected at Stage 1`)}
      ${tile('AUM floor', cr(d.aumFloor), 'gate G2')}
      ${tile('Whitelist depth', def.depth.join('–'), 'funds per §9')}
    </div>

    <div class="grid g2" style="margin-bottom:16px">
      <div class="card">
        <header><h3>Mandate</h3><span class="sub">${esc(def.benchmark)}</span></header>
        <dl class="kv">
          <dt>SEBI minimum</dt><dd>${esc(def.mandate)}</dd>
          <dt>Portfolio role</dt><dd>${esc(def.role)}</dd>
          <dt>Horizon</dt><dd>${esc(def.horizon)}</dd>
        </dl>
        <p class="note">${esc(def.note)}</p>
      </div>
      <div class="card">
        <header><h3>Pillar weights</h3><span class="sub">§7 — why they move for this category</span></header>
        <div id="cat-weights"></div>
        <p class="note">${esc(d.weightRationale || 'Base weights apply.')}</p>
      </div>
    </div>

    <div class="grid g2" style="margin-bottom:16px">
      <div class="card">
        <header><h3>Peer dispersion</h3><span class="sub">gate-passing funds only (§12)</span></header>
        <div id="cat-spreads"></div>
        <p class="note">Box is the interquartile range, the dark tick is the median,
        the whisker is the full range. The category median is computed over
        gate-passing funds so that a flood of young funds cannot distort the peer
        standard.</p>
      </div>
      <div class="card">
        <header><h3>Gate failures</h3><span class="sub">where this category loses funds</span></header>
        <div id="cat-gates"></div>
      </div>
    </div>

    <div class="card">
      <header><h3>League table</h3>
        <span class="sub">${d.funds.length} schemes · click for the full scorecard</span></header>
      <div class="table-wrap"><table><thead>${FUND_HEAD}</thead>
        <tbody>${d.funds.map(f => fundRow(f)).join('')}</tbody></table></div>
    </div>`;

  Chart.bars($('#cat-weights'), ['A', 'B', 'C', 'D', 'E'].map((k, i) => ({
    label: `${k}. ${S.fw.pillars[k].name}`, value: w[k], base: S.fw.pillars[k].base, slot: i,
  })), {
    suffix: '%', max: 35, decimals: 0,
    colorFor: r => Chart.PILLAR_COLORS[r.slot],
    tipFor: r => `<strong>${esc(r.label)}</strong>
      <div style="color:var(--text-secondary);margin:4px 0">${esc(S.fw.pillars[r.label[0]].what)}</div>
      <div class="tt-row"><span>This category</span><span>${r.value}%</span></div>
      <div class="tt-row"><span>Base (Flexi Cap)</span><span>${r.base}%</span></div>`,
  });

  const spreadLabels = {
    medianRolling3Y: 'Median rolling 3Y (%)', downsideCapture3Y: 'Downside capture (%)',
    stdDev3Y: 'Std deviation (%)', sortino3Y: 'Sortino', maxDrawdown3Y: 'Max drawdown (%)',
    ter: 'Direct TER (%)',
  };
  Chart.rangeStrip($('#cat-spreads'), Object.entries(spreadLabels).map(([k, label]) => ({
    label, spread: d.spreads[k], value: null,
  })), { decimals: 2 });

  Chart.bars($('#cat-gates'), S.fw.gates.map(g => ({
    label: `${g.code} ${g.name}`, value: d.gateFailures[g.code] || 0, gate: g,
  })), {
    decimals: 0, color: 'var(--critical)',
    tipFor: r => `<strong>${esc(r.gate.code)} — ${esc(r.gate.name)}</strong>
      <div style="color:var(--text-secondary);margin:4px 0">${esc(r.gate.rationale)}</div>
      <div class="tt-row"><span>Funds failing</span><span>${r.value}</span></div>`,
  });

  wireRows(host);
}

/* ---------------------------------------------------------------- holdings */

const holdState = { a: null, b: null };

async function renderHoldings() {
  if (!S.rendered.holdings) {
    const withBooks = S.funds.funds.filter(f => f.hasHoldings);
    const opts = withBooks.map(f => `<option value="${esc(f.key)}">${esc(f.name)}</option>`).join('');
    $('#view-holdings').innerHTML = `
      <div class="filters">
        <div class="field"><label for="h-a">Fund A</label>
          <select id="h-a" style="min-width:280px">${opts}</select></div>
        <div class="field"><label for="h-b">Fund B</label>
          <select id="h-b" style="min-width:280px">${opts}</select></div>
      </div>
      <div id="h-body"><div class="loading">Loading…</div></div>`;
    holdState.a = withBooks[0]?.key;
    holdState.b = withBooks[1]?.key;
    $('#h-a').value = holdState.a; $('#h-b').value = holdState.b;
    $('#h-a').onchange = e => { holdState.a = e.target.value; loadOverlap(); };
    $('#h-b').onchange = e => { holdState.b = e.target.value; loadOverlap(); };
    S.rendered.holdings = true;
  }
  await loadOverlap();
}

async function loadOverlap() {
  const host = $('#h-body');
  if (!holdState.a || !holdState.b) { host.innerHTML = '<div class="empty">Pick two funds.</div>'; return; }
  host.innerHTML = '<div class="loading">Computing overlap…</div>';

  const [ha, hb, ov] = await Promise.all([
    api('/holdings/' + encodeURIComponent(holdState.a)),
    api('/holdings/' + encodeURIComponent(holdState.b)),
    holdState.a === holdState.b ? Promise.resolve(null)
      : api('/overlap?keys=' + encodeURIComponent(holdState.a + ',' + holdState.b)),
  ]);
  const pair = ov?.pair;

  host.innerHTML = `
    ${pair ? `<div class="grid g4" style="margin-bottom:16px">
      ${tile('Portfolio overlap', pct(pair.overlapPct), 'Σ min(weight) over shared names')}
      ${tile('Shared holdings', pair.commonHoldings, `${pair.countA} vs ${pair.countB} names`)}
      ${tile('Top-10 concentration', `${pct(ha.stats?.top10)} / ${pct(hb.stats?.top10)}`, 'A / B')}
      ${tile('Book size', `${ha.stats?.holdingCount ?? '—'} / ${hb.stats?.holdingCount ?? '—'}`, 'equity names, A / B')}
    </div>` : ''}

    ${pair ? `<div class="card" style="margin-bottom:16px">
      <header><h3>Shared positions</h3>
        <span class="sub">the overlap contribution is the smaller of the two weights</span></header>
      <div class="table-wrap"><table class="tight">
        <thead><tr><th>Security</th><th class="num">${esc(ha.name)}</th>
          <th class="num">${esc(hb.name)}</th><th class="num">Overlap</th></tr></thead>
        <tbody>${pair.topShared.map(s => `<tr>
          <td>${esc(s.security)}</td><td class="num">${pct(s.a, 2)}</td>
          <td class="num">${pct(s.b, 2)}</td><td class="num">${pct(s.min, 2)}</td></tr>`).join('')}
        </tbody></table></div>
      <p class="note">Overlap is what makes a many-fund portfolio quietly become an
      expensive index fund (§10). Two funds above roughly 50% overlap are one
      position held twice, whatever their category labels say.</p>
    </div>` : ''}

    <div class="grid g2">
      ${[ha, hb].map((h, i) => `<div class="card">
        <header><h3>${esc(h.name)}</h3>
          <span class="sub">${h.stats?.holdingCount ?? 0} equity names · top-10 ${pct(h.stats?.top10)}</span></header>
        <h4 style="margin-bottom:8px">Top 15 holdings</h4>
        <div id="h-top-${i}"></div>
        <h4 style="margin:14px 0 8px">Sectors</h4>
        <div id="h-sec-${i}"></div>
      </div>`).join('')}
    </div>`;

  [ha, hb].forEach((h, i) => {
    const equity = h.holdings.filter(x => !['current assets', 'cash', 'treps', 'net receivables']
      .includes((x.sector || '').toLowerCase()));
    Chart.bars($(`#h-top-${i}`), equity.slice(0, 15).map(x => ({
      label: x.security, value: x.pct, sector: x.sector, mc: x.marketCap,
    })), {
      suffix: '%', decimals: 2,
      tipFor: r => `<strong>${esc(r.label)}</strong>
        <div class="tt-row"><span>Weight</span><span>${n1(r.value, 2)}%</span></div>
        <div class="tt-row"><span>Sector</span><span>${esc(r.sector || '—')}</span></div>
        <div class="tt-row"><span>Market cap</span><span>${esc(r.mc || '—')}</span></div>`,
    });
    const sectors = {};
    equity.forEach(x => { sectors[x.sector || 'Unclassified'] = (sectors[x.sector || 'Unclassified'] || 0) + x.pct; });
    Chart.bars($(`#h-sec-${i}`), Object.entries(sectors)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([label, value]) => ({ label, value })), { suffix: '%', decimals: 1 });
  });
}

/* --------------------------------------------------------------- portfolio */

async function renderPortfolio() {
  const host = $('#view-portfolio');
  const keys = Object.keys(S.portfolio);

  if (!keys.length) {
    host.innerHTML = `<div class="card"><div class="empty">
      No portfolio yet. Open any fund's scorecard from the Screener or Whitelist
      and add it with a weight — this tab then tests the result against the
      §10 IPS guardrails, look-through and pairwise overlap.</div></div>`;
    return;
  }

  host.innerHTML = '<div class="loading">Testing against the guardrails…</div>';
  const d = await post('/portfolio', { weights: S.portfolio });
  const lt = d.lookThrough;

  host.innerHTML = `
    <div class="grid g4" style="margin-bottom:16px">
      ${tile('Schemes', d.holdings.length, `total weight ${pct(d.totalWeight, 0)}`)}
      ${tile('Guardrail breaches', d.breaches.length, `${d.checks.filter(c => c.status === 'pass').length} rules clear`)}
      ${tile('Look-through stocks', lt.distinctStocks, `top-10 is ${pct(lt.top10Pct)} of the portfolio`)}
      ${tile('Holdings coverage', pct(lt.coveragePct, 0), 'of weight with a disclosed book')}
    </div>

    <div class="card" style="margin-bottom:16px">
      <header><h3>IPS guardrails</h3><span class="sub">§10 — these bind at the point of client recommendation</span></header>
      <div class="table-wrap"><table><thead><tr>
        <th>Rule</th><th>Guideline</th><th>Position</th><th class="num">Status</th></tr></thead>
        <tbody>${d.checks.map(c => `<tr>
          <td style="font-weight:500;white-space:nowrap">${esc(c.rule)}</td>
          <td style="font-size:12.5px;color:var(--text-secondary)">${esc(c.guideline)}</td>
          <td style="font-size:12.5px">${esc(c.detail)}</td>
          <td class="num"><span class="gate ${c.status === 'pass' ? 'pass' : c.status === 'breach' ? 'fail' : 'manual'}">
            <span class="mark">${c.status === 'pass' ? '✓' : c.status === 'breach' ? '✕' : '?'}</span>
            ${c.status === 'pass' ? 'Pass' : c.status === 'breach' ? 'Breach' : 'Manual'}</span></td>
        </tr>`).join('')}</tbody></table></div>
      <p class="note">These are defaults for IPS drafting. An individual client's
      IPS may tighten them, and may loosen them only with documented rationale.</p>
    </div>

    <div class="card" style="margin-bottom:16px">
      <header><h3>Holdings</h3><span class="sub">click a fund for its scorecard</span></header>
      <div class="table-wrap"><table><thead><tr>
        <th>Fund</th><th>Category</th><th>Classification</th>
        <th class="num">Score</th><th class="num">Weight</th><th></th></tr></thead>
        <tbody>${d.holdings.map(h => `<tr>
          <td class="name-cell clickable" data-key="${esc(h.key)}">${esc(h.name)}<small>${esc(h.amc)}</small></td>
          <td>${esc(h.category)}</td><td>${pill(h.classification)}</td>
          <td class="num">${n1(h.score, 1)}</td>
          <td class="num"><input type="number" class="pf-w" data-key="${esc(h.key)}"
            value="${h.weight}" min="0" max="100" step="0.5"
            style="width:74px;font:inherit;font-size:12.5px;padding:3px 6px;border:1px solid var(--border-strong);border-radius:6px;background:var(--surface-2);color:var(--text-primary);text-align:right"></td>
          <td><button class="icon-btn pf-x" data-key="${esc(h.key)}" style="padding:3px 8px">✕</button></td>
        </tr>`).join('')}</tbody></table></div>
    </div>

    <div class="grid g2" style="margin-bottom:16px">
      <div class="card">
        <header><h3>Look-through — top stocks</h3>
          <span class="sub">aggregated across every fund's book</span></header>
        <div id="pf-stocks"></div>
      </div>
      <div class="card">
        <header><h3>Look-through — sectors</h3>
          <span class="sub">where the portfolio actually is</span></header>
        <div id="pf-sectors"></div>
      </div>
    </div>

    <div class="card">
      <header><h3>Pairwise overlap</h3>
        <span class="sub">Σ min(weight) over shared names — higher means one position held twice</span></header>
      <div class="table-wrap"><table class="matrix"><thead><tr><th class="rowlab"></th>
        ${d.overlap.names.map((nm, i) => `<th title="${esc(nm)}">F${i + 1}</th>`).join('')}</tr></thead>
        <tbody>${d.overlap.matrix.map((row, i) => `<tr>
          <th class="rowlab">F${i + 1} · ${esc(d.overlap.names[i])}</th>
          ${row.map((v, j) => {
            if (i === j) return '<td class="muted">—</td>';
            const t = Math.max(0, Math.min(1, (v ?? 0) / 70));
            return `<td style="background:${Chart.seqColor(t)};color:${Chart.seqInk(t)}">${n1(v, 0)}</td>`;
          }).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="note">Beyond roughly ten schemes, holdings overlap makes the
      portfolio an expensive index fund. The matrix is where that shows up before
      the client's returns do.</p>
    </div>`;

  Chart.bars($('#pf-stocks'), lt.topStocks.slice(0, 15).map(s => ({
    label: s.security, value: s.pct,
  })), { suffix: '%', decimals: 2 });
  Chart.bars($('#pf-sectors'), lt.sectors.slice(0, 14).map(s => ({
    label: s.name, value: s.pct,
  })), { suffix: '%', decimals: 1 });

  $$('#view-portfolio .name-cell.clickable').forEach(td => {
    td.style.cursor = 'pointer';
    td.onclick = () => openFund(td.dataset.key);
  });
  $$('#view-portfolio .pf-w').forEach(inp => {
    inp.onchange = () => {
      const v = parseFloat(inp.value);
      if (v > 0) S.portfolio[inp.dataset.key] = v; else delete S.portfolio[inp.dataset.key];
      savePortfolio();
      renderPortfolio();
    };
  });
  $$('#view-portfolio .pf-x').forEach(btn => {
    btn.onclick = () => { delete S.portfolio[btn.dataset.key]; savePortfolio(); renderPortfolio(); };
  });
}

/* -------------------------------------------------------------- monitoring */

async function renderMonitoring() {
  if (S.rendered.monitoring) return;
  const host = $('#view-monitoring');
  const d = await api('/monitoring?scope=eligible');
  S.monitoring = d;

  host.innerHTML = `
    <div class="grid g4" style="margin-bottom:16px">
      ${tile('Triggers firing', d.count, `across ${d.fundsAffected} gate-passing funds`)}
      ${tile('Exit protocol', d.bySeverity.exit, 'composite below 50')}
      ${tile('To Watch', d.bySeverity.watch, 'two-quarter cure period')}
      ${tile('Risk review', d.bySeverity.review, 'drawdown or capacity')}
    </div>

    <div class="grid g2" style="margin-bottom:16px">
      <div class="card">
        <header><h3>Review cadence</h3><span class="sub">§11.1</span></header>
        <div class="table-wrap"><table class="tight"><tbody>
          ${d.cadence.map(c => `<tr>
            <td style="font-weight:600;white-space:nowrap;vertical-align:top">${esc(c.frequency)}</td>
            <td style="font-size:12.5px">${esc(c.activity)}
              <div class="muted" style="margin-top:3px">→ ${esc(c.output)}</div></td>
          </tr>`).join('')}
        </tbody></table></div>
      </div>
      <div class="card">
        <header><h3>Trigger catalogue</h3>
          <span class="sub">§11.2 — triggers act between cycles and override scores</span></header>
        <div class="table-wrap"><table class="tight"><tbody>
          ${d.catalogue.map(t => `<tr>
            <td style="width:1%"><span class="gate ${t.automated ? 'pass' : 'manual'}">
              <span class="mark">${t.automated ? '⚙' : '?'}</span>${t.code}</span></td>
            <td style="font-size:12.5px"><b>${esc(t.trigger)}</b>
              <div class="muted" style="margin-top:2px">${esc(t.response)}</div></td>
            <td class="num">${d.byTrigger[t.code] || 0}</td>
          </tr>`).join('')}
        </tbody></table></div>
        <p class="note"><strong>⚙</strong> tested automatically from this data.
        <strong>?</strong> needs a manager, AMC or regulatory feed the pipeline
        does not carry — those stay with Research.</p>
      </div>
    </div>

    <div class="card">
      <header><h3>Exception log</h3>
        <span class="sub">ordered by severity, then by composite</span></header>
      <div class="table-wrap"><table><thead><tr>
        <th>Fund</th><th>Trigger</th><th>Action required</th>
        <th class="num">Score</th><th>Classification</th></tr></thead>
        <tbody>${d.triggers.map(t => `<tr class="clickable" data-key="${esc(t.key)}">
          <td class="name-cell">${esc(t.name)}
            <small>${esc(t.category)}${t.onHouseWhitelist ? ' · on house whitelist' : ''}</small></td>
          <td style="white-space:nowrap"><span class="pill ${
            t.severity === 'exit' ? 'exit' : t.severity === 'watch' ? 'hold' : 'satellite'}">
            <i class="dot"></i>${esc(t.code)}</span>
            <div class="muted" style="font-size:11.5px;margin-top:3px">${esc(t.trigger)}</div></td>
          <td style="font-size:12.5px;color:var(--text-secondary)">${esc(t.detail)}</td>
          <td class="num">${n1(t.score, 1)}</td>
          <td>${pill(t.classification)}</td>
        </tr>`).join('')}</tbody></table></div>
    </div>`;

  wireRows(host);
  S.rendered.monitoring = true;
}

/* --------------------------------------------------------------- framework */

async function renderFramework() {
  if (S.rendered.framework) return;
  const f = S.fw;
  const host = $('#view-framework');

  host.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <header><h2>${esc(f.policy.title)}</h2>
        <span class="sub">${esc(f.policy.version)} · ${esc(f.policy.date)} · ${esc(f.policy.owner)}</span></header>
      <p style="font-size:13px;color:var(--text-secondary);max-width:76ch">${esc(f.policy.scope)}</p>
      <p class="note">Companion workbook: ${esc(f.policy.companion)}. Every weight,
      threshold and band on this dashboard is read from the same encoded source —
      change one without the other and the two disagree, which the policy calls a
      breach.</p>
    </div>

    <div class="card" style="margin-bottom:16px">
      <header><h3>Investment philosophy</h3><span class="sub">§2 — six principles, each resolving a recurring failure mode</span></header>
      <div class="grid g3">
        ${f.principles.map(p => `<div>
          <h4>${p.n} · ${esc(p.title)}</h4>
          <p style="font-size:12.5px;color:var(--text-secondary);margin:4px 0 0">${esc(p.body)}</p>
        </div>`).join('')}
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <header><h3>Stage 1 — the seven hard gates</h3><span class="sub">§5</span></header>
      <div class="table-wrap"><table><thead><tr>
        <th>Gate</th><th>Threshold</th><th>Rationale</th><th class="num">Automated</th></tr></thead>
        <tbody>${f.gates.map(g => `<tr>
          <td style="white-space:nowrap;font-weight:500">${g.code} ${esc(g.name)}</td>
          <td style="font-size:12.5px">${esc(g.threshold)}</td>
          <td style="font-size:12.5px;color:var(--text-secondary)">${esc(g.rationale)}</td>
          <td class="num">${g.automated ? '⚙' : '—'}</td>
        </tr>`).join('')}</tbody></table></div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <header><h3>Category-adjusted pillar weights</h3><span class="sub">§7 — the matrix lives in editable cells and must be defensible at review</span></header>
      <div class="pw-grid"><table><thead><tr><th>Pillar</th>
        ${f.categoryOrder.map(c => `<th class="w" style="text-align:center">${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${['A', 'B', 'C', 'D', 'E'].map((k, i) => `<tr>
          <td style="white-space:nowrap"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${Chart.PILLAR_COLORS[i]};margin-right:6px"></span>${k}. ${esc(f.pillars[k].name)}</td>
          ${f.categoryOrder.map(c => {
            const v = f.pillarWeights[c][k], base = f.pillars[k].base;
            const strong = v > base ? 'color:var(--good-text);font-weight:600' : v < base ? 'color:var(--text-muted)' : '';
            return `<td class="w" style="${strong}">${v}</td>`;
          }).join('')}</tr>`).join('')}
          <tr><td class="muted">Total</td>${f.categoryOrder.map(c =>
            `<td class="w muted">${['A','B','C','D','E'].reduce((s,k)=>s+f.pillarWeights[c][k],0)}</td>`).join('')}</tr>
        </tbody></table></div>
      <p class="note">Green is above the Flexi Cap base weight, grey below. A
      single weight set applied across categories quietly favours whichever style
      is in season — the matrix reweights the pillars to what actually
      differentiates funds within each category.</p>
    </div>

    <div class="card" style="margin-bottom:16px">
      <header><h3>The 21 parameters</h3><span class="sub">§6.3 — with the 1 / 3 / 5 bands from the Scoring Guide</span></header>
      <div class="table-wrap"><table><thead><tr>
        <th>Code</th><th>Parameter</th><th>Measurement</th>
        <th>Score 5</th><th>Score 3</th><th>Score 1</th><th class="num">Share</th></tr></thead>
        <tbody>${f.parameters.map(p => `<tr>
          <td style="font-family:var(--mono);font-size:12px">${p.code}</td>
          <td style="font-weight:500;min-width:150px">${esc(p.name)}</td>
          <td style="font-size:12px;color:var(--text-secondary);min-width:200px">${esc(p.measure)}</td>
          <td style="font-size:12px">${esc(p.bands['5'])}</td>
          <td style="font-size:12px;color:var(--text-secondary)">${esc(p.bands['3'])}</td>
          <td style="font-size:12px;color:var(--text-secondary)">${esc(p.bands['1'])}</td>
          <td class="num">${n1(p.share, 0)}%</td>
        </tr>`).join('')}</tbody></table></div>
    </div>

    <div class="grid g2" style="margin-bottom:16px">
      <div class="card">
        <header><h3>Stage 3 — classification</h3><span class="sub">§8.3</span></header>
        <div class="table-wrap"><table class="tight"><tbody>
          ${f.classificationBands.map(b => `<tr>
            <td style="white-space:nowrap">${pill(b.label)}</td>
            <td class="num">≥ ${b.min}</td>
            <td style="font-size:12.5px;color:var(--text-secondary)">${esc(b.action)}</td>
          </tr>`).join('')}
        </tbody></table></div>
        <p class="note">Two automatic rules sit above the bands. A fund failing any
        hard gate is rejected regardless of score. And a fund whose downside-capture
        parameter (${f.riskCap.parameter}) scores ${f.riskCap.score} — capture above
        115% — is capped at "${esc(f.riskCap.label)}" even if its composite clears
        Core, because the single most predictable committee failure is forgiving bad
        downside behaviour in a fund whose headline number is attractive. The IC may
        apply a documented overlay of up to ±${f.overlayCap} points, expiring after
        two quarters.</p>
      </div>
      <div class="card">
        <header><h3>Quant Helper bands</h3><span class="sub">§6.2 — raw metric to suggested score</span></header>
        <div class="table-wrap"><table class="tight"><thead><tr>
          <th>Code</th><th>Metric</th><th class="num">5</th><th class="num">4</th>
          <th class="num">3</th><th class="num">2</th><th class="num">1</th></tr></thead>
          <tbody>${Object.entries(f.quantBands).map(([code, b]) => {
            const op = b.dir === 'asc' ? '≥' : '≤';
            return `<tr><td style="font-family:var(--mono);font-size:12px">${code}</td>
              <td style="font-size:12px">${esc(b.label)}</td>
              ${b.cuts.map(c => `<td class="num">${op} ${c}</td>`).join('')}
              <td class="num">rest</td></tr>`;
          }).join('')}</tbody></table></div>
        <p class="note">Banded scoring was chosen over automated peer-percentile
        ranking after direct comparison: percentile ranking is elegant but silently
        fragile — with a thin peer set the ranks become coarse and volatile. Bands
        are stable, auditable and force the firm to write down in advance what
        'good' means.</p>
      </div>
    </div>

    <div class="grid g2">
      <div class="card">
        <header><h3>Whitelist construction rules</h3><span class="sub">§9</span></header>
        ${f.whitelistRules.map(r => `<div style="padding:7px 0;border-bottom:1px solid var(--grid)">
          <b style="font-size:13px">${esc(r.rule)}</b>
          <div style="font-size:12.5px">${esc(r.guideline)}</div>
          <div class="muted" style="font-size:12px;margin-top:2px">${esc(r.rationale)}</div>
        </div>`).join('')}
      </div>
      <div class="card">
        <header><h3>Methodology conventions</h3><span class="sub">§12</span></header>
        <ul style="margin:0;padding-left:18px;font-size:12.5px;color:var(--text-secondary);line-height:1.7">
          ${f.conventions.map(c => `<li>${esc(c)}</li>`).join('')}
        </ul>
        <h4 style="margin:16px 0 8px">Data sources wired into this dashboard</h4>
        <dl class="kv" style="font-size:12.5px">
          <dt>Quantitative</dt><dd>${esc(S.meta.meta.sources.quantitative)}</dd>
          <dt>Holdings</dt><dd>${esc(S.meta.meta.sources.holdings || '—')}</dd>
          <dt>Whitelist</dt><dd>${esc(S.meta.meta.sources.whitelist || '—')}</dd>
          <dt>Framework</dt><dd>${esc(S.meta.meta.sources.framework)}</dd>
          <dt>Metrics as of</dt><dd>${esc(S.meta.meta.metricsAsOf || '—')}</dd>
          <dt>NAV date</dt><dd>${esc(S.meta.meta.navDate || '—')}</dd>
          <dt>Built</dt><dd>${esc(S.meta.meta.builtAt || '—')}</dd>
        </dl>
      </div>
    </div>`;
  S.rendered.framework = true;
}

/* ------------------------------------------------------------------- boot */

window.closeDrawer = closeDrawer;

(async function boot() {
  const saved = localStorage.getItem('mf.theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);

  try {
    const [meta, fw] = await Promise.all([api('/meta'), api('/framework')]);
    S.meta = meta; S.fw = fw;
    $('#mast-sub').textContent =
      `${meta.scoredFunds} schemes scored across 11 SEBI equity categories · ` +
      `${meta.eligibleFunds} clear Stage 1 · policy ${fw.policy.version} · ` +
      `metrics as of ${meta.meta.metricsAsOf || '—'}`;
    show(location.hash.slice(1) || 'overview');
  } catch (err) {
    document.querySelector('main').innerHTML =
      `<div class="card"><div class="empty">Could not reach the API: ${esc(err.message)}<br><br>
      Build the dataset first: <code>python etl/build_dataset.py --workbook &lt;xlsx&gt; --whitelist-pdf &lt;pdf&gt;</code></div></div>`;
  }
})();

window.addEventListener('resize', () => {
  clearTimeout(window.__rz);
  window.__rz = setTimeout(() => {
    S.rendered = {};
    show(location.hash.slice(1) || 'overview');
  }, 300);
});
