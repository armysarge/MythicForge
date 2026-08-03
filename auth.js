/**
 * @file auth.js
 * @fileoverview Accounts and sessions for MythicForge. Express owns authentication;
 * the Flask process never sees a password or a cookie, it only receives a user id
 * over a shared-secret internal call.
 *
 * No dependencies beyond Node's own crypto and sqlite modules.
 *
 * Passwords are salted scrypt. Sessions are 32 random bytes stored in the sessions
 * table and validated on every request, so the cookie carries no signature -- there
 * is no payload in it to tamper with, only an opaque token that either matches a
 * live row or does not.
 */

const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const SESSION_COOKIE = 'mf_session';
const SESSION_DAYS = 30;
const SCRYPT_KEYLEN = 64;
const MIN_PASSWORD = 10;

// Login attempts per IP per window. Open registration makes this mandatory.
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 10;

/**
 * Open MythicForge.db for the web server.
 * WAL matters: the Flask process holds the same file open, and without it the
 * second writer fails with SQLITE_BUSY instead of waiting.
 */
function openDb(path) {
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA foreign_keys = ON');
    return db;
}

// --- passwords ---------------------------------------------------------------

function scrypt(password, salt) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, SCRYPT_KEYLEN, (err, key) =>
            err ? reject(err) : resolve(key));
    });
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = (await scrypt(password, salt)).toString('hex');
    return { hash, salt };
}

async function verifyPassword(password, hash, salt) {
    // Migrated pre-F1 accounts carry an empty hash and can never authenticate.
    if (!hash || !salt) return false;
    const known = Buffer.from(hash, 'hex');
    if (known.length !== SCRYPT_KEYLEN) return false;
    const attempt = await scrypt(password, salt);
    return crypto.timingSafeEqual(known, attempt);
}

/** Returns an error string, or null when the credentials are acceptable. */
function validateCredentials(username, password) {
    if (!username || typeof username !== 'string') return 'Username is required';
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username))
        return 'Username must be 3-32 characters, letters, numbers, . _ - only';
    if (typeof password !== 'string' || password.length < MIN_PASSWORD)
        return `Password must be at least ${MIN_PASSWORD} characters`;
    if (password.length > 1024) return 'Password is too long';
    return null;
}

// --- sessions ----------------------------------------------------------------

/**
 * Second-precision ISO-8601 UTC, e.g. 2026-08-03T12:34:56Z.
 *
 * Dropping the milliseconds matters: SQLite compares timestamps as strings, and
 * '...T12:34:56.000Z' sorts after '...T12:34:56Z' because '.' < 'Z'. At this
 * precision, lexicographic order is exactly chronological order, so the SQL in
 * purgeExpiredSessions and the JS check in getSession agree.
 */
