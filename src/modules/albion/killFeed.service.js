const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase, transaction } = require('../../database/connection');
const finance = require('../finance/finance.service');
const { renderKillCard } = require('./killCardRenderer');
const { estimateVictimLoss } = require('./marketValue.service');

const DEFAULT_API_BASE = 'https://gameinfo-ams.albiononline.com/api/gameinfo';
const LEGACY_AMERICAS_API_BASE = 'https://gameinfo.albiononline.com/api/gameinfo';
const GUILD_NAME = process.env.ALBION_GUILD_NAME || 'NoTag';
const PAGE_SIZE = 51;
const MAX_PAGES = 20;
const API_TIMEOUT_MS = 45000;
const API_RETRIES = 3;
const VENGEANCE_REWARD = 100000;
const VENGEANCE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DAILY_VENGEANCE_REWARDS = 3;
let polling = false;
let lastHealthLogAt = 0;

function configuredApiBase(options = {}) {
  if (options.apiBase) return options.apiBase;
  const configured = String(process.env.ALBION_API_BASE_URL || process.env.ALBION_API_BASE || '').replace(/\/$/, '');
  // A NoTag deste Discord joga na Europa. Corrige automaticamente a configuracao antiga de Americas.
  if (!configured || configured === LEGACY_AMERICAS_API_BASE) return DEFAULT_API_BASE;
  return configured;
}

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US');
}

function classifyEvent(event, guildName = GUILD_NAME) {
  const guild = normalize(guildName);
  const isKill = normalize(event?.Killer?.GuildName) === guild;
  const isDeath = normalize(event?.Victim?.GuildName) === guild;
  if (!isKill && !isDeath) return null;
  return isDeath ? 'death' : 'kill';
}

function formatNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function playerLabel(player) {
  const guild = player?.GuildName ? ` [${player.GuildName}]` : '';
  return `**${player?.Name || 'Desconhecido'}**${guild}`;
}

function itemLabel(item) {
  if (!item?.Type) return null;
  const quality = Number(item.Quality || 0) > 1 ? ` Q${item.Quality}` : '';
  const count = Number(item.Count || 1) > 1 ? ` ×${item.Count}` : '';
  return `\`${item.Type}\`${quality}${count}`;
}

function equipmentLines(player) {
  const slots = [
    ['Arma', 'MainHand'], ['Mão secundária', 'OffHand'], ['Cabeça', 'Head'],
    ['Peito', 'Armor'], ['Pés', 'Shoes'], ['Capa', 'Cape'],
    ['Bolsa', 'Bag'], ['Montaria', 'Mount'], ['Comida', 'Food'], ['Poção', 'Potion']
  ];
  const lines = slots
    .map(([label, key]) => player?.Equipment?.[key] ? `**${label}:** ${itemLabel(player.Equipment[key])}` : null)
    .filter(Boolean);
  return lines.length ? lines.join('\n') : 'Equipamento não informado pela API.';
}

function inventoryLines(event) {
  const items = (event?.Victim?.Inventory || []).filter(Boolean);
  if (!items.length) return ['Inventário vazio ou não informado pela API.'];
  return items.map((item, index) => `${index + 1}. ${itemLabel(item)}`);
}

function participantLines(event) {
  const victimId = event?.Victim?.Id;
  return (event?.Participants || [])
    .filter((participant) => participant?.Id && participant.Id !== victimId)
    .sort((a, b) => Number(b.DamageDone || 0) - Number(a.DamageDone || 0))
    .map((participant, index) => {
      const guild = participant.GuildName ? ` [${participant.GuildName}]` : '';
      const damage = formatNumber(participant.DamageDone);
      const support = formatNumber(participant.SupportHealingDone);
      return `${index + 1}. **${participant.Name || 'Desconhecido'}**${guild} — ${damage} dano${Number(participant.SupportHealingDone || 0) ? ` • ${support} cura` : ''}`;
    });
}

function splitLines(lines, maxLength = 3800) {
  const chunks = [];
  let current = '';
  for (const line of lines) {
    if (current && current.length + line.length + 1 > maxLength) {
      chunks.push(current);
      current = '';
    }
    current += `${current ? '\n' : ''}${line.slice(0, maxLength)}`;
  }
  if (current) chunks.push(current);
  return chunks;
}

