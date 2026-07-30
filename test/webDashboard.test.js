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
const ids = require('../src/config/ids');
const eventsRepo = require('../src/modules/events/events.repository');
const events = require('../src/modules/events/events.service');
const {
  approveStaffEventPayment,
  createStaffEvent,
  editStaffEvent,
  startStaffEvent,
  submitStaffEventToFinance,
  validateEventInput
} = require('../src/web/staff-events.service');
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

  const publicRankings = await fetch(`${base}/api/public/rankings`);
  assert.equal(publicRankings.status, 200);
  const publicRankingBody = await publicRankings.json();
  assert.equal(publicRankingBody.metric, 'gain_since_previous_import');
  assert.deepEqual(publicRankingBody.categories.map((item) => item.category), ['pve', 'pvp', 'gathering', 'crafting']);

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

test('portal respeita eventos públicos, exclusivos de membros e internos da staff', async (t) => {
  const db = getDatabase();
  const guestId = 'portal-audience-guest';
  const memberId = 'portal-audience-member';
  const staffId = 'portal-audience-staff';
  db.prepare("INSERT OR REPLACE INTO users (discord_id, discord_name, albion_name, registration_status) VALUES (?, 'Convidado Publico', 'ConvidadoPublico', 'guest')").run(guestId);
  db.prepare("INSERT OR REPLACE INTO users (discord_id, discord_name, albion_name, registration_status) VALUES (?, 'Membro Exclusivo', 'MembroExclusivo', 'member')").run(memberId);
  db.prepare("INSERT OR REPLACE INTO users (discord_id, discord_name, albion_name, registration_status) VALUES (?, 'Staff Portal', 'StaffPortal', 'member')").run(staffId);
  const publicEvent = db.prepare("INSERT INTO events (event_code, creator_id, title, audience, dps_slots) VALUES ('EVT-AUDIENCE-PUBLIC', 'staff', 'Evento Publico', 'public', 20)").run().lastInsertRowid;
  const memberEvent = db.prepare("INSERT INTO events (event_code, creator_id, title, audience, dps_slots) VALUES ('EVT-AUDIENCE-MEMBER', 'staff', 'Evento Membro', 'member', 20)").run().lastInsertRowid;
  const staffEvent = db.prepare("INSERT INTO events (event_code, creator_id, title, audience, dps_slots) VALUES ('EVT-AUDIENCE-STAFF', 'staff', 'Evento Staff', 'staff', 20)").run().lastInsertRowid;

  const members = new Map([
    [guestId, { id: guestId, roles: { cache: new Map([[ids.roles.guest, {}]]) }, voice: { channel: null, channelId: null } }],
    [memberId, { id: memberId, roles: { cache: new Map([[ids.roles.member, {}]]) }, voice: { channel: null, channelId: null } }],
    [staffId, { id: staffId, roles: { cache: new Map([[ids.roles.staff, {}]]) }, voice: { channel: null, channelId: null } }]
  ]);
  const guild = { ownerId: 'owner', members: { cache: members, async fetch(id) { return members.get(id); } } };
  const client = { guilds: { cache: new Map([[ids.guildId, guild]]), async fetch() { return guild; } } };
  const server = require('node:http').createServer(createRequestHandler(client));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const guestToken = createPortalSession({ id: guestId, username: 'Convidado Publico' }, process.env.DASHBOARD_SESSION_SECRET, { accessLevel: 'guest' });
  const guestSession = readPortalSession(guestToken, process.env.DASHBOARD_SESSION_SECRET);
  const guestResponse = await fetch(`${base}/api/portal`, { headers: { Cookie: `${PORTAL_SESSION_COOKIE}=${guestToken}` } });
  const guestPortal = await guestResponse.json();
  assert.deepEqual(guestPortal.events.map((event) => event.id).filter((id) => [publicEvent, memberEvent].includes(id)), [publicEvent]);

  const forbidden = await fetch(`${base}/api/portal/events/participation`, {
    method: 'POST',
    headers: {
      Cookie: `${PORTAL_SESSION_COOKIE}=${guestToken}`,
      Origin: new URL(env.dashboardBaseUrl).origin,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ csrf: guestSession.csrf, eventId: memberEvent, action: 'join', role: 'dps' })
  });
  assert.equal(forbidden.status, 403);

  const memberToken = createPortalSession({ id: memberId, username: 'Membro Exclusivo' }, process.env.DASHBOARD_SESSION_SECRET, { accessLevel: 'member' });
  const memberResponse = await fetch(`${base}/api/portal`, { headers: { Cookie: `${PORTAL_SESSION_COOKIE}=${memberToken}` } });
  const memberPortal = await memberResponse.json();
  assert.deepEqual(
    memberPortal.events.map((event) => event.id).filter((id) => [publicEvent, memberEvent].includes(id)).sort((a, b) => a - b),
    [publicEvent, memberEvent].sort((a, b) => a - b)
  );

  const staffToken = createPortalSession({ id: staffId, username: 'Staff Portal' }, process.env.DASHBOARD_SESSION_SECRET, { accessLevel: 'member', privileged: true });
  const staffSession = readPortalSession(staffToken, process.env.DASHBOARD_SESSION_SECRET);
  const staffResponse = await fetch(`${base}/api/portal`, { headers: { Cookie: `${PORTAL_SESSION_COOKIE}=${staffToken}` } });
  const staffPortal = await staffResponse.json();
  assert.deepEqual(
    staffPortal.events.map((event) => event.id).filter((id) => [publicEvent, memberEvent, staffEvent].includes(id)).sort((a, b) => a - b),
    [publicEvent, memberEvent, staffEvent].sort((a, b) => a - b)
  );

  const staffJoin = await fetch(`${base}/api/portal/events/participation`, {
    method: 'POST',
    headers: {
      Cookie: `${PORTAL_SESSION_COOKIE}=${staffToken}`,
      Origin: new URL(env.dashboardBaseUrl).origin,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ csrf: staffSession.csrf, eventId: staffEvent, action: 'join', role: 'dps' })
  });
  assert.equal(staffJoin.status, 200);
});

