const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { spawn, spawnSync } = require('child_process');
const crypto = require('node:crypto');
const auth = require('./auth');
const app = express();
const path = require('path');
const nodePort = Number(process.env.MYTHICFORGE_PORT) || 3000;
const pythonPort = Number(process.env.MYTHICFORGE_PYTHON_PORT) || 4000;
const dbPath = process.env.MYTHICFORGE_DB || 'MythicForge.db';
// Tests boot the server without pulling ~100MB of 5eTools data over the network.
const skipDownloads = process.env.MYTHICFORGE_SKIP_DOWNLOADS === 'true';
const fs = require('fs');
const fsPromises = require('fs').promises;
const fsExtra = require('fs-extra')
const https = require('https');
const StreamZip = require('node-stream-zip');
const AdmZip = require('adm-zip');
const { rimraf } = require('rimraf');
const { v4: uuidv4 } = require('uuid');

const DEBUG_MODE = process.env.DEBUG_MODE === 'true' || false;

// Bring MythicForge.db up to date before anything opens it. scripts/migrate.py is
// the single owner of schema changes; Node just invokes it.
const migration = spawnSync('python', ['scripts/migrate.py'], {
    encoding: 'utf8',
    env: { ...process.env, MYTHICFORGE_DB: dbPath },
});
if (migration.status !== 0) {
    console.error('Database migration failed, refusing to start:\n' +
        (migration.stderr || migration.error?.message || `exit ${migration.status}`));
    process.exit(1);
}
if (migration.stdout.trim()) console.log(migration.stdout.trim());

const db = auth.openDb(dbPath);
const purged = auth.purgeExpiredSessions(db);
if (purged) console.log(`Purged ${purged} expired session(s)`);

// Shared secret for the internal Node -> Flask hop. Regenerated every boot, so a
// stale value cannot be replayed, and never leaves this machine.
const INTERNAL_SECRET = crypto.randomBytes(32).toString('hex');

// Start the Python server
const pythonProcess = spawn('python', ['scripts/MythicForge.py', '--port', pythonPort], {
    env: {
        ...process.env,
        DEBUG_MODE: DEBUG_MODE.toString(),
        MYTHICFORGE_INTERNAL_SECRET: INTERNAL_SECRET,
        MYTHICFORGE_DB: dbPath,
    }
});

/** Headers identifying the calling user on every internal request to Flask. */
const internalHeaders = (req) => ({
    'X-Forge-Secret': INTERNAL_SECRET,
    'X-Forge-User': String(req.user.user_id),
});

// Listen for output from the Python server (for debugging)
if (DEBUG_MODE) {
    pythonProcess.stdout.on('data', async (data) => {
        console.log(`Python Server: ${data}`);
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`Python Error: ${data}`);
    });
} else {
    pythonProcess.stderr.on('data', (data) => {
        if (data.toString().includes('Error')) {
            console.error(`Python Error: ${data}`);
        }
    });
}

pythonProcess.on('close', (code) => {
    console.log(`Python server exited with code ${code}`);
});

const cleanupDirectory = async (dirPath, maxRetries = 3) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            await rimraf(dirPath);
            return;
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
};

const extractLargeZip = async (zipPath, outputPath) => {
    const zip = new StreamZip.async({ file: zipPath });
    try {
        await zip.extract(null, outputPath);
    } finally {
        await zip.close();
    }
};

const downloadLargeFile = async (url, destination) => {
    const writer = fs.createWriteStream(destination);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
};

const downloadDataFrom5eTools = async () => {
    const zipFilePath = '5etools.zip';
    const dataPath = 'public/data';
    const sourcePath = '5etools/5etools-src-main/data';

    if (!fs.existsSync(dataPath)) {
        console.log('Downloading 5eTools data, Please wait...');
        try {
            const url = 'https://github.com/5etools-mirror-3/5etools-src/archive/refs/heads/master.zip';
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'arraybuffer'
            });

            await fsPromises.writeFile('5etools.zip', response.data);
            console.log('Download complete, extracting...');

            await extractLargeZip('5etools.zip', '5etools');
            await fsPromises.mkdir(dataPath, { recursive: true });

            // Verify source exists
            if (!fs.existsSync(sourcePath)) {
                throw new Error('Source data directory not found after extraction');
            }

            // Move files using async/await
            await fsExtra.move(sourcePath, dataPath, {
                overwrite: true
            });

            // Cleanup
            // Cleanup with retry mechanism
            await cleanupFiles([
                zipFilePath,
                '5etools'
            ]);
            console.log('5eTools data downloaded');
        } catch (error) {
            console.error('Error downloading data:', error);
            throw error;
        }
    }
};

