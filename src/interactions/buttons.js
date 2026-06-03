const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { can } = require('../config/permissions');
const eventsRepo = require('../modules/events/events.repository');
const events = require('../modules/events/events.service');
const financeRepo = require('../modules/finance/finance.repository');
const finance = require('../modules/finance/finance.service');
const csv = require('../modules/csv/csv.service');
const deposit = require('../modules/deposit/deposit.service');
const { formatSilver } = require('../utils/silver');
const registration = require('../modules/registration/registration.service');

function textInput(id, label, required = true, placeholder = null, style = TextInputStyle.Short) {
  const component = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required);
  if (placeholder) component.setPlaceholder(placeholder);
  return component;
}

function showModal(interaction, customId, title, inputs) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(inputs.map((component) => new ActionRowBuilder().addComponents(component)));
  return interaction.showModal(modal);
}

function canManageEvent(member, event) {
  if (!event) return false;
  if (event.creator_id === member.id) return true;
  return can(member, 'assumeEvent');
}

async function handleButton(interaction) {
  const [scope, action, id, extra] = interaction.customId.split(':');

  if (interaction.customId === 'panel:create_event') {
    if (!can(interaction.member, 'createEvent')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar evento.', ephemeral: true });
    }
    return showModal(interaction, 'event:create', 'Criar Evento', [
      textInput('title', 'Titulo'),
      textInput('description', 'Descricao'),
      textInput('location', 'Local'),
      textInput('scheduledTime', 'Horario UTC-3'),
      textInput('slots', 'Vagas Tank, Healer, Sup, DPS ex: 3,3,2,12')
    ]);
  }

  if (interaction.customId === 'panel:registration') {
    return showModal(interaction, 'registration:submit', 'Registro Albion', [
      textInput('albionName', 'Nome do personagem no Albion')
    ]);
  }

  if (scope === 'event') {
    const eventId = Number(id);
    const event = eventsRepo.getEvent(eventId);
    if (action === 'auto_join') {
      const role = await events.autoJoinRunningEvent(interaction, eventId);
      const updated = eventsRepo.getEvent(eventId);
      const voiceText = updated?.voice_channel_id ? ` Sala: <#${updated.voice_channel_id}>.` : '';
      const moveText = interaction.member?.voice?.channel ? ' Estou te movendo para a sala.' : ' Entre em uma call primeiro ou clique na sala do evento.';
      return interaction.reply({ content: `Voce entrou como ${roleLabel(role)}.${moveText}${voiceText}`, ephemeral: true });
    }
    if (action === 'spectate') {
      await events.spectateEvent(interaction, eventId);
      const updated = eventsRepo.getEvent(eventId);
      const voiceText = updated?.voice_channel_id ? ` Sala: <#${updated.voice_channel_id}>.` : '';
      const moveText = interaction.member?.voice?.channel ? ' Estou te movendo para a sala.' : ' Entre em uma call primeiro ou clique na sala do evento.';
      return interaction.reply({ content: `Voce entrou como espectador. Seu tempo nao sera contado.${moveText}${voiceText}`, ephemeral: true });
    }
    if (!canManageEvent(interaction.member, event)) {
      return interaction.reply({ content: 'Somente o criador ou alguem autorizado pode gerenciar este evento.', ephemeral: true });
    }
    if (action === 'start') {
      const voice = await events.startEvent(interaction, eventId);
      return interaction.reply({ content: `Evento iniciado. Sala criada: ${voice.name}.`, ephemeral: true });
    }
    if (action === 'finish') {
      if (event.creator_id !== interaction.user.id) {
        return interaction.reply({
          content: 'Voce esta ciente que esse evento nao foi criado por voce e que vai interromper o evento do criador, neh?',
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`event:confirm_finish:${eventId}:${interaction.user.id}`).setLabel('Sim, finalizar').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId(`event:abort_finish:${eventId}:${interaction.user.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
            )
          ],
          ephemeral: true
        });
      }
      return showLootModal(interaction, eventId);
    }
    if (action === 'confirm_finish') {
      if (extra !== interaction.user.id) {
        return interaction.reply({ content: 'Essa confirmacao nao foi criada para voce.', ephemeral: true });
      }
      return showLootModal(interaction, eventId);
    }
    if (action === 'abort_finish') {
      return interaction.reply({ content: 'Finalizacao cancelada.', ephemeral: true });
    }
    if (action === 'approve') {
      if (!can(interaction.member, 'approvePayment')) {
        return interaction.reply({ content: 'Voce nao tem permissao para aprovar pagamento.', ephemeral: true });
      }
      const current = eventsRepo.getEvent(eventId);
      if (!current || current.status !== 'pending_payment') {
        await interaction.message.edit({ components: [] }).catch(() => {});
        return interaction.reply({ content: 'Este evento nao esta pendente de pagamento. O botao foi removido.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      const transactions = events.approveEventPayment({ eventId, actorId: interaction.user.id });
      await finance.notifyPositiveTransactions({ client: interaction.client, transactions });
      await interaction.message.edit({
        content: `Evento #${eventId} finalizado por <@${interaction.user.id}>.`,
        embeds: [events.reviewEmbed(eventId)],
        components: []
      }).catch(() => {});
      return interaction.editReply({ content: 'Pagamento aprovado e saldos depositados.' });
    }
    if (action === 'cancel') {
      return showModal(interaction, `event:cancel_modal:${eventId}`, 'Cancelar Evento', [
        textInput('reason', 'Motivo do cancelamento')
      ]);
    }
  }

  if (scope === 'deposit') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para deposito.', ephemeral: true });
    }

    if (action === 'create') {
      return showModal(interaction, 'deposit:create_modal', 'Criar deposito rapido', [
        textInput('lootTotal', 'Valor total', true, 'Ex: 50m'),
        textInput('repair', 'Reparo', true, 'Ex: 2m ou 0'),
        textInput('silverBags', 'Sacos de prata', true, 'Ex: 500k ou 0'),
        textInput('taxPercent', 'Taxa %', true, 'Ex: 10')
      ]);
    }

    if (action === 'confirm') {
      await interaction.deferReply({ ephemeral: true });
      const result = await deposit.confirmDraft({ draftId: id, actorId: interaction.user.id, client: interaction.client });
      await interaction.message.edit({
        content: `Deposito confirmado por <@${interaction.user.id}>. ${result.participants.length} membro(s) receberam ${formatSilver(result.amount)}.`,
        embeds: [],
        components: []
      });
      return interaction.editReply({ content: 'Deposito aplicado nos saldos.' });
    }

    if (action === 'cancel') {
      deposit.cancelDraft(id);
      await interaction.message.edit({ content: 'Deposito cancelado.', embeds: [], components: [] });
      return interaction.reply({ content: 'Deposito cancelado.', ephemeral: true });
    }
  }

  if (scope === 'event_review') {
    const eventId = Number(id);
    const event = eventsRepo.getEvent(eventId);
    if (!canManageEvent(interaction.member, event)) {
      return interaction.reply({ content: 'Somente o criador ou alguem autorizado pode editar a revisao.', ephemeral: true });
    }

    if (action === 'edit') {
      return interaction.reply({
        content: 'Escolha o membro que deseja editar:',
        components: [participantSelect(eventId, interaction.message.id, 'edit')],
        ephemeral: true
      });
    }

    if (action === 'add') {
      return showModal(interaction, `event_review:add_modal:${eventId}:${interaction.message.id}`, 'Adicionar membro ao split', [
        textInput('userId', 'Membro', true, 'Ex: @Jogador ou 123456789012345678'),
        textInput('role', 'Funcao', true, 'Ex: tank, healer, sup, suporte, dps, dano'),
        textInput('minutes', 'Tempo contado em minutos', true, 'Ex: 60 para 1 hora'),
        textInput('reason', 'Motivo da inclusao', false, 'Ex: entrou depois e nao clicou participar')
      ]);
    }

    if (action === 'remove') {
      return interaction.reply({
        content: 'Escolha o membro que deseja remover:',
        components: [participantSelect(eventId, interaction.message.id, 'remove')],
        ephemeral: true
      });
    }

    if (action === 'submit') {
      await interaction.deferReply({ ephemeral: true });
      events.submitEventToFinance({ eventId, actorId: interaction.user.id });
      await interaction.message.edit({
        content: `Evento #${eventId} enviado para aprovacao financeira.`,
        embeds: [events.reviewEmbed(eventId)],
        components: events.reviewComponents(eventId, 'finance')
      });
      return interaction.editReply({ content: 'Evento enviado ao financeiro para aprovacao.' });
    }
  }

  if (interaction.customId === 'finance:balance') {
    const balance = financeRepo.getBalance(interaction.user.id);
    return interaction.reply({ content: `Seu saldo: ${formatSilver(balance)} prata.`, ephemeral: true });
  }

  if (interaction.customId === 'finance:withdraw') {
    return showModal(interaction, 'finance:withdraw_modal', 'Solicitar Saque', [
      textInput('amount', 'Valor'),
      textInput('note', 'Observacao', false)
    ]);
  }

  if (scope === 'finance' && action === 'approve_withdraw') {
    if (!can(interaction.member, 'approvePayment')) return interaction.reply({ content: 'Sem permissao.', ephemeral: true });
    finance.approveWithdraw({ requestId: Number(id), actorId: interaction.user.id });
    await interaction.message.edit({ content: `${interaction.message.content}\n\nAprovado por <@${interaction.user.id}>.`, components: interaction.message.components }).catch(() => {});
    return interaction.reply({ content: 'Saque aprovado. O saldo ainda nao foi descontado; use Pagar saque quando pagar.', ephemeral: true });
  }

  if (scope === 'finance' && action === 'pay_withdraw') {
    if (!can(interaction.member, 'approvePayment')) return interaction.reply({ content: 'Sem permissao.', ephemeral: true });
    finance.payWithdraw({ requestId: Number(id), actorId: interaction.user.id });
    await interaction.message.edit({ content: `${interaction.message.content}\n\nPago por <@${interaction.user.id}>.`, components: [] }).catch(() => {});
    return interaction.reply({ content: 'Saque pago e saldo descontado.', ephemeral: true });
  }

  if (interaction.customId === 'admin:remove_balance') {
    if (!can(interaction.member, 'withdrawBalance')) return interaction.reply({ content: 'Sem permissao.', ephemeral: true });
    return showModal(interaction, 'admin:remove_balance_modal', 'Retirar Saldo', [
      textInput('userId', 'ID ou mencao do membro'),
      textInput('amount', 'Valor'),
      textInput('reason', 'Motivo'),
      textInput('confirmation', 'CONFIRMAR se ficar negativo', false)
    ]);
  }

  if (scope === 'registration') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para aprovar registro.', ephemeral: true });
    }
    const registrationId = Number(id);
    const asMember = action === 'member';
    const result = await registration.approveRegistration({
      guild: interaction.guild,
      registrationId,
      actorId: interaction.user.id,
      asMember,
      note: asMember ? 'Aprovado como membro' : 'Mantido como convidado'
    });
    await interaction.message.edit({ components: [] }).catch(() => {});
    return interaction.reply({
      content: `Registro #${registrationId} de <@${result.discord_id}> resolvido: ${asMember ? 'Membro' : 'Convidado'}.`,
      ephemeral: true
    });
  }

  if (interaction.customId === 'csv:export_balances') {
    if (!can(interaction.member, 'importCsv')) return interaction.reply({ content: 'Sem permissao.', ephemeral: true });
    return interaction.reply({ content: 'Saldos exportados.', files: [csv.balancesAttachment()], ephemeral: true });
  }

  if (interaction.customId === 'csv:export_transactions') {
    if (!can(interaction.member, 'importCsv')) return interaction.reply({ content: 'Sem permissao.', ephemeral: true });
    return interaction.reply({ content: 'Logs financeiros exportados.', files: [csv.transactionsAttachment()], ephemeral: true });
  }

  if (interaction.customId === 'csv:export_audit') {
    if (!can(interaction.member, 'importCsv')) return interaction.reply({ content: 'Sem permissao.', ephemeral: true });
    return interaction.reply({ content: 'Auditoria exportada.', files: [csv.auditAttachment()], ephemeral: true });
  }

  if (interaction.customId === 'csv:import_help') {
    if (!can(interaction.member, 'importCsv')) return interaction.reply({ content: 'Sem permissao.', ephemeral: true });
    return interaction.reply({
      content: 'Para importar CSV com seguranca, use `/importar arquivo:<seu csv>`. O bot vai mostrar uma previa e pedir confirmacao antes de alterar saldos.',
      ephemeral: true
    });
  }

  if (scope === 'csv' && action === 'confirm_import') {
    if (!can(interaction.member, 'importCsv')) return interaction.reply({ content: 'Sem permissao.', ephemeral: true });
    const session = csv.takeImportPreview(id);
    if (!session) return interaction.reply({ content: 'Previa expirada ou ja usada. Envie o CSV novamente com `/importar`.', ephemeral: true });
    if (session.actorId !== interaction.user.id) {
      return interaction.reply({ content: 'Somente quem enviou a importacao pode confirmar.', ephemeral: true });
    }
    const transactions = csv.applyBalanceImport({ preview: session.preview, actorId: interaction.user.id });
    await finance.notifyPositiveTransactions({ client: interaction.client, transactions });
    await interaction.message.edit({ content: `Importacao aplicada. ${session.preview.found} saldos processados.`, components: [] }).catch(() => {});
    return interaction.reply({ content: 'CSV importado e saldos atualizados.', ephemeral: true });
  }

  if (scope === 'csv' && action === 'cancel_import') {
    csv.takeImportPreview(id);
    await interaction.message.edit({ content: 'Importacao cancelada.', components: [] }).catch(() => {});
    return interaction.reply({ content: 'Importacao cancelada.', ephemeral: true });
  }
}

