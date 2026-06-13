const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
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
  { label: '🛡️ Tank', value: 'tank' },
  { label: '💚 Healer', value: 'healer' },
  { label: '🌀 Suporte', value: 'support' },
  { label: '⚔️ DPS', value: 'dps' }
];

function eventEmbed(event, participants = []) {
  const count = (role) => participants.filter((p) => p.role === role && !p.is_spectator).length;
  const elapsed = event.started_at ? formatDuration(Math.floor((Date.now() - Date.parse(event.started_at)) / 1000)) : '0m';
  const embed = new EmbedBuilder()
    .setTitle(event.title)
    .setColor(event.status === 'running' ? 0x38a169 : event.status === 'cancelled' ? 0xe53e3e : 0x3182ce)
    .setTimestamp(new Date());

  if (event.status === 'running') {
    return embed
      .setDescription(`**${event.description || 'Evento em andamento'}**\nEm andamento | ${event.location || 'Local nao informado'} | ${event.scheduled_time || 'Horario nao informado'}`)
      .addFields(
        { name: 'Tempo em andamento', value: elapsed, inline: true },
        { name: 'Vagas', value: `${roleLabel('tank')} ${count('tank')}/${event.tank_slots} | ${roleLabel('healer')} ${count('healer')}/${event.healer_slots} | ${roleLabel('support')} ${count('support')}/${event.support_slots} | ${roleLabel('dps')} ${count('dps')}/${event.dps_slots}`, inline: false },
        { name: 'Participantes', value: runningParticipantsSummary(participants), inline: false },
        { name: 'Voz', value: event.voice_channel_id ? `<#${event.voice_channel_id}>` : 'Sala em criacao', inline: true },
        { name: 'Criador', value: `<@${event.creator_id}>`, inline: true }
      );
  }

  return embed
    .setDescription(`**${event.description || 'Sem descricao.'}**`)
    .addFields(
      { name: 'Status', value: event.status, inline: true },
      { name: 'Local', value: event.location || 'Nao informado', inline: true },
      { name: 'Horario UTC-3', value: event.scheduled_time || 'Nao informado', inline: true },
      { name: roleLabel('tank'), value: roleOccupants(participants, 'tank', event.tank_slots), inline: false },
      { name: roleLabel('healer'), value: roleOccupants(participants, 'healer', event.healer_slots), inline: false },
      { name: roleLabel('support'), value: roleOccupants(participants, 'support', event.support_slots), inline: false },
      { name: roleLabel('dps'), value: roleOccupants(participants, 'dps', event.dps_slots), inline: false },
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

function runningParticipantsSummary(participants) {
  const order = { tank: 1, healer: 2, support: 3, dps: 4, spectator: 5 };
  const lines = participants
    .slice()
    .sort((a, b) => (order[a.role] || 99) - (order[b.role] || 99))
    .map((participant) => {
      const role = participant.is_spectator ? 'spectator' : participant.role;
      return `<@${participant.discord_id}> - ${roleLabel(role)}`;
    });

  if (lines.length === 0) return 'Nenhum participante ainda.';

  const visible = [];
  let totalLength = 0;
  for (const line of lines) {
    const nextLength = totalLength + line.length + (visible.length > 0 ? 1 : 0);
    if (nextLength > 950) break;
    visible.push(line);
    totalLength = nextLength;
  }

  const hidden = lines.length - visible.length;
  if (hidden > 0) visible.push(`... e mais ${hidden}`);
  return visible.join('\n');
}

function eventComponents(event) {
  if (!['created', 'running'].includes(event.status)) return [];

  const rows = [];
  if (event.status === 'created') {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`event:join:${event.id}`)
        .setPlaceholder('Participar como...')
        .addOptions(roles)
    ));
  }

  const buttons = event.status === 'running'
    ? [
      new ButtonBuilder().setCustomId(`event:auto_join:${event.id}`).setLabel('Quero participar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`event:spectate:${event.id}`).setLabel('Assistir').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`event:pause:${event.id}`).setLabel('Pausar participação').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`event:finish:${event.id}`).setLabel('Finalizar').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`event:cancel:${event.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
    ]
    : [
      new ButtonBuilder().setCustomId(`event:start:${event.id}`).setLabel('Iniciar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`event:cancel:${event.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
    ];

  rows.push(new ActionRowBuilder().addComponents(buttons));
  return rows;
}

async function createEventFromModal(interaction, fields) {
  return createEventFromFields(interaction, {
    creatorId: interaction.user.id,
    ...fields
  });
}

async function createEventFromFields(interaction, fields) {
  const event = repo.createEvent({
    creatorId: fields.creatorId || interaction.user.id,
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

async function refreshRunningEventMessages(client) {
  const events = repo.listActiveEvents();
  for (const event of events) {
    await refreshEventMessage(client, event.id).catch((error) => console.error(`Falha ao atualizar ${event.event_code}:`, error));
  }
}

async function joinEvent(interaction, eventId, role) {
  const event = repo.getEvent(eventId);
  if (!event || ['cancelled', 'approved'].includes(event.status)) throw new Error('Evento indisponivel.');
  repo.upsertParticipant({ eventId, discordId: interaction.user.id, role, isSpectator: 0 });
  audit.createAuditLog({ type: 'event_joined', actorId: interaction.user.id, targetId: String(eventId), afterValue: role });
  if (event.status === 'running') {
    await moveMemberToEventVoice(interaction, event);
  }
  await refreshEventMessage(interaction.client, eventId);
}

async function pauseParticipation(interaction, eventId) {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'running') throw new Error('Evento nao esta em andamento.');
  const participant = repo.getParticipant({ eventId, discordId: interaction.user.id });
  if (!participant || participant.is_spectator) throw new Error('Voce nao esta participando deste evento.');
  const now = new Date().toISOString();
  closeParticipantOpenSession(eventId, interaction.user.id, now);
  repo.refreshParticipantSeconds(eventId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const waiting = await interaction.guild.channels.fetch(ids.channels.waitingVoice).catch(() => null);
  if (member?.voice?.channelId === event.voice_channel_id && waiting) {
    await member.voice.setChannel(waiting).catch(() => {});
  }
  audit.createAuditLog({ type: 'event_participation_paused', actorId: interaction.user.id, targetId: String(eventId), reason: 'Pausa manual' });
  await refreshEventMessage(interaction.client, eventId);
}

async function spectateEvent(interaction, eventId) {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'running') throw new Error('Evento nao esta em andamento.');
  repo.upsertParticipant({ eventId, discordId: interaction.user.id, role: 'spectator', isSpectator: 1 });
  audit.createAuditLog({ type: 'event_spectator', actorId: interaction.user.id, targetId: String(eventId) });
  await moveMemberToEventVoice(interaction, event);
  await refreshEventMessage(interaction.client, eventId);
}

async function autoJoinRunningEvent(interaction, eventId) {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'running') throw new Error('Evento nao esta em andamento.');
  const existing = repo.getParticipant({ eventId, discordId: interaction.user.id });
  const role = existing && !existing.is_spectator ? existing.role : firstAvailableRole(event, repo.listParticipants(eventId));
  if (!role) throw new Error('Nao ha vagas livres neste evento. Use Assistir se quiser acompanhar.');
  await joinEvent(interaction, eventId, role);
  return role;
}

function firstAvailableRole(event, participants) {
  const order = [
    ['tank', event.tank_slots],
    ['healer', event.healer_slots],
    ['support', event.support_slots],
    ['dps', event.dps_slots]
  ];
  for (const [role, slots] of order) {
    const used = participants.filter((participant) => participant.role === role && !participant.is_spectator).length;
    if (used < slots) return role;
  }
  return null;
}

async function moveMemberToEventVoice(interaction, event) {
  if (!event.voice_channel_id) return { moved: false, reason: 'missing_voice' };
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member?.voice?.channel) return { moved: false, reason: 'not_in_voice' };
  await member.voice.setChannel(event.voice_channel_id).catch(() => {});
  return { moved: true };
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
  const startedEvent = repo.getEvent(eventId);
  await deleteWarningMessage(interaction.client, startedEvent).catch(() => {});
  await removeWarningRole(interaction.guild, startedEvent).catch(() => {});
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
  const reviewedEvent = repo.getEvent(eventId);
  await deleteWarningMessage(interaction.client, reviewedEvent).catch(() => {});
  await removeWarningRole(interaction.guild, reviewedEvent).catch(() => {});

  audit.createAuditLog({ type: 'event_finished', actorId: interaction.user.id, targetId: String(eventId) });
  await deleteEventMessage(interaction.client, eventId);
}

async function cancelEvent(interaction, eventId, reason) {
  const event = repo.getEvent(eventId);
  if (!event) throw new Error('Evento nao encontrado.');
  repo.updateEvent(eventId, { status: 'cancelled', cancel_reason: reason });
  const voice = event.voice_channel_id ? await interaction.guild.channels.fetch(event.voice_channel_id).catch(() => null) : null;
  await voice?.delete(`Evento cancelado: ${reason}`).catch(() => {});
  await deleteWarningMessage(interaction.client, event).catch(() => {});
  await removeWarningRole(interaction.guild, event).catch(() => {});
  audit.createAuditLog({ type: 'event_cancelled', actorId: interaction.user.id, targetId: String(eventId), reason });
  await deleteEventMessage(interaction.client, eventId);
}

function saveLootReview({ eventId, lootTotal, repair, silverBags, taxPercent, evidenceNotes }) {
  const netLoot = calculateNetLoot({ lootTotal, repair, silverBags, taxPercent });
  repo.refreshParticipantSeconds(eventId);

  transaction(() => {
    repo.upsertReview({ eventId, lootTotal, repair, silverBags, taxPercent, netLoot, status: 'review' });
    repo.updateReviewMetadata(eventId, { evidence_notes: evidenceNotes || null });
    recalculatePayouts(eventId);
    repo.updateEvent(eventId, { status: 'review' });
  })();

  audit.createAuditLog({
    type: 'event_review_submitted',
    targetId: String(eventId),
    afterValue: formatSilver(netLoot),
    metadata: { lootTotal, repair, silverBags, taxPercent, evidenceNotes }
  });
  return { netLoot };
}

async function createPostEventReviewSpace(interaction, eventId) {
  const event = repo.getEvent(eventId);
  if (!event) throw new Error('Evento nao encontrado.');
  const reviewChannel = await createReviewChannel(interaction.guild, eventId);
  repo.updateReviewMetadata(eventId, {
    review_channel_id: reviewChannel.id
  });
  await reviewChannel.send({
    content: [
      `Revisao do evento ${event.event_code}.`,
      'Anexe aqui o CSV do loot logger e prints complementares se precisar.',
      'Depois ajuste a participacao e clique em Enviar Financeiro.'
    ].join('\n'),
    embeds: [reviewEmbed(eventId)],
    components: reviewComponents(eventId, 'review')
  });
  return reviewChannel;
}

async function createReviewChannel(guild, eventId) {
  const event = repo.getEvent(eventId);
  const participants = repo.listParticipants(eventId).filter((participant) => !participant.is_spectator);
  const creator = await guild.members.fetch(event.creator_id).catch(() => null);
  const creatorName = creator?.displayName || `criador-${event.creator_id.slice(-4)}`;
  const name = reviewChannelName(creatorName, event.scheduled_time || event.event_code);
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    ...reviewStaffRoleIds().map((roleId) => ({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    })),
    {
      id: event.creator_id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    },
    ...participants.map((participant) => ({
      id: participant.discord_id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    }))
  ];

  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: ids.categories.activeEvents,
    permissionOverwrites: dedupeOverwrites(overwrites),
    reason: `Revisao do evento ${event.event_code}`
  });
}

