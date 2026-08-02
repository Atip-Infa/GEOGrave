/**
 * charts.js — reusable pure-SVG chart components
 *
 * No external library. Each renderer:
 *  - Accepts a container DOM id and a data object
 *  - Clears and re-draws the container on every call (idempotent)
 *  - Shows a professional empty state when data is missing or all-zero
 *  - Is fully responsive via CSS (viewBox + width:100%)
 *  - Uses CSS custom properties from the existing design system
 *
 * Exported functions:
 *   renderBarChart(id, { labels, values, color?, title?, unit? })
 *   renderLineChart(id, { labels, values, color?, title?, unit?, fill? })
 *   renderDonutChart(id, { slices: [{label,value,color}], title? })
 *   renderHorizontalBarChart(id, { labels, values, color?, title?, unit? })
 */

import { chartEmptyHtml } from './utils.js';

// ─── palette ──────────────────────────────────────────────────────────────────
const PALETTE = [
  '#2b8cbe', '#ff6b5e', '#1a7a42', '#a86500',
  '#6b30b8', '#1f8a4c', '#c0392b', '#2980b9',
];

// ─── shared helpers ───────────────────────────────────────────────────────────

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// emptyState → use chartEmptyHtml imported from utils.js above

function getContainer(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  el.innerHTML = '';
  return el;
}

function roundedRect(x, y, w, h, r) {
  if (h <= 0) return '';
  const rr = Math.min(r, h / 2, w / 2);
  return `M${x + rr},${y} h${w - 2 * rr} a${rr},${rr} 0 0 1 ${rr},${rr} v${h - rr} h-${w} v-${h - rr} a${rr},${rr} 0 0 1 ${rr},-${rr}z`;
}

function niceMax(max) {
  if (max <= 0) return 5;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  const frac = max / exp;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * exp;
}

// ─── tooltip helpers ──────────────────────────────────────────────────────────

function makeTooltip(svg) {
  const g = svgEl('g', { class: 'chart-tooltip-g', visibility: 'hidden' });
  const rect = svgEl('rect', { rx: '4', ry: '4', fill: '#1c2b3a', opacity: '0.9' });
  const text = svgEl('text', { fill: '#fff', 'font-size': '11', 'font-family': 'Inter,sans-serif', 'font-weight': '600' });
  g.appendChild(rect);
  g.appendChild(text);
  svg.appendChild(g);

  return {
    show(x, y, label, value, unit = '') {
      const content = `${label}: ${value}${unit}`;
      text.textContent = content;
      const w = content.length * 6.5 + 16;
      const h = 22;
      rect.setAttribute('width', w);
      rect.setAttribute('height', h);
      rect.setAttribute('x', x - w / 2);
      rect.setAttribute('y', y - h - 6);
      text.setAttribute('x', x - w / 2 + 8);
      text.setAttribute('y', y - h + 14);
      g.setAttribute('visibility', 'visible');
    },
    hide() { g.setAttribute('visibility', 'hidden'); },
  };
}

// ─── VERTICAL BAR CHART ───────────────────────────────────────────────────────
/**
 * @param {string} id  — container element id
 * @param {{ labels:string[], values:number[], color?:string, title?:string, unit?:string }} opts
 */
export function renderBarChart(id, { labels = [], values = [], color = PALETTE[0], title = '', unit = '' }) {
  const el = getContainer(id);
  if (!el) return;

  if (!values.length || values.every(v => v === 0)) {
    el.innerHTML = chartEmptyHtml(); return;
  }

  const PAD = { top: 20, right: 12, bottom: 44, left: 36 };
  const W = 480, H = 200;
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const maxVal = niceMax(Math.max(...values));
  const barW = Math.max(4, (chartW / labels.length) * 0.55);
  const gap = chartW / labels.length;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img',
    'aria-label': title || 'Bar chart',
  });

  // grid lines
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const y = PAD.top + chartH - (i / ticks) * chartH;
    const line = svgEl('line', { x1: PAD.left, y1: y, x2: PAD.left + chartW, y2: y, stroke: '#e6e9ee', 'stroke-width': '1' });
    svg.appendChild(line);
    const lbl = svgEl('text', { x: PAD.left - 4, y: y + 4, 'text-anchor': 'end', fill: '#8fa0b0', 'font-size': '10', 'font-family': 'Inter,sans-serif' });
    lbl.textContent = Math.round((i / ticks) * maxVal);
    svg.appendChild(lbl);
  }

  const tip = makeTooltip(svg);

  labels.forEach((label, i) => {
    const val = values[i] || 0;
    const barH = (val / maxVal) * chartH;
    const x = PAD.left + i * gap + gap / 2 - barW / 2;
    const y = PAD.top + chartH - barH;

    const bar = svgEl('path', {
      d: roundedRect(x, y, barW, barH, 3),
      fill: color, opacity: '0.85',
      class: 'chart-bar',
    });
    bar.addEventListener('mouseenter', () => tip.show(x + barW / 2, y, label, val, unit));
    bar.addEventListener('mouseleave', () => tip.hide());
    svg.appendChild(bar);

    const lbl = svgEl('text', {
      x: x + barW / 2, y: PAD.top + chartH + 14,
      'text-anchor': 'middle', fill: '#5b6b7a',
      'font-size': '10', 'font-family': 'Inter,sans-serif',
    });
    // Truncate long labels
    lbl.textContent = label.length > 8 ? label.slice(0, 7) + '…' : label;
    svg.appendChild(lbl);
  });

  el.appendChild(svg);
}

