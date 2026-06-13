const { getDatabase, transaction } = require('../../database/connection');

function createSnapshot({ createdBy, sourceName, members }) {
  return transaction(() => {
    const db = getDatabase();
    const onlineCount = members.filter((member) => member.isOnline).length;
    const result = db.prepare(`
      INSERT INTO member_snapshots (created_by, source_name, member_count, online_count)
      VALUES (?, ?, ?, ?)
    `).run(createdBy, sourceName || '', members.length, onlineCount);

    const insertRow = db.prepare(`
      INSERT INTO member_snapshot_rows
        (snapshot_id, member_key, character_name, last_seen, roles_json, is_online, last_seen_iso)
      VALUES
        (@snapshotId, @memberKey, @characterName, @lastSeen, @rolesJson, @isOnline, @lastSeenIso)
    `);

    for (const member of members) {
      insertRow.run({
        snapshotId: result.lastInsertRowid,
        memberKey: member.key,
        characterName: member.characterName,
        lastSeen: member.lastSeen || '',
        rolesJson: JSON.stringify(member.roles || []),
        isOnline: member.isOnline ? 1 : 0,
        lastSeenIso: member.lastSeenDate ? member.lastSeenDate.toISOString() : ''
      });
    }

    return result.lastInsertRowid;
  })();
}

function getLatestSnapshot() {
  const snapshot = getDatabase()
    .prepare('SELECT * FROM member_snapshots ORDER BY id DESC LIMIT 1')
    .get();
  if (!snapshot) return null;
  return {
    ...snapshot,
    members: listSnapshotRows(snapshot.id)
  };
}

function getSnapshot(id) {
  const snapshot = getDatabase()
    .prepare('SELECT * FROM member_snapshots WHERE id = ?')
    .get(id);
  if (!snapshot) return null;
  return {
    ...snapshot,
    members: listSnapshotRows(snapshot.id)
  };
}

function listSnapshotRows(snapshotId) {
  return getDatabase()
    .prepare(`
      SELECT
        member_key AS key,
        character_name AS characterName,
        last_seen AS lastSeen,
        roles_json AS rolesJson,
        is_online AS isOnline,
        last_seen_iso AS lastSeenIso
      FROM member_snapshot_rows
      WHERE snapshot_id = ?
      ORDER BY character_name COLLATE NOCASE
    `)
    .all(snapshotId)
    .map((row) => ({
      key: row.key,
      characterName: row.characterName,
      lastSeen: row.lastSeen || '',
      roles: parseJson(row.rolesJson, []),
      isOnline: Boolean(row.isOnline),
      lastSeenDate: row.lastSeenIso ? new Date(row.lastSeenIso) : null
    }));
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

module.exports = {
  createSnapshot,
  getLatestSnapshot,
  getSnapshot
};
