const { spawn } = require('child_process');
const express = require('express');
const forceSSL = require('express-force-ssl');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const publicIp = require('public-ip');
const si = require('systeminformation');
const socket = require('socket.io');

let info = {};

// run webserver

const app = express();
const httpServer = http.createServer(app);
const httpsServer = https.createServer({
	key: fs.readFileSync('./sslcert/privkey.pem', 'utf8'),
	cert: fs.readFileSync('./sslcert/fullchain.pem', 'utf8')
}, app);

app.use(forceSSL);
app.use(express.static(path.join(__dirname, 'static')));

app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

app.get('/', (req, res) => {
	res.render('index', {
		address: info.ip,
		distro: info.distro,
		release: info.release,
		kernel: info.kernel,
		arch: info.arch
	});
});

httpServer.listen(8080, () => {
	console.log('HTTP server running on 8080');
});
httpsServer.listen(8443, () => {
	console.log('HTTPS server running on 8443');
});

// setup websockets

let clients = {};
let data = {};

const io = socket(httpsServer);

io.on('connection', client => {
	client.emit('update', data);
	clients[client.id] = client;
	client.on('diconnect', () => {
		delete clients[client.id];
	});
});

// build static info object

publicIp.v4().then(ip => {
	info.ip = ip;
});

si.osInfo(o => {
	info.distro = o.distro;
	info.release = o.release;
	info.kernel = o.kernel;
	info.arch = o.arch;
});

// build dynamic data object

setInterval(() => {
	// CPU temperature
	si.cpuTemperature(o => {
		o.main = Math.round(o.main);
		data.temp = o.main;
	});
	// CPU usage
	const ps = spawn('sh', ['-c', 'ps -A -o pcpu | tail -n+2 | paste -sd+ | bc']);
	ps.stdout.on('data', value => {
		data.node = parseFloat(value) / cpus.length;
	});
	// average load
	const cpus = os.cpus();
	const loadavg = os.loadavg();
	for (const i in loadavg) {
		const value = Math.round(100 * loadavg[i] / cpus.length);
		loadavg[i] = { value: value };
	}
	loadavg[0].text = '1 minute';
	loadavg[1].text = '5 minutes';
	loadavg[2].text = '15 minutes';
	data.loadavg = loadavg;
	// memory
	si.mem(o => {
		o.active = Math.round(o.active / 1000000);
		o.total = Math.round(o.total / 1000000);
		o.swapused = Math.round(o.swapused / 1000000);
		o.swaptotal = Math.round(o.swaptotal / 1000000);
		data.memUsed = o.active;
		data.memTotal = o.total;
		data.swapUsed = o.swapused;
		data.swapTotal = o.swaptotal;
	});
	// send data to clients
	for (const key in clients) {
		clients[key].emit('update', data);
	}
}, 1000);
