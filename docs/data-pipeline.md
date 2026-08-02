# Data Pipeline

GEOGrave ships four operational scripts that together form a lightweight data pipeline: ETL from a legacy data source, development seeding, consistent backup, and post-ingestion data quality auditing. This document describes each script in detail.

---

## Table of Contents

- [Overview](#overview)
- [ETL: JSON to SQLite migration](#etl-json-to-sqlite-migration)
- [Seed: development and demo data](#seed-development-and-demo-data)
- [Backup: consistent database snapshots](#backup-consistent-database-snapshots)
- [Data quality check: post-ingestion audit](#data-quality-check-post-ingestion-audit)
- [Pipeline design patterns used](#pipeline-design-patterns-used)

---

## Overview

```
Legacy data source           Development / demo
(data/points.json)           (synthetic Thai locations)
        │                            │
        ▼                            ▼
migrate-json-to-sqlite.js       seed.js
  (ETL: validate, transform,    (generates N realistic
   idempotent load)              records clustered around
        │                        real Thai cities/highways)
        ▼                            ▼
                    ┌──────────────────────────┐
                    │  SQLite (geograve.db)     │
                    │  reports + attachments    │
                    └──────────────┬───────────┘
                                   │
                    ┌──────────────┴───────────────────────┐
                    │                                       │
                    ▼                                       ▼
              backup.js                       data-quality-check.js
         (VACUUM INTO snapshot,          (read-only audit: missing fields,
          non-blocking, restorable)       duplicates, malformed IDs,
                                          orphaned attachments)
```

All scripts are in `backend/scripts/` and run from the `backend/` directory. The database connection, migration runner, and repository layer are shared with the main application.

---

## ETL: JSON to SQLite migration

**Script:** `backend/scripts/migrate-json-to-sqlite.js`  
**Command:** `npm run migrate:json-to-sqlite`

### Purpose

One-time migration from the application's original data storage format (a flat JSON array in `data/points.json`) to the normalised SQLite schema. This is a genuine data engineering task, not a stub: the legacy format embedded attachments inside each report record, used no schema constraints, and had no transaction support.

### Usage

```bash
# Preview what would happen — validates all records without writing anything
npm run migrate:json-to-sqlite -- --dry-run

# Run the migration for real
npm run migrate:json-to-sqlite

# Specify a non-default source file
npm run migrate:json-to-sqlite -- /path/to/points.json
```

### Dry-run output example

```
[dry-run] would skip record abc-123: already migrated
[dry-run] would skip record def-456: invalid lat
--- ETL summary (DRY RUN - nothing was written) ---
Would migrate: 47
Skipped (already present): 3
Errors (invalid records): 2

Records that would fail:
  - def-456: invalid lat
  - (no id): not an object
```

### Design decisions

**Per-record error isolation.** A malformed record does not abort the batch — it is logged and skipped. This matches the reality of legacy data: one bad row should not block migration of the 999 valid rows around it.

**Idempotency.** The script checks `reports.id` against existing rows before inserting. Running the script a second time (e.g. after adding new records to the legacy file, or after a partial run interrupted by a crash) skips already-migrated records and processes only the new ones.

**Dry-run by default in unfamiliar environments.** `--dry-run` validates every record and reports exactly what would happen — migrated count, skipped count, error count, and which specific records would fail — without writing a single byte. This is standard practice for any batch data-ingestion job before it runs against production data.

**Transaction per record.** Each record is wrapped in `BEGIN IMMEDIATE` / `COMMIT`. A crash mid-run cannot leave a partial report (report row present but its attachments missing, or vice versa).

**Validation rules** applied to each legacy record:

| Field | Rule |
|---|---|
| `id` | Must be a non-empty string |
| `lat` | Must be a number in [-90, 90] |
| `lng` | Must be a number in [-180, 180] |
| `victimName` | Must be a non-empty string |

Records failing validation are logged and counted as errors; all other records continue processing.

### Source format

Expected input (`data/points.json`): a JSON array of report objects. The format mirrors the API's response shape (camelCase), as the legacy store was the raw JSON the API once returned directly.

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "lat": 13.7563,
    "lng": 100.5018,
    "victimName": "Example",
    "victimAge": 45,
    "victimGender": "ชาย",
    "causeOfDeath": "อุบัติเหตุจราจร",
    "reportedDate": "2024-06-15",
    "createdAt": "2024-06-15T07:30:00.000Z",
    "attachments": [
      { "filename": "photo.jpg", "url": "/uploads/photo.jpg" }
    ]
  }
]
```

If no `data/points.json` file exists, the script exits cleanly with no action taken.

---

## Seed: development and demo data

**Script:** `backend/scripts/seed.js`  
**Command:** `npm run db:seed`

### Purpose

Populates the database with realistic sample reports for local development and demos. Seed data is specifically designed to make the spatial search feature (`GET /api/points/near`) meaningful: coordinates are clustered around real Thai cities and highways with small random jitter, not scattered randomly across the globe.

### Usage

```bash
npm run db:seed           # 20 reports (default)
npm run db:seed -- 50     # custom count
```

### Sample locations

Reports are distributed around these real locations:

| Location | Approx. coordinates |
|---|---|
| ถนนพหลโยธิน กรุงเทพฯ | 13.862, 100.559 |
| ถนนสุขุมวิท กรุงเทพฯ | 13.737, 100.561 |
| ถนนมิตรภาพ นครราชสีมา | 14.980, 102.098 |
| ถนนเอเชีย อยุธยา | 14.353, 100.568 |
| ถนนซุปเปอร์ไฮเวย์ เชียงใหม่ | 18.788, 98.985 |
| ถนนเพชรเกษม ราชบุรี | 13.528, 99.813 |
| ถนนสายเอเชีย พิษณุโลก | 16.821, 100.266 |
| ถนนสุขาภิบาล ชลบุรี | 13.361, 100.985 |

Each coordinate has a small random jitter (±0.025°, roughly ±2.8 km) so seeded reports are not all stacked on the same point.

### Important

Never run `npm run db:seed` against a production database. It inserts clearly fake data (`ผู้เสียชีวิตทดสอบ #1`, `เจ้าหน้าที่ทดสอบ`) for development purposes only.

---

## Backup: consistent database snapshots

**Script:** `backend/scripts/backup.js`  
**Command:** `npm run db:backup`

### Purpose

Produce a complete, consistent, restorable snapshot of the database without blocking reads or writes on the live database.

### Usage

```bash
npm run db:backup                    # output: backend/data/backups/geograve-<timestamp>.db
npm run db:backup -- /mnt/backups    # custom output directory
```

### Output

Each backup is a complete, valid SQLite database file named with an ISO 8601 timestamp:

```
geograve-2025-07-01T12-00-00-000Z.db   (2048.0 KB)
```

### How it works

```sql
VACUUM INTO '/path/to/backup.db'
```

`VACUUM INTO` writes a complete, compacted copy of the database to a new file in a single atomic operation. The key property is that **readers and writers on the live database are not blocked** — the backup runs alongside normal traffic.

This is distinct from a naive `cp data/geograve.db backup.db`: a file copy during a write operation can capture a partially-written page and produce a corrupt backup. `VACUUM INTO` is the SQLite equivalent of PostgreSQL's `pg_basebackup`.

### Restore procedure

1. Stop the application (`docker compose down` or `systemctl stop geograve`).
2. Replace `backend/data/geograve.db` with the backup file.
3. Start the application.

No special restore command is needed. A `VACUUM INTO` backup is a fully valid SQLite database file.

### Recommended schedule

See [docs/deployment.md — Backup schedule](deployment.md#backup-schedule) for cron setup and off-host shipping recommendations.

---

## Data quality check: post-ingestion audit

**Script:** `backend/scripts/data-quality-check.js`  
**Command:** `npm run db:quality-check`

### Purpose

Audit the data already in the database for quality issues that write-time validation cannot catch: rows that were inserted before validation was tightened, data from a bulk import job, or fields that slipped through earlier in the app's history.

This is a **read-only** script. It reports findings and exits — it does not modify any data.

### Usage

```bash
npm run db:quality-check
```

### Example output

```
3 data quality finding(s):

[INFO] missing_cause_of_death (12): Reports with no cause of death recorded.
[WARN] duplicate_coordinates (2): 2 coordinate pair(s) used by more than one report - possible duplicate submissions.
  examples: [{"lat":13.7563,"lng":100.5018,"c":3},{"lat":13.8622,"lng":100.5591,"c":2}]
[WARN] duplicate_victim_name (1): 1 victim name(s) appear on more than one report.
  examples: ["สมชาย ใจดี"]
```

If no issues are found:

```
No data quality issues found.
```

### Checks performed

| Check | Severity | Description |
|---|---|---|
| `missing_cause_of_death` | INFO | Reports where `cause_of_death` is null or empty |
| `missing_location` | INFO | Reports where `location_of_death` is null or empty |
| `no_attachments` | INFO | Reports with zero supporting attachment files |
| `duplicate_coordinates` | WARN | Coordinate pairs used by more than one report — possible double-submissions |
| `duplicate_victim_name` | WARN | Victim names appearing on multiple reports |
| `malformed_id_card` | ERROR | `reporter_id_card` values that are not exactly 13 digits (should be impossible with current validation, but audits data that predates it) |
| `orphaned_attachments` | ERROR | Attachment rows with no matching report (should be impossible with `ON DELETE CASCADE`, but would indicate a data integrity bug) |

### Severity levels

| Level | Meaning |
|---|---|
| INFO | Completeness gaps worth noting; normal in operational data |
| WARN | Possible data quality issue requiring human review |
| ERROR | Structural integrity problem requiring investigation |

### Design notes

Write-time validation (express-validator + CHECK constraints) is the first line of defense against bad data entering the system. The quality check is the second line: it audits what is *already there* — from earlier, looser schema versions, bulk imports, or direct database writes. The separation between "prevent bad writes" and "audit existing data" is intentional; conflating them would make this script modify data it is only supposed to report on.

---

## Pipeline design patterns used

| Pattern | Script | Implementation |
|---|---|---|
| Dry-run mode | `migrate-json-to-sqlite.js` | `--dry-run` flag; validates everything, writes nothing |
| Idempotent loads | `migrate-json-to-sqlite.js` | ID existence check before each insert; safe to re-run |
| Per-record error isolation | `migrate-json-to-sqlite.js` | `try/catch` + `ROLLBACK` per record; one bad row doesn't abort the batch |
| Transactional writes | `migrate-json-to-sqlite.js` | `BEGIN IMMEDIATE` / `COMMIT` per record |
| Non-blocking backup | `backup.js` | `VACUUM INTO` — readers/writers not paused |
| Read-only audit | `data-quality-check.js` | No writes; reports findings only |
| Realistic test data | `seed.js` | Real geographic coordinates + jitter for spatial search demos |
| Cache invalidation after ETL | `migrate-json-to-sqlite.js` | Calls `reportsRepo.invalidateStatsCache()` after all inserts |
