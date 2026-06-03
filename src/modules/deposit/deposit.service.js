const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  UserSelectMenuBuilder
} = require('discord.js');
const ids = require('../../config/ids');
const finance = require('../finance/finance.service');
const audit = require('../audit/audit.repository');
const { calculateNetLoot } = require('../events/lootCalculator');
const { formatSilver } = require('../../utils/silver');
const { safeSend } = require('../../utils/discord');

const drafts = new Map();

function createDraft({ actorId, lootTotal, repair, silverBags, taxPercent }) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const netLoot = calculateNetLoot({ lootTotal, repair, silverBags, taxPercent });
  const draft = {
    id,
    actorId,
    lootTotal,
    repair,
    silverBags,
    taxPercent,
    netLoot,
    participants: new Set(),
    createdAt: Date.now()
  };
  drafts.set(id, draft);
  return draft;
}

function getDraft(id) {
  return drafts.get(id);
}

function addParticipants({ draftId, userIds }) {
  const draft = getDraft(draftId);
  if (!draft) throw new Error('Deposito expirado ou nao encontrado.');
  for (const userId of userIds) draft.participants.add(userId);
  return draft;
}

function cancelDraft(id) {
  drafts.delete(id);
}

function perMemberAmount(draft) {
  const count = draft.participants.size;
  if (count <= 0) return 0;
  return Math.floor(draft.netLoot / count);
}

async function confirmDraft({ draftId, actorId, client }) {
  const draft = getDraft(draftId);
  if (!draft) throw new Error('Deposito expirado ou nao encontrado.');
  if (draft.actorId !== actorId) throw new Error('Somente quem criou o deposito pode confirmar.');
  if (draft.participants.size === 0) throw new Error('Selecione pelo menos um participante.');

  const amount = perMemberAmount(draft);
  const participants = Array.from(draft.participants);
  const transactions = participants.map((userId) => ({
    type: 'quick_deposit',
    userId,
    amount,
    reason: `Deposito rapido dividido igualmente entre ${participants.length} membros`,
    referenceType: 'quick_deposit',
    referenceId: draft.id,
    createdBy: actorId
  }));
  finance.applyManyTransactions(transactions);
  await finance.notifyPositiveTransactions({ client, transactions });

  audit.createAuditLog({
    type: 'quick_deposit_confirmed',
    actorId,
    afterValue: draft.netLoot,
    reason: `Deposito rapido ${draft.id}`,
    metadata: {
      participants,
      perMember: amount,
      lootTotal: draft.lootTotal,
      repair: draft.repair,
      silverBags: draft.silverBags,
      taxPercent: draft.taxPercent
    }
  });

  await safeSend(client, ids.channels.bankLogs, {
    content: `Deposito rapido aprovado por <@${actorId}>: ${formatSilver(amount)} para ${participants.length} membro(s). Total liquido: ${formatSilver(draft.netLoot)}.`
  });

  drafts.delete(draftId);
  return { amount, participants };
}

function draftEmbed(draft) {
  const count = draft.participants.size;
  const amount = perMemberAmount(draft);
  const participants = Array.from(draft.participants).slice(0, 30).map((id) => `<@${id}>`).join(', ');
  return new EmbedBuilder()
    .setTitle('Deposito rapido')
    .setDescription('Selecione os participantes pela busca do Discord. Pode adicionar em mais de uma rodada.')
    .addFields(
      { name: 'Loot total', value: formatSilver(draft.lootTotal), inline: true },
      { name: 'Reparo', value: formatSilver(draft.repair), inline: true },
      { name: 'Sacos', value: formatSilver(draft.silverBags), inline: true },
      { name: 'Taxa', value: `${draft.taxPercent}%`, inline: true },
      { name: 'Liquido', value: formatSilver(draft.netLoot), inline: true },
      { name: 'Participantes', value: String(count), inline: true },
      { name: 'Cada membro recebe', value: formatSilver(amount), inline: true },
      { name: 'Selecionados', value: participants || 'Nenhum membro selecionado ainda.', inline: false }
    )
    .setColor(0x38a169)
    .setTimestamp(new Date());
}

function draftComponents(draftId) {
  return [
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`deposit_select:add:${draftId}`)
        .setPlaceholder('Buscar e selecionar participantes')
        .setMinValues(1)
        .setMaxValues(25)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`deposit:confirm:${draftId}`).setLabel('Confirmar deposito').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`deposit:cancel:${draftId}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
    )
  ];
}

module.exports = {
  addParticipants,
  cancelDraft,
  confirmDraft,
  createDraft,
  draftComponents,
  draftEmbed,
  getDraft
};
