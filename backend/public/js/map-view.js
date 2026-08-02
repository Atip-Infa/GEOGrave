/**
 * map-view.js — GIS map module
 *
 * New in this version:
 *  - Base layer control: Road (CARTO Positron), Satellite (Esri), Terrain (Stadia)
 *  - Heatmap layer toggle (Leaflet.heat) — independent of marker clusters
 *  - Province filter, gender/status filter, date-range filter
 *    All filters compose: only points matching ALL active filters are shown.
 *    Filtering uses the existing zero-re-render setVisibleIds pattern.
 *  - Map-embedded location search (Nominatim) with keyboard navigation
 *  - GPS / current-location button injected into the map
 *  - Fit-to-markers button (toolbar + map control)
 *  - Legend control (injected into map, not the page DOM)
 *  - Optimised rendering: markers created once, never rebuilt on filter change
 *
 * All existing exports (ensureMap, syncMarkers, setVisibleIds, focusPoint,
 * onMapClick, invalidateMapSize, highlightNearby) are preserved unchanged.
 */

import { loadLeaflet } from './lazy-leaflet.js';
import { escapeHtml, safeAttachmentUrl, debounce, getCurrentLocation, nominatimSearch, extractProvince } from './utils.js';

// ─── module-level state ──────────────────────────────────────────────────────
let map            = null;
let markersLayer   = null;   // MarkerClusterGroup
let heatLayer      = null;   // L.heatLayer (null when toggled off)
let mapReadyPromise = null;
let Lref           = null;   // cached L once ready

const markerEntries = new Map(); // id → { marker, point }

// Active filter state — all three filters compose with AND logic
const filterState = {
  province:  '',   // '' = all
  gender:    '',   // '' = all
  dateFrom:  '',   // ISO date string or ''
  dateTo:    '',   // ISO date string or ''
};

// Whether heatmap is currently shown
let heatVisible = false;

// ─── tile layers ─────────────────────────────────────────────────────────────
const TILE_LAYERS = {
  'ถนน (Road)': {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    options: {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
      subdomains: 'abcd',
    },
  },
  'ดาวเทียม (Satellite)': {
    // ESRI World Imagery — no API key required, widely used in open-source GIS
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      attribution: '&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, USGS, NOAA',
      maxZoom: 19,
      crossOrigin: true,
    },
  },
  'ภูมิประเทศ (Terrain)': {
    // OpenStreetMap standard — reliable fallback for terrain context
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    },
  },
};

// ─── marker icons ─────────────────────────────────────────────────────────────
function pinIcon(L, highlight = false) {
  const fill = highlight ? '#2b8cbe' : '#ff6b5e';
  return L.divIcon({
    className: 'custom-pin',
    html: `<svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 0C6.7 0 0 6.7 0 15c0 11.2 15 25 15 25s15-13.8 15-25C30 6.7 23.3 0 15 0z" fill="${fill}"/>
      <circle cx="15" cy="15" r="6" fill="#fff"/>
    </svg>`,
    iconSize: [30, 40], iconAnchor: [15, 40], popupAnchor: [0, -36],
  });
}

// ─── popup HTML ───────────────────────────────────────────────────────────────
function popupHtml(point, isAuthed) {
  const attachHtml = (point.attachments || [])
    .map(a => `<div><a href="${escapeHtml(safeAttachmentUrl(a.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.filename)}</a></div>`)
    .join('');
  const editBtn   = isAuthed ? `<button class="popup-edit"   data-id="${escapeHtml(point.id)}">แก้ไข</button>`    : '';
  const deleteBtn = isAuthed ? `<button class="popup-delete" data-id="${escapeHtml(point.id)}">ลบข้อมูล</button>` : '';
  return `
    <div class="popup-content">
      <h4>${escapeHtml(point.victimName) || 'ไม่ระบุชื่อ'}</h4>
      <div>อายุ: ${escapeHtml(point.victimAge) || '—'} | เพศ: ${escapeHtml(point.victimGender) || '—'}</div>
      <div>สาเหตุ: ${escapeHtml(point.causeOfDeath) || '—'}</div>
      <div>วันที่: ${escapeHtml(point.reportedDate) || '—'} ${escapeHtml(point.reportedTime) || ''}</div>
      <div>สถานที่: ${escapeHtml(point.locationOfDeath) || '—'}</div>
      <div>วัด: ${escapeHtml(point.destinationTemple) || '—'}</div>
      <div>รายงานโดย: ${escapeHtml(point.reportedBy) || '—'}</div>
      ${attachHtml}
      <div class="popup-actions">${editBtn}${deleteBtn}</div>
    </div>`;
}

