import { fetchStats } from './api.js';
import { escapeHtml, extractProvince, chartEmptyHtml } from './utils.js';
import { renderBarChart, renderLineChart, renderDonutChart, renderHorizontalBarChart } from './charts.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/** Animate a number counting up from 0 to `target` in ~500 ms */
function animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el || target === 0) { if (el) el.textContent = '0'; return; }
  const duration = 500;
  const start = performance.now();
  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    el.textContent = Math.round(progress * target);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/** Render a proportional width bar (clamped 4 %–100 %) */
function setBar(id, value, total) {
  const el = document.getElementById(id);
  if (!el || !total) return;
  const pct = Math.max(4, Math.round((value / total) * 100));
  el.style.setProperty('--bar-pct', `${pct}%`);
  el.classList.add('dash-card-bar--filled');
}

// ─── recent reports component ────────────────────────────────────────────────

function renderRecentEmpty() {
  return `
    <div class="home-empty-state" role="status">
      <div class="home-empty-icon" aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      </div>
      <div class="home-empty-title">ยังไม่มีรายงาน</div>
      <div class="home-empty-sub">รายงานที่บันทึกจะแสดงที่นี่</div>
    </div>`;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('th-TH', {
      day: 'numeric', month: 'short', year: '2-digit'
    });
  } catch (_) { return '—'; }
}

function renderRecentList(items) {
  return `
    <ul class="recent-report-list" role="list">
      ${items.map((r, i) => `
        <li class="recent-report-item" style="animation-delay:${i * 60}ms">
          <div class="recent-report-avatar" aria-hidden="true">${escapeHtml(r.victimName || '?').charAt(0).toUpperCase()}</div>
          <div class="recent-report-info">
            <div class="recent-report-name">${escapeHtml(r.victimName) || 'ไม่ระบุชื่อ'}</div>
            <div class="recent-report-meta">${escapeHtml(r.locationOfDeath) || '—'}</div>
          </div>
          <div class="recent-report-date">${formatDate(r.createdAt)}</div>
        </li>`).join('')}
    </ul>`;
}

// ─── main export ─────────────────────────────────────────────────────────────

export async function loadStats() {
  const container = document.getElementById('recent-container');

  try {
    const stats = await fetchStats();
    const male    = stats.byGender['ชาย']  || 0;
    const female  = stats.byGender['หญิง'] || 0;
    const unknown = stats.total - male - female;
    const total   = stats.total;

    // ── count-up animations ──────────────────────────────────────────────────
    animateCount('stat-total',   total);
    animateCount('stat-male',    male);
    animateCount('stat-female',  female);
    animateCount('stat-unknown', unknown);

    // ── today's reports (derived from recent list) ───────────────────────────
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayCount = (stats.recent || []).filter(r =>
      r.createdAt && r.createdAt.startsWith(todayStr)
    ).length;
    animateCount('stat-today', todayCount);

    // ── pending: reports without a cause of death recorded ───────────────────
    // The /api/stats endpoint doesn't provide this directly, so we use
    // the count of recent entries without causeOfDeath as a proxy indicator.
    // A full pending count would require a dedicated endpoint — documented
    // as future work in CONTRIBUTING.md.
    setText('stat-pending', '—');

    // ── proportional bars ────────────────────────────────────────────────────
    setBar('bar-male',    male,    total);
    setBar('bar-female',  female,  total);
    setBar('bar-unknown', unknown, total);

    // ── last-updated timestamp ────────────────────────────────────────────────
    const updatedEl = document.getElementById('stats-updated-at');
    if (updatedEl) {
      updatedEl.textContent = `อัปเดต ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`;
    }

    // ── recent reports list ───────────────────────────────────────────────────
    if (container) {
      container.innerHTML = stats.recent.length
        ? renderRecentList(stats.recent)
        : renderRecentEmpty();
    }

  } catch (err) {
    // Stats load failure is surfaced to the user via the error state below.
    // Do not log to console in production — no sensitive detail to surface here.

    // Show error state in each stat card
    ['stat-total','stat-male','stat-female','stat-unknown','stat-today','stat-pending']
      .forEach(id => setText(id, '—'));

    if (container) {
      container.innerHTML = `
        <div class="home-empty-state home-empty-state--error" role="alert">
          <div class="home-empty-icon" aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <div class="home-empty-title">ไม่สามารถโหลดข้อมูลได้</div>
          <div class="home-empty-sub">กรุณาตรวจสอบการเชื่อมต่อและลองใหม่อีกครั้ง</div>
        </div>`;
    }
  }
}

