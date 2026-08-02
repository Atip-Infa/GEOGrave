/**
 * api.js — typed fetch wrappers for every backend endpoint.
 *
 * Network-level failures (no internet, DNS failure, server unreachable)
 * throw a TypeError with a Thai-language message so callers can surface
 * it directly in a toast without string-matching English fetch errors.
 */

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Wraps fetch() to produce a consistent Thai error on network failure. */
async function safeFetch(url, options = {}) {
  try {
    return await fetch(url, options);
  } catch (_) {
    throw new Error('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');
  }
}

export async function login(username, password) {
  const res = await safeFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'เข้าสู่ระบบไม่สำเร็จ');
  return data; // { token, username, expiresIn }
}

export async function fetchPoints(token) {
  const res = await safeFetch('/api/points', { headers: authHeaders(token) });
  if (!res.ok) throw new Error('ไม่สามารถโหลดรายการรายงานได้');
  return res.json();
}

export async function fetchStats() {
  const res = await safeFetch('/api/stats');
  if (!res.ok) throw new Error('ไม่สามารถโหลดสถิติได้');
  return res.json();
}

export async function fetchNearby(lat, lng, radiusKm, token) {
  const params = new URLSearchParams({ lat, lng, radius_km: radiusKm });
  const res = await safeFetch(`/api/points/near?${params}`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error('ไม่สามารถค้นหาจุดใกล้เคียงได้');
  return res.json(); // { center, radiusKm, count, points }
}

export async function createPoint(formData) {
  const res = await safeFetch('/api/points', { method: 'POST', body: formData });
  const point = await res.json();
  if (!res.ok) {
    const detail = point?.details?.map(d => d.message).join(', ') ?? point?.error;
    throw new Error(detail || 'ไม่สามารถบันทึกรายงานได้');
  }
  return point;
}

export async function updatePoint(id, formData, token) {
  const res = await safeFetch(`/api/points/${id}`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: formData,
  });
  const point = await res.json();
  if (res.status === 401) return { status: 'unauthorized' };
  if (!res.ok) {
    const detail = point?.details?.map(d => d.message).join(', ') ?? point?.error;
    throw new Error(detail || 'ไม่สามารถแก้ไขรายงานได้');
  }
  return point;
}

// Returns 'deleted' | 'unauthorized' | throws on any other failure, so the
// caller can react to session expiry without string-matching error text.
export async function deletePoint(id, token) {
  const res = await safeFetch(`/api/points/${id}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (res.status === 401) return 'unauthorized';
  if (!res.ok && res.status !== 204) throw new Error('ไม่สามารถลบรายงานได้');
  return 'deleted';
}
