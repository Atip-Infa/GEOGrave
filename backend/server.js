require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

const { getDb } = require('./lib/db/connection');
const reportsRepo = require('./lib/db/reports-repo');
const usersRepo = require('./lib/db/users-repo');
const { buildUpload } = require('./lib/upload');
const { issueToken, requireAuth, attachUserIfPresent } = require('./middleware/auth');
const { createPointRules, updateRules, idParamRule, handleValidation } = require('./middleware/validate');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Overridable so the test suite (tests/) can point these at an isolated
// temp directory instead of touching real data/uploads. Defaults are
// unchanged from before, so normal `npm start` behavior is identical.
const DATA_DIR = process.env.GEOGRAVE_DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.GEOGRAVE_UPLOAD_DIR || path.join(__dirname, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'geograve.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

getDb(); // opens the DB and applies any pending migrations before the app starts serving
usersRepo.ensureSeeded();

const upload = buildUpload(UPLOAD_DIR);

// ---------- SECURITY / PLATFORM MIDDLEWARE ----------
app.set('trust proxy', 1); // required for correct rate-limiting/IPs behind a reverse proxy (nginx/ALB)

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", 'https://cdnjs.cloudflare.com'],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
      imgSrc: [
        "'self'", 'data:', 'blob:',
        'https://*.tile.openstreetmap.org',    // Road + Terrain layers
        'https://*.basemaps.cartocdn.com',      // CARTO Road layer
        'https://server.arcgisonline.com',      // Esri satellite layer
      ],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      connectSrc: [
        "'self'",
        'https://nominatim.openstreetmap.org',  // Geocoding & location search
        'https://server.arcgisonline.com',       // Esri tile requests (crossOrigin)
      ],
    }
  }
}));
app.use(compression());
if (NODE_ENV !== 'test') app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

// LOGGING & MONITORING: structured slow-request logging. Every request is
// already covered by morgan's access log above; this adds a second,
// machine-parseable (JSON) warning specifically for requests that are slow
// enough to investigate - e.g. a query missing an index, or an R-Tree
// candidate set that grew unexpectedly large. In a real deployment this
// log line is exactly what you'd ship to CloudWatch/Datadog and alert on.
const SLOW_REQUEST_MS = 200;
app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    if (durationMs > SLOW_REQUEST_MS) {
      console.warn(JSON.stringify({
        level: 'warn', msg: 'slow_request', method: req.method, path: req.originalUrl,
        durationMs: Math.round(durationMs), statusCode: res.statusCode
      }));
    }
  });
  next();
});

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : true, // same-origin app by default; restrict via env in prod
  credentials: true
}));

app.use(express.json({ limit: '1mb' }));

// Generic API rate limit (protects the database from being hammered and
// mitigates scraping of PII).
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));
// Tighter limit on login to slow down credential guessing.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
// Tighter limit on report creation to reduce spam/abuse of a public write endpoint.
const createLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

app.use(express.static(path.join(__dirname, 'public')));
// Uploaded files are served statically but never executed; combined with
// the extension/mimetype whitelist in lib/upload.js this prevents the
// classic "upload a .html/.js and get it served" attack.
app.use('/uploads', express.static(UPLOAD_DIR, { setHeaders: (res) => res.setHeader('Content-Disposition', 'inline') }));

// ---------- HELPERS ----------
function sanitizeOriginalName(name) {
  return String(name || '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 200);
}

function filesToAttachments(files) {
  return (files || []).map(f => ({
    filename: sanitizeOriginalName(f.originalname),
    url: `/uploads/${f.filename}`
  }));
}

// Fields that are not shown anywhere in the current UI and are highly
// sensitive (Thai national ID number). We keep them in storage (the org
// may need them for follow-up) but never expose them over the public,
// unauthenticated API - only to logged-in staff.
const STAFF_ONLY_FIELDS = ['reporterIdCard'];

function redactForPublic(point) {
  const clone = { ...point };
  for (const f of STAFF_ONLY_FIELDS) delete clone[f];
  return clone;
}

function serializePoint(point, req) {
  return req.user ? point : redactForPublic(point);
}

// ---------- HEALTH ----------
// Expanded beyond a bare 200 OK: verifies the database is actually
// reachable (a real query, not just "the process is up") and surfaces
// enough for a monitoring dashboard (row count, on-disk size) without
// needing a separate metrics endpoint at this project's scale.
app.get('/healthz', (req, res) => {
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    const dbSizeKb = fs.existsSync(DB_FILE) ? Math.round(fs.statSync(DB_FILE).size / 1024) : 0;
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      database: { connected: true, reportCount: reportsRepo.count(), sizeKb: dbSizeKb }
    });
  } catch (e) {
    res.status(503).json({ status: 'error', error: 'database unreachable' });
  }
});

// ---------- AUTH ----------
app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });

    const user = await usersRepo.findByUsername(username);
    const ok = await usersRepo.verifyPassword(user, password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = issueToken(user.username);
    res.json({ token, username: user.username, expiresIn: '8h' });
  } catch (e) { next(e); }
});

// ---------- POINTS ----------
// SCALABILITY: optional pagination via ?limit=&offset=. When omitted (the
// default, and what the current frontend always does), behavior is
// unchanged - the full list is returned exactly as before. When provided,
// the total count is reported via X-Total-Count so a client can build a
// paginator without a second request. This is the difference between "the
// browser downloads and renders 50,000 markers" and "the browser asks for
// page 3" as the dataset grows.
app.get('/api/points', attachUserIfPresent, async (req, res, next) => {
  try {
    let points;
    if (req.query.limit !== undefined) {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      points = reportsRepo.listAll({ limit, offset });
      res.set('X-Total-Count', String(reportsRepo.count()));
    } else {
      points = reportsRepo.listAll();
    }
    res.json(points.map(p => serializePoint(p, req)));
  } catch (e) { next(e); }
});

