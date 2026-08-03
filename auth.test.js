/**
 * @file auth.test.js
 * @fileoverview Assertions for auth.js. Run with `node auth.test.js`, or via `npm test`.
 * No framework: a fresh in-memory database per case and plain assert.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const A = require('./auth');

const SETUP = fs.readFileSync(path.join(__dirname, 'setup.sql'), 'utf8');

function freshDb() {
    const db = new DatabaseSync(':memory:');
    db.exec(SETUP);
    db.exec('PRAGMA foreign_keys = ON');
    return db;
}

/** Minimal stand-ins for the Express response/request bits auth.js touches. */
function fakeRes() {
    return {
        statusCode: 200, body: null, redirectedTo: null, cookies: {}, cleared: [],
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; },
        redirect(to) { this.redirectedTo = to; return this; },
        cookie(n, v, o) { this.cookies[n] = { value: v, opts: o }; return this; },
        clearCookie(n) { this.cleared.push(n); return this; },
    };
}

function fakeReq({ cookie, html = true, ip = '1.2.3.4' } = {}) {
    return { headers: { cookie }, ip, socket: {}, accepts: () => (html ? 'html' : 'json') };
}

const tests = {

    async 'password hashing round-trips'() {
        const { hash, salt } = await A.hashPassword('correct horse battery');
        assert.ok(hash.length === 128, 'scrypt keylen 64 -> 128 hex chars');
        assert.notStrictEqual(hash, salt);
        assert.strictEqual(await A.verifyPassword('correct horse battery', hash, salt), true);
        assert.strictEqual(await A.verifyPassword('wrong', hash, salt), false);
    },

    async 'each hash gets a distinct salt'() {
        const a = await A.hashPassword('same password');
        const b = await A.hashPassword('same password');
        assert.notStrictEqual(a.salt, b.salt);
        assert.notStrictEqual(a.hash, b.hash, 'identical passwords must not collide');
    },

    async 'migrated accounts with an empty hash can never log in'() {
        assert.strictEqual(await A.verifyPassword('anything', '', ''), false);
        assert.strictEqual(await A.verifyPassword('anything', '00', 'salt'), false,
            'wrong-length hash must be rejected, not compared');
    },

    'credential validation'() {
        assert.strictEqual(A.validateCredentials('thorin', 'a-good-password'), null);
        assert.match(A.validateCredentials('ab', 'a-good-password'), /3-32/);
        assert.match(A.validateCredentials('has space', 'a-good-password'), /3-32/);
        assert.match(A.validateCredentials('thorin', 'short'), /at least 10/);
        assert.match(A.validateCredentials('', 'a-good-password'), /required/);
        assert.match(A.validateCredentials('thorin', 'x'.repeat(2000)), /too long/);
    },

    async 'first registered user becomes admin, later ones do not'() {
        const db = freshDb();
        const first = await A.registerUser(db, { username: 'shaun', password: 'a-good-password' });
        assert.strictEqual(first.isAdmin, true);
        const second = await A.registerUser(db, { username: 'player', password: 'a-good-password' });
        assert.strictEqual(second.isAdmin, false);
        assert.notStrictEqual(first.userId, second.userId);

        const row = db.prepare('SELECT * FROM users WHERE user_id = ?').get(first.userId);
        assert.strictEqual(row.allow_ai_use, 0, 'AI must be off by default');
        assert.ok(!('password' in row), 'no plaintext password column');
        assert.ok(row.password_hash && row.password_salt);
        assert.ok(db.prepare('SELECT 1 FROM users_settings WHERE user_id = ?').get(first.userId),
            'settings row created alongside the account');
    },

    async 'duplicate usernames and emails are refused'() {
        const db = freshDb();
        await A.registerUser(db, { username: 'thorin', email: 'a@b.c', password: 'a-good-password' });
        await assert.rejects(
            () => A.registerUser(db, { username: 'THORIN', password: 'a-good-password' }),
            (e) => e.status === 409, 'username match must be case-insensitive');
        await assert.rejects(
            () => A.registerUser(db, { username: 'other', email: 'A@B.C', password: 'a-good-password' }),
            (e) => e.status === 409, 'email match must be case-insensitive');
    },

    async 'registration rejects weak credentials before touching the database'() {
        const db = freshDb();
        await assert.rejects(() => A.registerUser(db, { username: 'x', password: 'a-good-password' }),
            (e) => e.status === 400);
        assert.strictEqual(db.prepare('SELECT count(*) c FROM users').get().c, 0);
    },

    async 'authenticate accepts the right password and rejects everything else'() {
        const db = freshDb();
        const { userId } = await A.registerUser(db,
            { username: 'thorin', email: 'thorin@erebor.test', password: 'a-good-password' });

        assert.strictEqual(await A.authenticate(db, 'thorin', 'a-good-password'), userId);
        assert.strictEqual(await A.authenticate(db, 'THORIN', 'a-good-password'), userId,
            'username is case-insensitive');
        assert.strictEqual(await A.authenticate(db, 'thorin@erebor.test', 'a-good-password'), userId,
            'email works as a login too');

        await assert.rejects(() => A.authenticate(db, 'thorin', 'wrong'), (e) => e.status === 401);
        await assert.rejects(() => A.authenticate(db, 'nobody', 'a-good-password'),
            (e) => e.status === 401 && /Incorrect username or password/.test(e.message),
            'an unknown user must not be distinguishable from a bad password');

        assert.ok(db.prepare('SELECT last_login FROM users WHERE user_id = ?').get(userId).last_login);
    },

    async 'sessions resolve, expire and can be destroyed'() {
        const db = freshDb();
        const { userId } = await A.registerUser(db, { username: 'thorin', password: 'a-good-password' });

        const { sessionId } = A.createSession(db, userId, 'test-agent');
        assert.ok(sessionId.length >= 43, '32 random bytes in base64url');

        const live = A.getSession(db, sessionId);
        assert.strictEqual(live.user_id, userId);
        assert.strictEqual(live.username, 'thorin');
        assert.strictEqual(live.allow_ai_use, 0);

        assert.strictEqual(A.getSession(db, 'not-a-real-session'), null);
        assert.strictEqual(A.getSession(db, null), null);

        A.destroySession(db, sessionId);
        assert.strictEqual(A.getSession(db, sessionId), null);
    },

    async 'an expired session is rejected and cleaned up on read'() {
        const db = freshDb();
        const { userId } = await A.registerUser(db, { username: 'thorin', password: 'a-good-password' });
        db.prepare('INSERT INTO sessions (session_id, user_id, expires_at) VALUES (?,?,?)')
            .run('stale', userId, A.isoUtc(new Date(Date.now() - 1000)));

        assert.strictEqual(A.getSession(db, 'stale'), null);
        assert.strictEqual(db.prepare('SELECT count(*) c FROM sessions').get().c, 0,
            'reading an expired session should delete it');
    },

    'sessions do not outlive the user row they point at'() {
        // Inserted directly: registerUser also creates a users_settings row, and
        // that table has no ON DELETE CASCADE, so it would block the delete. See
        // "account deletion" in PLAN.md -- out of scope for F1.
        const db = freshDb();
        db.prepare('INSERT INTO users (user_id, username, password_hash, password_salt) ' +
            "VALUES (1, 'thorin', 'x', 'y')").run();
        A.createSession(db, 1, 'agent');
        db.prepare('DELETE FROM users WHERE user_id = 1').run();
        assert.strictEqual(db.prepare('SELECT count(*) c FROM sessions').get().c, 0);
    },

    async 'purgeExpiredSessions removes only the dead ones'() {
        const db = freshDb();
        const { userId } = await A.registerUser(db, { username: 'thorin', password: 'a-good-password' });
        A.createSession(db, userId, 'agent');
        db.prepare('INSERT INTO sessions (session_id, user_id, expires_at) VALUES (?,?,?)')
            .run('stale', userId, A.isoUtc(new Date(Date.now() - 1000)));
        assert.strictEqual(A.purgeExpiredSessions(db), 1,
            'the SQL comparison must agree with the format createSession writes');
        assert.strictEqual(db.prepare('SELECT count(*) c FROM sessions').get().c, 1);
    },

    'cookie parsing'() {
        assert.deepStrictEqual(A.parseCookies('a=1; b=two'), { a: '1', b: 'two' });
        assert.deepStrictEqual(A.parseCookies(''), {});
        assert.deepStrictEqual(A.parseCookies(undefined), {});
        assert.deepStrictEqual(A.parseCookies('mf_session=ab%3Dcd'), { mf_session: 'ab=cd' });
        assert.deepStrictEqual(A.parseCookies('novalue'), {}, 'malformed pairs are skipped');
    },

    async 'requireAuth admits a live session and turns away everyone else'() {
        const db = freshDb();
        const { userId } = await A.registerUser(db, { username: 'thorin', password: 'a-good-password' });
        const { sessionId } = A.createSession(db, userId, 'agent');
        const guard = A.requireAuth(db);

        let nexted = false;
        const req = fakeReq({ cookie: `${A.SESSION_COOKIE}=${sessionId}` });
        guard(req, fakeRes(), () => { nexted = true; });
        assert.strictEqual(nexted, true);
        assert.strictEqual(req.user.user_id, userId);

        const htmlRes = fakeRes();
        guard(fakeReq({ html: true }), htmlRes, () => assert.fail('should not pass'));
        assert.strictEqual(htmlRes.redirectedTo, '/login', 'browsers get redirected');

        const jsonRes = fakeRes();
        guard(fakeReq({ html: false }), jsonRes, () => assert.fail('should not pass'));
        assert.strictEqual(jsonRes.statusCode, 401, 'API callers get a status code');

        const forged = fakeRes();
        guard(fakeReq({ cookie: `${A.SESSION_COOKIE}=forged`, html: false }), forged,
            () => assert.fail('a made-up session must not pass'));
        assert.strictEqual(forged.statusCode, 401);
    },

    'the session cookie is httpOnly and scoped'() {
        const res = fakeRes();
        A.setSessionCookie(res, 'abc', new Date(Date.now() + 1000).toISOString());
        const c = res.cookies[A.SESSION_COOKIE];
        assert.strictEqual(c.value, 'abc');
        assert.strictEqual(c.opts.httpOnly, true, 'JavaScript must not read the session');
        assert.strictEqual(c.opts.sameSite, 'lax');
        assert.strictEqual(c.opts.path, '/');
    },

    'the rate limiter blocks past its ceiling and isolates callers'() {
        const limit = A.rateLimiter(3, 60_000);
        const run = (ip) => {
            const res = fakeRes();
            let passed = false;
            limit(fakeReq({ ip }), res, () => { passed = true; });
            return { passed, res };
        };
        assert.ok(run('1.1.1.1').passed);
        assert.ok(run('1.1.1.1').passed);
        assert.ok(run('1.1.1.1').passed);
        const blocked = run('1.1.1.1');
        assert.strictEqual(blocked.passed, false);
        assert.strictEqual(blocked.res.statusCode, 429);
        assert.ok(blocked.res.body.retryAfter > 0);
        assert.ok(run('2.2.2.2').passed, 'a different IP has its own budget');
    },
};

(async () => {
    let failed = 0;
    for (const [name, fn] of Object.entries(tests)) {
        try {
            await fn();
        } catch (err) {
            failed++;
            console.error(`  FAIL  ${name}\n        ${err.message}`);
        }
    }
    const total = Object.keys(tests).length;
    if (failed) {
        console.error(`\n${failed}/${total} auth tests failed`);
        process.exit(1);
    }
    console.log(`auth.js: ${total} tests OK`);
})();
