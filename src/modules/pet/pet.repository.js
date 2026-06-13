const { getDatabase } = require('../../database/connection');

function tryMarkEventRewarded(eventId) {
  return getDatabase()
    .prepare('INSERT OR IGNORE INTO pet_event_rewards (event_id) VALUES (?)')
    .run(eventId).changes === 1;
}

function getMember(discordId) {
  return getDatabase().prepare('SELECT * FROM pet_members WHERE discord_id = ?').get(discordId);
}

function upsertMember({ discordId, baseDisplayName, fruitCount, points }) {
  const existing = getMember(discordId);
  const currentPoints = (existing?.current_points || 0) + points;
  const gainedStars = Math.floor(currentPoints / 10);
  const remainingPoints = currentPoints % 10;
  const starCount = (existing?.star_count || 0) + gainedStars;
  const totalFruits = (existing?.total_fruits || 0) + fruitCount;
  const totalPointsEarned = (existing?.total_points_earned || 0) + points;
  const firstFruitAt = existing?.first_fruit_at || new Date().toISOString();
  const finalBaseName = existing?.base_display_name || baseDisplayName || null;

  getDatabase()
    .prepare(`
      INSERT INTO pet_members
        (discord_id, base_display_name, total_fruits, total_points_earned, current_points, star_count, first_fruit_at, updated_at)
      VALUES
        (@discordId, @baseDisplayName, @totalFruits, @totalPointsEarned, @currentPoints, @starCount, @firstFruitAt, CURRENT_TIMESTAMP)
      ON CONFLICT(discord_id) DO UPDATE SET
        base_display_name = excluded.base_display_name,
        total_fruits = excluded.total_fruits,
        total_points_earned = excluded.total_points_earned,
        current_points = excluded.current_points,
        star_count = excluded.star_count,
        first_fruit_at = excluded.first_fruit_at,
        updated_at = CURRENT_TIMESTAMP
    `)
    .run({
      discordId,
      baseDisplayName: finalBaseName,
      totalFruits,
      totalPointsEarned,
      currentPoints: remainingPoints,
      starCount,
      firstFruitAt
    });

  return {
    before: existing || null,
    after: getMember(discordId),
    gainedStars
  };
}

function addFeedLog({ eventId, discordId, fruitType, points }) {
  return getDatabase()
    .prepare('INSERT INTO pet_feed_logs (event_id, discord_id, fruit_type, points) VALUES (?, ?, ?, ?)')
    .run(eventId, discordId, fruitType, points);
}

function getEventFeedLogs(eventId) {
  return getDatabase()
    .prepare('SELECT * FROM pet_feed_logs WHERE event_id = ? ORDER BY discord_id, id')
    .all(eventId);
}

function topMembers(limit = 20) {
  return getDatabase()
    .prepare(`
      SELECT *
      FROM pet_members
      WHERE total_fruits > 0
      ORDER BY star_count DESC, current_points DESC, total_points_earned DESC, total_fruits DESC
      LIMIT ?
    `)
    .all(limit);
}

function raffleCandidates() {
  return getDatabase()
    .prepare('SELECT * FROM pet_members WHERE total_fruits > 0 ORDER BY first_fruit_at, discord_id')
    .all();
}

function getDailyRaffle(dateKey) {
  return getDatabase().prepare('SELECT * FROM pet_daily_raffles WHERE raffle_date = ?').get(dateKey);
}

function createDailyRaffle({ dateKey, winnerId, chestNumber }) {
  getDatabase()
    .prepare('INSERT OR IGNORE INTO pet_daily_raffles (raffle_date, winner_id, chest_number) VALUES (?, ?, ?)')
    .run(dateKey, winnerId, chestNumber);
  return getDailyRaffle(dateKey);
}

module.exports = {
  addFeedLog,
  createDailyRaffle,
  getDailyRaffle,
  getEventFeedLogs,
  getMember,
  raffleCandidates,
  topMembers,
  tryMarkEventRewarded,
  upsertMember
};