// ─── filter logic ─────────────────────────────────────────────────────────────
/**
 * Returns true if the point passes ALL active filters.
 * Called by applyMapFilters() — never touches DOM directly.
 */
function passesFilter(point) {
  // Province: match if locationOfDeath contains the selected province string
  if (filterState.province) {
    const loc = (point.locationOfDeath || '').toLowerCase();
    if (!loc.includes(filterState.province.toLowerCase())) return false;
  }
  // Gender
  if (filterState.gender) {
    const g = point.victimGender || 'ไม่ทราบ';
    if (g !== filterState.gender) return false;
  }
  // Date range
  if (filterState.dateFrom || filterState.dateTo) {
    const d = point.reportedDate || '';
    if (!d) return false;
    if (filterState.dateFrom && d < filterState.dateFrom) return false;
    if (filterState.dateTo   && d > filterState.dateTo)   return false;
  }
  return true;
}

/**
 * Show/hide markers based on the current filterState.
 * Never creates or destroys marker objects — only adds/removes from the cluster group.
 * Also rebuilds the heatmap if it is visible.
 */
function applyMapFilters() {
  if (!markersLayer) return;
  let visibleCount = 0;
  const heatPoints = [];

  for (const [, entry] of markerEntries) {
    const show  = passesFilter(entry.point);
    const shown = markersLayer.hasLayer(entry.marker);
    if (show && !shown) { markersLayer.addLayer(entry.marker); }
    else if (!show && shown) { markersLayer.removeLayer(entry.marker); }
    if (show) {
      visibleCount++;
      heatPoints.push([entry.point.lat, entry.point.lng, 1]);
    }
  }

  // Rebuild heatmap with filtered set
  if (heatLayer) heatLayer.setLatLngs(heatPoints);

  // Show/hide filter-reset button
  const resetBtn = document.getElementById('filter-reset');
  if (resetBtn) {
    const anyActive = filterState.province || filterState.gender || filterState.dateFrom || filterState.dateTo;
    resetBtn.classList.toggle('hidden', !anyActive);
  }

  return visibleCount;
}

// ─── province dropdown ────────────────────────────────────────────────────────
/**
 * Rebuild the province <select> from the current set of markers.
 * Called once after initial data load and again when new points arrive.
 */
function rebuildProvinceFilter(points) {
  const sel = document.getElementById('filter-province');
  if (!sel) return;
  const current = sel.value;
  const provinces = new Set();
  for (const p of points) {
    const prov = extractProvince(p.locationOfDeath);
    if (prov) provinces.add(prov);
  }

  // Keep existing options except the first placeholder
  sel.innerHTML = '<option value="">จังหวัดทั้งหมด</option>';
  [...provinces].sort().forEach(prov => {
    const opt = document.createElement('option');
    opt.value = prov;
    opt.textContent = prov;
    sel.appendChild(opt);
  });
  // Restore selection if still valid
  if (current && [...provinces].includes(current)) sel.value = current;
}

