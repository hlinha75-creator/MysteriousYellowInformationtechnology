const http = require('http');
const fs = require('fs');
const path = require('path');
const env = require('../../config/env');
const idleGame = require('./idleGame.service');

const publicDir = path.join(__dirname, 'public');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };

function startDashboard() {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify(idleGame.getDashboardState()));
    }
    const requestPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const file = path.join(publicDir, path.basename(requestPath));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('Nao encontrado'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  server.listen(env.dashboardPort, '0.0.0.0', () => console.log(`Dashboard idle em http://localhost:${env.dashboardPort}`));
  server.on('error', (error) => console.error('Falha no dashboard idle:', error));
  return server;
}
module.exports = { startDashboard };
