const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder } = require('discord.js');
const { can, hasRole, isOwner } = require('../config/permissions');
const ids = require('../config/ids');
const eventsRepo = require('../modules/events/events.repository');
const events = require('../modules/events/events.service');
const financeRepo = require('../modules/finance/finance.repository');
const finance = require('../modules/finance/finance.service');
const audit = require('../modules/audit/audit.repository');
const csv = require('../modules/csv/csv.service');
const balanceBackup = require('../modules/csv/balanceBackup.service');
const albionVerification = require('../modules/albion/guildVerification.service');
const deposit = require('../modules/deposit/deposit.service');
const polls = require('../modules/polls/polls.service');
const auctions = require('../modules/auctions/auctions.service');
const auctionsRepo = require('../modules/auctions/auctions.repository');
const memberList = require('../modules/members/memberList.service');
const { formatSilver } = require('../utils/silver');
const registration = require('../modules/registration/registration.service');
const { safeSend } = require('../utils/discord');

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

function canForceStartFinish(member) {
  return isOwner(member) || hasRole(member, 'staff') || hasRole(member, 'adm');
}

async function handleButton(interaction) {
  const [scope, action, id, extra] = interaction.customId.split(':');

  if (interaction.customId === 'panel:create_event') {
    if (!can(interaction.member, 'createEvent')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar evento.', flags: MessageFlags.Ephemeral });
    }
    return showModal(interaction, 'event:create', 'Criar Evento', [
      textInput('title', 'Titulo', false, 'Padrao: FastContent'),
      textInput('description', 'Descricao', false, 'Padrao: Pergunte na Call'),
      textInput('location', 'Local', false, 'Padrao: Pergunte na Call'),
      textInput('scheduledTime', 'Horario UTC-3', false, 'Padrao: 10 minutos a frente'),
      textInput('slots', 'Vagas Tank, Healer, Sup, DPS ex: 3,3,2,12', false, 'Padrao: 1,1,1,17')
    ]);
  }

  if (interaction.customId === 'panel:registration') {
    return showModal(interaction, 'registration:submit', 'Registro Albion', [
      textInput('albionName', 'Nome do personagem no Albion')
    ]);
  }

  if (interaction.customId === 'panel:create_auction') {
    if (!can(interaction.member, 'createAuction')) {
      return interaction.reply({ content: 'Voce precisa ser membro para criar leilao.', flags: MessageFlags.Ephemeral });
    }
    const draft = auctions.createDraft({});
    return interaction.reply({
      content: 'Escolha em qual canal de texto o leilao sera postado:',
      components: [auctionChannelSelect(draft.id)],
      flags: MessageFlags.Ephemeral
    });
  }

  if (scope === 'auction') {
    const auctionId = Number(id);
    const auction = auctionsRepo.getAuction(auctionId);
    if (!auction) return interaction.reply({ content: 'Leilao nao encontrado.', flags: MessageFlags.Ephemeral });

    if (action === 'bid') {
      if (auction.status !== 'open') {
        return interaction.reply({ content: 'Este leilao ja foi encerrado.', flags: MessageFlags.Ephemeral });
      }
      if (auctions.isExpired(auction)) {
        const closed = auctions.closeAuction({ auctionId, actorId: interaction.client.user?.id || 'system' });
        await auctions.refreshAuctionMessage(interaction.client, closed);
        if (closed.current_winner_id) await auctions.notifyWinner(interaction.client, closed);
        return interaction.reply({ content: 'Este leilao acabou de encerrar pelo tempo limite.', flags: MessageFlags.Ephemeral });
      }
      return showModal(interaction, `auction:bid_modal:${auctionId}`, `Lance Leilao #${auctionId}`, [
        textInput('amount', 'Valor do lance', true, 'Ex: 12m')
      ]);
    }

    if (action === 'close') {
      if (auction.created_by !== interaction.user.id && !can(interaction.member, 'approvePayment')) {
        return interaction.reply({ content: 'Somente o criador ou staff/tesouraria pode encerrar este leilao.', flags: MessageFlags.Ephemeral });
      }
      const closed = auctions.closeAuction({ auctionId, actorId: interaction.user.id });
      await auctions.refreshAuctionMessage(interaction.client, closed);
      const winner = closed.current_winner_id
        ? `Vencedor: <@${closed.current_winner_id}> por ${formatSilver(closed.current_bid)}.${closed.pickup_info ? `\nRetirada: ${closed.pickup_info}` : ''}`
        : 'Leilao encerrado sem lances.';
      if (closed.current_winner_id) {
        await auctions.notifyWinner(interaction.client, closed);
      }
      return interaction.reply({ content: winner, flags: MessageFlags.Ephemeral });
    }
  }

  if (scope === 'poll') {
    const pollId = Number(id);

    if (action === 'close') {
      const poll = await polls.closePoll({ interaction, pollId });
      return interaction.reply({
        content: `Enquete #${poll.id} fechada. Quer criar um evento no horario mais votado?`,
        components: polls.closeDecisionComponents(poll.id),
        flags: MessageFlags.Ephemeral
      });
    }

    if (action === 'create_event') {
      const event = await polls.createEventFromPoll({ interaction, pollId });
      return interaction.update({
        content: `Evento ${event.event_code} criado pelo resultado da enquete.`,
        components: []
      });
    }

    if (action === 'no_event') {
      return interaction.update({
        content: 'Enquete encerrada sem criar evento.',
        components: []
      });
    }
  }

  if (scope === 'member_list') {
    if (!can(interaction.member, 'approveRegistration') && !can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Sem permissao para usar a lista de membros.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'refresh') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await memberList.refreshPanel(interaction);
      return interaction.editReply({ content: 'Lista de membros atualizada.' });
    }

    if (action === 'csv') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return interaction.editReply({
        content: 'CSV da lista de membros gerado.',
        files: [await memberList.csvAttachment(interaction.guild)]
      });
    }

    if (action === 'view') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return interaction.editReply({
        embeds: [await memberList.filteredEmbed(interaction.guild, id)]
      });
    }
  }

  if (scope === 'event') {
    const eventId = Number(id);
    const event = eventsRepo.getEvent(eventId);
    if (action === 'auto_join') {
      let role;
      try {
        role = await events.autoJoinRunningEvent(interaction, eventId);
      } catch (error) {
        if (error.message.includes('Nao ha vagas livres')) {
          return interaction.reply({ content: 'Nao ha vagas livres neste evento. Use Assistir se quiser acompanhar.', flags: MessageFlags.Ephemeral });
        }
        throw error;
      }
      const updated = eventsRepo.getEvent(eventId);
      const voiceText = updated?.voice_channel_id ? ` Sala: <#${updated.voice_channel_id}>.` : '';
      const moveText = interaction.member?.voice?.channel ? ' Estou te movendo para a sala.' : ' Entre em uma call primeiro ou clique na sala do evento.';
      return interaction.reply({ content: `Voce entrou como ${roleLabel(role)}.${moveText}${voiceText}`, flags: MessageFlags.Ephemeral });
    }
    if (action === 'spectate') {
      await events.spectateEvent(interaction, eventId);
      const updated = eventsRepo.getEvent(eventId);
      const voiceText = updated?.voice_channel_id ? ` Sala: <#${updated.voice_channel_id}>.` : '';
      const moveText = interaction.member?.voice?.channel ? ' Estou te movendo para a sala.' : ' Entre em uma call primeiro ou clique na sala do evento.';
      return interaction.reply({ content: `Voce entrou como espectador. Seu tempo nao sera contado.${moveText}${voiceText}`, flags: MessageFlags.Ephemeral });
    }
    if (action === 'pause') {
      await events.pauseParticipation(interaction, eventId);
      return interaction.reply({ content: 'Sua participacao foi pausada. Seu tempo parou de contar.', flags: MessageFlags.Ephemeral });
    }
    if (!canManageEvent(interaction.member, event)) {
      return interaction.reply({ content: 'Somente o criador ou alguem autorizado pode gerenciar este evento.', flags: MessageFlags.Ephemeral });
    }
    if (action === 'start') {
      if (event.creator_id !== interaction.user.id) {
        if (!canForceStartFinish(interaction.member)) {
          return interaction.reply({ content: 'Somente o criador do evento pode iniciar. Staff/ADM podem iniciar com confirmacao.', flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({
          content: 'Voce esta ciente que esse evento nao foi criado por voce e que vai iniciar o evento do criador, neh?',
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`event:confirm_start:${eventId}:${interaction.user.id}`).setLabel('Sim, iniciar').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId(`event:abort_start:${eventId}:${interaction.user.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
            )
          ],
          flags: MessageFlags.Ephemeral
        });
      }
      const voice = await events.startEvent(interaction, eventId);
      return interaction.reply({ content: `Evento iniciado. Sala criada: ${voice.name}.`, flags: MessageFlags.Ephemeral });
    }
    if (action === 'confirm_start') {
      if (extra !== interaction.user.id) {
        return interaction.reply({ content: 'Essa confirmacao nao foi criada para voce.', flags: MessageFlags.Ephemeral });
      }
      if (!canForceStartFinish(interaction.member)) {
        return interaction.reply({ content: 'Somente Staff/ADM podem confirmar inicio de evento de outro criador.', flags: MessageFlags.Ephemeral });
      }
      const voice = await events.startEvent(interaction, eventId);
      return interaction.reply({ content: `Evento iniciado. Sala criada: ${voice.name}.`, flags: MessageFlags.Ephemeral });
    }
    if (action === 'abort_start') {
      return interaction.reply({ content: 'Inicio cancelado.', flags: MessageFlags.Ephemeral });
    }
    if (action === 'finish') {
      if (event.creator_id !== interaction.user.id) {
        if (!canForceStartFinish(interaction.member)) {
          return interaction.reply({ content: 'Somente o criador do evento pode finalizar. Staff/ADM podem finalizar com confirmacao.', flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({
          content: 'Voce esta ciente que esse evento nao foi criado por voce e que vai interromper o evento do criador, neh?',
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`event:confirm_finish:${eventId}:${interaction.user.id}`).setLabel('Sim, finalizar').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId(`event:abort_finish:${eventId}:${interaction.user.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
            )
          ],
          flags: MessageFlags.Ephemeral
        });
      }
      return showLootModal(interaction, eventId);
    }
    if (action === 'confirm_finish') {
      if (extra !== interaction.user.id) {
        return interaction.reply({ content: 'Essa confirmacao nao foi criada para voce.', flags: MessageFlags.Ephemeral });
      }
      if (!canForceStartFinish(interaction.member)) {
        return interaction.reply({ content: 'Somente Staff/ADM podem confirmar finalizacao de evento de outro criador.', flags: MessageFlags.Ephemeral });
      }
      return showLootModal(interaction, eventId);
    }
    if (action === 'abort_finish') {
      return interaction.reply({ content: 'Finalizacao cancelada.', flags: MessageFlags.Ephemeral });
    }
    if (action === 'approve') {
      if (!can(interaction.member, 'approvePayment')) {
        return interaction.reply({ content: 'Voce nao tem permissao para aprovar pagamento.', flags: MessageFlags.Ephemeral });
      }
      const current = eventsRepo.getEvent(eventId);
      if (!current || current.status !== 'pending_payment') {
        await interaction.message.edit({ components: [] }).catch(() => {});
        return interaction.reply({ content: 'Este evento nao esta pendente de pagamento. O botao foi removido.', flags: MessageFlags.Ephemeral });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const transactions = events.approveEventPayment({ eventId, actorId: interaction.user.id });
      await finance.notifyBalanceTransactions({ client: interaction.client, transactions });
      await interaction.message.edit({
        content: `Evento #${eventId} finalizado por <@${interaction.user.id}>.`,
        embeds: [events.reviewEmbed(eventId)],
        components: []
      }).catch(() => {});
      await events.scheduleReviewChannelDeletion(interaction.client, eventId, 14);
      await balanceBackup.postEventBalanceBackup(interaction.client, eventId);
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
      return interaction.reply({ content: 'Sem permissao para deposito.', flags: MessageFlags.Ephemeral });
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
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await deposit.confirmDraft({ draftId: id, actorId: interaction.user.id, client: interaction.client });
      await clearSourceMessage(interaction, 'Deposito aplicado.');
      return interaction.editReply({
        content: `Deposito aplicado nos saldos. ${result.participants.length} membro(s) receberam ${formatSilver(result.amount)}.`
      });
    }

    if (action === 'cancel') {
      deposit.cancelDraft(id);
      await clearSourceMessage(interaction, 'Deposito cancelado.');
      return interaction.reply({ content: 'Deposito cancelado.', flags: MessageFlags.Ephemeral });
    }
  }

  if (scope === 'event_review') {
    const eventId = Number(id);
    const event = eventsRepo.getEvent(eventId);
    if (!canManageEvent(interaction.member, event)) {
      return interaction.reply({ content: 'Somente o criador ou alguem autorizado pode editar a revisao.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'edit') {
      return interaction.reply({
        content: 'Escolha o membro que deseja editar usando a busca do Discord:',
        components: [reviewUserSelect(eventId, interaction.message.id, 'edit', 'Buscar membro para editar')],
        flags: MessageFlags.Ephemeral
      });
    }

    if (action === 'add') {
      return interaction.reply({
        content: 'Escolha o membro que deseja adicionar usando a busca do Discord:',
        components: [reviewUserSelect(eventId, interaction.message.id, 'add', 'Buscar membro para adicionar')],
        flags: MessageFlags.Ephemeral
      });
    }

    if (action === 'remove') {
      return interaction.reply({
        content: 'Escolha o membro que deseja remover usando a busca do Discord:',
        components: [reviewUserSelect(eventId, interaction.message.id, 'remove', 'Buscar membro para remover')],
        flags: MessageFlags.Ephemeral
      });
    }

    if (action === 'submit') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      events.submitEventToFinance({ eventId, actorId: interaction.user.id });
      const reviewChannel = await events.moveReviewChannelToClosed(interaction.client, eventId);
      await events.postDpsMeterSummary(interaction.client, eventId);
      await safeSend(interaction.client, ids.channels.finance, {
        content: `Evento #${eventId} enviado para aprovacao financeira.${reviewChannel ? ` Revisao: <#${reviewChannel.id}>` : ''}`,
        embeds: [events.reviewEmbed(eventId)],
        components: events.reviewComponents(eventId, 'finance')
      });
      await interaction.message.edit({
        content: `Evento #${eventId} enviado para aprovacao financeira.${reviewChannel ? ` Canal movido para finalizados: <#${reviewChannel.id}>` : ''}`,
        embeds: [events.reviewEmbed(eventId)],
        components: []
      });
      return interaction.editReply({ content: 'Evento enviado ao financeiro para aprovacao.' });
    }
  }

  if (interaction.customId === 'finance:balance') {
    const balance = financeRepo.getBalance(interaction.user.id);
    return interaction.reply({ content: `Seu saldo: ${formatSilver(balance)} prata.`, flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'finance:withdraw') {
    return showModal(interaction, 'finance:withdraw_modal', 'Solicitar Saque', [
      textInput('amount', 'Valor em numeros', true, 'Ex: 1000000 sem ponto, virgula ou letra'),
      textInput('note', 'Observacao', false)
    ]);
  }

  if (scope === 'finance' && action === 'confirm_withdraw') {
    const draft = finance.takeWithdrawDraft(id);
    if (!draft) {
      return interaction.update({ content: 'Essa confirmacao expirou. Abra o saque novamente.', components: [] });
    }
    if (draft.userId !== interaction.user.id) {
      return interaction.reply({ content: 'Essa confirmacao de saque nao foi criada para voce.', flags: MessageFlags.Ephemeral });
    }
    const currentBalance = financeRepo.getBalance(interaction.user.id);
    const negativeWarning = draft.amount > currentBalance
      ? `\n\nATENCAO: saldo atual ${formatSilver(currentBalance)}. Se pagar este saque, o membro ficara com ${formatSilver(currentBalance - draft.amount)}.`
      : '';
    const request = finance.requestWithdraw({ userId: interaction.user.id, amount: draft.amount, note: draft.note });
    audit.createAuditLog({
      type: 'withdraw_requested',
      actorId: interaction.user.id,
      targetId: interaction.user.id,
      afterValue: draft.amount,
      reason: draft.note
    });
    await safeSend(interaction.client, ids.channels.finance, {
      content: `Saque solicitado: #${request.lastInsertRowid} por <@${interaction.user.id}> no valor de ${formatSilver(draft.amount)}.${negativeWarning}`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`finance:approve_withdraw:${request.lastInsertRowid}`).setLabel('Aprovar saque').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`finance:pay_withdraw:${request.lastInsertRowid}`).setLabel('Pagar saque').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`finance:refuse_withdraw:${request.lastInsertRowid}`).setLabel('Recusar saque').setStyle(ButtonStyle.Danger)
        )
      ]
    });
    return interaction.update({ content: `Saque solicitado para a staff: ${formatSilver(draft.amount)}.`, components: [] });
  }

  if (scope === 'finance' && action === 'cancel_withdraw') {
    finance.takeWithdrawDraft(id);
    return interaction.update({ content: 'Solicitacao de saque cancelada. Nada foi enviado para a staff.', components: [] });
  }

  if (scope === 'finance' && action === 'approve_withdraw') {
    if (!can(interaction.member, 'approvePayment')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    const request = financeRepo.getWithdrawRequest(Number(id));
    if (!request) return interaction.reply({ content: 'Solicitacao de saque nao encontrada.', flags: MessageFlags.Ephemeral });
    if (request.status === 'approved') {
      return interaction.reply({ content: 'Esse saque ja esta aprovado. Use Pagar saque quando o pagamento for feito.', flags: MessageFlags.Ephemeral });
    }
    if (request.status === 'paid') {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: 'Esse saque ja foi pago. Removi os botoes antigos.', flags: MessageFlags.Ephemeral });
    }
    if (request.status !== 'requested') {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: `Esse saque nao esta mais solicitando aprovacao. Status atual: ${request.status}.`, flags: MessageFlags.Ephemeral });
    }
    finance.approveWithdraw({ requestId: Number(id), actorId: interaction.user.id });
    await interaction.message.edit({
      content: `${interaction.message.content}\n\nAprovado por <@${interaction.user.id}>.`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`finance:pay_withdraw:${id}`).setLabel('Pagar saque').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`finance:refuse_withdraw:${id}`).setLabel('Recusar saque').setStyle(ButtonStyle.Danger)
        )
      ]
    }).catch(() => {});
    return interaction.reply({ content: 'Saque aprovado. O saldo ainda nao foi descontado; use Pagar saque quando pagar.', flags: MessageFlags.Ephemeral });
  }

  if (scope === 'finance' && action === 'refuse_withdraw') {
    if (!can(interaction.member, 'approvePayment')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    const request = financeRepo.getWithdrawRequest(Number(id));
    if (!request) return interaction.reply({ content: 'Solicitacao de saque nao encontrada.', flags: MessageFlags.Ephemeral });
    if (request.status === 'paid') {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: 'Esse saque ja foi pago. Nao da para recusar depois do pagamento.', flags: MessageFlags.Ephemeral });
    }
    if (request.status === 'refused') {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: 'Esse saque ja foi recusado. Removi os botoes antigos.', flags: MessageFlags.Ephemeral });
    }
    if (!['requested', 'approved'].includes(request.status)) {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: `Esse saque nao pode mais ser recusado. Status atual: ${request.status}.`, flags: MessageFlags.Ephemeral });
    }
    finance.refuseWithdraw({ requestId: Number(id), actorId: interaction.user.id });
    await interaction.message.edit({ content: `${interaction.message.content}\n\nRecusado por <@${interaction.user.id}>.`, components: [] }).catch(() => {});
    return interaction.reply({ content: 'Saque recusado. Nenhum saldo foi alterado.', flags: MessageFlags.Ephemeral });
  }

  if (scope === 'finance' && action === 'pay_withdraw') {
    if (!can(interaction.member, 'approvePayment')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    const transaction = finance.payWithdraw({ requestId: Number(id), actorId: interaction.user.id });
    await finance.notifyBalanceTransactions({ client: interaction.client, transactions: [transaction] });
    await interaction.message.edit({ content: `${interaction.message.content}\n\nPago por <@${interaction.user.id}>.`, components: [] }).catch(() => {});
    return interaction.reply({ content: 'Saque pago e saldo descontado.', flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'admin:remove_balance') {
    if (!can(interaction.member, 'withdrawBalance')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    return interaction.reply({
      content: 'Escolha o membro que vai ter saldo retirado usando a busca do Discord:',
      components: [adminRemoveBalanceUserSelect()],
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === 'admin:verify_pending_registrations') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para verificar pedidos pendentes.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({
      content: [
        'Use o comando `/verificar_guilda arquivo:<csv/tsv>` e anexe a lista oficial de membros da guild no Albion.',
        'O bot vai mostrar uma previa antes de dar cargos.',
        'Encontrados viram Membro; nao encontrados continuam Convidado/pendente.'
      ].join('\n'),
      flags: MessageFlags.Ephemeral
    });
  }

  if (scope === 'registration_bulk') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para aplicar verificacao de registros.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'confirm') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const results = await registration.applyPendingGuildRegistrationPreview({
        guild: interaction.guild,
        previewId: id,
        actorId: interaction.user.id
      });
      const approved = results.filter((row) => row.result === 'aprovado como membro').length;
      const kept = results.filter((row) => row.result === 'mantido convidado').length;
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.editReply({
        content: `Verificacao aplicada. Aprovados como Membro: ${approved}. Mantidos como Convidado/pendente: ${kept}.`,
        files: [registration.pendingGuildApplyAttachment(results)]
      });
    }

    if (action === 'cancel') {
      registration.takePendingGuildRegistrationPreview(id, interaction.user.id);
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: 'Verificacao cancelada. Nenhum cargo foi alterado.', flags: MessageFlags.Ephemeral });
    }
  }

  if (scope === 'registration') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para aprovar registro.', flags: MessageFlags.Ephemeral });
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
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === 'csv:export_balances') {
    if (!can(interaction.member, 'importCsv')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    return interaction.reply({ content: 'Saldos exportados.', files: [csv.balancesAttachment()], flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'csv:export_balances_html') {
    if (!can(interaction.member, 'importCsv')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    return interaction.reply({ content: 'Lista HTML de saldos gerada.', files: [csv.balancesHtmlAttachment()], flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'guild:export_members_html') {
    if (!can(interaction.member, 'approveRegistration') && !can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const attachment = await albionVerification.membersHtmlAttachment(interaction.guild);
    return interaction.editReply({
      content: 'Lista HTML Discord x Albion gerada com base na ultima verificacao.',
      files: [attachment]
    });
  }

  if (interaction.customId === 'csv:export_transactions') {
    if (!can(interaction.member, 'importCsv')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    return interaction.reply({ content: 'Logs financeiros exportados.', files: [csv.transactionsAttachment()], flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'csv:export_audit') {
    if (!can(interaction.member, 'importCsv')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    return interaction.reply({ content: 'Auditoria exportada.', files: [csv.auditAttachment()], flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'csv:import_help') {
    if (!can(interaction.member, 'importCsv')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    return interaction.reply({
      content: 'Para importar CSV com seguranca, use `/importar arquivo:<seu csv>`. O bot vai mostrar uma previa e pedir confirmacao antes de alterar saldos.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (scope === 'csv' && action === 'confirm_import') {
    if (!can(interaction.member, 'importCsv')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    const session = csv.takeImportPreview(id);
    if (!session) return interaction.reply({ content: 'Previa expirada ou ja usada. Envie o CSV novamente com `/importar`.', flags: MessageFlags.Ephemeral });
    if (session.actorId !== interaction.user.id) {
      return interaction.reply({ content: 'Somente quem enviou a importacao pode confirmar.', flags: MessageFlags.Ephemeral });
    }
    const transactions = csv.applyBalanceImport({ preview: session.preview, actorId: interaction.user.id });
    await finance.notifyBalanceTransactions({ client: interaction.client, transactions });
    await interaction.message.edit({ content: `Importacao aplicada. ${session.preview.found} saldos processados.`, components: [] }).catch(() => {});
    return interaction.reply({ content: 'CSV importado e saldos atualizados.', flags: MessageFlags.Ephemeral });
  }

  if (scope === 'csv' && action === 'cancel_import') {
    csv.takeImportPreview(id);
    await interaction.message.edit({ content: 'Importacao cancelada.', components: [] }).catch(() => {});
    return interaction.reply({ content: 'Importacao cancelada.', flags: MessageFlags.Ephemeral });
  }
}

function showLootModal(interaction, eventId) {
  return showModal(interaction, `event:loot:${eventId}`, 'Loot do Evento', [
    textInput('lootTotal', 'Loot total'),
    textInput('repair', 'Reparo'),
    textInput('silverBags', 'Sacos de prata'),
    textInput('taxPercent', 'Taxa % 0 a 100'),
    textInput('evidenceNotes', 'DPS/Fama links ou obs', false, 'CSV do loot logger: anexe no canal de revisao', TextInputStyle.Paragraph)
  ]);
}

async function clearSourceMessage(interaction, fallbackContent) {
  await interaction.message.delete().catch(async () => {
    await interaction.message.edit({ content: fallbackContent, embeds: [], components: [] }).catch(() => {});
  });
}

module.exports = {
  handleButton
};

function reviewUserSelect(eventId, reviewMessageId, mode, placeholder) {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`event_review_user_select:${mode}:${eventId}:${reviewMessageId}`)
      .setPlaceholder(placeholder)
      .setMinValues(1)
      .setMaxValues(1)
  );
}

function adminRemoveBalanceUserSelect() {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('admin_remove_balance_select:user')
      .setPlaceholder('Buscar membro para retirar saldo')
      .setMinValues(1)
      .setMaxValues(1)
  );
}

function auctionChannelSelect(draftId) {
  return new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(`auction_channel_select:create:${draftId}`)
      .setPlaceholder('Selecionar canal do leilao')
      .setMinValues(1)
      .setMaxValues(1)
      .addChannelTypes(ChannelType.GuildText)
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