// ─── LINE CHART ───────────────────────────────────────────────────────────────
/**
 * @param {string} id
 * @param {{ labels:string[], values:number[], color?:string, title?:string, unit?:string, fill?:boolean }} opts
 */
export function renderLineChart(id, { labels = [], values = [], color = PALETTE[0], title = '', unit = '', fill = true }) {
  const el = getContainer(id);
  if (!el) return;

  if (!values.length || values.every(v => v === 0)) {
    el.innerHTML = chartEmptyHtml(); return;
  }

  const PAD = { top: 20, right: 12, bottom: 44, left: 36 };
  const W = 480, H = 200;
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const maxVal = niceMax(Math.max(...values));
  const n = labels.length;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img',
    'aria-label': title || 'Line chart',
  });

  // grid lines
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const y = PAD.top + chartH - (i / ticks) * chartH;
    svg.appendChild(svgEl('line', { x1: PAD.left, y1: y, x2: PAD.left + chartW, y2: y, stroke: '#e6e9ee', 'stroke-width': '1' }));
    const lbl = svgEl('text', { x: PAD.left - 4, y: y + 4, 'text-anchor': 'end', fill: '#8fa0b0', 'font-size': '10', 'font-family': 'Inter,sans-serif' });
    lbl.textContent = Math.round((i / ticks) * maxVal);
    svg.appendChild(lbl);
  }

  // compute points
  const pts = values.map((v, i) => ({
    x: PAD.left + (n === 1 ? chartW / 2 : (i / (n - 1)) * chartW),
    y: PAD.top + chartH - (v / maxVal) * chartH,
  }));

  // fill area
  if (fill && pts.length > 1) {
    const areaD = `M${pts[0].x},${PAD.top + chartH} ` +
      pts.map(p => `L${p.x},${p.y}`).join(' ') +
      ` L${pts[pts.length - 1].x},${PAD.top + chartH} Z`;
    const gradId = `grad-${id}`;
    const defs = svgEl('defs');
    const grad = svgEl('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' });
    const s1 = svgEl('stop', { offset: '0%',   'stop-color': color, 'stop-opacity': '0.25' });
    const s2 = svgEl('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': '0.02' });
    grad.appendChild(s1); grad.appendChild(s2); defs.appendChild(grad); svg.appendChild(defs);
    svg.appendChild(svgEl('path', { d: areaD, fill: `url(#${gradId})` }));
  }

  // line
  if (pts.length > 1) {
    const lineD = 'M' + pts.map(p => `${p.x},${p.y}`).join(' L');
    svg.appendChild(svgEl('path', { d: lineD, stroke: color, 'stroke-width': '2.5', fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  }

  const tip = makeTooltip(svg);

  // dots + x-axis labels
  pts.forEach((p, i) => {
    const dot = svgEl('circle', { cx: p.x, cy: p.y, r: '4', fill: color, class: 'chart-dot' });
    dot.addEventListener('mouseenter', () => tip.show(p.x, p.y, labels[i], values[i], unit));
    dot.addEventListener('mouseleave', () => tip.hide());
    svg.appendChild(dot);

    // x label — show every Nth to avoid overlap
    const step = Math.ceil(n / 8);
    if (i % step === 0 || i === n - 1) {
      const lbl = svgEl('text', { x: p.x, y: PAD.top + chartH + 14, 'text-anchor': 'middle', fill: '#5b6b7a', 'font-size': '10', 'font-family': 'Inter,sans-serif' });
      lbl.textContent = labels[i].length > 6 ? labels[i].slice(0, 5) + '…' : labels[i];
      svg.appendChild(lbl);
    }
  });

  el.appendChild(svg);
}

// ─── DONUT CHART ──────────────────────────────────────────────────────────────
/**
 * @param {string} id
 * @param {{ slices:{label:string,value:number,color?:string}[], title?:string }} opts
 */
export function renderDonutChart(id, { slices = [], title = '' }) {
  const el = getContainer(id);
  if (!el) return;

  const total = slices.reduce((s, d) => s + d.value, 0);
  if (!total) { el.innerHTML = chartEmptyHtml(); return; }

  const W = 320, H = 200;
  const cx = 90, cy = H / 2, R = 70, r = 44;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img',
    'aria-label': title || 'Donut chart',
  });

  // Center label
  const centerVal = svgEl('text', { x: cx, y: cy + 5, 'text-anchor': 'middle', fill: '#1c2b3a', 'font-size': '22', 'font-weight': '800', 'font-family': 'Inter,sans-serif' });
  centerVal.textContent = total;
  const centerLbl = svgEl('text', { x: cx, y: cy + 18, 'text-anchor': 'middle', fill: '#8fa0b0', 'font-size': '9', 'font-family': 'Inter,sans-serif' });
  centerLbl.textContent = 'ทั้งหมด';

  let angle = -Math.PI / 2;
  const tip = makeTooltip(svg);

  slices.forEach((slice, si) => {
    const sliceAngle = (slice.value / total) * 2 * Math.PI;
    const midAngle = angle + sliceAngle / 2;
    const x1 = cx + R * Math.cos(angle), y1 = cy + R * Math.sin(angle);
    const x2 = cx + R * Math.cos(angle + sliceAngle), y2 = cy + R * Math.sin(angle + sliceAngle);
    const ix1 = cx + r * Math.cos(angle), iy1 = cy + r * Math.sin(angle);
    const ix2 = cx + r * Math.cos(angle + sliceAngle), iy2 = cy + r * Math.sin(angle + sliceAngle);
    const large = sliceAngle > Math.PI ? 1 : 0;
    const col = slice.color || PALETTE[si % PALETTE.length];

    const path = svgEl('path', {
      d: `M${ix1},${iy1} L${x1},${y1} A${R},${R} 0 ${large},1 ${x2},${y2} L${ix2},${iy2} A${r},${r} 0 ${large},0 ${ix1},${iy1}Z`,
      fill: col, class: 'chart-slice',
    });
    path.addEventListener('mouseenter', () => {
      path.setAttribute('opacity', '1');
      tip.show(cx + (R + 10) * Math.cos(midAngle), cy + (R + 10) * Math.sin(midAngle), slice.label, slice.value);
    });
    path.addEventListener('mouseleave', () => { path.setAttribute('opacity', '0.88'); tip.hide(); });
    path.setAttribute('opacity', '0.88');
    svg.appendChild(path);
    angle += sliceAngle;
  });

  svg.appendChild(centerVal);
  svg.appendChild(centerLbl);

  // Legend
  const legendX = 172;
  slices.slice(0, 6).forEach((s, i) => {
    const col = s.color || PALETTE[i % PALETTE.length];
    const y = 24 + i * 26;
    svg.appendChild(svgEl('rect', { x: legendX, y, width: 10, height: 10, rx: '2', fill: col }));
    const lbl = svgEl('text', { x: legendX + 14, y: y + 9, fill: '#1c2b3a', 'font-size': '11', 'font-family': 'Inter,sans-serif' });
    lbl.textContent = `${s.label.slice(0, 12)} (${Math.round((s.value / total) * 100)}%)`;
    svg.appendChild(lbl);
  });

  el.appendChild(svg);
}

