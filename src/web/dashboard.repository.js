const { getDatabase } = require('../database/connection');

function scalar(sql, params = []) {
  const row = getDatabase().prepare(sql).get(...params);
  return Number(row?.value || 0);
}

function tableExists(name) {
  return Boolean(getDatabase().prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function latestPveRanking(limit = 10) {
  const db = getDatabase();
  const dates = db.prepare(`
    SELECT DISTINCT snapshot_date
    FROM albion_fame_daily_snapshots
    ORDER BY snapshot_date DESC
    LIMIT 8
  `).all().map((row) => row.snapshot_date).sort();

  if (dates.length >= 2) {
    const start = dates[0];
    const end = dates.at(-1);
    const rows = db.prepare(`
      WITH first_day AS (
        SELECT albion_key, pve_fame FROM albion_fame_daily_snapshots WHERE snapshot_date = ?
      ), last_day AS (
        SELECT albion_key, albion_name, pve_fame FROM albion_fame_daily_snapshots WHERE snapshot_date = ?
      )
      SELECT l.albion_name, MAX(0, l.pve_fame - f.pve_fame) AS amount
      FROM last_day l
      JOIN first_day f ON f.albion_key = l.albion_key
      ORDER BY amount DESC, l.albion_name COLLATE NOCASE
      LIMIT ?
    `).all(start, end, limit);
    return { label: `${start} a ${end}`, source: 'albion_fame_daily_snapshots', rows };
  }

  const latest = db.prepare(`
    SELECT import_id, week_key, created_at
    FROM albion_pve_rankings
    ORDER BY created_at DESC, import_id DESC
    LIMIT 1
  `).get();
  if (!latest) return { label: 'Sem importação', source: 'albion_pve_rankings', rows: [] };
  const rows = db.prepare(`
    SELECT albion_name, amount
    FROM albion_pve_rankings
    WHERE import_id = ?
    ORDER BY rank ASC
    LIMIT ?
  `).all(latest.import_id, limit);
  return { label: latest.week_key, source: 'albion_pve_rankings', rows };
}

function participationRanking(limit = 10) {
  const rows = getDatabase().prepare(`
    SELECT
      COALESCE(u.albion_name, u.discord_name, ep.discord_id) AS albion_name,
      COUNT(DISTINCT ep.event_id) AS events,
      COALESCE(SUM(COALESCE(ep.manual_seconds, ep.calculated_seconds, 0)), 0) AS seconds
    FROM event_participants ep
    JOIN events e ON e.id = ep.event_id
    LEFT JOIN users u ON u.discord_id = ep.discord_id
    WHERE datetime(COALESCE(e.ended_at, e.started_at, e.created_at)) >= datetime('now', '-7 days')
      AND e.status <> 'cancelled'
      AND ep.is_spectator = 0
    GROUP BY ep.discord_id
    ORDER BY events DESC, seconds DESC, albion_name COLLATE NOCASE
    LIMIT ?
  `).all(limit);
  return { label: 'Últimos 7 dias', source: 'event_participants', rows };
}

function activeCampaign() {
  const campaign = getDatabase().prepare(`
    SELECT
      c.id, c.code, c.title, c.goal_amount, c.status, c.updated_at,
      COALESCE(SUM(CASE WHEN cc.status = 'approved' THEN cc.amount ELSE 0 END), 0) AS raised,
      COUNT(DISTINCT CASE WHEN cc.status = 'approved' THEN cc.user_id END) AS contributors
    FROM campaigns c
    LEFT JOIN campaign_contributions cc ON cc.campaign_id = c.id
    WHERE c.status = 'open'
    GROUP BY c.id
    ORDER BY c.id ASC
    LIMIT 1
  `).get();
  return campaign || null;
}

function recentDeposits(limit = 12) {
  return getDatabase().prepare(`
    SELECT
      bt.id, bt.type, bt.amount, bt.reason, bt.created_at,
      COALESCE(u.albion_name, u.discord_name, bt.user_id) AS albion_name
    FROM balance_transactions bt
    LEFT JOIN users u ON u.discord_id = bt.user_id
    WHERE bt.amount > 0 AND lower(bt.type) LIKE '%deposit%'
    ORDER BY bt.id DESC
    LIMIT ?
  `).all(limit);
}

function depositSummary() {
  const row = getDatabase().prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
    FROM balance_transactions
    WHERE amount > 0
      AND lower(type) LIKE '%deposit%'
      AND datetime(created_at) >= datetime('now', '-7 days')
  `).get();
  return { count: Number(row?.count || 0), amount: Number(row?.amount || 0) };
}

function listMembers(limit = 100) {
  return getDatabase().prepare(`
    SELECT
      u.discord_id, u.albion_name, u.discord_name, u.registration_status, u.updated_at,
      COALESCE(b.balance, 0) AS balance,
      COUNT(DISTINCT ep.event_id) AS events_total
    FROM users u
    LEFT JOIN balances b ON b.discord_id = u.discord_id
    LEFT JOIN event_participants ep ON ep.discord_id = u.discord_id
    WHERE NOT EXISTS (
      SELECT 1 FROM linked_discord_accounts l
      WHERE l.linked_discord_id = u.discord_id AND l.primary_discord_id <> l.linked_discord_id
    )
    GROUP BY u.discord_id
    ORDER BY CASE WHEN u.registration_status = 'member' THEN 0 ELSE 1 END,
             COALESCE(u.albion_name, u.discord_name, u.discord_id) COLLATE NOCASE
    LIMIT ?
  `).all(limit);
}

function listEvents(limit = 50) {
  return getDatabase().prepare(`
    SELECT
      e.id, e.event_code, e.title, e.location, e.scheduled_time, e.status,
      e.created_at, e.started_at, e.ended_at, e.review_required,
      COUNT(ep.id) AS participants,
      COALESCE(er.net_loot, 0) AS net_loot,
      er.status AS review_status
    FROM events e
    LEFT JOIN event_participants ep ON ep.event_id = e.id
    LEFT JOIN event_reviews er ON er.event_id = e.id
    GROUP BY e.id
    ORDER BY e.id DESC
    LIMIT ?
  `).all(limit);
}

function listTransactions(limit = 50) {
  return getDatabase().prepare(`
    SELECT
      bt.id, bt.type, bt.amount, bt.before_balance, bt.after_balance, bt.reason, bt.created_at,
      COALESCE(u.albion_name, u.discord_name, bt.user_id) AS albion_name
    FROM balance_transactions bt
    LEFT JOIN users u ON u.discord_id = bt.user_id
    ORDER BY bt.id DESC
    LIMIT ?
  `).all(limit);
}

function listAudit(limit = 50) {
  return getDatabase().prepare(`
    SELECT id, type, actor_id, target_id, reason, created_at
    FROM audit_logs
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
}

function activityByDay() {
  return getDatabase().prepare(`
    WITH RECURSIVE days(day) AS (
      SELECT date('now', '-6 days')
      UNION ALL SELECT date(day, '+1 day') FROM days WHERE day < date('now')
    )
    SELECT days.day, COUNT(DISTINCT e.id) AS events, COUNT(ep.id) AS participations
    FROM days
    LEFT JOIN events e ON date(COALESCE(e.ended_at, e.started_at, e.created_at)) = days.day AND e.status <> 'cancelled'
    LEFT JOIN event_participants ep ON ep.event_id = e.id AND ep.is_spectator = 0
    GROUP BY days.day
    ORDER BY days.day
  `).all();
}

function freshness() {
  const candidates = [
    ['balance_transactions', 'created_at'],
    ['events', 'updated_at'],
    ['users', 'updated_at'],
    ['albion_fame_daily_snapshots', 'captured_at'],
    ['albion_pve_rankings', 'created_at']
  ].filter(([table]) => tableExists(table));
  const values = candidates.map(([table, column]) => (
    getDatabase().prepare(`SELECT MAX(${column}) AS value FROM ${table}`).get()?.value
  )).filter(Boolean).sort();
  return values.at(-1) || null;
}

function getDashboardData() {
  const campaign = activeCampaign();
  return {
    generatedAt: new Date().toISOString(),
    freshness: freshness(),
    overview: {
      activeMembers: scalar("SELECT COUNT(*) AS value FROM users WHERE registration_status = 'member'"),
      totalMemberBalance: scalar(`
        SELECT COALESCE(SUM(b.balance), 0) AS value
        FROM balances b
        WHERE NOT EXISTS (
          SELECT 1 FROM linked_discord_accounts l
          WHERE l.linked_discord_id = b.discord_id AND l.primary_discord_id <> l.linked_discord_id
        )
      `),
      campaign,
      deposits7d: depositSummary(),
      recentDeposits: recentDeposits(),
      activity: activityByDay()
    },
    rankings: {
      pve: latestPveRanking(),
      participation: participationRanking()
    },
    members: listMembers(),
    events: listEvents(),
    finance: {
      transactions: listTransactions(),
      campaign
    },
    operations: {
      activeEvents: scalar("SELECT COUNT(*) AS value FROM events WHERE status IN ('created', 'running', 'review', 'pending_payment')"),
      reviewsPending: scalar("SELECT COUNT(*) AS value FROM event_reviews WHERE status IN ('draft', 'submitted')"),
      registrationsPending: scalar("SELECT COUNT(*) AS value FROM registrations WHERE status = 'pending'"),
      paymentRequestsPending: tableExists('payment_requests')
        ? scalar("SELECT COUNT(*) AS value FROM payment_requests WHERE status = 'requested'") : 0
    },
    audit: listAudit()
  };
}

module.exports = { getDashboardData, latestPveRanking, participationRanking };
