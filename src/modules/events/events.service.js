const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  StringSelectMenuBuilder
} = require('discord.js');
const ids = require('../../config/ids');
const { transaction } = require('../../database/connection');
const audit = require('../audit/audit.repository');
const finance = require('../finance/finance.service');
const repo = require('./events.repository');
const { calculateNetLoot, calculatePayouts } = require('./lootCalculator');
const { formatSilver } = require('../../utils/silver');
const { backupDatabase } = require('../../database/backup');

const roles = [
  { label: 'Tank', value: 'tank' },
  { label: 'Healer', value: 'healer' },
  { label: 'Suporte', value: 'support' },
  { label: 'DPS', value: 'dps' }
];

function eventEmbed(event, participants = []) {
  const count = (role) => participants.filter((p) => p.role === role && !p.is_spectator).length;
  const embed = new EmbedBuilder()
    .setTitle(event.title)
    .setFooter({ text: event.event_code })
    .setColor(event.status === 'running' ? 0x38a169 : event.status === 'cancelled' ? 0xe53e3e : 0x3182ce)
    .setTimestamp(new Date());

  if (event.status === 'running') {
    return embed
      .setDescription(`**${event.description || 'Evento em andamento'}**\nEm andamento | ${event.location || 'Local nao informado'} | ${event.scheduled_time || 'Horario nao informado'}`)
      .addFields(
        { name: 'Vagas', value: `T ${count('tank')}/${event.tank_slots} | H ${count('healer')}/${event.healer_slots} | S ${count('support')}/${event.support_slots} | DPS ${count('dps')}/${event.dps_slots}`, inline: false },
        { name: 'Voz', value: event.voice_channel_id ? `<#${event.voice_channel_id}>` : 'Sala em criacao', inline: true },
        { name: 'Criador', value: `<@${event.creator_id}>`, inline: true }
      );
  }

  return embed
    .setDescription(`**${event.description || 'Sem descricao.'}**`)
    .addFields(
      { name: 'Codigo', value: event.event_code, inline: true },
      { name: 'Status', value: event.status, inline: true },
      { name: 'Local', value: event.location || 'Nao informado', inline: true },
      { name: 'Horario UTC-3', value: event.scheduled_time || 'Nao informado', inline: true },
      { name: 'Tanks', value: roleOccupants(participants, 'tank', event.tank_slots), inline: false },
      { name: 'Healers', value: roleOccupants(participants, 'healer', event.healer_slots), inline: false },
      { name: 'Suportes', value: roleOccupants(participants, 'support', event.support_slots), inline: false },
      { name: 'DPS', value: roleOccupants(participants, 'dps', event.dps_slots), inline: false },
      { name: 'Criador', value: `<@${event.creator_id}>`, inline: true }
    );
}

function roleOccupants(participants, role, slots) {
  const users = participants.filter((p) => p.role === role && !p.is_spectator).map((p) => `<@${p.discord_id}>`);
  const header = `${users.length}/${slots}`;
  const value = users.length > 0 ? users.join(', ') : 'Vazio';
  const text = `${header} - ${value}`;
  return text.length > 1024 ? `${text.slice(0, 1018)}...` : text;
}

function eventComponents(event) {
  if (!['created', 'running'].includes(event.status)) return [];

  const select = new StringSelectMenuBuilder()
    .setCustomId(`event:join:${event.id}`)
    .setPlaceholder('Participar como...')
    .addOptions(roles);

  const row1 = new ActionRowBuilder().addComponents(select);
  const buttons = event.status === 'running'
    ? [
      new ButtonBuilder().setCustomId(`event:spectate:${event.id}`).setLabel('Espectador').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`event:finish:${event.id}`).setLabel('Finalizar').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`event:cancel:${event.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
    ]
    : [
      new ButtonBuilder().setCustomId(`event:start:${event.id}`).setLabel('Iniciar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`event:cancel:${event.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
    ];

  return [row1, new ActionRowBuilder().addComponents(buttons)];
}

async function createEventFromModal(interaction, fields) {
  const event = repo.createEvent({
    creatorId: interaction.user.id,
    title: fields.title,
    description: fields.description,
    location: fields.location,
    scheduledTime: fields.scheduledTime,
    tankSlots: fields.tankSlots,
    healerSlots: fields.healerSlots,
    supportSlots: fields.supportSlots,
    dpsSlots: fields.dpsSlots
  });

  const channel = await interaction.client.channels.fetch(ids.channels.participate);
  const message = await channel.send({
    embeds: [eventEmbed(event, [])],
    components: eventComponents(event)
  });
  repo.updateEvent(event.id, { message_id: message.id });

  audit.createAuditLog({
    type: 'event_created',
    actorId: interaction.user.id,
    targetId: String(event.id),
    afterValue: event.event_code,
    reason: 'Evento criado'
  });

  return event;
}

