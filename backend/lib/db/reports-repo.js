const { randomUUID } = require('crypto');
const { getDb } = require('./connection');
const { haversineDistanceKm } = require('../geo');
const { prep } = require('./prepared-cache');

// QUERY OPTIMIZATION: node:sqlite's db.prepare() re-parses and re-plans the
// SQL text every time it's called, even for an identical query string -
// the previous version called db.prepare(...) fresh inside every function
// invocation, including inside per-row loops. prep() (shared across
// repository modules - see prepared-cache.js) caches each prepared
// statement per-connection, so each distinct query is parsed/planned once
// and reused for the life of the connection, not once per call.

// Maps a DB row (snake_case) + its attachments to the camelCase shape the
// API/frontend already expect - this is the only place that translation
// happens, so the storage schema is free to evolve without touching
// server.js or the client.
function toApiShape(row, attachments) {
  return {
    id: row.id,
    lat: row.lat,
    lng: row.lng,
    victimName: row.victim_name,
    victimAge: row.victim_age === null ? '' : row.victim_age,
    victimGender: row.victim_gender || '',
    causeOfDeath: row.cause_of_death || '',
    reportedDate: row.reported_date || '',
    reportedTime: row.reported_time || '',
    locationOfDeath: row.location_of_death || '',
    destinationTemple: row.destination_temple || '',
    reportedBy: row.reported_by || '',
    reporterPhone: row.reporter_phone || '',
    reporterIdCard: row.reporter_id_card || '',
    attachments: attachments || [],
    createdAt: row.created_at,
    ...(row.updated_at ? { updatedAt: row.updated_at } : {})
  };
}

function attachmentsFor(db, reportId) {
  return prep(db, 'SELECT id, filename, url FROM attachments WHERE report_id = ? ORDER BY created_at ASC')
    .all(reportId)
    .map(a => ({ id: a.id, filename: a.filename, url: a.url }));
}

// SCALABILITY / QUERY OPTIMIZATION (N+1 fix): the previous version called
// attachmentsFor() once PER report row inside listAll()/findNear()'s
// .map() - listing 1,000 reports meant 1 query for the reports plus 1,000
// separate queries for their attachments. This fetches every attachment
// for the whole result set in a single indexed query (uses
// idx_attachments_report_id), then groups them in JS - 2 queries total
// regardless of how many reports are being listed.
function attachmentsForMany(db, reportIds) {
  const grouped = new Map(reportIds.map(id => [id, []]));
  if (!reportIds.length) return grouped;

  const placeholders = reportIds.map(() => '?').join(',');
  // Not cached via prep() - the placeholder count varies with result set
  // size, so this exact SQL text changes per call and caching it would
  // just leak an ever-growing set of one-use prepared statements.
  const rows = db.prepare(
    `SELECT id, report_id, filename, url FROM attachments WHERE report_id IN (${placeholders}) ORDER BY created_at ASC`
  ).all(...reportIds);

  for (const a of rows) {
    grouped.get(a.report_id).push({ id: a.id, filename: a.filename, url: a.url });
  }
  return grouped;
}

function rowsToApiShape(db, rows) {
  const attachmentsByReport = attachmentsForMany(db, rows.map(r => r.id));
  return rows.map(row => toApiShape(row, attachmentsByReport.get(row.id)));
}

function insertAttachments(db, reportId, files) {
  if (!files || !files.length) return;
  const insert = prep(db, 'INSERT INTO attachments (id, report_id, filename, url) VALUES (?, ?, ?, ?)');
  for (const f of files) {
    insert.run(randomUUID(), reportId, f.filename, f.url);
  }
}

// ---------- CACHING STRATEGY ----------
// GET /api/stats aggregates over every row (COUNT, GROUP BY, ORDER BY) on
// every request even though the underlying data only changes on a write -
// a classic cache-aside candidate. Cached in-process (no Redis dependency
// needed at this scale) with a short TTL as a safety net, but the real
// invalidation path is explicit: every write below calls invalidateStatsCache()
// so the cache is never more than one request stale after a mutation, and
// the TTL only matters if that call were ever missed.
let statsCache = null;
let statsCacheAt = 0;
const STATS_CACHE_TTL_MS = 30_000;

function invalidateStatsCache() {
  statsCache = null;
}

