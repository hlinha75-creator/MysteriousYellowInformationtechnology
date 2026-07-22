const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder } = require('discord.js');
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
const inactiveEvents = require('../modules/members/inactiveEvents.service');
const inactiveGuests = require('../modules/members/inactiveGuests.service');
const operations = require('../modules/operations/operations.service');
const staffTutorial = require('../modules/tutorials/staffTutorial.service');
const campaigns = require('../modules/campaigns/campaigns.service');
const memberProfile = require('../modules/members/profile.service');
const albionFame = require('../modules/albion/fame.service');
const { formatSilver } = require('../utils/silver');
const registration = require('../modules/registration/registration.service');
const { safeSend } = require('../utils/discord');
const accountLinks = require('../modules/accounts/accountLinks.service');
const lochMarket = require('../modules/community/lochMarket.service');
const hideoutDefense = require('../modules/operations/hideoutDefense.service');
const giveaways = require('../modules/giveaways/giveaways.service');

const pausedButtonScopes = new Set([
  'auction',
  'albion_weekly',
  'member_list',
  'member_panel',
  'member_panel_staff',
  'poll'
]);

const pausedButtonIds = new Set([
  'panel:create_auction'
]);

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

function mentionOrDash(userId) {
  return userId ? `<@${userId}>` : 'sem registro';
}

function truncateInline(value, max = 70) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function withdrawRequestContent(request, options = {}) {
  const status = options.status || request.status || 'requested';
  const amount = formatSilver(Math.abs(Number(request.amount || 0)));
  const approvedBy = options.approvedBy || request.reviewed_by;
  const paidBy = options.paidBy || request.paid_by;
  const refusedBy = options.refusedBy || request.reviewed_by;
  const statusText = {
    requested: 'Aguardando aprovacao',
    approved: `Aprovado: ${mentionOrDash(approvedBy)} | Aguardando pagamento`,
    paid: `Aprovado: ${mentionOrDash(approvedBy)} | Pago: ${mentionOrDash(paidBy)}`,
    refused: `Recusado: ${mentionOrDash(refusedBy)}`
  }[status] || `Status: ${status}`;
  const note = truncateInline(request.note);
  const line = [`Saque #${request.id}`, mentionOrDash(request.user_id), amount, statusText, note ? `Obs: ${note}` : null]
    .filter(Boolean)
    .join(' | ');
  return options.warning ? `${line}\n${options.warning}` : line;
}

function paymentRequestContent(request, options = {}) {
  const status = options.status || request.status || 'requested';
  const amount = formatSilver(Math.abs(Number(request.amount || 0)));
  const reviewedBy = options.reviewedBy || request.reviewed_by;
  const statusText = {
    requested: 'Aguardando aprovacao',
    approved: `Aprovado e depositado: ${mentionOrDash(reviewedBy)}`,
    refused: `Recusado: ${mentionOrDash(reviewedBy)}`
  }[status] || `Status: ${status}`;
  const lines = [
    `Pedido de pagamento #${request.id} | ${mentionOrDash(request.user_id)} | ${amount} | ${statusText}`,
    `Servico: ${truncateInline(request.service, 140)}`,
    `Motivo: ${truncateInline(request.description, 220)}`
  ];
  if (request.evidence) lines.push(`Prova: ${truncateInline(request.evidence, 220)}`);
  return lines.join('\n');
}

function canManageEvent(member, event) {
  if (!event) return false;
  if (event.creator_id === member.id) return true;
  return can(member, 'assumeEvent');
}

function canForceStartFinish(member) {
  return isOwner(member) || hasRole(member, 'staff') || hasRole(member, 'adm');
}

const publicEventActions = new Set([
  'raid_slot',
  'raid_role',
  'raid_helper',
  'wb_slot',
  'wb_leave',
  'wb_manage',
  'wb_confirm',
  'wb_abort',
  'join_role',
  'change_role',
  'auto_join',
  'spectate',
  'pause',
  'start',
  'confirm_start',
  'finish',
  'confirm_finish',
  'cancel',
  'confirm_cancel',
  'abort_cancel'
]);

function isInteractiveEvent(event) {
  return event && ['created', 'running'].includes(event.status);
}