function killboardRegion(apiBase = '') {
  if (String(apiBase).includes('gameinfo-ams')) return 'eu';
  if (String(apiBase).includes('gameinfo-sgp')) return 'asia';
  return 'americas';
}

function registeredPlayer(db, albionPlayer) {
  const name = String(albionPlayer?.Name || '').trim();
  if (!name) return null;
  return db.prepare(`
    SELECT discord_id, albion_name FROM users
    WHERE registration_status = 'member' AND lower(trim(albion_name)) = lower(?)
    LIMIT 1
  `).get(name);
}

function recordVengeanceDeath(db, event) {
  const victim = registeredPlayer(db, event.Victim);
  if (!victim || !event.Killer?.Id || !event.EventId) return false;
  const occurredAt = new Date(event.TimeStamp || Date.now());
  if (Number.isNaN(occurredAt.getTime())) return false;
  db.prepare(`
    INSERT OR IGNORE INTO albion_vengeance_deaths
      (original_event_id, victim_discord_id, victim_albion_name, enemy_player_id, enemy_player_name, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(event.EventId, victim.discord_id, victim.albion_name, event.Killer.Id, event.Killer.Name || 'Desconhecido', occurredAt.toISOString());
  return true;
}

function findVengeanceMatches(db, event, now = new Date()) {
  const avenger = registeredPlayer(db, event.Killer);
  if (!avenger || !event.Victim?.Id || !event.EventId) return null;
  if (event.Killer?.AllianceId && event.Killer.AllianceId === event.Victim?.AllianceId) return null;
  const cutoff = new Date(now.getTime() - VENGEANCE_WINDOW_MS).toISOString();
  const rows = db.prepare(`
    SELECT * FROM albion_vengeance_deaths
    WHERE enemy_player_id = ? AND avenged_event_id IS NULL AND occurred_at >= ?
    ORDER BY occurred_at ASC
  `).all(event.Victim.Id, cutoff).filter((row) => row.victim_discord_id !== avenger.discord_id);
  return rows.length ? { avenger, rows } : null;
}

async function processVengeance(client, channel, db, event, now = new Date()) {
  if (db.prepare('SELECT 1 FROM albion_vengeance_rewards WHERE vengeance_event_id = ?').get(event.EventId)) return null;
  const match = findVengeanceMatches(db, event, now);
  if (!match) return null;
  const rewardedLastDay = db.prepare(`
    SELECT COUNT(*) AS total FROM albion_vengeance_rewards
    WHERE avenger_discord_id = ? AND rewarded_at >= datetime('now', '-1 day')
  `).get(match.avenger.discord_id).total;
  if (Number(rewardedLastDay) >= MAX_DAILY_VENGEANCE_REWARDS) return null;

  const originalIds = match.rows.map((row) => row.original_event_id);
  awardVengeance(event, match, originalIds);

  const mentions = [...new Set(match.rows.map((row) => `<@${row.victim_discord_id}>`))].join(', ');
  const oldest = Math.min(...match.rows.map((row) => new Date(row.occurred_at).getTime()));
  const days = Math.max(0, Math.floor((now.getTime() - oldest) / 86400000));
  const message = await channel.send({
    content: mentions,
    embeds: [new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('⚔️ Morte vingada!')
      .setDescription(`**${event.Killer.Name}** vingou ${mentions}, eliminando **${event.Victim.Name}**.`)
      .addFields(
        { name: 'Quando foi a morte', value: days === 0 ? 'Hoje' : `Há ${days} dia${days === 1 ? '' : 's'}`, inline: true },
        { name: 'Recompensa', value: '100k de saldo', inline: true },
        { name: 'Vingador', value: `<@${match.avenger.discord_id}>`, inline: true }
      )]
  });
  await finance.notifyPositiveTransactions({
    client,
    transactions: [{ userId: match.avenger.discord_id, amount: VENGEANCE_REWARD, reason: `Vingança contra ${event.Victim.Name}` }]
  });
  return { messageId: message.id, rewardedUserId: match.avenger.discord_id, originalIds };
}

const awardVengeance = transaction((event, match, originalIds) => {
  finance.applyManyTransactions([{
    type: 'vengeance_reward',
    userId: match.avenger.discord_id,
    amount: VENGEANCE_REWARD,
    reason: `Recompensa por vinganca no evento Albion #${event.EventId}`,
    referenceType: 'albion_vengeance',
    referenceId: String(event.EventId),
    createdBy: 'system'
  }]);
  const db = getDatabase();
  db.prepare(`
    INSERT INTO albion_vengeance_rewards
      (vengeance_event_id, avenger_discord_id, amount, original_events_json)
    VALUES (?, ?, ?, ?)
  `).run(event.EventId, match.avenger.discord_id, VENGEANCE_REWARD, JSON.stringify(originalIds));
  const mark = db.prepare(`
    UPDATE albion_vengeance_deaths
    SET avenged_event_id = ?, avenger_discord_id = ?, avenged_at = CURRENT_TIMESTAMP
    WHERE original_event_id = ? AND avenged_event_id IS NULL
  `);
  match.rows.forEach((row) => mark.run(event.EventId, match.avenger.discord_id, row.original_event_id));
});

