const { getDatabase, transaction } = require('../../database/connection');

function nextEventCode() {
  const row = getDatabase().prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get('events');
  const next = (row?.seq || 0) + 1;
  return `EVT-${String(next).padStart(6, '0')}`;
}

function createEvent(data) {
  const eventCode = nextEventCode();
  const result = getDatabase()
    .prepare(`
      INSERT INTO events
        (event_code, creator_id, title, description, location, scheduled_time, tank_slots, healer_slots, support_slots, dps_slots)
      VALUES
        (@eventCode, @creatorId, @title, @description, @location, @scheduledTime, @tankSlots, @healerSlots, @supportSlots, @dpsSlots)
    `)
    .run({ ...data, eventCode });
  return getEvent(result.lastInsertRowid);
}

function getEvent(id) {
  return getDatabase().prepare('SELECT * FROM events WHERE id = ?').get(id);
}

function getEventByCode(eventCode) {
  return getDatabase().prepare('SELECT * FROM events WHERE event_code = ?').get(eventCode);
}

function getEventByVoiceChannel(voiceChannelId) {
  return getDatabase().prepare('SELECT * FROM events WHERE voice_channel_id = ? AND status = ?').get(voiceChannelId, 'running');
}

function listActiveEvents() {
  return getDatabase().prepare("SELECT * FROM events WHERE status = 'running'").all();
}

function listApprovedEventsForCareer() {
  return getDatabase()
    .prepare(`
      SELECT e.*
      FROM events e
      WHERE e.status = 'approved'
      ORDER BY e.id ASC
    `)
    .all();
}

function listPendingWarningEvents() {
  return getDatabase()
    .prepare("SELECT * FROM events WHERE status = 'created' AND COALESCE(warning_sent, 0) = 0 AND scheduled_time IS NOT NULL")
    .all();
}

function listPendingReminderEvents() {
  return getDatabase()
    .prepare(`
      SELECT *
      FROM events
      WHERE status IN ('created', 'running')
        AND scheduled_time IS NOT NULL
        AND (
          COALESCE(reminder_10_sent, 0) = 0
          OR COALESCE(reminder_start_sent, 0) = 0
        )
    `)
    .all();
}

function listEventsWithTempRoles() {
  return getDatabase()
    .prepare('SELECT * FROM events WHERE warning_role_id IS NOT NULL')
    .all();
}

function updateEvent(id, patch) {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return getEvent(id);
  const setSql = entries.map(([key]) => `${key} = @${key}`).join(', ');
  getDatabase()
    .prepare(`UPDATE events SET ${setSql}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`)
    .run({ id, ...Object.fromEntries(entries) });
  return getEvent(id);
}

function upsertParticipant({ eventId, discordId, role, isSpectator = 0 }) {
  return getDatabase()
    .prepare(`
      INSERT INTO event_participants (event_id, discord_id, role, is_spectator)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(event_id, discord_id) DO UPDATE SET role = excluded.role, is_spectator = excluded.is_spectator
    `)
    .run(eventId, discordId, role, isSpectator ? 1 : 0);
}

function removeParticipant({ eventId, discordId }) {
  return getDatabase().prepare('DELETE FROM event_participants WHERE event_id = ? AND discord_id = ?').run(eventId, discordId);
}

function listParticipants(eventId) {
  return getDatabase().prepare('SELECT * FROM event_participants WHERE event_id = ? ORDER BY is_spectator, role, joined_at').all(eventId);
}

function getParticipant({ eventId, discordId }) {
  return getDatabase().prepare('SELECT * FROM event_participants WHERE event_id = ? AND discord_id = ?').get(eventId, discordId);
}

function startVoiceSession({ eventId, discordId, joinedAt }) {
  const open = getOpenVoiceSession({ eventId, discordId });
  if (open) return { changes: 0, lastInsertRowid: open.id };
  return getDatabase()
    .prepare('INSERT INTO event_voice_sessions (event_id, discord_id, joined_at) VALUES (?, ?, ?)')
    .run(eventId, discordId, joinedAt);
}