test('staff cria e edita evento no site com publicação sincronizada no Discord', async () => {
  assert.throws(() => validateEventInput({
    title: 'Acima do limite', tankSlots: 1, healerSlots: 1, supportSlots: 1, dpsSlots: 18
  }), /no maximo 20 participantes/);

  const staffId = 'staff-event-web';
  const sent = [];
  const edited = [];
  const deleted = [];
  const messages = new Map();
  const makeChannel = (id) => ({
    id,
    messages: { async fetch(messageId) { return messages.get(messageId) || null; } },
    async send(payload) {
      const message = {
        id: `staff-event-message-${sent.length + 1}`,
        async edit(nextPayload) { edited.push({ channelId: id, payload: nextPayload }); },
        async delete() { deleted.push(this.id); messages.delete(this.id); }
      };
      messages.set(message.id, message);
      sent.push({ channelId: id, payload });
      return message;
    }
  });
  const pingChannel = makeChannel(ids.channels.pingContent);
  const staffChannel = makeChannel(ids.channels.staff);
  let tempRole = null;
  const staffMember = { id: staffId, roles: { cache: new Map([[ids.roles.staff, {}]]) } };
  const guild = {
    ownerId: 'owner',
    members: { cache: new Map([[staffId, staffMember]]), async fetch(id) { return id === staffId ? staffMember : null; } },
    roles: {
      async create() { tempRole = { id: 'event-temp-role', async delete() { tempRole = null; } }; return tempRole; },
      async fetch() { return tempRole; }
    }
  };
  const client = {
    guilds: { cache: new Map([[ids.guildId, guild]]), async fetch() { return guild; } },
    channels: { async fetch(id) { return id === ids.channels.staff ? staffChannel : pingChannel; } }
  };

  const created = await createStaffEvent(client, {
    actorId: staffId,
    title: 'Roaming pelo site',
    description: 'Build 4.2',
    location: 'Portal Martlock',
    scheduledTime: '30/07 20:00 UTC',
    audience: 'member',
    tankSlots: 1,
    healerSlots: 1,
    supportSlots: 1,
    dpsSlots: 17
  });
  assert.equal(created.event.audience, 'member');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channelId, ids.channels.pingContent);
  assert.match(sent[0].payload.content, new RegExp(`<@&${ids.roles.member}>`));
  assert.doesNotMatch(sent[0].payload.content, new RegExp(ids.roles.guest));

  const updated = await editStaffEvent(client, {
    actorId: staffId,
    eventId: created.event.id,
    title: 'Roaming interno',
    description: 'Composição da staff',
    location: 'Aguardando Evento',
    scheduledTime: '30/07 21:00 UTC',
    audience: 'staff',
    tankSlots: 1,
    healerSlots: 1,
    supportSlots: 1,
    dpsSlots: 17
  });
  assert.equal(updated.event.audience, 'staff');
  assert.equal(eventsRepo.getEvent(created.event.id).title, 'Roaming interno');
  assert.equal(sent.at(-1).channelId, ids.channels.staff);
  assert.equal(deleted.length, 1);
});

