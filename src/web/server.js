const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const ids = require('../config/ids');
const env = require('../config/env');
const { getDashboardData } = require('./dashboard.repository');
const {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_SECONDS,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  clearCookie,
  cookie,
  createOAuthState,
  createSession,
  parseCookies,
  readSession,
  validateOAuthState
} = require('./auth');

const PUBLIC_DIR = path.join(__dirname, 'public');
const ALLOWED_STAFF_ROLES = new Set([ids.roles.adm, ids.roles.staff].filter(Boolean));
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

function securityHeaders(isProduction) {
  const headers = {
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https://cdn.discordapp.com data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://discord.com",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  };
  if (isProduction) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

function send(res, status, body, headers = {}, isProduction = false) {
  res.writeHead(status, { ...securityHeaders(isProduction), ...headers });
  res.end(body);
}

function redirect(res, location, headers = {}, isProduction = false) {
  send(res, 302, '', { Location: location, ...headers }, isProduction);
}

function json(res, status, value, isProduction) {
  send(res, status, JSON.stringify(value), {
    'Cache-Control': 'private, no-store',
    'Content-Type': 'application/json; charset=utf-8'
  }, isProduction);
}

function serveFile(res, filename, isProduction, cache = 'public, max-age=3600') {
  const fullPath = path.join(PUBLIC_DIR, filename);
  if (!fullPath.startsWith(PUBLIC_DIR) || !fs.existsSync(fullPath)) {
    send(res, 404, 'Não encontrado.', { 'Content-Type': 'text/plain; charset=utf-8' }, isProduction);
    return;
  }
  const ext = path.extname(fullPath).toLowerCase();
  send(res, 200, fs.readFileSync(fullPath), {
    'Cache-Control': cache,
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream'
  }, isProduction);
}

function avatarUrl(user) {
  if (!user.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=96`;
}

async function exchangeDiscordCode(code, redirectUri) {
  const body = new URLSearchParams({
    client_id: env.discordClientId,
    client_secret: env.discordClientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  });
  const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!tokenResponse.ok) throw new Error(`Discord recusou o código OAuth (${tokenResponse.status}).`);
  const token = await tokenResponse.json();
  const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${token.access_token}` }
  });
  if (!userResponse.ok) throw new Error(`Discord não retornou o usuário (${userResponse.status}).`);
  return userResponse.json();
}

async function authorizeStaff(client, discordUser) {
  const guild = await client.guilds.fetch(ids.guildId);
  const member = await guild.members.fetch(discordUser.id);
  const roles = [...member.roles.cache.keys()];
  const allowed = member.id === guild.ownerId || roles.some((roleId) => ALLOWED_STAFF_ROLES.has(roleId));
  return { allowed, roles };
}

async function sessionStillAuthorized(client, session) {
  if (!session || !client?.guilds) return false;
  const guild = client.guilds.cache?.get(ids.guildId) || await client.guilds.fetch(ids.guildId);
  const member = guild.members.cache?.get(session.id) || await guild.members.fetch(session.id);
  return member.id === guild.ownerId || [...member.roles.cache.keys()].some((roleId) => ALLOWED_STAFF_ROLES.has(roleId));
}

function configuredForOAuth() {
  return Boolean(env.discordClientId && env.discordClientSecret && env.dashboardSessionSecret && env.dashboardBaseUrl);
}

