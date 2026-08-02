/**
 * home-map.js
 * Mini interactive Leaflet map shown on the homepage.
 * Completely independent of the main report-page map (map-view.js) —
 * uses its own instance, its own markers, and lazy-loads Leaflet the same
 * way so pages that never visit home don't pay the load cost.
 */
import { loadLeaflet } from './lazy-leaflet.js';

let homeMap = null;
let homeMarkers = null;
let initialized = false;

const THAILAND_CENTER = [13.0, 101.5];
const THAILAND_ZOOM   = 5;

function smallPinIcon(L) {
  return L.divIcon({
    className: 'home-map-pin',
    html: `<svg width="18" height="24" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 0C6.7 0 0 6.7 0 15c0 11.2 15 25 15 25s15-13.8 15-25C30 6.7 23.3 0 15 0z" fill="#ff6b5e" opacity="0.92"/>
      <circle cx="15" cy="15" r="5" fill="#fff"/>
    </svg>`,
    iconSize:    [18, 24],
    iconAnchor:  [9,  24],
    popupAnchor: [0, -22]
  });
}

/**
 * Initialises the home map and plots `points` on it.
 * Safe to call multiple times — subsequent calls just refresh the markers.
 *
 * @param {Array} points  — array of report objects from the store
 */
export async function initHomeMap(points) {
  const container = document.getElementById('home-map');
  const loading   = document.getElementById('home-map-loading');
  const badge     = document.getElementById('home-map-badge');

  if (!container) return;

  const L = await loadLeaflet();

  if (!initialized) {
    initialized = true;

    homeMap = L.map('home-map', {
      zoomControl:       false,
      scrollWheelZoom:   false,   // prevent scroll-hijack on the homepage
      attributionControl: false,
      dragging:          true,
      doubleClickZoom:   true,
      touchZoom:         true,
    }).setView(THAILAND_CENTER, THAILAND_ZOOM);

    // Minimal attribution tucked away
    L.control.attribution({ prefix: false, position: 'bottomright' }).addTo(homeMap);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains:  'abcd',
      maxZoom:     18,
    }).addTo(homeMap);

    // Small zoom control in the bottom-left
    L.control.zoom({ position: 'bottomleft' }).addTo(homeMap);

    homeMarkers = L.markerClusterGroup({
      maxClusterRadius:     60,
      showCoverageOnHover:  false,
      spiderfyOnMaxZoom:    true,
      disableClusteringAtZoom: 13,
    }).addTo(homeMap);

    homeMap.whenReady(() => {
      if (loading) loading.classList.add('hidden');
    });
  }

  // ── refresh markers ──────────────────────────────────────────────────────
  homeMarkers.clearLayers();

  for (const p of points) {
    if (!p.lat || !p.lng) continue;
    const marker = L.marker([p.lat, p.lng], { icon: smallPinIcon(L) });
    marker.bindPopup(`
      <div class="home-popup">
        <strong>${p.victimName ? escapeStr(p.victimName) : 'ไม่ระบุชื่อ'}</strong>
        <span>${p.locationOfDeath ? escapeStr(p.locationOfDeath) : '—'}</span>
      </div>`, { maxWidth: 180 });
    homeMarkers.addLayer(marker);
  }

  // ── badge ────────────────────────────────────────────────────────────────
  if (badge) {
    badge.textContent = points.length > 0 ? `${points.length} จุดรายงาน` : 'ไม่มีข้อมูล';
  }

  // If we have points, fit the map to them; otherwise show all of Thailand
  if (points.length > 0) {
    try {
      const bounds = homeMarkers.getBounds();
      if (bounds.isValid()) {
        homeMap.fitBounds(bounds, { padding: [24, 24], maxZoom: 10 });
      }
    } catch (_) {
      homeMap.setView(THAILAND_CENTER, THAILAND_ZOOM);
    }
  } else {
    homeMap.setView(THAILAND_CENTER, THAILAND_ZOOM);
  }

  // Force Leaflet to recalculate tile positions after CSS layout settles
  setTimeout(() => homeMap && homeMap.invalidateSize(), 120);
}

// Minimal HTML escape — the full escapeHtml from utils.js is not imported
// here to keep this module self-contained.
function escapeStr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