async function refreshEventMessage(client, eventId) {
  const event = repo.getEvent(eventId);
  if (!event?.message_id) return;
  const participants = repo.listParticipants(eventId);
  const channel = await client.channels.fetch(ids.channels.participate).catch(() => null);
  const message = await channel?.messages.fetch(event.message_id).catch(() => null);
  if (message) {
    await message.edit({ embeds: [eventEmbed(event, participants)], components: eventComponents(event) });
  }
}

async function joinEvent(interaction, eventId, role) {
  const event = repo.getEvent(eventId);
  if (!event || ['cancelled', 'approved'].includes(event.status)) throw new Error('Evento indisponivel.');
  repo.upsertParticipant({ eventId, discordId: interaction.user.id, role, isSpectator: 0 });
  audit.createAuditLog({ type: 'event_joined', actorId: interaction.user.id, targetId: String(eventId), afterValue: role });
  await refreshEventMessage(interaction.client, eventId);
}

async function spectateEvent(interaction, eventId) {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'running') throw new Error('Evento nao esta em andamento.');
  repo.upsertParticipant({ eventId, discordId: interaction.user.id, role: 'spectator', isSpectator: 1 });
  audit.createAuditLog({ type: 'event_spectator', actorId: interaction.user.id, targetId: String(eventId) });
  await refreshEventMessage(interaction.client, eventId);
}

async function startEvent(interaction, eventId) {
  const event = repo.getEvent(eventId);
  if (!event) throw new Error('Evento nao encontrado.');
  if (event.status !== 'created') throw new Error('Evento nao pode ser iniciado.');

  const voice = await interaction.guild.channels.create({
    name: event.event_code,
    type: ChannelType.GuildVoice,
    parent: ids.categories.activeEvents,
    reason: `Evento ${event.event_code} iniciado`
  });

  const now = new Date().toISOString();
  repo.updateEvent(eventId, { status: 'running', voice_channel_id: voice.id, started_at: now });
  const participants = repo.listParticipants(eventId).filter((participant) => !participant.is_spectator);
  for (const participant of participants) {
    const member = await interaction.guild.members.fetch(participant.discord_id).catch(() => null);
    if (member?.voice?.channel) {
      await member.voice.setChannel(voice).catch(() => {});
      repo.startVoiceSession({ eventId, discordId: participant.discord_id, joinedAt: now });
    }
  }

  audit.createAuditLog({ type: 'event_started', actorId: interaction.user.id, targetId: String(eventId), afterValue: voice.id });
  await refreshEventMessage(interaction.client, eventId);
  return voice;
}

async function finishEvent(interaction, eventId) {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'running') throw new Error('Evento nao esta em andamento.');

  const now = new Date().toISOString();
  await closeAllOpenSessions(eventId, now);
  repo.refreshParticipantSeconds(eventId);
  repo.updateEvent(eventId, { status: 'review', ended_at: now, review_required: 1 });

  const voice = await interaction.guild.channels.fetch(event.voice_channel_id).catch(() => null);
  const waiting = await interaction.guild.channels.fetch(ids.channels.waitingVoice).catch(() => null);
  if (voice?.members && waiting) {
    for (const member of voice.members.values()) {
      await member.voice.setChannel(waiting).catch(() => {});
    }
  }
  await voice?.delete(`Evento ${event.event_code} finalizado`).catch(() => {});

  audit.createAuditLog({ type: 'event_finished', actorId: interaction.user.id, targetId: String(eventId) });
  await deleteEventMessage(interaction.client, eventId);
}

async function cancelEvent(interaction, eventId, reason) {
  const event = repo.getEvent(eventId);
  if (!event) throw new Error('Evento nao encontrado.');
  repo.updateEvent(eventId, { status: 'cancelled', cancel_reason: reason });
  const voice = event.voice_channel_id ? await interaction.guild.channels.fetch(event.voice_channel_id).catch(() => null) : null;
  await voice?.delete(`Evento cancelado: ${reason}`).catch(() => {});
  audit.createAuditLog({ type: 'event_cancelled', actorId: interaction.user.id, targetId: String(eventId), reason });
  await deleteEventMessage(interaction.client, eventId);
}

