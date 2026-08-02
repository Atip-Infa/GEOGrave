const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Fail loudly rather than silently signing tokens with a guessable
  // default secret (a very common real-world vuln in Node apps).
  throw new Error(
    'JWT_SECRET environment variable is required. Set it in your .env file ' +
    '(see .env.example) before starting the server.'
  );
}

const TOKEN_TTL = '8h';
// FIX: sign/verify now pin the algorithm explicitly instead of relying on
// jsonwebtoken's default inference. Not exploitable with this library's
// current defaults, but pinning it removes any dependency on that
// remaining true in a future version and is a well-known defense-in-depth
// step against algorithm-confusion attacks (e.g. a token crafted with
// `alg: none` or switched to an asymmetric algorithm).
const JWT_ALGORITHM = 'HS256';

function issueToken(username) {
  return jwt.sign({ sub: username, role: 'staff' }, JWT_SECRET, { expiresIn: TOKEN_TTL, algorithm: JWT_ALGORITHM });
}

function getToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

// Blocks the request entirely if not authenticated.
function requireAuth(req, res, next) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// Doesn't block the request, just annotates req.user when a valid token is
// present. Used so GET /api/points can return redacted PII to the public
// but full detail to logged-in staff, without duplicating routes.
function attachUserIfPresent(req, res, next) {
  const token = getToken(req);
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
    } catch (e) {
      // ignore invalid/expired token for optional-auth routes
    }
  }
  next();
}

module.exports = { issueToken, requireAuth, attachUserIfPresent, TOKEN_TTL };