async function postDpsMeterSummary(client, eventId) {
  const channel = await client.channels.fetch(ids.channels.dpsMeter).catch(() => null);
  if (!channel) return null;
  const participants = repo.listParticipants(eventId).filter((participant) => !participant.is_spectator);
  const mentions = participants.map((participant) => `<@${participant.discord_id}>`).join(' ');
  const message = await channel.send({
    content: mentions || undefined,
    embeds: [dpsMeterEmbed(eventId)],
    allowedMentions: { users: participants.map((participant) => participant.discord_id) }
  });
  repo.updateReviewMetadata(eventId, { dps_message_id: message.id });
  return message;
}

async function moveReviewChannelToClosed(client, eventId) {
  const review = repo.getReview(eventId);
  if (!review?.review_channel_id) return null;
  const channel = await client.channels.fetch(review.review_channel_id).catch(() => null);
  if (!channel) return null;
  await channel.setParent(ids.categories.closedEvents, { lockPermissions: false }).catch(() => {});
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone.id, { ViewChannel: false }).catch(() => {});
  return channel;
}

async function scheduleReviewChannelDeletion(client, eventId, hours = 14) {
  const review = repo.getReview(eventId);
  if (!review?.review_channel_id) return;
  const deleteAfter = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  repo.updateReviewMetadata(eventId, { review_channel_delete_after: deleteAfter });
  await cleanupExpiredReviewChannels(client);
}

