const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { spawn } = require('child_process');
const app = express();
const path = require('path');
const PORT = 3000;

// Middleware to serve static files
app.use(express.static('public'));
app.use(bodyParser.json());
app.set('view engine', 'ejs');

// Set the views directory
app.set('views', path.join(__dirname, 'views'));

// Start the Python server
const pythonProcess = spawn('python', ['scripts/MythicForge.py']);

// Listen for output from the Python server (for debugging)
pythonProcess.stdout.on('data', (data) => {
    console.log(`Python Server: ${data}`);
});

pythonProcess.stderr.on('data', (data) => {
    console.error(`Python Error: ${data}`);
});

pythonProcess.on('close', (code) => {
    console.log(`Python server exited with code ${code}`);
});

// Route to display the main page

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
app.listen(PORT, () => {
    console.log(`Node.js server running at http://127.0.0.1:${PORT}`);
});

// Ensure Python process is killed when Node.js exits
process.on('exit', () => {
    pythonProcess.kill();
});
process.on('SIGINT', () => {
    pythonProcess.kill();
    process.exit();
});
