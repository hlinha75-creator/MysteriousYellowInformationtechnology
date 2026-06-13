const { getDatabase, transaction } = require('../../database/connection');

const upsertRegistration = transaction((registration) => {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO raid_avalon_registrations (
      nick,
      horarios_json,
      armas_json,
      builds_json,
      casa_ho_loch,
      portal_martlock,
      warnings_json,
      created_at,
      updated_at
    ) VALUES (
      @nick,
      @horariosJson,
      @armasJson,
      @buildsJson,
      @casaHoLoch,
      @portalMartlock,
      @warningsJson,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(nick) DO UPDATE SET
      horarios_json = excluded.horarios_json,
      armas_json = excluded.armas_json,
      builds_json = excluded.builds_json,
      casa_ho_loch = excluded.casa_ho_loch,
      portal_martlock = excluded.portal_martlock,
      warnings_json = excluded.warnings_json,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    nick: registration.nick,
    horariosJson: JSON.stringify(registration.horarios),
    armasJson: JSON.stringify(registration.armas),
    buildsJson: JSON.stringify(registration.builds),
    casaHoLoch: registration.casaHoLoch ? 1 : 0,
    portalMartlock: registration.portalMartlock ? 1 : 0,
    warningsJson: JSON.stringify(registration.warnings)
  });

  return findRegistrationByNick(registration.nick);
});

function listRegistrations() {
  return getDatabase()
    .prepare('SELECT * FROM raid_avalon_registrations ORDER BY created_at ASC, nick ASC')
    .all()
    .map(mapRow);
}

function findRegistrationByNick(nick) {
  const row = getDatabase()
    .prepare('SELECT * FROM raid_avalon_registrations WHERE nick = ?')
    .get(nick);
  return row ? mapRow(row) : null;
}

function getState(key) {
  const row = getDatabase()
    .prepare('SELECT value FROM raid_avalon_state WHERE key = ?')
    .get(key);
  return row?.value || '';
}

function setState(key, value) {
  getDatabase()
    .prepare(`
      INSERT INTO raid_avalon_state (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `)
    .run(key, value);
}

function mapRow(row) {
  return {
    id: row.id,
    nick: row.nick,
    horarios: parseJson(row.horarios_json, []),
    armas: parseJson(row.armas_json, []),
    builds: parseJson(row.builds_json, []),
    casaHoLoch: Boolean(row.casa_ho_loch),
    portalMartlock: Boolean(row.portal_martlock),
    warnings: parseJson(row.warnings_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
}

module.exports = {
  findRegistrationByNick,
  getState,
  listRegistrations,
  setState,
  upsertRegistration
};
