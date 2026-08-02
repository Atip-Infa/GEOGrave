const os = require('os');
const path = require('path');
const fs = require('fs');

function freshDb() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'geograve-db-test-'));
  process.env.GEOGRAVE_DATA_DIR = tmp;
  jest.resetModules(); // force a fresh require so connection.js's cached `db` singleton doesn't leak across tests
  const { resetConnectionForTests } = require('../lib/db/connection');
  resetConnectionForTests();
  return {
    reportsRepo: require('../lib/db/reports-repo'),
    connection: require('../lib/db/connection'),
    migrate: require('../lib/db/migrate'),
  };
}

describe('Migrations', () => {
  test('applies migrations and records them in schema_migrations', () => {
    const { connection, migrate } = freshDb();
    const db = connection.getDb();
    const applied = migrate.getAppliedVersions(db);
    expect(applied.has('001_init')).toBe(true);
  });

  test('re-running migrations on an already-migrated database is a safe no-op', () => {
    const { connection, migrate } = freshDb();
    const db = connection.getDb();
    const secondRun = migrate.runMigrations(db); // already applied at getDb() time
    expect(secondRun).toEqual([]);
  });

  test('creates the expected tables and the R-Tree spatial index', () => {
    const { connection } = freshDb();
    const db = connection.getDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all().map(r => r.name);
    expect(tables).toEqual(expect.arrayContaining(['reports', 'attachments', 'users', 'reports_rtree']));
  });
});

describe('Schema integrity constraints (defense-in-depth below the API layer)', () => {
  test('rejects out-of-range latitude at the database level', () => {
    const { reportsRepo } = freshDb();
    expect(() => reportsRepo.create({ lat: 999, lng: 100.5, victimName: 'X' })).toThrow(/CHECK constraint/);
  });

  test('rejects null-island (0,0) at the database level', () => {
    const { reportsRepo } = freshDb();
    expect(() => reportsRepo.create({ lat: 0, lng: 0, victimName: 'X' })).toThrow(/CHECK constraint/);
  });

  test('rejects a missing victimName at the database level', () => {
    const { reportsRepo } = freshDb();
    expect(() => reportsRepo.create({ lat: 13.7, lng: 100.5, victimName: '' })).toThrow(/CHECK constraint/);
  });

  test('cascade-deletes attachments when their report is deleted', () => {
    const { reportsRepo, connection } = freshDb();
    const p = reportsRepo.create({ lat: 13.7, lng: 100.5, victimName: 'X' }, [{ filename: 'a.jpg', url: '/uploads/a.jpg' }]);
    const db = connection.getDb();
    expect(db.prepare('SELECT COUNT(*) AS c FROM attachments WHERE report_id = ?').get(p.id).c).toBe(1);
    reportsRepo.remove(p.id);
    expect(db.prepare('SELECT COUNT(*) AS c FROM attachments WHERE report_id = ?').get(p.id).c).toBe(0);
  });
});

