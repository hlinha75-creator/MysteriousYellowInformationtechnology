const { getDatabase, transaction } = require('./connection');
const { backupDatabase } = require('./backup');

const defaultAccountLinks = [
  {
    primaryDiscordId: '1276439186513203234',
    linkedDiscordId: '1276439186513203234',
    label: 'Tmaiusculo'
  },
  {
    primaryDiscordId: '1276439186513203234',
    linkedDiscordId: '1436716667894759475',
    label: 'Tmaiusculo'
  }
];

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
  },
  {
    version: 5,
    name: 'auctions',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS auctions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_name TEXT NOT NULL,
          item_details TEXT,
          image_url TEXT,
          pickup_info TEXT,
          starting_bid INTEGER NOT NULL DEFAULT 0,
          min_increment INTEGER NOT NULL DEFAULT 0,
          current_bid INTEGER NOT NULL DEFAULT 0,
          current_winner_id TEXT,
          ends_at TEXT,
          status TEXT NOT NULL DEFAULT 'open',
          channel_id TEXT,
          message_id TEXT,
          created_by TEXT NOT NULL,
          closed_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          closed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS auction_bids (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          auction_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          amount INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE
        );
      `);
    }
  },
  {
    version: 6,
    name: 'auction_pickup_info',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(auctions)').all().map((column) => column.name);
      if (!columns.includes('pickup_info')) {
        db.exec('ALTER TABLE auctions ADD COLUMN pickup_info TEXT');
      }
    }
  },
  {
    version: 7,
    name: 'auction_ends_at',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(auctions)').all().map((column) => column.name);
      if (!columns.includes('ends_at')) {
        db.exec('ALTER TABLE auctions ADD COLUMN ends_at TEXT');
      }
      db.exec("UPDATE auctions SET ends_at = datetime(created_at, '+24 hours') WHERE ends_at IS NULL");
    }
  },
  {
    version: 8,
    name: 'voice_sessions',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS voice_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          discord_id TEXT NOT NULL,
          discord_name TEXT,
          channel_id TEXT NOT NULL,
          channel_name TEXT,
          category_id TEXT,
          category_name TEXT,
          joined_at TEXT NOT NULL,
          left_at TEXT,
          seconds INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_voice_sessions_discord_id_joined_at
          ON voice_sessions (discord_id, joined_at);

        CREATE INDEX IF NOT EXISTS idx_voice_sessions_channel_id_joined_at
          ON voice_sessions (channel_id, joined_at);
      `);
    }
  },
  {
    version: 9,
    name: 'event_review_channels',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(event_reviews)').all().map((column) => column.name);
      if (!columns.includes('evidence_notes')) {
        db.exec('ALTER TABLE event_reviews ADD COLUMN evidence_notes TEXT');
      }
      if (!columns.includes('review_channel_id')) {
        db.exec('ALTER TABLE event_reviews ADD COLUMN review_channel_id TEXT');
      }
      if (!columns.includes('dps_message_id')) {
        db.exec('ALTER TABLE event_reviews ADD COLUMN dps_message_id TEXT');
      }
      if (!columns.includes('review_channel_delete_after')) {
        db.exec('ALTER TABLE event_reviews ADD COLUMN review_channel_delete_after TEXT');
      }
    }
  },
  {
    version: 10,
    name: 'guild_verification_csv',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS guild_verifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          created_by TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'reported',
          source_names_json TEXT NOT NULL,
          matches_json TEXT NOT NULL,
          missing_json TEXT NOT NULL,
          issues_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          applied_at TEXT
        );

        CREATE TABLE IF NOT EXISTS guild_verification_pending_replies (
          discord_id TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          verification_id INTEGER NOT NULL,
          source_names_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          answered_at TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          FOREIGN KEY (verification_id) REFERENCES guild_verifications(id)
        );
      `);
    }
  },
  {
    version: 11,
    name: 'notag_pet_fruits',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pet_members (
          discord_id TEXT PRIMARY KEY,
          base_display_name TEXT,
          total_fruits INTEGER NOT NULL DEFAULT 0,
          total_points_earned INTEGER NOT NULL DEFAULT 0,
          current_points INTEGER NOT NULL DEFAULT 0,
          star_count INTEGER NOT NULL DEFAULT 0,
          first_fruit_at TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS pet_feed_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER,
          discord_id TEXT NOT NULL,
          fruit_type TEXT NOT NULL,
          points INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS pet_event_rewards (
          event_id INTEGER PRIMARY KEY,
          rewarded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS pet_daily_raffles (
          raffle_date TEXT PRIMARY KEY,
          winner_id TEXT,
          chest_number INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  },
  {
    version: 12,
    name: 'raid_avalon_registrations',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS raid_avalon_registrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nick TEXT NOT NULL UNIQUE,
          horarios_json TEXT NOT NULL,
          armas_json TEXT NOT NULL,
          builds_json TEXT NOT NULL,
          casa_ho_loch INTEGER NOT NULL DEFAULT 0,
          portal_martlock INTEGER NOT NULL DEFAULT 0,
          warnings_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS raid_avalon_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  },
  {
    version: 13,
    name: 'server_usage_analytics',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS server_usage_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          event_name TEXT NOT NULL,
          detail TEXT,
          user_id TEXT,
          channel_id TEXT,
          channel_name TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_server_usage_events_created_at
          ON server_usage_events (created_at);

        CREATE INDEX IF NOT EXISTS idx_server_usage_events_type_name
          ON server_usage_events (event_type, event_name);
      `);
    }
  },
  {
    version: 14,
    name: 'member_snapshots',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS member_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_by TEXT NOT NULL,
          source_name TEXT,
          member_count INTEGER NOT NULL DEFAULT 0,
          online_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS member_snapshot_rows (
          snapshot_id INTEGER NOT NULL,
          member_key TEXT NOT NULL,
          character_name TEXT NOT NULL,
          last_seen TEXT,
          roles_json TEXT NOT NULL DEFAULT '[]',
          is_online INTEGER NOT NULL DEFAULT 0,
          last_seen_iso TEXT,
          PRIMARY KEY (snapshot_id, member_key),
          FOREIGN KEY (snapshot_id) REFERENCES member_snapshots(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_member_snapshots_created_at
          ON member_snapshots (created_at);
      `);
    }
  },
  {
    version: 15,
    name: 'event_templates',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS event_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          creator_id TEXT NOT NULL,
          name TEXT NOT NULL,
          title TEXT NOT NULL,
          location TEXT,
          requirements TEXT,
          composition TEXT,
          tank_slots INTEGER NOT NULL DEFAULT 0,
          healer_slots INTEGER NOT NULL DEFAULT 0,
          support_slots INTEGER NOT NULL DEFAULT 0,
          dps_slots INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(creator_id, name)
        );
      `);
    }
  },
  {
    version: 16,
    name: 'balance_csv_backups',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS balance_csv_backups (
          backup_key TEXT PRIMARY KEY,
          trigger_type TEXT NOT NULL,
          reference_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          message_id TEXT,
          channel_id TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          sent_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_balance_csv_backups_sent_at
          ON balance_csv_backups (sent_at);
      `);
    }
  },
  {
    version: 17,
    name: 'raid_avalon_full_events',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS raid_avalon_events (
          event_id INTEGER PRIMARY KEY,
          dungeon_tier TEXT,
          build_tier TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS raid_avalon_event_participants (
          event_id INTEGER NOT NULL,
          discord_id TEXT NOT NULL,
          weapon_key TEXT,
          weapon_name TEXT,
          item_power INTEGER,
          helper_role TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (event_id, discord_id),
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS raid_avalon_weapon_career (
          discord_id TEXT NOT NULL,
          weapon_key TEXT NOT NULL,
          weapon_name TEXT NOT NULL,
          points INTEGER NOT NULL DEFAULT 0,
          role_id TEXT,
          first_tag_at TEXT,
          last_point_at TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (discord_id, weapon_key)
        );
      `);
    }
  },
  {
    version: 18,
    name: 'daily_black_poll_and_event_reminders',
    up(db) {
      const pollColumns = db.prepare('PRAGMA table_info(polls)').all().map((column) => column.name);
      if (!pollColumns.includes('poll_key')) {
        db.exec('ALTER TABLE polls ADD COLUMN poll_key TEXT');
      }
      if (!pollColumns.includes('staff_alerted_at')) {
        db.exec('ALTER TABLE polls ADD COLUMN staff_alerted_at TEXT');
      }
      if (!pollColumns.includes('auto_event_id')) {
        db.exec('ALTER TABLE polls ADD COLUMN auto_event_id INTEGER');
      }
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_polls_poll_key ON polls (poll_key)');

      const eventColumns = db.prepare('PRAGMA table_info(events)').all().map((column) => column.name);
      if (!eventColumns.includes('reminder_10_sent')) {
        db.exec('ALTER TABLE events ADD COLUMN reminder_10_sent INTEGER NOT NULL DEFAULT 0');
      }
      if (!eventColumns.includes('reminder_start_sent')) {
        db.exec('ALTER TABLE events ADD COLUMN reminder_start_sent INTEGER NOT NULL DEFAULT 0');
      }
      if (!eventColumns.includes('temp_role_delete_after')) {
        db.exec('ALTER TABLE events ADD COLUMN temp_role_delete_after TEXT');
      }
      if (!eventColumns.includes('auto_started')) {
        db.exec('ALTER TABLE events ADD COLUMN auto_started INTEGER NOT NULL DEFAULT 0');
      }
    }
  },
  {
    version: 19,
    name: 'operation_reminders',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS operation_reminders (
          reminder_key TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          message_id TEXT,
          channel_id TEXT,
          sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  },
  {
    version: 20,
    name: 'persistent_bot_messages',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS persistent_bot_messages (
          message_key TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL,
          message_id TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  },
  {
    version: 21,
    name: 'career_point_transactions',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS career_point_transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER NOT NULL,
          discord_id TEXT NOT NULL,
          point_type TEXT NOT NULL,
          role TEXT,
          weapon_key TEXT NOT NULL,
          weapon_name TEXT NOT NULL,
          seconds INTEGER NOT NULL DEFAULT 0,
          points INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL DEFAULT 'event_approval',
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(event_id, discord_id, point_type, weapon_key),
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_career_point_transactions_event
          ON career_point_transactions (event_id);

        CREATE INDEX IF NOT EXISTS idx_career_point_transactions_member
          ON career_point_transactions (discord_id);
      `);
    }
  },
  {
    version: 22,
    name: 'albion_weekly_imports',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS albion_imports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          import_type TEXT NOT NULL,
          week_key TEXT NOT NULL,
          source_name TEXT,
          rows_count INTEGER NOT NULL DEFAULT 0,
          summary_json TEXT,
          imported_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(import_type, week_key)
        );

        CREATE TABLE IF NOT EXISTS albion_pve_rankings (
          import_id INTEGER NOT NULL,
          week_key TEXT NOT NULL,
          rank INTEGER NOT NULL,
          albion_name TEXT NOT NULL,
          guild_role TEXT,
          amount INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (import_id, albion_name),
          FOREIGN KEY (import_id) REFERENCES albion_imports(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_albion_pve_rankings_week
          ON albion_pve_rankings (week_key, rank);

        CREATE TABLE IF NOT EXISTS albion_guild_logs (
          import_id INTEGER NOT NULL,
          week_key TEXT NOT NULL,
          event_date TEXT NOT NULL,
          actor_name TEXT NOT NULL,
          action_type TEXT NOT NULL,
          raw_reason TEXT NOT NULL,
          target_hint TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (import_id, event_date, actor_name, raw_reason),
          FOREIGN KEY (import_id) REFERENCES albion_imports(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_albion_guild_logs_week
          ON albion_guild_logs (week_key, action_type);
      `);
    }
  },
  {
    version: 23,
    name: 'event_message_channel',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(events)').all().map((column) => column.name);
      if (!columns.includes('message_channel_id')) {
        db.exec('ALTER TABLE events ADD COLUMN message_channel_id TEXT');
      }
    }
  },
  {
    version: 24,
    name: 'campaign_900m',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS campaigns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT UNIQUE NOT NULL,
          title TEXT NOT NULL,
          goal_amount INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          role_name TEXT NOT NULL DEFAULT '900m',
          progress_channel_id TEXT,
          progress_message_id TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          closed_at TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS campaign_event_payouts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id INTEGER NOT NULL,
          event_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          amount INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          decision TEXT,
          dm_message_id TEXT,
          expires_at TEXT NOT NULL,
          created_by TEXT NOT NULL,
          processed_by TEXT,
          decided_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(campaign_id, event_id, user_id),
          FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS campaign_contributions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          amount INTEGER NOT NULL,
          source_type TEXT NOT NULL,
          source_id TEXT,
          status TEXT NOT NULL DEFAULT 'approved',
          created_by TEXT NOT NULL,
          approved_by TEXT,
          note TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_campaign_event_payouts_pending
          ON campaign_event_payouts (status, expires_at);

        CREATE INDEX IF NOT EXISTS idx_campaign_contributions_campaign
          ON campaign_contributions (campaign_id, created_at);

        INSERT OR IGNORE INTO campaigns
          (code, title, goal_amount, status, role_name, progress_channel_id, created_by)
        VALUES
          ('900m', 'Meta 900m NOTAG', 900000000, 'open', '900m', '1484312044772655154', 'system');
      `);
    }
  },
  {
    version: 25,
    name: 'payment_requests',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS payment_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          amount INTEGER NOT NULL,
          service TEXT NOT NULL,
          description TEXT NOT NULL,
          evidence TEXT,
          status TEXT NOT NULL DEFAULT 'requested',
          reviewed_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          reviewed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_payment_requests_status
          ON payment_requests (status, created_at);
      `);
    }
  },
  {
    version: 26,
    name: 'albion_stats_ocr_submissions',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS albion_stats_ocr_submissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          submitted_by TEXT NOT NULL,
          target_discord_id TEXT NOT NULL,
          channel_id TEXT,
          message_id TEXT,
          image_url TEXT NOT NULL,
          character_name TEXT,
          guild_name TEXT,
          total_fame TEXT,
          is_notag_member INTEGER,
          ocr_text TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          applied_role TEXT,
          reviewed_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          reviewed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_albion_stats_ocr_submissions_status
          ON albion_stats_ocr_submissions (status, created_at);

        CREATE INDEX IF NOT EXISTS idx_albion_stats_ocr_submissions_target
          ON albion_stats_ocr_submissions (target_discord_id, created_at);
      `);
    }
  },
  {
    version: 27,
    name: 'guild_member_events',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS guild_member_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          discord_id TEXT NOT NULL,
          discord_name TEXT,
          display_name TEXT,
          albion_name TEXT,
          registration_status TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_guild_member_events_type_created_at
          ON guild_member_events (event_type, created_at);

        CREATE INDEX IF NOT EXISTS idx_guild_member_events_discord_id_created_at
          ON guild_member_events (discord_id, created_at);
      `);
    }
  },
  {
    version: 28,
    name: 'albion_fame_totals',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS albion_fame_imports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_name TEXT,
          rows_count INTEGER NOT NULL DEFAULT 0,
          summary_json TEXT,
          imported_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS albion_fame_totals (
          albion_key TEXT PRIMARY KEY,
          albion_name TEXT NOT NULL,
          total_fame INTEGER NOT NULL DEFAULT 0,
          pve_fame INTEGER NOT NULL DEFAULT 0,
          pvp_fame INTEGER NOT NULL DEFAULT 0,
          gathering_fame INTEGER NOT NULL DEFAULT 0,
          crafting_fame INTEGER NOT NULL DEFAULT 0,
          import_id INTEGER,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (import_id) REFERENCES albion_fame_imports(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_albion_fame_totals_pve
          ON albion_fame_totals (pve_fame DESC);

        CREATE INDEX IF NOT EXISTS idx_albion_fame_totals_pvp
          ON albion_fame_totals (pvp_fame DESC);

        CREATE INDEX IF NOT EXISTS idx_albion_fame_totals_gathering
          ON albion_fame_totals (gathering_fame DESC);

        CREATE INDEX IF NOT EXISTS idx_albion_fame_totals_crafting
          ON albion_fame_totals (crafting_fame DESC);
      `);
    }
  },
  {
    version: 29,
    name: 'linked_discord_accounts',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS linked_discord_accounts (
          linked_discord_id TEXT PRIMARY KEY,
          primary_discord_id TEXT NOT NULL,
          label TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_linked_discord_accounts_primary
          ON linked_discord_accounts (primary_discord_id);
      `);

      const linkStmt = db.prepare(`
        INSERT INTO linked_discord_accounts (linked_discord_id, primary_discord_id, label)
        VALUES (@linkedDiscordId, @primaryDiscordId, @label)
        ON CONFLICT(linked_discord_id) DO UPDATE SET
          primary_discord_id = excluded.primary_discord_id,
          label = excluded.label,
          updated_at = CURRENT_TIMESTAMP
      `);

      for (const link of defaultAccountLinks) {
        linkStmt.run(link);
      }

      for (const link of defaultAccountLinks.filter((item) => item.linkedDiscordId !== item.primaryDiscordId)) {
        const secondaryBalance = db.prepare('SELECT balance FROM balances WHERE discord_id = ?').get(link.linkedDiscordId);
        if (secondaryBalance) {
          db.prepare(`
            INSERT INTO balances (discord_id, balance, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(discord_id) DO UPDATE SET
              balance = balance + excluded.balance,
              updated_at = CURRENT_TIMESTAMP
          `).run(link.primaryDiscordId, Number(secondaryBalance.balance || 0));
          db.prepare('DELETE FROM balances WHERE discord_id = ?').run(link.linkedDiscordId);
        }

        db.prepare('UPDATE balance_transactions SET user_id = ? WHERE user_id = ?').run(link.primaryDiscordId, link.linkedDiscordId);
        db.prepare('UPDATE withdraw_requests SET user_id = ? WHERE user_id = ?').run(link.primaryDiscordId, link.linkedDiscordId);
        db.prepare('UPDATE payment_requests SET user_id = ? WHERE user_id = ?').run(link.primaryDiscordId, link.linkedDiscordId);
        mergeCampaignEventPayouts(db, link.primaryDiscordId, link.linkedDiscordId);
        db.prepare('UPDATE campaign_event_payouts SET user_id = ? WHERE user_id = ?').run(link.primaryDiscordId, link.linkedDiscordId);
        db.prepare('UPDATE campaign_contributions SET user_id = ? WHERE user_id = ?').run(link.primaryDiscordId, link.linkedDiscordId);
      }
    }
  },
  {
    version: 30,
    name: 'member_role_notice_queue',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS member_role_notice_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          verification_id INTEGER,
          discord_id TEXT NOT NULL,
          reason TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          message_id TEXT,
          thread_id TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          sent_at TEXT,
          archive_at TEXT,
          archived_at TEXT,
          UNIQUE(verification_id, discord_id, reason)
        );

        CREATE INDEX IF NOT EXISTS idx_member_role_notice_queue_status
          ON member_role_notice_queue (status, id);

        CREATE INDEX IF NOT EXISTS idx_member_role_notice_queue_archive
          ON member_role_notice_queue (archived_at, archive_at);
      `);
    }
  },
  {
    version: 31,
    name: 'weekly_voice_core_awards',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS weekly_voice_core_awards (
          week_start TEXT PRIMARY KEY,
          week_end TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          message_id TEXT,
          qualified_count INTEGER NOT NULL DEFAULT 0,
          awarded_count INTEGER NOT NULL DEFAULT 0,
          qualified_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  },
  {
    version: 32,
    name: 'albion_fame_daily_snapshots',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS albion_fame_daily_snapshots (
          snapshot_date TEXT NOT NULL,
          albion_key TEXT NOT NULL,
          albion_name TEXT NOT NULL,
          pve_fame INTEGER NOT NULL DEFAULT 0,
          pvp_fame INTEGER NOT NULL DEFAULT 0,
          crafting_fame INTEGER NOT NULL DEFAULT 0,
          gathering_fame INTEGER NOT NULL DEFAULT 0,
          total_fame INTEGER NOT NULL DEFAULT 0,
          captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (snapshot_date, albion_key)
        );

        CREATE INDEX IF NOT EXISTS idx_albion_fame_snapshots_player
          ON albion_fame_daily_snapshots (albion_key, snapshot_date);
      `);
    }
  },
  {
    version: 33,
    name: 'albion_killfeed_events',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS albion_killfeed_events (
          event_id INTEGER PRIMARY KEY,
          event_type TEXT NOT NULL,
          event_at TEXT,
          discord_message_id TEXT,
          posted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_albion_killfeed_posted_at
          ON albion_killfeed_events (posted_at);
      `);
    }
  },
  {
    version: 34,
    name: 'albion_vengeance_rewards',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS albion_vengeance_deaths (
          original_event_id INTEGER PRIMARY KEY,
          victim_discord_id TEXT NOT NULL,
          victim_albion_name TEXT NOT NULL,
          enemy_player_id TEXT NOT NULL,
          enemy_player_name TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          avenged_event_id INTEGER,
          avenger_discord_id TEXT,
          avenged_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_vengeance_pending_enemy
          ON albion_vengeance_deaths (enemy_player_id, avenged_event_id, occurred_at);

        CREATE TABLE IF NOT EXISTS albion_vengeance_rewards (
          vengeance_event_id INTEGER PRIMARY KEY,
          avenger_discord_id TEXT NOT NULL,
          amount INTEGER NOT NULL,
          original_events_json TEXT NOT NULL,
          rewarded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_vengeance_rewards_user_date
          ON albion_vengeance_rewards (avenger_discord_id, rewarded_at);
      `);
    }
  },
  {
    version: 35,
    name: 'silent_idle_game',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS idle_game_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          voice_channel_id TEXT NOT NULL,
          voice_channel_name TEXT,
          host_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          discord_message_id TEXT,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_idle_sessions_status ON idle_game_sessions(status, started_at);

        CREATE TABLE IF NOT EXISTS idle_game_players (
          discord_id TEXT PRIMARY KEY,
          discord_name TEXT,
          total_points REAL NOT NULL DEFAULT 0,
          total_focus_seconds INTEGER NOT NULL DEFAULT 0,
          total_speeches INTEGER NOT NULL DEFAULT 0,
          sessions_joined INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS idle_game_participation (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL,
          discord_id TEXT NOT NULL,
          discord_name TEXT,
          points REAL NOT NULL DEFAULT 0,
          focus_seconds INTEGER NOT NULL DEFAULT 0,
          speech_count INTEGER NOT NULL DEFAULT 0,
          penalty_until TEXT,
          joined_at TEXT NOT NULL,
          left_at TEXT,
          event_bonus INTEGER NOT NULL DEFAULT 0,
          UNIQUE(session_id, discord_id),
          FOREIGN KEY(session_id) REFERENCES idle_game_sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_idle_participation_session ON idle_game_participation(session_id, points DESC);

        CREATE TABLE IF NOT EXISTS idle_game_speech_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL,
          discord_id TEXT NOT NULL,
          penalty_seconds INTEGER NOT NULL,
          occurred_at TEXT NOT NULL,
          FOREIGN KEY(session_id) REFERENCES idle_game_sessions(id) ON DELETE CASCADE
        );
      `);
    }
  },
  {
    version: 36,
    name: 'idle_discord_dashboard',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(idle_game_sessions)').all().map((column) => column.name);
      if (!columns.includes('topic_message_id')) {
        db.exec('ALTER TABLE idle_game_sessions ADD COLUMN topic_message_id TEXT');
      }
    }
  },
  {
    version: 37,
    name: 'albion_killfeed_cursor',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS albion_killfeed_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  }
];

function mergeCampaignEventPayouts(db, primaryDiscordId, linkedDiscordId) {
  const conflicts = db.prepare(`
    SELECT
      linked.id AS linked_id,
      primary_row.id AS primary_id,
      linked.amount AS linked_amount
    FROM campaign_event_payouts linked
    JOIN campaign_event_payouts primary_row
      ON primary_row.campaign_id = linked.campaign_id
     AND primary_row.event_id = linked.event_id
     AND primary_row.user_id = ?
    WHERE linked.user_id = ?
  `).all(primaryDiscordId, linkedDiscordId);

  for (const row of conflicts) {
    db.prepare(`
      UPDATE campaign_event_payouts
      SET amount = amount + ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(Number(row.linked_amount || 0), row.primary_id);
    db.prepare('DELETE FROM campaign_event_payouts WHERE id = ?').run(row.linked_id);
  }
}

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