async function cleanupExpiredReviewChannels(client) {
  const expired = repo.listExpiredReviewChannels(new Date().toISOString());
  for (const review of expired) {
    const channel = await client.channels.fetch(review.review_channel_id).catch(() => null);
    await channel?.delete(`Revisao ${review.event_code} expirada apos aprovacao financeira`).catch(() => {});
    repo.updateReviewMetadata(review.event_id, {
      review_channel_id: null,
      review_channel_delete_after: null
    });
  }
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
  const transactions = [];
  for (const participant of participants) {
    const item = {
      type: 'event_payout',
      userId: participant.discord_id,
      amount: participant.payout_amount,
      reason: `Pagamento do evento ${event.event_code}`,
      referenceType: 'event',
      referenceId: String(event.id),
      createdBy: actorId
    };
    const result = finance.applyBalanceTransaction(item);
    transactions.push(result);
  }
  repo.updateEvent(eventId, { status: 'approved' });
  repo.markReviewApproved({ eventId, approvedBy: actorId });
  audit.createAuditLog({ type: 'event_payment_approved', actorId, targetId: String(eventId), reason: event.event_code });
  return transactions;
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
  repo.refreshParticipantSeconds(eventId);
  const participants = repo.listParticipants(eventId).filter((participant) => !participant.is_spectator);
  const lines = participants.map((participant) => {
    const seconds = participant.manual_seconds ?? participant.calculated_seconds ?? 0;
    return `<@${participant.discord_id}> | ${roleLabel(participant.role)} | ${formatDuration(seconds)} | ${formatSilver(participant.payout_amount)}`;
  });
  const finalizedBy = review?.approved_by ? `<@${review.approved_by}>` : 'desconhecido';
  const help = event.status === 'approved'
    ? `Finalizado por ${finalizedBy}.`
    : event.status === 'pending_payment'
    ? 'Aguardando staff/tesoureiro/adm aprovar o pagamento.'
    : [
      'Editar membro: escolha alguem na lista e ajuste funcao/tempo.',
      'Adicionar membro: coloca alguem que faltou no split.',
      'Remover membro: escolha alguem na lista para tirar do split.',
      'Tempo sempre em minutos. Ex: 75 = 1h15min.'
    ].join('\n');

  return new EmbedBuilder()
    .setTitle(event.status === 'approved' ? 'Evento finalizado' : event.status === 'pending_payment' ? 'Pagamento pendente' : 'Revisao de participacao')
    .setDescription(`**${event.title}**\n${event.event_code}`)
    .addFields(
      { name: 'Loot liquido', value: formatSilver(review?.net_loot || 0), inline: true },
      { name: 'Evidencias', value: review?.evidence_notes || 'Anexe/cole DPS meter, fama total e CSV do loot logger no canal de revisao.', inline: false },
      { name: event.status === 'approved' ? 'Status' : 'Como ajustar', value: help, inline: false },
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

function dpsMeterEmbed(eventId) {
  const event = repo.getEvent(eventId);
  const review = repo.getReview(eventId);
  repo.refreshParticipantSeconds(eventId);
  const participants = repo.listParticipants(eventId).filter((participant) => !participant.is_spectator);
  const lines = participants.map((participant) => {
    const seconds = participant.manual_seconds ?? participant.calculated_seconds ?? 0;
    return `<@${participant.discord_id}> | ${roleLabel(participant.role)} | ${formatDuration(seconds)}`;
  });
  return new EmbedBuilder()
    .setTitle(`Resumo DPS/Fama - ${event.title}`)
    .setDescription(event.event_code)
    .addFields(
      { name: 'Criador', value: `<@${event.creator_id}>`, inline: true },
      { name: 'Horario', value: event.scheduled_time || 'Nao informado', inline: true },
      { name: 'Loot liquido', value: formatSilver(review?.net_loot || 0), inline: true },
      { name: 'Evidencias', value: review?.evidence_notes || 'Aguardando prints/links/CSV no canal de revisao.', inline: false },
      { name: 'Participantes', value: lines.length ? lines.slice(0, 30).join('\n') : 'Nenhum participante.', inline: false }
    )
    .setColor(0x805ad5)
    .setTimestamp(new Date());
}

function reviewChannelName(creatorName, timeText) {
  const raw = `${creatorName}-${timeText}`.toLowerCase();
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'evento-pendente';
}

function reviewStaffRoleIds() {
  return [ids.roles.staff, ids.roles.adm, ids.roles.treasurer].filter(Boolean);
}

function dedupeOverwrites(overwrites) {
  const seen = new Set();
  return overwrites.filter((overwrite) => {
    if (!overwrite.id || seen.has(overwrite.id)) return false;
    seen.add(overwrite.id);
    return true;
  });
}

function roleLabel(role) {
  const labels = {
    tank: '🛡️ Tank',
    healer: '💚 Healer',
    support: '🌀 Suporte',
    dps: '⚔️ DPS',
    spectator: 'Espectador'
  };
  return labels[role] || role;
}

async function closeAllOpenSessions(eventId, leftAt) {
  const event = repo.getEvent(eventId);
  if (!event) return;
  const participants = repo.listParticipants(eventId);
  for (const participant of participants) {
    closeParticipantOpenSession(eventId, participant.discord_id, leftAt);
  }
}

function closeParticipantOpenSession(eventId, discordId, leftAt) {
  const open = repo.getOpenVoiceSession({ eventId, discordId });
  if (open) {
    const seconds = Math.max(0, Math.floor((Date.parse(leftAt) - Date.parse(open.joined_at)) / 1000));
    repo.closeOpenVoiceSession({ eventId, discordId, leftAt, seconds });
  }
}

async function checkEventStartWarnings(client) {
  const events = repo.listPendingWarningEvents();
  for (const event of events) {
    const startAt = parseUtcMinus3EventTime(event.scheduled_time);
    if (!startAt) continue;
    const msUntilStart = startAt.getTime() - Date.now();
    if (msUntilStart > 60000 || msUntilStart < -60000) continue;
    await sendEventStartWarning(client, event).catch((error) => console.error(`Falha ao avisar ${event.event_code}:`, error));
  }
}

async function sendEventStartWarning(client, event) {
  const guild = await client.guilds.fetch(ids.guildId);
  const participants = repo.listParticipants(event.id).filter((participant) => !participant.is_spectator);
  if (participants.length === 0) {
    repo.updateEvent(event.id, { warning_sent: 1 });
    return;
  }

  const role = await guild.roles.create({
    name: `Evento ${event.event_code}`,
    mentionable: true,
    reason: `Aviso temporario do evento ${event.event_code}`
  });

  for (const participant of participants) {
    const member = await guild.members.fetch(participant.discord_id).catch(() => null);
    await member?.roles.add(role).catch(() => {});
  }

  const channel = await client.channels.fetch(ids.channels.participate);
  const message = await channel.send(`${role} falta 1 minuto para o evento **${event.title}** começar. O evento nao inicia automaticamente; aguardem o criador iniciar.`);
  repo.updateEvent(event.id, { warning_role_id: role.id, warning_message_id: message.id, warning_sent: 1 });
  audit.createAuditLog({ type: 'event_start_warning_sent', targetId: String(event.id), afterValue: role.id, reason: event.event_code });
}

async function deleteWarningMessage(client, event) {
  if (!event?.warning_message_id) return;
  const channel = await client.channels.fetch(ids.channels.participate).catch(() => null);
  const message = await channel?.messages.fetch(event.warning_message_id).catch(() => null);
  await message?.delete().catch(() => {});
  repo.updateEvent(event.id, { warning_message_id: null });
}

async function removeWarningRole(guild, event) {
  if (!event?.warning_role_id) return;
  const role = await guild.roles.fetch(event.warning_role_id).catch(() => null);
  await role?.delete(`Removendo cargo temporario do evento ${event.event_code}`).catch(() => {});
  repo.updateEvent(event.id, { warning_role_id: null });
}

function parseUtcMinus3EventTime(value) {
  const text = String(value || '').trim();
  const match = text.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const now = new Date();
  const utcMinus3Now = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const year = utcMinus3Now.getUTCFullYear();
  const month = utcMinus3Now.getUTCMonth();
  const day = utcMinus3Now.getUTCDate();
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const startUtc = new Date(Date.UTC(year, month, day, hour + 3, minute, 0));
  return startUtc;
}

module.exports = {
  approveEventPayment,
  addParticipantReview,
  autoJoinRunningEvent,
  cancelEvent,
  checkEventStartWarnings,
  cleanupExpiredReviewChannels,
  createPostEventReviewSpace,
  createEventFromFields,
  createEventFromModal,
  deleteEventMessage,
  editParticipantReview,
  finishEvent,
  joinEvent,
  pauseParticipation,
  postDpsMeterSummary,
  refreshEventMessage,
  refreshRunningEventMessages,
  removeParticipantReview,
  reviewComponents,
  reviewEmbed,
  saveLootReview,
  scheduleReviewChannelDeletion,
  moveReviewChannelToClosed,
  submitEventToFinance,
  spectateEvent,
  startEvent
};
