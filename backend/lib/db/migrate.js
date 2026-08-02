// DATABASE MIGRATIONS: numbered .sql files in migrations/ are the single
// source of truth for schema changes, applied in filename order, each
// exactly once. A `schema_migrations` table tracks what's already been
// applied so re-running this on an existing database is a safe no-op -
// the same mechanism tools like Flyway/Alembic/Knex use, implemented here
// directly since no ORM/migration framework is otherwise in this project.

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);
}

function getAppliedVersions(db) {
  const rows = db.prepare('SELECT version FROM schema_migrations').all();
  return new Set(rows.map(r => r.version));
}

/** Applies every pending migration in migrations/, in filename order. Returns the list of versions applied (empty if already up to date). */
function runMigrations(db) {
  ensureMigrationsTable(db);
  const applied = getAppliedVersions(db);

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort(); // "001_init.sql" < "002_xyz.sql" - zero-padded numeric prefixes sort correctly as strings

  const newlyApplied = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
      db.exec('COMMIT');
      newlyApplied.push(version);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${version} failed and was rolled back: ${e.message}`);
    }
  }
  return newlyApplied;
}

module.exports = { runMigrations, getAppliedVersions };
