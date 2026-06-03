const { AttachmentBuilder } = require('discord.js');
const { backupDatabase } = require('../../database/backup');
const { transaction } = require('../../database/connection');
const { parseSilver } = require('../../utils/silver');
const { parseCsv, toCsv } = require('../../utils/csv');
const audit = require('../audit/audit.repository');
const financeRepo = require('../finance/finance.repository');
const registrationRepo = require('../registration/registration.repository');
const finance = require('../finance/finance.service');

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
  transactionsAttachment
};
