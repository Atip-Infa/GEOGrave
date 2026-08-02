#!/usr/bin/env node
// ETL: legacy JSON-file store -> SQLite.
//
// Usage: node scripts/migrate-json-to-sqlite.js [path/to/points.json] [--dry-run]
// Defaults to <GEOGRAVE_DATA_DIR or backend/data>/points.json
//
// This is a genuine one-time data-ingestion job, not just a formality: it
// validates each legacy record independently (a malformed row doesn't
// abort the whole batch - it's logged and skipped), skips records whose id
// already exists in the target table (safe to re-run / resume), and wraps
// each record in a transaction so a crash mid-run can't leave a partial
// report (report row without its attachments, or vice versa) behind.
//
// --dry-run: validates every record and reports exactly what WOULD happen
// (migrated/skipped/error counts, and which specific records would fail)
// without writing anything to the database. Standard practice for any
// batch data-ingestion job before running it for real against production
// data - this was previously missing entirely.

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sourcePath = args.find(a => !a.startsWith('--'))
  || path.join(process.env.GEOGRAVE_DATA_DIR || path.join(__dirname, '..', 'data'), 'points.json');

const { getDb } = require('../lib/db/connection');
const reportsRepo = require('../lib/db/reports-repo');

function isValidRecord(r) {
  if (!r || typeof r !== 'object') return 'not an object';
  if (typeof r.id !== 'string') return 'missing/invalid id';
  if (typeof r.lat !== 'number' || r.lat < -90 || r.lat > 90) return 'invalid lat';
  if (typeof r.lng !== 'number' || r.lng < -180 || r.lng > 180) return 'invalid lng';
  if (!r.victimName || typeof r.victimName !== 'string') return 'missing victimName';
  return null;
}

function run({ dryRun: isDryRun = false } = {}) {
  if (!fs.existsSync(sourcePath)) {
    console.log(`No legacy data file found at ${sourcePath} - nothing to migrate.`);
    return { migrated: 0, skipped: 0, errors: 0, details: [] };
  }

  const raw = fs.readFileSync(sourcePath, 'utf-8');
  let records;
  try {
    records = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Source file is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(records)) {
    throw new Error('Expected the source file to contain a JSON array of report records.');
  }

  const db = getDb();
  const existingIds = new Set(db.prepare('SELECT id FROM reports').all().map(r => r.id));

  let migrated = 0, skipped = 0, errors = 0;
  const details = [];

  const insertReport = isDryRun ? null : db.prepare(`
    INSERT INTO reports (
      id, lat, lng, victim_name, victim_age, victim_gender, cause_of_death,
      reported_date, reported_time, location_of_death, destination_temple,
      reported_by, reporter_id_card, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAttachment = isDryRun ? null : db.prepare('INSERT INTO attachments (id, report_id, filename, url) VALUES (?, ?, ?, ?)');

  for (const record of records) {
    if (existingIds.has(record && record.id)) {
      skipped++;
      details.push({ id: record && record.id, action: 'skip', reason: 'already migrated' });
      continue;
    }

    const problem = isValidRecord(record);
    if (problem) {
      console.warn(`${isDryRun ? '[dry-run] would skip' : 'Skipping'} record ${record && record.id || '(no id)'}: ${problem}`);
      errors++;
      details.push({ id: record && record.id, action: 'error', reason: problem });
      continue;
    }

    if (isDryRun) {
      migrated++;
      details.push({ id: record.id, action: 'migrate' });
      continue;
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      insertReport.run(
        record.id, record.lat, record.lng, record.victimName,
        record.victimAge === '' || record.victimAge === undefined ? null : Number(record.victimAge),
        record.victimGender || null, record.causeOfDeath || null, record.reportedDate || null,
        record.reportedTime || null, record.locationOfDeath || null, record.destinationTemple || null,
        record.reportedBy || null, record.reporterIdCard || null,
        record.createdAt || new Date().toISOString()
      );
      for (const att of (record.attachments || [])) {
        insertAttachment.run(randomUUID(), record.id, att.filename, att.url);
      }
      db.exec('COMMIT');
      migrated++;
      details.push({ id: record.id, action: 'migrate' });
    } catch (e) {
      db.exec('ROLLBACK');
      console.warn(`Skipping record ${record.id}: ${e.message}`);
      errors++;
      details.push({ id: record.id, action: 'error', reason: e.message });
    }
  }

  if (!isDryRun) reportsRepo.invalidateStatsCache();
  return { migrated, skipped, errors, details };
}

if (require.main === module) {
  const result = run({ dryRun });
  console.log(`--- ETL summary${dryRun ? ' (DRY RUN - nothing was written)' : ''} ---`);
  console.log(`${dryRun ? 'Would migrate' : 'Migrated'}: ${result.migrated}`);
  console.log(`Skipped (already present): ${result.skipped}`);
  console.log(`Errors (invalid records): ${result.errors}`);
  if (dryRun && result.errors > 0) {
    console.log('\nRecords that would fail:');
    result.details.filter(d => d.action === 'error').forEach(d => console.log(`  - ${d.id || '(no id)'}: ${d.reason}`));
  }
}

module.exports = { run };
