const repository = require('./eventTemplates.repository');
const events = require('../events/events.service');

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

function parseSlots(value) {
  const numbers = String(value || '').match(/\d+/g) || [];
  const slots = numbers.slice(0, 4).map((number) => Number.parseInt(number, 10));
  if (slots.length !== 4 || slots.some((slot) => Number.isNaN(slot) || slot < 0)) {
    throw userError('Use 4 numeros para vagas. Ex: 1,1,1,3 para Tank, Healer, Suporte, DPS.');
  }
  return slots;
}

function saveTemplateFromModal({ interaction, rawName }) {
  const name = normalizeName(rawName);
  if (!name) throw userError('Informe um nome valido para o template.');
  const slots = parseSlots(field(interaction, 'slots') || '1,1,1,3');
  return repository.upsertTemplate({
    creatorId: interaction.user.id,
    name,
    title: field(interaction, 'title') || name,
    location: field(interaction, 'location') || 'HO Loch',
    requirements: field(interaction, 'requirements'),
    composition: field(interaction, 'composition'),
    tankSlots: slots[0],
    healerSlots: slots[1],
    supportSlots: slots[2],
    dpsSlots: slots[3]
  });
}

async function createEventFromTemplate({ interaction, name, scheduledTime, titleOverride }) {
  const normalizedName = normalizeName(name);
  const template = repository.getTemplate({ creatorId: interaction.user.id, name: normalizedName });
  if (!template) throw userError(`Template "${normalizedName}" nao encontrado para voce.`);

  return events.createEventFromFields(interaction, {
    creatorId: interaction.user.id,
    title: titleOverride || template.title,
    description: formatDescription(template),
    location: template.location,
    scheduledTime,
    tankSlots: template.tank_slots,
    healerSlots: template.healer_slots,
    supportSlots: template.support_slots,
    dpsSlots: template.dps_slots
  });
}

function listTemplatesText(creatorId) {
  const templates = repository.listTemplates(creatorId);
  if (templates.length === 0) return 'Voce ainda nao tem templates. Use `/template_evento criar`.';
  return templates.map((template) => [
    `**${template.name}** - ${template.title}`,
    `Local: ${template.location}`,
    `Slots: Tank ${template.tank_slots}, Healer ${template.healer_slots}, Suporte ${template.support_slots}, DPS ${template.dps_slots}`
  ].join('\n')).join('\n\n').slice(0, 1900);
}

function removeTemplate({ creatorId, name }) {
  const normalizedName = normalizeName(name);
  const result = repository.deleteTemplate({ creatorId, name: normalizedName });
  if (result.changes === 0) throw userError(`Template "${normalizedName}" nao encontrado para voce.`);
  return normalizedName;
}

function formatDescription(template) {
  return [
    template.requirements ? `Regras/Requisitos:\n${template.requirements}` : '',
    template.composition ? `Composicao:\n${template.composition}` : ''
  ].filter(Boolean).join('\n\n') || 'Template sem descricao.';
}

function field(interaction, id) {
  return interaction.fields.getTextInputValue(id).trim();
}

function userError(message) {
  const error = new Error(message);
  error.isUserFacing = true;
  return error;
}

module.exports = {
  createEventFromTemplate,
  listTemplatesText,
  normalizeName,
  removeTemplate,
  saveTemplateFromModal
};
