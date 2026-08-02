/**
 * table-view.js — Professional report list
 *
 * Features:
 *  - Status badges (5 states) derived client-side — no backend change
 *  - Province, status, and date-range filters (compose with AND)
 *  - Debounced search (reuses toolbar #tbl-search)
 *  - Column sorting (click header, click again to reverse)
 *  - Client-side pagination with page-size selector
 *  - View / Edit / Delete action buttons
 *  - Skeleton loading state
 *  - Professional empty state with context-aware message
 *  - All existing renderTable() call sites in main.js work unchanged
 */

import { escapeHtml, extractProvince } from './utils.js';

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const tableBody      = document.getElementById('report-table-body');
const tblSearch      = document.getElementById('tbl-search');
const tblProvince    = document.getElementById('tbl-filter-province');
const tblStatus      = document.getElementById('tbl-filter-status');
const tblDateFrom    = document.getElementById('tbl-filter-date-from');
const tblDateTo      = document.getElementById('tbl-filter-date-to');
const tblFilterReset = document.getElementById('tbl-filter-reset');
const tblCount       = document.getElementById('tbl-count');
const tblPageInfo    = document.getElementById('tbl-page-info');
const tblPageNums    = document.getElementById('tbl-page-numbers');
const tblPageSize    = document.getElementById('tbl-page-size-select');
const btnFirst       = document.getElementById('tbl-first');
const btnPrev        = document.getElementById('tbl-prev');
const btnNext        = document.getElementById('tbl-next');
const btnLast        = document.getElementById('tbl-last');
const sortableHeaders = document.querySelectorAll('#report-table th.sortable');

// ─── module state ─────────────────────────────────────────────────────────────
let _allPoints  = [];     // full dataset passed in by main.js
let _handlers   = null;
let _isAuthed   = false;

// Sort state — persists across re-renders
let sortCol = 'reportedDate';
let sortDir = 'desc';

// Filter state
const filters = { search: '', province: '', status: '', dateFrom: '', dateTo: '' };

// Pagination state
let currentPage = 1;
let pageSize    = 25;

// ─── STATUS SYSTEM ────────────────────────────────────────────────────────────
/**
 * Derive a status from available fields.
 * Since the backend has no status field, we infer it from data completeness.
 * This is transparent to the backend — pure client-side annotation.
 *
 * Rules (in priority order):
 *  completed    — has destinationTemple AND reportedDate (journey logged)
 *  transporting — has destinationTemple but no reportedDate
 *  verified     — has causeOfDeath AND reportedBy (reviewed by officer)
 *  rejected     — has victimName exactly 'ยกเลิก' or causeOfDeath contains 'ยกเลิก'
 *  pending      — everything else (just submitted)
 */
function deriveStatus(p) {
  const cause = (p.causeOfDeath || '').toLowerCase();
  const name  = (p.victimName  || '').toLowerCase();
  if (cause.includes('ยกเลิก') || name === 'ยกเลิก') return 'rejected';
  if (p.destinationTemple && p.reportedDate)           return 'completed';
  if (p.destinationTemple && !p.reportedDate)          return 'transporting';
  if (p.causeOfDeath && p.reportedBy)                  return 'verified';
  return 'pending';
}

const STATUS_META = {
  pending:      { label: 'รอดำเนินการ', cls: 'badge-pending'      },
  verified:     { label: 'ตรวจสอบแล้ว', cls: 'badge-verified'     },
  transporting: { label: 'กำลังจัดส่ง', cls: 'badge-transporting' },
  completed:    { label: 'เสร็จสิ้น',   cls: 'badge-completed'    },
  rejected:     { label: 'ยกเลิก',      cls: 'badge-rejected'     },
};

function statusBadge(status) {
  const m = STATUS_META[status] || STATUS_META.pending;
  return `<span class="status-badge ${m.cls}">${m.label}</span>`;
}

// ─── PROVINCE EXTRACTION ──────────────────────────────────────────────────────
// Imported from utils.js — extractProvince(locationOfDeath) defined there.

function rebuildProvinceFilter(points) {
  if (!tblProvince) return;
  const current = tblProvince.value;
  const provinces = new Set(points.map(p => extractProvince(p.locationOfDeath)).filter(Boolean));
  tblProvince.innerHTML = '<option value="">จังหวัดทั้งหมด</option>';
  [...provinces].sort().forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    tblProvince.appendChild(opt);
  });
  if (current && [...provinces].includes(current)) tblProvince.value = current;
}

