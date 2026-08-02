// Shared by every repository module: caches prepared statements per DB
// connection (WeakMap keyed on the connection object itself, so a fresh
// connection - e.g. a new temp database in a test - automatically gets
// its own independent cache with no manual invalidation needed).
const stmtCache = new WeakMap();

function prep(db, sql) {
  let cache = stmtCache.get(db);
  if (!cache) { cache = new Map(); stmtCache.set(db, cache); }
  let stmt = cache.get(sql);
  if (!stmt) { stmt = db.prepare(sql); cache.set(sql, stmt); }
  return stmt;
}

module.exports = { prep };
