const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');
const env = require('../config/env');

const dashboardDir = path.resolve(__dirname, '..', '..', 'dashboard');
const maxBodyBytes = 20 * 1024;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function startRaidInscricaoServer(options = {}) {
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
    await handleRaidInscricao(request, response);
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
  const validation = validateRaidInscricao(payload);

  if (!validation.ok) {
    sendJson(response, 400, { ok: false, errors: validation.errors });
    return;
  }

  const webhookUrl = env.requireEnv('DISCORD_WEBHOOK_URL');
  const discordResponse = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(formatDiscordMessage(validation.data))
  });

  if (!discordResponse.ok) {
    const detail = await discordResponse.text().catch(() => '');
    console.error(`Discord webhook falhou com status ${discordResponse.status}: ${detail}`);
    sendJson(response, 502, { ok: false, error: 'Nao foi possivel enviar a inscricao para o Discord.' });
    return;
  }

  sendJson(response, 201, { ok: true });
}

function validateRaidInscricao(payload) {
  const errors = [];
  const nick = cleanText(payload?.nick);
  const horarios = cleanList(payload?.horarios);
  const armas = cleanList(payload?.armas);
  const casaHoLoch = payload?.casaHoLoch === true;
  const portalMartlock = payload?.portalMartlock === true;

  if (!/^[\w .'-]{2,32}$/.test(nick)) {
    errors.push('Informe um nick valido com 2 a 32 caracteres.');
  }

  if (horarios.length === 0 || horarios.some((horario) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(horario))) {
    errors.push('Informe pelo menos um horario valido no formato HH:mm.');
  }

  if (armas.length === 0 || armas.some((arma) => arma.length < 2 || arma.length > 60)) {
    errors.push('Informe pelo menos uma arma valida.');
  }

  if (!casaHoLoch) {
    errors.push('Confirme que sua casa esta na HO Loch.');
  }

  if (!portalMartlock) {
    errors.push('Confirme que seu portal esta em Martlock.');
  }

  return {
    ok: errors.length === 0,
    errors,
    data: { nick, horarios, armas, casaHoLoch, portalMartlock }
  };
}

function formatDiscordMessage(data) {
  return {
    username: 'Inscricoes Raid Notag',
    embeds: [
      {
        title: 'Nova inscricao para raid',
        color: 0x0f766e,
        fields: [
          { name: 'Nick', value: data.nick, inline: true },
          { name: 'Horarios', value: data.horarios.join(', '), inline: true },
          { name: 'Armas', value: data.armas.join(', '), inline: false },
          { name: 'Casa', value: 'HO Loch confirmada', inline: true },
          { name: 'Portal', value: 'Martlock confirmado', inline: true }
        ],
        timestamp: new Date().toISOString()
      }
    ]
  };
}

function serveStatic(request, response, pathname) {
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(dashboardDir, relativePath);

  if (!filePath.startsWith(dashboardDir)) {
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
        reject(new Error('JSON invalido.'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function cleanList(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

module.exports = {
  startRaidInscricaoServer,
  validateRaidInscricao,
  formatDiscordMessage
};
