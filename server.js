const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { spawn } = require('child_process');
const app = express();
const path = require('path');
const PORT = 3000;
const fs = require('fs');
const fsPromises = require('fs').promises;
const fsExtra = require('fs-extra')
const https = require('https');
const StreamZip = require('node-stream-zip');
const AdmZip = require('adm-zip');
const { rimraf } = require('rimraf');

const DEBUG_MODE = process.env.DEBUG_MODE === 'true' || false;

// Start the Python server
const pythonProcess = spawn('python', ['scripts/MythicForge.py', '--port', '4000'], {
    env: { ...process.env, DEBUG_MODE: DEBUG_MODE.toString() }
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
// Middleware to serve static files
app.use(express.static('public'));
app.use(bodyParser.json());
app.set('view engine', 'ejs');

// Set the views directory
app.set('views', path.join(__dirname, 'views'));

app.get('/', async (req, res) => {
    try {
        // Fetch data from the Python API
        //const response = await axios.get('http://127.0.0.1:4000/data');
        //const entries = response.data;

        // Render the page with data
        entries = []
        res.render('index.ejs', { entries });
    } catch (error) {
        console.error('Error fetching data from Python API:', error);
        res.status(500).send('Error fetching data');
    }
});

app.get('/data', async (req, res) => {
    try {
        // Fetch data from the Python API
        const requestData = {
            method: 'GET',
            url: 'http://127.0.0.1:4000/data?type='+req.query.type+'&q='+req.query.q,
        };
        const response = await axios(requestData);
        const entries = response.data;

        // Render the page with data
        res.json(entries);
    } catch (error) {
        console.error('Error fetching data from Python API:', error);
        res.status(500).send('Error fetching data');
    }
});

// Route to trigger a Python function
app.post('/story', async (req, res) => {
    try {
        const response = await axios.post('http://127.0.0.1:4000/story', req.body.monster);
        res.json(response.data);
    } catch (error) {
        console.error('Error executing Python function:', error);
        res.status(500).send('Error executing Python function');
    }
});

// Route to trigger a Python function
app.post('/execute', async (req, res) => {
    try {
        const response = await axios.post('http://127.0.0.1:4000/execute', req.body);
        res.json(response.data);
    } catch (error) {
        console.error('Error executing Python function:', error);
        res.status(500).send('Error executing Python function');
    }
});

// Start the Node.js server
app.listen(PORT, async () => {
    await downloadDataFrom5eTools();
    await downloadImagesFrom5eTools();
    console.log(`MythicForge server running at http://127.0.0.1:${PORT}`);
});

// Ensure Python process is killed when Node.js exits
process.on('exit', () => {
    pythonProcess.kill();
});
process.on('SIGINT', () => {
    pythonProcess.kill();
    process.exit();
});
