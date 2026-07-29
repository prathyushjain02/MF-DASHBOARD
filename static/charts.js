/* Chart primitives — plain SVG, no dependencies.
   Every form here ships a hover layer, a recessive grid, thin marks with 4px
   rounded data-ends, and a 2px surface gap between adjacent fills. Colour is
   assigned by the job it does: single-hue sequential for magnitude, the fixed
   categorical order for identity, reserved status colours for state. */

const SVG_NS = 'http://www.w3.org/2000/svg';

const Chart = (() => {
  const tip = () => document.getElementById('tooltip');

  function el(name, attrs = {}, text) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined) continue;
      node.setAttribute(k, v);
    }
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showTip(evt, html) {
    const t = tip();
    t.innerHTML = html;
    t.style.opacity = '1';
    const pad = 14;
    const rect = t.getBoundingClientRect();
    let x = evt.clientX + pad;
    let y = evt.clientY + pad;
    if (x + rect.width > window.innerWidth - 8) x = evt.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 8) y = evt.clientY - rect.height - pad;
    t.style.left = Math.max(8, x) + 'px';
    t.style.top = Math.max(8, y) + 'px';
  }

  function hideTip() { tip().style.opacity = '0'; }

  function hoverable(node, html) {
    node.addEventListener('mousemove', (e) => showTip(e, html));
    node.addEventListener('mouseleave', hideTip);
    node.style.cursor = 'default';
  }

  const fmt = (v, d = 1) =>
    (v === null || v === undefined || Number.isNaN(v)) ? '—' : Number(v).toFixed(d);

  function niceMax(v) {
    if (v <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / mag;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * mag;
  }

  /* ------------------------------------------------------------ bar rows */
  /* Horizontal bars for ranked magnitude. Labels sit outside the bar, so the
     light-mode contrast relief rule is satisfied without relying on the fill. */
  function bars(host, rows, opts = {}) {
    const {
      color = 'var(--series-1)', suffix = '', decimals = 1,
      max = null, colorFor = null, tipFor = null, onClick = null,
    } = opts;
    host.innerHTML = '';
    if (!rows.length) { host.innerHTML = '<div class="empty">No data</div>'; return; }
    const top = max ?? Math.max(...rows.map(r => Math.abs(r.value) || 0), 0.0001);

    rows.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'barrow';
      const lab = document.createElement('div');
      lab.className = 'lab';
      lab.textContent = r.label;
      lab.title = r.label;
      const track = document.createElement('div');
      track.className = 'track';
      const fill = document.createElement('div');
      fill.className = 'fill';
      fill.style.width = Math.max(0, Math.min(100, (Math.abs(r.value) / top) * 100)) + '%';
      fill.style.background = colorFor ? colorFor(r) : color;
      track.appendChild(fill);
      const val = document.createElement('div');
      val.className = 'val';
      val.textContent = r.display ?? (fmt(r.value, decimals) + suffix);
      row.append(lab, track, val);
      if (tipFor) hoverable(row, tipFor(r));
      if (onClick) { row.style.cursor = 'pointer'; row.onclick = () => onClick(r); }
      host.appendChild(row);
    });
  }

  /* --------------------------------------------------- stacked pillar bar */
  /* Identity encoding: the five pillars take categorical slots 1–5 in fixed
     order. A 2px surface gap separates adjacent segments; a legend is always
     present and each segment carries a direct label when it is wide enough. */
  const PILLAR_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)',
                         'var(--series-4)', 'var(--series-5)'];

  function pillarBar(host, pillars, opts = {}) {
    const { height = 34, showLabels = true } = opts;
    host.innerHTML = '';
    const keys = ['A', 'B', 'C', 'D', 'E'];
    const total = keys.reduce((s, k) => s + (pillars[k]?.available || 0), 0) || 100;
    const w = host.clientWidth || 600;
    const svg = el('svg', { class: 'chart', viewBox: `0 0 ${w} ${height + 20}`, height: height + 20 });

    let x = 0;
    keys.forEach((k, i) => {
      const p = pillars[k];
      if (!p) return;
      const segW = (p.available / total) * w;
      const earnedW = (p.earned / total) * w;
      // Available weight, recessive.
      svg.appendChild(el('rect', {
        x, y: 0, width: Math.max(0, segW - 2), height,
        rx: 4, fill: 'var(--grid)',
      }));
      // Earned weight, in the pillar's hue.
      const mark = el('rect', {
        x, y: 0, width: Math.max(0, Math.min(earnedW, segW - 2)), height,
        rx: 4, fill: PILLAR_COLORS[i],
      });
      hoverable(mark, `<strong>${k}. ${p.name}</strong>
        <div class="tt-row"><span>Earned</span><span>${fmt(p.earned, 2)}</span></div>
        <div class="tt-row"><span>Available</span><span>${fmt(p.available, 2)}</span></div>
        <div class="tt-row"><span>Pillar score</span><span>${fmt(p.pct, 0)}%</span></div>`);
      svg.appendChild(mark);
      if (showLabels && segW > 34) {
        svg.appendChild(el('text', {
          x: x + segW / 2 - 1, y: height + 14, class: 'tick-label',
          'text-anchor': 'middle',
        }, `${k} ${fmt(p.pct, 0)}%`));
      }
      x += segW;
    });
    host.appendChild(svg);
  }

  /* ------------------------------------------------------------- scatter */
  /* Two colours only (population + the highlighted fund), so the all-pairs
     series cap is never in play. */
  function scatter(host, points, opts = {}) {
    const {
      xLabel = '', yLabel = '', height = 320,
      xRef = null, yRef = null, refLabel = 'Benchmark', onClick = null,
    } = opts;
    host.innerHTML = '';
    const pts = points.filter(p => p.x !== null && p.y !== null &&
                                   p.x !== undefined && p.y !== undefined);
    if (pts.length < 2) { host.innerHTML = '<div class="empty">Not enough data to plot</div>'; return; }

    const w = host.clientWidth || 640;
    const m = { t: 12, r: 16, b: 42, l: 52 };
    const iw = w - m.l - m.r, ih = height - m.t - m.b;

    const xs = pts.map(p => p.x).concat(xRef !== null ? [xRef] : []);
    const ys = pts.map(p => p.y).concat(yRef !== null ? [yRef] : []);
    const pad = (a) => { const lo = Math.min(...a), hi = Math.max(...a); const d = (hi - lo) || 1; return [lo - d * 0.08, hi + d * 0.08]; };
    const [x0, x1] = pad(xs), [y0, y1] = pad(ys);
    const sx = v => m.l + ((v - x0) / (x1 - x0)) * iw;
    const sy = v => m.t + ih - ((v - y0) / (y1 - y0)) * ih;

    const svg = el('svg', { class: 'chart', viewBox: `0 0 ${w} ${height}`, height });

    for (let i = 0; i <= 4; i++) {
      const gy = m.t + (ih / 4) * i;
      svg.appendChild(el('line', { x1: m.l, x2: m.l + iw, y1: gy, y2: gy, class: 'gridline' }));
      svg.appendChild(el('text', {
        x: m.l - 8, y: gy + 4, class: 'tick-label', 'text-anchor': 'end',
      }, fmt(y1 - ((y1 - y0) / 4) * i, 0)));
    }
    for (let i = 0; i <= 4; i++) {
      const gx = m.l + (iw / 4) * i;
      svg.appendChild(el('text', {
        x: gx, y: height - m.b + 16, class: 'tick-label', 'text-anchor': 'middle',
      }, fmt(x0 + ((x1 - x0) / 4) * i, 0)));
    }
    svg.appendChild(el('line', { x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih, class: 'baseline' }));

    // Benchmark reference lines — dashed, muted, labelled.
    if (xRef !== null && xRef >= x0 && xRef <= x1) {
      svg.appendChild(el('line', {
        x1: sx(xRef), x2: sx(xRef), y1: m.t, y2: m.t + ih,
        stroke: 'var(--axis)', 'stroke-width': 1, 'stroke-dasharray': '3 3',
      }));
    }
    if (yRef !== null && yRef >= y0 && yRef <= y1) {
      svg.appendChild(el('line', {
        x1: m.l, x2: m.l + iw, y1: sy(yRef), y2: sy(yRef),
        stroke: 'var(--axis)', 'stroke-width': 1, 'stroke-dasharray': '3 3',
      }));
      svg.appendChild(el('text', {
        x: m.l + iw, y: sy(yRef) - 5, class: 'tick-label', 'text-anchor': 'end',
      }, refLabel));
    }

    pts.forEach((p) => {
      const c = el('circle', {
        cx: sx(p.x), cy: sy(p.y), r: p.highlight ? 8 : 4.5,
        fill: p.highlight ? 'var(--series-2)' : 'var(--series-1)',
        'fill-opacity': p.highlight ? 1 : 0.6,
        stroke: 'var(--surface-1)', 'stroke-width': 2,
      });
      hoverable(c, `<strong>${p.label}</strong>
        <div class="tt-row"><span>${xLabel}</span><span>${fmt(p.x, 2)}</span></div>
        <div class="tt-row"><span>${yLabel}</span><span>${fmt(p.y, 2)}</span></div>
        ${p.extra || ''}`);
      if (onClick) { c.style.cursor = 'pointer'; c.addEventListener('click', () => onClick(p)); }
      svg.appendChild(c);
    });

    svg.appendChild(el('text', {
      x: m.l + iw / 2, y: height - 4, class: 'axis-label', 'text-anchor': 'middle',
    }, xLabel));
    svg.appendChild(el('text', {
      x: 12, y: m.t + ih / 2, class: 'axis-label', 'text-anchor': 'middle',
      transform: `rotate(-90 12 ${m.t + ih / 2})`,
    }, yLabel));

    host.appendChild(svg);
  }

  /* ----------------------------------------------------------- histogram */
  /* Score distribution with the classification band boundaries drawn in. */
  function histogram(host, values, opts = {}) {
    const { bins = 20, height = 200, marks = [], xLabel = '' } = opts;
    host.innerHTML = '';
    const vals = values.filter(v => typeof v === 'number' && !Number.isNaN(v));
    if (!vals.length) { host.innerHTML = '<div class="empty">No data</div>'; return; }

    const w = host.clientWidth || 640;
    const m = { t: 10, r: 12, b: 40, l: 38 };
    const iw = w - m.l - m.r, ih = height - m.t - m.b;
    const lo = 0, hi = 100, step = (hi - lo) / bins;
    const counts = new Array(bins).fill(0);
    vals.forEach(v => { counts[Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / step)))]++; });
    const top = niceMax(Math.max(...counts));

    const svg = el('svg', { class: 'chart', viewBox: `0 0 ${w} ${height}`, height });
    for (let i = 0; i <= 3; i++) {
      const gy = m.t + (ih / 3) * i;
      svg.appendChild(el('line', { x1: m.l, x2: m.l + iw, y1: gy, y2: gy, class: 'gridline' }));
      svg.appendChild(el('text', {
        x: m.l - 7, y: gy + 4, class: 'tick-label', 'text-anchor': 'end',
      }, Math.round(top - (top / 3) * i)));
    }

    const bw = iw / bins;
    counts.forEach((c, i) => {
      if (!c) return;
      const h = (c / top) * ih;
      const r = el('rect', {
        x: m.l + i * bw, y: m.t + ih - h, width: Math.max(1, bw - 2), height: h,
        rx: 4, fill: 'var(--series-1)', 'fill-opacity': 0.85,
      });
      hoverable(r, `<strong>Score ${(lo + i * step).toFixed(0)}–${(lo + (i + 1) * step).toFixed(0)}</strong>
        <div class="tt-row"><span>Funds</span><span>${c}</span></div>`);
      svg.appendChild(r);
    });

    marks.forEach((mk) => {
      const x = m.l + ((mk.at - lo) / (hi - lo)) * iw;
      svg.appendChild(el('line', {
        x1: x, x2: x, y1: m.t, y2: m.t + ih,
        stroke: mk.color || 'var(--axis)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3',
      }));
      svg.appendChild(el('text', {
        x: x + 4, y: m.t + 11, class: 'tick-label',
      }, mk.label));
    });

    svg.appendChild(el('line', { x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih, class: 'baseline' }));
    for (let i = 0; i <= 5; i++) {
      const x = m.l + (iw / 5) * i;
      svg.appendChild(el('text', {
        x, y: height - m.b + 16, class: 'tick-label', 'text-anchor': 'middle',
      }, Math.round(lo + ((hi - lo) / 5) * i)));
    }
    svg.appendChild(el('text', {
      x: m.l + iw / 2, y: height - 4, class: 'axis-label', 'text-anchor': 'middle',
    }, xLabel));
    host.appendChild(svg);
  }

  /* ---------------------------------------------------------- range strip */
  /* Category spread: min–max whisker, p25–p75 box, median tick, this fund's
     position marked. One hue; position carries the meaning. */
  function rangeStrip(host, rows, opts = {}) {
    const { decimals = 1, suffix = '' } = opts;
    host.innerHTML = '';
    const w = host.clientWidth || 560;
    const labelW = 150, valW = 92;
    // Room for the min and max readings printed at the whisker ends, so the
    // strip is legible on its own rather than only under the cursor.
    const endW = 42;
    const plotW = Math.max(120, w - labelW - valW - 16 - endW * 2);
    const rowH = 30;
    const top = 8;  // headroom for the median reading printed above row one
    const svg = el('svg', {
      class: 'chart', viewBox: `0 0 ${w} ${rows.length * rowH + top + 6}`,
      height: rows.length * rowH + top + 6,
    });

    rows.forEach((r, i) => {
      const y = top + i * rowH + rowH / 2;
      svg.appendChild(el('text', { x: 0, y: y + 4, class: 'tick-label' }, r.label));
      if (!r.spread) {
        svg.appendChild(el('text', { x: labelW + endW, y: y + 4, class: 'tick-label' }, 'no data'));
        return;
      }
      const s = r.spread;
      const lo = s.min, hi = s.max, span = (hi - lo) || 1;
      const px = v => labelW + endW + ((v - lo) / span) * plotW;

      svg.appendChild(el('text', {
        x: labelW + endW - 6, y: y + 4, class: 'value-label', 'text-anchor': 'end',
      }, fmt(lo, decimals)));
      svg.appendChild(el('text', {
        x: labelW + endW + plotW + 6, y: y + 4, class: 'value-label',
      }, fmt(hi, decimals)));
      svg.appendChild(el('text', {
        x: px(s.median), y: y - 11, class: 'value-label', 'text-anchor': 'middle',
      }, fmt(s.median, decimals)));

      svg.appendChild(el('line', {
        x1: px(lo), x2: px(hi), y1: y, y2: y, stroke: 'var(--grid)', 'stroke-width': 3,
        'stroke-linecap': 'round',
      }));
      const box = el('rect', {
        x: px(s.p25), y: y - 6, width: Math.max(2, px(s.p75) - px(s.p25)), height: 12,
        rx: 4, fill: 'var(--seq-200)',
      });
      hoverable(box, `<strong>${r.label}</strong>
        <div class="tt-row"><span>Min</span><span>${fmt(s.min, decimals)}</span></div>
        <div class="tt-row"><span>P25</span><span>${fmt(s.p25, decimals)}</span></div>
        <div class="tt-row"><span>Median</span><span>${fmt(s.median, decimals)}</span></div>
        <div class="tt-row"><span>P75</span><span>${fmt(s.p75, decimals)}</span></div>
        <div class="tt-row"><span>Max</span><span>${fmt(s.max, decimals)}</span></div>
        <div class="tt-row"><span>Funds</span><span>${s.n}</span></div>`);
      svg.appendChild(box);
      svg.appendChild(el('line', {
        x1: px(s.median), x2: px(s.median), y1: y - 8, y2: y + 8,
        stroke: 'var(--seq-700)', 'stroke-width': 2, 'stroke-linecap': 'round',
      }));
      if (r.value !== null && r.value !== undefined) {
        const cx = px(Math.max(lo, Math.min(hi, r.value)));
        const dot = el('circle', {
          cx, cy: y, r: 5.5, fill: 'var(--series-2)',
          stroke: 'var(--surface-1)', 'stroke-width': 2,
        });
        hoverable(dot, `<strong>${r.fundName || 'This fund'}</strong>
          <div class="tt-row"><span>${r.label}</span><span>${fmt(r.value, decimals)}${suffix}</span></div>`);
        svg.appendChild(dot);
        svg.appendChild(el('text', {
          x: w - 4, y: y + 4, class: 'value-label', 'text-anchor': 'end',
        }, fmt(r.value, decimals) + suffix));
      }
    });
    host.appendChild(svg);
  }

  /* --------------------------------------------------------------- funnel */
  function funnel(host, stages) {
    host.innerHTML = '';
    const top = stages[0]?.value || 1;
    stages.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'barrow';
      row.innerHTML = `<div class="lab">${s.label}</div>
        <div class="track"><div class="fill"></div></div>
        <div class="val">${s.value}</div>`;
      const fill = row.querySelector('.fill');
      fill.style.width = ((s.value / top) * 100) + '%';
      fill.style.background = `var(--seq-${[700, 550, 450, 300, 200][Math.min(i, 4)]})`;
      if (s.note) hoverable(row, `<strong>${s.label}</strong>${s.note}`);
      host.appendChild(row);
    });
  }

  /* -------------------------------------------------- sequential cell ink */
  /* Blue sequential ramp for the overlap heatmap — one hue, light→dark. */
  function seqColor(t) {
    const steps = ['var(--seq-100)', 'var(--seq-200)', 'var(--seq-300)',
                   'var(--seq-450)', 'var(--seq-550)', 'var(--seq-700)'];
    const i = Math.max(0, Math.min(steps.length - 1, Math.floor(t * steps.length)));
    return steps[i];
  }
  function seqInk(t) { return t > 0.55 ? '#ffffff' : 'var(--text-primary)'; }

  return { bars, pillarBar, scatter, histogram, rangeStrip, funnel,
           seqColor, seqInk, hoverable, showTip, hideTip, fmt, PILLAR_COLORS };
})();
