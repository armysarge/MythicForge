/**
 * @file server.test.js
 * @fileoverview End-to-end checks against a real running server: registration,
 * login, the auth guard, per-user data isolation, and the internal Node -> Flask
 * secret. Run with `node server.test.js`, or via `npm test`.
 *
 * Boots server.js on a scratch port with a scratch database, so it never touches
 * a real MythicForge.db.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const PORT = 3457;
const PY_PORT = 4457;
const BASE = `http://127.0.0.1:${PORT}`;
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythicforge-test-'));

let server;
const failures = [];

/** fetch that keeps a cookie jar, so a "browser" stays signed in. */
function client() {
    let cookies = {};
    return {
        get cookieHeader() {
            return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
        },
        clear() { cookies = {}; },
        async req(method, url, body) {
            const res = await fetch(BASE + url, {
                method,
                redirect: 'manual',
                headers: {
                    'Accept': 'application/json',
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                    ...(Object.keys(cookies).length ? { Cookie: this.cookieHeader } : {}),
                },
                body: body ? JSON.stringify(body) : undefined,
            });
            for (const raw of res.headers.getSetCookie?.() ?? []) {
                const [pair] = raw.split(';');
                const ix = pair.indexOf('=');
                const name = pair.slice(0, ix).trim();
                const value = pair.slice(ix + 1).trim();
                if (value === '') delete cookies[name];
                else cookies[name] = value;
            }
            const text = await res.text();
            let json = null;
            try { json = JSON.parse(text); } catch { /* html response */ }
            return { status: res.status, json, text, headers: res.headers };
        },
        GET(url) { return this.req('GET', url); },
        POST(url, body) { return this.req('POST', url, body); },
    };
}

async function waitFor(label, url, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url, { redirect: 'manual' });
            if (res.status < 500) return;
        } catch { /* not listening yet */ }
        await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`${label} did not start within ${timeoutMs}ms`);
}

/**
 * Both processes, not just Node. Flask is spawned by server.js and takes a few
 * seconds longer to bind; without waiting for it the proxied routes race it and
 * fail with ECONNREFUSED. A 403 here is the expected answer -- it means Flask is
 * up and correctly refusing a call with no internal secret.
 */