function eventEmbed(event, type) {
  const death = type === 'death';
  const occurredAt = event.TimeStamp ? new Date(event.TimeStamp) : null;
  const embed = new EmbedBuilder()
    .setColor(death ? 0xd83c3e : 0x2ecc71)
    .setTitle(death ? '☠️ Morte da NoTag' : '⚔️ Kill da NoTag')
    .setDescription(`${playerLabel(event.Killer)} matou ${playerLabel(event.Victim)}`)
    .addFields(
      { name: 'Fama da kill', value: formatNumber(event.TotalVictimKillFame), inline: true },
      { name: 'IP', value: `${Math.round(Number(event.Killer?.AverageItemPower || 0))} vs ${Math.round(Number(event.Victim?.AverageItemPower || 0))}`, inline: true },
      { name: 'Participantes', value: String(event.numberOfParticipants || event.Participants?.length || 1), inline: true }
    )
    .setFooter({ text: `Evento #${event.EventId} • Albion Americas` });
  if (occurredAt && !Number.isNaN(occurredAt.getTime())) embed.setTimestamp(occurredAt);
  return embed;
}

function eventPayload(event, type, apiBase = DEFAULT_API_BASE) {
  const embeds = [eventEmbed(event, type)];
  embeds.push(new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`⚔️ Equipamento — ${event.Killer?.Name || 'Killer'}`)
    .setDescription(equipmentLines(event.Killer)));
  embeds.push(new EmbedBuilder()
    .setColor(0x992d22)
    .setTitle(`🛡️ Equipamento — ${event.Victim?.Name || 'Vítima'}`)
    .setDescription(equipmentLines(event.Victim)));

  splitLines(inventoryLines(event)).forEach((description, index) => {
    embeds.push(new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle(`🎒 Inventário da vítima${index ? ` (${index + 1})` : ''}`)
      .setDescription(description));
  });
  const participants = participantLines(event);
  splitLines(participants.length ? participants : ['Nenhuma assistência informada pela API.']).forEach((description, index) => {
    embeds.push(new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`👥 Participantes${index ? ` (${index + 1})` : ''}`)
      .setDescription(description));
  });

  const url = `https://killboard-1.com/${killboardRegion(apiBase)}/event/${event.EventId}`;
  const components = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Ver no KillBoard #1').setURL(url)
  )];
  return { embeds: embeds.slice(0, 10), components };
}

async function imageEventPayload(event, type, apiBase = DEFAULT_API_BASE, options = {}) {
  const base = eventPayload(event, type, apiBase);
  let valuation = null;
  try {
    valuation = await estimateVictimLoss(event, options);
  } catch (error) {
    console.error(`Falha ao estimar valor perdido no evento Albion #${event.EventId}:`, error.message);
  }
  const image = await renderKillCard(event, type, { ...options, estimatedLoss: valuation?.total || 0 });
  const summary = base.embeds[0].setImage('attachment://kill-card.png');
  if (valuation?.total > 0) {
    summary.addFields({
      name: 'Prata perdida (estimativa)',
      value: `${formatNumber(valuation.total)} (${valuation.priced}/${valuation.items} itens com preço)`,
      inline: true
    });
  }
  const participantEmbeds = base.embeds.filter((embed) => embed.data.title?.startsWith('👥'));
  return {
    embeds: [summary, ...participantEmbeds].slice(0, 10),
    components: base.components,
    files: [{ attachment: image, name: 'kill-card.png' }]
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(fetchImpl, apiBase, offset, options = {}) {
  const retries = options.retries ?? API_RETRIES;
  const timeoutMs = options.timeoutMs ?? API_TIMEOUT_MS;
  const url = `${apiBase.replace(/\/$/, '')}/events?limit=${PAGE_SIZE}&offset=${offset}`;
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'Notag-Discord-Killfeed/1.0' }
      });
      if (!response.ok) {
        const error = new Error(`API Albion respondeu ${response.status}.`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      const body = await response.json();
      if (!Array.isArray(body)) throw new Error('API Albion retornou um formato inesperado.');
      return body;
    } catch (error) {
      lastError = error;
      const retryable = error.name === 'AbortError' || error.retryable || error instanceof TypeError;
      if (!retryable || attempt === retries) break;
      await (options.waitImpl || wait)(attempt * 1500);
    } finally {
      clearTimeout(timeout);
    }
  }
  const detail = lastError?.name === 'AbortError'
    ? `timeout de ${Math.round(timeoutMs / 1000)}s`
    : lastError?.message || 'erro desconhecido';
  throw new Error(`Falha na API Albion após ${retries} tentativa(s): ${detail}`, { cause: lastError });
}