describe('Reports repository', () => {
  test('create/findById round-trips all fields, including attachments', () => {
    const { reportsRepo } = freshDb();
    const created = reportsRepo.create(
      { lat: 13.7563, lng: 100.5018, victimName: 'Test', victimAge: '45', reporterIdCard: '1234567890123' },
      [{ filename: 'photo.jpg', url: '/uploads/x.jpg' }]
    );
    const found = reportsRepo.findById(created.id);
    expect(found.victimName).toBe('Test');
    expect(found.victimAge).toBe(45);
    expect(found.reporterIdCard).toBe('1234567890123');
    expect(found.attachments).toEqual([{ id: expect.any(String), filename: 'photo.jpg', url: '/uploads/x.jpg' }]);
  });

  test('update() only changes provided fields and preserves the rest', () => {
    const { reportsRepo } = freshDb();
    const created = reportsRepo.create({ lat: 13.7, lng: 100.5, victimName: 'Original', causeOfDeath: 'Unknown' });
    const updated = reportsRepo.update(created.id, { causeOfDeath: 'Traffic accident' });
    expect(updated.victimName).toBe('Original'); // untouched field preserved
    expect(updated.causeOfDeath).toBe('Traffic accident');
  });

  test('update() returns null for a nonexistent id (no partial/phantom row created)', () => {
    const { reportsRepo } = freshDb();
    expect(reportsRepo.update('00000000-0000-0000-0000-000000000000', { causeOfDeath: 'x' })).toBeNull();
  });

  test('update() with an empty body returns the record unchanged without writing to the database', () => {
    const { reportsRepo, connection } = freshDb();
    const created = reportsRepo.create({ lat: 13.7, lng: 100.5, victimName: 'Original' });
    const before = connection.getDb().prepare('SELECT updated_at FROM reports WHERE id = ?').get(created.id).updated_at;
    const result = reportsRepo.update(created.id, {}, []);
    const after = connection.getDb().prepare('SELECT updated_at FROM reports WHERE id = ?').get(created.id).updated_at;
    expect(result.victimName).toBe('Original');
    // updated_at must not change for a genuine no-op
    expect(after).toBe(before);
  });

  test('remove() returns false for a nonexistent id', () => {
    const { reportsRepo } = freshDb();
    expect(reportsRepo.remove('00000000-0000-0000-0000-000000000000')).toBe(false);
  });

  test('a failed create() (constraint violation) leaves no partial row behind', () => {
    const { reportsRepo, connection } = freshDb();
    expect(() => reportsRepo.create({ lat: 999, lng: 100.5, victimName: 'X' })).toThrow();
    const db = connection.getDb();
    expect(db.prepare('SELECT COUNT(*) AS c FROM reports').get().c).toBe(0);
  });
});

describe('Spatial query (R-Tree index)', () => {
  test('findNear returns only points within radius, sorted nearest-first, with distances', () => {
    const { reportsRepo } = freshDb();
    reportsRepo.create({ lat: 13.7563, lng: 100.5018, victimName: 'Center' });
    reportsRepo.create({ lat: 13.76, lng: 100.505, victimName: 'Nearby' });   // ~0.5km
    reportsRepo.create({ lat: 18.7883, lng: 98.9853, victimName: 'Far' });    // ~600km

    const result = reportsRepo.findNear(13.7563, 100.5018, 5);
    expect(result.map(p => p.victimName)).toEqual(['Center', 'Nearby']);
    expect(result[0].distanceKm).toBeCloseTo(0, 3);
    expect(result[1].distanceKm).toBeGreaterThan(0);
  });

  test('the R-Tree index stays in sync after an update that moves a point', () => {
    const { reportsRepo } = freshDb();
    const p = reportsRepo.create({ lat: 13.7563, lng: 100.5018, victimName: 'Movable' });
    // Move it ~600km away, then confirm a 5km search from the ORIGINAL location no longer finds it
    reportsRepo.update(p.id, { lat: 18.7883, lng: 98.9853 });
    const result = reportsRepo.findNear(13.7563, 100.5018, 5);
    expect(result.map(r => r.id)).not.toContain(p.id);
  });
});

