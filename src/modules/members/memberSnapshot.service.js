const { getDatabase, transaction } = require('../../database/connection');
const dailyReport = require('../reports/dailyReport.service');

function importMemberSnapshot(text, { sourceName = null, actorId = 'manual' } = {}) {
  const rows = dailyReport.parseMemberExport(text);
  if (!rows.length) {
    throw new Error('Nenhum membro encontrado no arquivo informado.');
  }

  return saveSnapshot({
    sourceName,
    actorId,
    rows
  });
}

const saveSnapshot = transaction(({ sourceName, actorId, rows }) => {
  const db = getDatabase();
  const onlineCount = rows.filter((row) => row.isOnline).length;
  const snapshot = db
    .prepare(`
      INSERT INTO member_snapshots (created_by, source_name, member_count, online_count)
      VALUES (?, ?, ?, ?)
    `)
    .run(actorId || 'manual', sourceName || null, rows.length, onlineCount);

  const stmt = db.prepare(`
    INSERT INTO member_snapshot_rows (
      snapshot_id,
      member_key,
      character_name,
      last_seen,
      roles_json,
      is_online,
      last_seen_iso
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const row of rows) {
    stmt.run(
      snapshot.lastInsertRowid,
      row.key,
      row.characterName,
      row.lastSeen || null,
      JSON.stringify(row.roles || []),
      row.isOnline ? 1 : 0,
      row.lastSeenDate ? row.lastSeenDate.toISOString() : null
    );
  }

  return {
    id: snapshot.lastInsertRowid,
    memberCount: rows.length,
    onlineCount
  };
});

function latestSnapshot() {
  return getDatabase()
    .prepare('SELECT * FROM member_snapshots ORDER BY id DESC LIMIT 1')
    .get();
}

module.exports = {
  importMemberSnapshot,
  latestSnapshot
};
