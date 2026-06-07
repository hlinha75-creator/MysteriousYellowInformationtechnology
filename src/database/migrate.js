const { getDatabase, transaction } = require('./connection');
const { backupDatabase } = require('./backup');

const migrations = [
  {
    version: 1,
    name: 'initial_schema',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS users (
          discord_id TEXT PRIMARY KEY,
          discord_name TEXT,
          albion_name TEXT UNIQUE,
          registration_status TEXT NOT NULL DEFAULT 'unregistered',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS registrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          discord_id TEXT NOT NULL,
          albion_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          reviewed_by TEXT,
          review_note TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          reviewed_at TEXT,
          FOREIGN KEY (discord_id) REFERENCES users(discord_id)
        );

        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_code TEXT UNIQUE NOT NULL,
          creator_id TEXT NOT NULL,
          takeover_by TEXT,
          title TEXT NOT NULL,
          description TEXT,
          location TEXT,
          scheduled_time TEXT,
          tank_slots INTEGER NOT NULL DEFAULT 0,
          healer_slots INTEGER NOT NULL DEFAULT 0,
          support_slots INTEGER NOT NULL DEFAULT 0,
          dps_slots INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'created',
          message_id TEXT,
          voice_channel_id TEXT,
          review_required INTEGER NOT NULL DEFAULT 0,
          cancel_reason TEXT,
          started_at TEXT,
          ended_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS event_participants (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER NOT NULL,
          discord_id TEXT NOT NULL,
          role TEXT NOT NULL,
          is_spectator INTEGER NOT NULL DEFAULT 0,
          manual_seconds INTEGER,
          calculated_seconds INTEGER NOT NULL DEFAULT 0,
          payout_amount INTEGER NOT NULL DEFAULT 0,
          joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(event_id, discord_id),
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS event_voice_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER NOT NULL,
          discord_id TEXT NOT NULL,
          joined_at TEXT NOT NULL,
          left_at TEXT,
          seconds INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS event_reviews (
          event_id INTEGER PRIMARY KEY,
          loot_total INTEGER NOT NULL DEFAULT 0,
          repair INTEGER NOT NULL DEFAULT 0,
          silver_bags INTEGER NOT NULL DEFAULT 0,
          tax_percent INTEGER NOT NULL DEFAULT 0,
          net_loot INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'draft',
          submitted_by TEXT,
          approved_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          submitted_at TEXT,
          approved_at TEXT,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS balances (
          discord_id TEXT PRIMARY KEY,
          balance INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS balance_transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          user_id TEXT NOT NULL,
          amount INTEGER NOT NULL,
          before_balance INTEGER NOT NULL,
          after_balance INTEGER NOT NULL,
          reason TEXT NOT NULL,
          reference_type TEXT,
          reference_id TEXT,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS withdraw_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          amount INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'requested',
          note TEXT,
          reviewed_by TEXT,
          paid_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          reviewed_at TEXT,
          paid_at TEXT
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          actor_id TEXT,
          target_id TEXT,
          before_value TEXT,
          after_value TEXT,
          reason TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS setup_messages (
          channel_id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL,
          panel_type TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS csv_imports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_by TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'preview',
          summary TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          applied_at TEXT
        );
      `);
    }
  },
  {
    version: 2,
    name: 'event_warning_role',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(events)').all().map((column) => column.name);
      if (!columns.includes('warning_role_id')) {
        db.exec('ALTER TABLE events ADD COLUMN warning_role_id TEXT');
      }
      if (!columns.includes('warning_sent')) {
        db.exec('ALTER TABLE events ADD COLUMN warning_sent INTEGER NOT NULL DEFAULT 0');
      }
    }
  },
  {
    version: 3,
    name: 'event_warning_message',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(events)').all().map((column) => column.name);
      if (!columns.includes('warning_message_id')) {
        db.exec('ALTER TABLE events ADD COLUMN warning_message_id TEXT');
      }
    }
  },
  {
    version: 4,
    name: 'polls',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS polls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          creator_id TEXT NOT NULL,
          question TEXT NOT NULL,
          options_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          channel_id TEXT,
          message_id TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          closed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS poll_votes (
          poll_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          options_json TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (poll_id, user_id),
          FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
        );
      `);
    }
  }
];

function getAppliedVersions(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  return new Set(db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version));
}

function migrate() {
  const db = getDatabase();
  const applied = getAppliedVersions(db);
  const pending = migrations.filter((migration) => !applied.has(migration.version));

  if (pending.length > 0) {
    backupDatabase('before_migration');
  }

  const runMigration = transaction((migration) => {
    migration.up(db);
    db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
  });

  for (const migration of pending) {
    runMigration(migration);
  }
}

module.exports = {
  migrate
};
