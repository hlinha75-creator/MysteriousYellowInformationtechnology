const { getDatabase } = require('../../database/connection');

function recordEvent({ eventType, eventName, detail = '', userId = '', channelId = '', channelName = '', createdAt = new Date().toISOString() }) {
  return getDatabase()
    .prepare(`
      INSERT INTO server_usage_events
        (event_type, event_name, detail, user_id, channel_id, channel_name, created_at)
      VALUES
        (@eventType, @eventName, @detail, @userId, @channelId, @channelName, @createdAt)
    `)
    .run({ eventType, eventName, detail, userId, channelId, channelName, createdAt });
}

function summarizeUsage(days = 30, limit = 100) {
  return getDatabase()
    .prepare(`
      SELECT
        event_type AS eventType,
        event_name AS eventName,
        detail,
        COUNT(*) AS total,
        COUNT(DISTINCT user_id) AS uniqueUsers,
        MAX(created_at) AS lastUsedAt
      FROM server_usage_events
      WHERE created_at >= datetime('now', ?)
      GROUP BY event_type, event_name, detail
      ORDER BY total DESC, lastUsedAt DESC
      LIMIT ?
    `)
    .all(`-${days} days`, limit);
}

function summarizeChannels(days = 30, limit = 30) {
  return getDatabase()
    .prepare(`
      SELECT
        channel_id AS channelId,
        COALESCE(NULLIF(channel_name, ''), channel_id, 'Sem canal') AS channelName,
        COUNT(*) AS total,
        COUNT(DISTINCT user_id) AS uniqueUsers,
        MAX(created_at) AS lastUsedAt
      FROM server_usage_events
      WHERE created_at >= datetime('now', ?)
        AND channel_id IS NOT NULL
        AND channel_id <> ''
      GROUP BY channel_id, channel_name
      ORDER BY total DESC, lastUsedAt DESC
      LIMIT ?
    `)
    .all(`-${days} days`, limit);
}

function summarizeVoiceChannels(days = 30, limit = 30) {
  return getDatabase()
    .prepare(`
      SELECT
        channel_id AS channelId,
        COALESCE(NULLIF(channel_name, ''), channel_id, 'Sem canal') AS channelName,
        COALESCE(NULLIF(category_name, ''), 'Sem categoria') AS categoryName,
        COUNT(*) AS sessions,
        COUNT(DISTINCT discord_id) AS uniqueUsers,
        SUM(
          CASE
            WHEN left_at IS NULL THEN CAST((julianday('now') - julianday(joined_at)) * 86400 AS INTEGER)
            ELSE seconds
          END
        ) AS totalSeconds,
        MAX(COALESCE(left_at, joined_at)) AS lastUsedAt
      FROM voice_sessions
      WHERE joined_at >= datetime('now', ?)
      GROUP BY channel_id, channel_name, category_name
      ORDER BY totalSeconds DESC, sessions DESC
      LIMIT ?
    `)
    .all(`-${days} days`, limit);
}

function summarizeVoiceMembers(days = 30, limit = 30) {
  return getDatabase()
    .prepare(`
      SELECT
        vs.discord_id AS discordId,
        COALESCE(u.albion_name, u.discord_name, vs.discord_name, vs.discord_id) AS displayName,
        COUNT(*) AS sessions,
        COUNT(DISTINCT vs.channel_id) AS channelsUsed,
        SUM(
          CASE
            WHEN vs.left_at IS NULL THEN CAST((julianday('now') - julianday(vs.joined_at)) * 86400 AS INTEGER)
            ELSE vs.seconds
          END
        ) AS totalSeconds,
        MAX(COALESCE(vs.left_at, vs.joined_at)) AS lastSeenAt
      FROM voice_sessions vs
      LEFT JOIN users u ON u.discord_id = vs.discord_id
      WHERE vs.joined_at >= datetime('now', ?)
      GROUP BY vs.discord_id, displayName
      ORDER BY totalSeconds DESC, sessions DESC
      LIMIT ?
    `)
    .all(`-${days} days`, limit);
}

function summarizeVoiceHours(days = 30) {
  return getDatabase()
    .prepare(`
      SELECT
        strftime('%H', joined_at) AS hour,
        COUNT(*) AS sessions,
        SUM(
          CASE
            WHEN left_at IS NULL THEN CAST((julianday('now') - julianday(joined_at)) * 86400 AS INTEGER)
            ELSE seconds
          END
        ) AS totalSeconds
      FROM voice_sessions
      WHERE joined_at >= datetime('now', ?)
      GROUP BY hour
      ORDER BY hour
    `)
    .all(`-${days} days`);
}

module.exports = {
  recordEvent,
  summarizeChannels,
  summarizeUsage,
  summarizeVoiceChannels,
  summarizeVoiceHours,
  summarizeVoiceMembers
};
