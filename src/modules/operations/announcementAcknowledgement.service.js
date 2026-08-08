const { getDatabase } = require('../../database/connection');

function registerAcknowledgement(announcementKey, userId) {
  if (!announcementKey || !userId) throw new Error('Aviso ou usuario invalido.');

  const result = getDatabase().prepare(`
    INSERT OR IGNORE INTO announcement_acknowledgements (announcement_key, user_id)
    VALUES (?, ?)
  `).run(announcementKey, userId);

  return { added: result.changes > 0 };
}

module.exports = {
  registerAcknowledgement
};
