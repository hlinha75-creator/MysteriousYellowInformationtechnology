const { getDatabase } = require('../../database/connection');

function startSession({ discordId, discordName, channelId, channelName, categoryId, categoryName, joinedAt }) {
  const open = getOpenSession(discordId);
  if (open) return { changes: 0, lastInsertRowid: open.id };
  return getDatabase()
    .prepare(`
      INSERT INTO voice_sessions
        (discord_id, discord_name, channel_id, channel_name, category_id, category_name, joined_at)
      VALUES
        (@discordId, @discordName, @channelId, @channelName, @categoryId, @categoryName, @joinedAt)
    `)
    .run({ discordId, discordName, channelId, channelName, categoryId, categoryName, joinedAt });
}

function closeOpenSession({ discordId, leftAt }) {
  const open = getOpenSession(discordId);
  if (!open) return { changes: 0 };
  const seconds = Math.max(0, Math.floor((Date.parse(leftAt) - Date.parse(open.joined_at)) / 1000));
  return getDatabase()
    .prepare(`
      UPDATE voice_sessions
      SET left_at = @leftAt, seconds = @seconds
      WHERE id = @id
    `)
    .run({ id: open.id, leftAt, seconds });
}

function getOpenSession(discordId) {
  return getDatabase()
    .prepare('SELECT * FROM voice_sessions WHERE discord_id = ? AND left_at IS NULL ORDER BY id DESC LIMIT 1')
    .get(discordId);
}

function listSessions(limit = 10000) {
  return getDatabase()
    .prepare(`
      SELECT
        vs.id,
        vs.discord_id,
        COALESCE(u.discord_name, vs.discord_name) AS discord_name,
        u.albion_name,
        vs.channel_id,
        vs.channel_name,
        vs.category_id,
        vs.category_name,
        vs.joined_at,
        vs.left_at,
        CASE
          WHEN vs.left_at IS NULL THEN CAST((julianday('now') - julianday(vs.joined_at)) * 86400 AS INTEGER)
          ELSE vs.seconds
        END AS seconds
      FROM voice_sessions vs
      LEFT JOIN users u ON u.discord_id = vs.discord_id
      ORDER BY vs.joined_at DESC
      LIMIT ?
    `)
    .all(limit);
}

function listSessionsForDate(dateText) {
  return getDatabase()
    .prepare(`
      SELECT
        vs.id,
        vs.discord_id,
        COALESCE(u.discord_name, vs.discord_name) AS discord_name,
        u.albion_name,
        vs.channel_id,
        vs.channel_name,
        vs.category_id,
        vs.category_name,
        vs.joined_at,
        vs.left_at,
        CASE
          WHEN vs.left_at IS NULL THEN CAST((julianday('now') - julianday(vs.joined_at)) * 86400 AS INTEGER)
          ELSE vs.seconds
        END AS seconds
      FROM voice_sessions vs
      LEFT JOIN users u ON u.discord_id = vs.discord_id
      WHERE substr(vs.joined_at, 1, 10) = ?
      ORDER BY vs.discord_id, vs.joined_at
    `)
    .all(dateText);
}

function closeAllOpenSessions(leftAt) {
  return getDatabase()
    .prepare(`
      UPDATE voice_sessions
      SET
        left_at = @leftAt,
        seconds = MAX(0, CAST((julianday(@leftAt) - julianday(joined_at)) * 86400 AS INTEGER))
      WHERE left_at IS NULL
    `)
    .run({ leftAt });
}

module.exports = {
  closeAllOpenSessions,
  closeOpenSession,
  getOpenSession,
  listSessionsForDate,
  listSessions,
  startSession
};