function listAll({ limit, offset } = {}) {
  const db = getDb();
  const rows = (limit !== undefined)
    ? prep(db, 'SELECT * FROM reports ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset || 0)
    : prep(db, 'SELECT * FROM reports ORDER BY created_at DESC').all();
  return rowsToApiShape(db, rows);
}

function count() {
  return prep(getDb(), 'SELECT COUNT(*) AS c FROM reports').get().c;
}

function findById(id) {
  const db = getDb();
  const row = prep(db, 'SELECT * FROM reports WHERE id = ?').get(id);
  if (!row) return null;
  return toApiShape(row, attachmentsFor(db, id));
}

function create(data, files) {
  const db = getDb();
  const id = randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try {
    prep(db, `
      INSERT INTO reports (
        id, lat, lng, victim_name, victim_age, victim_gender, cause_of_death,
        reported_date, reported_time, location_of_death, destination_temple,
        reported_by, reporter_phone, reporter_id_card
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, data.lat, data.lng, data.victimName,
      data.victimAge === '' || data.victimAge === undefined ? null : Number(data.victimAge),
      data.victimGender || null, data.causeOfDeath || null, data.reportedDate || null,
      data.reportedTime || null, data.locationOfDeath || null, data.destinationTemple || null,
      data.reportedBy || null, data.reporterPhone || null, data.reporterIdCard || null
    );
    insertAttachments(db, id, files);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  invalidateStatsCache();
  return findById(id);
}

function update(id, data, newFiles) {
  const db = getDb();
  const existing = prep(db, 'SELECT id FROM reports WHERE id = ?').get(id);
  if (!existing) return null;

  const fields = {
    victim_name: 'victimName', victim_age: 'victimAge', victim_gender: 'victimGender',
    cause_of_death: 'causeOfDeath', reported_date: 'reportedDate', reported_time: 'reportedTime',
    location_of_death: 'locationOfDeath', destination_temple: 'destinationTemple',
    reported_by: 'reportedBy', reporter_phone: 'reporterPhone',
    reporter_id_card: 'reporterIdCard', lat: 'lat', lng: 'lng'
  };
  const sets = [];
  const values = [];
  for (const [col, apiKey] of Object.entries(fields)) {
    if (data[apiKey] === undefined) continue;
    sets.push(`${col} = ?`);
    values.push(col === 'victim_age' ? (data[apiKey] === '' ? null : Number(data[apiKey])) : data[apiKey]);
  }

  const hasFieldChanges = sets.length > 0;
  const hasNewFiles = newFiles && newFiles.length > 0;

  // Nothing to do — return the existing record without touching the database.
  if (!hasFieldChanges && !hasNewFiles) return findById(id);

  if (hasFieldChanges) {
    // updated_at is ALSO auto-maintained by the trigger in migration 002,
    // but setting it here keeps the UPDATE self-contained rather than
    // relying solely on trigger timing.
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    if (hasFieldChanges) {
      // Not cached via prep(): the SET clause list varies per call
      // depending on which fields were provided in this partial update.
      db.prepare(`UPDATE reports SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
    }
    insertAttachments(db, id, newFiles);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  invalidateStatsCache();
  return findById(id);
}

function remove(id) {
  const db = getDb();
  // ON DELETE CASCADE (declared on attachments.report_id) removes the
  // attachment rows automatically - no application-code cleanup step to
  // forget, unlike the previous JSON-array-embedded-in-record approach.
  const result = prep(db, 'DELETE FROM reports WHERE id = ?').run(id);
  if (result.changes > 0) invalidateStatsCache();
  return result.changes > 0;
}

// SPATIAL QUERY: bounding-box prefilter via the R-Tree index (fast,
// indexed - see migrations/001_init.sql), then exact great-circle distance
// filtering + sorting on just that small candidate set. This is the same
// two-phase strategy PostGIS itself uses under the hood for radius/KNN
// queries (index bounding-box check, then an exact "recheck").
function findNear(lat, lng, radiusKm) {
  const db = getDb();
  const KM_PER_DEGREE_LAT = 111.32;
  const latDelta = radiusKm / KM_PER_DEGREE_LAT;
  // Longitude degrees compress toward the poles; clamp cos() away from 0
  // so this never blows up near lat=±90 (not realistic for this app's
  // Thailand-centric data, but cheap correctness insurance).
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const lngDelta = radiusKm / (KM_PER_DEGREE_LAT * cosLat);

  const candidateRowIds = prep(db, `
    SELECT id FROM reports_rtree
    WHERE min_lat <= ? AND max_lat >= ? AND min_lng <= ? AND max_lng >= ?
  `).all(lat + latDelta, lat - latDelta, lng + lngDelta, lng - lngDelta)
    .map(r => r.id);

  if (!candidateRowIds.length) return [];

  const placeholders = candidateRowIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM reports WHERE rowid IN (${placeholders})`).all(...candidateRowIds);
  const points = rowsToApiShape(db, rows); // batched attachment fetch, not N+1

  // Exact recheck: the bounding box can include points slightly outside
  // the true circular radius (its corners extend past the circle), so
  // haversineDistanceKm() is still the source of truth for both the final
  // filter and the sort order.
  return points
    .map(p => ({ ...p, distanceKm: haversineDistanceKm(lat, lng, p.lat, p.lng) }))
    .filter(p => p.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

function getStats() {
  if (statsCache && Date.now() - statsCacheAt < STATS_CACHE_TTL_MS) {
    return statsCache;
  }
  const db = getDb();
  const total = count();
  const byGenderRows = prep(db, `
    SELECT COALESCE(NULLIF(victim_gender, ''), 'ไม่ทราบ') AS gender, COUNT(*) AS c
    FROM reports GROUP BY gender
  `).all();
  const byGender = Object.fromEntries(byGenderRows.map(r => [r.gender, r.c]));

  const recentRows = prep(db, `
    SELECT id, victim_name, location_of_death, created_at
    FROM reports ORDER BY created_at DESC LIMIT 5
  `).all();
  const recent = recentRows.map(r => ({
    id: r.id, victimName: r.victim_name, locationOfDeath: r.location_of_death || '', createdAt: r.created_at
  }));

  statsCache = { total, byGender, recent };
  statsCacheAt = Date.now();
  return statsCache;
}

module.exports = { listAll, count, findById, create, update, remove, findNear, getStats, invalidateStatsCache };