function saveLootReview({ eventId, lootTotal, repair, silverBags, taxPercent }) {
  const netLoot = calculateNetLoot({ lootTotal, repair, silverBags, taxPercent });
  repo.refreshParticipantSeconds(eventId);

  transaction(() => {
    repo.upsertReview({ eventId, lootTotal, repair, silverBags, taxPercent, netLoot, status: 'review' });
    recalculatePayouts(eventId);
    repo.updateEvent(eventId, { status: 'review' });
  })();

  audit.createAuditLog({
    type: 'event_review_submitted',
    targetId: String(eventId),
    afterValue: formatSilver(netLoot),
    metadata: { lootTotal, repair, silverBags, taxPercent }
  });
  return { netLoot };
}

function recalculatePayouts(eventId) {
  const review = repo.getReview(eventId);
  if (!review) throw new Error('Revisao do evento nao encontrada.');
  const participants = repo.listParticipants(eventId);
  const payouts = calculatePayouts({ participants, netLoot: review.net_loot });
  repo.clearParticipantPayouts(eventId);
  for (const payout of payouts) {
    repo.setParticipantPayout({ eventId, discordId: payout.discordId, payoutAmount: payout.payout });
  }
  return payouts;
}

function editParticipantReview({ eventId, actorId, discordId, role, minutes, reason }) {
  const before = repo.getParticipant({ eventId, discordId });
  if (!before) throw new Error('Participante nao encontrado neste evento.');
  const manualSeconds = Math.max(0, Math.round(minutes * 60));
  repo.setParticipantReview({ eventId, discordId, role, manualSeconds });
  const payouts = recalculatePayouts(eventId);
  audit.createAuditLog({
    type: 'event_participation_edited',
    actorId,
    targetId: discordId,
    beforeValue: JSON.stringify({ role: before.role, seconds: before.manual_seconds ?? before.calculated_seconds }),
    afterValue: JSON.stringify({ role, seconds: manualSeconds }),
    reason,
    metadata: { eventId, payouts }
  });
}

function addParticipantReview({ eventId, actorId, discordId, role, minutes, reason }) {
  const before = repo.getParticipant({ eventId, discordId });
  const manualSeconds = Math.max(0, Math.round(minutes * 60));
  repo.upsertParticipant({ eventId, discordId, role, isSpectator: 0 });
  repo.setParticipantReview({ eventId, discordId, role, manualSeconds });
  const payouts = recalculatePayouts(eventId);
  audit.createAuditLog({
    type: before ? 'event_participation_readded' : 'event_participation_added',
    actorId,
    targetId: discordId,
    beforeValue: before ? JSON.stringify(before) : null,
    afterValue: JSON.stringify({ role, seconds: manualSeconds }),
    reason,
    metadata: { eventId, payouts }
  });
}

function removeParticipantReview({ eventId, actorId, discordId, reason }) {
  const before = repo.getParticipant({ eventId, discordId });
  if (!before) throw new Error('Participante nao encontrado neste evento.');
  repo.removeParticipant({ eventId, discordId });
  const payouts = recalculatePayouts(eventId);
  audit.createAuditLog({
    type: 'event_participation_removed',
    actorId,
    targetId: discordId,
    beforeValue: JSON.stringify(before),
    reason,
    metadata: { eventId, payouts }
  });
}

function submitEventToFinance({ eventId, actorId }) {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'review') throw new Error('Evento nao esta em revisao.');
  recalculatePayouts(eventId);
  repo.updateEvent(eventId, { status: 'pending_payment' });
  const review = repo.getReview(eventId);
  if (review) {
    repo.upsertReview({
      eventId,
      lootTotal: review.loot_total,
      repair: review.repair,
      silverBags: review.silver_bags,
      taxPercent: review.tax_percent,
      netLoot: review.net_loot,
      status: 'pending_approval'
    });
  }
  audit.createAuditLog({ type: 'event_submitted_to_finance', actorId, targetId: String(eventId), reason: event.event_code });
}