function createRequestHandler(client) {
  const isProduction = env.nodeEnv === 'production';
  const secureCookie = isProduction || env.dashboardBaseUrl.startsWith('https://');

  return async function handleRequest(req, res) {
    const url = new URL(req.url, env.dashboardBaseUrl);
    const cookies = parseCookies(req.headers.cookie);
    const session = readSession(cookies[SESSION_COOKIE], env.dashboardSessionSecret);

    try {
      if (req.method !== 'GET') {
        send(res, 405, 'Método não permitido.', { Allow: 'GET', 'Content-Type': 'text/plain; charset=utf-8' }, isProduction);
        return;
      }
      if (url.pathname === '/') return serveFile(res, 'index.html', isProduction, 'public, max-age=300');
      if (url.pathname === '/dashboard') {
        if (!session) return redirect(res, '/?login=required', {}, isProduction);
        if (!await sessionStillAuthorized(client, session)) {
          return redirect(res, '/?auth=forbidden', { 'Set-Cookie': clearCookie(SESSION_COOKIE, secureCookie) }, isProduction);
        }
        return serveFile(res, 'dashboard.html', isProduction, 'private, no-store');
      }
      if (url.pathname === '/auth/discord') {
        if (!configuredForOAuth()) return redirect(res, '/?auth=unavailable', {}, isProduction);
        const state = createOAuthState(env.dashboardSessionSecret);
        const redirectUri = `${env.dashboardBaseUrl}/auth/discord/callback`;
        const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
        authorizeUrl.search = new URLSearchParams({
          client_id: env.discordClientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'identify',
          state
        });
        return redirect(res, authorizeUrl.toString(), {
          'Set-Cookie': cookie(OAUTH_STATE_COOKIE, state, { maxAge: OAUTH_STATE_MAX_AGE_SECONDS, secure: secureCookie })
        }, isProduction);
      }
      if (url.pathname === '/auth/discord/callback') {
        const returnedState = url.searchParams.get('state');
        const storedState = cookies[OAUTH_STATE_COOKIE];
        if (!returnedState || returnedState !== storedState || !validateOAuthState(storedState, env.dashboardSessionSecret)) {
          return redirect(res, '/?auth=invalid', { 'Set-Cookie': clearCookie(OAUTH_STATE_COOKIE, secureCookie) }, isProduction);
        }
        const code = url.searchParams.get('code');
        if (!code) return redirect(res, '/?auth=cancelled', { 'Set-Cookie': clearCookie(OAUTH_STATE_COOKIE, secureCookie) }, isProduction);
        const discordUser = await exchangeDiscordCode(code, `${env.dashboardBaseUrl}/auth/discord/callback`);
        const access = await authorizeStaff(client, discordUser);
        if (!access.allowed) return redirect(res, '/?auth=forbidden', { 'Set-Cookie': clearCookie(OAUTH_STATE_COOKIE, secureCookie) }, isProduction);
        const sessionToken = createSession({ ...discordUser, roles: access.roles }, env.dashboardSessionSecret);
        return redirect(res, '/dashboard', {
          'Set-Cookie': [
            cookie(SESSION_COOKIE, sessionToken, { maxAge: SESSION_MAX_AGE_SECONDS, secure: secureCookie }),
            clearCookie(OAUTH_STATE_COOKIE, secureCookie)
          ]
        }, isProduction);
      }
      if (url.pathname === '/auth/logout') {
        return redirect(res, '/', { 'Set-Cookie': clearCookie(SESSION_COOKIE, secureCookie) }, isProduction);
      }
      if (url.pathname === '/api/session') {
        if (!session) return json(res, 401, { error: 'Sessão necessária.' }, isProduction);
        if (!await sessionStillAuthorized(client, session)) return json(res, 403, { error: 'Acesso de staff necessário.' }, isProduction);
        return json(res, 200, { user: {
          id: session.id,
          name: session.globalName || session.username,
          username: session.username,
          avatarUrl: avatarUrl(session)
        } }, isProduction);
      }
      if (url.pathname === '/api/dashboard') {
        if (!session) return json(res, 401, { error: 'Sessão necessária.' }, isProduction);
        if (!await sessionStillAuthorized(client, session)) return json(res, 403, { error: 'Acesso de staff necessário.' }, isProduction);
        return json(res, 200, getDashboardData(), isProduction);
      }
      if (url.pathname === '/health') return json(res, 200, { status: 'ok', service: 'notag-dashboard' }, isProduction);
      if (url.pathname.startsWith('/assets/')) return serveFile(res, url.pathname.slice(1), isProduction);
      return send(res, 404, 'Não encontrado.', { 'Content-Type': 'text/plain; charset=utf-8' }, isProduction);
    } catch (error) {
      console.error('[DASHBOARD] Falha ao processar requisição:', error);
      if (url.pathname.startsWith('/api/')) return json(res, 500, { error: 'Não foi possível carregar os dados.' }, isProduction);
      return redirect(res, '/?auth=error', {}, isProduction);
    }
  };
}

function startWebServer(client) {
  const server = http.createServer(createRequestHandler(client));
  server.listen(env.dashboardPort, env.dashboardHost, () => {
    console.log(`[DASHBOARD] Online em ${env.dashboardBaseUrl} (${env.dashboardHost}:${env.dashboardPort}).`);
  });
  return server;
}

module.exports = { createRequestHandler, startWebServer };