function closeOpenVoiceSession({ eventId, discordId, leftAt, seconds }) {
  return getDatabase()
    .prepare(`
      UPDATE event_voice_sessions
      SET left_at = ?, seconds = ?
      WHERE event_id = ? AND discord_id = ? AND left_at IS NULL
    `)
    .run(leftAt, seconds, eventId, discordId);
}

function getOpenVoiceSession({ eventId, discordId }) {
  return getDatabase()
    .prepare('SELECT * FROM event_voice_sessions WHERE event_id = ? AND discord_id = ? AND left_at IS NULL ORDER BY id DESC LIMIT 1')
    .get(eventId, discordId);
}

function refreshParticipantSeconds(eventId) {
  const db = getDatabase();
  const event = getEvent(eventId);
  if (!event?.started_at) return;

  const eventStart = Date.parse(event.started_at);
  const eventEnd = Date.parse(event.ended_at || new Date().toISOString());
  const participants = listParticipants(eventId).filter((participant) => !participant.is_spectator);
  const sessions = db
    .prepare('SELECT * FROM event_voice_sessions WHERE event_id = ? ORDER BY discord_id, joined_at')
    .all(eventId);

  for (const participant of participants) {
    const intervals = sessions
      .filter((session) => session.discord_id === participant.discord_id)
      .map((session) => {
        const start = Math.max(eventStart, Date.parse(session.joined_at));
        const end = Math.min(eventEnd, Date.parse(session.left_at || new Date().toISOString()));
        return { start, end };
      })
      .filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start)
      .sort((a, b) => a.start - b.start);

    let total = 0;
    let current = null;
    for (const interval of intervals) {
      if (!current) {
        current = { ...interval };
      } else if (interval.start <= current.end) {
        current.end = Math.max(current.end, interval.end);
      } else {
        total += current.end - current.start;
        current = { ...interval };
      }
    }
    if (current) total += current.end - current.start;

    db.prepare('UPDATE event_participants SET calculated_seconds = ? WHERE event_id = ? AND discord_id = ?')
      .run(Math.floor(total / 1000), eventId, participant.discord_id);
  }
}

function setParticipantReview({ eventId, discordId, role, manualSeconds }) {
  return getDatabase()
    .prepare('UPDATE event_participants SET role = ?, manual_seconds = ? WHERE event_id = ? AND discord_id = ?')
    .run(role, manualSeconds, eventId, discordId);
}

function setParticipantPayout({ eventId, discordId, payoutAmount }) {
  return getDatabase()
    .prepare('UPDATE event_participants SET payout_amount = ? WHERE event_id = ? AND discord_id = ?')
    .run(payoutAmount, eventId, discordId);
}

function clearParticipantPayouts(eventId) {
  return getDatabase()
    .prepare('UPDATE event_participants SET payout_amount = 0 WHERE event_id = ?')
    .run(eventId);
}

function upsertReview(data) {
  return getDatabase()
    .prepare(`
      INSERT INTO event_reviews (event_id, loot_total, repair, silver_bags, tax_percent, net_loot, status)
      VALUES (@eventId, @lootTotal, @repair, @silverBags, @taxPercent, @netLoot, @status)
      ON CONFLICT(event_id) DO UPDATE SET
        loot_total = excluded.loot_total,
        repair = excluded.repair,
        silver_bags = excluded.silver_bags,
        tax_percent = excluded.tax_percent,
        net_loot = excluded.net_loot,
        status = excluded.status
    `)
    .run(data);
}

function getReview(eventId) {
  return getDatabase().prepare('SELECT * FROM event_reviews WHERE event_id = ?').get(eventId);
}

function updateReviewMetadata(eventId, patch) {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return getReview(eventId);
  const setSql = entries.map(([key]) => `${key} = @${key}`).join(', ');
  getDatabase()
    .prepare(`UPDATE event_reviews SET ${setSql} WHERE event_id = @eventId`)
    .run({ eventId, ...Object.fromEntries(entries) });
  return getReview(eventId);
}

function createRaidAvalonEventMeta({ eventId, dungeonTier, buildTier }) {
  return getDatabase()
    .prepare(`
      INSERT INTO raid_avalon_events (event_id, dungeon_tier, build_tier)
      VALUES (?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        dungeon_tier = excluded.dungeon_tier,
        build_tier = excluded.build_tier,
        updated_at = CURRENT_TIMESTAMP
    `)
    .run(eventId, dungeonTier, buildTier);
}

