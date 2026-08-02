const bcrypt = require('bcryptjs');
const { randomBytes } = require('crypto');
const { getDb } = require('./connection');
const { prep } = require('./prepared-cache');

// A fixed, valid bcrypt hash of a value nobody will ever type, used so the
// "unknown username" login path takes roughly the same time as "known
// username, wrong password" - closes the timing side-channel that would
// otherwise let response latency reveal which usernames exist.
const DUMMY_HASH = '$2a$12$CwTycUXWue0Thq9StjUM0uJ8Q9r8mQhq7zjK6R6XKZAY0z0z0z0z0';

function ensureSeeded() {
  const db = getDb();
  const existing = prep(db, 'SELECT COUNT(*) AS c FROM users').get().c;
  if (existing > 0) return;

  const username = process.env.ADMIN_USERNAME || 'admin';
  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) {
    password = randomBytes(9).toString('base64url');
    generated = true;
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  prep(db, 'INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);

  if (generated) {
    console.log('======================================================');
    console.log(' No ADMIN_PASSWORD set - generated one-time credentials:');
    console.log(`   username: ${username}`);
    console.log(`   password: ${password}`);
    console.log(' Set ADMIN_USERNAME / ADMIN_PASSWORD env vars before');
    console.log(' production deployment. This message only prints once,');
    console.log(' on first boot (stored in the users table).');
    console.log('======================================================');
  }
}

async function findByUsername(username) {
  const db = getDb();
  const row = prep(db, 'SELECT username, password_hash AS passwordHash FROM users WHERE username = ?').get(username);
  return row || null;
}

async function verifyPassword(user, password) {
  const hash = (user && typeof user.passwordHash === 'string') ? user.passwordHash : DUMMY_HASH;
  try {
    const matches = await bcrypt.compare(password, hash);
    return !!user && matches;
  } catch (e) {
    return false;
  }
}

module.exports = { ensureSeeded, findByUsername, verifyPassword };
