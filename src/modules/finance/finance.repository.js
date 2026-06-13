const { getDatabase } = require('../../database/connection');

function getBalance(userId) {
  const row = getDatabase().prepare('SELECT balance FROM balances WHERE discord_id = ?').get(userId);
  return row?.balance || 0;
}

function ensureBalance(userId) {
  getDatabase()
    .prepare('INSERT OR IGNORE INTO balances (discord_id, balance) VALUES (?, 0)')
    .run(userId);
  return getBalance(userId);
}

function setBalance({ userId, amount }) {
  getDatabase()
    .prepare(`
      INSERT INTO balances (discord_id, balance, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(discord_id) DO UPDATE SET balance = excluded.balance, updated_at = CURRENT_TIMESTAMP
    `)
    .run(userId, amount);
}

function insertTransaction({ type, userId, amount, beforeBalance, afterBalance, reason, referenceType, referenceId, createdBy }) {
  return getDatabase()
    .prepare(`
      INSERT INTO balance_transactions
        (type, user_id, amount, before_balance, after_balance, reason, reference_type, reference_id, created_by)
      VALUES
        (@type, @userId, @amount, @beforeBalance, @afterBalance, @reason, @referenceType, @referenceId, @createdBy)
    `)
    .run({
      type,
      userId,
      amount,
      beforeBalance,
      afterBalance,
      reason,
      referenceType: referenceType || null,
      referenceId: referenceId || null,
      createdBy
    });
}

function listBalances() {
  return getDatabase()
    .prepare(`
      SELECT b.discord_id, u.discord_name, u.albion_name, b.balance, b.updated_at AS last_updated
      FROM balances b
      LEFT JOIN users u ON u.discord_id = b.discord_id
      ORDER BY COALESCE(u.albion_name, u.discord_name, b.discord_id) COLLATE NOCASE
    `)
    .all();
}

function listTransactions(limit = 1000) {
  return getDatabase()
    .prepare('SELECT * FROM balance_transactions ORDER BY id DESC LIMIT ?')
    .all(limit);
}

function createWithdrawRequest({ userId, amount, note }) {
  return getDatabase()
    .prepare('INSERT INTO withdraw_requests (user_id, amount, note) VALUES (?, ?, ?)')
    .run(userId, amount, note || null);
}

function updateWithdrawStatus({ id, status, actorId }) {
  const column = status === 'paid' ? 'paid_by' : 'reviewed_by';
  const dateColumn = status === 'paid' ? 'paid_at' : 'reviewed_at';
  return getDatabase()
    .prepare(`UPDATE withdraw_requests SET status = ?, ${column} = ?, ${dateColumn} = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(status, actorId, id);
}

function getWithdrawRequest(id) {
  return getDatabase().prepare('SELECT * FROM withdraw_requests WHERE id = ?').get(id);
}

module.exports = {
  createWithdrawRequest,
  ensureBalance,
  getBalance,
  getWithdrawRequest,
  insertTransaction,
  listBalances,
  listTransactions,
  setBalance,
  updateWithdrawStatus
};
