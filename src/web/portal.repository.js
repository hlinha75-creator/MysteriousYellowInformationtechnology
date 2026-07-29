const { getDatabase } = require('../database/connection');
const accountLinks = require('../modules/accounts/accountLinks.service');
const financeRepo = require('../modules/finance/finance.repository');
const { fameDashboard } = require('./dashboard.repository');
const { MAX_PARTICIPANTS } = require('./portal-events.service');

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function getPortalData(discordId, accessLevel = 'guest') {
  const db = getDatabase();
  const link = accountLinks.linkInfo(discordId);
  const linkedIds = link.linkedIds.length ? link.linkedIds : [discordId];
  const idsSql = placeholders(linkedIds);
  const users = db.prepare(`
    SELECT discord_id, discord_name, albion_name, registration_status, updated_at
    FROM users
    WHERE discord_id IN (${idsSql})
    ORDER BY CASE WHEN discord_id = ? THEN 0 ELSE 1 END, updated_at DESC
  `).all(...linkedIds, link.primaryId);
  const primary = users.find((row) => row.discord_id === link.primaryId) || users[0] || null;
  const profile = {
    discordId,
    primaryDiscordId: link.primaryId || discordId,
    discordName: users.find((row) => row.discord_id === discordId)?.discord_name || primary?.discord_name || null,
    albionName: primary?.albion_name || users.find((row) => row.albion_name)?.albion_name || null,
    registrationStatus: accessLevel === 'member' ? 'member' : (primary?.registration_status || 'guest'),
    accessLevel,
    linkedAccounts: users.map((row) => ({
      discordId: row.discord_id,
      discordName: row.discord_name,
      primary: row.discord_id === link.primaryId
    }))
  };

  const registration = db.prepare(`
    SELECT id, discord_id, albion_name, status, review_note, created_at, reviewed_at
    FROM registrations
    WHERE discord_id IN (${idsSql})
    ORDER BY id DESC LIMIT 1
  `).get(...linkedIds) || null;

  const balance = financeRepo.getBalance(discordId);
  const transactions = db.prepare(`
    SELECT id, type, amount, before_balance, after_balance, reason, reference_type, reference_id, created_at
    FROM balance_transactions
    WHERE user_id = ?
    ORDER BY id DESC LIMIT 50
  `).all(link.primaryId);
  const withdraws = db.prepare(`
    SELECT id, amount, status, note, created_at, reviewed_at, paid_at
    FROM withdraw_requests
    WHERE user_id = ?
    ORDER BY id DESC LIMIT 20
  `).all(link.primaryId);
  const paymentRequests = db.prepare(`
    SELECT id, amount, service, description, status, created_at, reviewed_at
    FROM payment_requests
    WHERE user_id = ?
    ORDER BY id DESC LIMIT 20
  `).all(link.primaryId);

  const eventHistory = db.prepare(`
    SELECT e.id, e.event_code, e.title, e.location, e.scheduled_time, e.status,
           e.started_at, e.ended_at, ep.role, ep.is_spectator,
           COALESCE(ep.manual_seconds, ep.calculated_seconds, 0) AS seconds,
           ep.payout_amount
    FROM event_participants ep
    JOIN events e ON e.id = ep.event_id
    WHERE ep.discord_id IN (${idsSql})
    ORDER BY e.id DESC LIMIT 50
  `).all(...linkedIds);

  const eventRows = db.prepare(`
    SELECT e.id, e.event_code, e.title, e.description, e.location, e.scheduled_time, e.status,
           e.tank_slots, e.healer_slots, e.support_slots, e.dps_slots,
           SUM(CASE WHEN ep.is_spectator = 0 THEN 1 ELSE 0 END) AS participants,
           SUM(CASE WHEN ep.is_spectator = 1 THEN 1 ELSE 0 END) AS spectators
    FROM events e
    LEFT JOIN event_participants ep ON ep.event_id = e.id
    WHERE e.status IN ('created', 'running')
      AND (
        COALESCE(e.audience, 'public') = 'public'
        OR (? = 'member' AND COALESCE(e.audience, 'public') = 'member')
      )
    GROUP BY e.id
    ORDER BY CASE WHEN e.status = 'running' THEN 0 ELSE 1 END, e.id DESC
    LIMIT 50
  `).all(accessLevel);

  const openEventIds = eventRows.map((event) => event.id);
  const openParticipants = openEventIds.length ? db.prepare(`
    SELECT ep.event_id, ep.discord_id, ep.role, ep.is_spectator, ep.joined_at,
           COALESCE(u.albion_name, u.discord_name, ep.discord_id) AS display_name
    FROM event_participants ep
    LEFT JOIN users u ON u.discord_id = ep.discord_id
    WHERE ep.event_id IN (${placeholders(openEventIds)})
    ORDER BY ep.event_id, ep.is_spectator, ep.joined_at
  `).all(...openEventIds) : [];
  const specialEventModes = new Map(openEventIds.length ? db.prepare(`
    SELECT event_id, 'world_boss' AS mode FROM world_boss_events WHERE event_id IN (${placeholders(openEventIds)})
    UNION ALL
    SELECT event_id, 'raid_avalon' AS mode FROM raid_avalon_events WHERE event_id IN (${placeholders(openEventIds)})
    UNION ALL
    SELECT event_id, 'custom' AS mode FROM custom_events WHERE event_id IN (${placeholders(openEventIds)})
  `).all(...openEventIds, ...openEventIds, ...openEventIds).map((row) => [row.event_id, row.mode]) : []);
  const roleKeys = ['tank', 'healer', 'support', 'dps'];
  const events = eventRows.map((event) => {
    const eventParticipants = openParticipants.filter((participant) => participant.event_id === event.id);
    const activeParticipants = eventParticipants.filter((participant) => !participant.is_spectator);
    const spectators = eventParticipants.filter((participant) => participant.is_spectator);
    const ownParticipation = eventParticipants.find((participant) => linkedIds.includes(participant.discord_id)) || null;
    const roles = Object.fromEntries(roleKeys.map((role) => {
      const slots = Math.max(0, Number(event[`${role}_slots`] || 0));
      const used = activeParticipants.filter((participant) => participant.role === role).length;
      return [role, { slots, used, available: Math.max(0, slots - used) }];
    }));
    const configuredCapacity = roleKeys.reduce((total, role) => total + roles[role].slots, 0);
    return {
      ...event,
      capacity: Math.min(MAX_PARTICIPANTS, configuredCapacity || MAX_PARTICIPANTS),
      signupMode: specialEventModes.get(event.id) || 'standard',
      roles,
      ownParticipation,
      participantList: activeParticipants,
      spectatorList: spectators
    };
  });

  const fame = fameDashboard();
  const ownFame = profile.albionName
    ? fame.rows.find((row) => row.albion_name.localeCompare(profile.albionName, undefined, { sensitivity: 'accent' }) === 0) || null
    : null;
  const rankings = accessLevel === 'member'
    ? { imports: fame.imports, rows: fame.rows.slice(0, 250), own: ownFame }
    : { imports: [], rows: [], own: null };

  return {
    generatedAt: new Date().toISOString(),
    profile,
    registration,
    overview: {
      balance,
      events: eventHistory.filter((row) => !row.is_spectator).length,
      activeSeconds: eventHistory.reduce((total, row) => total + Number(row.seconds || 0), 0),
      lootReceived: eventHistory.reduce((total, row) => total + Number(row.payout_amount || 0), 0),
      pendingWithdraws: withdraws.filter((row) => ['requested', 'approved'].includes(row.status)).length,
      pendingPayments: paymentRequests.filter((row) => row.status === 'requested').length
    },
    events,
    eventHistory,
    finance: { balance, transactions, withdraws, paymentRequests },
    rankings
  };
}

module.exports = { getPortalData };
