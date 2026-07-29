const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notag-dashboard-test-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempRoot, 'dashboard.sqlite');

const { getDatabase } = require('../src/database/connection');
const env = require('../src/config/env');
const { migrate } = require('../src/database/migrate');
const { getDashboardData } = require('../src/web/dashboard.repository');
const { createRequestHandler } = require('../src/web/server');
const {
  JOIN_SESSION_COOKIE,
  PORTAL_SESSION_COOKIE,
  SESSION_COOKIE,
  createJoinSession,
  createOAuthState,
  createPortalSession,
  createSession,
  readJoinSession,
  readPortalSession,
  readSession,
  validateOAuthState
} = require('../src/web/auth');

migrate();

test('sessão do dashboard é assinada e expira', () => {
  const secret = 'segredo-de-teste-comprido';
  const now = Date.parse('2026-07-28T12:00:00Z');
  const token = createSession({ id: 'staff-1', username: 'Staff', global_name: 'Equipe', roles: ['adm'] }, secret, now);
  assert.equal(readSession(token, secret, now + 1000).id, 'staff-1');
  assert.equal(readSession(`${token}x`, secret, now + 1000), null);
  assert.equal(readSession(token, secret, now + (6 * 24 * 60 * 60 * 1000)).id, 'staff-1');
  assert.equal(readSession(token, secret, now + (8 * 24 * 60 * 60 * 1000)), null);
});

test('state OAuth é verificável e expira', () => {
  const secret = 'outro-segredo-de-teste';
  const now = Date.parse('2026-07-28T12:00:00Z');
  const state = createOAuthState(secret, now);
  assert.equal(validateOAuthState(state, secret, now + 1000), true);
  assert.equal(validateOAuthState(state, 'segredo-incorreto', now + 1000), false);
  assert.equal(validateOAuthState(state, secret, now + (11 * 60 * 1000)), false);
});

test('sessão pública de entrada é separada da sessão da staff', () => {
  const secret = 'segredo-publico-de-teste';
  const now = Date.parse('2026-07-28T12:00:00Z');
  const token = createJoinSession({ id: 'visitante-1', username: 'Visitante', global_name: 'Novo jogador' }, secret, now);
  assert.equal(readJoinSession(token, secret, now + 1000).id, 'visitante-1');
  assert.equal(readSession(token, secret, now + 1000), null);
  assert.equal(readJoinSession(token, secret, now + (31 * 60 * 1000)), null);
});

test('sessão do portal usa 30 dias para membro e 7 dias para acesso privilegiado', () => {
  const secret = 'segredo-do-portal-de-teste';
  const now = Date.parse('2026-07-28T12:00:00Z');
  const memberToken = createPortalSession({ id: 'member-session', username: 'Membro' }, secret, { accessLevel: 'member' }, now);
  const staffToken = createPortalSession({ id: 'staff-session', username: 'Staff' }, secret, { accessLevel: 'member', privileged: true }, now);
  assert.equal(readPortalSession(memberToken, secret, now + (29 * 24 * 60 * 60 * 1000)).id, 'member-session');
  assert.equal(readPortalSession(memberToken, secret, now + (31 * 24 * 60 * 60 * 1000)), null);
  assert.equal(readPortalSession(staffToken, secret, now + (6 * 24 * 60 * 60 * 1000)).id, 'staff-session');
  assert.equal(readPortalSession(staffToken, secret, now + (8 * 24 * 60 * 60 * 1000)), null);
  assert.equal(readSession(memberToken, secret, now + 1000), null);
});

test('dashboard reconcilia membros, saldos, campanha e rankings', () => {
  const db = getDatabase();
  db.prepare("INSERT INTO users (discord_id, discord_name, albion_name, registration_status) VALUES ('u1', 'Discord Um', 'AlbionUm', 'member')").run();
  db.prepare("INSERT INTO users (discord_id, discord_name, albion_name, registration_status) VALUES ('u2', 'Discord Dois', 'AlbionDois', 'member')").run();
  db.prepare("INSERT INTO balances (discord_id, balance) VALUES ('u1', 1000)").run();
  db.prepare("INSERT INTO balances (discord_id, balance) VALUES ('u2', 2500)").run();
  db.prepare("INSERT INTO balance_transactions (type, user_id, amount, before_balance, after_balance, reason, created_by) VALUES ('quick_deposit', 'u1', 1000, 0, 1000, 'Teste', 'staff')").run();
  const campaign = db.prepare("SELECT id FROM campaigns WHERE status = 'open' LIMIT 1").get();
  db.prepare("INSERT INTO campaign_contributions (campaign_id, user_id, amount, source_type, status, created_by) VALUES (?, 'u1', 500, 'manual', 'approved', 'staff')").run(campaign.id);
  db.prepare("INSERT INTO events (event_code, creator_id, title, status, ended_at) VALUES ('EVT-WEB-1', 'staff', 'World Boss', 'approved', CURRENT_TIMESTAMP)").run();
  const eventId = db.prepare("SELECT id FROM events WHERE event_code = 'EVT-WEB-1'").get().id;
  db.prepare("INSERT INTO event_participants (event_id, discord_id, role, calculated_seconds) VALUES (?, 'u1', 'dps', 3600)").run(eventId);

  const data = getDashboardData();
  assert.equal(data.overview.activeMembers, 2);
  assert.equal(data.overview.totalMemberBalance, 3500);
  assert.equal(data.overview.campaign.raised, 500);
  assert.equal(data.overview.recentDeposits.length, 1);
  assert.equal(data.rankings.participation.rows[0].albion_name, 'AlbionUm');
  assert.equal(data.rankings.participation.rows[0].events, 1);
  assert.equal(data.members.length, 2);
});