test('inicio pelo site move participante conectado mesmo sem objeto de canal de voz em cache', async () => {
  const db = getDatabase();
  const staffId = 'staff-event-start-web';
  const participantId = 'participant-event-start-web';
  const eventId = Number(db.prepare(`
    INSERT INTO events (event_code, creator_id, title, status, audience, tank_slots)
    VALUES ('EVT-WEB-START', ?, 'Inicio pelo site', 'created', 'staff', 1)
  `).run(staffId).lastInsertRowid);
  db.prepare(`
    INSERT INTO event_participants (event_id, discord_id, role)
    VALUES (?, ?, 'tank')
  `).run(eventId, participantId);

  const moves = [];
  const staffMember = { id: staffId, roles: { cache: new Map([[ids.roles.staff, {}]]) }, voice: { channelId: null, channel: null } };
  const participantMember = {
    id: participantId,
    roles: { cache: new Map([[ids.roles.staff, {}]]) },
    voice: {
      channelId: ids.channels.waitingVoice,
      channel: null,
      async setChannel(channelId) { moves.push(channelId); this.channelId = channelId; }
    }
  };
  const members = new Map([[staffId, staffMember], [participantId, participantMember]]);
  const voice = { id: 'event-voice-from-site', name: 'Inicio pelo site' };
  const guild = {
    ownerId: 'owner',
    members: { cache: members, async fetch(id) { return members.get(id) || null; } },
    channels: { async create() { return voice; } }
  };
  const client = { guilds: { cache: new Map([[ids.guildId, guild]]), async fetch() { return guild; } } };

  const result = await startStaffEvent(client, { actorId: staffId, eventId });
  assert.equal(result.event.status, 'running');
  assert.equal(result.voiceChannelId, voice.id);
  assert.deepEqual(moves, [voice.id]);
  assert.ok(eventsRepo.getOpenVoiceSession({ eventId, discordId: participantId }));
});

