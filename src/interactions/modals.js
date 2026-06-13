const { can } = require('../config/permissions');
const ids = require('../config/ids');
const events = require('../modules/events/events.service');
const eventsRepo = require('../modules/events/events.repository');
const registration = require('../modules/registration/registration.service');
const finance = require('../modules/finance/finance.service');
const { parseSilver, formatSilver } = require('../utils/silver');
const { safeSend, baseEmbed } = require('../utils/discord');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const financeRepo = require('../modules/finance/finance.repository');
const deposit = require('../modules/deposit/deposit.service');
const polls = require('../modules/polls/polls.service');
const auctions = require('../modules/auctions/auctions.service');
const eventTemplates = require('../modules/eventTemplates/eventTemplates.service');

function intField(fields, name) {
  const value = Number.parseInt(fields.getTextInputValue(name), 10);
  if (Number.isNaN(value) || value < 0) throw new Error(`Campo invalido: ${name}`);
  return value;
}

async function handleModal(interaction) {
  if (interaction.customId.startsWith('event_template:create:')) {
    if (!can(interaction.member, 'createEvent')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar templates de evento.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const rawName = interaction.customId.split(':')[2];
    const template = eventTemplates.saveTemplateFromModal({ interaction, rawName });
    return interaction.editReply({
      content: `Template **${template.name}** salvo. Use \`/template_evento usar nome:${template.name} horario:20:00\`.`
    });
  }

  if (interaction.customId.startsWith('auction:create:')) {
    if (!can(interaction.member, 'createAuction')) {
      return interaction.reply({ content: 'Voce precisa ser membro para criar leilao.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [, , channelId, draftId] = interaction.customId.split(':');
    const draft = auctions.takeDraft(draftId);
    const itemName = interaction.fields.getTextInputValue('itemName').trim();
    const startingBid = parseSilver(interaction.fields.getTextInputValue('startingBid'));
    const minIncrement = parseSilver(interaction.fields.getTextInputValue('minIncrement'));
    const durationMs = auctions.parseDurationMs(fieldOrDefault(interaction, 'duration', '24h'));
    if (!itemName) throw new Error('Informe o nome do item.');
    if (startingBid <= 0) throw new Error('O lance inicial precisa ser maior que zero.');
    if (minIncrement <= 0) throw new Error('O incremento minimo precisa ser maior que zero.');
    const auction = await auctions.createAuctionFromModal(interaction, {
      itemName,
      startingBid,
      minIncrement,
      imageUrl: draft?.imageUrl,
      pickupInfo: fieldOrDefault(interaction, 'pickupInfo', ''),
      durationMs,
      channelId
    });
    return interaction.editReply({ content: `Leilao #${auction.id} criado no canal <#${channelId}>.` });
  }

  if (interaction.customId.startsWith('auction:bid_modal:')) {
    const auctionId = Number(interaction.customId.split(':')[2]);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const amount = parseSilver(interaction.fields.getTextInputValue('amount'));
    if (amount <= 0) throw new Error('O lance precisa ser maior que zero.');
    const auction = auctions.placeBid({ auctionId, userId: interaction.user.id, amount });
    await auctions.refreshAuctionMessage(interaction.client, auction);
    return interaction.editReply({ content: `Lance registrado: ${formatSilver(amount)}.` });
  }

  if (interaction.customId === 'poll:create') {
    if (!can(interaction.member, 'createPoll')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar enquete.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const poll = await polls.createPollFromModal(interaction);
    return interaction.editReply({ content: `Enquete #${poll.id} criada no canal de eventos.` });
  }

  if (interaction.customId === 'event:create') {
    if (!can(interaction.member, 'createEvent')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar evento.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const title = fieldOrDefault(interaction, 'title', 'FastContent');
    const description = fieldOrDefault(interaction, 'description', 'Pergunte na Call');
    const location = fieldOrDefault(interaction, 'location', 'Pergunte na Call');
    const scheduledTime = fieldOrDefault(interaction, 'scheduledTime', defaultUtcMinus3Time(10));
    const slots = parseSlots(fieldOrDefault(interaction, 'slots', '1,1,1,17'));
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
    return interaction.editReply({ content: `Evento ${event.event_code} criado.` });
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

function defaultUtcMinus3Time(minutesAhead) {
  const utcMinus3 = new Date(Date.now() + minutesAhead * 60 * 1000 - 3 * 60 * 60 * 1000);
  const hours = String(utcMinus3.getUTCHours()).padStart(2, '0');
  const minutes = String(utcMinus3.getUTCMinutes()).padStart(2, '0');
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
