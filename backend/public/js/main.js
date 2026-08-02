import { createStore } from './state.js';
import { fetchPoints, fetchNearby, deletePoint as deletePointApi } from './api.js';
import { showToast } from './toast.js';
import { initAuth } from './auth.js';
import { initNav } from './nav.js';
import { initReportForm, openEditForm } from './report-form.js';
import { loadStats, loadAnalytics } from './stats.js';
import { renderTable } from './table-view.js';
import { ensureMap, syncMarkers, setVisibleIds, focusPoint, onMapClick, invalidateMapSize, highlightNearby } from './map-view.js';
import { initHomeMap } from './home-map.js';
import { debounce, getCurrentLocation } from './utils.js';

// ─── Near-me button SVG — defined once, reused in both the loading reset paths ──
const NEAR_ME_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>`;

// ─── visibility helpers ───────────────────────────────────────────────────────
// Avoid doing work for components that aren't visible. DOM mutations inside
// hidden panels are wasted CPU and can cause scroll-position jumps when the
// panel is later revealed.

function isHomePage() {
  return document.getElementById('page-home')?.classList.contains('active') ?? false;
}

function isListView() {
  return document.getElementById('list-view')?.classList.contains('active') ?? false;
}

const store = createStore({
  authToken: sessionStorage.getItem('geograve_token') || null,
  authUsername: sessionStorage.getItem('geograve_username') || null,
  points: [],
  searchQuery: '',
  nearbyIds: null   // null = no near-me filter active; Set<id> = active
});

const isAuthed = () => !!store.getState().authToken;

const authApi = initAuth(store);

// ---------- MAP (lazy) ----------
let mapInitStarted = false;
let _tableInitialized = false;  // ensure table event listeners wire on first render

function initMapOnce() {
  const readyPromise = ensureMap(handleDeleteRequested, handleEditRequested);
  if (!mapInitStarted) {
    mapInitStarted = true;
    onMapClick(onMapClicked);
    readyPromise.then(async () => {
      await syncMarkers(store.getState().points, isAuthed);
      applyFilter();
    });
  }
  return readyPromise;
}

function showMap() {
  initMapOnce().then(() => setTimeout(invalidateMapSize, 60));
}

// ---------- REPORT FORM ----------
const onMapClicked = initReportForm({
  onCreated(newPoint) {
    store.setState(s => ({ points: [...s.points, newPoint] }));
  },
  onUpdated(updatedPoint) {
    store.setState(s => ({
      points: s.points.map(p => p.id === updatedPoint.id ? updatedPoint : p)
    }));
  },
  getToken: () => store.getState().authToken
});

// ---------- NAV ----------
initNav({
  onShowReportPage: showMap,
  onShowHomePage: () => {
    loadStats();
    loadAnalytics(store.getState().points);
    initHomeMap(store.getState().points);
  },
  onShowMapView: showMap
});

// ─── accessible delete confirmation modal ────────────────────────────────────
const _deleteModal        = document.getElementById('delete-modal');
const _deleteModalBody    = document.getElementById('delete-modal-body');
const _deleteModalConfirm = document.getElementById('delete-modal-confirm');
const _deleteModalCancel  = document.getElementById('delete-modal-cancel');
let _deletePendingResolve = null;

function confirmDelete(victimName) {
  return new Promise(resolve => {
    _deletePendingResolve = resolve;
    _deleteModalBody.textContent = `คุณต้องการลบรายงานของ "${victimName}" ใช่หรือไม่? การดำเนินการนี้ไม่สามารถยกเลิกได้`;
    _deleteModal.classList.remove('hidden');
    _deleteModalConfirm.focus();
  });
}

function closeDeleteModal(result) {
  _deleteModal.classList.add('hidden');
  if (_deletePendingResolve) { _deletePendingResolve(result); _deletePendingResolve = null; }
}

_deleteModalConfirm.addEventListener('click', () => closeDeleteModal(true));
_deleteModalCancel.addEventListener('click',  () => closeDeleteModal(false));
_deleteModal.addEventListener('click', e => { if (e.target === _deleteModal) closeDeleteModal(false); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !_deleteModal.classList.contains('hidden')) closeDeleteModal(false);
});
async function handleDeleteRequested(id) {
  if (!isAuthed()) {
    showToast('กรุณาเข้าสู่ระบบเจ้าหน้าที่ก่อนลบข้อมูล', 'error');
    authApi.promptLogin();
    return;
  }
  const point = store.getState().points.find(p => p.id === id);
  const name = (point && point.victimName) ? point.victimName : 'รายการนี้';
  const confirmed = await confirmDelete(name);
  if (!confirmed) return;
  try {
    const result = await deletePointApi(id, store.getState().authToken);
    if (result === 'unauthorized') {
      showToast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'error');
      authApi.forceLogout();
      return;
    }
    store.setState(s => ({
      points: s.points.filter(p => p.id !== id),
      nearbyIds: s.nearbyIds ? (s.nearbyIds.delete(id), new Set(s.nearbyIds)) : null
    }));
    showToast('ลบรายงานเรียบร้อยแล้ว', 'success');
  } catch (err) {
    showToast('ไม่สามารถลบข้อมูลได้', 'error');
  }
}

// ---------- EDIT ----------
async function handleEditRequested(id) {
  if (!isAuthed()) {
    showToast('กรุณาเข้าสู่ระบบเจ้าหน้าที่ก่อนแก้ไขข้อมูล', 'error');
    authApi.promptLogin();
    return;
  }
  const point = store.getState().points.find(p => p.id === id);
  if (!point) return;

  // Make sure we're on the report page with the sidebar visible
  document.querySelector('.nav-link[data-page="report"]').click();
  await initMapOnce();
  openEditForm(point);
}

async function handleRowClick(id) {
  document.querySelector('.view-btn[data-view="map"]').click();
  await initMapOnce();
  focusPoint(id);
}

// ---------- QUICK ACTION CARDS (homepage) ----------
// Cards use data-page for navigation (handled by nav.js) and optionally
// data-view to pre-select map vs list view on the report page.
document.getElementById('page-home').addEventListener('click', (e) => {
  const card = e.target.closest('[data-view]');
  if (!card) return;
  const view = card.dataset.view;
  if (!view) return;
  // nav.js click handler fires on the same click via data-page,
  // so the page switch already happens — we just need to set the view.
  requestAnimationFrame(() => {
    const btn = document.querySelector(`.view-btn[data-view="${view}"]`);
    if (btn && !btn.classList.contains('active')) btn.click();
  });
});
const nearMeBtn = document.getElementById('near-me-btn');
const nearMeClear = document.getElementById('near-me-clear');
const NEAR_ME_RADIUS_KM = 5;

nearMeBtn.addEventListener('click', async () => {
  nearMeBtn.disabled = true;
  nearMeBtn.textContent = 'กำลังระบุตำแหน่ง...';

  getCurrentLocation(
    async (lat, lng) => {
      try {
        const result = await fetchNearby(lat, lng, NEAR_ME_RADIUS_KM, store.getState().authToken);
        if (result.count === 0) {
          showToast(`ไม่พบรายงานในรัศมี ${NEAR_ME_RADIUS_KM} กม.`, 'info');
          clearNearMe();
          return;
        }
        const ids = new Set(result.points.map(p => p.id));
        store.setState({ nearbyIds: ids });
        await initMapOnce();
        if (result.points.length > 0) focusPoint(result.points[0].id);
        showToast(`พบ ${result.count} รายงานในรัศมี ${NEAR_ME_RADIUS_KM} กม.`, 'success');
        nearMeClear.classList.remove('hidden');
      } catch (_) {
        showToast('ไม่สามารถค้นหาจุดใกล้เคียงได้', 'error');
      } finally {
        nearMeBtn.disabled = false;
        nearMeBtn.innerHTML = `${NEAR_ME_SVG} ใกล้ฉัน`;
      }
    },
    (msg) => {
      nearMeBtn.disabled = false;
      nearMeBtn.innerHTML = `${NEAR_ME_SVG} ใกล้ฉัน`;
      showToast(msg, 'error');
    }
  );
});

function clearNearMe() {
  store.setState({ nearbyIds: null });
  nearMeClear.classList.add('hidden');
  if (mapInitStarted) highlightNearby(new Set());
}

nearMeClear.addEventListener('click', clearNearMe);

// ---------- SEARCH ----------
// PERFORMANCE: debounced, and filtering only toggles marker visibility
// (map-view.js) instead of destroying/recreating marker objects.
const searchInput = document.getElementById('search-input');
const searchCount = document.getElementById('search-result-count');
const runSearch = debounce(() => {
  store.setState({ searchQuery: searchInput.value.trim().toLowerCase() });
}, 200);
searchInput.addEventListener('input', runSearch);

function applyFilter() {
  const { points, searchQuery: q, nearbyIds } = store.getState();

  // Text search filter
  const filtered = !q ? points : points.filter(p =>
    (p.victimName || '').toLowerCase().includes(q) ||
    (p.locationOfDeath || '').toLowerCase().includes(q) ||
    (p.causeOfDeath || '').toLowerCase().includes(q)
  );

  // Near-me filter — annotate matches so the table can highlight them,
  // but don't remove non-matches from the table (just highlights on map)
  const annotated = filtered.map(p => ({
    ...p,
    _nearHighlight: nearbyIds ? nearbyIds.has(p.id) : false
  }));

  // Only re-render the table's DOM when the list panel is visible — avoids
  // unnecessary DOM work when the user is on the map or home page.
  // BUT: always call renderTable at least once so setupOnce() wires event
  // listeners even before the user switches to list view.
  if (isListView() || !_tableInitialized) {
    _tableInitialized = true;
    renderTable(annotated, isAuthed(), {
      onDelete: handleDeleteRequested,
      onEdit: handleEditRequested,
      onRowClick: handleRowClick,
      _rerender: applyFilter
    });
  }

  if (mapInitStarted) {
    setVisibleIds(new Set(filtered.map(p => p.id)));
    if (nearbyIds) highlightNearby(nearbyIds);
  }
  if (searchCount) searchCount.textContent = q ? `พบ ${filtered.length} รายการ` : '';
}

// ---------- REACT TO STATE CHANGES ----------
store.subscribe(async (state) => {
  if (mapInitStarted) await syncMarkers(state.points, isAuthed);

  // Only run expensive home-page renders when home is actually visible.
  // When the user is on the report page, these are silent no-ops.
  if (isHomePage()) {
    initHomeMap(state.points);
    loadAnalytics(state.points);
  }

  // Only re-render the table when the list panel is visible.
  // applyFilter() still runs (it's cheap) to keep map markers in sync.
  applyFilter();
});

// ---------- INITIAL LOAD ----------
async function loadInitialPoints() {
  try {
    const points = await fetchPoints(store.getState().authToken);
    store.setState({ points });
    // Always seed home map and analytics on first load regardless of
    // current page — the home page is the default and nav.js sets its
    // active class on window.load which may not have fired yet here.
    initHomeMap(points);
    loadAnalytics(points);
  } catch (_) {
    showToast('ไม่สามารถโหลดข้อมูลได้', 'error');
  }
}

loadInitialPoints();
loadStats();
