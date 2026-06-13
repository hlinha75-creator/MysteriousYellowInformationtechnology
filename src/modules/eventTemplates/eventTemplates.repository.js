const { getDatabase } = require('../../database/connection');

function upsertTemplate(data) {
  getDatabase()
    .prepare(`
      INSERT INTO event_templates (
        creator_id,
        name,
        title,
        location,
        requirements,
        composition,
        tank_slots,
        healer_slots,
        support_slots,
        dps_slots,
        created_at,
        updated_at
      ) VALUES (
        @creatorId,
        @name,
        @title,
        @location,
        @requirements,
        @composition,
        @tankSlots,
        @healerSlots,
        @supportSlots,
        @dpsSlots,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT(creator_id, name) DO UPDATE SET
        title = excluded.title,
        location = excluded.location,
        requirements = excluded.requirements,
        composition = excluded.composition,
        tank_slots = excluded.tank_slots,
        healer_slots = excluded.healer_slots,
        support_slots = excluded.support_slots,
        dps_slots = excluded.dps_slots,
        updated_at = CURRENT_TIMESTAMP
    `)
    .run(data);
  return getTemplate({ creatorId: data.creatorId, name: data.name });
}

function getTemplate({ creatorId, name }) {
  return getDatabase()
    .prepare('SELECT * FROM event_templates WHERE creator_id = ? AND name = ?')
    .get(creatorId, name);
}

function listTemplates(creatorId) {
  return getDatabase()
    .prepare('SELECT * FROM event_templates WHERE creator_id = ? ORDER BY name')
    .all(creatorId);
}

function deleteTemplate({ creatorId, name }) {
  return getDatabase()
    .prepare('DELETE FROM event_templates WHERE creator_id = ? AND name = ?')
    .run(creatorId, name);
}

module.exports = {
  deleteTemplate,
  getTemplate,
  listTemplates,
  upsertTemplate
};