// ─── FILTERING ────────────────────────────────────────────────────────────────
function passesFilters(point) {
  const q = filters.search;
  if (q) {
    const haystack = [
      point.victimName, point.locationOfDeath, point.causeOfDeath,
      point.reportedBy, point.victimGender,
    ].join(' ').toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (filters.province) {
    if (extractProvince(point.locationOfDeath) !== filters.province) return false;
  }
  if (filters.status) {
    if (deriveStatus(point) !== filters.status) return false;
  }
  if (filters.dateFrom || filters.dateTo) {
    const d = point.reportedDate || '';
    if (!d) return false;
    if (filters.dateFrom && d < filters.dateFrom) return false;
    if (filters.dateTo   && d > filters.dateTo)   return false;
  }
  return true;
}

// ─── SORTING ──────────────────────────────────────────────────────────────────
function sortPoints(points) {
  return [...points].sort((a, b) => {
    let av = a[sortCol] ?? '';
    let bv = b[sortCol] ?? '';
    if (sortCol === 'victimAge') {
      av = av === '' ? -Infinity : Number(av);
      bv = bv === '' ? -Infinity : Number(bv);
      return sortDir === 'asc' ? av - bv : bv - av;
    }
    av = String(av).toLowerCase();
    bv = String(bv).toLowerCase();
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
}

function updateHeaderArrows() {
  sortableHeaders.forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (th.dataset.col === sortCol) {
      if (arrow) arrow.textContent = sortDir === 'asc' ? ' ▲' : ' ▼';
      th.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
      th.classList.add('sorted');
    } else {
      if (arrow) arrow.textContent = '';
      th.removeAttribute('aria-sort');
      th.classList.remove('sorted');
    }
  });
}

// ─── PAGINATION ───────────────────────────────────────────────────────────────
function paginate(items) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * pageSize;
  return { page: items.slice(start, start + pageSize), total, totalPages, start };
}

function renderPagination(total, totalPages, start) {
  if (!tblPageInfo) return;

  const end = Math.min(start + pageSize, total);
  tblPageInfo.textContent = total
    ? `แสดง ${start + 1}–${end} จาก ${total} รายการ`
    : '';

  if (!tblPageNums) return;
  tblPageNums.innerHTML = '';

  // Show at most 7 page buttons with ellipsis
  const pages = buildPageWindow(currentPage, totalPages);
  for (const p of pages) {
    if (p === '…') {
      const el = document.createElement('span');
      el.className = 'tbl-page-ellipsis';
      el.textContent = '…';
      el.setAttribute('role', 'listitem');
      tblPageNums.appendChild(el);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `tbl-page-num${p === currentPage ? ' active' : ''}`;
      btn.textContent = p;
      btn.setAttribute('role', 'listitem');
      btn.setAttribute('aria-label', `หน้า ${p}`);
      if (p === currentPage) btn.setAttribute('aria-current', 'page');
      btn.addEventListener('click', () => { currentPage = p; rerender(); });
      tblPageNums.appendChild(btn);
    }
  }

  if (btnFirst) btnFirst.disabled = currentPage <= 1;
  if (btnPrev)  btnPrev.disabled  = currentPage <= 1;
  if (btnNext)  btnNext.disabled  = currentPage >= totalPages;
  if (btnLast)  btnLast.disabled  = currentPage >= totalPages;
}

function buildPageWindow(cur, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [];
  pages.push(1);
  if (cur > 3)          pages.push('…');
  for (let p = Math.max(2, cur - 1); p <= Math.min(total - 1, cur + 1); p++) pages.push(p);
  if (cur < total - 2)  pages.push('…');
  pages.push(total);
  return pages;
}

// ─── SKELETON LOADING ─────────────────────────────────────────────────────────
export function showTableSkeleton() {
  if (!tableBody) return;
  const rows = Array.from({ length: 6 }).map(() => `
    <tr class="skeleton-row">
      <td><div class="skeleton-cell" style="width:120px"></div></td>
      <td><div class="skeleton-cell" style="width:32px"></div></td>
      <td><div class="skeleton-cell" style="width:48px"></div></td>
      <td><div class="skeleton-cell" style="width:100px"></div></td>
      <td><div class="skeleton-cell" style="width:140px"></div></td>
      <td><div class="skeleton-cell" style="width:80px"></div></td>
      <td><div class="skeleton-cell" style="width:80px"></div></td>
      <td><div class="skeleton-cell" style="width:90px"></div></td>
    </tr>`).join('');
  tableBody.innerHTML = rows;
}

