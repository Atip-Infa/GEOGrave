-- Migration 001: initial schema
--
-- DATA MODELING NOTES:
-- - `reports` and `attachments` are normalized 1:N (the JSON-file version
--   embedded attachments as an array inside each report record, which
--   meant "delete a report" required manually remembering to clean up its
--   files - a foreign key with ON DELETE CASCADE now makes that a DB
--   guarantee instead of an application-code responsibility).
-- - Column names are snake_case (SQL convention); the repository layer
--   (lib/db/reports-repo.js) maps to/from the camelCase API contract the
--   frontend already expects, so this migration is invisible to clients.
-- - CHECK constraints duplicate some of what express-validator already
--   enforces at the API layer (lat/lng bounds, null-island rejection, age
--   range). This is deliberate defense-in-depth: the application layer is
--   not the only thing that can write to this table (a future batch
--   import job, an admin SQL console, a bug in a new endpoint) and the
--   database should refuse invalid data regardless of how it arrives.

CREATE TABLE IF NOT EXISTS reports (
  id                  TEXT PRIMARY KEY,
  lat                 REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng                 REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
  victim_name         TEXT NOT NULL CHECK (length(victim_name) BETWEEN 1 AND 200),
  victim_age          INTEGER CHECK (victim_age IS NULL OR victim_age BETWEEN 0 AND 150),
  victim_gender       TEXT,
  cause_of_death      TEXT,
  reported_date       TEXT,
  reported_time       TEXT,
  location_of_death   TEXT,
  destination_temple  TEXT,
  reported_by         TEXT,
  reporter_id_card    TEXT CHECK (reporter_id_card IS NULL OR reporter_id_card GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT,
  CHECK (NOT (lat = 0 AND lng = 0)) -- "null island" - same rule the API layer enforces
);

CREATE TABLE IF NOT EXISTS attachments (
  id          TEXT PRIMARY KEY,
  report_id   TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  url         TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS users (
  username       TEXT PRIMARY KEY,
  password_hash  TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- INDEXING STRATEGY:
-- - created_at DESC: the home dashboard's "5 most recent reports" query and
--   any future paginated/sorted listing both filter-sort on this.
-- - victim_name: supports the search feature and is the most common lookup
--   field mentioned in the UI's search box.
-- - attachments.report_id: every attachment fetch is "give me the files for
--   report X" - without this index that's a full table scan per report.
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_victim_name ON reports(victim_name);
CREATE INDEX IF NOT EXISTS idx_attachments_report_id ON attachments(report_id);

-- SPATIAL INDEXING (the equivalent of a PostGIS GiST index on `geography`):
-- SQLite's R-Tree module indexes bounding boxes, not exact coordinates, and
-- its id column must be an integer - so it's keyed on `reports`.rowid (the
-- implicit integer rowid every non-WITHOUT-ROWID table has), not the
-- public TEXT uuid `id`. A radius search first does an indexed bounding-box
-- lookup here (fast - O(log n)) to narrow candidates, then applies exact
-- haversine distance filtering in application code only to that small
-- candidate set (see lib/geo.js + lib/db/reports-repo.js#findNear) -
-- functionally the same "index prefilter, then exact recheck" strategy
-- PostGIS itself uses internally for KNN/radius queries.
CREATE VIRTUAL TABLE IF NOT EXISTS reports_rtree USING rtree(
  id,       -- reports.rowid
  min_lat, max_lat,
  min_lng, max_lng
);

-- Triggers keep the R-Tree index consistent with `reports` automatically,
-- so callers never have to remember to maintain it by hand (a common
-- source of silently-stale spatial indexes in hand-rolled systems).
CREATE TRIGGER IF NOT EXISTS reports_rtree_insert AFTER INSERT ON reports BEGIN
  INSERT INTO reports_rtree (id, min_lat, max_lat, min_lng, max_lng)
  VALUES (new.rowid, new.lat, new.lat, new.lng, new.lng);
END;

CREATE TRIGGER IF NOT EXISTS reports_rtree_update AFTER UPDATE OF lat, lng ON reports BEGIN
  UPDATE reports_rtree SET min_lat = new.lat, max_lat = new.lat, min_lng = new.lng, max_lng = new.lng
  WHERE id = new.rowid;
END;

CREATE TRIGGER IF NOT EXISTS reports_rtree_delete AFTER DELETE ON reports BEGIN
  DELETE FROM reports_rtree WHERE id = old.rowid;
END;
