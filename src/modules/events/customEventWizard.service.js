const { randomUUID } = require('node:crypto');

const drafts = new Map();
const roleOrder = ['tank', 'healer', 'support', 'dps'];
const roleLabels = {
  tank: 'Tank',
  healer: 'Healer',
  support: 'Suporte',
  dps: 'DPS'
};
const fieldsPerPage = 5;
const maxSlots = 40;

function createDraft({ creatorId, title, timeRange, day, description, composition }) {
  const slots = parseComposition(composition);
  const id = randomUUID().replaceAll('-', '').slice(0, 12);
  const draft = {
    id,
    creatorId,
    title: clean(title, 100),
    timeRange: clean(timeRange, 80),
    day: clean(day, 20),
    description: clean(description, 1000),
    composition: slots,
    lootRules: '',
    consumables: '',
    mount: '',
    slotDefinitions: buildSlotDefinitions(slots),
    createdAt: Date.now()
  };
  if (!draft.title) throw new Error('Informe o titulo do evento personalizado.');
  if (!draft.timeRange) throw new Error('Informe o horario. Ex: das 18:30 as 20:30.');
  if (!/^\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?$/.test(draft.day)) {
    throw new Error('Informe o dia no formato DD/MM ou DD/MM/AAAA. Ex: 20/07.');
  }
  drafts.set(id, draft);
  return draft;
}

function parseComposition(value) {
  const numbers = String(value || '').match(/\d+/g) || [];
  if (numbers.length !== 4) {
    throw new Error('Use 4 numeros na composicao: Tank, Healer, Suporte, DPS. Ex: 2,2,2,14.');
  }
  const slots = Object.fromEntries(roleOrder.map((role, index) => [role, Number.parseInt(numbers[index], 10)]));
  const values = Object.values(slots);
  if (values.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new Error('A composicao deve usar somente quantidades inteiras maiores ou iguais a zero.');
  }
  const total = values.reduce((sum, count) => sum + count, 0);
  if (total < 1) throw new Error('A composicao precisa liberar pelo menos uma vaga.');
  if (total > maxSlots) throw new Error(`A composicao personalizada aceita no maximo ${maxSlots} vagas.`);
  return slots;
}

function buildSlotDefinitions(composition) {
  return roleOrder.flatMap((role) => (
    Array.from({ length: composition[role] }, (_, index) => ({
      role,
      index: index + 1,
      fieldLabel: role === 'dps' && index === composition.dps - 1
        ? 'Looter (ultima vaga DPS)'
        : `${roleLabels[role]} ${index + 1}`,
      value: ''
    }))
  ));
}

function getDraft(id, creatorId = null) {
  const draft = drafts.get(String(id));
  if (!draft) throw new Error('Rascunho de evento expirado ou nao encontrado. Comece novamente.');
  if (creatorId && draft.creatorId !== creatorId) throw new Error('Somente quem iniciou este evento pode continuar.');
  return draft;
}

function saveDetails({ id, creatorId, lootRules, consumables, mount }) {
  const draft = getDraft(id, creatorId);
  draft.lootRules = clean(lootRules, 1000);
  draft.consumables = clean(consumables, 1000);
  draft.mount = clean(mount, 200);
  return draft;
}

function pageCount(draftOrId) {
  const draft = typeof draftOrId === 'string' ? getDraft(draftOrId) : draftOrId;
  return Math.ceil(draft.slotDefinitions.length / fieldsPerPage);
}

function slotPage({ id, creatorId, page }) {
  const draft = getDraft(id, creatorId);
  const pageIndex = parsePage(page, pageCount(draft));
  const start = pageIndex * fieldsPerPage;
  return {
    draft,
    page: pageIndex,
    totalPages: pageCount(draft),
    slots: draft.slotDefinitions.slice(start, start + fieldsPerPage)
  };
}

function saveSlotPage({ id, creatorId, page, values }) {
  const result = slotPage({ id, creatorId, page });
  const start = result.page * fieldsPerPage;
  result.slots.forEach((slot, index) => {
    result.draft.slotDefinitions[start + index].value = clean(values[index], 80);
  });
  return result;
}

function removeDraft(id, creatorId = null) {
  const draft = getDraft(id, creatorId);
  drafts.delete(draft.id);
  return draft;
}

function parsePage(value, totalPages) {
  const page = Number.parseInt(value, 10);
  if (!Number.isInteger(page) || page < 0 || page >= totalPages) throw new Error('Etapa de composicao invalida.');
  return page;
}

function clean(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

module.exports = {
  createDraft,
  getDraft,
  pageCount,
  parseComposition,
  removeDraft,
  saveDetails,
  saveSlotPage,
  slotPage
};