// ─── EMPTY STATE ─────────────────────────────────────────────────────────────
function renderEmpty(hasFilters) {
  const icon = hasFilters
    ? `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`
    : `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  const title = hasFilters ? 'ไม่พบรายงานที่ตรงกัน' : 'ยังไม่มีรายงาน';
  const sub   = hasFilters
    ? 'ลองปรับตัวกรองหรือล้างการค้นหา'
    : 'คลิกบนแผนที่หรือกดปุ่ม "สร้างรายงาน" เพื่อเริ่มต้น';
  return `<tr><td colspan="8">
    <div class="tbl-empty-state">
      <div class="tbl-empty-icon">${icon}</div>
      <div class="tbl-empty-title">${title}</div>
      <div class="tbl-empty-sub">${sub}</div>
      ${hasFilters ? `<button type="button" class="tbl-empty-reset-btn" id="tbl-empty-reset">ล้างตัวกรอง</button>` : ''}
    </div>
  </td></tr>`;
}

// ─── ROW RENDERER ─────────────────────────────────────────────────────────────
function renderRows(page, isAuthed) {
  return page.map(p => {
    const status   = deriveStatus(p);
    const nearCls  = p._nearHighlight ? ' class="near-highlight"' : '';
    const name     = escapeHtml(p.victimName)      || '—';
    const age      = escapeHtml(p.victimAge)        || '—';
    const gender   = escapeHtml(p.victimGender)     || '—';
    const cause    = escapeHtml(p.causeOfDeath)     || '—';
    const location = escapeHtml(p.locationOfDeath)  || '—';
    const date     = escapeHtml(p.reportedDate)     || '—';

    const viewBtn = `
      <button class="row-view-btn" data-id="${escapeHtml(p.id)}"
              aria-label="ดูรายละเอียด ${name}" title="ดูบนแผนที่">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      </button>`;
    const editBtn = isAuthed ? `
      <button class="row-edit-btn" data-id="${escapeHtml(p.id)}"
              aria-label="แก้ไข ${name}" title="แก้ไข">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>` : '';
    const delBtn = isAuthed ? `
      <button class="row-delete-btn" data-id="${escapeHtml(p.id)}"
              aria-label="ลบ ${name}" title="ลบ">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
      </button>` : '';

    return `
      <tr data-id="${escapeHtml(p.id)}"${nearCls}>
        <td data-label="ชื่อผู้เสียชีวิต" class="td-name">
          <div class="td-name-wrap">
            <div class="td-avatar" aria-hidden="true">${escapeHtml(p.victimName || '?').charAt(0).toUpperCase()}</div>
            <span>${name}</span>
          </div>
        </td>
        <td data-label="อายุ" class="td-center">${age}</td>
        <td data-label="เพศ" class="td-center">${gender}</td>
        <td data-label="สาเหตุ" class="td-truncate" title="${escapeHtml(p.causeOfDeath)}">${cause}</td>
        <td data-label="สถานที่" class="td-truncate" title="${escapeHtml(p.locationOfDeath)}">${location}</td>
        <td data-label="วันที่" class="td-center">${date}</td>
        <td data-label="สถานะ">${statusBadge(status)}</td>
        <td class="action-cell">${viewBtn}${editBtn}${delBtn}</td>
      </tr>`;
  }).join('');
}

// ─── MAIN RERENDER ────────────────────────────────────────────────────────────
function rerender() {
  if (!tableBody) return;

  // 1. Filter
  const hasFilters = !!(filters.search || filters.province || filters.status || filters.dateFrom || filters.dateTo);
  const filtered = _allPoints.filter(passesFilters);

  // 2. Sort
  const sorted = sortPoints(filtered);

  // 3. Paginate
  const { page, total, totalPages, start } = paginate(sorted);

  // 4. Count badge
  if (tblCount) {
    tblCount.textContent = total
      ? `${total} รายการ${hasFilters ? ' (กรองแล้ว)' : ''}`
      : '';
  }

  // 5. Filter-reset button visibility
  if (tblFilterReset) tblFilterReset.classList.toggle('hidden', !hasFilters);

  // 6. Update header arrows
  updateHeaderArrows();

  // 7. Render rows or empty state
  if (!total) {
    tableBody.innerHTML = renderEmpty(hasFilters);
    // Wire inline reset button
    const inlineReset = document.getElementById('tbl-empty-reset');
    if (inlineReset) inlineReset.addEventListener('click', resetAllFilters);
  } else {
    tableBody.innerHTML = renderRows(page, _isAuthed);
  }

  // 8. Pagination
  renderPagination(total, totalPages, start);
}

// ─── FILTER RESET ─────────────────────────────────────────────────────────────
function resetAllFilters() {
  filters.search = filters.province = filters.status = filters.dateFrom = filters.dateTo = '';
  if (tblSearch)   tblSearch.value   = '';
  if (tblProvince) tblProvince.value = '';
  if (tblStatus)   tblStatus.value   = '';
  if (tblDateFrom) tblDateFrom.value = '';
  if (tblDateTo)   tblDateTo.value   = '';
  currentPage = 1;
  rerender();
}

// ─── ONE-TIME SETUP ───────────────────────────────────────────────────────────
// Wiring is done once, not on every renderTable() call, so event listeners
// never pile up.
let _setupDone = false;

function setupOnce() {
  if (_setupDone) return;
  _setupDone = true;

  // Sort headers
  sortableHeaders.forEach(th => {
    th.addEventListener('click', () => {
      if (th.dataset.col === sortCol) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortCol = th.dataset.col;
        sortDir = 'asc';
      }
      currentPage = 1;
      rerender();
    });
  });

  // Filters
  let searchTimer;
  if (tblSearch) {
    tblSearch.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        filters.search = tblSearch.value.trim().toLowerCase();
        currentPage = 1;
        rerender();
        // Keep map toolbar search in sync
        const mapSearch = document.getElementById('search-input');
        if (mapSearch) { mapSearch.value = tblSearch.value; mapSearch.dispatchEvent(new Event('input')); }
      }, 200);
    });
  }
  if (tblProvince) tblProvince.addEventListener('change', () => { filters.province = tblProvince.value; currentPage = 1; rerender(); });
  if (tblStatus)   tblStatus.addEventListener('change',   () => { filters.status   = tblStatus.value;   currentPage = 1; rerender(); });
  if (tblDateFrom) tblDateFrom.addEventListener('change', () => { filters.dateFrom = tblDateFrom.value;  currentPage = 1; rerender(); });
  if (tblDateTo)   tblDateTo.addEventListener('change',   () => { filters.dateTo   = tblDateTo.value;    currentPage = 1; rerender(); });
  if (tblFilterReset) tblFilterReset.addEventListener('click', resetAllFilters);

  // Pagination nav
  if (btnFirst) btnFirst.addEventListener('click', () => { currentPage = 1; rerender(); });
  if (btnPrev)  btnPrev.addEventListener('click',  () => { currentPage = Math.max(1, currentPage - 1); rerender(); });
  if (btnNext)  btnNext.addEventListener('click',  () => { currentPage++; rerender(); });
  if (btnLast)  btnLast.addEventListener('click',  () => {
    currentPage = Math.ceil(_allPoints.filter(passesFilters).length / pageSize);
    rerender();
  });
  if (tblPageSize) tblPageSize.addEventListener('change', () => {
    pageSize = parseInt(tblPageSize.value, 10) || 25;
    currentPage = 1;
    rerender();
  });

  // Event delegation on table body (view / edit / delete / row-click)
  if (tableBody) {
    tableBody.addEventListener('click', e => {
      const viewBtn = e.target.closest('.row-view-btn');
      if (viewBtn) { _handlers && _handlers.onRowClick(viewBtn.dataset.id); return; }
      const editBtn = e.target.closest('.row-edit-btn');
      if (editBtn) { _handlers && _handlers.onEdit(editBtn.dataset.id); return; }
      const delBtn  = e.target.closest('.row-delete-btn');
      if (delBtn)  { _handlers && _handlers.onDelete(delBtn.dataset.id); return; }
      const row     = e.target.closest('tr[data-id]');
      if (row)     { _handlers && _handlers.onRowClick(row.dataset.id); }
    });
  }
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Called by main.js on every state change.
 * Signature intentionally unchanged from the original table-view.js.
 */
export function renderTable(points, isAuthed, handlers) {
  setupOnce();
  _isAuthed  = isAuthed;
  _handlers  = handlers;
  _allPoints = points;

  // Rebuild province dropdown whenever the full dataset changes
  rebuildProvinceFilter(points);

  // Reset to page 1 only when the dataset changes (not on every filter keystroke)
  // Keep page if total is the same (e.g. after an edit that doesn't change length)
  rerender();
}