function isoUtc(date) {
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** The SQLite expression producing 'now' in the same format as isoUtc. */
const SQL_NOW = "strftime('%Y-%m-%dT%H:%M:%SZ','now')";

function createSession(db, userId, userAgent) {
    const sessionId = crypto.randomBytes(32).toString('base64url');
    const expires = isoUtc(new Date(Date.now() + SESSION_DAYS * 86400_000));
    db.prepare('INSERT INTO sessions (session_id, user_id, expires_at, user_agent) ' +
        'VALUES (?, ?, ?, ?)').run(sessionId, userId, expires, (userAgent || '').slice(0, 255));
    return { sessionId, expires };
}

/** Resolve a session id to its user, or null if unknown or expired. */
function getSession(db, sessionId) {
    if (!sessionId) return null;
    const row = db.prepare(
        'SELECT s.session_id, s.user_id, s.expires_at, u.username, u.is_admin, ' +
        '       u.allow_ai_use ' +
        'FROM sessions s JOIN users u ON u.user_id = s.user_id ' +
        'WHERE s.session_id = ?').get(sessionId);
    if (!row) return null;
    if (new Date(row.expires_at) <= new Date()) {
        destroySession(db, sessionId);
        return null;
    }
    return row;
}

function destroySession(db, sessionId) {
    if (sessionId) db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
}

function purgeExpiredSessions(db) {
    return db.prepare(`DELETE FROM sessions WHERE expires_at <= ${SQL_NOW}`).run().changes;
}

// --- accounts ----------------------------------------------------------------

async function registerUser(db, { username, email, password }) {
    const invalid = validateCredentials(username, password);
    if (invalid) throw new AuthError(invalid, 400);

    const taken = db.prepare(
        'SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(username);
    if (taken) throw new AuthError('That username is taken', 409);
    if (email) {
        const dupe = db.prepare(
            'SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(email);
        if (dupe) throw new AuthError('That email is already registered', 409);
    }

    const { hash, salt } = await hashPassword(password);
    // First account to exist becomes the admin.
    const isFirst = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
    const res = db.prepare(
        'INSERT INTO users (username, email, password_hash, password_salt, is_admin) ' +
        'VALUES (?, ?, ?, ?, ?)').run(username, email || null, hash, salt, isFirst ? 1 : 0);
    const userId = Number(res.lastInsertRowid);
    db.prepare('INSERT INTO users_settings (user_id) VALUES (?)').run(userId);
    return { userId, isAdmin: isFirst };
}

async function authenticate(db, username, password) {
    const row = db.prepare(
        'SELECT user_id, password_hash, password_salt FROM users ' +
        'WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE').get(username, username);

    // Hash even when the user does not exist, so a missing account and a wrong
    // password take the same time and cannot be told apart.
    const hash = row ? row.password_hash : '0'.repeat(SCRYPT_KEYLEN * 2);
    const salt = row ? row.password_salt : 'nonexistent';
    const ok = await verifyPassword(password, hash, salt);

    if (!row || !ok) throw new AuthError('Incorrect username or password', 401);
    db.prepare("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = ?")
        .run(row.user_id);
    return row.user_id;
}

class AuthError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

// --- http plumbing -----------------------------------------------------------

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    for (const part of header.split(';')) {
        const ix = part.indexOf('=');
        if (ix < 0) continue;
        out[part.slice(0, ix).trim()] = decodeURIComponent(part.slice(ix + 1).trim());
    }
    return out;
}

function setSessionCookie(res, sessionId, expires) {
    res.cookie(SESSION_COOKIE, sessionId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        expires: new Date(expires),
        path: '/',
    });
}

function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/**
 * Express middleware. Attaches req.user for authenticated requests; otherwise
 * redirects browsers to /login and answers API calls with 401.
 */
function requireAuth(db) {
    return (req, res, next) => {
        const cookies = parseCookies(req.headers.cookie);
        const session = getSession(db, cookies[SESSION_COOKIE]);
        if (session) {
            req.user = session;
            req.sessionId = session.session_id;
            return next();
        }
        const wantsHtml = req.accepts(['html', 'json']) === 'html';
        if (wantsHtml) return res.redirect('/login');
        return res.status(401).json({ error: 'Not authenticated' });
    };
}

/** Fixed-window rate limiter keyed by IP. In-memory, so it resets on restart. */
function rateLimiter(max = RATE_MAX, windowMs = RATE_WINDOW_MS) {
    const hits = new Map();
    return (req, res, next) => {
        const now = Date.now();
        const key = req.ip || req.socket.remoteAddress || 'unknown';
        const entry = hits.get(key);
        if (!entry || now > entry.resetAt) {
            hits.set(key, { count: 1, resetAt: now + windowMs });
            // ponytail: swept on write rather than on a timer. Fine at this scale;
            // if the map ever gets big, move to a periodic sweep.
            if (hits.size > 10000) {
                for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
            }
            return next();
        }
        if (++entry.count > max) {
            return res.status(429).json({
                error: 'Too many attempts. Try again later.',
                retryAfter: Math.ceil((entry.resetAt - now) / 1000),
            });
        }
        next();
    };
}

module.exports = {
    SESSION_COOKIE, MIN_PASSWORD, AuthError,
    openDb, isoUtc,
    hashPassword, verifyPassword, validateCredentials,
    createSession, getSession, destroySession, purgeExpiredSessions,
    registerUser, authenticate,
    parseCookies, setSessionCookie, clearSessionCookie, requireAuth, rateLimiter,
};