const cleanupFiles = async (paths) => {
    for (const path of paths) {
        try {
            if (await fs.existsSync(path)) {
                if (fs.lstatSync(path).isDirectory()) {
                    await cleanupDirectory(path);
                } else {
                    await unlinkWithRetry(path);
                }
            }
        } catch (error) {
            console.warn(`Warning: Could not cleanup ${path}:`, error.message);
        }
    }
};

const unlinkWithRetry = async (filePath, maxRetries = 3) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            await fsPromises.access(filePath, fs.constants.W_OK);
            await fsPromises.unlink(filePath);
            return;
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
};

const downloadImagesFrom5eTools = async () => {
    const imagePath = 'public/assets/images/5eTools';
    const zipFilePath = '5etools.zip';
    const zipUrl = 'https://github.com/5etools-mirror-3/5etools-img/archive/refs/heads/master.zip';

    if (!fs.existsSync(imagePath)) {
        console.log('Downloading 5eTools images, Please wait, this can take a long while...');
        try {
            await downloadLargeFile(zipUrl, zipFilePath);
            await extractLargeZip(zipFilePath, 'public/assets/images');
            await fsPromises.rename('public/assets/images/5etools-img-main', imagePath);
            await fsPromises.unlink(zipFilePath).catch(() => {});
            console.log('5eTools images downloaded successfully');
        } catch (error) {
            console.error('Error downloading images:', error.message);
            // Cleanup on error
            await fsPromises.rm('public/assets/images/5etools-img-main', { recursive: true, force: true }).catch(() => {});
            await fsPromises.unlink(zipFilePath).catch(() => {});
            throw error;
        }
    }
};
// Build 5etools.db + vault/ from public/data. Skipped once 5etools.db exists;
// run `npm run build-data` to rebuild after the 5etools data is updated.
const build5eData = async () => {
    if (fs.existsSync('5etools.db')) return;
    console.log('Building 5e reference database and vault, this takes a minute...');
    await new Promise((resolve) => {
        const proc = spawn('python', ['scripts/build_5e_data.py'], { stdio: 'inherit' });
        proc.on('close', (code) => {
            if (code !== 0) {
                console.error(`build_5e_data.py exited with ${code}; the MCP server ` +
                    'will not work until it succeeds. Run: npm run build-data');
            }
            resolve();
        });
        proc.on('error', (err) => {
            console.error('Could not run build_5e_data.py:', err.message);
            resolve();
        });
    });
};

// Middleware to serve static files.
// redirect:false matters: public/data is a real directory, so the default
// behaviour 301s /data -> /data/ and shadows the /data API route below.
app.use(express.static('public', { redirect: false }));
app.use(bodyParser.json());
app.set('view engine', 'ejs');
app.set('trust proxy', 1);  // so req.ip is the client, not a reverse proxy

// Set the views directory
app.set('views', path.join(__dirname, 'views'));

const requireAuth = auth.requireAuth(db);
const authLimiter = auth.rateLimiter();

// --- authentication ----------------------------------------------------------

app.get('/login', (req, res) => {
    const session = auth.getSession(db, auth.parseCookies(req.headers.cookie)[auth.SESSION_COOKIE]);
    if (session) return res.redirect('/');
    res.render('login.ejs', { minPassword: auth.MIN_PASSWORD });
});

const startSession = (req, res, userId) => {
    const { sessionId, expires } = auth.createSession(db, userId, req.headers['user-agent']);
    auth.setSessionCookie(res, sessionId, expires);
};

app.post('/register', authLimiter, async (req, res) => {
    try {
        const { username, email, password } = req.body || {};
        const { userId, isAdmin } = await auth.registerUser(db, { username, email, password });
        startSession(req, res, userId);
        res.json({ ok: true, isAdmin });
    } catch (error) {
        if (error instanceof auth.AuthError) return res.status(error.status).json({ error: error.message });
        console.error('Registration failed:', error);
        res.status(500).json({ error: 'Could not create the account' });
    }
});

