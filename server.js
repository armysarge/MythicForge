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
const { rimraf } = require('rimraf');

const DEBUG_MODE = process.env.DEBUG_MODE === 'true' || false;

// Start the Python server
const pythonProcess = spawn('python', ['scripts/MythicForge.py'], {
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

const downloadDataFrom5eTools = async () => {
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
            await fsPromises.unlink('5etools.zip');
            await cleanupDirectory('5etools');
            console.log('5eTools data downloaded');
        } catch (error) {
            console.error('Error downloading data:', error);
            throw error;
        }
    }
};

const downloadAndSaveZip = async (url, zipFilePath, maxRetries = 3) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'arraybuffer'
            });
            await fsPromises.writeFile(zipFilePath, response.data);
            return;
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            console.log(`Retrying download (${i + 1}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
};

const extractAndRename = async (zipFilePath, imagePath) => {
    try {
        await fsPromises.mkdir('public/assets/images', { recursive: true });
        await StreamZip(zipFilePath, 'public/assets/images');
        await fsPromises.rename('public/assets/images/5etools-img-main', imagePath);
    } catch (error) {
        console.error('Error extracting ZIP file:', error);
        throw error;
    }
};

const downloadImagesFrom5eTools = async () => {
    const imagePath = 'public/assets/images/5eTools';
    const zipFilePath = '5etools.zip';
    const zipUrl = 'https://github.com/5etools-mirror-3/5etools-img/archive/refs/heads/master.zip';

    if (!fs.existsSync(imagePath)) {
        console.log('Downloading 5eTools images, Please wait, this can take a long while...');
        try {
            if (fs.existsSync(zipFilePath)) {
                await extractAndRename(zipFilePath, imagePath);
            } else {
                await downloadAndSaveZip(zipUrl, zipFilePath);
                await extractAndRename(zipFilePath, imagePath);
                await fsPromises.unlink(zipFilePath);
            }
            console.log('5eTools images downloaded');
        } catch (error) {
            console.error('Error downloading images:', error);
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
        //const response = await axios.get('http://127.0.0.1:5000/data');
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
            url: 'http://127.0.0.1:5000/data?type='+req.query.type+'&q='+req.query.q,
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
        const response = await axios.post('http://127.0.0.1:5000/story', req.body.monster);
        res.json(response.data);
    } catch (error) {
        console.error('Error executing Python function:', error);
        res.status(500).send('Error executing Python function');
    }
});

// Route to trigger a Python function
app.post('/execute', async (req, res) => {
    try {
        const response = await axios.post('http://127.0.0.1:5000/execute', req.body);
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
