const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const dashboardDir = path.resolve(__dirname, '..', '..', 'dashboard');

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function startDashboardServer(options = {}) {
  const port = Number(options.port || process.env.PORT || process.env.DASHBOARD_PORT || 3000);
  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error('Falha no servidor do dashboard:', error);
      sendJson(response, 500, { ok: false, error: 'Erro interno do dashboard.' });
    });
  });

  server.listen(port, () => {
    console.log(`Dashboard disponivel na porta ${port}.`);
  });

  server.on('error', (error) => {
    console.error('Falha ao iniciar dashboard:', error);
  });

  return server;
}

async function handleRequest(request, response) {
  const url = new URL(request.url, 'http://localhost');

  if (request.method === 'GET' || request.method === 'HEAD') {
    serveStatic(request, response, url.pathname);
    return;
  }

  sendJson(response, 405, { ok: false, error: 'Metodo nao permitido.' });
}

function serveStatic(request, response, pathname) {
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(dashboardDir, relativePath);
  const relativeToDashboard = path.relative(dashboardDir, filePath);

  if (relativeToDashboard.startsWith('..') || path.isAbsolute(relativeToDashboard)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    const type = contentTypes[path.extname(filePath)] || 'application/octet-stream';
    response.writeHead(200, { 'content-type': type });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    response.end(content);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

module.exports = {
  startDashboardServer
};