async function fetchRecentEvents(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const apiBase = configuredApiBase(options);
  const lastId = Number(options.lastId || 0);
  const result = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = await fetchPage(fetchImpl, apiBase, page * PAGE_SIZE, options);
    result.push(...rows);
    if (rows.length < PAGE_SIZE || (lastId && rows.some((row) => Number(row.EventId) <= lastId))) break;
  }
  return result;
}

async function pollKillFeed(client, options = {}) {
  if (polling) return { skipped: true };
  polling = true;
  try {
    const db = options.db || getDatabase();
    const apiBase = configuredApiBase(options);
    const cursorKey = `latest_global_event_id:${killboardRegion(apiBase)}`;
    const storedCursor = Number(db.prepare('SELECT value FROM albion_killfeed_state WHERE key = ?').get(cursorKey)?.value || 0);
    const latest = storedCursor;
    const events = await fetchRecentEvents({ ...options, lastId: latest });
    const relevant = events
      .map((event) => ({ event, type: classifyEvent(event, options.guildName) }))
      .filter((item) => item.type && Number(item.event.EventId) > latest)
      .sort((a, b) => Number(a.event.EventId) - Number(b.event.EventId));

    const exists = db.prepare('SELECT 1 FROM albion_killfeed_events WHERE event_id = ?');
    const save = db.prepare('INSERT INTO albion_killfeed_events (event_id, event_type, event_at, discord_message_id) VALUES (?, ?, ?, ?)');
    let posted = 0;
    for (const item of relevant) {
      if (exists.get(item.event.EventId)) continue;
      const channelId = item.type === 'death' ? ids.channels.deathFeed : ids.channels.killFeed;
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased()) throw new Error(`Canal do killfeed indisponivel: ${channelId}`);
      let payload;
      try {
        payload = await imageEventPayload(item.event, item.type, apiBase, options);
      } catch (error) {
        console.error(`Falha ao gerar imagem do evento Albion #${item.event.EventId}:`, error);
        payload = eventPayload(item.event, item.type, apiBase);
      }
      const message = await channel.send(payload);
      save.run(item.event.EventId, item.type, item.event.TimeStamp || null, message.id);
      if (item.type === 'death') recordVengeanceDeath(db, item.event);
      if (item.type === 'kill') await processVengeance(client, channel, db, item.event);
      posted += 1;
    }
    const newestGlobalId = Math.max(latest, ...events.map((event) => Number(event.EventId) || 0));
    if (newestGlobalId > 0) {
      db.prepare(`
        INSERT INTO albion_killfeed_state (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(cursorKey, String(newestGlobalId));
    }
    const now = Date.now();
    if (posted > 0 || now - lastHealthLogAt >= 10 * 60 * 1000) {
      console.log(`[KILLFEED] OK Europa | ${events.length} eventos consultados | ${relevant.length} da NoTag | ${posted} publicados | cursor ${newestGlobalId}`);
      lastHealthLogAt = now;
    }
    return { posted, checked: events.length, relevant: relevant.length, cursor: newestGlobalId };
  } finally {
    polling = false;
  }
}

module.exports = {
  classifyEvent,
  configuredApiBase,
  eventEmbed,
  eventPayload,
  imageEventPayload,
  fetchRecentEvents,
  findVengeanceMatches,
  pollKillFeed,
  recordVengeanceDeath
};
