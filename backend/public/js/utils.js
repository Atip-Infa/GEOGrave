/**
 * utils.js — shared frontend utilities
 *
 * Single source of truth for helpers used across multiple modules.
 * Nothing in this file touches the DOM directly.
 */

// ─── HTML escaping ────────────────────────────────────────────────────────────

export function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── URL safety ───────────────────────────────────────────────────────────────

// Only allow attachment URLs that point back at our own /uploads/ folder
// (defense in depth in case a future change ever lets `url` be attacker
// controlled — today the server always sets it, but a template that trusts
// it blindly is one refactor away from an open redirect / XSS).
export function safeAttachmentUrl(url) {
  return typeof url === 'string' && url.startsWith('/uploads/') ? url : '#';
}

// ─── Debounce ─────────────────────────────────────────────────────────────────

export function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// ─── Province extraction ──────────────────────────────────────────────────────
// Used in: table-view.js, map-view.js, stats.js
// Extracts the last meaningful comma-segment of a locationOfDeath string,
// which by Thai address convention is typically the province name.

export function extractProvince(locationOfDeath) {
  if (!locationOfDeath) return '';
  const parts = locationOfDeath.split(/[,،،]/);
  return parts[parts.length - 1].trim();
}

// ─── Geolocation ─────────────────────────────────────────────────────────────
// Used in: main.js (near-me), map-view.js (GPS control), report-form.js (GPS btn)
// Single wrapper so all three callers share identical timeout/cache settings
// and error-message strings.

/**
 * @param {(lat:number, lng:number) => void} onSuccess
 * @param {(message:string) => void} onError
 */
export function getCurrentLocation(onSuccess, onError) {
  if (!navigator.geolocation) {
    onError('เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => onSuccess(pos.coords.latitude, pos.coords.longitude),
    err => {
      const msg = err.code === 1
        ? 'ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง'
        : 'ไม่สามารถระบุตำแหน่งได้';
      onError(msg);
    },
    { timeout: 8000, maximumAge: 60000 }
  );
}

// ─── Nominatim geocoding ──────────────────────────────────────────────────────
// Used in: report-form.js (location search + reverse geocode), map-view.js (search control)
// Single implementation so both callers stay in sync on URL format, headers, and limits.

const NOMINATIM_HEADERS = { 'Accept-Language': 'th,en' };

/**
 * Forward search — returns up to `limit` results for a free-text query.
 * Restricted to Thailand (countrycodes=th).
 * @returns {Promise<Array<{lat:string,lon:string,display_name:string}>>}
 */
export async function nominatimSearch(query, limit = 5) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=${limit}&countrycodes=th`;
  const res = await fetch(url, { headers: NOMINATIM_HEADERS });
  if (!res.ok) throw new Error('Nominatim search failed');
  return res.json();
}

/**
 * Reverse geocode — resolves a lat/lng pair to a display_name string.
 * @returns {Promise<string>} The resolved address, or '' on failure.
 */
export async function nominatimReverse(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2&addressdetails=1`;
    const res = await fetch(url, { headers: NOMINATIM_HEADERS });
    if (!res.ok) return '';
    const data = await res.json();
    return data.display_name || '';
  } catch (_) {
    return '';
  }
}

// ─── Chart empty-state HTML ───────────────────────────────────────────────────
// Used in: charts.js (emptyState), stats.js (loadAnalytics fallback)
// Single definition so both callers render an identical empty state.

export function chartEmptyHtml(message = 'ไม่มีข้อมูล') {
  return `
    <div class="chart-empty">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="18" y1="20" x2="18" y2="10"/>
        <line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6"  y1="20" x2="6"  y2="14"/>
      </svg>
      <span>${escapeHtml(message)}</span>
    </div>`;
}
