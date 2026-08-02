// DATA CONSISTENCY: this replaces the hand-rolled JS write-queue mutex
// (the previous lib/store.js) with SQLite's own ACID transaction support.
// Two things specifically fixed by this that the write-queue could not
// fix on its own:
//   1. WAL (Write-Ahead Logging) mode allows concurrent readers alongside
//      a single writer without blocking reads behind writes - the
//      previous queue serialized ALL reads behind ALL writes, a
//      performance regression flagged in an earlier audit.
//   2. WAL mode is safe across multiple Node processes sharing the same
//      database file on one host (e.g. a process manager running several
//      workers) - the in-process JS mutex only ever protected a single
//      process and silently offered zero protection the moment a second
//      instance was introduced (also flagged in an earlier audit). This
//      does NOT extend to multiple hosts/containers on separate machines -
//      that still needs a real client-server database (PostgreSQL). SQLite
//      here is the right tool for "one host, real ACID guarantees, zero
//      extra infrastructure", not for horizontal multi-host scaling.

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const { runMigrations } = require('./migrate');

let db = null;

function getDb() {
  if (db) return db;

  const dataDir = process.env.GEOGRAVE_DATA_DIR || path.join(__dirname, '..', '..', 'data');
  const dbPath = path.join(dataDir, 'geograve.db');

  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');   // concurrent readers + one writer, not readers-block-writers
  db.exec('PRAGMA foreign_keys = ON');    // OFF by default in SQLite - without this, ON DELETE CASCADE silently does nothing
  db.exec('PRAGMA busy_timeout = 5000');  // wait up to 5s on a lock instead of failing immediately under brief contention

  const applied = runMigrations(db);
  if (applied.length) {
    console.log(`Applied ${applied.length} database migration(s): ${applied.join(', ')}`);
  }

  return db;
}

/** For tests: closes and forgets the cached connection so a fresh one opens against a new path. */
function resetConnectionForTests() {
  if (db) {
    try { db.close(); } catch (e) { /* already closed */ }
  }
  db = null;
}

module.exports = { getDb, resetConnectionForTests };