test('servidor publica landing e protege a API do dashboard', async (t) => {
  const server = require('node:http').createServer(createRequestHandler({}));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');

  const landing = await fetch(`${base}/`);
  assert.equal(landing.status, 200);
  assert.match(await landing.text(), /PvE, Farm de World Boss e Roaming/);

  const joinToken = createJoinSession({ id: 'visitante-web', username: 'Visitante' }, process.env.DASHBOARD_SESSION_SECRET);
  const joinPage = await fetch(`${base}/join`, { headers: { Cookie: `${JOIN_SESSION_COOKIE}=${joinToken}` } });
  assert.equal(joinPage.status, 200);
  assert.match(await joinPage.text(), /Qual é o seu personagem no Albion/);

  const joinOAuth = await fetch(`${base}/join/discord`, { redirect: 'manual' });
  assert.equal(joinOAuth.status, 302);
  assert.match(joinOAuth.headers.get('location'), /scope=identify(?:\+|%20)guilds\.join/);

  const dashboard = await fetch(`${base}/api/dashboard`);
  assert.equal(dashboard.status, 401);

  const portal = await fetch(`${base}/portal`, { redirect: 'manual' });
  assert.equal(portal.status, 302);
  assert.equal(portal.headers.get('location'), '/?portal=required');
});

