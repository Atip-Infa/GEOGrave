/**
 * toast.js — accessible toast notifications.
 *
 * Each toast carries the appropriate ARIA role:
 *  - 'alert'  (assertive) for errors — announced immediately by screen readers
 *  - 'status' (polite)    for info/success — announced at the next opportunity
 *
 * Exit animation uses a CSS class instead of inline styles so it respects
 * `prefers-reduced-motion` via the stylesheet rule already defined in style.css.
 */

const toastContainer = document.getElementById('toast-container');

const TOAST_DURATION_MS  = 3200;
const TOAST_FADE_MS      = 260;

export function showToast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;

  // 'alert' for errors (aria-live="assertive"), 'status' for everything else
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  el.setAttribute('aria-atomic', 'true');

  toastContainer.appendChild(el);

  setTimeout(() => {
    el.classList.add('toast--exit');
    setTimeout(() => el.remove(), TOAST_FADE_MS);
  }, TOAST_DURATION_MS);
}
