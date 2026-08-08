const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  backfillBattleEvents,
  battleSummary,
  finalizeStaleBattles,
  recordBattleEvent
} = require('../src/modules/albion/battleReports.service');

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE albion_battles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL, last_event_at TEXT NOT NULL, closed_at TEXT,
      report_channel_id TEXT, report_message_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE albion_battle_events (
      event_id INTEGER PRIMARY KEY, battle_id INTEGER NOT NULL, event_type TEXT NOT NULL,
      event_at TEXT NOT NULL, victim_name TEXT NOT NULL, victim_guild TEXT,
      victim_build_value INTEGER NOT NULL DEFAULT 0, priced_items INTEGER NOT NULL DEFAULT 0,
      total_items INTEGER NOT NULL DEFAULT 0, notag_members_json TEXT NOT NULL,
      player_keys_json TEXT NOT NULL, enemy_guilds_json TEXT NOT NULL,
      enemy_alliances_json TEXT NOT NULL, raw_event_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (battle_id) REFERENCES albion_battles(id) ON DELETE CASCADE
    );
    CREATE TABLE albion_battle_backfill (
      event_id INTEGER PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
      retry_after TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE albion_killfeed_events (
      event_id INTEGER PRIMARY KEY, event_type TEXT NOT NULL, event_at TEXT,
      discord_message_id TEXT, posted_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function priceFetch(rows) {
  return async () => ({ ok: true, json: async () => rows });
}

function fakeClient(sent) {
  return {
    channels: {
      fetch: async () => ({
        isTextBased: () => true,
        send: async (payload) => {
          sent.push(payload);
          return { id: `report-${sent.length}` };
        }
      })
    }
  };
}

test('agrupa batalha, soma builds equipadas e publica após 30 minutos sem eventos', async () => {
  const db = createDb();
  const prices = [
    { item_id: 'REPORT_ENEMY_BUILD', quality: 1, sell_price_min: 10000000 },
    { item_id: 'REPORT_NOTAG_BUILD', quality: 1, sell_price_min: 4000000 }
  ];
  const options = { fetchImpl: priceFetch(prices), guildName: 'NoTag' };
  const firstId = await recordBattleEvent(db, {
    EventId: 7001,
    TimeStamp: '2026-08-08T20:00:00Z',
    Killer: { Id: 'n1', Name: 'NoTag1', GuildName: 'NoTag' },
    Victim: { Id: 'e1', Name: 'Enemy1', GuildName: 'Enemy', Equipment: { MainHand: { Type: 'REPORT_ENEMY_BUILD', Quality: 1 } }, Inventory: [{ Type: 'IGNORED_LOOT', Quality: 1 }] },
    Participants: [
      { Id: 'n2', Name: 'NoTag2', GuildName: 'NoTag' },
      { Id: 'n3', Name: 'NoTag3', GuildName: 'NoTag' },
      { Id: 'n4', Name: 'NoTag4', GuildName: 'NoTag' }
    ]
  }, 'kill', options);
  const secondId = await recordBattleEvent(db, {
    EventId: 7002,
    TimeStamp: '2026-08-08T20:10:00Z',
    Killer: { Id: 'e1', Name: 'Enemy1', GuildName: 'Enemy' },
    Victim: { Id: 'n1', Name: 'NoTag1', GuildName: 'NoTag', Equipment: { MainHand: { Type: 'REPORT_NOTAG_BUILD', Quality: 1 } } },
    Participants: []
  }, 'death', options);

  assert.equal(secondId, firstId);
  const summary = battleSummary(db, firstId);
  assert.equal(summary.members.length, 4);
  assert.equal(summary.events.length, 2);
  assert.equal(summary.enemyValue, 10000000);
  assert.equal(summary.notagValue, 4000000);
  assert.equal(summary.balance, 6000000);

  const sent = [];
  const result = await finalizeStaleBattles(fakeClient(sent), {
    db,
    channelId: 'battle-channel',
    now: '2026-08-08T20:41:00Z'
  });
  assert.deepEqual(result, { reported: 1, discarded: 0 });
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].data.fields[0].value, /10 M/);
  assert.match(sent[0].embeds[0].data.fields[1].value, /4 M/);
  assert.equal(db.prepare('SELECT status FROM albion_battles WHERE id = ?').get(firstId).status, 'reported');
});

test('descarta encontro com menos de quatro membros NoTag', async () => {
  const db = createDb();
  const options = {
    fetchImpl: priceFetch([{ item_id: 'SMALL_BUILD', quality: 1, sell_price_min: 1000 }]),
    guildName: 'NoTag'
  };
  for (let index = 0; index < 2; index += 1) {
    await recordBattleEvent(db, {
      EventId: 7100 + index,
      TimeStamp: `2026-08-08T21:0${index}:00Z`,
      Killer: { Id: 'n1', Name: 'NoTag1', GuildName: 'NoTag' },
      Victim: { Id: `e${index}`, Name: `Enemy${index}`, GuildName: 'Enemy', Equipment: { MainHand: { Type: 'SMALL_BUILD', Quality: 1 } } },
      Participants: [
        { Id: 'n2', Name: 'NoTag2', GuildName: 'NoTag' },
        { Id: 'n3', Name: 'NoTag3', GuildName: 'NoTag' }
      ]
    }, 'kill', options);
  }
  const sent = [];
  const result = await finalizeStaleBattles(fakeClient(sent), {
    db,
    channelId: 'battle-channel',
    now: '2026-08-08T21:40:00Z'
  });
  assert.deepEqual(result, { reported: 0, discarded: 1 });
  assert.equal(sent.length, 0);
});

test('recupera detalhes dos eventos históricos já salvos pelo killfeed', async () => {
  const db = createDb();
  db.prepare(`
    INSERT INTO albion_killfeed_events (event_id, event_type, event_at) VALUES (?, 'kill', ?)
  `).run(7200, '2026-08-07T19:00:00Z');
  const event = {
    EventId: 7200,
    TimeStamp: '2026-08-07T19:00:00Z',
    Killer: { Id: 'n1', Name: 'NoTag1', GuildName: 'NoTag' },
    Victim: {
      Id: 'e1', Name: 'Enemy1', GuildName: 'Enemy',
      Equipment: { MainHand: { Type: 'HISTORIC_BUILD', Quality: 1 } }
    },
    Participants: []
  };
  const result = await backfillBattleEvents(db, {
    apiBase: 'https://albion.test/api',
    fetchImpl: async (url) => {
      if (url.endsWith('/events/7200')) return { ok: true, json: async () => event };
      return { ok: true, json: async () => [
        { item_id: 'HISTORIC_BUILD', quality: 1, sell_price_min: 3000000 }
      ] };
    },
    now: '2026-08-08T12:00:00Z'
  });
  assert.deepEqual(result, { processed: 1, failed: 0, pending: 0 });
  const saved = db.prepare('SELECT victim_build_value FROM albion_battle_events WHERE event_id = 7200').get();
  assert.equal(saved.victim_build_value, 3000000);
});
