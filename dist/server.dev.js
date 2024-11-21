"use strict";

var express = require('express');

var bodyParser = require('body-parser');

var axios = require('axios');

var _require = require('child_process'),
    spawn = _require.spawn;

var app = express();
var PORT = 3000; // Middleware to serve static files

app.use(express["static"]('public'));
app.use(bodyParser.json());
app.set('view engine', 'ejs'); // Start the Python server

var pythonProcess = spawn('python', ['scripts/app.py']); // Listen for output from the Python server (for debugging)

pythonProcess.stdout.on('data', function (data) {
  console.log("Python Server: ".concat(data));
});
pythonProcess.stderr.on('data', function (data) {
  console.error("Python Error: ".concat(data));
});
pythonProcess.on('close', function (code) {
  console.log("Python server exited with code ".concat(code));
}); // Route to display the main page

app.get('/', function _callee(req, res) {
  var response, entries;
  return regeneratorRuntime.async(function _callee$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          _context.prev = 0;
          _context.next = 3;
          return regeneratorRuntime.awrap(axios.get('http://127.0.0.1:5000/data'));

        case 3:
          response = _context.sent;
          entries = response.data; // Render the page with data

          res.render('index', {
            entries: entries
          });
          _context.next = 12;
          break;

        case 8:
          _context.prev = 8;
          _context.t0 = _context["catch"](0);
          console.error('Error fetching data from Python API:', _context.t0);
          res.status(500).send('Error fetching data');

        case 12:
        case "end":
          return _context.stop();
      }
    }
  }, null, null, [[0, 8]]);
}); // Route to trigger a Python function

app.post('/execute', function _callee2(req, res) {
  var response;
  return regeneratorRuntime.async(function _callee2$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          _context2.prev = 0;
          _context2.next = 3;
          return regeneratorRuntime.awrap(axios.post('http://127.0.0.1:5000/execute', req.body));

        case 3:
          response = _context2.sent;
          res.json(response.data);
          _context2.next = 11;
          break;

        case 7:
          _context2.prev = 7;
          _context2.t0 = _context2["catch"](0);
          console.error('Error executing Python function:', _context2.t0);
          res.status(500).send('Error executing Python function');

        case 11:
        case "end":
          return _context2.stop();
      }
    }
  }, null, null, [[0, 7]]);
}); // Start the Node.js server

app.listen(PORT, function () {
  console.log("Node.js server running at http://127.0.0.1:".concat(PORT));
}); // Ensure Python process is killed when Node.js exits

process.on('exit', function () {
  pythonProcess.kill();
});
process.on('SIGINT', function () {
  pythonProcess.kill();
  process.exit();
});