function getRaidAvalonEventMeta(eventId) {
  return getDatabase().prepare('SELECT * FROM raid_avalon_events WHERE event_id = ?').get(eventId);
}

function upsertRaidAvalonParticipant({ eventId, discordId, weaponKey = null, weaponName = null, itemPower = null, helperRole = null }) {
  return getDatabase()
    .prepare(`
      INSERT INTO raid_avalon_event_participants
        (event_id, discord_id, weapon_key, weapon_name, item_power, helper_role)
      VALUES
        (@eventId, @discordId, @weaponKey, @weaponName, @itemPower, @helperRole)
      ON CONFLICT(event_id, discord_id) DO UPDATE SET
        weapon_key = excluded.weapon_key,
        weapon_name = excluded.weapon_name,
        item_power = excluded.item_power,
        helper_role = excluded.helper_role,
        updated_at = CURRENT_TIMESTAMP
    `)
    .run({ eventId, discordId, weaponKey, weaponName, itemPower, helperRole });
}

function getRaidAvalonParticipant({ eventId, discordId }) {
  return getDatabase()
    .prepare('SELECT * FROM raid_avalon_event_participants WHERE event_id = ? AND discord_id = ?')
    .get(eventId, discordId);
}

function listRaidAvalonParticipants(eventId) {
  return getDatabase()
    .prepare('SELECT * FROM raid_avalon_event_participants WHERE event_id = ? ORDER BY helper_role, weapon_name, discord_id')
    .all(eventId);
}

function getRaidAvalonCareer({ discordId, weaponKey }) {
  return getDatabase()
    .prepare('SELECT * FROM raid_avalon_weapon_career WHERE discord_id = ? AND weapon_key = ?')
    .get(discordId, weaponKey);
}

function upsertRaidAvalonCareer({ discordId, weaponKey, weaponName, roleId, addPoint = false, pointsToAdd = null }) {
  const points = pointsToAdd ?? (addPoint ? 1 : 0);
  return getDatabase()
    .prepare(`
      INSERT INTO raid_avalon_weapon_career
        (discord_id, weapon_key, weapon_name, points, role_id, first_tag_at, last_point_at)
      VALUES
        (@discordId, @weaponKey, @weaponName, @points, @roleId, CURRENT_TIMESTAMP, @lastPointAt)
      ON CONFLICT(discord_id, weapon_key) DO UPDATE SET
        weapon_name = excluded.weapon_name,
        points = raid_avalon_weapon_career.points + @points,
        role_id = COALESCE(excluded.role_id, raid_avalon_weapon_career.role_id),
        last_point_at = COALESCE(excluded.last_point_at, raid_avalon_weapon_career.last_point_at),
        updated_at = CURRENT_TIMESTAMP
    `)
    .run({
      discordId,
      weaponKey,
      weaponName,
      roleId,
      points,
      lastPointAt: points > 0 ? new Date().toISOString() : null
    });
}

const addCareerPointTransaction = transaction((data) => {
  const points = Number(data.points || 0);
  if (points <= 0) return { inserted: false, points: 0 };

  const result = getDatabase()
    .prepare(`
      INSERT OR IGNORE INTO career_point_transactions
        (event_id, discord_id, point_type, role, weapon_key, weapon_name, seconds, points, source, created_by)
      VALUES
        (@eventId, @discordId, @pointType, @role, @weaponKey, @weaponName, @seconds, @points, @source, @createdBy)
    `)
    .run({
      eventId: data.eventId,
      discordId: data.discordId,
      pointType: data.pointType,
      role: data.role || null,
      weaponKey: data.weaponKey,
      weaponName: data.weaponName,
      seconds: data.seconds || 0,
      points,
      source: data.source || 'event_approval',
      createdBy: data.createdBy || null
    });

  if (result.changes === 0) return { inserted: false, points: 0 };

  upsertRaidAvalonCareer({
    discordId: data.discordId,
    weaponKey: data.weaponKey,
    weaponName: data.weaponName,
    roleId: data.roleId || null,
    pointsToAdd: points
  });

  return { inserted: true, points };
});

