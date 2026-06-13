const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');
const env = require('../config/env');
const raidAvalon = require('../modules/raidAvalon/raidAvalon.service');

const dashboardDir = path.resolve(__dirname, '..', '..', 'dashboard');
const maxBodyBytes = 20 * 1024;
let discordClient = null;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function startRaidInscricaoServer(options = {}) {
  discordClient = options.client || null;
  const port = Number(options.port || process.env.PORT || process.env.DASHBOARD_PORT || 3000);
  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error('Falha no servidor de inscricao de raid:', error);
      sendJson(response, 500, { ok: false, error: 'Erro interno ao processar a inscricao.' });
    });
  });

  server.listen(port, () => {
    console.log(`Dashboard e API de raid disponiveis na porta ${port}.`);
  });

  server.on('error', (error) => {
    console.error('Falha ao iniciar dashboard/API de raid:', error);
  });

  return server;
}

async function handleRequest(request, response) {
  const url = new URL(request.url, 'http://localhost');

  if (request.method === 'POST' && url.pathname === '/api/raid-inscricao') {
    try {
      await handleRaidInscricao(request, response);
    } catch (error) {
      if (error.statusCode === 400) {
        sendJson(response, 400, { ok: false, error: error.message });
        return;
      }
      throw error;
    }
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/raid-builds') {
    sendJson(response, 200, { ok: true, builds: raidAvalon.getRaidBuilds() });
    return;
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    serveStatic(request, response, url.pathname);
    return;
  }

  sendJson(response, 405, { ok: false, error: 'Metodo nao permitido.' });
}

async function handleRaidInscricao(request, response) {
  const payload = await readJsonBody(request);
  const result = await raidAvalon.saveRaidInscricao(payload, { client: discordClient });

  if (!result.ok) {
    sendJson(response, 400, { ok: false, errors: result.errors });
    return;
  }

  const webhookUrl = env.requireEnv('DISCORD_WEBHOOK_URL');
  const discordResponse = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(raidAvalon.formatDiscordWebhookMessage(result.data, result.composition))
  });

  if (!discordResponse.ok) {
    const detail = await discordResponse.text().catch(() => '');
    console.error(`Discord webhook falhou com status ${discordResponse.status}: ${detail}`);
    sendJson(response, 502, { ok: false, error: 'Nao foi possivel enviar a inscricao para o Discord.' });
    return;
  }

  sendJson(response, 201, { ok: true });
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

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBodyBytes) {
        reject(new Error('Payload muito grande.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        const invalidJsonError = new Error('JSON invalido.');
        invalidJsonError.statusCode = 400;
        reject(invalidJsonError);
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

module.exports = {
  startRaidInscricaoServer,
  validateRaidInscricao: raidAvalon.validateRaidInscricao,
  formatDiscordMessage: raidAvalon.formatDiscordWebhookMessage
};
