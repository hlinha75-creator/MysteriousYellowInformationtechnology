const { getDatabase } = require('../../database/connection');

function createPoll({ creatorId, question, options, pollKey = null }) {
  const result = getDatabase()
    .prepare('INSERT INTO polls (creator_id, question, options_json, poll_key) VALUES (?, ?, ?, ?)')
    .run(creatorId, question, JSON.stringify(options), pollKey);
  return getPoll(result.lastInsertRowid);
}

function getPoll(id) {
  const row = getDatabase().prepare('SELECT * FROM polls WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, options: JSON.parse(row.options_json || '[]') };
}

function getPollByKey(pollKey) {
  const row = getDatabase().prepare('SELECT * FROM polls WHERE poll_key = ?').get(pollKey);
  if (!row) return null;
  return { ...row, options: JSON.parse(row.options_json || '[]') };
}

function setPollMessage({ id, channelId, messageId }) {
  getDatabase()
    .prepare('UPDATE polls SET channel_id = ?, message_id = ? WHERE id = ?')
    .run(channelId, messageId, id);
  return getPoll(id);
}

function updatePollContent({ id, question, options }) {
  getDatabase()
    .prepare('UPDATE polls SET question = ?, options_json = ? WHERE id = ?')
    .run(question, JSON.stringify(options), id);
  return getPoll(id);
}

function closePoll(id) {
  getDatabase()
    .prepare("UPDATE polls SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(id);
  return getPoll(id);
}

function markStaffAlerted(id) {
  getDatabase()
    .prepare('UPDATE polls SET staff_alerted_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(id);
  return getPoll(id);
}

function setAutoEvent({ id, eventId }) {
  getDatabase()
    .prepare('UPDATE polls SET auto_event_id = ? WHERE id = ?')
    .run(eventId, id);
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

function listPollsByKeyPrefix(prefix, limit = 14) {
  return getDatabase()
    .prepare(`
      SELECT *
      FROM polls
      WHERE poll_key LIKE ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(`${prefix}%`, limit)
    .map((row) => ({ ...row, options: JSON.parse(row.options_json || '[]') }));
}

function blackForFunVoiceSummary(days = 14) {
  return getDatabase()
    .prepare(`
      SELECT
        COUNT(DISTINCT e.id) AS events,
        COUNT(DISTINCT evs.discord_id) AS members,
        COALESCE(SUM(evs.seconds), 0) AS seconds
      FROM events e
      LEFT JOIN event_voice_sessions evs ON evs.event_id = e.id
      WHERE e.title = 'Black For-Fun'
        AND e.created_at >= datetime('now', ?)
    `)
    .get(`-${Number(days) || 14} days`);
}

module.exports = {
  closePoll,
  createPoll,
  getPoll,
  getPollByKey,
  blackForFunVoiceSummary,
  listPollsByKeyPrefix,
  listVotes,
  markStaffAlerted,
  setPollMessage,
  setAutoEvent,
  updatePollContent,
  upsertVote
};