test('staff envia revisão e aprova pagamento de evento pelo site', async () => {
  const db = getDatabase();
  const staffId = 'staff-event-payment-web';
  const participantId = 'participant-event-payment-web';
  db.prepare("INSERT OR REPLACE INTO users (discord_id, discord_name, albion_name, registration_status) VALUES (?, 'Staff Evento Financeiro', 'StaffEventoFinanceiro', 'member')").run(staffId);
  db.prepare("INSERT OR REPLACE INTO users (discord_id, discord_name, albion_name, registration_status) VALUES (?, 'Participante Evento Financeiro', 'ParticipanteEventoFinanceiro', 'member')").run(participantId);
  db.prepare('INSERT OR REPLACE INTO balances (discord_id, balance) VALUES (?, 0)').run(participantId);
  const eventId = Number(db.prepare(`
    INSERT INTO events (event_code, creator_id, title, status, tank_slots, ended_at)
    VALUES ('EVT-WEB-PAYMENT', ?, 'Pagamento pelo site', 'review', 1, CURRENT_TIMESTAMP)
  `).run(staffId).lastInsertRowid);
  db.prepare(`
    INSERT INTO event_participants (event_id, discord_id, role, calculated_seconds)
    VALUES (?, ?, 'tank', 3600)
  `).run(eventId, participantId);
  events.saveLootReview({ eventId, lootTotal: 1000000, repair: 0, silverBags: 0, taxPercent: 0, evidenceNotes: 'Teste web' });

  const campaignStatuses = db.prepare('SELECT id, status FROM campaigns').all();
  db.prepare("UPDATE campaigns SET status = 'closed' WHERE status = 'open'").run();
  const sent = [];
  const directMessages = [];
  const textChannel = (id) => ({
    id,
    isTextBased: () => true,
    async send(payload) {
      sent.push({ channelId: id, payload });
      return { id: `message-${sent.length}` };
    }
  });
  const staffMember = { id: staffId, roles: { cache: new Map([[ids.roles.staff, {}]]) } };
  const guild = {
    ownerId: 'owner',
    members: { cache: new Map([[staffId, staffMember]]), async fetch(id) { return id === staffId ? staffMember : null; } },
    roles: { cache: new Map(), everyone: { id: 'everyone' } }
  };
  const client = {
    guilds: { cache: new Map([[ids.guildId, guild]]), async fetch() { return guild; } },
    channels: { async fetch(id) { return textChannel(id); } },
    users: { async fetch(id) { return { async send(message) { directMessages.push({ id, message }); } }; } }
  };
  guild.client = client;

  try {
    const submitted = await submitStaffEventToFinance(client, { actorId: staffId, eventId });
    assert.equal(submitted.event.status, 'pending_payment');
    assert.equal(sent.some((item) => item.channelId === ids.channels.finance), true);
    assert.equal(sent.some((item) => item.channelId === ids.channels.dpsMeter), true);

    const approved = await approveStaffEventPayment(client, { actorId: staffId, eventId });
    assert.equal(approved.event.status, 'approved');
    assert.equal(approved.transactions, 1);
    assert.equal(db.prepare('SELECT balance FROM balances WHERE discord_id = ?').get(participantId).balance, 1000000);
    assert.equal(directMessages.length, 1);
    assert.equal(sent.some((item) => item.channelId === ids.channels.archive), true);
    assert.throws(() => events.approveEventPayment({ eventId, actorId: staffId }), /nao esta pendente/);
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE target_id = ? AND type = 'event_payment_approved'").get(String(eventId)).total, 1);
  } finally {
    const restoreStatus = db.prepare('UPDATE campaigns SET status = ? WHERE id = ?');
    for (const campaign of campaignStatuses) restoreStatus.run(campaign.status, campaign.id);
  }
});