function showLootModal(interaction, eventId) {
  return showModal(interaction, `event:loot:${eventId}`, 'Loot do Evento', [
    textInput('lootTotal', 'Loot total'),
    textInput('repair', 'Reparo'),
    textInput('silverBags', 'Sacos de prata'),
    textInput('taxPercent', 'Taxa % 0 a 100')
  ]);
}

module.exports = {
  handleButton
};

function participantSelect(eventId, reviewMessageId, mode) {
  const participants = eventsRepo
    .listParticipants(eventId)
    .filter((participant) => !participant.is_spectator)
    .slice(0, 25);

  if (participants.length === 0) {
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`event_review_select:${mode}:${eventId}:${reviewMessageId}`)
        .setPlaceholder('Nenhum participante encontrado')
        .setDisabled(true)
        .addOptions([{ label: 'Nenhum participante', value: 'none' }])
    );
  }

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`event_review_select:${mode}:${eventId}:${reviewMessageId}`)
      .setPlaceholder('Selecione um participante')
      .addOptions(participants.map((participant) => {
        const seconds = participant.manual_seconds ?? participant.calculated_seconds ?? 0;
        return {
          label: `${roleLabel(participant.role)} - ${Math.round(seconds / 60)}min`,
          description: participant.discord_id,
          value: participant.discord_id
        };
      }))
  );
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