// ─── legend control ───────────────────────────────────────────────────────────
function addLegend(L) {
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `
      <div class="map-legend-title">สัญลักษณ์</div>
      <div class="map-legend-item">
        <svg width="14" height="18" viewBox="0 0 30 40"><path d="M15 0C6.7 0 0 6.7 0 15c0 11.2 15 25 15 25s15-13.8 15-25C30 6.7 23.3 0 15 0z" fill="#ff6b5e"/><circle cx="15" cy="15" r="6" fill="#fff"/></svg>
        <span>รายงานเหตุการณ์</span>
      </div>
      <div class="map-legend-item">
        <svg width="14" height="18" viewBox="0 0 30 40"><path d="M15 0C6.7 0 0 6.7 0 15c0 11.2 15 25 15 25s15-13.8 15-25C30 6.7 23.3 0 15 0z" fill="#2b8cbe"/><circle cx="15" cy="15" r="6" fill="#fff"/></svg>
        <span>จุดใกล้เคียง</span>
      </div>
      <div class="map-legend-item">
        <div class="legend-cluster-dot">N</div>
        <span>กลุ่มรายงาน</span>
      </div>
      <div class="map-legend-item">
        <div class="legend-heat-dot"></div>
        <span>ความหนาแน่น</span>
      </div>`;
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  legend.addTo(map);
}

// ─── GPS control (injected into map) ─────────────────────────────────────────
function addGpsControl(L) {
  const GpsControl = L.Control.extend({
    onAdd() {
      const btn = L.DomUtil.create('button', 'map-ctrl-btn map-ctrl-gps');
      btn.title = 'ตำแหน่งปัจจุบัน';
      btn.setAttribute('aria-label', 'ตำแหน่งปัจจุบัน');
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>`;
      L.DomEvent.on(btn, 'click', L.DomEvent.stopPropagation);
      L.DomEvent.on(btn, 'click', () => {
        if (!navigator.geolocation) return;
        btn.classList.add('loading');
        getCurrentLocation(
          (lat, lng) => {
            btn.classList.remove('loading');
            map.setView([lat, lng], 14);
            L.circleMarker([lat, lng], {
              radius: 8, color: '#2b8cbe', fillColor: '#2b8cbe', fillOpacity: 0.6,
            }).addTo(map).bindPopup('ตำแหน่งของคุณ').openPopup();
          },
          () => { btn.classList.remove('loading'); }
        );
      });
      return btn;
    },
  });
  new GpsControl({ position: 'topleft' }).addTo(map);
}

// ─── heatmap toggle control ───────────────────────────────────────────────────
function addHeatmapControl(L) {
  const HeatControl = L.Control.extend({
    onAdd() {
      const btn = L.DomUtil.create('button', 'map-ctrl-btn map-ctrl-heat');
      btn.title = 'ความหนาแน่น (Heatmap)';
      btn.setAttribute('aria-label', 'เปิด/ปิด Heatmap');
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>`;
      L.DomEvent.on(btn, 'click', L.DomEvent.stopPropagation);
      L.DomEvent.on(btn, 'click', () => {
        heatVisible = !heatVisible;
        btn.setAttribute('aria-pressed', String(heatVisible));
        btn.classList.toggle('active', heatVisible);
        if (heatVisible) {
          if (!heatLayer) {
            const pts = [...markerEntries.values()]
              .filter(e => markersLayer.hasLayer(e.marker))
              .map(e => [e.point.lat, e.point.lng, 1]);
            heatLayer = L.heatLayer(pts, {
              radius: 25, blur: 20, maxZoom: 14,
              gradient: { 0.2: '#3388ff', 0.5: '#ff8c00', 1.0: '#ff0000' },
            }).addTo(map);
          } else {
            heatLayer.addTo(map);
          }
        } else {
          if (heatLayer) map.removeLayer(heatLayer);
        }
      });
      return btn;
    },
  });
  new HeatControl({ position: 'topleft' }).addTo(map);
}

// ─── fit-to-markers control ───────────────────────────────────────────────────
function addFitControl(L) {
  const FitControl = L.Control.extend({
    onAdd() {
      const btn = L.DomUtil.create('button', 'map-ctrl-btn map-ctrl-fit');
      btn.title = 'ซูมให้เห็นทุกจุด';
      btn.setAttribute('aria-label', 'ซูมให้เห็นทุกจุด');
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
      L.DomEvent.on(btn, 'click', L.DomEvent.stopPropagation);
      L.DomEvent.on(btn, 'click', fitToMarkers);
      return btn;
    },
  });
  new FitControl({ position: 'topleft' }).addTo(map);
}

