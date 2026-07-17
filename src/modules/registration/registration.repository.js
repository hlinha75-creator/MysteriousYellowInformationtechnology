const { getDatabase } = require('../../database/connection');

function upsertUser({ discordId, discordName, albionName, registrationStatus }) {
  getDatabase()
    .prepare(`
      INSERT INTO users (discord_id, discord_name, albion_name, registration_status, updated_at)
      VALUES (@discordId, @discordName, @albionName, @registrationStatus, CURRENT_TIMESTAMP)
      ON CONFLICT(discord_id) DO UPDATE SET
        discord_name = excluded.discord_name,
        albion_name = COALESCE(excluded.albion_name, users.albion_name),
        registration_status = excluded.registration_status,
        updated_at = CURRENT_TIMESTAMP
    `)
    .run({
      discordId,
      discordName,
      albionName: albionName || null,
      registrationStatus: registrationStatus || 'unregistered'
    });
}

function getUser(discordId) {
  return getDatabase().prepare('SELECT * FROM users WHERE discord_id = ?').get(discordId);
}

function findUserByAlbionName(albionName, exceptDiscordId = null) {
  return getDatabase()
    .prepare(`
      SELECT * FROM users
      WHERE lower(trim(albion_name)) = lower(trim(?))
        AND (? IS NULL OR discord_id <> ?)
      LIMIT 1
    `)
    .get(albionName, exceptDiscordId, exceptDiscordId);
}

function createRegistration({ discordId, albionName }) {
  return getDatabase()
    .prepare('INSERT INTO registrations (discord_id, albion_name) VALUES (?, ?)')
    .run(discordId, albionName);
}

function getRegistration(id) {
  return getDatabase().prepare('SELECT * FROM registrations WHERE id = ?').get(id);
}

function listPendingRegistrations() {
  return getDatabase()
    .prepare(`
      SELECT r.*, u.discord_name
      FROM registrations r
      LEFT JOIN users u ON u.discord_id = r.discord_id
      WHERE r.status = 'pending'
      ORDER BY r.created_at ASC, r.id ASC
    `)
    .all();
}

function updateRegistration({ id, status, reviewedBy, note }) {
  return getDatabase()
    .prepare(`
      UPDATE registrations
      SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .run(status, reviewedBy, note || null, id);
}

function logGuildMemberEvent({ eventType, discordId, discordName, displayName }) {
  const user = getUser(discordId) || {};
  return getDatabase()
    .prepare(`
      INSERT INTO guild_member_events
        (event_type, discord_id, discord_name, display_name, albion_name, registration_status)
      VALUES
        (@eventType, @discordId, @discordName, @displayName, @albionName, @registrationStatus)
    `)
    .run({
      eventType,
      discordId,
      discordName: discordName || user.discord_name || null,
      displayName: displayName || null,
      albionName: user.albion_name || null,
      registrationStatus: user.registration_status || null
    });
}

module.exports = {
  createRegistration,
  findUserByAlbionName,
  getRegistration,
  getUser,
  listPendingRegistrations,
  logGuildMemberEvent,
  updateRegistration,
  upsertUser
};
