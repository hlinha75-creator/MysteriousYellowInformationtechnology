const { AttachmentBuilder } = require('discord.js');
const { backupDatabase } = require('../../database/backup');
const { transaction } = require('../../database/connection');
const { parseSilver } = require('../../utils/silver');
const { parseCsv, toCsv } = require('../../utils/csv');
const audit = require('../audit/audit.repository');
const financeRepo = require('../finance/finance.repository');
const registrationRepo = require('../registration/registration.repository');
const finance = require('../finance/finance.service');
const voiceRepo = require('../voice/voice.repository');

const importPreviews = new Map();

function balancesAttachment() {
  const rows = financeRepo.listBalances();
  const csv = toCsv(rows, ['discord_id', 'discord_name', 'albion_name', 'balance', 'last_updated']);
  return new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: 'saldos-guilda.csv' });
}

function transactionsAttachment() {
  const rows = financeRepo.listTransactions(5000).map((row) => ({
    id: row.id,
    type: row.type,
    user_id: row.user_id,
    amount: row.amount,
    before_balance: row.before_balance,
    after_balance: row.after_balance,
    reason: row.reason,
    created_by: row.created_by,
    created_at: row.created_at
  }));
  const csv = toCsv(rows, ['id', 'type', 'user_id', 'amount', 'before_balance', 'after_balance', 'reason', 'created_by', 'created_at']);
  return new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: 'logs-financeiros.csv' });
}

function auditAttachment() {
  const rows = audit.listAuditLogs(5000);
  const csv = toCsv(rows, ['id', 'type', 'actor_id', 'target_id', 'before_value', 'after_value', 'reason', 'metadata', 'created_at']);
  return new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: 'audit-logs.csv' });
}

function voiceAttachment() {
  const rows = voiceRepo.listSessions(20000).map((row) => ({
    ...row,
    weekday: weekdayName(row.joined_at),
    joined_hour: hourOfDay(row.joined_at),
    duration_minutes: Math.round((row.seconds / 60) * 100) / 100
  }));
  const columns = [
    'id',
    'discord_id',
    'discord_name',
    'albion_name',
    'channel_id',
    'channel_name',
    'category_id',
    'category_name',
    'joined_at',
    'left_at',
    'seconds',
    'duration_minutes',
    'weekday',
    'joined_hour'
  ];
  const csv = toCsv(rows, columns);
  return new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: 'voice-sessions.csv' });
}

function voiceDailyAttachment(dateText = todayIsoDate()) {
  dateText = normalizeIsoDate(dateText);
  const sessions = voiceRepo.listSessions(50000).filter((session) => dateInSaoPaulo(session.joined_at) === dateText);
  const byMember = new Map();

  for (const session of sessions) {
    const key = session.discord_id;
    const item = byMember.get(key) || {
      date: dateText,
      discord_id: session.discord_id,
      discord_name: session.discord_name || '',
      albion_name: session.albion_name || '',
      voice_sessions: 0,
      voice_seconds: 0,
      voice_minutes: 0,
      first_joined_at: session.joined_at,
      last_left_at: session.left_at || '',
      top_channels: new Map(),
      favorite_hours: new Map(),
      weekday: weekdayName(session.joined_at)
    };

    item.voice_sessions += 1;
    item.voice_seconds += session.seconds;
    item.voice_minutes = Math.round((item.voice_seconds / 60) * 100) / 100;
    if (session.joined_at < item.first_joined_at) item.first_joined_at = session.joined_at;
    if ((session.left_at || '') > item.last_left_at) item.last_left_at = session.left_at || '';
    incrementMap(item.top_channels, session.channel_name || 'Sem canal', session.seconds);
    incrementMap(item.favorite_hours, hourOfDay(session.joined_at), session.seconds);
    byMember.set(key, item);
  }

  const rows = [...byMember.values()].map((item) => ({
    ...item,
    top_channels: topKeys(item.top_channels, 5).join('|'),
    favorite_hours: topKeys(item.favorite_hours, 5).join('|')
  }));

  const columns = [
    'date',
    'discord_id',
    'discord_name',
    'albion_name',
    'voice_sessions',
    'voice_seconds',
    'voice_minutes',
    'first_joined_at',
    'last_left_at',
    'weekday',
    'top_channels',
    'favorite_hours'
  ];
  const csv = toCsv(rows, columns);
  return new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: `voice-daily-${dateText}.csv` });
}