// ─── map location search control ─────────────────────────────────────────────
function addSearchControl(L) {
  const SearchControl = L.Control.extend({
    onAdd() {
      const wrap = L.DomUtil.create('div', 'map-search-ctrl');
      wrap.innerHTML = `
        <input type="text" class="map-search-input" placeholder="ค้นหาสถานที่..." autocomplete="off" aria-label="ค้นหาสถานที่บนแผนที่">
        <div class="map-search-results" role="listbox"></div>`;
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.disableScrollPropagation(wrap);

      const input   = wrap.querySelector('.map-search-input');
      const results = wrap.querySelector('.map-search-results');

      const search = debounce(async () => {
        const q = input.value.trim();
        if (q.length < 3) { results.innerHTML = ''; results.classList.remove('open'); return; }
        try {
          const items = await nominatimSearch(q);
          if (!items.length) {
            results.innerHTML = '<div class="map-search-empty">ไม่พบสถานที่</div>';
            results.classList.add('open');
            return;
          }
          results.innerHTML = items.map(item =>
            `<div class="map-search-item" role="option" tabindex="0"
               data-lat="${item.lat}" data-lng="${item.lon}">
              ${escapeHtml(item.display_name)}
            </div>`).join('');
          results.classList.add('open');
          results.querySelectorAll('.map-search-item').forEach(el => {
            const go = () => {
              map.setView([parseFloat(el.dataset.lat), parseFloat(el.dataset.lng)], 14);
              input.value = '';
              results.innerHTML = '';
              results.classList.remove('open');
            };
            el.addEventListener('click', go);
            el.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
          });
        } catch (_) { results.innerHTML = ''; results.classList.remove('open'); }
      }, 400);

      input.addEventListener('input', search);
      input.addEventListener('keydown', e => {
        if (e.key === 'Escape') { results.innerHTML = ''; results.classList.remove('open'); }
      });
      return wrap;
    },
  });
  new SearchControl({ position: 'topright' }).addTo(map);
}

// ─── fit to visible markers ───────────────────────────────────────────────────
export function fitToMarkers() {
  if (!markersLayer) return;
  try {
    const bounds = markersLayer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  } catch (_) { /* no markers visible */ }
}

// ─── ensureMap (main entry point) ─────────────────────────────────────────────
export function ensureMap(onDeleteRequested, onEditRequested) {
  if (!mapReadyPromise) {
    mapReadyPromise = loadLeaflet().then((L) => {
      Lref = L;

      map = L.map('map', { zoomControl: true }).setView([13.7563, 100.5018], 6);

      // ── base layers ─────────────────────────────────────────────────────────
      const baseLayers = {};
      let firstLayer = null;
      for (const [name, cfg] of Object.entries(TILE_LAYERS)) {
        const layer = L.tileLayer(cfg.url, cfg.options);
        baseLayers[name] = layer;
        if (!firstLayer) { layer.addTo(map); firstLayer = layer; }
      }

      // ── marker cluster group ─────────────────────────────────────────────────
      markersLayer = L.markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        chunkedLoading: true,          // yields to browser between batches
      });
      markersLayer.addTo(map);

      // ── layer control (base layers + cluster overlay) ────────────────────────
      const overlays = { 'รายงาน (Markers)': markersLayer };
      L.control.layers(baseLayers, overlays, { position: 'topright', collapsed: true }).addTo(map);

      // ── custom controls ───────────────────────────────────────────────────────
      addGpsControl(L);
      addHeatmapControl(L);
      addFitControl(L);
      addSearchControl(L);
      addLegend(L);

      // ── map ready ────────────────────────────────────────────────────────────
      const mapLoading = document.getElementById('map-loading');
      map.whenReady(() => setTimeout(() => mapLoading && mapLoading.classList.add('hidden'), 300));

      // ── event delegation for popup buttons ───────────────────────────────────
      map.getContainer().addEventListener('click', (e) => {
        const del  = e.target.closest('.popup-delete');
        if (del)  { onDeleteRequested(del.dataset.id);  return; }
        const edit = e.target.closest('.popup-edit');
        if (edit) { onEditRequested(edit.dataset.id); }
      });

      // ── toolbar filter wiring ─────────────────────────────────────────────────
      const provSel  = document.getElementById('filter-province');
      const gendSel  = document.getElementById('filter-gender');
      const dateFrom = document.getElementById('filter-date-from');
      const dateTo   = document.getElementById('filter-date-to');
      const resetBtn = document.getElementById('filter-reset');
      const fitBtn   = document.getElementById('fit-markers-btn');

      if (provSel)  provSel.addEventListener('change',  () => { filterState.province  = provSel.value;    applyMapFilters(); });
      if (gendSel)  gendSel.addEventListener('change',  () => { filterState.gender    = gendSel.value;    applyMapFilters(); });
      if (dateFrom) dateFrom.addEventListener('change', () => { filterState.dateFrom  = dateFrom.value;   applyMapFilters(); });
      if (dateTo)   dateTo.addEventListener('change',   () => { filterState.dateTo    = dateTo.value;     applyMapFilters(); });

      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          filterState.province = '';
          filterState.gender   = '';
          filterState.dateFrom = '';
          filterState.dateTo   = '';
          if (provSel)  provSel.value  = '';
          if (gendSel)  gendSel.value  = '';
          if (dateFrom) dateFrom.value = '';
          if (dateTo)   dateTo.value   = '';
          applyMapFilters();
        });
      }

      if (fitBtn) fitBtn.addEventListener('click', fitToMarkers);

      return { L, map, markersLayer };
    });
  }
  return mapReadyPromise;
}

