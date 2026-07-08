const { can } = require('../config/permissions');
const ids = require('../config/ids');
const events = require('../modules/events/events.service');
const eventsRepo = require('../modules/events/events.repository');
const registration = require('../modules/registration/registration.service');
const finance = require('../modules/finance/finance.service');
const { parseSilver, formatSilver } = require('../utils/silver');
const { safeSend, baseEmbed } = require('../utils/discord');
const { safeDeferReply, safeEditReply, safeReply } = require('../utils/interactions');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const financeRepo = require('../modules/finance/finance.repository');
const deposit = require('../modules/deposit/deposit.service');

function intField(fields, name) {
  const value = Number.parseInt(fields.getTextInputValue(name), 10);
  if (Number.isNaN(value) || value < 0) throw new Error(`Campo invalido: ${name}`);
  return value;
}

async function handleModal(interaction) {
  if (interaction.customId === 'campaign:donate_balance_modal') {
    const amount = parseSilver(interaction.fields.getTextInputValue('amount'));
    const balance = financeRepo.getBalance(interaction.user.id);
    if (amount <= 0) throw new Error('Informe um valor maior que zero.');
    if (balance <= 0) throw new Error('Voce nao tem saldo positivo para doar.');
    if (amount > balance) {
      throw new Error(`Voce tentou doar ${formatSilver(amount)}, mas seu saldo atual e ${formatSilver(balance)}.`);
    }
    return interaction.reply({
      content: [
        '**Confirmar doacao para @900m**',
        `Seu saldo atual: ${formatSilver(balance)}.`,
        `Valor da doacao: ${formatSilver(amount)}.`,
        `Saldo depois: ${formatSilver(balance - amount)}.`
      ].join('\n'),
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`campaign:confirm_balance_donation:${amount}:${interaction.user.id}`)
            .setLabel(`Confirmar ${formatSilver(amount)}`)
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`campaign:cancel_balance_donation:${interaction.user.id}`)
            .setLabel('Cancelar')
            .setStyle(ButtonStyle.Secondary)
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }
  if (
    interaction.customId.startsWith('member_panel:') ||
    interaction.customId.startsWith('member_panel_staff:') ||
    interaction.customId.startsWith('auction:') ||
    interaction.customId === 'poll:create'
  ) {
    return interaction.reply({
      content: 'Esse recurso foi pausado para simplificar o bot. Use os paineis principais de evento, saldo, registro ou ADM.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === 'event:create') {
    if (!can(interaction.member, 'createEvent')) {
      return safeReply(interaction, { content: 'Voce nao tem permissao para criar evento.', flags: MessageFlags.Ephemeral });
    }
    const acknowledged = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    if (!acknowledged) return null;
    const title = fieldOrDefault(interaction, 'title', 'DG Grupo T8+');
    const description = fieldOrDefault(interaction, 'description', 'T8 equivalente');
    const location = fieldOrDefault(interaction, 'location', 'Pergunte na Call');
    const scheduledTime = fieldOrDefault(interaction, 'scheduledTime', defaultAlbionTime(10));
    const slots = parseSlots(fieldOrDefault(interaction, 'slots', '1,1,1,3'));
    if (slots.length !== 4 || slots.some((value) => Number.isNaN(value) || value < 0)) {
      throw new Error('Use 4 numeros para vagas. Ex: 3,3,2,12 ou Tank 3 Healer 3 Sup 2 DPS 12.');
    }
    const event = await events.createEventFromModal(interaction, {
      title,
      description,
      location,
      scheduledTime,
      tankSlots: slots[0],
      healerSlots: slots[1],
      supportSlots: slots[2],
      dpsSlots: slots[3]
    });
    return safeEditReply(interaction, { content: `Evento ${event.event_code} criado.` });
  }

  if (interaction.customId === 'event:create_raid_full') {
    if (!can(interaction.member, 'createEvent')) {
      return safeReply(interaction, { content: 'Voce nao tem permissao para criar Raid Avalon Full.', flags: MessageFlags.Ephemeral });
    }
    const acknowledged = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    if (!acknowledged) return null;
    const event = await events.createRaidAvalonFullFromModal(interaction, {
      scheduledTime: fieldOrDefault(interaction, 'scheduledTime', defaultAlbionTime(10)),
      location: fieldOrDefault(interaction, 'location', 'Pergunte na Call'),
      dungeonTier: fieldOrDefault(interaction, 'dungeonTier', 'Nao informado'),
      buildTier: fieldOrDefault(interaction, 'buildTier', 'Nao informado')
    });
    return safeEditReply(interaction, { content: `Raid Avalon Full ${event.event_code} criada com 20 vagas.` });
  }

  if (interaction.customId.startsWith('event:raid_join:')) {
    const [, , eventIdText, role, weaponKey] = interaction.customId.split(':');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const itemPower = intField(interaction.fields, 'itemPower');
    const weaponName = weaponKey ? events.raidWeaponName(role, weaponKey) : interaction.fields.getTextInputValue('weapon');
    const weapon = await events.joinRaidAvalonRole(interaction, {
      eventId: Number(eventIdText),
      role,
      weapon: weaponName,
      itemPower
    });
    const buildUrl = events.raidWeaponBuildUrl(role, weaponKey || weapon);
    const buildText = buildUrl ? `\nLembrete da build: ${buildUrl}` : '';
    return interaction.editReply({ content: `Voce entrou na Raid Avalon Full como ${roleLabel(role)} usando ${weapon} IP ${itemPower}.${buildText}` });
  }

  if (interaction.customId === 'registration:submit') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const albionName = interaction.fields.getTextInputValue('albionName').trim();
    const registrationId = await registration.submitRegistration({ interaction, albionName });
    await safeSend(interaction.client, ids.channels.registrationRequests, {
      embeds: [
        baseEmbed('Registro pendente')
          .addFields(
            { name: 'Membro', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Albion', value: albionName, inline: true },
            { name: 'Registro', value: `#${registrationId}`, inline: true }
          )
      ]
      ,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`registration:member:${registrationId}`).setLabel('Aprovar Membro').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`registration:guest:${registrationId}`).setLabel('Manter Convidado').setStyle(ButtonStyle.Secondary)
        )
      ]
    });
    return interaction.editReply({ content: 'Registro enviado. Voce recebeu Convidado e a staff vai revisar.' });
  }

  if (interaction.customId.startsWith('event:loot:')) {
    const eventId = Number(interaction.customId.split(':')[2]);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const event = eventsRepo.getEvent(eventId);
    if (!event) throw new Error('Evento nao encontrado.');
    if (event.status === 'running') {
      await events.finishEvent(interaction, eventId);
    } else if (event.status !== 'review') {
      throw new Error('Este evento nao pode receber revisao de loot neste status.');
    }
    const result = events.saveLootReview({
      eventId,
      lootTotal: parseSilver(interaction.fields.getTextInputValue('lootTotal')),
      repair: parseSilver(interaction.fields.getTextInputValue('repair')),
      silverBags: parseSilver(interaction.fields.getTextInputValue('silverBags')),
      taxPercent: intField(interaction.fields, 'taxPercent'),
      evidenceNotes: interaction.fields.getTextInputValue('evidenceNotes').trim()
    });
    const reviewChannel = await events.createPostEventReviewSpace(interaction, eventId);
    return interaction.editReply({
      content: `Revisao criada em <#${reviewChannel.id}>. Loot liquido: ${formatSilver(result.netLoot)}. Anexe o CSV do loot logger nesse canal e ajuste a participacao antes de enviar ao financeiro.`
    });
  }

  if (interaction.customId.startsWith('event_review:')) {
    const [, action, eventIdRaw, messageId] = interaction.customId.split(':');
    const eventId = Number(eventIdRaw);
    const event = require('../modules/events/events.repository').getEvent(eventId);
    if (!event) throw new Error('Evento nao encontrado.');
    if (event.creator_id !== interaction.user.id && !can(interaction.member, 'assumeEvent')) {
      return interaction.reply({ content: 'Somente o criador ou alguem autorizado pode editar a revisao.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'edit_modal' || action === 'add_modal') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const targetId = cleanUserId(interaction.fields.getTextInputValue('userId'));
      const role = normalizeRole(interaction.fields.getTextInputValue('role'));
      const minutes = parseMinutes(interaction.fields.getTextInputValue('minutes'));
      const reason = interaction.fields.getTextInputValue('reason') || 'Ajuste manual de participacao';
      if (!targetId || Number.isNaN(minutes) || minutes < 0) throw new Error('Informe membro e tempo validos.');

      if (action === 'edit_modal') {
        events.editParticipantReview({ eventId, actorId: interaction.user.id, discordId: targetId, role, minutes, reason });
      } else {
        events.addParticipantReview({ eventId, actorId: interaction.user.id, discordId: targetId, role, minutes, reason });
      }
      await updateReviewMessage(interaction, eventId, messageId);
      return interaction.editReply({ content: 'Participacao atualizada e split recalculado.' });
    }

    if (action === 'remove_modal') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const targetId = cleanUserId(interaction.fields.getTextInputValue('userId'));
      const reason = interaction.fields.getTextInputValue('reason') || 'Removido da revisao';
      if (!targetId) throw new Error('Informe um membro valido.');
      events.removeParticipantReview({ eventId, actorId: interaction.user.id, discordId: targetId, reason });
      await updateReviewMessage(interaction, eventId, messageId);
      return interaction.editReply({ content: 'Participante removido e split recalculado.' });
    }
  }

  if (interaction.customId === 'finance:withdraw_modal') {
    const rawAmount = interaction.fields.getTextInputValue('amount');
    const amount = parseWithdrawAmount(rawAmount);
    const note = interaction.fields.getTextInputValue('note');
    const draft = finance.createWithdrawDraft({ userId: interaction.user.id, amount, note, rawAmount });
    const balance = financeRepo.getBalance(interaction.user.id);
    return interaction.reply({
      content: [
        'Confira seu pedido de saque antes de enviar para a staff:',
        `Digitado: \`${rawAmount}\``,
        `Valor do saque: **${formatSilver(amount)}**`,
        `Seu saldo atual: **${formatSilver(balance)}**`,
        'Confirma que esse valor esta correto?'
      ].join('\n'),
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`finance:confirm_withdraw:${draft.id}`).setLabel('Confirmar saque').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`finance:cancel_withdraw:${draft.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === 'finance:payment_request_modal') {
    const rawAmount = interaction.fields.getTextInputValue('amount');
    const amount = parseSilver(rawAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error('Valor de pedido invalido. Informe um valor maior que zero. Ex: 12m ou 12000000.');
    }
    const service = interaction.fields.getTextInputValue('service').trim();
    const description = interaction.fields.getTextInputValue('description').trim();
    const evidence = interaction.fields.getTextInputValue('evidence').trim();
    if (!service || !description) {
      throw new Error('Informe o que voce fez e o motivo/descricao do pedido.');
    }
    const draft = finance.createPaymentRequestDraft({
      userId: interaction.user.id,
      amount,
      service,
      description,
      evidence
    });
    return interaction.reply({
      content: [
        'Confira seu pedido de pagamento antes de enviar para a staff:',
        `Digitado: \`${rawAmount}\``,
        `Valor pedido: **${formatSilver(amount)}**`,
        `Servico: **${truncateText(service, 180)}**`,
        `Motivo: ${truncateText(description, 500)}`,
        evidence ? `Prova: ${truncateText(evidence, 300)}` : 'Prova: nao informada',
        '',
        'Confirma que esse pedido esta correto?'
      ].join('\n'),
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`finance:confirm_payment_request:${draft.id}`).setLabel('Enviar para staff').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`finance:cancel_payment_request:${draft.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === 'deposit:create_modal') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar deposito.', flags: MessageFlags.Ephemeral });
    }

    const draft = deposit.createDraft({
      actorId: interaction.user.id,
      lootTotal: parseSilver(interaction.fields.getTextInputValue('lootTotal')),
      repair: parseSilver(interaction.fields.getTextInputValue('repair')),
      silverBags: parseSilver(interaction.fields.getTextInputValue('silverBags')),
      taxPercent: intField(interaction.fields, 'taxPercent')
    });

    return interaction.reply({
      content: 'Deposito criado. Selecione os participantes abaixo usando a busca do Discord.',
      embeds: [deposit.draftEmbed(draft)],
      components: deposit.draftComponents(draft.id),
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === 'deposit:create_list_modal') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar deposito por lista.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const draft = await deposit.createListDraft({
      actorId: interaction.user.id,
      guild: interaction.guild,
      totalAmount: parseSilver(interaction.fields.getTextInputValue('totalAmount')),
      reason: fieldOrDefault(interaction, 'reason', 'Deposito por lista'),
      rawList: interaction.fields.getTextInputValue('names')
    });

    return interaction.editReply({
      content: 'Previa do deposito por lista. Confira nomes e valores antes de confirmar.',
      embeds: [deposit.listDraftEmbed(draft)],
      components: deposit.listDraftComponents(draft.id, draft.matched.length > 0)
    });
  }

  if (interaction.customId === 'admin:remove_balance_modal') {
    if (!can(interaction.member, 'withdrawBalance')) {
      return interaction.reply({ content: 'Voce nao tem permissao para retirar saldo.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const targetRaw = interaction.fields.getTextInputValue('userId').trim();
    const targetId = targetRaw.replace(/[<@!>]/g, '');
    const amount = Math.abs(parseSilver(interaction.fields.getTextInputValue('amount')));
    const reason = interaction.fields.getTextInputValue('reason').trim();
    const confirmation = interaction.fields.getTextInputValue('confirmation').trim();
    const before = financeRepo.getBalance(targetId);
    const after = before - amount;
    if (after < 0 && confirmation !== 'CONFIRMAR') {
      return interaction.editReply({ content: 'Essa retirada deixa saldo negativo. Digite CONFIRMAR no campo de confirmacao.' });
    }
    finance.applyBalanceTransaction({
      type: 'manual_remove',
      userId: targetId,
      amount: -amount,
      reason,
      referenceType: 'admin_panel',
      referenceId: null,
      createdBy: interaction.user.id
    });
    await finance.notifyBalanceTransactions({
      client: interaction.client,
      transactions: [{
        userId: targetId,
        amount: -amount,
        reason,
        afterBalance: after
      }]
    });
    await safeSend(interaction.client, ids.channels.bankLogs, {
      content: `Saldo retirado de <@${targetId}>: -${formatSilver(amount)} por <@${interaction.user.id}>. Motivo: ${reason}`
    });
    return interaction.editReply({ content: `Saldo retirado. Novo saldo: ${formatSilver(after)}.` });
  }
}

function cleanUserId(value) {
  return String(value || '').trim().replace(/[<@!>]/g, '');
}

function parseSlots(value) {
  const numbers = String(value || '').match(/\d+/g) || [];
  return numbers.slice(0, 4).map((number) => Number.parseInt(number, 10));
}

function fieldOrDefault(interaction, id, fallback) {
  const value = interaction.fields.getTextInputValue(id).trim();
  return value || fallback;
}

function defaultAlbionTime(minutesAhead) {
  const albionTime = new Date(Date.now() + minutesAhead * 60 * 1000);
  const hours = String(albionTime.getUTCHours()).padStart(2, '0');
  const minutes = String(albionTime.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const aliases = {
    t: 'tank',
    tanque: 'tank',
    tank: 'tank',
    tanks: 'tank',
    h: 'healer',
    healer: 'healer',
    healers: 'healer',
    heal: 'healer',
    healeres: 'healer',
    cura: 'healer',
    curandeiro: 'healer',
    curandeira: 'healer',
    s: 'support',
    suporte: 'support',
    suport: 'support',
    support: 'support',
    supports: 'support',
    sup: 'support',
    d: 'dps',
    dps: 'dps',
    dano: 'dps',
    damage: 'dps'
  };
  if (!aliases[role]) throw new Error('Funcao invalida. Exemplos aceitos: tank, tanque, healer, cura, sup, suporte, dps, dano.');
  return aliases[role];
}

function roleLabel(role) {
  const labels = {
    tank: 'Tank',
    healer: 'Healer',
    support: 'Suporte',
    dps: 'DPS'
  };
  return labels[role] || role;
}

function parseMinutes(value) {
  const text = String(value || '').trim().toLowerCase().replace(',', '.');
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*h/);
  const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*m/);
  if (hourMatch || minuteMatch) {
    return (hourMatch ? Number(hourMatch[1]) * 60 : 0) + (minuteMatch ? Number(minuteMatch[1]) : 0);
  }
  const minutes = Number.parseFloat(text);
  if (Number.isNaN(minutes)) throw new Error('Tempo invalido. Use minutos. Ex: 75 para 1h15min.');
  return minutes;
}

function parseWithdrawAmount(value) {
  const text = String(value || '').trim().replace(/\s+/g, '');
  if (!/^\d+$/.test(text)) {
    throw new Error('Valor de saque invalido. Digite somente numeros, sem ponto, virgula, letra ou simbolo. Ex: 1000000');
  }
  const amount = Number.parseInt(text, 10);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('Valor de saque invalido. Digite um numero inteiro maior que zero.');
  }
  return amount;
}

async function updateReviewMessage(interaction, eventId, messageId) {
  const message = messageId ? await interaction.channel?.messages.fetch(messageId).catch(() => null) : null;
  if (message) {
    await message.edit({
      embeds: [events.reviewEmbed(eventId)],
      components: events.reviewComponents(eventId, 'review')
    });
  }
}

module.exports = {
  handleModal
};

function truncateText(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}
