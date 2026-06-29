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

function listAllBalances() {
  return getDatabase()
    .prepare(`
      SELECT discord_id, discord_name, albion_name, balance, last_updated
      FROM (
        SELECT
          u.discord_id,
          u.discord_name,
          u.albion_name,
          COALESCE(b.balance, 0) AS balance,
          b.updated_at AS last_updated,
          COALESCE(u.albion_name, u.discord_name, u.discord_id) AS sort_name
        FROM users u
        LEFT JOIN balances b ON b.discord_id = u.discord_id
        UNION
        SELECT
          b.discord_id,
          NULL AS discord_name,
          NULL AS albion_name,
          b.balance,
          b.updated_at AS last_updated,
          b.discord_id AS sort_name
        FROM balances b
        LEFT JOIN users u ON u.discord_id = b.discord_id
        WHERE u.discord_id IS NULL
      )
      ORDER BY sort_name COLLATE NOCASE
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

function createPaymentRequest({ userId, amount, service, description, evidence }) {
  return getDatabase()
    .prepare(`
      INSERT INTO payment_requests (user_id, amount, service, description, evidence)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(userId, amount, service, description, evidence || null);
}

function updatePaymentRequestStatus({ id, status, actorId }) {
  return getDatabase()
    .prepare('UPDATE payment_requests SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(status, actorId, id);
}

function getPaymentRequest(id) {
  return getDatabase().prepare('SELECT * FROM payment_requests WHERE id = ?').get(id);
}

module.exports = {
  createPaymentRequest,
  createWithdrawRequest,
  ensureBalance,
  getBalance,
  getPaymentRequest,
  getWithdrawRequest,
  insertTransaction,
  listAllBalances,
  listBalances,
  listTransactions,
  setBalance,
  updatePaymentRequestStatus,
  updateWithdrawStatus
};
