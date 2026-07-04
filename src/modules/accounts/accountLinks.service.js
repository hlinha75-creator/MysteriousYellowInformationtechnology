const { getDatabase } = require('../../database/connection');

function resolvePrimaryUserId(userId) {
  const id = String(userId || '').trim();
  if (!id) return id;
  if (!tableExists()) return id;
  const row = getDatabase()
    .prepare('SELECT primary_discord_id FROM linked_discord_accounts WHERE linked_discord_id = ?')
    .get(id);
  return row?.primary_discord_id || id;
}

function linkedUserIds(userId) {
  const primaryId = resolvePrimaryUserId(userId);
  if (!primaryId) return [];
  if (!tableExists()) return [primaryId];
  const rows = getDatabase()
    .prepare('SELECT linked_discord_id FROM linked_discord_accounts WHERE primary_discord_id = ? ORDER BY linked_discord_id')
    .all(primaryId)
    .map((row) => row.linked_discord_id);
  return unique([primaryId, ...rows]);
}

function linkInfo(userId) {
  const primaryId = resolvePrimaryUserId(userId);
  const linkedIds = linkedUserIds(primaryId);
  const row = tableExists()
    ? getDatabase()
      .prepare('SELECT label FROM linked_discord_accounts WHERE primary_discord_id = ? AND label IS NOT NULL ORDER BY linked_discord_id LIMIT 1')
      .get(primaryId)
    : null;
  return {
    primaryId,
    linkedIds,
    label: row?.label || null,
    isLinked: linkedIds.length > 1,
    isSecondary: Boolean(userId && primaryId && String(userId) !== String(primaryId))
  };
}

function isSecondaryUserId(userId) {
  const id = String(userId || '').trim();
  return Boolean(id && resolvePrimaryUserId(id) !== id);
}

function canonicalizeRowsByUserId(rows, key = 'discord_id') {
  const map = new Map();
  for (const row of rows) {
    const primaryId = resolvePrimaryUserId(row[key]);
    if (!primaryId) continue;
    if (!map.has(primaryId)) map.set(primaryId, []);
    map.get(primaryId).push(row);
  }
  return map;
}

function placeholders(values) {
  return values.length ? values.map(() => '?').join(',') : "''";
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function tableExists() {
  try {
    return Boolean(getDatabase()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'linked_discord_accounts'")
      .get());
  } catch (error) {
    return false;
  }
}

module.exports = {
  canonicalizeRowsByUserId,
  isSecondaryUserId,
  linkedUserIds,
  linkInfo,
  placeholders,
  resolvePrimaryUserId,
  unique
};
