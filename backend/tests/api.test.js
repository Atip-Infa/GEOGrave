// Isolate test data from the real backend/data & backend/uploads dirs, and
// provide required env vars (server.js/middleware/auth.js throw at import
// time without JWT_SECRET) BEFORE requiring the app - all module-level
// setup (JsonStore construction, admin user seeding) runs at require time.
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'geograve-test-'));
process.env.GEOGRAVE_DATA_DIR = path.join(tmpRoot, 'data');
process.env.GEOGRAVE_UPLOAD_DIR = path.join(tmpRoot, 'uploads');
process.env.JWT_SECRET = 'test-secret-not-for-production-use';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'TestPass123!';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server');

describe('Auth', () => {
  test('rejects login with missing fields', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });

  test('rejects login with wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('rejects login for an unknown username (not a 500 - regression test for the crash fixed during audit)', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'nobody', password: 'whatever' });
    expect(res.status).toBe(401);
  });

  test('logs in with correct credentials and returns a token', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'TestPass123!' });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
  });
});

describe('Reports: validation', () => {
  test('rejects an out-of-range latitude', async () => {
    const res = await request(app).post('/api/points').field('lat', 999).field('lng', 100.5).field('victimName', 'Test');
    expect(res.status).toBe(400);
  });

  test('rejects exact (0,0) "null island" coordinates', async () => {
    const res = await request(app).post('/api/points').field('lat', 0).field('lng', 0).field('victimName', 'Test');
    expect(res.status).toBe(400);
  });

  test('allows a legitimate coordinate where lat happens to be 0', async () => {
    const res = await request(app).post('/api/points').field('lat', 0).field('lng', 100.5).field('victimName', 'Equator Test');
    expect(res.status).toBe(201);
  });

  test('rejects a malformed reporterIdCard', async () => {
    const res = await request(app).post('/api/points').field('lat', 13.7).field('lng', 100.5)
      .field('victimName', 'Test').field('reporterIdCard', '123');
    expect(res.status).toBe(400);
  });

  test('rejects an uploaded file of a disallowed type', async () => {
    const res = await request(app).post('/api/points')
      .field('lat', 13.7).field('lng', 100.5).field('victimName', 'Test')
      .attach('attachments', Buffer.from('<script>alert(1)</script>'), { filename: 'evil.html', contentType: 'text/html' });
    expect(res.status).toBe(400);
  });

  test('does not leave the uploaded file on disk when a later field fails validation', async () => {
    const uploadDir = process.env.GEOGRAVE_UPLOAD_DIR;
    const before = fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir).length : 0;
    const res = await request(app).post('/api/points')
      .field('lat', 999).field('lng', 100.5).field('victimName', 'Test') // invalid lat
      .attach('attachments', Buffer.from('\x89PNG\r\n\x1a\n'), { filename: 'photo.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    const after = fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir).length : 0;
    expect(after).toBe(before); // no orphaned file left behind
  });
});

describe('Reports: create, PII redaction, delete', () => {
  let token;
  let pointId;

  beforeAll(async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'TestPass123!' });
    token = res.body.token;
  });

  test('anyone can create a report without logging in (public reporting must stay open)', async () => {
    const res = await request(app).post('/api/points')
      .field('lat', 13.7563).field('lng', 100.5018)
      .field('victimName', 'Test Victim')
      .field('reporterIdCard', '1234567890123');
    expect(res.status).toBe(201);
    pointId = res.body.id;
    expect(res.body.reporterIdCard).toBeUndefined(); // redacted even in the create response
  });

  test('GET /api/points redacts reporterIdCard for anonymous requests', async () => {
    const res = await request(app).get('/api/points');
    const point = res.body.find(p => p.id === pointId);
    expect(point).toBeDefined();
    expect(point.reporterIdCard).toBeUndefined();
    expect(point.victimName).toBe('Test Victim'); // everything else still public
  });

  test('GET /api/points reveals reporterIdCard to authenticated staff', async () => {
    const res = await request(app).get('/api/points').set('Authorization', `Bearer ${token}`);
    const point = res.body.find(p => p.id === pointId);
    expect(point.reporterIdCard).toBe('1234567890123');
  });

  test('DELETE without a token is rejected', async () => {
    const res = await request(app).delete(`/api/points/${pointId}`);
    expect(res.status).toBe(401);
  });

  test('DELETE with a forged alg:none token is rejected (JWT algorithm pinning)', async () => {
    const forged = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJzdGFmZiJ9.';
    const res = await request(app).delete(`/api/points/${pointId}`).set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  test('DELETE with a valid token succeeds', async () => {
    const res = await request(app).delete(`/api/points/${pointId}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });

  test('deleted point no longer exists', async () => {
    const res = await request(app).get(`/api/points/${pointId}`);
    expect(res.status).toBe(404);
  });
});

describe('Geospatial search', () => {
  beforeAll(async () => {
    await request(app).post('/api/points').field('lat', 13.7563).field('lng', 100.5018).field('victimName', 'Near Bangkok');
    await request(app).post('/api/points').field('lat', 18.7883).field('lng', 98.9853).field('victimName', 'Near Chiang Mai');
  });

  test('returns only points within the given radius, nearest first, with distances', async () => {
    const res = await request(app).get('/api/points/near').query({ lat: 13.7563, lng: 100.5018, radius_km: 5 });
    expect(res.status).toBe(200);
    expect(res.body.points.some(p => p.victimName === 'Near Bangkok')).toBe(true);
    expect(res.body.points.some(p => p.victimName === 'Near Chiang Mai')).toBe(false);
    expect(res.body.points[0]).toHaveProperty('distanceKm');
  });

  test('rejects an out-of-range latitude query param', async () => {
    const res = await request(app).get('/api/points/near').query({ lat: 999, lng: 100.5 });
    expect(res.status).toBe(400);
  });

  test('the literal path /api/points/near is not swallowed by the /:id route', async () => {
    // Regression test for route-ordering: /near must not be interpreted as
    // a UUID :id param.
    const res = await request(app).get('/api/points/near').query({ lat: 13.7, lng: 100.5 });
    expect(res.status).not.toBe(400);
    expect(res.body).toHaveProperty('points');
  });
});

describe('Health check', () => {
  test('GET /healthz reports ok', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
