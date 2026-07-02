const { ActionRowBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const events = require('../modules/events/events.service');
const eventsRepo = require('../modules/events/events.repository');
const deposit = require('../modules/deposit/deposit.service');
const operations = require('../modules/operations/operations.service');
const { can } = require('../config/permissions');

async function handleSelect(interaction) {
  const [scope, action, id, messageId] = interaction.customId.split(':');
  if (['auction_channel_select', 'faq_tutorial', 'poll'].includes(scope)) {
    return pausedFeatureReply(interaction);
  }

  if (scope === 'faq_tutorial' && action === 'select') {
    return faq.handleTutorialSelect(interaction);
  }

  if (scope === 'auction_channel_select') {
    if (!can(interaction.member, 'createAuction')) {
      return interaction.reply({ content: 'Voce precisa ser membro para criar leilao.', flags: MessageFlags.Ephemeral });
    }
    const channelId = interaction.values[0];
    return showModal(interaction, `auction:create:${channelId}:${id}`, 'Criar Leilao', [
      input('itemName', 'Item'),
      input('startingBid', 'Lance inicial', '', 'Ex: 10m'),
      input('minIncrement', 'Incremento minimo', '', 'Ex: 500k'),
      input('duration', 'Tempo limite', '', 'Padrao: 24h. Ex: 12h, 2d, 90min', false),
      input('pickupInfo', 'Retirada: local e responsavel', '', 'Ex: Bau da ilha da guild. Pegar com @Lucas', false).setStyle(TextInputStyle.Paragraph)
    ]);
  }

  if (scope === 'event' && action === 'join') {
    const role = interaction.values[0];
    try {
      await events.joinEvent(interaction, Number(id), role);
    } catch (error) {
      if (String(error.message || '').includes('Nao ha vaga')) {
        return interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
      }
      throw error;
    }
    return interaction.reply({ content: `Voce entrou como ${roleLabel(role)}.`, flags: MessageFlags.Ephemeral });
  }

  if (scope === 'event_raid_weapon_select' && action === 'weapon') {
    const role = messageId;
    const weaponKey = interaction.values[0];
    const weapon = events.raidWeaponName(role, weaponKey);
    return showModal(interaction, `event:raid_join:${id}:${role}:${weaponKey}`, `Raid Full - ${weapon}`, [
      input('itemPower', 'IP da arma', '', 'Ex: 1500')
    ]);
  }

  if (scope === 'event_raid_weapon_select' && action === 'slot') {
    const [role, weaponKey] = interaction.values[0].split('|');
    const weapon = events.raidWeaponName(role, weaponKey);
    return showModal(interaction, `event:raid_join:${id}:${role}:${weaponKey}`, `Raid Full - ${weapon}`, [
      input('itemPower', 'IP da arma', '', 'Ex: 1500')
    ]);
  }

  if (scope === 'poll' && action === 'vote') {
    const selected = await polls.vote({ interaction, pollId: Number(id), options: interaction.values });
    return interaction.reply({
      content: selected.length ? `Seu voto agora: ${selected.join(', ')}.` : 'Seu voto foi limpo.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (scope === 'event_review_select') {
    const eventId = Number(id);
    const event = eventsRepo.getEvent(eventId);
    if (!event) throw new Error('Evento nao encontrado.');
    if (event.creator_id !== interaction.user.id && !can(interaction.member, 'assumeEvent')) {
      return interaction.reply({ content: 'Somente o criador ou alguem autorizado pode editar a revisao.', flags: MessageFlags.Ephemeral });
    }

    const discordId = interaction.values[0];
    const participant = eventsRepo.getParticipant({ eventId, discordId });
    if (!participant) throw new Error('Participante nao encontrado.');

    if (action === 'edit') {
      const seconds = participant.manual_seconds ?? participant.calculated_seconds ?? 0;
      return showModal(interaction, `event_review:edit_modal:${eventId}:${messageId}`, 'Editar membro do split', [
        input('userId', 'Membro', discordId),
        input('role', 'Funcao', roleLabel(participant.role), 'Ex: tank, healer, sup, dps'),
        input('minutes', 'Tempo contado em minutos', String(Math.round(seconds / 60)), 'Ex: 75 para 1h15min'),
        input('reason', 'Motivo do ajuste', '', 'Ex: caiu da call e voltou', false)
      ]);
    }

    if (action === 'remove') {
      return showModal(interaction, `event_review:remove_modal:${eventId}:${messageId}`, 'Remover membro do split', [
        input('userId', 'Membro', discordId),
        input('reason', 'Motivo da remocao', '', 'Ex: estava como espectador', false)
      ]);
    }
  }

  if (scope === 'event_review_user_select') {
    const eventId = Number(id);
    const event = eventsRepo.getEvent(eventId);
    if (!event) throw new Error('Evento nao encontrado.');
    if (event.creator_id !== interaction.user.id && !can(interaction.member, 'assumeEvent')) {
      return interaction.reply({ content: 'Somente o criador ou alguem autorizado pode editar a revisao.', flags: MessageFlags.Ephemeral });
    }

    const discordId = interaction.values[0];

    if (action === 'add') {
      return showModal(interaction, `event_review:add_modal:${eventId}:${messageId}`, 'Adicionar membro ao split', [
        input('userId', 'Membro', discordId),
        input('role', 'Funcao', '', 'Ex: tank, healer, sup, dps'),
        input('minutes', 'Tempo contado em minutos', '', 'Ex: 75 para 1h15min'),
        input('reason', 'Motivo da inclusao', '', 'Ex: entrou depois e nao clicou participar', false)
      ]);
    }

    const participant = eventsRepo.getParticipant({ eventId, discordId });
    if (!participant) {
      return interaction.reply({
        content: 'Esse membro ainda nao esta no split. Use Adicionar membro para colocar ele na revisao.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (action === 'edit') {
      const seconds = participant.manual_seconds ?? participant.calculated_seconds ?? 0;
      return showModal(interaction, `event_review:edit_modal:${eventId}:${messageId}`, 'Editar membro do split', [
        input('userId', 'Membro', discordId),
        input('role', 'Funcao', roleLabel(participant.role), 'Ex: tank, healer, sup, dps'),
        input('minutes', 'Tempo contado em minutos', String(Math.round(seconds / 60)), 'Ex: 75 para 1h15min'),
        input('reason', 'Motivo do ajuste', '', 'Ex: caiu da call e voltou', false)
      ]);
    }

    if (action === 'remove') {
      return showModal(interaction, `event_review:remove_modal:${eventId}:${messageId}`, 'Remover membro do split', [
        input('userId', 'Membro', discordId),
        input('reason', 'Motivo da remocao', '', 'Ex: estava como espectador', false)
      ]);
    }
  }

  if (scope === 'admin_remove_balance_select') {
    if (!can(interaction.member, 'withdrawBalance')) {
      return interaction.reply({ content: 'Sem permissao para retirar saldo.', flags: MessageFlags.Ephemeral });
    }

    const discordId = interaction.values[0];
    return showModal(interaction, 'admin:remove_balance_modal', 'Retirar Saldo', [
      input('userId', 'Membro', discordId),
      input('amount', 'Valor', '', 'Ex: 1000000 ou 1m'),
      input('reason', 'Motivo', '', 'Ex: saque pago, ajuste manual'),
      input('confirmation', 'CONFIRMAR se ficar negativo', '', 'Digite CONFIRMAR se o saldo ficar negativo', false)
    ]);
  }

  if (scope === 'admin_profile_select') {
    if (!can(interaction.member, 'approveRegistration') && !can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para ver perfil de membro.', flags: MessageFlags.Ephemeral });
    }
    const discordId = interaction.values[0];
    return interaction.reply({ ...operations.memberProfilePayload(discordId), flags: MessageFlags.Ephemeral });
  }

  if (scope === 'deposit_select') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para editar deposito.', flags: MessageFlags.Ephemeral });
    }

    const draft = deposit.addParticipants({ draftId: id, userIds: interaction.values });
    await interaction.update({
      content: 'Participantes atualizados. Voce pode selecionar mais membros ou confirmar o deposito.',
      embeds: [deposit.draftEmbed(draft)],
      components: deposit.draftComponents(draft.id)
    });
  }
}

module.exports = {
  handleSelect
};

function pausedFeatureReply(interaction) {
  return interaction.reply({
    content: 'Esse recurso foi pausado para simplificar o bot. Use os paineis principais de evento, saldo, registro ou ADM.',
    flags: MessageFlags.Ephemeral
  });
}

function showModal(interaction, customId, title, inputs) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(inputs.map((component) => new ActionRowBuilder().addComponents(component)));
  return interaction.showModal(modal);
}

function input(id, label, value = '', placeholder = null, required = true) {
  const component = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setRequired(required);
  if (value) component.setValue(value);
  if (placeholder) component.setPlaceholder(placeholder);
  return component;
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
