const { can } = require('../config/permissions');
const ids = require('../config/ids');
const events = require('../modules/events/events.service');
const registration = require('../modules/registration/registration.service');
const finance = require('../modules/finance/finance.service');
const audit = require('../modules/audit/audit.repository');
const { parseSilver, formatSilver } = require('../utils/silver');
const { safeSend, baseEmbed } = require('../utils/discord');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const financeRepo = require('../modules/finance/finance.repository');
const deposit = require('../modules/deposit/deposit.service');

function intField(fields, name) {
  const value = Number.parseInt(fields.getTextInputValue(name), 10);
  if (Number.isNaN(value) || value < 0) throw new Error(`Campo invalido: ${name}`);
  return value;
}

async function handleModal(interaction) {
  if (interaction.customId === 'event:create') {
    if (!can(interaction.member, 'createEvent')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar evento.', ephemeral: true });
    }
    const slots = parseSlots(interaction.fields.getTextInputValue('slots'));
    if (slots.length !== 4 || slots.some((value) => Number.isNaN(value) || value < 0)) {
      throw new Error('Use 4 numeros para vagas. Ex: 3,3,2,12 ou Tank 3 Healer 3 Sup 2 DPS 12.');
    }
    const event = await events.createEventFromModal(interaction, {
      title: interaction.fields.getTextInputValue('title'),
      description: interaction.fields.getTextInputValue('description'),
      location: interaction.fields.getTextInputValue('location'),
      scheduledTime: interaction.fields.getTextInputValue('scheduledTime'),
      tankSlots: slots[0],
      healerSlots: slots[1],
      supportSlots: slots[2],
      dpsSlots: slots[3]
    });
    return interaction.reply({ content: `Evento ${event.event_code} criado.`, ephemeral: true });
  }

  if (interaction.customId === 'registration:submit') {
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
    return interaction.reply({ content: 'Registro enviado. Voce recebeu Convidado e a staff vai revisar.', ephemeral: true });
  }

  if (interaction.customId.startsWith('event:loot:')) {
    const eventId = Number(interaction.customId.split(':')[2]);
    await events.finishEvent(interaction, eventId);
    const result = events.saveLootReview({
      eventId,
      lootTotal: parseSilver(interaction.fields.getTextInputValue('lootTotal')),
      repair: parseSilver(interaction.fields.getTextInputValue('repair')),
      silverBags: parseSilver(interaction.fields.getTextInputValue('silverBags')),
      taxPercent: intField(interaction.fields, 'taxPercent')
    });
    await safeSend(interaction.client, ids.channels.finance, {
      content: `Evento #${eventId} em revisao. Loot liquido: ${formatSilver(result.netLoot)}.`,
      embeds: [events.reviewEmbed(eventId)],
      components: events.reviewComponents(eventId, 'review')
    });
    return interaction.reply({ content: `Revisao criada. Loot liquido: ${formatSilver(result.netLoot)}. Ajuste a participacao antes de enviar ao financeiro.`, ephemeral: true });
  }

  if (interaction.customId.startsWith('event_review:')) {
    const [, action, eventIdRaw, messageId] = interaction.customId.split(':');
    const eventId = Number(eventIdRaw);
    const event = require('../modules/events/events.repository').getEvent(eventId);
    if (!event) throw new Error('Evento nao encontrado.');
    if (event.creator_id !== interaction.user.id && !can(interaction.member, 'assumeEvent')) {
      return interaction.reply({ content: 'Somente o criador ou alguem autorizado pode editar a revisao.', ephemeral: true });
    }

    if (action === 'edit_modal' || action === 'add_modal') {
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
      return interaction.reply({ content: 'Participacao atualizada e split recalculado.', ephemeral: true });
    }

    if (action === 'remove_modal') {
      const targetId = cleanUserId(interaction.fields.getTextInputValue('userId'));
      const reason = interaction.fields.getTextInputValue('reason') || 'Removido da revisao';
      if (!targetId) throw new Error('Informe um membro valido.');
      events.removeParticipantReview({ eventId, actorId: interaction.user.id, discordId: targetId, reason });
      await updateReviewMessage(interaction, eventId, messageId);
      return interaction.reply({ content: 'Participante removido e split recalculado.', ephemeral: true });
    }
  }

  if (interaction.customId === 'finance:withdraw_modal') {
    const amount = parseSilver(interaction.fields.getTextInputValue('amount'));
    const note = interaction.fields.getTextInputValue('note');
    const request = finance.requestWithdraw({ userId: interaction.user.id, amount, note });
    audit.createAuditLog({ type: 'withdraw_requested', actorId: interaction.user.id, targetId: interaction.user.id, afterValue: amount, reason: note });
    await safeSend(interaction.client, ids.channels.finance, {
      content: `Saque solicitado: #${request.lastInsertRowid} por <@${interaction.user.id}> no valor de ${formatSilver(amount)}.`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`finance:approve_withdraw:${request.lastInsertRowid}`).setLabel('Aprovar saque').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`finance:pay_withdraw:${request.lastInsertRowid}`).setLabel('Pagar saque').setStyle(ButtonStyle.Primary)
        )
      ]
    });
    return interaction.reply({ content: `Saque solicitado: ${formatSilver(amount)}.`, ephemeral: true });
  }

  if (interaction.customId === 'deposit:create_modal') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar deposito.', ephemeral: true });
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
      ephemeral: false
    });
  }

  if (interaction.customId === 'admin:remove_balance_modal') {
    if (!can(interaction.member, 'withdrawBalance')) {
      return interaction.reply({ content: 'Voce nao tem permissao para retirar saldo.', ephemeral: true });
    }
    const targetRaw = interaction.fields.getTextInputValue('userId').trim();
    const targetId = targetRaw.replace(/[<@!>]/g, '');
    const amount = Math.abs(parseSilver(interaction.fields.getTextInputValue('amount')));
    const reason = interaction.fields.getTextInputValue('reason').trim();
    const confirmation = interaction.fields.getTextInputValue('confirmation').trim();
    const before = financeRepo.getBalance(targetId);
    const after = before - amount;
    if (after < 0 && confirmation !== 'CONFIRMAR') {
      return interaction.reply({ content: 'Essa retirada deixa saldo negativo. Digite CONFIRMAR no campo de confirmacao.', ephemeral: true });
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
    await safeSend(interaction.client, ids.channels.bankLogs, {
      content: `Saldo retirado de <@${targetId}>: -${formatSilver(amount)} por <@${interaction.user.id}>. Motivo: ${reason}`
    });
    return interaction.reply({ content: `Saldo retirado. Novo saldo: ${formatSilver(after)}.`, ephemeral: true });
  }
}

function cleanUserId(value) {
  return String(value || '').trim().replace(/[<@!>]/g, '');
}

function parseSlots(value) {
  const numbers = String(value || '').match(/\d+/g) || [];
  return numbers.slice(0, 4).map((number) => Number.parseInt(number, 10));
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