test('portal entrega somente os dados pessoais e oculta rankings de convidado', async (t) => {
  const db = getDatabase();
  const discordId = 'portal-guest-web';
  db.prepare("INSERT OR REPLACE INTO users (discord_id, discord_name, albion_name, registration_status) VALUES (?, 'Convidado Web', 'HeroiPortal', 'guest')").run(discordId);
  db.prepare('INSERT OR REPLACE INTO balances (discord_id, balance) VALUES (?, 4321)').run(discordId);
  db.prepare("INSERT INTO balance_transactions (type, user_id, amount, before_balance, after_balance, reason, created_by) VALUES ('portal_test', ?, 4321, 0, 4321, 'Crédito pessoal', 'staff')").run(discordId);
  const member = { id: discordId, roles: { cache: new Map([['1481251365857525782', {}]]) } };
  const guild = { ownerId: 'owner', members: { async fetch() { return member; } } };
  const client = { guilds: { cache: new Map(), async fetch() { return guild; } } };
  const server = require('node:http').createServer(createRequestHandler(client));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = createPortalSession({ id: discordId, username: 'Convidado Web' }, process.env.DASHBOARD_SESSION_SECRET, { accessLevel: 'guest' });

  const response = await fetch(`${base}/api/portal`, { headers: { Cookie: `${PORTAL_SESSION_COOKIE}=${token}` } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.profile.albionName, 'HeroiPortal');
  assert.equal(body.finance.balance, 4321);
  assert.equal(body.finance.transactions[0].reason, 'Crédito pessoal');
  assert.deepEqual(body.rankings.rows, []);
});

test('portal permite participar, trocar para espectador e respeita o limite de 20 vagas', async (t) => {
  const db = getDatabase();
  const discordId = 'portal-event-member';
  db.prepare("INSERT OR REPLACE INTO users (discord_id, discord_name, albion_name, registration_status) VALUES (?, 'Membro Evento', 'HeroiEvento', 'member')").run(discordId);
  const openEvent = db.prepare(`
    INSERT INTO events (event_code, creator_id, title, tank_slots, healer_slots, support_slots, dps_slots)
    VALUES ('EVT-PORTAL-ACTION', 'staff', 'Evento pelo portal', 2, 2, 4, 12)
  `).run().lastInsertRowid;
  const fullEvent = db.prepare(`
    INSERT INTO events (event_code, creator_id, title, dps_slots)
    VALUES ('EVT-PORTAL-FULL', 'staff', 'Evento lotado', 20)
  `).run().lastInsertRowid;
  for (let index = 0; index < 20; index += 1) {
    db.prepare('INSERT INTO event_participants (event_id, discord_id, role) VALUES (?, ?, ?)')
      .run(fullEvent, `portal-full-${index}`, 'dps');
  }

  const member = {
    id: discordId,
    roles: { cache: new Map([['1481251365131911314', {}]]) },
    voice: { channel: null, channelId: null }
  };
  const guild = { ownerId: 'owner', members: { cache: new Map([[discordId, member]]), async fetch() { return member; } } };
  const client = { guilds: { cache: new Map(), async fetch() { return guild; } } };
  const server = require('node:http').createServer(createRequestHandler(client));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = createPortalSession({ id: discordId, username: 'Membro Evento' }, process.env.DASHBOARD_SESSION_SECRET, { accessLevel: 'member' });
  const portalSession = readPortalSession(token, process.env.DASHBOARD_SESSION_SECRET);
  const headers = {
    Cookie: `${PORTAL_SESSION_COOKIE}=${token}`,
    Origin: new URL(env.dashboardBaseUrl).origin,
    'Content-Type': 'application/x-www-form-urlencoded'
  };

  const joinResponse = await fetch(`${base}/api/portal/events/participation`, {
    method: 'POST',
    headers,
    body: new URLSearchParams({ csrf: portalSession.csrf, eventId: openEvent, action: 'join', role: 'healer' })
  });
  const joined = await joinResponse.json();
  assert.equal(joinResponse.status, 200);
  assert.equal(joined.result.action, 'participant');
  assert.equal(joined.portal.events.find((event) => event.id === openEvent).ownParticipation.role, 'healer');

  const spectateResponse = await fetch(`${base}/api/portal/events/participation`, {
    method: 'POST',
    headers,
    body: new URLSearchParams({ csrf: portalSession.csrf, eventId: openEvent, action: 'spectate' })
  });
  const spectating = await spectateResponse.json();
  assert.equal(spectateResponse.status, 200);
  assert.equal(spectating.result.action, 'spectator');
  assert.equal(spectating.portal.events.find((event) => event.id === openEvent).ownParticipation.is_spectator, 1);

  const fullResponse = await fetch(`${base}/api/portal/events/participation`, {
    method: 'POST',
    headers,
    body: new URLSearchParams({ csrf: portalSession.csrf, eventId: fullEvent, action: 'join', role: 'dps' })
  });
  const full = await fullResponse.json();
  assert.equal(fullResponse.status, 200);
  assert.equal(full.result.action, 'spectator');
  assert.equal(full.result.automatic, true);

  const rejected = await fetch(`${base}/api/portal/events/participation`, {
    method: 'POST',
    headers,
    body: new URLSearchParams({ csrf: 'invalido', eventId: openEvent, action: 'join', role: 'dps' })
  });
  assert.equal(rejected.status, 403);
});

test('staff autenticada gera prévia de tabela com proteção CSRF', async (t) => {
  const staffId = 'staff-fame-web';
  const member = { id: staffId, roles: { cache: new Map([['1481251363013791754', {}]]) } };
  const guild = { ownerId: 'owner', members: { async fetch() { return member; } } };
  const client = { guilds: { cache: new Map(), async fetch() { return guild; } } };
  const server = require('node:http').createServer(createRequestHandler(client));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = createSession({ id: staffId, username: 'Staff', roles: ['1481251363013791754'] }, process.env.DASHBOARD_SESSION_SECRET);
  const session = readSession(token, process.env.DASHBOARD_SESSION_SECRET);
  const table = [
    '"Rank"\t"Player"\t"Guild Role"\t"Amount"',
    '"1"\t"JogadorWeb"\t"Member"\t"123456"'
  ].join('\n');
  const body = new URLSearchParams({ category: 'pve', sourceName: 'pve.tsv', text: table, csrf: session.csrf });

  const response = await fetch(`${base}/api/fame/import/preview`, {
    method: 'POST',
    headers: {
      Cookie: `${SESSION_COOKIE}=${token}`,
      Origin: new URL(env.dashboardBaseUrl).origin,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const preview = await response.json();
  assert.equal(response.status, 200);
  assert.equal(preview.category, 'pve');
  assert.equal(preview.summary.players, 1);

  const rejected = await fetch(`${base}/api/fame/import/preview`, {
    method: 'POST',
    headers: {
      Cookie: `${SESSION_COOKIE}=${token}`,
      Origin: new URL(env.dashboardBaseUrl).origin,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ category: 'pve', text: table, csrf: 'errado' })
  });
  assert.equal(rejected.status, 403);
});
