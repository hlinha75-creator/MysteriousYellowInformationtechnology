const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notag-staff-registration-test-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempRoot, 'registrations.sqlite');
process.env.DASHBOARD_SESSION_SECRET = 'staff-registration-test-secret';
process.env.DASHBOARD_BASE_URL = 'http://127.0.0.1';

const ids = require('../src/config/ids');
const { getDatabase } = require('../src/database/connection');
const { migrate } = require('../src/database/migrate');
const accountLinks = require('../src/modules/accounts/accountLinks.service');
const repo = require('../src/modules/registration/registration.repository');
const { createSession, SESSION_COOKIE } = require('../src/web/auth');
const { createRequestHandler } = require('../src/web/server');
const { confirmRegistration, getRegistrationQueue, previewRegistration } = require('../src/web/staff-registration.service');

migrate();
test.after(() => {
  getDatabase().close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function memberFixture(id, roles = [ids.roles.guest]) {
  const cache = new Map(roles.map((roleId) => [roleId, { id: roleId }]));
  return {
    id,
    nickname: null,
    joinedAt: new Date('2026-07-27T10:00:00Z'),
    user: { username: `user-${id}`, tag: `user-${id}` },
    roles: {
      cache,
      async add(roleId) { cache.set(roleId, { id: roleId }); },
      async remove(roleId) { cache.delete(roleId); }
    },
    async setNickname(value) { this.nickname = value; },
    async send(value) { this.lastDm = value; }
  };
}

function clientFixture(member) {
  const sent = [];
  const guild = {
    ownerId: 'owner',
    members: {
      cache: new Map([[member.id, member]]),
      async fetch(id) { return id ? member : this.cache; }
    }
  };
  return {
    sent,
    guilds: { cache: new Map([[ids.guildId, guild]]), async fetch() { return guild; } },
    channels: {
      async fetch() {
        return {
          isTextBased: () => true,
          async send(payload) { sent.push(payload); return { id: `msg-${sent.length}`, channelId: ids.channels.staff }; }
        };
      }
    }
  };
}

function albionFetch({ name = 'HeroNotag', guildName = 'NoTag' } = {}) {
  return async (url) => ({
    ok: true,
    async json() {
      if (String(url).includes('/search?')) return { players: [{ Id: 'player-1', Name: name }] };
      return { Id: 'player-1', Name: name, GuildName: guildName, GuildId: 'guild-notag' };
    }
  });
}

test('staff só aprova personagem que está na NoTag e atualiza Discord, banco e auditoria', async () => {
  const member = memberFixture('candidate-1');
  const client = clientFixture(member);
  repo.upsertUser({ discordId: member.id, discordName: member.user.tag, albionName: 'HeroNotag', registrationStatus: 'pending' });
  repo.createRegistration({ discordId: member.id, albionName: 'HeroNotag' });

  await assert.rejects(
    previewRegistration(client, { discordId: member.id, albionName: 'HeroNotag' }, { fetchImpl: albionFetch({ guildName: 'Outra Guilda' }) }),
    /não está atualmente na guilda NoTag/
  );

  const result = await confirmRegistration(client, {
    actorId: 'staff-1', discordId: member.id, albionName: 'HeroNotag'
  }, { fetchImpl: albionFetch() });

  const user = repo.getUser(member.id);
  const registration = repo.getRegistration(1);
  const audit = getDatabase().prepare("SELECT * FROM audit_logs WHERE type = 'website_registration_approved'").get();
  assert.match(result.message, /promovida a Membro/);
  assert.equal(user.registration_status, 'member');
  assert.equal(registration.status, 'approved_member');
  assert.equal(member.nickname, 'HeroNotag');
  assert.equal(member.roles.cache.has(ids.roles.member), true);
  assert.equal(member.roles.cache.has(ids.roles.guest), false);
  assert.match(member.lastDm, /cadastro.*aprovado/i);
  assert.equal(audit.actor_id, 'staff-1');
  assert.equal(client.sent.length, 1);

});

test('fila marca convidado sem envio há mais de 24 horas como cadastro atrasado', async () => {
  const member = memberFixture('candidate-overdue');
  const client = clientFixture(member);
  const queue = await getRegistrationQueue(client, { now: Date.parse('2026-07-29T12:00:00Z') });
  const row = queue.find((item) => item.discord_id === member.id);
  assert.equal(row.queue_status, 'overdue');
  assert.ok(row.waiting_hours >= 24);
});

test('fila ativa oculta cadastro histórico de quem não está mais no Discord', async () => {
  const currentMember = memberFixture('candidate-current');
  const client = clientFixture(currentMember);
  repo.upsertUser({
    discordId: 'candidate-left-discord',
    discordName: 'usuario-antigo',
    albionName: 'PersonagemAntigo',
    registrationStatus: 'pending'
  });
  repo.createRegistration({ discordId: 'candidate-left-discord', albionName: 'PersonagemAntigo' });

  const queue = await getRegistrationQueue(client);

  assert.ok(queue.some((item) => item.discord_id === currentMember.id));
  assert.equal(queue.some((item) => item.discord_id === 'candidate-left-discord'), false);
  assert.equal(repo.getUser('candidate-left-discord').albion_name, 'PersonagemAntigo');
});

test('vínculo duplicado preserva o perfil principal e promove a nova conta Discord', async () => {
  const primaryId = 'primary-linked';
  const secondary = memberFixture('secondary-linked');
  const client = clientFixture(secondary);
  repo.upsertUser({ discordId: primaryId, discordName: 'principal', albionName: 'LinkedHero', registrationStatus: 'member' });
  repo.upsertUser({ discordId: secondary.id, discordName: secondary.user.tag, albionName: null, registrationStatus: 'pending' });
  repo.createRegistration({ discordId: secondary.id, albionName: 'LinkedHero' });

  const result = await confirmRegistration(client, {
    actorId: 'staff-link', discordId: secondary.id, albionName: 'LinkedHero'
  }, { fetchImpl: albionFetch({ name: 'LinkedHero' }) });

  assert.match(result.message, /Vínculo autorizado/);
  assert.equal(accountLinks.resolvePrimaryUserId(secondary.id), primaryId);
  assert.equal(repo.getUser(primaryId).albion_name, 'LinkedHero');
  assert.equal(repo.getUser(secondary.id).albion_name, null);
  assert.equal(repo.getUser(secondary.id).registration_status, 'member');
  assert.equal(secondary.roles.cache.has(ids.roles.member), true);
  assert.equal(secondary.roles.cache.has(ids.roles.guest), false);
  assert.equal(getDatabase().prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE type = 'website_registration_link_authorized'").get().total, 1);
});

test('Caller acessa somente Cadastros e não recebe os dados administrativos completos', async (t) => {
  const reviewer = memberFixture('caller-reviewer', [ids.roles.caller]);
  const client = clientFixture(reviewer);
  const server = require('node:http').createServer(createRequestHandler(client));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = createSession({ id: reviewer.id, username: reviewer.user.username }, process.env.DASHBOARD_SESSION_SECRET);

  const sessionResponse = await fetch(`${base}/api/session`, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
  const session = await sessionResponse.json();
  assert.equal(sessionResponse.status, 200);
  assert.deepEqual(session.permissions, { full: false, registrations: true });

  const dashboardResponse = await fetch(`${base}/api/dashboard`, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboardResponse.status, 200);
  assert.ok(Array.isArray(dashboard.registrations));
  assert.equal('finance' in dashboard, false);
  assert.equal('events' in dashboard, false);
  assert.equal('audit' in dashboard, false);
});