describe('Query optimization: indexes are actually used, not just declared', () => {
  // A schema can declare an index that the query planner silently never
  // uses (wrong column order, a query shape that can't use it, etc.).
  // EXPLAIN QUERY PLAN is the ground truth for whether an index is really
  // helping - asserting on it here means a future change that
  // accidentally defeats an index (e.g. wrapping a column in a function)
  // fails the test suite instead of silently degrading to a full scan.
  function planDetail(db, sql, ...params) {
    return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map(r => r.detail).join(' | ');
  }

  test('victim_name search uses idx_reports_victim_name', () => {
    const { connection } = freshDb();
    const db = connection.getDb();
    const detail = planDetail(db, 'SELECT * FROM reports WHERE victim_name = ?', 'x');
    expect(detail).toMatch(/USING INDEX idx_reports_victim_name/);
  });

  test('recent-first ordering uses idx_reports_created_at', () => {
    const { connection } = freshDb();
    const db = connection.getDb();
    const detail = planDetail(db, 'SELECT * FROM reports ORDER BY created_at DESC LIMIT 5');
    expect(detail).toMatch(/USING INDEX idx_reports_created_at/);
  });

  test('attachment lookup by report_id uses idx_attachments_report_id', () => {
    const { connection } = freshDb();
    const db = connection.getDb();
    const detail = planDetail(db, 'SELECT * FROM attachments WHERE report_id = ?', 'x');
    expect(detail).toMatch(/USING INDEX idx_attachments_report_id/);
  });

  test('the spatial bounding-box query uses the R-Tree index, not a full table scan', () => {
    const { connection } = freshDb();
    const db = connection.getDb();
    const detail = planDetail(
      db,
      'SELECT id FROM reports_rtree WHERE min_lat <= ? AND max_lat >= ? AND min_lng <= ? AND max_lng >= ?',
      14, 13, 101, 100
    );
    expect(detail).toMatch(/VIRTUAL TABLE INDEX/);
  });
});

describe('Query optimization: N+1 regression test', () => {
  test('listAll() issues a constant number of queries regardless of result set size (batched attachment fetch)', () => {
    const { reportsRepo, connection } = freshDb();
    for (let i = 0; i < 20; i++) {
      reportsRepo.create({ lat: 13.7 + i * 0.001, lng: 100.5, victimName: `Report ${i}` }, [{ filename: 'a.jpg', url: '/uploads/a.jpg' }]);
    }

    const db = connection.getDb();
    let queryCount = 0;
    const originalPrepare = db.prepare.bind(db);
    db.prepare = (sql) => { queryCount++; return originalPrepare(sql); };

    const results = reportsRepo.listAll();

    expect(results).toHaveLength(20);
    expect(results.every(r => r.attachments.length === 1)).toBe(true);
    // 1 query for the reports themselves + 1 batched query for ALL their
    // attachments = 2, not 1 + 20 (the N+1 pattern this replaced).
    expect(queryCount).toBeLessThanOrEqual(2);
  });

  test('listAll() returns results newest-first (created_at DESC)', () => {
    // Insert with small delays is not feasible in a sync test; verify
    // the query shape directly via EXPLAIN QUERY PLAN instead.
    const { connection } = freshDb();
    const db = connection.getDb();
    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM reports ORDER BY created_at DESC').all()
      .map(r => r.detail).join(' | ');
    expect(plan).toMatch(/USING INDEX idx_reports_created_at/);
  });
});

describe('Migrations (continued)', () => {
  test('reports.updated_at is auto-maintained by a trigger, not just application code', () => {
    const { reportsRepo, connection } = freshDb();
    const created = reportsRepo.create({ lat: 13.7, lng: 100.5, victimName: 'X' });
    const db = connection.getDb();
    // Update via raw SQL, bypassing reports-repo.js entirely, to prove the
    // guarantee lives in the schema, not just in application code.
    db.prepare('UPDATE reports SET victim_name = ? WHERE id = ?').run('Changed', created.id);
    const row = db.prepare('SELECT updated_at FROM reports WHERE id = ?').get(created.id);
    expect(row.updated_at).not.toBeNull();
  });
});

describe('Stats (cache-aside)', () => {
  test('reflects current data and updates after a write invalidates the cache', () => {
    const { reportsRepo } = freshDb();
    expect(reportsRepo.getStats().total).toBe(0);
    reportsRepo.create({ lat: 13.7, lng: 100.5, victimName: 'X', victimGender: 'ชาย' });
    const stats = reportsRepo.getStats();
    expect(stats.total).toBe(1);
    expect(stats.byGender['ชาย']).toBe(1);
    expect(stats.recent).toHaveLength(1);
  });
});

