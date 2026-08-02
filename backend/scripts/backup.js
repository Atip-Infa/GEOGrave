#!/usr/bin/env node
// BACKUP & RECOVERY
//
// Usage: node scripts/backup.js [output-dir]
// Defaults to <GEOGRAVE_DATA_DIR or backend/data>/backups/
//
// Uses SQLite's `VACUUM INTO`, which produces a complete, consistent
// snapshot of the database in one atomic operation - readers and writers
// on the live database are not blocked while it runs (unlike a naive
// `cp` of the .db file, which can copy a half-written page and produce a
// corrupt backup if a write is in progress). This is the SQLite
// equivalent of `pg_dump`/`pg_basebackup` for this project's scale.
//
// RESTORE: to restore from a backup, stop the app, replace
// data/geograve.db with the backup file, and start the app again - no
// special restore command needed since a VACUUM INTO backup is already a
// complete, valid SQLite database file.
//
// RECOMMENDED SCHEDULE: run this on a cron/systemd timer (e.g. hourly or
// daily depending on write volume) and ship the output directory to
// off-host storage (S3, etc.) - a backup that only lives on the same disk
// as the live database doesn't protect against disk/host failure.

const fs = require('fs');
const path = require('path');
const { getDb } = require('../lib/db/connection');

const dataDir = process.env.GEOGRAVE_DATA_DIR || path.join(__dirname, '..', 'data');
const outputDir = process.argv[2] || path.join(dataDir, 'backups');

function run() {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputFile = path.join(outputDir, `geograve-${timestamp}.db`);

  const db = getDb();
  db.exec(`VACUUM INTO '${outputFile.replace(/'/g, "''")}'`);

  const sizeKb = (fs.statSync(outputFile).size / 1024).toFixed(1);
  console.log(`Backup written to ${outputFile} (${sizeKb} KB)`);
  return outputFile;
}

if (require.main === module) {
  run();
}

module.exports = { run };