async function replyUnavailableEvent(interaction, event) {
  await interaction.message?.edit({ components: [] }).catch(() => {});
  const statusText = event?.status
    ? `Status atual: ${event.status}.`
    : 'O registro desse evento nao existe mais no banco atual.';
  return interaction.reply({
    content: `Esse evento nao esta mais aberto. ${statusText} Removi os botoes antigos desta mensagem.`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleButton(interaction) {
  const [scope, action, id, extra] = interaction.customId.split(':');
  if (pausedButtonScopes.has(scope) || pausedButtonIds.has(interaction.customId)) {
    return pausedFeatureReply(interaction);
  }

  if (scope === 'giveaway') return giveaways.handleButton(interaction);

  if (interaction.customId === hideoutDefense.START_BUTTON_ID) {
    if (!isOwner(interaction.member) && !hasRole(interaction.member, 'adm')) {
      return interaction.reply({
        content: 'Somente a ADM pode iniciar a defesa e mover os inscritos.',
        flags: MessageFlags.Ephemeral
      });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await hideoutDefense.startDefense({
      client: interaction.client,
      guild: interaction.guild,
      actorId: interaction.user.id
    });
    return interaction.editReply({
      content: [
        `Sala temporária criada/atualizada: <#${result.voice.id}>.`,
        `Movidos: ${result.moved.length}.`,
        `Fora da call: ${result.notConnected.length}.`,
        `Falhas ao mover: ${result.failed.length}.`
      ].join(' '),
      allowedMentions: { parse: [] }
    });
  }

  if ([hideoutDefense.ACK_BUTTON_ID, hideoutDefense.PARTICIPATE_BUTTON_ID].includes(interaction.customId)) {
    if (!hasRole(interaction.member, 'member')) {
      return interaction.reply({
        content: 'Somente membros da guilda podem responder a este aviso.',
        flags: MessageFlags.Ephemeral
      });
    }

    const isParticipation = interaction.customId === hideoutDefense.PARTICIPATE_BUTTON_ID;
    const result = isParticipation
      ? hideoutDefense.toggleParticipation(interaction.user.id)
      : hideoutDefense.toggleAcknowledgement(interaction.user.id);
    const payload = isParticipation
      ? hideoutDefense.announcementPayload({ participations: result.participations })
      : hideoutDefense.announcementPayload({ acknowledgements: result.acknowledgements });
    await interaction.update(payload);
    const roleResult = await hideoutDefense.syncMemberDefenseRole(interaction.guild, interaction.user.id).catch(() => null);
    return interaction.followUp({
      content: isParticipation
        ? (result.added
            ? `Presença confirmada. Você foi adicionado à lista de quem vai lutar${roleResult?.role ? ` e recebeu a tag <@&${roleResult.role.id}>` : ''}.`
            : 'Sua confirmação para lutar foi removida.')
        : (result.alreadyParticipating
            ? 'Você já está na lista “Vão lutar”, então já está ciente do aviso.'
            : result.added
              ? `Leitura confirmada. Você foi adicionado à lista de membros cientes${roleResult?.role ? ` e recebeu a tag <@&${roleResult.role.id}>` : ''}.`
              : 'Sua confirmação de leitura foi removida.'),
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral
    });
  }

  if (scope === 'accounts' && ['merge', 'cancel_merge'].includes(action)) {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para mesclar contas.', flags: MessageFlags.Ephemeral });
    }
    if (action === 'cancel_merge') {
      accountLinks.cancelMergePreview(id, interaction.user.id);
      return interaction.update({ content: 'Mesclagem cancelada. Nenhum dado foi alterado.', components: [] });
    }
    const result = accountLinks.applyMergePreview(id, interaction.user.id);
    return interaction.update({
      content: [
        'Contas mescladas com sucesso.',
        `Principal: <@${result.primaryId}>`,
        `Contas incorporadas: ${result.secondaryIds.map((userId) => `<@${userId}>`).join(' ')}`,
        result.albionName ? `Albion: ${result.albionName}` : null
      ].filter(Boolean).join('\n'),
      allowedMentions: { parse: [] },
      components: []
    });
  }

  if (scope === 'loch') {
    if (action === 'feedback') {
      const result = lochMarket.registerFeedback(interaction.user.id, id);
      await interaction.update({ components: lochMarket.announcementComponents(result.counts) });
      return interaction.followUp({
        content: result.added ? 'Obrigado por registrar sua reação.' : 'Sua reação já estava registrada.',
        flags: MessageFlags.Ephemeral
      });
    }
    if (action === 'suggestion') {
      return showModal(interaction, 'loch:suggestion_modal', 'Sugestão sobre o mercado', [
        textInput('suggestion', 'Sua opinião', true, 'Escreva sua sugestão para a staff', TextInputStyle.Paragraph)
      ]);
    }
    if (action === 'answer') {
      if (!isOwner(interaction.member) && !hasRole(interaction.member, 'staff') && !hasRole(interaction.member, 'adm')) {
        return interaction.reply({ content: 'Somente a staff pode responder sugestões.', flags: MessageFlags.Ephemeral });
      }
      const suggestion = lochMarket.getSuggestion(Number(id));
      if (!suggestion) return interaction.reply({ content: 'Sugestão não encontrada.', flags: MessageFlags.Ephemeral });
      if (suggestion.status === 'answered') {
        return interaction.reply({ content: 'Essa sugestão já foi respondida.', flags: MessageFlags.Ephemeral });
      }
      return showModal(interaction, `loch:answer_modal:${id}`, 'Responder sugestão', [
        textInput('answer', 'Resposta da staff', true, 'A resposta sera enviada por mensagem privada', TextInputStyle.Paragraph)
      ]);
    }
  }

  if (scope === 'campaign' && ['donate_event', 'keep_event'].includes(action)) {
    await interaction.deferReply(interaction.guild ? { flags: MessageFlags.Ephemeral } : {});
    const result = await campaigns.resolveEventPayoutChoice({
      client: interaction.client,
      decisionId: Number(id),
      userId: interaction.user.id,
      choice: action === 'donate_event' ? 'donate' : 'keep',
      actorId: interaction.user.id
    });
    if (result.transaction) {
      await finance.notifyBalanceTransactions({ client: interaction.client, transactions: [result.transaction] });
    }
    await interaction.message.edit({
      embeds: [campaigns.closedDecisionEmbed(result)],
      components: []
    }).catch(() => {});
    return interaction.editReply({
      content: result.donated
        ? `Doacao registrada: ${formatSilver(result.decision.amount)} para @${result.campaign.role_name || '900m'}.`
        : `Tudo certo. ${formatSilver(result.decision.amount)} foi enviado para seu saldo.`
    });
  }
  if (scope === 'campaign' && action === 'donate_balance') {
    const balance = financeRepo.getBalance(interaction.user.id);
    if (balance <= 0) {
      return interaction.reply({ content: 'Voce nao tem saldo positivo para doar.', flags: MessageFlags.Ephemeral });
    }
    return showModal(interaction, 'campaign:donate_balance_modal', 'Doar saldo para @900m', [
      textInput('amount', 'Valor para doar', true, `Seu saldo: ${formatSilver(balance)}. Ex: 5m`)
    ]);
  }

  if (scope === 'campaign' && action === 'view_contributors') {
    return interaction.reply({ ...campaigns.contributorsHtmlPayload(), flags: MessageFlags.Ephemeral });
  }

  if (scope === 'campaign' && action === 'confirm_balance_donation') {
    if (extra !== interaction.user.id) {
      return interaction.reply({ content: 'Essa confirmacao nao foi criada para voce.', flags: MessageFlags.Ephemeral });
    }
    const amount = Number(id);
    await interaction.deferUpdate();
    const result = await campaigns.donateFromBalance({
      client: interaction.client,
      userId: interaction.user.id,
      amount,
      actorId: interaction.user.id
    });
    await finance.notifyBalanceTransactions({ client: interaction.client, transactions: [result.transaction] });
    return interaction.editReply({
      content: `Doacao registrada: ${formatSilver(amount)} para @${result.campaign.role_name || '900m'}. Seu saldo atual: ${formatSilver(result.transaction.afterBalance)}.`,
      components: []
    });
  }

  if (scope === 'campaign' && action === 'cancel_balance_donation') {
    if (id !== interaction.user.id) {
      return interaction.reply({ content: 'Essa confirmacao nao foi criada para voce.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferUpdate();
    return interaction.editReply({ content: 'Doacao cancelada. Nenhum saldo foi alterado.', components: [] });
  }

  if (interaction.customId === 'panel:create_event') {
    if (!can(interaction.member, 'createEvent')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar evento.', flags: MessageFlags.Ephemeral });
    }
    return showModal(interaction, 'event:create', 'Criar Evento', [
      textInput('title', 'Content', false, 'Ex: DG Grupo T8+'),
      textInput('location', 'Local', false, 'Ex: Martlock Portal > HO Loch'),
      textInput('scheduledTime', 'Data/Hora', false, 'Ex: 23/06 15:00 utc'),
      textInput('description', 'Tier da Build', false, 'Ex: T8 equivalente + set Skip'),
      textInput('slots', 'Tank, Healer, Suporte, DPS', false, 'Ex: 1,1,1,3')
    ]);
  }

  if (interaction.customId === 'panel:create_raid_full') {
    if (!can(interaction.member, 'createEvent')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar Raid Avalon Full.', flags: MessageFlags.Ephemeral });
    }
    return showModal(interaction, 'event:create_raid_full', 'Raid Avalon Full', [
      textInput('scheduledTime', 'Dia e hora Albion', true, 'Ex: hoje 20:30 ou 16/06 20:30'),
      textInput('location', 'Local', true, 'Ex: Martlock, Portal, HO'),
      textInput('dungeonTier', 'Tier da DG', true, 'Ex: T8.1'),
      textInput('buildTier', 'Tier da build', true, 'Ex: T8 equivalente')
    ]);
  }

  if (interaction.customId === 'panel:create_world_boss') {
    if (!can(interaction.member, 'createEvent')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar World Boss.', flags: MessageFlags.Ephemeral });
    }
    return showModal(interaction, 'event:create_world_boss', 'Criar World Boss', [
      textInput('eventDate', 'Data do Farm', true, 'Ex: 20/07/2026')
    ]);
  }

  if (interaction.customId === 'panel:registration') {
    return showModal(interaction, 'registration:submit', 'Registro Albion', [
      textInput('albionName', 'Nome do personagem no Albion')
    ]);
  }

  if (interaction.customId === 'panel:member_profile') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return interaction.editReply(await memberProfile.memberProfilePayload(interaction.user.id, interaction.guild));
  }

  if (interaction.customId === 'profile:request_fame_update') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await memberProfile.requestFameUpdate(interaction);
    return interaction.editReply({ content: 'Pedido enviado para a ADM atualizar seus dados Albion na proxima rotina manual.' });
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
        content: 'HTML da lista de membros gerado. Abra o arquivo e use Baixar CSV se precisar de planilha.',
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

  if (scope === 'member_panel_staff') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Somente a equipe pode responder membros.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'answer') {
      return showModal(interaction, `member_panel_staff:answer_modal:${id}`, 'Responder membro', [
        textInput('answer', 'Resposta', true, 'Escreva a resposta que sera enviada por DM', TextInputStyle.Paragraph)
      ]);
    }
  }

  if (scope === 'event') {
    const eventId = Number(id);
    const event = eventsRepo.getEvent(eventId);
    if (publicEventActions.has(action) && !isInteractiveEvent(event)) {
      return replyUnavailableEvent(interaction, event);
    }
    if (action === 'raid_slot') {
      const select = raidWeaponSlotSelect(eventId, interaction.user.id);
      if (!select) {
        return interaction.reply({ content: 'Nao ha vagas livres nesta Raid Avalon.', flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({
        content: 'Escolha sua vaga/arma:',
        components: [select],
        flags: MessageFlags.Ephemeral
      });
    }
    if (action === 'wb_slot') {
      const options = events.worldBossSlotOptions(eventId, interaction.user.id);
      if (options.length === 0) {
        return interaction.reply({ content: 'Todas as vagas do World Boss estao ocupadas.', flags: MessageFlags.Ephemeral });
      }
      const select = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`event_world_boss_slot:slot:${eventId}`)
          .setPlaceholder('Escolha sua funcao ou scout')
          .addOptions(options)
      );
      return interaction.reply({
        content: 'Escolha uma vaga. Se voce ja estiver inscrito, a vaga anterior sera liberada:',
        components: [select],
        flags: MessageFlags.Ephemeral
      });
    }
    if (action === 'wb_manage') {
      const options = events.worldBossMemberSlotOptions(eventId, interaction.user.id);
      if (options.length === 0) {
        return interaction.reply({ content: 'Voce nao possui vagas neste World Boss.', flags: MessageFlags.Ephemeral });
      }
      const select = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`event_world_boss_slot:remove:${eventId}`)
          .setPlaceholder('Escolha a vaga que deseja liberar')
          .addOptions(options)
      );
      return interaction.reply({
        content: 'Selecione somente a vaga que deseja liberar:',
        components: [select],
        flags: MessageFlags.Ephemeral
      });
    }
    if (action === 'wb_confirm') {
      const slot = await events.joinWorldBossSlot(interaction, eventId, extra);
      return interaction.update({ content: `Funcao confirmada: **${slot.label}**.`, components: [] });
    }
    if (action === 'wb_abort') {
      return interaction.update({ content: 'Escolha de funcao cancelada.', components: [] });
    }
    if (action === 'wb_leave') {
      await events.leaveWorldBoss(interaction, eventId);
      return interaction.reply({ content: 'Voce saiu da composicao do World Boss.', flags: MessageFlags.Ephemeral });
    }
    if (action === 'raid_role') {
      const role = extra;
      const select = raidWeaponSelect(eventId, role, interaction.user.id);
      if (!select) {
        return interaction.reply({ content: `Nao ha vagas livres para ${roleLabel(role)}.`, flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({
        content: 'Clique na arma para ver e selecionar sua build:',
        components: [select],
        flags: MessageFlags.Ephemeral
      });
    }
    if (action === 'raid_helper') {
      const helperName = await events.joinRaidAvalonHelper(interaction, eventId, extra);
      return interaction.reply({ content: `Voce entrou como ${helperName}.`, flags: MessageFlags.Ephemeral });
    }
    if (action === 'change_role') {
      const select = eventRoleChangeSelect(event, interaction.user.id);
      if (!select) {
        return interaction.reply({ content: 'Nao ha funcoes disponiveis para trocar neste evento.', flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({
        content: 'Escolha sua nova funcao:',
        components: [select],
        flags: MessageFlags.Ephemeral
      });
    }
    if (action === 'join_role') {
      const role = extra;
      try {
        await events.joinEvent(interaction, eventId, role);
      } catch (error) {
        if (String(error.message || '').includes('Nao ha vaga')) {
          return interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
        }
        throw error;
      }
      return interaction.reply({ content: `Voce entrou como ${roleLabel(role)}.`, flags: MessageFlags.Ephemeral });
    }
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
    if (action === 'confirm_cancel') {
      if (extra !== interaction.user.id) {
        return interaction.reply({ content: 'Essa confirmacao nao foi criada para voce.', flags: MessageFlags.Ephemeral });
      }
      if (!canForceStartFinish(interaction.member)) {
        return interaction.reply({ content: 'Somente Staff/ADM podem confirmar cancelamento de evento de outro criador.', flags: MessageFlags.Ephemeral });
      }
      return showModal(interaction, `event:cancel_modal:${eventId}`, 'Cancelar Evento', [
        textInput('reason', 'Motivo do cancelamento')
      ]);
    }
    if (action === 'abort_cancel') {
      return interaction.reply({ content: 'Cancelamento abortado.', flags: MessageFlags.Ephemeral });
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
      const paymentResult = events.approveEventPayment({ eventId, actorId: interaction.user.id });
      const transactions = Array.isArray(paymentResult) ? paymentResult : (paymentResult.transactions || []);
      const raidRewards = await events.grantRaidAvalonRewards({ guild: interaction.guild, eventId, actorId: interaction.user.id });
      if (transactions.length > 0) {
        await finance.notifyBalanceTransactions({ client: interaction.client, transactions });
      }

      let campaignText = '';
      if (paymentResult.campaignChoices?.decisions?.length) {
        const dmResult = await campaigns.sendEventPayoutDms({
          client: interaction.client,
          eventId,
          choices: paymentResult.campaignChoices
        });
        await campaigns.refreshActiveCampaignProgress(interaction.client);
        campaignText = ` Campanha @${paymentResult.campaignChoices.campaign.role_name || '900m'}: ${dmResult.sent} DM(s) enviada(s), ${dmResult.failed} falha(s). Quem nao responder em 24h recebe no saldo normal.`;
      }

      await interaction.message.edit({
        content: `Evento #${eventId} finalizado por <@${interaction.user.id}>.${campaignText}`,
        embeds: [events.reviewEmbed(eventId)],
        components: []
      }).catch(() => {});
      await events.scheduleReviewChannelDeletion(interaction.client, eventId, 14);
      await balanceBackup.postEventBalanceBackup(interaction.client, eventId);
      const raidText = raidRewards.granted || raidRewards.points
        ? ` Carreira: ${raidRewards.points} ponto(s) registrado(s), ${raidRewards.granted} tag(s) nova(s).`
        : '';
      const paymentText = paymentResult.campaignChoices?.decisions?.length
        ? `Pagamento aprovado. O bot perguntou por DM se cada membro quer doar sua parte para @${paymentResult.campaignChoices.campaign.role_name || '900m'}.${campaignText}`
        : 'Pagamento aprovado e saldos depositados.';
      return interaction.editReply({ content: `${paymentText}${raidText}` });
    }
    if (action === 'return_review') {
      if (!can(interaction.member, 'approvePayment')) {
        return interaction.reply({ content: 'Voce nao tem permissao para devolver evento.', flags: MessageFlags.Ephemeral });
      }
      const current = eventsRepo.getEvent(eventId);
      if (!current || current.status !== 'pending_payment') {
        await interaction.message.edit({ components: [] }).catch(() => {});
        return interaction.reply({ content: 'Este evento nao esta pendente de pagamento. O botao foi removido.', flags: MessageFlags.Ephemeral });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const reviewChannel = await events.returnEventToReview({ client: interaction.client, eventId, actorId: interaction.user.id });
      await interaction.message.edit({
        content: `Evento #${eventId} devolvido para revisao por <@${interaction.user.id}>.${reviewChannel ? ` Revisao: <#${reviewChannel.id}>` : ''}`,
        embeds: [events.reviewEmbed(eventId)],
        components: []
      }).catch(() => {});
      return interaction.editReply({ content: `Evento devolvido para o criador revisar.${reviewChannel ? ` Canal: <#${reviewChannel.id}>` : ''}` });
    }
    if (action === 'cancel') {
      if (event.creator_id !== interaction.user.id) {
        if (!canForceStartFinish(interaction.member)) {
          return interaction.reply({ content: 'Somente o criador do evento pode cancelar. Staff/ADM podem cancelar com confirmacao.', flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({
          content: 'Voce esta ciente que esse evento nao foi criado por voce e que vai cancelar o evento do criador, neh?',
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`event:confirm_cancel:${eventId}:${interaction.user.id}`).setLabel('Sim, cancelar').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId(`event:abort_cancel:${eventId}:${interaction.user.id}`).setLabel('Voltar').setStyle(ButtonStyle.Secondary)
            )
          ],
          flags: MessageFlags.Ephemeral
        });
      }
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

    if (action === 'create_list') {
      return showModal(interaction, 'deposit:create_list_modal', 'Deposito por lista', [
        textInput('totalAmount', 'Valor total liquido', true, 'Ex: 48m'),
        textInput('reason', 'Motivo', false, 'Ex: Split DPS meter / ajuste de evento'),
        textInput('names', 'Lista de nomes', true, 'Cole a lista do DPS meter ou um nome por linha', TextInputStyle.Paragraph)
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

    if (action === 'list_confirm') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await deposit.confirmListDraft({ draftId: id, actorId: interaction.user.id, client: interaction.client });
      await clearSourceMessage(interaction, 'Deposito por lista aplicado.');
      return interaction.editReply({
        content: `Deposito por lista aplicado. ${result.participants.length} membro(s) receberam ${formatSilver(result.amount)}. Sobra: ${formatSilver(result.remainder)}.`
      });
    }

    if (action === 'list_cancel') {
      deposit.cancelDraft(id);
      await clearSourceMessage(interaction, 'Deposito por lista cancelado.');
      return interaction.reply({ content: 'Deposito por lista cancelado.', flags: MessageFlags.Ephemeral });
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

  if (interaction.customId === 'finance:payment_request') {
    return showModal(interaction, 'finance:payment_request_modal', 'Pedir Pagamento', [
      textInput('amount', 'Valor pedido', true, 'Ex: 12m ou 12000000'),
      textInput('service', 'O que voce fez?', true, 'Ex: vendi loot da guild'),
      textInput('description', 'Motivo / descricao', true, 'Explique o servico, item, combinado ou venda', TextInputStyle.Paragraph),
      textInput('evidence', 'Print/link/prova', false, 'Ex: https://prnt.sc/... ou "sem print"')
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
      ? `ATENCAO: saldo atual ${formatSilver(currentBalance)}. Se pagar este saque, o membro ficara com ${formatSilver(currentBalance - draft.amount)}.`
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
      content: withdrawRequestContent({
        id: request.lastInsertRowid,
        user_id: interaction.user.id,
        amount: draft.amount,
        note: draft.note,
        status: 'requested'
      }, { warning: negativeWarning }),
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

  if (scope === 'finance' && action === 'confirm_payment_request') {
    const draft = finance.takePaymentRequestDraft(id);
    if (!draft) {
      return interaction.update({ content: 'Essa confirmacao expirou. Abra o pedido novamente.', components: [] });
    }
    if (draft.userId !== interaction.user.id) {
      return interaction.reply({ content: 'Essa confirmacao de pedido nao foi criada para voce.', flags: MessageFlags.Ephemeral });
    }
    const request = finance.requestPayment({
      userId: interaction.user.id,
      amount: draft.amount,
      service: draft.service,
      description: draft.description,
      evidence: draft.evidence
    });
    const requestId = request.lastInsertRowid;
    audit.createAuditLog({
      type: 'payment_request_created',
      actorId: interaction.user.id,
      targetId: interaction.user.id,
      afterValue: draft.amount,
      reason: draft.service,
      metadata: {
        description: draft.description,
        evidence: draft.evidence
      }
    });
    await safeSend(interaction.client, ids.channels.finance, {
      content: paymentRequestContent({
        id: requestId,
        user_id: interaction.user.id,
        amount: draft.amount,
        service: draft.service,
        description: draft.description,
        evidence: draft.evidence,
        status: 'requested'
      }),
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`finance:approve_payment_request:${requestId}`).setLabel('Aprovar e depositar').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`finance:refuse_payment_request:${requestId}`).setLabel('Recusar').setStyle(ButtonStyle.Danger)
        )
      ]
    });
    return interaction.update({ content: `Pedido de pagamento enviado para a staff: ${formatSilver(draft.amount)}.`, components: [] });
  }

  if (scope === 'finance' && action === 'cancel_payment_request') {
    finance.takePaymentRequestDraft(id);
    return interaction.update({ content: 'Pedido de pagamento cancelado. Nada foi enviado para a staff.', components: [] });
  }

  if (scope === 'finance' && action === 'approve_payment_request') {
    if (!can(interaction.member, 'approvePayment')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    const request = financeRepo.getPaymentRequest(Number(id));
    if (!request) return interaction.reply({ content: 'Pedido de pagamento nao encontrado.', flags: MessageFlags.Ephemeral });
    if (request.status === 'approved') {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: 'Esse pedido ja foi aprovado. Removi os botoes antigos.', flags: MessageFlags.Ephemeral });
    }
    if (request.status === 'refused') {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: 'Esse pedido ja foi recusado. Removi os botoes antigos.', flags: MessageFlags.Ephemeral });
    }
    if (request.status !== 'requested') {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: `Esse pedido nao esta pendente. Status atual: ${request.status}.`, flags: MessageFlags.Ephemeral });
    }
    const transaction = finance.approvePaymentRequest({ requestId: Number(id), actorId: interaction.user.id });
    await finance.notifyBalanceTransactions({ client: interaction.client, transactions: [transaction] });
    const approvedRequest = financeRepo.getPaymentRequest(Number(id)) || { ...request, status: 'approved', reviewed_by: interaction.user.id };
    await interaction.message.edit({
      content: paymentRequestContent(approvedRequest, { status: 'approved', reviewedBy: interaction.user.id }),
      components: []
    }).catch(() => {});
    await safeSend(interaction.client, ids.channels.bankLogs, {
      content: `Pedido de pagamento #${id} aprovado por <@${interaction.user.id}>: ${formatSilver(request.amount)} para <@${request.user_id}>. Servico: ${request.service}`
    });
    return interaction.reply({ content: 'Pedido aprovado e saldo depositado.', flags: MessageFlags.Ephemeral });
  }

  if (scope === 'finance' && action === 'refuse_payment_request') {
    if (!can(interaction.member, 'approvePayment')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    const request = financeRepo.getPaymentRequest(Number(id));
    if (!request) return interaction.reply({ content: 'Pedido de pagamento nao encontrado.', flags: MessageFlags.Ephemeral });
    if (request.status === 'approved') {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: 'Esse pedido ja foi aprovado. Nao da para recusar depois do deposito.', flags: MessageFlags.Ephemeral });
    }
    if (request.status === 'refused') {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: 'Esse pedido ja foi recusado. Removi os botoes antigos.', flags: MessageFlags.Ephemeral });
    }
    if (request.status !== 'requested') {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: `Esse pedido nao pode mais ser recusado. Status atual: ${request.status}.`, flags: MessageFlags.Ephemeral });
    }
    finance.refusePaymentRequest({ requestId: Number(id), actorId: interaction.user.id });
    const refusedRequest = financeRepo.getPaymentRequest(Number(id)) || { ...request, status: 'refused', reviewed_by: interaction.user.id };
    await interaction.message.edit({
      content: paymentRequestContent(refusedRequest, { status: 'refused', reviewedBy: interaction.user.id }),
      components: []
    }).catch(() => {});
    const user = await interaction.client.users.fetch(request.user_id).catch(() => null);
    await user?.send(`Seu pedido de pagamento #${id} no valor de ${formatSilver(request.amount)} foi recusado pela staff. Servico: ${request.service}`).catch(() => {});
    return interaction.reply({ content: 'Pedido recusado. Nenhum saldo foi alterado.', flags: MessageFlags.Ephemeral });
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
    const approvedRequest = financeRepo.getWithdrawRequest(Number(id)) || { ...request, status: 'approved', reviewed_by: interaction.user.id };
    await interaction.message.edit({
      content: withdrawRequestContent(approvedRequest, { approvedBy: interaction.user.id }),
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
    const refusedRequest = financeRepo.getWithdrawRequest(Number(id)) || { ...request, status: 'refused', reviewed_by: interaction.user.id };
    await interaction.message.edit({ content: withdrawRequestContent(refusedRequest, { status: 'refused', refusedBy: interaction.user.id }), components: [] }).catch(() => {});
    return interaction.reply({ content: 'Saque recusado. Nenhum saldo foi alterado.', flags: MessageFlags.Ephemeral });
  }

  if (scope === 'finance' && action === 'pay_withdraw') {
    if (!can(interaction.member, 'approvePayment')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    const transaction = finance.payWithdraw({ requestId: Number(id), actorId: interaction.user.id });
    await finance.notifyBalanceTransactions({ client: interaction.client, transactions: [transaction] });
    const paidRequest = financeRepo.getWithdrawRequest(Number(id)) || {
      id: Number(id),
      user_id: transaction.userId,
      amount: Math.abs(transaction.amount),
      status: 'paid',
      paid_by: interaction.user.id
    };
    await interaction.message.edit({ content: withdrawRequestContent(paidRequest, { status: 'paid', paidBy: interaction.user.id }), components: [] }).catch(() => {});
    return interaction.reply({ content: 'Saque pago e saldo descontado.', flags: MessageFlags.Ephemeral });
  }

  if (scope === 'admin_menu') {
    if (!can(interaction.member, 'approvePayment') && !can(interaction.member, 'approveRegistration') && !can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Sem permissao para usar o menu ADM.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({
      ...operations.adminMenuPayload(action),
      flags: MessageFlags.Ephemeral
    });
  }

  if (scope === 'tutorial' && action === 'staff_html') {
    if (!can(interaction.member, 'approvePayment') && !can(interaction.member, 'approveRegistration') && !can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Sem permissao para baixar o tutorial da staff.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({
      content: 'Tutorial HTML gerado.',
      files: [staffTutorial.htmlAttachment()],
      flags: MessageFlags.Ephemeral
    });
  }
  if (interaction.customId === 'admin:remove_balance') {
    if (!can(interaction.member, 'withdrawBalance')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    return interaction.reply({
      content: 'Escolha o membro que vai ter saldo retirado usando a busca do Discord:',
      components: [adminRemoveBalanceUserSelect()],
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === 'admin:refresh_pending_queue') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para atualizar pendencias.', flags: MessageFlags.Ephemeral });
    }
    await operations.refreshPendingQueueMessage(interaction);
    return interaction.reply({ content: 'Fila de pendencias atualizada.', flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'admin:daily_report') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para gerar relatorio ADM.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ ...operations.adminDailyReportPayload(), flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'admin:test_backup') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para testar backup.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ ...operations.backupTestPayload(), flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'admin:pending_html') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para exportar pendencias.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ ...operations.pendingQueueHtmlPayload(), flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'admin:presence_report') {
    if (!can(interaction.member, 'approveRegistration') && !can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para gerar relatorio de presenca.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ ...operations.presenceReportPayload(30), flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'admin:member_rank_html') {
    if (!can(interaction.member, 'approveRegistration') && !can(interaction.member, 'approvePayment') && !can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Sem permissao para gerar rank geral.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return interaction.editReply(await memberProfile.rankHtmlPayload(interaction.guild));
  }

  if (interaction.customId === 'admin:member_profile') {
    if (!can(interaction.member, 'approveRegistration') && !can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para ver perfil de membro.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({
      content: 'Escolha o membro para abrir o perfil:',
      components: [adminMemberProfileUserSelect()],
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === 'admin:refresh_career_panel') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para atualizar carreira.', flags: MessageFlags.Ephemeral });
    }
    await events.refreshRaidAvalonCareerPanel(interaction.client);
    return interaction.reply({ content: 'Painel de carreira atualizado.', flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'admin:preview_career_rebuild') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para recalcular carreira.', flags: MessageFlags.Ephemeral });
    }
    const preview = events.previewCareerRebuild();
    return interaction.reply({
      content: careerRebuildPreviewText(preview),
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`admin:confirm_career_rebuild:${interaction.user.id}`).setLabel('Confirmar recalculo').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('admin:cancel_career_rebuild').setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }

  if (scope === 'admin' && action === 'confirm_career_rebuild') {
    if (id !== interaction.user.id) {
      return interaction.reply({ content: 'Essa confirmacao nao foi criada para voce.', flags: MessageFlags.Ephemeral });
    }
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para recalcular carreira.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = events.rebuildCareerPoints({ actorId: interaction.user.id });
    await events.refreshRaidAvalonCareerPanel(interaction.client);
    return interaction.editReply({ content: careerRebuildResultText(result) });
  }

  if (interaction.customId === 'admin:cancel_career_rebuild') {
    return interaction.reply({ content: 'Recalculo de carreira cancelado.', flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'admin:verify_pending_registrations') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para verificar pedidos pendentes.', flags: MessageFlags.Ephemeral });
    }
      return interaction.reply({
        content: [
        'Use o comando `/sincronizar_albion arquivo:<csv/tsv>` e anexe a lista oficial de membros da guild no Albion.',
        'O bot vai mostrar uma previa antes de salvar vinculos e aprovar pendentes.',
        'Encontrados sao vinculados ao Albion name; registros pendentes encontrados viram Membro.'
      ].join('\n'),
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === 'inactive_events:preview') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para verificar inativos de eventos.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const preview = await inactiveEvents.createPreview({
      guild: interaction.guild,
      actorId: interaction.user.id
    });
    return interaction.editReply(inactiveEvents.previewPayload(preview));
  }

  if (scope === 'inactive_events') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para aplicar inativos de eventos.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'confirm') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await inactiveEvents.applyPreview({
        guild: interaction.guild,
        previewId: id,
        actorId: interaction.user.id
      });
      await interaction.message.edit({ components: [] }).catch(() => {});
      await inactiveEvents.postArchiveLog(interaction.client, result);
      return interaction.editReply(inactiveEvents.applyPayload(result));
    }

    if (action === 'cancel') {
      inactiveEvents.cancelPreview(id, interaction.user.id);
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: 'Verificacao de inativos cancelada. Nenhum cargo foi alterado.', flags: MessageFlags.Ephemeral });
    }
  }

  if (interaction.customId === 'inactive_guests:preview') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para verificar convidados inativos.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const preview = await inactiveGuests.createPreview({
      guild: interaction.guild,
      actorId: interaction.user.id
    });
    return interaction.editReply(inactiveGuests.previewPayload(preview));
  }

  if (scope === 'inactive_guests') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para aplicar convidados inativos.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'confirm') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await inactiveGuests.applyPreview({
        guild: interaction.guild,
        previewId: id,
        actorId: interaction.user.id
      });
      await interaction.message.edit({ components: [] }).catch(() => {});
      await inactiveGuests.postArchiveLog(interaction.client, result);
      return interaction.editReply(inactiveGuests.applyPayload(result));
    }

    if (action === 'cancel') {
      inactiveGuests.cancelPreview(id, interaction.user.id);
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: 'Verificacao de convidados inativos cancelada. Nenhum cargo foi alterado.', flags: MessageFlags.Ephemeral });
    }
  }

  if (scope === 'albion_fame') {
    if (!can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Voce nao tem permissao para importar fama Albion.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'confirm') {
      const preview = albionFame.takePreview(id);
      const result = albionFame.applyPreview(preview);
      return interaction.update({
        content: `Fama total Albion salva. Jogadores: ${result.rowsCount}.`,
        embeds: [],
        components: []
      });
    }

    if (action === 'cancel') {
      albionFame.cancelPreview(id);
      return interaction.update({ content: 'Importacao de fama Albion cancelada.', embeds: [], components: [] });
    }
  }

  if (scope === 'albion_sync') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para sincronizar Albion.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'confirm') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await albionVerification.applyAlbionSyncPreview({
        guild: interaction.guild,
        previewId: id,
        actorId: interaction.user.id
      });
      const reconciliation = await albionVerification.reconcileMemberRoles({
        guild: interaction.guild,
        result,
        actorId: interaction.user.id,
        days: 7
      });
      const notice = await albionVerification.postIdentificationNotice(
        interaction.client,
        reconciliation,
        result.preview.verificationId
      );
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.editReply({
        content: [
          albionVerification.syncApplyText(result),
          `Cargos removidos por nick sem vinculo: ${reconciliation.removedUnlinked}`,
          `Cargos removidos por mais de 7 dias sem call: ${reconciliation.removedInactive}`,
          `Promovidos/recuperados como Membro: ${reconciliation.promoted}`,
          `Falhas ao ajustar cargos: ${reconciliation.failed}`,
          notice.users
            ? `${notice.users} aviso(s) agendado(s) em lotes de 5, a cada 10 minutos, em <#${ids.channels.inactivityNotice}>.`
            : 'Nenhum aviso de identificacao precisou ser publicado.'
        ].join('\n'),
        files: [albionVerification.syncApplyAttachment(result)]
      });
    }

    if (action === 'cancel') {
      albionVerification.cancelAlbionSyncPreview(id, interaction.user.id);
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: 'Sincronizacao cancelada. Nenhum vinculo foi alterado.', flags: MessageFlags.Ephemeral });
    }
  }
  if (scope === 'albion_weekly') {
    if (!can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Voce nao tem permissao para importar dados do Albion.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'help') {
      const command = id === 'rank'
        ? '/albion importar_rank arquivo:<rank pve.txt> semana:2026-W25'
        : '/albion importar_logs arquivo:<logs geral albion.txt> semana:2026-W25';
      return interaction.reply({
        content: [
          `Use o comando:`,
          `\`${command}\``,
          '',
          'O bot vai mostrar uma previa antes de salvar.'
        ].join('\n'),
        flags: MessageFlags.Ephemeral
      });
    }

    if (action === 'summary') {
      return interaction.reply({
        embeds: [albionWeekly.weeklySummaryEmbed()],
        flags: MessageFlags.Ephemeral
      });
    }

    if (action === 'export') {
      const file = id === 'pve'
        ? albionWeekly.pveRankReportAttachment()
        : albionWeekly.guildLogsReportAttachment();
      return interaction.reply({ content: 'Exportacao Albion gerada.', files: [file], flags: MessageFlags.Ephemeral });
    }

    if (action === 'confirm') {
      const preview = albionWeekly.takePreview(id);
      const saved = albionWeekly.applyPreview(preview);
      return interaction.update({
        content: `Importacao Albion salva. Tipo: ${preview.type}. Semana: ${preview.weekKey}. Linhas: ${saved.rows_count}.`,
        embeds: [albionWeekly.weeklySummaryEmbed(preview.weekKey)],
        components: []
      });
    }

    if (action === 'cancel') {
      albionWeekly.cancelPreview(id);
      return interaction.update({ content: 'Importacao Albion cancelada.', components: [] });
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
    return interaction.reply({ content: 'Saldos exportados em HTML. Abra o arquivo e use Baixar CSV se precisar de planilha.', files: [csv.balancesAttachment()], flags: MessageFlags.Ephemeral });
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
    return interaction.reply({ content: 'Logs financeiros exportados em HTML.', files: [csv.transactionsAttachment()], flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'csv:export_audit') {
    if (!can(interaction.member, 'importCsv')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    return interaction.reply({ content: 'Auditoria exportada em HTML.', files: [csv.auditAttachment()], flags: MessageFlags.Ephemeral });
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

function pausedFeatureReply(interaction) {
  return interaction.reply({
    content: 'Esse recurso foi pausado para simplificar o bot. Use os paineis principais de evento, saldo, registro ou ADM.',
    flags: MessageFlags.Ephemeral
  });
}

function careerRebuildPreviewText(preview) {
  return [
    '**Previa do recalculo de carreira**',
    '',
    'Esse processo vai apagar a carreira atual e recriar a partir dos eventos aprovados.',
    'Ele usa o ledger para evitar ponto duplicado por evento/membro/categoria.',
    'Regra nova: Tank, Healer, Suporte, DPS e Caller. Scout/Looter contam como Suporte.',
    '',
    `Eventos aprovados encontrados: ${preview.approvedEvents}`,
    `Eventos com pontos: ${preview.eventsWithPoints}`,
    `Membros afetados: ${preview.uniqueMembers}`,
    `Participacoes com pontos: ${preview.participantsWithPoints}`,
    `Participacoes ignoradas: ${preview.skippedParticipants}`,
    `Movimentos que serao criados: ${preview.transactionsToCreate}`,
    `Pontos totais previstos: ${preview.pointsToCreate}`,
    `Movimentos atuais no ledger: ${preview.existingTransactions}`,
    '',
    'Confirme apenas se voce quer reconstruir a carreira inteira com base no banco atual.'
  ].join('\n');
}

function careerRebuildResultText(result) {
  return [
    '**Carreira recalculada**',
    '',
    `Eventos aprovados analisados: ${result.approvedEvents}`,
    `Eventos com pontos: ${result.eventsWithPoints}`,
    `Membros afetados: ${result.uniqueMembers}`,
    `Movimentos criados: ${result.insertedTransactions}`,
    `Pontos inseridos: ${result.insertedPoints}`,
    `Participacoes ignoradas: ${result.skippedParticipants}`,
    '',
    'O painel de carreira foi atualizado.'
  ].join('\n');
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

function adminMemberProfileUserSelect() {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('admin_profile_select:user')
      .setPlaceholder('Buscar membro para abrir perfil')
      .setMinValues(1)
      .setMaxValues(1)
  );
}

function raidWeaponSelect(eventId, role, discordId) {
  const options = events.raidWeaponRoleOptions(eventId, role, discordId);
  if (!options.length) return null;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`event_raid_weapon_select:weapon:${eventId}:${role}`)
      .setPlaceholder(`Escolher ${roleLabel(role)}`)
      .addOptions(options)
  );
}

function raidWeaponSlotSelect(eventId, discordId) {
  const options = events.raidWeaponSlotOptions(eventId, discordId);
  if (!options.length) return null;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`event_raid_weapon_select:slot:${eventId}`)
      .setPlaceholder('Escolher vaga da Raid Avalon')
      .addOptions(options)
  );
}

function eventRoleChangeSelect(event, discordId) {
  if (!event) return null;
  const participants = eventsRepo.listParticipants(event.id);
  const current = participants.find((participant) => participant.discord_id === discordId && !participant.is_spectator);
  const roleSlots = [
    ['tank', Number(event.tank_slots || 0)],
    ['healer', Number(event.healer_slots || 0)],
    ['support', Number(event.support_slots || 0)],
    ['dps', Number(event.dps_slots || 0)]
  ];
  const options = roleSlots.map(([role, slots]) => {
    const usedByOthers = participants.filter((participant) => (
      participant.role === role && !participant.is_spectator && participant.discord_id !== discordId
    )).length;
    const isCurrent = current?.role === role;
    if (!isCurrent && usedByOthers >= slots) return null;
    if (slots <= 0 && !isCurrent) return null;
    return {
      label: rolePlainLabel(role),
      value: role,
      description: isCurrent ? 'Sua funcao atual' : `${usedByOthers}/${slots} ocupado(s)`
    };
  }).filter(Boolean);

  if (!options.length) return null;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`event:join:${event.id}`)
      .setPlaceholder('Escolher nova funcao')
      .addOptions(options)
  );
}

function rolePlainLabel(role) {
  const labels = {
    tank: 'Tank',
    healer: 'Healer',
    support: 'Suporte',
    dps: 'DPS'
  };
  return labels[role] || role;
}

function roleLabel(role) {
  const labels = {
    tank: '\u{1F6E1}\uFE0F Tank',
    healer: '\u{1F49A} Healer',
    support: '\u{1F6A9} Suporte',
    dps: '\u2694\uFE0F DPS'
  };
  return labels[role] || role;
}