const clearCareerPointData = transaction(() => {
  getDatabase().prepare('DELETE FROM career_point_transactions').run();
  getDatabase().prepare('DELETE FROM raid_avalon_weapon_career').run();
});

const replaceCareerPointData = transaction((entries) => {
  getDatabase().prepare('DELETE FROM career_point_transactions').run();
  getDatabase().prepare('DELETE FROM raid_avalon_weapon_career').run();
  let inserted = 0;
  let points = 0;
  for (const entry of entries) {
    const result = addCareerPointTransaction(entry);
    if (result.inserted) inserted += 1;
    points += result.points;
  }
  return { inserted, points };
});

function countCareerPointTransactions() {
  return Number(getDatabase().prepare('SELECT COUNT(*) AS total FROM career_point_transactions').get()?.total || 0);
}

function listRaidAvalonCareer(limit = 30) {
  return getDatabase()
    .prepare(`
      SELECT *
      FROM raid_avalon_weapon_career
      WHERE points > 0
      ORDER BY points DESC, updated_at DESC
      LIMIT ?
    `)
    .all(limit);
}

function listRaidAvalonCareerByWeapon(limit = 20) {
  return getDatabase()
    .prepare(`
      SELECT
        weapon_key,
        weapon_name,
        COUNT(*) AS members,
        SUM(points) AS points
      FROM raid_avalon_weapon_career
      WHERE points > 0
        AND weapon_key NOT LIKE 'classe_%'
      GROUP BY weapon_key, weapon_name
      ORDER BY points DESC, members DESC, weapon_name COLLATE NOCASE
      LIMIT ?
    `)
    .all(limit);
}

function getPersistentMessage(key) {
  return getDatabase().prepare('SELECT * FROM persistent_bot_messages WHERE message_key = ?').get(key);
}

function setPersistentMessage({ key, channelId, messageId }) {
  return getDatabase()
    .prepare(`
      INSERT INTO persistent_bot_messages (message_key, channel_id, message_id, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(message_key) DO UPDATE SET
        channel_id = excluded.channel_id,
        message_id = excluded.message_id,
        updated_at = CURRENT_TIMESTAMP
    `)
    .run(key, channelId, messageId);
}

function markReviewApproved({ eventId, approvedBy }) {
  return getDatabase()
    .prepare("UPDATE event_reviews SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE event_id = ?")
    .run(approvedBy, eventId);
}

function listExpiredReviewChannels(nowIso) {
  return getDatabase()
    .prepare(`
      SELECT er.*, e.event_code, e.title
      FROM event_reviews er
      JOIN events e ON e.id = er.event_id
      WHERE er.review_channel_id IS NOT NULL
        AND er.review_channel_delete_after IS NOT NULL
        AND er.review_channel_delete_after <= ?
    `)
    .all(nowIso);
}

module.exports = {
  closeOpenVoiceSession,
  addCareerPointTransaction,
  clearCareerPointData,
  countCareerPointTransactions,
  createEvent,
  createRaidAvalonEventMeta,
  clearParticipantPayouts,
  getEvent,
  getEventByCode,
  getEventByVoiceChannel,
  getOpenVoiceSession,
  getParticipant,
  getPersistentMessage,
  getRaidAvalonCareer,
  getRaidAvalonEventMeta,
  getRaidAvalonParticipant,
  getReview,
  listActiveEvents,
  listApprovedEventsForCareer,
  listEventsWithTempRoles,
  listExpiredReviewChannels,
  listPendingWarningEvents,
  listPendingReminderEvents,
  listParticipants,
  listRaidAvalonCareer,
  listRaidAvalonCareerByWeapon,
  listRaidAvalonParticipants,
  markReviewApproved,
  refreshParticipantSeconds,
  removeParticipant,
  replaceCareerPointData,
  setParticipantPayout,
  setPersistentMessage,
  setParticipantReview,
  startVoiceSession,
  updateEvent,
  upsertRaidAvalonCareer,
  upsertRaidAvalonParticipant,
  upsertParticipant,
  upsertReview,
  updateReviewMetadata
};