async function waitForServer(timeoutMs = 45000) {
    await waitFor('Node', `${BASE}/login`, timeoutMs);
    await waitFor('Flask', `http://127.0.0.1:${PY_PORT}/data?type=characters`, timeoutMs);
}

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ok    ${name}`);
    } catch (err) {
        failures.push(name);
        console.error(`  FAIL  ${name}\n        ${err.message}`);
    }
}

(async () => {
    server = spawn('node', ['server.js'], {
        cwd: __dirname,
        env: {
            ...process.env,
            MYTHICFORGE_PORT: String(PORT),
            MYTHICFORGE_PYTHON_PORT: String(PY_PORT),
            MYTHICFORGE_DB: path.join(workdir, 'MythicForge.db'),
            MYTHICFORGE_SKIP_DOWNLOADS: 'true',
            DEBUG_MODE: 'true',  // so the Flask process's output reaches serverLog
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let serverLog = '';
    server.stdout.on('data', (d) => { serverLog += d; });
    server.stderr.on('data', (d) => { serverLog += d; });

    try {
        await waitForServer();

        const alice = client();
        const bob = client();

        await test('an anonymous visitor is turned away from the app', async () => {
            const anon = client();
            const res = await anon.GET('/');
            assert.strictEqual(res.status, 401, 'API-style request gets 401');

            const asBrowser = await fetch(`${BASE}/`, {
                redirect: 'manual', headers: { Accept: 'text/html' },
            });
            assert.strictEqual(asBrowser.status, 302);
            assert.strictEqual(asBrowser.headers.get('location'), '/login');
        });

        await test('the login page is reachable without a session', async () => {
            const res = await fetch(`${BASE}/login`);
            assert.strictEqual(res.status, 200);
            assert.match(await res.text(), /Sign In/);
        });

        await test('registration creates an account and signs it in', async () => {
            const res = await alice.POST('/register',
                { username: 'alice', email: 'alice@test.local', password: 'a-good-password' });
            assert.strictEqual(res.status, 200, JSON.stringify(res.json));
            assert.strictEqual(res.json.isAdmin, true, 'first account is the admin');
            assert.ok(alice.cookieHeader.includes('mf_session'), 'session cookie set');
        });

        await test('the second account is not an admin', async () => {
            const res = await bob.POST('/register',
                { username: 'bob', password: 'a-good-password' });
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.json.isAdmin, false);
        });

        await test('weak and duplicate registrations are refused', async () => {
            const weak = await client().POST('/register', { username: 'carol', password: 'short' });
            assert.strictEqual(weak.status, 400);
            const dupe = await client().POST('/register',
                { username: 'alice', password: 'a-good-password' });
            assert.strictEqual(dupe.status, 409);
        });

        await test('a signed-in user reaches the app and /me', async () => {
            assert.strictEqual((await alice.GET('/')).status, 200);
            const me = await alice.GET('/me');
            assert.strictEqual(me.json.username, 'alice');
            assert.strictEqual(me.json.isAdmin, true);
            assert.strictEqual(me.json.allowAiUse, false, 'AI off by default');
        });

        await test('a forged session cookie is rejected', async () => {
            const forged = client();
            const res = await fetch(`${BASE}/me`, {
                headers: { Cookie: 'mf_session=totally-made-up', Accept: 'application/json' },
            });
            assert.strictEqual(res.status, 401);
        });

        // The whole point of F1: alice must not see bob's characters.
        await test('characters are scoped to their owner', async () => {
            const dbPath = path.join(workdir, 'MythicForge.db');
            const db = new DatabaseSync(dbPath);
            const idOf = (u) => db.prepare('SELECT user_id FROM users WHERE username = ?')
                .get(u).user_id;
            const insert = db.prepare(
                'INSERT INTO characters (user_id, name, race, class) VALUES (?,?,?,?)');
            insert.run(idOf('alice'), 'Thorin', 'Dwarf', 'Fighter');
            insert.run(idOf('bob'), 'Legolas', 'Elf', 'Ranger');
            db.close();

            const aliceChars = await alice.GET('/data?type=characters');
            assert.strictEqual(aliceChars.status, 200, JSON.stringify(aliceChars.json));
            assert.deepStrictEqual(aliceChars.json.map((c) => c.name), ['Thorin']);

            const bobChars = await bob.GET('/data?type=characters');
            assert.deepStrictEqual(bobChars.json.map((c) => c.name), ['Legolas']);
        });

        await test('fetching another user\'s character by id returns nothing', async () => {
            const all = await bob.GET('/data?type=characters');
            const bobId = all.json[0].character_id;
            const stolen = await alice.GET(`/data?type=character&q=${bobId}`);
            assert.deepStrictEqual(stolen.json, [], 'must not leak across accounts');
        });

        await test('AI endpoints are refused while allow_ai_use is off', async () => {
            const res = await alice.POST('/story', { monster: { name: 'Goblin' } });
            assert.strictEqual(res.status, 403);
            assert.match(res.json.error, /not enabled/i);
        });

        await test('Flask refuses a direct call without the internal secret', async () => {
            const direct = await fetch(`http://127.0.0.1:${PY_PORT}/data?type=characters`, {
                headers: { 'User-Agent': 'axios/1.7.7' },
            });
            assert.strictEqual(direct.status, 403,
                'the old User-Agent check would have allowed this');
        });

        await test('logging out invalidates the session', async () => {
            const res = await alice.POST('/logout');
            assert.strictEqual(res.status, 200);
            assert.strictEqual((await alice.GET('/me')).status, 401);
        });

        await test('logging back in works and rejects a bad password', async () => {
            const bad = await alice.POST('/login', { username: 'alice', password: 'wrong' });
            assert.strictEqual(bad.status, 401);
            const good = await alice.POST('/login',
                { username: 'alice', password: 'a-good-password' });
            assert.strictEqual(good.status, 200);
            assert.strictEqual((await alice.GET('/me')).json.username, 'alice');
        });

        // --- F3: the shared tool layer over REST ---

        await test('the tool registry is discoverable', async () => {
            const res = await alice.GET('/api/tools');
            assert.strictEqual(res.status, 200, JSON.stringify(res.json));
            const byName = Object.fromEntries(res.json.map((t) => [t.name, t]));

            // Assert the contract, not a tool count. A count fails every time the
            // registry grows, which is exactly when a test should stay quiet.
            for (const required of ['search_5e', 'list_5e', 'get_character',
                'add_inventory_item', 'advance_turn']) {
                assert.ok(byName[required], `${required} missing from the registry`);
                assert.ok(byName[required].description, `${required} has no description`);
            }
            assert.ok(res.json.every((t) => ['public', 'user'].includes(t.scope)));
            assert.strictEqual(byName.search_5e.scope, 'public');
            assert.strictEqual(byName.get_character.scope, 'user');
            assert.ok(res.json.every((t) => !t.arguments.some((a) => a.name === 'user_id')),
                'no tool may advertise user_id as a caller-supplied argument');
            assert.deepStrictEqual(
                byName.get_character.arguments.map((a) => a.name), ['character_id']);
        });

        await test('an unauthenticated caller cannot reach the tool API', async () => {
            const res = await fetch(`${BASE}/api/tool/list_campaigns`, {
                method: 'POST', headers: { Accept: 'application/json' },
            });
            assert.strictEqual(res.status, 401);
        });

        await test('a tool call round-trips through Node and Flask', async () => {
            const res = await alice.POST('/api/tool/list_characters', {});
            assert.strictEqual(res.status, 200, JSON.stringify(res.json));
            assert.deepStrictEqual(res.json.result.map((c) => c.name), ['Thorin']);
        });

        await test('writes persist and are readable back', async () => {
            const chars = await alice.POST('/api/tool/list_characters', {});
            const id = chars.json.result[0].character_id;

            const added = await alice.POST('/api/tool/add_inventory_item', {
                character_id: id, item_name: 'Bag of Holding',
                reference_id: 'item/DMG/bag-of-holding',
            });
            assert.strictEqual(added.status, 200, JSON.stringify(added.json));

            const inv = await alice.POST('/api/tool/get_inventory', { character_id: id });
            assert.strictEqual(inv.json.result.length, 1);
            assert.strictEqual(inv.json.result[0].reference_id, 'item/DMG/bag-of-holding');

            // stacking rather than duplicating, over HTTP
            await alice.POST('/api/tool/add_inventory_item',
                { character_id: id, item_name: 'Bag of Holding',
                  reference_id: 'item/DMG/bag-of-holding' });
            const again = await alice.POST('/api/tool/get_inventory', { character_id: id });
            assert.strictEqual(again.json.result.length, 1);
            assert.strictEqual(again.json.result[0].quantity, 2);
        });

        // The F1 guarantee has to hold on this surface too, not just on /data.
        await test('tools refuse to touch another user\'s data', async () => {
            const bobChars = await bob.POST('/api/tool/list_characters', {});
            const bobId = bobChars.json.result[0].character_id;

            const read = await alice.POST('/api/tool/get_character', { character_id: bobId });
            assert.strictEqual(read.status, 404, 'reading across accounts must fail');

            const write = await alice.POST('/api/tool/add_inventory_item',
                { character_id: bobId, item_name: 'Contraband' });
            assert.strictEqual(write.status, 404, 'writing across accounts must fail');

            const inv = await bob.POST('/api/tool/get_inventory', { character_id: bobId });
            assert.deepStrictEqual(inv.json.result, [], 'nothing was planted');
        });

        await test('user_id cannot be smuggled in through the request body', async () => {
            const res = await alice.POST('/api/tool/list_characters', { user_id: 2 });
            assert.strictEqual(res.status, 400);
            assert.match(res.json.error, /session/i);
        });

        await test('bad tool calls give useful status codes, not 500s', async () => {
            assert.strictEqual((await alice.POST('/api/tool/no_such_tool', {})).status, 404);
            assert.strictEqual(
                (await alice.POST('/api/tool/get_character', { nope: 1 })).status, 400);
            assert.strictEqual((await alice.POST('/api/tool/get_character', {})).status, 400);
            assert.strictEqual(
                (await alice.POST('/api/tool/get_character', { character_id: 99999 })).status,
                404);
        });

        await test('a full encounter runs over the API', async () => {
            const chars = await alice.POST('/api/tool/list_characters', {});
            const pcId = chars.json.result[0].character_id;

            const enc = await alice.POST('/api/tool/create_encounter',
                { encounter_name: 'Cragmaw Ambush' });
            const eid = enc.json.result.encounter_id;

            const pc = await alice.POST('/api/tool/add_combatant',
                { encounter_id: eid, display_name: 'Thorin', character_id: pcId });
            const gob = await alice.POST('/api/tool/add_combatant',
                { encounter_id: eid, display_name: 'Goblin 1',
                  reference_id: 'monster/MM/goblin', max_hit_points: 7 });

            await alice.POST('/api/tool/set_initiative',
                { combatant_id: pc.json.result.combatant_id, initiative: 12 });
            await alice.POST('/api/tool/set_initiative',
                { combatant_id: gob.json.result.combatant_id, initiative: 19 });

            const turn = await alice.POST('/api/tool/advance_turn', { encounter_id: eid });
            assert.strictEqual(turn.json.result.whose_turn, 'Goblin 1');
            assert.strictEqual(turn.json.result.round, 1);

            const hit = await alice.POST('/api/tool/update_hp',
                { target: 'combatant', target_id: gob.json.result.combatant_id, delta: -99 });
            assert.strictEqual(hit.json.result.hit_points, 0, 'clamped at zero');

            const view = await alice.POST('/api/tool/get_encounter', { encounter_id: eid });
            assert.strictEqual(view.json.result.combatants.length, 2);
            assert.strictEqual(view.json.result.whose_turn, 'Goblin 1');

            // Bob must not see or drive Alice's encounter
            assert.strictEqual(
                (await bob.POST('/api/tool/get_encounter', { encounter_id: eid })).status, 404);
            assert.strictEqual(
                (await bob.POST('/api/tool/advance_turn', { encounter_id: eid })).status, 404);
        });

        await test('the 5e reference is reachable through the same dispatcher', async () => {
            const res = await alice.POST('/api/tool/find_5e_by_name',
                { name: 'goblin', kind: 'monster' });
            if (res.status === 503) return;  // 5etools.db not built in this checkout
            assert.strictEqual(res.status, 200, JSON.stringify(res.json));
            assert.strictEqual(res.json.result[0].id, 'monster/MM/goblin');
        });

        await test('repeated failed logins are rate limited', async () => {
            const attacker = client();
            let sawLimit = false;
            for (let i = 0; i < 15; i++) {
                const res = await attacker.POST('/login',
                    { username: 'alice', password: `guess-${i}` });
                if (res.status === 429) { sawLimit = true; break; }
            }
            assert.ok(sawLimit, 'brute force should hit the limiter');
        });

    } catch (err) {
        console.error('harness error:', err.message);
        console.error(serverLog.split('\n').slice(-25).join('\n'));
        failures.push('harness');
    } finally {
        if (server) server.kill();
        await new Promise((r) => setTimeout(r, 500));
        fs.rmSync(workdir, { recursive: true, force: true });
    }

    if (failures.length) {
        console.error(`\n${failures.length} server test(s) failed. Server output:\n` +
            serverLog.split('\n').map((l) => '    ' + l).join('\n'));
        process.exit(1);
    }
    console.log('server.js: all end-to-end tests OK');
})();