const approveEventPayment = transaction(({ eventId, actorId }) => {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'pending_payment') throw new Error('Evento nao esta pendente de pagamento.');
  backupDatabase('before_event_payment');
  const participants = repo.listParticipants(eventId).filter((participant) => !participant.is_spectator && participant.payout_amount > 0);
  for (const participant of participants) {
    finance.applyBalanceTransaction({
      type: 'event_payout',
      userId: participant.discord_id,
      amount: participant.payout_amount,
      reason: `Pagamento do evento ${event.event_code}`,
      referenceType: 'event',
      referenceId: String(event.id),
      createdBy: actorId
    });
  }
  repo.updateEvent(eventId, { status: 'approved' });
  const review = repo.getReview(eventId);
  if (review) {
    repo.upsertReview({
      eventId,
      lootTotal: review.loot_total,
      repair: review.repair,
      silverBags: review.silver_bags,
      taxPercent: review.tax_percent,
      netLoot: review.net_loot,
      status: 'approved'
    });
  }
  audit.createAuditLog({ type: 'event_payment_approved', actorId, targetId: String(eventId), reason: event.event_code });
});

async function deleteEventMessage(client, eventId) {
  const event = repo.getEvent(eventId);
  if (!event?.message_id) return;
  const channel = await client.channels.fetch(ids.channels.participate).catch(() => null);
  const message = await channel?.messages.fetch(event.message_id).catch(() => null);
  await message?.delete().catch(() => {});
}

function reviewEmbed(eventId) {
  const event = repo.getEvent(eventId);
  const review = repo.getReview(eventId);
  const participants = repo.listParticipants(eventId).filter((participant) => !participant.is_spectator);
  const lines = participants.map((participant) => {
    const seconds = participant.manual_seconds ?? participant.calculated_seconds ?? 0;
    return `<@${participant.discord_id}> | ${roleLabel(participant.role)} | ${formatDuration(seconds)} | ${formatSilver(participant.payout_amount)}`;
  });
  const help = event.status === 'pending_payment'
    ? 'Aguardando staff/tesoureiro/adm aprovar o pagamento.'
    : [
      'Editar membro: escolha alguem na lista e ajuste funcao/tempo.',
      'Adicionar membro: coloca alguem que faltou no split.',
      'Remover membro: escolha alguem na lista para tirar do split.',
      'Tempo sempre em minutos. Ex: 75 = 1h15min.'
    ].join('\n');

  return new EmbedBuilder()
    .setTitle(event.status === 'pending_payment' ? 'Pagamento pendente' : 'Revisao de participacao')
    .setDescription(`**${event.title}**\n${event.event_code}`)
    .addFields(
      { name: 'Loot liquido', value: formatSilver(review?.net_loot || 0), inline: true },
      { name: 'Como ajustar', value: help, inline: false },
      { name: 'Participantes', value: lines.length ? lines.slice(0, 20).join('\n') : 'Nenhum participante com tempo contabilizado.', inline: false }
    )
    .setColor(0xd69e2e)
    .setTimestamp(new Date());
}

function reviewComponents(eventId, mode = 'review') {
  if (mode === 'finance') {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`event:approve:${eventId}`).setLabel('Aprovar pagamento').setStyle(ButtonStyle.Success)
      )
    ];
  }

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`event_review:edit:${eventId}`).setLabel('Editar membro').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`event_review:add:${eventId}`).setLabel('Adicionar membro').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`event_review:remove:${eventId}`).setLabel('Remover membro').setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`event_review:submit:${eventId}`).setLabel('Enviar Financeiro').setStyle(ButtonStyle.Secondary)
    )
  ];
}

function formatDuration(seconds) {
  const value = Number(seconds || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m`;
}

function roleLabel(role) {
  const labels = {
    tank: 'Tank',
    healer: 'Healer',
    support: 'Suporte',
    dps: 'DPS',
    spectator: 'Espectador'
  };
  return labels[role] || role;
}

async function closeAllOpenSessions(eventId, leftAt) {
  const event = repo.getEvent(eventId);
  if (!event) return;
  const participants = repo.listParticipants(eventId);
  for (const participant of participants) {
    const open = repo.getOpenVoiceSession({ eventId, discordId: participant.discord_id });
    if (open) {
      const seconds = Math.max(0, Math.floor((Date.parse(leftAt) - Date.parse(open.joined_at)) / 1000));
      repo.closeOpenVoiceSession({ eventId, discordId: participant.discord_id, leftAt, seconds });
    }
  }
}

module.exports = {
  approveEventPayment,
  addParticipantReview,
  cancelEvent,
  createEventFromModal,
  deleteEventMessage,
  editParticipantReview,
  finishEvent,
  joinEvent,
  refreshEventMessage,
  removeParticipantReview,
  reviewComponents,
  reviewEmbed,
  saveLootReview,
  submitEventToFinance,
  spectateEvent,
  startEvent
};
