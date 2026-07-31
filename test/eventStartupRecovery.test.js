const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ChannelType, OverwriteType } = require('discord.js');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notag-event-recovery-test-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempRoot, 'event-recovery.sqlite');

const ids = require('../src/config/ids');
const { getDatabase } = require('../src/database/connection');
const { migrate } = require('../src/database/migrate');
const events = require('../src/modules/events/events.service');
const repo = require('../src/modules/events/events.repository');

migrate();

test.after(() => {
  getDatabase().close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function eventData(overrides = {}) {
  return {
    creatorId: overrides.creatorId || 'user-creator',
    title: overrides.title || 'Evento interrompido',
    description: 'Teste de recuperacao',
    location: 'Teste',
    scheduledTime: null,
    tankSlots: 1,
    healerSlots: 0,
    supportSlots: 0,
    dpsSlots: 0
  };
}

function createDiscordHarness() {
  const channels = new Map();
  const createdOptions = [];
  let channelSequence = 0;
  let messageSequence = 0;

  function textChannel(id) {
    const messages = new Map();
    const channel = {
      id,
      messages: {
        fetch: async (messageId) => messages.get(String(messageId)) || null
      },
      send: async (payload) => {
        const message = {
          id: `message-${++messageSequence}`,
          payload,
          edit: async (nextPayload) => {
            message.payload = nextPayload;
            return message;
          }
        };
        messages.set(message.id, message);
        return message;
      }
    };
    channels.set(id, channel);
    return channel;
  }

  const guild = {
    roles: { everyone: { id: 'everyone-role' } },
    members: {
      fetch: async (memberId) => ({
        id: String(memberId),
        displayName: `member-${memberId}`,
        voice: { channelId: null }
      })
    },
    channels: {
      fetch: async (channelId) => channels.get(String(channelId)) || null,
      create: async (options) => {
        assert.equal(options.type, ChannelType.GuildText);
        createdOptions.push(options);
        return textChannel(`review-channel-${++channelSequence}`);
      }
    }
  };

  const client = {
    guilds: {
      cache: new Map([[ids.guildId, guild]]),
      fetch: async () => guild
    },
    channels: {
      fetch: async (channelId) => channels.get(String(channelId)) || null
    }
  };

  return { channels, client, createdOptions, guild, textChannel };
}

test('recupera revisao interrompida com tipos explicitos nas permissoes', async () => {
  const harness = createDiscordHarness();
  const event = repo.createEvent(eventData());
  repo.upsertParticipant({
    eventId: event.id,
    discordId: 'user-participant',
    role: 'tank'
  });
  repo.updateEvent(event.id, {
    status: 'running',
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString()
  });
  events.saveLootReview({
    eventId: event.id,
    lootTotal: 1000,
    repair: 0,
    silverBags: 0,
    taxPercent: 0,
    evidenceNotes: 'interrompido antes de criar o canal'
  });

  const first = await events.recoverInterruptedEventReviews(harness.client);
  assert.deepEqual(first, { checked: 1, recovered: 1, failed: 0 });
  assert.equal(harness.createdOptions.length, 1);

  const overwrites = harness.createdOptions[0].permissionOverwrites;
  assert.equal(overwrites.find((item) => item.id === 'everyone-role').type, OverwriteType.Role);
  assert.equal(overwrites.find((item) => item.id === ids.roles.staff).type, OverwriteType.Role);
  assert.equal(overwrites.find((item) => item.id === 'user-creator').type, OverwriteType.Member);
  assert.equal(overwrites.find((item) => item.id === 'user-participant').type, OverwriteType.Member);

  const review = repo.getReview(event.id);
  assert.ok(review.review_channel_id);
  assert.ok(review.review_message_id);

  const second = await events.recoverInterruptedEventReviews(harness.client);
  assert.deepEqual(second, { checked: 1, recovered: 1, failed: 0 });
  assert.equal(harness.createdOptions.length, 1, 'nao deve criar outro canal ao repetir a recuperacao');
});

test('restaura mensagem e contagem de voz de evento ainda em andamento', async () => {
  const harness = createDiscordHarness();
  const publication = harness.textChannel('publication-channel');
  const event = repo.createEvent(eventData({ creatorId: 'running-creator', title: 'Evento em andamento' }));
  repo.upsertParticipant({
    eventId: event.id,
    discordId: 'running-participant',
    role: 'tank'
  });
  repo.updateEvent(event.id, {
    status: 'running',
    started_at: new Date().toISOString(),
    voice_channel_id: 'running-voice',
    message_channel_id: publication.id,
    message_id: null,
    review_required: 1
  });

  const member = {
    id: 'running-participant',
    voice: { channelId: 'running-voice' }
  };
  harness.channels.set('running-voice', {
    id: 'running-voice',
    members: new Map([[member.id, member]])
  });

  const first = await events.recoverRunningEventsOnStartup(harness.client);
  assert.deepEqual(first, { checked: 1, restored: 1, sessions: 1, failed: 0 });
  const recoveredEvent = repo.getEvent(event.id);
  assert.ok(recoveredEvent.message_id);
  assert.equal(recoveredEvent.review_required, 0);
  assert.ok(repo.getOpenVoiceSession({ eventId: event.id, discordId: member.id }));

  const second = await events.recoverRunningEventsOnStartup(harness.client);
  assert.deepEqual(second, { checked: 1, restored: 1, sessions: 0, failed: 0 });
});