// ─── HORIZONTAL BAR CHART ─────────────────────────────────────────────────────
/**
 * @param {string} id
 * @param {{ labels:string[], values:number[], color?:string, title?:string, unit?:string }} opts
 */
export function renderHorizontalBarChart(id, { labels = [], values = [], color = PALETTE[0], title = '', unit = '' }) {
  const el = getContainer(id);
  if (!el) return;

  if (!values.length || values.every(v => v === 0)) {
    el.innerHTML = chartEmptyHtml(); return;
  }

  const labelColW = 110;
  const PAD = { top: 8, right: 40, bottom: 8, left: labelColW };
  const rowH = 28;
  const H = PAD.top + labels.length * rowH + PAD.bottom;
  const W = 420;
  const chartW = W - PAD.left - PAD.right;
  const maxVal = niceMax(Math.max(...values));

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img',
    'aria-label': title || 'Horizontal bar chart',
  });

  const tip = makeTooltip(svg);

  labels.forEach((label, i) => {
    const val = values[i] || 0;
    const barW = (val / maxVal) * chartW;
    const y = PAD.top + i * rowH;

    // Label
    const lbl = svgEl('text', { x: labelColW - 8, y: y + rowH / 2 + 4, 'text-anchor': 'end', fill: '#1c2b3a', 'font-size': '11', 'font-family': 'Inter,sans-serif' });
    lbl.textContent = label.length > 14 ? label.slice(0, 13) + '…' : label;
    svg.appendChild(lbl);

    // Track
    svg.appendChild(svgEl('rect', { x: PAD.left, y: y + (rowH - 12) / 2, width: chartW, height: 12, rx: '6', fill: '#f0f4f8' }));

    // Bar
    if (barW > 0) {
      const bar = svgEl('rect', { x: PAD.left, y: y + (rowH - 12) / 2, width: barW, height: 12, rx: '6', fill: color, opacity: '0.85', class: 'chart-bar' });
      bar.addEventListener('mouseenter', () => tip.show(PAD.left + barW, y + rowH / 2, label, val, unit));
      bar.addEventListener('mouseleave', () => tip.hide());
      svg.appendChild(bar);
    }

    // Value label
    const valLbl = svgEl('text', { x: PAD.left + barW + 5, y: y + rowH / 2 + 4, fill: '#5b6b7a', 'font-size': '10', 'font-family': 'Inter,sans-serif' });
    valLbl.textContent = val;
    svg.appendChild(valLbl);
  });

  el.appendChild(svg);
}
