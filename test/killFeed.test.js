const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  classifyEvent,
  configuredApiBase,
  eventPayload,
  fetchRecentEvents,
  findVengeanceMatches,
  recordVengeanceDeath
} = require('../src/modules/albion/killFeed.service');

test('killfeed usa Europa mesmo quando restou a configuração antiga de Americas', () => {
  const previousUrl = process.env.ALBION_API_BASE_URL;
  const previousBase = process.env.ALBION_API_BASE;
  process.env.ALBION_API_BASE_URL = 'https://gameinfo.albiononline.com/api/gameinfo';
  delete process.env.ALBION_API_BASE;
  assert.equal(configuredApiBase(), 'https://gameinfo-ams.albiononline.com/api/gameinfo');
  if (previousUrl == null) delete process.env.ALBION_API_BASE_URL;
  else process.env.ALBION_API_BASE_URL = previousUrl;
  if (previousBase == null) delete process.env.ALBION_API_BASE;
  else process.env.ALBION_API_BASE = previousBase;
});

test('killfeed separa kills, deaths e eventos externos da NoTag', () => {
  assert.equal(classifyEvent({ Killer: { GuildName: 'NoTag' }, Victim: { GuildName: 'Outra' } }), 'kill');
  assert.equal(classifyEvent({ Killer: { GuildName: 'Outra' }, Victim: { GuildName: 'NOTAG' } }), 'death');
  assert.equal(classifyEvent({ Killer: { GuildName: 'Outra' }, Victim: { GuildName: 'Terceira' } }), null);
});

test('monta detalhes de equipamento, inventário, participantes e link europeu', () => {
  const event = {
    EventId: 399468006,
    Killer: { Id: 'k', Name: 'Killer', GuildName: 'Outra', Equipment: { MainHand: { Type: 'T6_MAIN_SWORD', Count: 1 } } },
    Victim: { Id: 'v', Name: 'Victim', GuildName: 'NoTag', Equipment: { Bag: { Type: 'T5_BAG', Count: 1 } }, Inventory: [{ Type: 'T7_ORE', Count: 12 }] },
    Participants: [{ Id: 'k', Name: 'Killer', GuildName: 'Outra', DamageDone: 1234 }]
  };
  const payload = eventPayload(event, 'death', 'https://gameinfo-ams.albiononline.com/api/gameinfo');
  assert.equal(payload.embeds.length, 5);
  assert.match(payload.embeds[3].data.description, /T7_ORE/);
  assert.match(payload.embeds[4].data.description, /1\.234 dano/);
  assert.equal(payload.components[0].components[0].data.url, 'https://killboard-1.com/eu/event/399468006');
});

test('consulta eventos com paginação e para ao encontrar o último evento salvo', async () => {
  const calls = [];
  const first = Array.from({ length: 51 }, (_, index) => ({ EventId: 200 - index }));
  const second = [{ EventId: 149 }, { EventId: 148 }];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => (calls.length === 1 ? first : second) };
  };
  const rows = await fetchRecentEvents({ fetchImpl, apiBase: 'https://example.test/api', lastId: 149 });
  assert.equal(rows.length, 53);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /offset=51/);
});

test('repete consulta quando a API Albion responde erro temporário', async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    if (attempts < 3) return { ok: false, status: 504 };
    return { ok: true, json: async () => [{ EventId: 300 }] };
  };
  const rows = await fetchRecentEvents({
    fetchImpl,
    apiBase: 'https://example.test/api',
    retries: 3,
    waitImpl: async () => {}
  });
  assert.equal(attempts, 3);
  assert.equal(rows[0].EventId, 300);
});

test('registra morte e encontra vingança feita por outro membro em até sete dias', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (discord_id TEXT, albion_name TEXT, registration_status TEXT);
    CREATE TABLE albion_vengeance_deaths (
      original_event_id INTEGER PRIMARY KEY, victim_discord_id TEXT, victim_albion_name TEXT,
      enemy_player_id TEXT, enemy_player_name TEXT, occurred_at TEXT,
      avenged_event_id INTEGER, avenger_discord_id TEXT, avenged_at TEXT
    );
  `);
  db.prepare('INSERT INTO users VALUES (?, ?, ?)').run('discord-victim', 'MembroMorto', 'member');
  db.prepare('INSERT INTO users VALUES (?, ?, ?)').run('discord-avenger', 'Vingador', 'member');
  const now = new Date('2026-07-12T12:00:00Z');
  assert.equal(recordVengeanceDeath(db, {
    EventId: 10,
    TimeStamp: new Date(now.getTime() - 2 * 86400000).toISOString(),
    Killer: { Id: 'enemy-x', Name: 'Inimigo' },
    Victim: { Id: 'member-dead', Name: 'MembroMorto', GuildName: 'NoTag' }
  }), true);
  const match = findVengeanceMatches(db, {
    EventId: 20,
    Killer: { Id: 'avenger', Name: 'Vingador', GuildName: 'NoTag' },
    Victim: { Id: 'enemy-x', Name: 'Inimigo' }
  }, now);
  assert.equal(match.avenger.discord_id, 'discord-avenger');
  assert.deepEqual(match.rows.map((row) => row.original_event_id), [10]);
  db.close();
});

test('não considera auto-vingança nem morte vencida há mais de sete dias', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (discord_id TEXT, albion_name TEXT, registration_status TEXT);
    CREATE TABLE albion_vengeance_deaths (
      original_event_id INTEGER PRIMARY KEY, victim_discord_id TEXT, victim_albion_name TEXT,
      enemy_player_id TEXT, enemy_player_name TEXT, occurred_at TEXT,
      avenged_event_id INTEGER, avenger_discord_id TEXT, avenged_at TEXT
    );
    INSERT INTO users VALUES ('same-user', 'MesmoJogador', 'member');
    INSERT INTO albion_vengeance_deaths VALUES
      (1, 'same-user', 'MesmoJogador', 'enemy', 'Inimigo', '2026-07-11T12:00:00Z', NULL, NULL, NULL),
      (2, 'other-user', 'Outro', 'old-enemy', 'Antigo', '2026-07-01T12:00:00Z', NULL, NULL, NULL);
  `);
  const now = new Date('2026-07-12T12:00:00Z');
  assert.equal(findVengeanceMatches(db, { EventId: 3, Killer: { Name: 'MesmoJogador' }, Victim: { Id: 'enemy' } }, now), null);
  assert.equal(findVengeanceMatches(db, { EventId: 4, Killer: { Name: 'MesmoJogador' }, Victim: { Id: 'old-enemy' } }, now), null);
  db.close();
});