app.get('/api/stats', async (req, res, next) => {
  try {
    res.json(reportsRepo.getStats());
  } catch (e) { next(e); }
});

// GET /api/points/near?lat=..&lng=..&radius_km=.. - returns reports within
// radiusKm of a given coordinate, nearest-first, each annotated with its
// distance. Backed by the R-Tree spatial index (see
// lib/db/reports-repo.js#findNear) rather than scanning every row.
// Registered BEFORE /api/points/:id below - Express matches routes in
// registration order, and :id would otherwise greedily match the literal
// path segment "near" as if it were an id.
app.get('/api/points/near', attachUserIfPresent, async (req, res, next) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radiusKm = req.query.radius_km !== undefined ? parseFloat(req.query.radius_km) : 5;

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return res.status(400).json({ error: 'lat query param must be a number between -90 and 90' });
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'lng query param must be a number between -180 and 180' });
    }
    if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 500) {
      return res.status(400).json({ error: 'radius_km must be a number between 0 and 500' });
    }

    const nearby = reportsRepo.findNear(lat, lng, radiusKm).map(p => serializePoint(p, req));
    res.json({ center: { lat, lng }, radiusKm, count: nearby.length, points: nearby });
  } catch (e) { next(e); }
});

app.get('/api/points/:id', attachUserIfPresent, idParamRule, handleValidation, async (req, res, next) => {
  try {
    const point = reportsRepo.findById(req.params.id);
    if (!point) return res.status(404).json({ error: 'Not found' });
    res.json(serializePoint(point, req));
  } catch (e) { next(e); }
});

app.post('/api/points', createLimiter, upload.array('attachments', 5), createPointRules, handleValidation, async (req, res, next) => {
  try {
    const body = req.body;
    const created = reportsRepo.create({
      lat: parseFloat(body.lat),
      lng: parseFloat(body.lng),
      victimName: (body.victimName || '').trim(),
      victimAge: body.victimAge || '',
      victimGender: body.victimGender || '',
      causeOfDeath: body.causeOfDeath || '',
      reportedDate: body.reportedDate || '',
      reportedTime: body.reportedTime || '',
      locationOfDeath: body.locationOfDeath || '',
      destinationTemple: body.destinationTemple || '',
      reportedBy: body.reportedBy || '',
      reporterPhone: body.reporterPhone || '',
      reporterIdCard: body.reporterIdCard || ''
    }, filesToAttachments(req.files));

    res.status(201).json(serializePoint(created, req));
  } catch (e) { next(e); }
});

// Editing a report is a staff action (it can rewrite the official record),
// so it requires authentication.
app.put('/api/points/:id', requireAuth, upload.array('attachments', 5), updateRules, handleValidation, async (req, res, next) => {
  try {
    const updated = reportsRepo.update(req.params.id, req.body, filesToAttachments(req.files));
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (e) { next(e); }
});

// Deleting a record is destructive and irreversible, so it requires
// authentication. Attachment rows are removed automatically via the
// ON DELETE CASCADE foreign key (see migrations/001_init.sql) - the
// application no longer has to remember to clean them up by hand.
app.delete('/api/points/:id', requireAuth, idParamRule, handleValidation, async (req, res, next) => {
  try {
    const existed = reportsRepo.remove(req.params.id);
    if (!existed) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (e) { next(e); }
});

// ---------- SPA FALLBACK (must come after API routes) ----------
app.get(/^\/(?!api\/|uploads\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- 404 for unmatched API routes ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ---------- CENTRAL ERROR HANDLER ----------
// Express requires the 4-argument signature (err, req, res, next) to recognise an error handler;
// `next` is intentionally unused here — the pattern in argsIgnorePattern covers it.
app.use((err, req, res, next) => {
  if (err && err.message && err.message.startsWith('Unsupported file type')) {
    return res.status(400).json({ error: err.message });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large (max 10MB)' });
  }
  if (err && typeof err.message === 'string' && err.message.includes('CHECK constraint failed')) {
    // DB-level CHECK constraints are defense-in-depth behind the API-level
    // express-validator rules - if one ever fires it means invalid data
    // reached the database some other way, but the client still deserves
    // a clean 400, not a raw SQLite error message.
    return res.status(400).json({ error: 'Invalid data rejected by database constraints' });
  }
  console.error(err);
  const isProd = NODE_ENV === 'production';
  res.status(err.status || 500).json({ error: isProd ? 'Internal server error' : (err.message || 'Internal server error') });
});

// Only bind a real port / install process-exiting crash handlers when this
// file is run directly (`node server.js`), not when it's `require()`'d as
// a module - which is exactly what the test suite in tests/ does via
// supertest, so it can drive the app against an ephemeral in-process port
// without a real listener, and so a test that intentionally triggers an
// error doesn't take down the whole Jest process.
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`GEOGrave server running on port ${PORT} [${NODE_ENV}]`);
  });

  // Graceful shutdown: stop accepting new connections and wait for
  // in-flight requests to finish before the process exits.
  // Required for zero-downtime deploys and clean `docker stop` behaviour.
  function gracefulShutdown(signal) {
    console.log(`${signal} received — shutting down gracefully`);
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
    // Force exit after 10 s if requests are still hanging
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    process.exit(1);
  });
}

module.exports = app;
