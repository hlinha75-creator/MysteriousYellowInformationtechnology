const { getDatabase } = require('../../database/connection');

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

function listPendingWarningEvents() {
  return getDatabase()
    .prepare("SELECT * FROM events WHERE status = 'created' AND COALESCE(warning_sent, 0) = 0 AND scheduled_time IS NOT NULL")
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
  createEvent,
  clearParticipantPayouts,
  getEvent,
  getEventByCode,
  getEventByVoiceChannel,
  getOpenVoiceSession,
  getParticipant,
  getReview,
  listActiveEvents,
  listExpiredReviewChannels,
  listPendingWarningEvents,
  listParticipants,
  markReviewApproved,
  refreshParticipantSeconds,
  removeParticipant,
  setParticipantPayout,
  setParticipantReview,
  startVoiceSession,
  updateEvent,
  upsertParticipant,
  upsertReview,
  updateReviewMetadata
};
