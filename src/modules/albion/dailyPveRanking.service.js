const { EmbedBuilder } = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase } = require('../../database/connection');
const { formatFame } = require('./fame.service');

const DEFAULT_API_BASE = 'https://gameinfo.albiononline.com/api/gameinfo';
const POST_AFTER_HOUR = 9;

async function postDailyPveRankingIfNeeded(client, now = new Date()) {
  if (saoPauloHour(now) < POST_AFTER_HOUR) return null;

  const dateKey = saoPauloDateKey(now);
  const reminderKey = `albion-pve-top5:${dateKey}`;
  const db = getDatabase();
  if (db.prepare('SELECT 1 FROM operation_reminders WHERE reminder_key = ?').get(reminderKey)) return null;

  const names = db.prepare(`
    SELECT DISTINCT albion_name
    FROM users
    WHERE albion_name IS NOT NULL AND trim(albion_name) <> ''
      AND registration_status = 'member'
    ORDER BY albion_name COLLATE NOCASE
  `).all().map((row) => row.albion_name);

  if (!names.length) throw new Error('Nao ha jogadores Albion aprovados para montar o Top 5 PvE.');

  const ranking = await fetchPveRanking(names);
  if (!ranking.length) throw new Error('A API do Albion nao retornou fama PvE para nenhum jogador cadastrado.');

  const channel = await client.channels.fetch(ids.channels.notagChat);
  if (!channel?.isTextBased()) throw new Error(`Canal do Top 5 PvE indisponivel: ${ids.channels.notagChat}`);

  const top = ranking.slice(0, 5);
  const message = await channel.send({ embeds: [pveRankingEmbed(top, dateKey)] });
  db.prepare(`
    INSERT INTO operation_reminders (reminder_key, type, message_id, channel_id)
    VALUES (?, 'albion_pve_top5', ?, ?)
  `).run(reminderKey, message.id, channel.id);

  return { totalPlayers: ranking.length, top, messageId: message.id };
}

async function fetchPveRanking(names, { fetchImpl = fetch, apiBase = process.env.ALBION_API_BASE || DEFAULT_API_BASE } = {}) {
  const uniqueNames = [...new Set(names.map((name) => String(name || '').trim()).filter(Boolean))];
  const results = [];

  for (let index = 0; index < uniqueNames.length; index += 8) {
    const batch = uniqueNames.slice(index, index + 8);
    const rows = await Promise.all(batch.map((name) => fetchPlayerPve(name, { fetchImpl, apiBase })));
    results.push(...rows.filter(Boolean));
  }

  return results.sort((left, right) => right.pveFame - left.pveFame || left.name.localeCompare(right.name));
}

async function fetchPlayerPve(name, { fetchImpl, apiBase }) {
  const searchResponse = await fetchImpl(`${apiBase}/search?q=${encodeURIComponent(name)}`);
  if (!searchResponse.ok) throw new Error(`API Albion respondeu ${searchResponse.status} ao buscar ${name}.`);
  const search = await searchResponse.json();
  const match = (search.players || []).find((player) => normalizeName(player.Name) === normalizeName(name));
  if (!match?.Id) return null;

  const playerResponse = await fetchImpl(`${apiBase}/players/${encodeURIComponent(match.Id)}`);
  if (!playerResponse.ok) throw new Error(`API Albion respondeu ${playerResponse.status} ao consultar ${name}.`);
  const player = await playerResponse.json();
  const pveFame = extractPveFame(player);
  return { name: player.Name || match.Name || name, pveFame };
}

function extractPveFame(player) {
  const pve = player?.LifetimeStatistics?.PvE || {};
  const directTotal = Number(pve.Total);
  if (Number.isFinite(directTotal)) return directTotal;
  return Object.values(pve).reduce((total, value) => total + (Number(value) || 0), 0);
}

function pveRankingEmbed(top, dateKey) {
  return new EmbedBuilder()
    .setColor(0x38a169)
    .setTitle('Top 5 — Fama PvE')
    .setDescription(top.map((row, index) => `${medal(index)} **${row.name}** — ${formatFame(row.pveFame)}`).join('\n'))
    .setFooter({ text: `Fama total de carreira • Atualizado em ${formatDate(dateKey)}` })
    .setTimestamp();
}

function medal(index) {
  return ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][index] || `${index + 1}.`;
}

function normalizeName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function saoPauloHour(date) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(date));
}

function saoPauloDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDate(dateKey) {
  const [year, month, day] = dateKey.split('-');
  return `${day}/${month}/${year}`;
}

module.exports = { extractPveFame, fetchPveRanking, postDailyPveRankingIfNeeded };
