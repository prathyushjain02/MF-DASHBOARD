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

  /* ---------------------------------------------------- weighted block bar */
  /* Seven blocks is past the categorical cap, and the reader's question here is
     "how much of each block did this fund earn", which is magnitude and not
     identity. So the bar uses one hue against a recessive track, segment width
     is the block's weight in the composite, and every segment carries a direct
     label. No hue is ever cycled. */
  function blockBar(host, blocks, opts = {}) {
    const { height = 34 } = opts;
    host.innerHTML = '';
    const total = blocks.reduce((s, b) => s + b.weight, 0) || 100;
    const w = host.clientWidth || 640;
    const svg = el('svg', { class: 'chart', viewBox: `0 0 ${w} ${height + 34}`,
                            height: height + 34 });
    let x = 0;
    blocks.forEach((b) => {
      const segW = (b.weight / total) * w;
      const pct = b.score == null ? 0 : b.score / 100;
      svg.appendChild(el('rect', { x, y: 0, width: Math.max(0, segW - 2), height,
                                   rx: 4, fill: 'var(--grid)' }));
      if (b.score != null) {
        const mark = el('rect', {
          x, y: height * (1 - pct), width: Math.max(0, segW - 2), height: height * pct,
          rx: 4, fill: seqColor(pct),
        });
        hoverable(mark, `<strong>${b.name}</strong>
          <div class="tt-row"><span>Block score</span><span>${fmt(b.score, 0)} / 100</span></div>
          <div class="tt-row"><span>Weight</span><span>${b.weight}%</span></div>
          <div class="tt-row"><span>Coverage</span><span>${fmt(b.coverage, 0)}%</span></div>`);
        svg.appendChild(mark);
      } else {
        const miss = el('rect', { x, y: 0, width: Math.max(0, segW - 2), height,
                                  rx: 4, fill: 'url(#hatch)' });
        hoverable(miss, `<strong>${b.name}</strong>
          <div class="tt-row"><span>Not scored</span><span>no data</span></div>
          <div class="tt-row"><span>Weight</span><span>${b.weight}%</span></div>`);
        svg.appendChild(miss);
      }
      if (segW > 30) {
        svg.appendChild(el('text', { x: x + segW / 2 - 1, y: height + 14,
                                     class: 'tick-label', 'text-anchor': 'middle' },
                           b.score == null ? 'n/s' : fmt(b.score, 0)));
        svg.appendChild(el('text', { x: x + segW / 2 - 1, y: height + 28,
                                     class: 'tick-label dim', 'text-anchor': 'middle' },
                           b.weight + '%'));
      }
      x += segW;
    });
    const defs = el('defs');
    const pat = el('pattern', { id: 'hatch', width: 6, height: 6,
                                patternUnits: 'userSpaceOnUse',
                                patternTransform: 'rotate(45)' });
    pat.appendChild(el('rect', { width: 6, height: 6, fill: 'var(--grid)' }));
    pat.appendChild(el('line', { x1: 0, y1: 0, x2: 0, y2: 6,
                                 stroke: 'var(--axis)', 'stroke-width': 2 }));
    defs.appendChild(pat);
    svg.appendChild(defs);
    host.appendChild(svg);
  }

  /* --------------------------------------------------------- paired bars */
  /* Two bars per period, fund and index, on one scale. A grouped bar rather than
     a tick because the question is "how do these two compare", and two marks of
     the same kind compare more directly than a bar against a rule.

     Two series, so identity is carried by a legend and by fixed hues that never
     move between periods. Negatives run left of a zero line. */
  function barsPaired(host, rows, opts = {}) {
    const { suffix = '%', decimals = 1, aLabel = 'Fund', bLabel = 'Index' } = opts;
    host.innerHTML = '';
    if (!rows.length) { host.innerHTML = '<div class="empty">No record yet</div>'; return; }
    const vals = rows.flatMap((r) => [r.a, r.b]).filter((v) => v != null);
    if (!vals.length) { host.innerHTML = '<div class="empty">No record yet</div>'; return; }
    const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const span = (hi - lo) || 1;
    const pos = (v) => ({
      left: ((Math.min(v, 0) - lo) / span * 100) + '%',
      width: Math.max(0.8, Math.abs(v) / span * 100) + '%',
    });

    rows.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'pairrow';
      const lab = document.createElement('div');
      lab.className = 'lab';
      lab.textContent = r.label;
      const stack = document.createElement('div');
      stack.className = 'stack';
      [['a', r.a], ['b', r.b]].forEach(([which, v]) => {
        const track = document.createElement('div');
        track.className = 'track';
        if (v == null) {
          track.innerHTML = '<span class="norec">no record yet</span>';
        } else {
          const bar = document.createElement('div');
          bar.className = 'bar ' + which + (v < 0 ? ' neg' : '');
          const p = pos(v);
          bar.style.left = p.left; bar.style.width = p.width;
          track.appendChild(bar);
          const z = document.createElement('div');
          z.className = 'zero';
          z.style.left = ((0 - lo) / span * 100) + '%';
          track.appendChild(z);
        }
        const val = document.createElement('div');
        val.className = 'val ' + which;
        val.textContent = v == null ? '' : fmt(v, decimals) + suffix;
        const line = document.createElement('div');
        line.className = 'line';
        line.append(track, val);
        stack.appendChild(line);
      });
      const gap = (r.a != null && r.b != null) ? r.a - r.b : null;
      hoverable(row, `<strong>${r.label}</strong>
        <div class="tt-row"><span>${aLabel}</span><span>${fmt(r.a, decimals)}${suffix}</span></div>
        <div class="tt-row"><span>${bLabel}</span><span>${fmt(r.b, decimals)}${suffix}</span></div>
        ${gap == null ? '' : `<div class="tt-row"><span>Difference</span><span>${
          (gap >= 0 ? '+' : '') + fmt(gap, decimals)} pts</span></div>`}`);
      row.append(lab, stack);
      host.appendChild(row);
    });

    host.insertAdjacentHTML('beforeend',
      `<div class="pairkey"><span><i class="a"></i>${aLabel}</span>
        <span><i class="b"></i>${bLabel}</span></div>`);
  }

  /* ----------------------------------------------- paired bars (vertical) */
  /* The same fund-vs-index comparison as barsPaired, drawn as upright columns
     against a zero baseline. Vertical reads as "returns over the period" the way
     a reader already expects a performance chart to look; the horizontal form is
     kept for tight rows elsewhere. Two fixed hues carry identity, a legend names
     them, and negative periods drop below the baseline. */
  function barsPairedV(host, rows, opts = {}) {
    const {
      suffix = '%', decimals = 1, aLabel = 'Fund', bLabel = 'Index',
      height = 104, aColor = 'var(--seq-550)', bColor = 'var(--seq-200)',
    } = opts;
    host.innerHTML = '';
    if (!rows.length) { host.innerHTML = '<div class="empty">No record yet</div>'; return; }
    const vals = rows.flatMap((r) => [r.a, r.b]).filter((v) => v != null);
    if (!vals.length) { host.innerHTML = '<div class="empty">No record yet</div>'; return; }

    const w = host.clientWidth || 520;
    const m = { t: 18, r: 10, b: 32, l: 34 };
    const iw = w - m.l - m.r, ih = height - m.t - m.b;

    // Scale runs from a rounded floor to a rounded ceiling, always through zero.
    const rawHi = Math.max(0, ...vals), rawLo = Math.min(0, ...vals);
    const yTop = niceMax(rawHi) || 1;
    const yBot = rawLo < 0 ? -niceMax(-rawLo) : 0;
    const span = (yTop - yBot) || 1;
    const sy = (v) => m.t + ih * (yTop - v) / span;
    const zeroY = sy(0);

    const svg = el('svg', { class: 'chart', viewBox: `0 0 ${w} ${height}`, height });

    // Horizontal gridlines and their readings, four divisions across the range.
    for (let i = 0; i <= 4; i++) {
      const v = yTop - (span / 4) * i;
      const gy = sy(v);
      svg.appendChild(el('line', { x1: m.l, x2: m.l + iw, y1: gy, y2: gy,
                                   class: v === 0 ? 'baseline' : 'gridline' }));
      svg.appendChild(el('text', { x: m.l - 7, y: gy + 3.5, class: 'tick-label',
                                   'text-anchor': 'end' }, fmt(v, 0)));
    }

    const n = rows.length;
    const groupW = iw / n;
    const barW = Math.min(26, groupW * 0.3);
    const gap = 4;

    rows.forEach((r, i) => {
      const cx = m.l + groupW * i + groupW / 2;
      const gap12 = r.a != null && r.b != null ? r.a - r.b : null;
      [['a', r.a, aColor, aLabel, cx - barW - gap / 2],
       ['b', r.b, bColor, bLabel, cx + gap / 2]].forEach(([which, v, fill, name, x]) => {
        if (v == null) {
          svg.appendChild(el('text', { x: x + barW / 2, y: zeroY - 4,
                                       class: 'tick-label', 'text-anchor': 'middle' }, '—'));
          return;
        }
        const y = v >= 0 ? sy(v) : zeroY;
        const h = Math.max(1.5, Math.abs(sy(v) - zeroY));
        const rect = el('rect', { x, y, width: barW, height: h, rx: 3, fill });
        hoverable(rect, `<strong>${r.label}</strong>
          <div class="tt-row"><span>${aLabel}</span><span>${fmt(r.a, decimals)}${suffix}</span></div>
          <div class="tt-row"><span>${bLabel}</span><span>${fmt(r.b, decimals)}${suffix}</span></div>
          ${gap12 == null ? '' : `<div class="tt-row"><span>Difference</span><span>${
            (gap12 >= 0 ? '+' : '') + fmt(gap12, decimals)} pts</span></div>`}`);
        svg.appendChild(rect);
        // Reading sits above a positive column, below a negative one.
        const ly = v >= 0 ? y - 6 : y + h + 12;
        svg.appendChild(el('text', {
          x: x + barW / 2, y: ly, 'text-anchor': 'middle',
          class: 'tick-label', fill: which === 'a' ? 'var(--seq-700)' : 'var(--text-muted)',
        }, fmt(v, decimals)));
      });
      // Period label pinned to the very bottom, clear of any negative reading.
      svg.appendChild(el('text', { x: cx, y: height - 6, class: 'axis-label',
                                   'text-anchor': 'middle' }, r.label));
    });

    host.appendChild(svg);
    host.insertAdjacentHTML('beforeend',
      `<div class="pairkey"><span><i class="a"></i>${aLabel}</span>
        <span><i class="b"></i>${bLabel}</span></div>`);
  }

  /* --------------------------------------------------------- growth lines */
  /* Rebased NAV growth: the fund, its index tracker and the category average on
     one zero line. Three series is inside the categorical cap, so identity is
     carried by fixed hues and a legend.

     A shared crosshair reads all three at the same date, because the question a
     reader brings to this chart is "where did they diverge", and that is only
     answerable if the three readings are from the same day. */
  const GROWTH_INK = { fund: 'var(--series-2)', index: 'var(--series-1)',
                       category: 'var(--seq-300)' };

  function growthLines(host, series, opts = {}) {
    const { height = 400, asOf = null } = opts;
    host.innerHTML = '';
    const live = (series || []).filter((s) => s.days && s.days.length > 1);
    if (!live.length) { host.innerHTML = '<div class="empty">No NAV history</div>'; return; }

    const w = Math.max(320, host.clientWidth || 640);
    const m = { t: 12, r: 14, b: 26, l: 46 };
    const iw = w - m.l - m.r, ih = height - m.t - m.b;

    // One date axis for every series: they share a start, so index by position
    // against the longest and read each series on its own dates.
    const all = live.flatMap((s) => s.values);
    let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
    const padv = (hi - lo) * 0.08 || 1;
    lo -= padv; hi += padv;
    const span = (hi - lo) || 1;

    const t0 = Date.parse(live[0].days[0]);
    const t1 = Date.parse(live[0].days[live[0].days.length - 1]);
    const tspan = (t1 - t0) || 1;
    const sx = (iso) => m.l + ((Date.parse(iso) - t0) / tspan) * iw;
    const sy = (v) => m.t + ih - ((v - lo) / span) * ih;

    const svg = el('svg', { class: 'chart growth', viewBox: `0 0 ${w} ${height}`,
                            height, preserveAspectRatio: 'none' });

    // Horizontal grid, with the zero line drawn as the baseline it is.
    const ticks = niceTicks(lo, hi, 5);
    ticks.forEach((v) => {
      const y = sy(v);
      svg.appendChild(el('line', { x1: m.l, x2: m.l + iw, y1: y, y2: y,
                                   class: v === 0 ? 'baseline' : 'gridline' }));
      svg.appendChild(el('text', { x: m.l - 7, y: y + 3.5, class: 'tick-label',
                                   'text-anchor': 'end' },
                         (v > 0 ? '+' : '') + fmt(v, 0) + '%'));
    });

    // Date ticks along the foot, spaced by time rather than by position in the
    // array. The series is daily at the recent end and weekly further back, so
    // stepping through it by index bunched every label into the last third.
    const TICKS = 5;
    for (let i = 0; i < TICKS; i++) {
      const frac = i / (TICKS - 1);
      svg.appendChild(el('text', {
        x: m.l + frac * iw, y: height - 8, class: 'tick-label',
        'text-anchor': i === 0 ? 'start' : i === TICKS - 1 ? 'end' : 'middle',
      }, monthTick(new Date(t0 + frac * tspan).toISOString().slice(0, 10))));
    }

    live.forEach((s) => {
      const d = s.days.map((iso, i) => `${i ? 'L' : 'M'}${sx(iso).toFixed(1)},${
        sy(s.values[i]).toFixed(1)}`).join('');
      // The index and the category average sit close in hue, and two similar
      // greys at the same weight are one line to most readers. The average is
      // dashed to separate them, which also reads correctly: it is a computed
      // line rather than something anyone can actually buy.
      svg.appendChild(el('path', {
        d, fill: 'none', stroke: GROWTH_INK[s.code] || 'var(--series-1)',
        'stroke-width': s.code === 'fund' ? 2 : 1.5,
        'stroke-dasharray': s.code === 'category' ? '5 3' : null,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        'vector-effect': 'non-scaling-stroke',
      }));
    });

    // Crosshair layer: one transparent rect catches the pointer, a rule and a
    // dot per series follow the nearest date.
    const rule = el('line', { y1: m.t, y2: m.t + ih, class: 'crosshair',
                              opacity: 0 });
    svg.appendChild(rule);
    const dots = live.map((s) => {
      const c = el('circle', { r: 3.5, fill: GROWTH_INK[s.code] || 'var(--series-1)',
                               stroke: 'var(--surface-1)', 'stroke-width': 1.5,
                               opacity: 0 });
      svg.appendChild(c);
      return c;
    });
    const hit = el('rect', { x: m.l, y: m.t, width: iw, height: ih,
                             fill: 'transparent' });
    hit.style.cursor = 'crosshair';
    hit.addEventListener('mousemove', (e) => {
      const box = svg.getBoundingClientRect();
      const px = ((e.clientX - box.left) / box.width) * w;
      const t = t0 + ((px - m.l) / iw) * tspan;
      const rows = [];
      let shownX = null;
      live.forEach((s, i) => {
        const j = nearest(s.days, t);
        if (j < 0) { dots[i].setAttribute('opacity', 0); return; }
        const x = sx(s.days[j]), y = sy(s.values[j]);
        if (shownX === null) shownX = x;
        dots[i].setAttribute('cx', x);
        dots[i].setAttribute('cy', y);
        dots[i].setAttribute('opacity', 1);
        rows.push(`<div class="tt-row"><span><i class="swatch" style="background:${
          GROWTH_INK[s.code]}"></i>${s.label}</span><span>${
          (s.values[j] >= 0 ? '+' : '') + fmt(s.values[j], 1)}%</span></div>`);
      });
      if (shownX === null) return;
      rule.setAttribute('x1', shownX); rule.setAttribute('x2', shownX);
      rule.setAttribute('opacity', 1);
      const j0 = nearest(live[0].days, t);
      showTip(e, `<strong>${longDate(live[0].days[j0])}</strong>${rows.join('')}`);
    });
    hit.addEventListener('mouseleave', () => {
      rule.setAttribute('opacity', 0);
      dots.forEach((d) => d.setAttribute('opacity', 0));
      hideTip();
    });
    svg.appendChild(hit);
    host.appendChild(svg);

    host.insertAdjacentHTML('beforeend',
      `<div class="growthkey">${live.map((s) => `<span><i class="${
        s.code === 'category' ? 'dash' : ''}" style="background:${
        GROWTH_INK[s.code]}"></i>${s.label}<b>${
        (s.values[s.values.length - 1] >= 0 ? '+' : '')
        + fmt(s.values[s.values.length - 1], 1)}%</b></span>`).join('')}</div>`);
  }

  function nearest(days, t) {
    if (!days.length) return -1;
    let best = 0, bd = Infinity;
    for (let i = 0; i < days.length; i++) {
      const d = Math.abs(Date.parse(days[i]) - t);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function niceTicks(lo, hi, count) {
    const raw = (hi - lo) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(raw) || 1)));
    const n = raw / mag;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      out.push(Math.abs(v) < step / 1e6 ? 0 : v);
    }
    return out;
  }

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function monthTick(iso) {
    const d = new Date(iso + 'T00:00:00');
    return `${MON[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  }

  function longDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
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
  /* The ramp's darkest step is the body ink, which is right for a single
     emphasised mark and wrong for a row of them: four high scores side by side
     render as one black slab. Marks stop at seq-550 and keep seq-700 for text,
     so the top of the scale still reads as a step rather than as background. */
  function seqColor(t) {
    const steps = ['var(--seq-100)', 'var(--seq-200)', 'var(--seq-300)',
                   'var(--seq-450)', 'var(--seq-550)'];
    const i = Math.max(0, Math.min(steps.length - 1, Math.floor(t * steps.length)));
    return steps[i];
  }
  function seqInk(t) { return t > 0.6 ? '#ffffff' : 'var(--text-primary)'; }

  return { bars, barsPaired, barsPairedV, blockBar, growthLines,
           scatter, histogram, rangeStrip, funnel,
           seqColor, seqInk, hoverable, showTip, hideTip, fmt };
})();
