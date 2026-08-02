// LAZY LOADING: Leaflet core (~150KB) + Leaflet.markercluster (~30KB) +
// Leaflet.heat (~8KB) + their CSS used to load unconditionally via
// <script>/<link> tags in <head>, on every single page. This module injects
// those assets on demand, the first time the map is actually opened, and
// caches the in-flight promise so repeated calls (e.g. switching between
// map/list view) don't re-fetch or double-inject anything.

const CSS_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.Default.css',
];

const SCRIPT_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.js',
  // Leaflet.heat must load after Leaflet core; it registers L.heatLayer on window.L
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.heat/0.2.0/leaflet-heat.js',
];

function loadStyle(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded) return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', reject);
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(script);
  });
}

let leafletPromise = null;

/** Resolves once window.L (with markercluster and heatLayer) is ready. */
export function loadLeaflet() {
  if (!leafletPromise) {
    leafletPromise = (async () => {
      CSS_URLS.forEach(loadStyle);
      for (const src of SCRIPT_URLS) {
        // Sequential: markercluster and heat both attach to the L object
        // created by leaflet.min.js, so order matters.
        await loadScript(src);
      }
      return window.L;
    })();
  }
  return leafletPromise;
}
