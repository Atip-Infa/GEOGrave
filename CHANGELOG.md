# Changelog

All notable changes to GEOGrave are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Fixed
- Removed `uuid` package dependency from `lib/upload.js` — replaced with Node's built-in `crypto.randomUUID()`, eliminating a moderate severity advisory (GHSA-w5hq-g745-h8pq). The project already used `crypto.randomUUID()` everywhere else; `uuid` was the sole remaining call site.
- `listAll()` now orders results by `created_at DESC` (newest-first) instead of `rowid ASC` (oldest-first), making it consistent with the stats dashboard and user expectation for an incident log.
- `update()` no longer issues a database write when called with an empty body and no new files — previously it unconditionally ran `UPDATE SET updated_at = now()`, silently bumping `updated_at` for a no-op request. Now returns the existing record without touching the database.
- Hoisted `require('crypto')` in `scripts/migrate-json-to-sqlite.js` and `lib/db/users-repo.js` from inline call sites to top-level imports.
- Pinned Dockerfile base image from `node:22-alpine` to `node:22.15-alpine3.21` to prevent silent base image drift.
- Switched Dockerfile `npm install --omit=dev` to `npm ci --omit=dev` for reproducible container builds.
- Added `read_only: true` and `/tmp` tmpfs to `docker-compose.yml` so the container filesystem is read-only except for the two volume-mounted directories.

---

## [1.1.0] — 2025-07-01

### Added

- **R-Tree spatial index** on `(lat, lng)` — `GET /api/points/near` now uses a two-phase indexed bounding-box prefilter + haversine recheck instead of a full table scan. Same strategy PostGIS uses internally for KNN/radius queries.
- **`GET /api/points/near`** endpoint: returns reports within a configurable `radius_km`, sorted nearest-first, each annotated with `distanceKm`.
- **Optional pagination** on `GET /api/points` via `?limit=&offset=` query params. Total count returned in `X-Total-Count` response header.
- **`EXPLAIN QUERY PLAN` assertions** in `tests/db.test.js` — CI now verifies that declared indexes are actually used by the query planner, not just that they were created.
- **N+1 elimination** for attachment fetching: `listAll()` and `findNear()` now batch all attachment lookups into a single query regardless of result set size. Regression test included.
- **Prepared statement cache** (`lib/db/prepared-cache.js`): each distinct SQL string is parsed and planned once per connection and reused on subsequent calls.
- **Cache-aside** for `GET /api/stats`: in-process cache with explicit invalidation on every write plus a 30 s TTL safety net.
- **ETL dry-run mode**: `npm run migrate:json-to-sqlite -- --dry-run` previews the migration without writing anything.
- **Non-blocking backup** via `VACUUM INTO` (`npm run db:backup`). Documents restore procedure in script header.
- **Data quality audit script** (`npm run db:quality-check`): read-only post-ingestion profiling for missing fields, duplicate coordinates/names, malformed IDs, and orphaned attachments.
- **`schema_migrations` table**: migration system now tracks applied versions and is safe to re-run on an existing database.
- **`002_updated_at_trigger` migration**: `reports.updated_at` is now maintained by a database-level trigger as the authoritative source of truth, in addition to application-level code.
- **Healthcheck enrichment**: `GET /healthz` now executes a real DB query and returns `reportCount` and `sizeKb` — not just a process-alive check.
- **Slow-request logging**: structured JSON warning emitted for any request exceeding 200 ms (CloudWatch/Datadog friendly).
- **Rate limiting** on all `/api/` routes; tighter limits on `/api/auth/login` and `POST /api/points`.
- **Helmet CSP** configured for Leaflet CDN assets (cdnjs, OSM tiles, CartoCDN, Google Fonts).
- **JWT algorithm pinning** (HS256 explicit): protects against algorithm-confusion attacks including `alg: none` tokens. Regression test included in `tests/api.test.js`.
- **Null-island rejection** implemented (was previously documented but not enforced): `(0, 0)` is now rejected at both the API layer (express-validator) and the database layer (CHECK constraint).
- **Orphaned upload cleanup**: files written by Multer before a validation failure are now deleted before responding with 400. Regression test included.
- **Docker Compose** `healthcheck` directive synced with Dockerfile `HEALTHCHECK`.
- CI matrix extended to Node 24.

### Changed

- Database layer rewritten from a hand-rolled in-process JSON file store to SQLite via the built-in `node:sqlite` module (WAL mode, foreign keys, CHECK constraints, proper ACID transactions).
- `reports` and `attachments` normalized into separate tables with `ON DELETE CASCADE` — no more manual attachment cleanup on report deletion.
- Column names are snake_case in the database; `reports-repo.js#toApiShape` is the single mapping point to the camelCase API contract.
- `ADMIN_PASSWORD` behaviour clarified: blank triggers a generated one-time password printed to the log on first boot only.

### Fixed

- Login with an unknown username previously crashed the server (unhandled `null` user reference). Now correctly returns 401. Regression test added.
- `updated_at` was only set by application code — a direct DB write or admin console edit would leave it stale. Fixed by the trigger in migration 002.
- Attachment lookup inside `listAll()` was N+1 (one query per report). Fixed and tested.
- `GET /api/points/near` path segment `near` was vulnerable to being matched as an `:id` param due to route registration order. Fixed; regression test added.

---

## [1.0.0] — 2024-10-01

### Added

- Initial release: map-based incident reporting with Leaflet.js, Express backend, JSON file store.
- Staff authentication with JWT.
- File attachment uploads.
- Home page stats dashboard.
- Docker packaging.

[Unreleased]: https://github.com/Atip-Infa/geograve/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Atip-Infa/geograve/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Atip-Infa/geograve/releases/tag/v1.0.0