function todayIsoDate() {
  return formatSaoPauloDate(new Date());
}

function normalizeIsoDate(dateText) {
  const normalized = String(dateText || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : todayIsoDate();
}

function dateInSaoPaulo(dateText) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return todayIsoDate();
  return formatSaoPauloDate(date);
}

function formatSaoPauloDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function incrementMap(map, key, value) {
  map.set(key, (map.get(key) || 0) + value);
}

function topKeys(map, limit) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key]) => key);
}

function weekdayName(dateText) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return '';
  return ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'][date.getDay()];
}

function hourOfDay(dateText) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return '';
  return String(date.getHours()).padStart(2, '0');
}

function previewBalanceImport(csvText) {
  const rows = parseCsv(csvText);
  const changes = [];
  let found = 0;
  let missing = 0;
  let totalBefore = 0;
  let totalAfter = 0;

  for (const row of rows) {
    const normalized = normalizeBalanceRow(row);
    const discordId = normalized.discordId;
    const albionName = normalized.albionName;
    const discordName = normalized.discordName;
    const amount = parseSilver(normalized.balance);
    let user = discordId ? registrationRepo.getUser(discordId) : null;
    if (!user && albionName) {
      user = require('../../database/connection')
        .getDatabase()
        .prepare('SELECT * FROM users WHERE lower(albion_name) = lower(?)')
        .get(albionName);
    }

    if (!user && !discordId) {
      missing += 1;
      continue;
    }

    const userId = user?.discord_id || discordId;
    if (!user && discordId) {
      registrationRepo.upsertUser({
        discordId,
        discordName: discordName || discordId,
        albionName,
        registrationStatus: albionName ? 'guest' : 'unregistered'
      });
    }

    const before = financeRepo.getBalance(userId);
    totalBefore += before;
    totalAfter += amount;
    found += 1;
    changes.push({ userId, albionName: user?.albion_name || albionName || discordName, before, after: amount });
  }

  return { found, missing, totalBefore, totalAfter, changes };
}

function normalizeBalanceRow(row) {
  const discordId = firstValue(row, ['discord_id', 'Discord_ID', 'ID', 'id']);
  const explicitAlbionName = firstValue(row, ['albion_name', 'Albion_Name', 'Albion', 'Nick']);
  return {
    discordId,
    discordName: firstValue(row, ['discord_name', 'Discord_Name', 'Nome', 'name']),
    albionName: explicitAlbionName || (discordId ? '' : firstValue(row, ['Nome'])),
    balance: firstValue(row, ['balance', 'Balance', 'Saldo', 'saldo']) || '0'
  };
}

function firstValue(row, keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== '') return String(row[key]).trim();
  }
  return '';
}

function saveImportPreview({ preview, actorId }) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  importPreviews.set(id, { preview, actorId, createdAt: Date.now() });
  return id;
}

function takeImportPreview(id) {
  const session = importPreviews.get(id);
  importPreviews.delete(id);
  return session;
}

const applyBalanceImport = transaction(({ preview, actorId }) => {
  backupDatabase('before_csv_import');
  const transactions = [];
  for (const change of preview.changes) {
    const diff = change.after - change.before;
    if (diff !== 0) {
      const item = {
        type: 'csv_import',
        userId: change.userId,
        amount: diff,
        reason: 'Importacao CSV de saldos',
        referenceType: 'csv_import',
        referenceId: null,
        createdBy: actorId
      };
      finance.applyBalanceTransaction(item);
      transactions.push(item);
    }
  }
  audit.createAuditLog({
    type: 'csv_import_applied',
    actorId,
    reason: 'Importacao CSV confirmada',
    metadata: {
      found: preview.found,
      missing: preview.missing,
      totalBefore: preview.totalBefore,
      totalAfter: preview.totalAfter
    }
  });
  return transactions;
});

module.exports = {
  applyBalanceImport,
  auditAttachment,
  balancesAttachment,
  saveImportPreview,
  previewBalanceImport,
  takeImportPreview,
  transactionsAttachment,
  voiceAttachment,
  voiceDailyAttachment
};
