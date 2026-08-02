/**
 * report-form.js
 * Handles the report creation / editing sidebar form.
 *
 * Features added in this version:
 *  - Inline field validation with per-field error messages
 *  - Auto-fill current date and time on form open
 *  - Current-location GPS button (both in intro state and in form)
 *  - Location search via Nominatim (OpenStreetMap, no API key required)
 *  - Reverse geocoding on map click and GPS fix
 *  - Better coordinate display card with resolved address
 *  - File preview list with thumbnail for images, icon for PDFs
 *  - Success modal with report reference number
 *  - 3-step progress indicator
 *  - All original create / edit / reset behaviour preserved
 */

import { createPoint, updatePoint } from './api.js';
import { showToast } from './toast.js';
import { escapeHtml, debounce, getCurrentLocation, nominatimSearch, nominatimReverse } from './utils.js';

// ─── DOM refs ────────────────────────────────────────────────────────────────
const sidebarIntro   = document.getElementById('sidebar-intro');
const reportForm     = document.getElementById('report-form');
const formModeTitle  = document.getElementById('form-mode-title');
const formProgress   = document.getElementById('form-progress');
const inputLat       = document.getElementById('input-lat');
const inputLng       = document.getElementById('input-lng');
const editIdInput    = document.getElementById('edit-id');
const coordValue     = document.getElementById('coord-value');
const coordAddress   = document.getElementById('coord-address');
const coordDisplay   = document.getElementById('coord-display');
const gpsBtn         = document.getElementById('gps-btn');
const locationSearch = document.getElementById('location-search');
const searchResults  = document.getElementById('location-search-results');
const attachInput    = document.getElementById('attachments-input');
const previewList    = document.getElementById('file-preview-list');
const backBtn        = document.getElementById('back-to-intro');
const createBtn      = document.getElementById('create-btn');

// Intro-state location helpers
const introGpsBtn       = document.getElementById('intro-gps-btn');
const introSearchInput  = document.getElementById('intro-location-search');
const introSearchResults= document.getElementById('intro-search-results');

// Success modal
const successModal     = document.getElementById('success-modal');
const successRefNumber = document.getElementById('success-ref-number');
const successViewBtn   = document.getElementById('success-view-btn');
const successCloseBtn  = document.getElementById('success-close-btn');

// ─── module state ────────────────────────────────────────────────────────────
let _onCreated   = null;
let _onUpdated   = null;
let _getToken    = null;

// ─── helpers: date / time ────────────────────────────────────────────────────

function todayIso()    { return new Date().toISOString().slice(0, 10); }
function nowTimeHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ─── helpers: coordinate display ─────────────────────────────────────────────