test('portal solicita saque, avisa a staff e bloqueia duplicidade ou saldo insuficiente', async (t) => {
  const db = getDatabase();
  const discordId = 'portal-withdraw-member';
  db.prepare("INSERT OR REPLACE INTO users (discord_id, discord_name, albion_name, registration_status) VALUES (?, 'Membro Saque', 'HeroiSaque', 'member')").run(discordId);
  db.prepare('INSERT OR REPLACE INTO balances (discord_id, balance) VALUES (?, ?)').run(discordId, 2000000);

  const member = { id: discordId, roles: { cache: new Map([['1481251365131911314', {}]]) } };
  const guild = { ownerId: 'owner', members: { cache: new Map([[discordId, member]]), async fetch() { return member; } } };
  const staffMessages = [];
  const financeChannel = {
    isTextBased: () => true,
    async send(payload) {
      staffMessages.push(payload);
      return { id: `withdraw-staff-${staffMessages.length}` };
    }
  };
  const client = {
    guilds: { cache: new Map(), async fetch() { return guild; } },
    channels: { async fetch() { return financeChannel; } }
  };
  const server = require('node:http').createServer(createRequestHandler(client));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = createPortalSession({ id: discordId, username: 'Membro Saque' }, process.env.DASHBOARD_SESSION_SECRET, { accessLevel: 'member' });
  const portalSession = readPortalSession(token, process.env.DASHBOARD_SESSION_SECRET);
  const headers = {
    Cookie: `${PORTAL_SESSION_COOKIE}=${token}`,
    Origin: new URL(env.dashboardBaseUrl).origin,
    'Content-Type': 'application/x-www-form-urlencoded'
  };

  const response = await fetch(`${base}/api/portal/withdrawals`, {
    method: 'POST',
    headers,
    body: new URLSearchParams({ csrf: portalSession.csrf, amount: '1.5m', note: 'Entregar hoje' })
  });
  const created = await response.json();
  assert.equal(response.status, 200);
  assert.equal(created.result.request.amount, 1500000);
  assert.equal(created.portal.finance.balance, 2000000);
  assert.equal(created.portal.overview.pendingWithdraws, 1);
  assert.equal(staffMessages.length, 1);
  assert.match(staffMessages[0].content, /Saque #\d+.*1\.5m/);
  assert.deepEqual(staffMessages[0].components[0].components.map((button) => button.data.custom_id), [
    `finance:approve_withdraw:${created.result.request.id}`,
    `finance:pay_withdraw:${created.result.request.id}`,
    `finance:refuse_withdraw:${created.result.request.id}`
  ]);

  const duplicate = await fetch(`${base}/api/portal/withdrawals`, {
    method: 'POST',
    headers,
    body: new URLSearchParams({ csrf: portalSession.csrf, amount: '100k' })
  });
  assert.equal(duplicate.status, 409);

  db.prepare("UPDATE withdraw_requests SET status = 'refused' WHERE id = ?").run(created.result.request.id);
  const insufficient = await fetch(`${base}/api/portal/withdrawals`, {
    method: 'POST',
    headers,
    body: new URLSearchParams({ csrf: portalSession.csrf, amount: '2.1m' })
  });
  assert.equal(insufficient.status, 409);

  const rejectedWithdraw = await fetch(`${base}/api/portal/withdrawals`, {
    method: 'POST',
    headers,
    body: new URLSearchParams({ csrf: 'invalido', amount: '100k' })
  });
  assert.equal(rejectedWithdraw.status, 403);
});

test('solicitante edita e cancela somente antes da aprovação, e a staff conclui pelo painel', async (t) => {
  const db = getDatabase();
  const discordId = 'portal-withdraw-manage-member';
  const staffId = 'portal-withdraw-manage-staff';
  db.prepare("INSERT OR REPLACE INTO users (discord_id, discord_name, albion_name, registration_status) VALUES (?, 'Membro Gerencia Saque', 'HeroiGerenciaSaque', 'member')").run(discordId);
  db.prepare('INSERT OR REPLACE INTO balances (discord_id, balance) VALUES (?, ?)').run(discordId, 2000000);

  const members = new Map([
    [discordId, { id: discordId, roles: { cache: new Map([['1481251365131911314', {}]]) } }],
    [staffId, { id: staffId, roles: { cache: new Map([['1481251363013791754', {}]]) } }]
  ]);
  const guild = {
    ownerId: 'owner',
    members: {
      cache: members,
      async fetch(id) { return members.get(id) || null; }
    }
  };
  const sentPayloads = [];
  const editedPayloads = [];
  const staffMessage = {
    id: 'staff-withdraw-manage-message',
    channelId: 'staff-finance-channel',
    async edit(payload) { editedPayloads.push(payload); return this; }
  };
  const financeChannel = {
    id: 'staff-finance-channel',
    isTextBased: () => true,
    messages: { async fetch(id) { return id === staffMessage.id ? staffMessage : null; } },
    async send(payload) { sentPayloads.push(payload); return staffMessage; }
  };
  const directMessages = [];
  const client = {
    guilds: { cache: new Map(), async fetch() { return guild; } },
    channels: { async fetch() { return financeChannel; } },
    users: { async fetch(id) { return { async send(message) { directMessages.push({ id, message }); } }; } }
  };
  const server = require('node:http').createServer(createRequestHandler(client));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const portalToken = createPortalSession({ id: discordId, username: 'Membro Gerencia Saque' }, process.env.DASHBOARD_SESSION_SECRET, { accessLevel: 'member' });
  const portalSession = readPortalSession(portalToken, process.env.DASHBOARD_SESSION_SECRET);
  const portalHeaders = {
    Cookie: `${PORTAL_SESSION_COOKIE}=${portalToken}`,
    Origin: new URL(env.dashboardBaseUrl).origin,
    'Content-Type': 'application/x-www-form-urlencoded'
  };

  const createResponse = await fetch(`${base}/api/portal/withdrawals`, {
    method: 'POST',
    headers: portalHeaders,
    body: new URLSearchParams({ csrf: portalSession.csrf, amount: '1m', note: 'Primeiro valor' })
  });
  const created = await createResponse.json();
  const requestId = created.result.request.id;
  assert.equal(createResponse.status, 200);
  assert.equal(sentPayloads.length, 1);

  const editResponse = await fetch(`${base}/api/portal/withdrawals/manage`, {
    method: 'POST',
    headers: portalHeaders,
    body: new URLSearchParams({ csrf: portalSession.csrf, action: 'edit', requestId, amount: '900k', note: 'Valor corrigido' })
  });
  const edited = await editResponse.json();
  assert.equal(editResponse.status, 200);
  assert.equal(edited.result.request.amount, 900000);
  assert.equal(editedPayloads.length, 1);
  assert.match(editedPayloads[0].content, /900k/);

  const cancelResponse = await fetch(`${base}/api/portal/withdrawals/manage`, {
    method: 'POST',
    headers: portalHeaders,
    body: new URLSearchParams({ csrf: portalSession.csrf, action: 'cancel', requestId })
  });
  const cancelled = await cancelResponse.json();
  assert.equal(cancelResponse.status, 200);
  assert.equal(cancelled.result.request.status, 'cancelled');
  assert.equal(cancelled.portal.overview.pendingWithdraws, 0);
  assert.equal(db.prepare('SELECT balance FROM balances WHERE discord_id = ?').get(discordId).balance, 2000000);
  assert.match(editedPayloads.at(-1).content, /Cancelado/);

  const editCancelled = await fetch(`${base}/api/portal/withdrawals/manage`, {
    method: 'POST',
    headers: portalHeaders,
    body: new URLSearchParams({ csrf: portalSession.csrf, action: 'edit', requestId, amount: '800k' })
  });
  assert.equal(editCancelled.status, 409);

  const secondResponse = await fetch(`${base}/api/portal/withdrawals`, {
    method: 'POST',
    headers: portalHeaders,
    body: new URLSearchParams({ csrf: portalSession.csrf, amount: '500k', note: 'Pedido do painel' })
  });
  const second = await secondResponse.json();
  const secondId = second.result.request.id;
  const staffToken = createSession({ id: staffId, username: 'Staff Saque' }, process.env.DASHBOARD_SESSION_SECRET);
  const staffSession = readSession(staffToken, process.env.DASHBOARD_SESSION_SECRET);
  const staffHeaders = {
    Cookie: `${SESSION_COOKIE}=${staffToken}`,
    Origin: new URL(env.dashboardBaseUrl).origin,
    'Content-Type': 'application/x-www-form-urlencoded'
  };
  const approveResponse = await fetch(`${base}/api/staff/withdrawals`, {
    method: 'POST',
    headers: staffHeaders,
    body: new URLSearchParams({ csrf: staffSession.csrf, action: 'approve', requestId: secondId })
  });
  const approved = await approveResponse.json();
  assert.equal(approveResponse.status, 200);
  assert.equal(approved.result.request.status, 'approved');
  assert.equal(approved.dashboard.finance.withdrawals.find((row) => row.id === secondId).status, 'approved');

  const cancelApproved = await fetch(`${base}/api/portal/withdrawals/manage`, {
    method: 'POST',
    headers: portalHeaders,
    body: new URLSearchParams({ csrf: portalSession.csrf, action: 'cancel', requestId: secondId })
  });
  assert.equal(cancelApproved.status, 409);

  const payResponse = await fetch(`${base}/api/staff/withdrawals`, {
    method: 'POST',
    headers: staffHeaders,
    body: new URLSearchParams({ csrf: staffSession.csrf, action: 'pay', requestId: secondId })
  });
  const paid = await payResponse.json();
  assert.equal(payResponse.status, 200);
  assert.equal(paid.result.request.status, 'paid');
  assert.equal(db.prepare('SELECT balance FROM balances WHERE discord_id = ?').get(discordId).balance, 1500000);
  assert.equal(directMessages.length >= 2, true);
});

test('sessões existentes alternam entre portal e staff sem novo OAuth', async (t) => {
  const staffId = 'staff-session-bridge';
  const staffMember = { id: staffId, roles: { cache: new Map([['1481251363013791754', {}]]) } };
  const guild = {
    ownerId: 'owner',
    members: {
      cache: new Map([[staffId, staffMember]]),
      async fetch(id) { return id === staffId ? staffMember : null; }
    }
  };
  const client = { guilds: { cache: new Map(), async fetch() { return guild; } } };
  const server = require('node:http').createServer(createRequestHandler(client));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const staffToken = createSession({ id: staffId, username: 'Staff Bridge' }, process.env.DASHBOARD_SESSION_SECRET);
  const portalToken = createPortalSession({ id: staffId, username: 'Staff Bridge' }, process.env.DASHBOARD_SESSION_SECRET, { accessLevel: 'member', privileged: true });

  const portalFromStaff = await fetch(`${base}/portal`, {
    redirect: 'manual',
    headers: { Cookie: `${SESSION_COOKIE}=${staffToken}` }
  });
  assert.equal(portalFromStaff.status, 302);
  assert.equal(portalFromStaff.headers.get('location'), '/portal');
  assert.match(portalFromStaff.headers.get('set-cookie'), new RegExp(`${PORTAL_SESSION_COOKIE}=`));

  const staffFromPortal = await fetch(`${base}/dashboard`, {
    redirect: 'manual',
    headers: { Cookie: `${PORTAL_SESSION_COOKIE}=${portalToken}` }
  });
  assert.equal(staffFromPortal.status, 302);
  assert.equal(staffFromPortal.headers.get('location'), '/dashboard');
  assert.match(staffFromPortal.headers.get('set-cookie'), new RegExp(`${SESSION_COOKIE}=`));

  const existingStaffLogin = await fetch(`${base}/auth/discord`, {
    redirect: 'manual',
    headers: { Cookie: `${SESSION_COOKIE}=${staffToken}` }
  });
  assert.equal(existingStaffLogin.headers.get('location'), '/dashboard');

  const existingPortalLogin = await fetch(`${base}/join/discord`, {
    redirect: 'manual',
    headers: { Cookie: `${PORTAL_SESSION_COOKIE}=${portalToken}` }
  });
  assert.equal(existingPortalLogin.headers.get('location'), '/portal');
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
