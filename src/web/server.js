const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const ids = require('../config/ids');
const env = require('../config/env');
const { getDashboardData } = require('./dashboard.repository');
const { completeOnboarding, ensureGuestMember, onboardingConfigured } = require('./onboarding');
const {
  JOIN_OAUTH_STATE_COOKIE,
  JOIN_SESSION_COOKIE,
  JOIN_SESSION_MAX_AGE_SECONDS,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_SECONDS,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  clearCookie,
  cookie,
  createJoinSession,
  createOAuthState,
  createSession,
  parseCookies,
  readJoinSession,
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

async function exchangeDiscordCode(code, redirectUri, fetchImpl = fetch) {
  const body = new URLSearchParams({
    client_id: env.discordClientId,
    client_secret: env.discordClientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  });
  const tokenResponse = await fetchImpl('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!tokenResponse.ok) throw new Error(`Discord recusou o código OAuth (${tokenResponse.status}).`);
  const token = await tokenResponse.json();
  const userResponse = await fetchImpl('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${token.access_token}` }
  });
  if (!userResponse.ok) throw new Error(`Discord não retornou o usuário (${userResponse.status}).`);
  return { token, user: await userResponse.json() };
}

function readFormBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > limit) {
        tooLarge = true;
        reject(new Error('Formulário muito grande.'));
      }
    });
    req.on('end', () => { if (!tooLarge) resolve(new URLSearchParams(body)); });
    req.on('error', reject);
  });
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

function createRequestHandler(client, options = {}) {
  const isProduction = env.nodeEnv === 'production';
  const secureCookie = isProduction || env.dashboardBaseUrl.startsWith('https://');
  const fetchImpl = options.fetchImpl || fetch;

  return async function handleRequest(req, res) {
    const url = new URL(req.url, env.dashboardBaseUrl);
    const cookies = parseCookies(req.headers.cookie);
    const session = readSession(cookies[SESSION_COOKIE], env.dashboardSessionSecret);
    const joinSession = readJoinSession(cookies[JOIN_SESSION_COOKIE], env.dashboardSessionSecret);

    try {
      if (req.method === 'POST' && url.pathname === '/api/join/complete') {
        if (!joinSession) return json(res, 401, { error: 'Sua sessão de entrada expirou. Comece novamente.' }, isProduction);
        const expectedOrigin = new URL(env.dashboardBaseUrl).origin;
        if (req.headers.origin !== expectedOrigin) return json(res, 403, { error: 'Origem inválida.' }, isProduction);
        if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) {
          return json(res, 415, { error: 'Formato de formulário inválido.' }, isProduction);
        }
        const form = await readFormBody(req);
        if (form.get('csrf') !== joinSession.csrf) return json(res, 403, { error: 'Validação de segurança inválida.' }, isProduction);
        try {
          const result = await completeOnboarding(client, joinSession, form.get('albionName'), { fetchImpl });
          return json(res, 200, result, isProduction);
        } catch (error) {
          console.error('[ONBOARDING] Falha ao concluir cadastro:', error);
          const safeMessage = /^(Informe|O nome|A consulta|Personagem|Esse personagem|Sua conta)/.test(error.message)
            ? error.message
            : 'Não foi possível atualizar seu apelido ou cargo. Procure a staff.';
          return json(res, 400, { error: safeMessage }, isProduction);
        }
      }
      if (req.method !== 'GET') {
        send(res, 405, 'Método não permitido.', { Allow: 'GET', 'Content-Type': 'text/plain; charset=utf-8' }, isProduction);
        return;
      }
      if (url.pathname === '/') return serveFile(res, 'index.html', isProduction, 'public, max-age=300');
      if (url.pathname === '/join') {
        if (!joinSession) return redirect(res, '/?join=required', {}, isProduction);
        return serveFile(res, 'join.html', isProduction, 'private, no-store');
      }
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
        const { user: discordUser } = await exchangeDiscordCode(code, `${env.dashboardBaseUrl}/auth/discord/callback`, fetchImpl);
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
      if (url.pathname === '/join/discord') {
        if (!configuredForOAuth() || !onboardingConfigured()) return redirect(res, '/?join=unavailable', {}, isProduction);
        const state = createOAuthState(env.dashboardSessionSecret);
        const redirectUri = `${env.dashboardBaseUrl}/join/discord/callback`;
        const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
        authorizeUrl.search = new URLSearchParams({
          client_id: env.discordClientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'identify guilds.join',
          state
        });
        return redirect(res, authorizeUrl.toString(), {
          'Set-Cookie': cookie(JOIN_OAUTH_STATE_COOKIE, state, { maxAge: OAUTH_STATE_MAX_AGE_SECONDS, secure: secureCookie })
        }, isProduction);
      }
      if (url.pathname === '/join/discord/callback') {
        const returnedState = url.searchParams.get('state');
        const storedState = cookies[JOIN_OAUTH_STATE_COOKIE];
        if (!returnedState || returnedState !== storedState || !validateOAuthState(storedState, env.dashboardSessionSecret)) {
          return redirect(res, '/?join=invalid', { 'Set-Cookie': clearCookie(JOIN_OAUTH_STATE_COOKIE, secureCookie) }, isProduction);
        }
        const code = url.searchParams.get('code');
        if (!code) return redirect(res, '/?join=cancelled', { 'Set-Cookie': clearCookie(JOIN_OAUTH_STATE_COOKIE, secureCookie) }, isProduction);
        const { token, user: discordUser } = await exchangeDiscordCode(code, `${env.dashboardBaseUrl}/join/discord/callback`, fetchImpl);
        await ensureGuestMember(client, discordUser, token.access_token);
        const joinToken = createJoinSession(discordUser, env.dashboardSessionSecret);
        return redirect(res, '/join', {
          'Set-Cookie': [
            cookie(JOIN_SESSION_COOKIE, joinToken, { maxAge: JOIN_SESSION_MAX_AGE_SECONDS, secure: secureCookie }),
            clearCookie(JOIN_OAUTH_STATE_COOKIE, secureCookie)
          ]
        }, isProduction);
      }
      if (url.pathname === '/auth/logout') {
        return redirect(res, '/', { 'Set-Cookie': clearCookie(SESSION_COOKIE, secureCookie) }, isProduction);
      }
      if (url.pathname === '/api/join-session') {
        if (!joinSession) return json(res, 401, { error: 'Sessão de entrada necessária.' }, isProduction);
        return json(res, 200, { user: {
          id: joinSession.id,
          name: joinSession.globalName || joinSession.username,
          username: joinSession.username,
          avatarUrl: avatarUrl(joinSession)
        }, csrf: joinSession.csrf }, isProduction);
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
      if (url.pathname.startsWith('/join/')) return redirect(res, '/?join=error', {}, isProduction);
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