// ─── analytics charts ────────────────────────────────────────────────────────

/**
 * Aggregate the full points array client-side and render all 6 charts.
 * Called by main.js on initial load and whenever the points store changes.
 * Uses no new API endpoints — all derived from the in-memory points array.
 */
export function loadAnalytics(points) {
  if (!points || !points.length) {
    ['chart-monthly','chart-daily','chart-weekly','chart-gender','chart-province','chart-cause']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = chartEmptyHtml('ยังไม่มีข้อมูล');
      });
    return;
  }

  const now = new Date();

  // ── 1. Monthly (last 12 months) ────────────────────────────────────────────
  const monthLabels = [];
  const monthValues = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
    monthLabels.push(label);
    monthValues.push(points.filter(p => (p.reportedDate || p.createdAt || '').startsWith(key)).length);
  }
  renderBarChart('chart-monthly', { labels: monthLabels, values: monthValues, color: '#2b8cbe', title: 'รายงานรายเดือน' });

  // ── 2. Daily trend (last 30 days) ──────────────────────────────────────────
  const dayLabels = [];
  const dayValues = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const label = `${d.getDate()}/${d.getMonth() + 1}`;
    dayLabels.push(label);
    dayValues.push(points.filter(p => (p.reportedDate || p.createdAt || '').slice(0, 10) === key).length);
  }
  renderLineChart('chart-daily', { labels: dayLabels, values: dayValues, color: '#ff6b5e', title: 'แนวโน้มรายวัน', fill: true });

  // ── 3. Weekly trend (last 12 weeks) ────────────────────────────────────────
  const weekLabels = [];
  const weekValues = [];
  for (let i = 11; i >= 0; i--) {
    const start = new Date(now);
    start.setDate(start.getDate() - (i + 1) * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const startKey = start.toISOString().slice(0, 10);
    const endKey   = end.toISOString().slice(0, 10);
    weekLabels.push(`W${12 - i}`);
    weekValues.push(points.filter(p => {
      const d = (p.reportedDate || p.createdAt || '').slice(0, 10);
      return d >= startKey && d < endKey;
    }).length);
  }
  renderLineChart('chart-weekly', { labels: weekLabels, values: weekValues, color: '#1a7a42', title: 'แนวโน้มรายสัปดาห์', fill: true });

  // ── 4. Gender donut ────────────────────────────────────────────────────────
  const genderCount = { 'ชาย': 0, 'หญิง': 0, 'ไม่ทราบ': 0 };
  points.forEach(p => {
    const g = p.victimGender || 'ไม่ทราบ';
    genderCount[g] = (genderCount[g] || 0) + 1;
  });
  renderDonutChart('chart-gender', {
    title: 'สัดส่วนเพศ',
    slices: [
      { label: 'ชาย',     value: genderCount['ชาย'],     color: '#2b8cbe' },
      { label: 'หญิง',    value: genderCount['หญิง'],    color: '#ff6b5e' },
      { label: 'ไม่ทราบ', value: genderCount['ไม่ทราบ'], color: '#8fa0b0' },
    ].filter(s => s.value > 0),
  });

  // ── 5. Province (top 10) ───────────────────────────────────────────────────
  const provMap = {};
  points.forEach(p => {
    const prov = extractProvince(p.locationOfDeath);
    if (prov) provMap[prov] = (provMap[prov] || 0) + 1;
  });
  const provSorted = Object.entries(provMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
  renderHorizontalBarChart('chart-province', {
    labels: provSorted.map(([k]) => k),
    values: provSorted.map(([, v]) => v),
    color: '#6b30b8',
    title: 'รายงานตามจังหวัด',
  });

  // ── 6. Cause of death (top 10) ─────────────────────────────────────────────
  const causeMap = {};
  points.forEach(p => {
    const c = (p.causeOfDeath || 'ไม่ระบุ').trim();
    causeMap[c] = (causeMap[c] || 0) + 1;
  });
  const causeSorted = Object.entries(causeMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
  renderHorizontalBarChart('chart-cause', {
    labels: causeSorted.map(([k]) => k),
    values: causeSorted.map(([, v]) => v),
    color: '#a86500',
    title: 'สาเหตุการเสียชีวิต',
  });

  // Update timestamp
  const ts = document.getElementById('analytics-updated-at');
  if (ts) ts.textContent = `อัปเดต ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`;
}