// ─── exported utilities ───────────────────────────────────────────────────────
export function invalidateMapSize() {
  if (map) map.invalidateSize();
}

/**
 * Reconcile markers: create once for new points, remove for deleted ones.
 * Never rebuilds existing markers — preserves open popups and cluster state.
 */
export async function syncMarkers(points, isAuthedFn) {
  await mapReadyPromise;
  const L = Lref;
  const incomingIds = new Set(points.map(p => p.id));

  // Remove deleted
  for (const [id, entry] of markerEntries) {
    if (!incomingIds.has(id)) {
      markersLayer.removeLayer(entry.marker);
      markerEntries.delete(id);
    }
  }

  // Add new
  for (const point of points) {
    if (markerEntries.has(point.id)) continue;
    const marker = L.marker([point.lat, point.lng], { icon: pinIcon(L) });
    // Popup content evaluated lazily — auth state always current at open time
    marker.bindPopup(() => popupHtml(point, isAuthedFn()));
    markersLayer.addLayer(marker);
    markerEntries.set(point.id, { marker, point });
  }

  // Rebuild province dropdown with the full updated set
  rebuildProvinceFilter(points);

  // Re-apply active filters to any new points
  applyMapFilters();

  // Rebuild heatmap if visible
  if (heatVisible && heatLayer) {
    const pts = [...markerEntries.values()]
      .filter(e => passesFilter(e.point))
      .map(e => [e.point.lat, e.point.lng, 1]);
    heatLayer.setLatLngs(pts);
  }
}

/**
 * Highlight nearby points with a blue pin; reset others to coral.
 * Pass an empty Set to clear all highlights.
 */
export async function highlightNearby(nearbyIds) {
  await mapReadyPromise;
  for (const [id, entry] of markerEntries) {
    entry.marker.setIcon(pinIcon(Lref, nearbyIds.has(id)));
  }
}

/**
 * Show only markers whose id is in `ids`; hide the rest.
 * Used by the toolbar text-search in main.js.
 * Composes with the map-internal filters (both must pass).
 */
export function setVisibleIds(ids) {
  if (!markersLayer) return;
  for (const [id, entry] of markerEntries) {
    const shouldShow = ids.has(id) && passesFilter(entry.point);
    const isShown    = markersLayer.hasLayer(entry.marker);
    if (shouldShow && !isShown)  markersLayer.addLayer(entry.marker);
    if (!shouldShow && isShown)  markersLayer.removeLayer(entry.marker);
  }
}

export function focusPoint(id) {
  const entry = markerEntries.get(id);
  if (!entry || !map) return;
  map.setView(entry.marker.getLatLng(), 14);
  entry.marker.openPopup();
}

export function onMapClick(handler) {
  mapReadyPromise.then(() => map.on('click', handler));
}