app.post('/login', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body || {};
        const userId = await auth.authenticate(db, username, password);
        startSession(req, res, userId);
        res.json({ ok: true });
    } catch (error) {
        if (error instanceof auth.AuthError) return res.status(error.status).json({ error: error.message });
        console.error('Login failed:', error);
        res.status(500).json({ error: 'Could not sign in' });
    }
});

app.post('/logout', (req, res) => {
    auth.destroySession(db, auth.parseCookies(req.headers.cookie)[auth.SESSION_COOKIE]);
    auth.clearSessionCookie(res);
    res.json({ ok: true });
});

app.get('/me', requireAuth, (req, res) => {
    res.json({
        userId: req.user.user_id,
        username: req.user.username,
        isAdmin: !!req.user.is_admin,
        allowAiUse: !!req.user.allow_ai_use,
    });
});

// --- application -------------------------------------------------------------

// Route to handle the main page
app.get('/', requireAuth, async (req, res) => {
    try {
        entries = [];
        res.render('index.ejs', { entries });
    } catch (error) {
        console.error('Error handling user session:', error);
        res.status(500).send('Error handling user session');
    }
});

app.get('/data', requireAuth, async (req, res) => {
    try {
        if (!req.query.type) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        const requestData = {
            method: 'GET',
            url: `http://127.0.0.1:${pythonPort}/data`,
            headers: internalHeaders(req),
            params: {
                type: req.query.type,
                q: req.query.q
            }
        };

        const response = await axios(requestData);

        if (!response.data) {
            return res.status(404).json({ error: 'No data found' });
        }

        res.json(response.data);
    } catch (error) {
        console.error('Error fetching data from Python API:', error);
        res.status(500).json({ error: 'Error fetching data' });
    }
});

// One shared API key serves every account, so AI is opt-in per user. The flag
// lives in users.allow_ai_use and defaults to 0.
const requireAiEnabled = (req, res, next) => {
    if (!req.user.allow_ai_use) {
        return res.status(403).json({
            error: 'AI features are not enabled for this account. An admin can enable them.'
        });
    }
    next();
};

// Route to Create a monster story
app.post('/story', requireAuth, requireAiEnabled, async (req, res) => {
    try {
        const response = await axios.post('http://127.0.0.1:'+pythonPort+'/story',
            req.body.monster, { headers: internalHeaders(req) });
        res.json(response.data);
    } catch (error) {
        console.error('Error executing Python function:', error);
        res.status(500).send('Error executing Python function: '+error);
    }
});

// Route to Explain a property
app.post('/prop', requireAuth, requireAiEnabled, async (req, res) => {
    try {
        const response = await axios.post('http://127.0.0.1:'+pythonPort+'/prop',
            req.body, { headers: internalHeaders(req) });
        res.json(response.data);
    } catch (error) {
        console.error('Error executing Python function:', error);
        res.status(500).send('Error executing Python function');
    }
});

/**
 * Proxy a request to the Flask process, passing through its status code so a
 * 404 from a tool does not arrive at the browser as a 500.
 */
const proxyToPython = async (req, res, method, urlPath, body) => {
    try {
        const response = await axios({
            method,
            url: `http://127.0.0.1:${pythonPort}${urlPath}`,
            headers: internalHeaders(req),
            data: body,
            validateStatus: () => true,
        });
        res.status(response.status).json(response.data);
    } catch (error) {
        console.error(`Error calling Python ${urlPath}:`, error.message);
        res.status(502).json({ error: 'The application server is unavailable' });
    }
};

// The write API. One dispatch route over the tool registry in
// scripts/forge_tools.py, shared with the MCP server, so the UI, external MCP
// clients and the Phase 5 agent all drive the same implementation.
app.get('/api/tools', requireAuth, (req, res) =>
    proxyToPython(req, res, 'GET', '/api/tools'));

app.post('/api/tool/:name', requireAuth, (req, res) =>
    proxyToPython(req, res, 'POST', `/api/tool/${encodeURIComponent(req.params.name)}`,
        req.body || {}));

// Start the Node.js server
app.listen(nodePort, async () => {
    if (!skipDownloads) {
        await downloadDataFrom5eTools();
        await build5eData();
        await downloadImagesFrom5eTools();
    }
    console.log(`MythicForge server running at http://127.0.0.1:${nodePort}`);
});

// Ensure Python process is killed when Node.js exits
process.on('exit', () => {
    pythonProcess.kill();
});
process.on('SIGINT', () => {
    pythonProcess.kill();
    process.exit();
});
