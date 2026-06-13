const { getDatabase } = require('../../database/connection');

function createPoll({ creatorId, question, options }) {
  const result = getDatabase()
    .prepare('INSERT INTO polls (creator_id, question, options_json) VALUES (?, ?, ?)')
    .run(creatorId, question, JSON.stringify(options));
  return getPoll(result.lastInsertRowid);
}

function getPoll(id) {
  const row = getDatabase().prepare('SELECT * FROM polls WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, options: JSON.parse(row.options_json || '[]') };
}

function setPollMessage({ id, channelId, messageId }) {
  getDatabase()
    .prepare('UPDATE polls SET channel_id = ?, message_id = ? WHERE id = ?')
    .run(channelId, messageId, id);
  return getPoll(id);
}

function closePoll(id) {
  getDatabase()
    .prepare("UPDATE polls SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(id);
  return getPoll(id);
}

function upsertVote({ pollId, userId, options }) {
  getDatabase()
    .prepare(`
      INSERT INTO poll_votes (poll_id, user_id, options_json, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(poll_id, user_id) DO UPDATE SET
        options_json = excluded.options_json,
        updated_at = CURRENT_TIMESTAMP
    `)
    .run(pollId, userId, JSON.stringify(options));
}

function listVotes(pollId) {
  return getDatabase()
    .prepare('SELECT * FROM poll_votes WHERE poll_id = ? ORDER BY updated_at DESC')
    .all(pollId)
    .map((row) => ({ ...row, options: JSON.parse(row.options_json || '[]') }));
}

module.exports = {
  closePoll,
  createPoll,
  getPoll,
  listVotes,
  setPollMessage,
  upsertVote
};