function setCoord(lat, lng) {
  inputLat.value = lat;
  inputLng.value = lng;
  coordValue.textContent = `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
  coordAddress.textContent = 'กำลังค้นหาที่อยู่...';
  coordDisplay.classList.add('coord-card--active');
  nominatimReverse(lat, lng).then(addr => {
    const parts = addr.split(',').slice(0, 5).join(',');
    coordAddress.textContent = parts || '—';
    const locField = reportForm.querySelector('[name="locationOfDeath"]');
    if (locField && !locField.value.trim()) locField.value = parts.slice(0, 300);
  });
}

// ─── helpers: location search (uses shared Nominatim utility) ────────────────

// One AbortController per search input so we cancel stale requests cleanly.
const _searchAborts = new WeakMap();

function wireSearch(inputEl, resultsEl, onSelect) {
  const doSearch = debounce(async () => {
    const q = inputEl.value.trim();
    if (q.length < 3) { resultsEl.innerHTML = ''; resultsEl.classList.remove('open'); return; }

    // Cancel any in-flight request for this input
    if (_searchAborts.has(inputEl)) _searchAborts.get(inputEl).abort();
    const ac = new AbortController();
    _searchAborts.set(inputEl, ac);

    try {
      const items = await nominatimSearch(q);
      if (!items.length) {
        resultsEl.innerHTML = '<div class="loc-result-empty">ไม่พบสถานที่ที่ค้นหา</div>';
        resultsEl.classList.add('open');
        return;
      }
      resultsEl.innerHTML = items.map((item, i) =>
        `<div class="loc-result-item" role="option" tabindex="0" data-lat="${item.lat}" data-lng="${item.lon}" data-idx="${i}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          <span>${escapeHtml(item.display_name)}</span>
        </div>`
      ).join('');
      resultsEl.classList.add('open');

      resultsEl.querySelectorAll('.loc-result-item').forEach(el => {
        const select = () => {
          onSelect(parseFloat(el.dataset.lat), parseFloat(el.dataset.lng), el.querySelector('span').textContent);
          resultsEl.innerHTML = '';
          resultsEl.classList.remove('open');
        };
        el.addEventListener('click', select);
        el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') select(); });
      });
    } catch (_) {
      resultsEl.innerHTML = '';
      resultsEl.classList.remove('open');
    }
  }, 400);

  inputEl.addEventListener('input', doSearch);
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Escape') { resultsEl.innerHTML = ''; resultsEl.classList.remove('open'); }
  });

  // Use a single delegated listener on the document registered once per page load
  // (not once per wireSearch call) to avoid accumulating duplicates.
  if (!wireSearch._listenerAttached) {
    wireSearch._listenerAttached = true;
    document.addEventListener('click', e => {
      document.querySelectorAll('.location-search-results.open, #intro-search-results.open').forEach(panel => {
        const input = panel.previousElementSibling || panel.closest('.location-search-wrap, .intro-search-wrap')?.querySelector('input');
        if (input && !input.contains(e.target) && !panel.contains(e.target)) {
          panel.innerHTML = '';
          panel.classList.remove('open');
        }
      });
    });
  }
}

// ─── helpers: geolocation (uses shared utility) ───────────────────────────────

function setGpsButtonLoading(btn, loading) {
  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
}

// ─── helpers: validation ──────────────────────────────────────────────────────

function setFieldError(fieldId, message) {
  const errEl = document.getElementById(`err-${fieldId}`);
  const inputEl = document.getElementById(`f-${fieldId}`) || document.querySelector(`[name="${fieldId}"]`);
  if (errEl) {
    errEl.textContent = message;
    errEl.classList.toggle('visible', !!message);
  }
  if (inputEl) inputEl.classList.toggle('field-input--error', !!message);
}

function clearFieldError(fieldId) { setFieldError(fieldId, ''); }

function validateForm() {
  let valid = true;

  // lat/lng — must be set via map click or GPS
  if (!inputLat.value || !inputLng.value) {
    coordDisplay.classList.add('coord-card--error');
    showToast('กรุณาคลิกบนแผนที่หรือใช้ GPS เพื่อระบุตำแหน่ง', 'error');
    valid = false;
  } else {
    coordDisplay.classList.remove('coord-card--error');
  }

  // victimName — required
  const nameVal = reportForm.querySelector('[name="victimName"]').value.trim();
  if (!nameVal) {
    setFieldError('victimName', 'กรุณากรอกชื่อผู้เสียชีวิต');
    valid = false;
  } else {
    clearFieldError('victimName');
  }

  // victimAge — optional but must be 0–150 if provided
  const ageVal = reportForm.querySelector('[name="victimAge"]').value;
  if (ageVal !== '' && (isNaN(Number(ageVal)) || Number(ageVal) < 0 || Number(ageVal) > 150)) {
    setFieldError('victimAge', 'อายุต้องอยู่ระหว่าง 0–150 ปี');
    valid = false;
  } else {
    clearFieldError('victimAge');
  }

  // reporterPhone — optional but must be valid format if provided
  const phoneVal = reportForm.querySelector('[name="reporterPhone"]').value.trim();
  if (phoneVal && !/^[0-9\-+\s()]{7,20}$/.test(phoneVal)) {
    setFieldError('reporterPhone', 'รูปแบบเบอร์โทรไม่ถูกต้อง (7–20 ตัวอักษร)');
    valid = false;
  } else {
    clearFieldError('reporterPhone');
  }

  // reporterIdCard — optional but must be exactly 13 digits if provided
  const idVal = reportForm.querySelector('[name="reporterIdCard"]').value;
  if (idVal && !/^\d{13}$/.test(idVal)) {
    setFieldError('reporterIdCard', 'เลขบัตรประชาชนต้องมี 13 หลัก');
    valid = false;
  } else {
    clearFieldError('reporterIdCard');
  }

  return valid;
}

// ─── helpers: progress indicator ─────────────────────────────────────────────

function setProgress(step) {
  if (!formProgress) return;
  formProgress.querySelectorAll('.progress-step').forEach(el => {
    const n = parseInt(el.dataset.step, 10);
    el.classList.toggle('active',    n === step);
    el.classList.toggle('completed', n < step);
  });
}

// ─── helpers: file preview ───────────────────────────────────────────────────

function renderFilePreviews(files) {
  if (!previewList) return;
  previewList.innerHTML = '';
  Array.from(files).forEach((file, i) => {
    const item = document.createElement('div');
    item.className = 'file-preview-item';

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = e => {
        item.querySelector('.file-preview-thumb').style.backgroundImage = `url(${e.target.result})`;
      };
      reader.readAsDataURL(file);
      item.innerHTML = `
        <div class="file-preview-thumb" aria-hidden="true"></div>
        <div class="file-preview-info">
          <div class="file-preview-name">${escapeHtml(file.name)}</div>
          <div class="file-preview-size">${(file.size / 1024).toFixed(0)} KB</div>
        </div>
        <button type="button" class="file-preview-remove" data-idx="${i}" aria-label="ลบไฟล์ ${escapeHtml(file.name)}">&times;</button>`;
    } else {
      item.innerHTML = `
        <div class="file-preview-thumb file-preview-thumb--doc" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div class="file-preview-info">
          <div class="file-preview-name">${escapeHtml(file.name)}</div>
          <div class="file-preview-size">${(file.size / 1024).toFixed(0)} KB</div>
        </div>
        <button type="button" class="file-preview-remove" data-idx="${i}" aria-label="ลบไฟล์ ${escapeHtml(file.name)}">&times;</button>`;
    }
    previewList.appendChild(item);
  });
}

// ─── helpers: success modal ───────────────────────────────────────────────────

function showSuccessModal(point) {
  // Generate a short human-readable reference from the UUID
  const ref = `GEO-${point.id.slice(0, 8).toUpperCase()}`;
  successRefNumber.textContent = ref;
  successModal.classList.remove('hidden');
  successModal.querySelector('.success-modal-box').focus();
}

function hideSuccessModal() {
  successModal.classList.add('hidden');
}

// ─── reset ───────────────────────────────────────────────────────────────────

export function resetForm() {
  reportForm.reset();
  editIdInput.value = '';
  if (previewList) previewList.innerHTML = '';
  coordValue.textContent = '—';
  coordAddress.textContent = '';
  coordDisplay.classList.remove('coord-card--active', 'coord-card--error');
  formModeTitle.textContent = 'บันทึกเหตุการณ์';
  createBtn.querySelector('.btn-label').textContent = 'บันทึกรายงาน';
  ['victimName', 'victimAge', 'reporterPhone', 'reporterIdCard'].forEach(clearFieldError);
  reportForm.classList.add('hidden');
  formProgress.classList.add('hidden');
  sidebarIntro.classList.remove('hidden');
  reportForm.closest('.sidebar').scrollTop = 0;
}

// ─── edit mode ───────────────────────────────────────────────────────────────

export function openEditForm(point) {
  reportForm.querySelector('[name="victimName"]').value    = point.victimName || '';
  reportForm.querySelector('[name="victimAge"]').value     = point.victimAge  || '';
  reportForm.querySelector('[name="victimGender"]').value  = point.victimGender || '';
  reportForm.querySelector('[name="causeOfDeath"]').value  = point.causeOfDeath || '';
  reportForm.querySelector('[name="reportedDate"]').value  = point.reportedDate || '';
  reportForm.querySelector('[name="reportedTime"]').value  = point.reportedTime || '';
  reportForm.querySelector('[name="locationOfDeath"]').value    = point.locationOfDeath || '';
  reportForm.querySelector('[name="destinationTemple"]').value  = point.destinationTemple || '';
  reportForm.querySelector('[name="reportedBy"]').value    = point.reportedBy || '';
  reportForm.querySelector('[name="reporterPhone"]').value  = point.reporterPhone || '';
  reportForm.querySelector('[name="reporterIdCard"]').value = '';  // never pre-fill PII

  inputLat.value = point.lat;
  inputLng.value = point.lng;
  editIdInput.value = point.id;

  coordValue.textContent = `${Number(point.lat).toFixed(5)}, ${Number(point.lng).toFixed(5)}`;
  coordAddress.textContent = 'กำลังค้นหาที่อยู่...';
  coordDisplay.classList.add('coord-card--active');
  nominatimReverse(point.lat, point.lng).then(addr => {
    coordAddress.textContent = addr.split(',').slice(0, 5).join(',') || '—';
  });

  if (previewList) previewList.innerHTML = '';

  formModeTitle.textContent = 'แก้ไขรายงาน';
  createBtn.querySelector('.btn-label').textContent = 'บันทึกการแก้ไข';

  sidebarIntro.classList.add('hidden');
  formProgress.classList.remove('hidden');
  reportForm.classList.remove('hidden');
  setProgress(2);

  reportForm.closest('.sidebar').scrollTop = 0;
  reportForm.querySelector('[name="victimName"]').focus();
}

// ─── setLoading ───────────────────────────────────────────────────────────────

function setLoading(loading, isEdit) {
  createBtn.disabled = loading;
  createBtn.querySelector('.btn-label').textContent = loading
    ? 'กำลังบันทึก...'
    : (isEdit ? 'บันทึกการแก้ไข' : 'บันทึกรายงาน');
  createBtn.querySelector('.btn-spinner').classList.toggle('hidden', !loading);
}

// ─── openCreateForm (called from onMapClicked and GPS) ───────────────────────

function openCreateForm(lat, lng) {
  // Auto-fill date + time if not already set
  const dateField = reportForm.querySelector('[name="reportedDate"]');
  const timeField = reportForm.querySelector('[name="reportedTime"]');
  if (dateField && !dateField.value) dateField.value = todayIso();
  if (timeField && !timeField.value) timeField.value = nowTimeHHMM();

  setCoord(lat, lng);
  sidebarIntro.classList.add('hidden');
  formProgress.classList.remove('hidden');
  reportForm.classList.remove('hidden');
  formModeTitle.textContent = 'บันทึกเหตุการณ์';
  createBtn.querySelector('.btn-label').textContent = 'บันทึกรายงาน';
  setProgress(1);
  reportForm.closest('.sidebar').scrollTop = 0;
}

// ─── init ─────────────────────────────────────────────────────────────────────

export function initReportForm({ onCreated, onUpdated, getToken }) {
  _onCreated = onCreated;
  _onUpdated = onUpdated;
  _getToken  = getToken;

  // ── back button ────────────────────────────────────────────────────────────
  backBtn.addEventListener('click', resetForm);

  // ── GPS button (inside form coord card) ───────────────────────────────────
  if (gpsBtn) {
    gpsBtn.addEventListener('click', () => {
      setGpsButtonLoading(gpsBtn, true);
      getCurrentLocation(
        (lat, lng) => {
          setGpsButtonLoading(gpsBtn, false);
          setCoord(lat, lng);
          if (reportForm.classList.contains('hidden')) openCreateForm(lat, lng);
        },
        (msg) => { setGpsButtonLoading(gpsBtn, false); showToast(msg, 'error'); }
      );
    });
  }

  if (introGpsBtn) {
    introGpsBtn.addEventListener('click', () => {
      setGpsButtonLoading(introGpsBtn, true);
      getCurrentLocation(
        (lat, lng) => { setGpsButtonLoading(introGpsBtn, false); openCreateForm(lat, lng); },
        (msg)      => { setGpsButtonLoading(introGpsBtn, false); showToast(msg, 'error'); }
      );
    });
  }

  // ── location search (inside form) ─────────────────────────────────────────
  if (locationSearch && searchResults) {
    wireSearch(locationSearch, searchResults, (lat, lng, label) => {
      locationSearch.value = label.split(',')[0];
      setCoord(lat, lng);
      // fill locationOfDeath if empty
      const locField = reportForm.querySelector('[name="locationOfDeath"]');
      if (locField && !locField.value.trim()) locField.value = label.slice(0, 300);
    });
  }

  // ── location search (intro state) ─────────────────────────────────────────
  if (introSearchInput && introSearchResults) {
    wireSearch(introSearchInput, introSearchResults, (lat, lng) => {
      introSearchInput.value = '';
      openCreateForm(lat, lng);
    });
  }

  // ── file input → preview ──────────────────────────────────────────────────
  if (attachInput) {
    attachInput.addEventListener('change', () => {
      renderFilePreviews(attachInput.files);
      setProgress(3);
    });
  }

  // Remove individual file (best-effort: rebuild a DataTransfer)
  if (previewList) {
    previewList.addEventListener('click', e => {
      const btn = e.target.closest('.file-preview-remove');
      if (!btn || !attachInput) return;
      const idx = parseInt(btn.dataset.idx, 10);
      const dt = new DataTransfer();
      Array.from(attachInput.files).forEach((f, i) => { if (i !== idx) dt.items.add(f); });
      attachInput.files = dt.files;
      renderFilePreviews(attachInput.files);
    });
  }

  // ── drag-and-drop on file-drop ─────────────────────────────────────────────
  const fileDrop = document.getElementById('file-drop');
  if (fileDrop) {
    fileDrop.addEventListener('dragover', e => { e.preventDefault(); fileDrop.classList.add('dragging'); });
    fileDrop.addEventListener('dragleave', () => fileDrop.classList.remove('dragging'));
    fileDrop.addEventListener('drop', e => {
      e.preventDefault();
      fileDrop.classList.remove('dragging');
      if (!attachInput) return;
      const dt = new DataTransfer();
      // Merge existing + dropped
      Array.from(attachInput.files).forEach(f => dt.items.add(f));
      Array.from(e.dataTransfer.files).forEach(f => dt.items.add(f));
      attachInput.files = dt.files;
      renderFilePreviews(attachInput.files);
    });
  }

  // ── inline validation on blur ──────────────────────────────────────────────
  const nameInput = reportForm.querySelector('[name="victimName"]');
  if (nameInput) {
    nameInput.addEventListener('blur', () => {
      if (!nameInput.value.trim()) setFieldError('victimName', 'กรุณากรอกชื่อผู้เสียชีวิต');
      else clearFieldError('victimName');
      setProgress(nameInput.value.trim() ? 2 : 1);
    });
    nameInput.addEventListener('input', () => {
      if (nameInput.value.trim()) clearFieldError('victimName');
    });
  }

  const idInput = reportForm.querySelector('[name="reporterIdCard"]');
  if (idInput) {
    idInput.addEventListener('input', () => {
      idInput.value = idInput.value.replace(/\D/g, '').slice(0, 13);
      if (idInput.value && !/^\d{13}$/.test(idInput.value)) {
        setFieldError('reporterIdCard', `${idInput.value.length}/13 หลัก`);
      } else {
        clearFieldError('reporterIdCard');
      }
    });
  }

  // Phone — allow digits, dashes, spaces, +, () — 7–20 chars
  const phoneInput = reportForm.querySelector('[name="reporterPhone"]');
  if (phoneInput) {
    phoneInput.addEventListener('blur', () => {
      const v = phoneInput.value.trim();
      if (v && !/^[0-9\-+\s()]{7,20}$/.test(v)) {
        setFieldError('reporterPhone', 'รูปแบบเบอร์โทรไม่ถูกต้อง (7–20 ตัวอักษร)');
      } else {
        clearFieldError('reporterPhone');
      }
    });
    phoneInput.addEventListener('input', () => {
      if (/^[0-9\-+\s()]{0,20}$/.test(phoneInput.value)) {
        clearFieldError('reporterPhone');
      }
    });
  }

  // ── success modal buttons ──────────────────────────────────────────────────
  if (successCloseBtn) successCloseBtn.addEventListener('click', hideSuccessModal);
  if (successViewBtn) {
    successViewBtn.addEventListener('click', () => {
      hideSuccessModal();
      // Focus the map view tab
      const mapBtn = document.querySelector('.view-btn[data-view="map"]');
      if (mapBtn) mapBtn.click();
    });
  }
  if (successModal) {
    successModal.addEventListener('click', e => {
      if (e.target === successModal) hideSuccessModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !successModal.classList.contains('hidden')) hideSuccessModal();
    });
  }

  // ── form submit ────────────────────────────────────────────────────────────
  reportForm.addEventListener('submit', async e => {
    e.preventDefault();
    const isEdit = !!editIdInput.value;

    if (!validateForm()) return;

    const formData = new FormData(reportForm);
    setLoading(true, isEdit);

    try {
      if (isEdit) {
        const id    = editIdInput.value;
        const token = _getToken();
        const result = await updatePoint(id, formData, token);
        if (result && result.status === 'unauthorized') {
          showToast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'error');
          resetForm();
          return;
        }
        _onUpdated(result);
        resetForm();
        showToast('แก้ไขรายงานเรียบร้อยแล้ว', 'success');
      } else {
        const point = await createPoint(formData);
        _onCreated(point);
        resetForm();
        showSuccessModal(point);
      }
    } catch (err) {
      showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
    } finally {
      setLoading(false, isEdit);
    }
  });

  // ── return the map-click handler ───────────────────────────────────────────
  return function onMapClicked(e) {
    if (editIdInput.value) return;   // don't override an active edit
    openCreateForm(e.latlng.lat, e.latlng.lng);
  };
}
