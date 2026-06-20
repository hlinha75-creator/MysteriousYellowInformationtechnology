const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { can } = require('../config/permissions');
const { upsertSetupPanels } = require('../modules/setup/panels');
const financeRepo = require('../modules/finance/finance.repository');
const csv = require('../modules/csv/csv.service');
const { formatSilver } = require('../utils/silver');
const albionVerification = require('../modules/albion/guildVerification.service');
const ids = require('../config/ids');
const { formatRenameResults, renameConfiguredChannels } = require('../modules/setup/channelRenamer');
const { auditAttachment, auditGuildChannels, formatAuditSummary } = require('../modules/setup/channelAudit');
const polls = require('../modules/polls/polls.service');
const auctions = require('../modules/auctions/auctions.service');
const objectives = require('../modules/objectives/objectives.service');
const dailyReport = require('../modules/reports/dailyReport.service');
const registration = require('../modules/registration/registration.service');
const albionWeekly = require('../modules/albion/weekly.service');
const memberList = require('../modules/members/memberList.service');

function input(id, label, style = TextInputStyle.Short, required = true) {
  return new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
}

function modal(customId, title, inputs) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(inputs.map((field) => new ActionRowBuilder().addComponents(field)));
}

async function handleCommand(interaction) {
  if (interaction.commandName === 'setup') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Voce nao tem permissao para rodar o setup.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await upsertSetupPanels(interaction.client);
    return interaction.editReply({ content: 'Paineis atualizados.' });
  }

  if (interaction.commandName === 'saldo') {
    const user = interaction.options.getUser('membro') || interaction.user;
    if (user.id !== interaction.user.id && !can(interaction.member, 'withdrawBalance')) {
      return interaction.reply({ content: 'Voce so pode consultar seu proprio saldo.', flags: MessageFlags.Ephemeral });
    }
    const balance = financeRepo.getBalance(user.id);
    return interaction.reply({ content: `Saldo de ${user}: ${formatSilver(balance)} prata.`, flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName === 'registro') {
    return interaction.showModal(modal('registration:submit', 'Registro Albion', [
      input('albionName', 'Nome do personagem no Albion')
    ]));
  }

  if (interaction.commandName === 'enquete') {
    if (!can(interaction.member, 'createPoll')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar enquete.', flags: MessageFlags.Ephemeral });
    }
    return interaction.showModal(modal('poll:create', 'Criar Enquete', [
      input('question', 'Pergunta', TextInputStyle.Short, false)
        .setPlaceholder(polls.defaultQuestion),
      input('options', 'Opcoes separadas por virgula', TextInputStyle.Paragraph, false)
        .setPlaceholder(polls.defaultOptions.join(', '))
    ]));
  }

  if (interaction.commandName === 'leilao') {
    if (!can(interaction.member, 'createAuction')) {
      return interaction.reply({ content: 'Voce precisa ser membro para criar leilao.', flags: MessageFlags.Ephemeral });
    }
    const image = interaction.options.getAttachment('imagem');
    const auctionId = interaction.options.getInteger('codigo');
    if (image && !auctions.isImageAttachment(image)) {
      return interaction.reply({ content: 'O anexo precisa ser uma imagem.', flags: MessageFlags.Ephemeral });
    }

    if (auctionId) {
      if (!image) {
        return interaction.reply({ content: 'Anexe uma imagem para atualizar este leilao.', flags: MessageFlags.Ephemeral });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const auction = await auctions.updateAuctionImage({
        client: interaction.client,
        auctionId,
        imageUrl: image.url,
        actorId: interaction.user.id,
        member: interaction.member
      });
      return interaction.editReply({ content: `Imagem do leilao #${auction.id} atualizada.` });
    }

    const draft = auctions.createDraft({ imageUrl: image?.url });
    return interaction.reply({
      content: 'Escolha em qual canal de texto o leilao sera postado:',
      components: [auctionChannelSelect(draft.id)],
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.commandName === 'objetivo') {
    if (!can(interaction.member, 'createObjective')) {
      return interaction.reply({ content: 'Voce precisa ser membro para avisar objetivo.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await objectives.createObjective(interaction);
    return interaction.editReply({
      content: `Objetivo avisado em <#${result.message.channelId}>. A mensagem sera apagada quando o tempo acabar.`
    });
  }

  if (interaction.commandName === 'exportar') {
    if (!can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Voce nao tem permissao para exportar.', flags: MessageFlags.Ephemeral });
    }
    const type = interaction.options.getString('tipo');
    const date = interaction.options.getString('data');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const attachment = type === 'balances'
      ? csv.balancesAttachment()
      : type === 'transactions'
        ? csv.transactionsAttachment()
        : type === 'voice'
          ? csv.voiceAttachment()
          : type === 'voice_daily'
            ? csv.voiceDailyAttachment(date || undefined)
            : type === 'members_discord'
              ? await memberList.csvAttachment(interaction.guild)
              : type === 'albion_pve'
                ? albionWeekly.pveRankCsvAttachment(date || undefined)
                : type === 'albion_logs'
                ? albionWeekly.guildLogsCsvAttachment(date || undefined)
                : csv.auditAttachment();
    return interaction.editReply({ content: 'Exportacao gerada.', files: [attachment] });
  }

  if (interaction.commandName === 'importar') {
    if (!can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Voce nao tem permissao para importar.', flags: MessageFlags.Ephemeral });
    }
    const attachment = interaction.options.getAttachment('arquivo');
    if (!attachment?.url) {
      return interaction.reply({ content: 'Anexe um CSV valido.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error('Nao consegui baixar o CSV anexado.');
    const csvText = await response.text();
    const preview = csv.previewBalanceImport(csvText);
    const sessionId = csv.saveImportPreview({ preview, actorId: interaction.user.id });
    const sample = preview.changes
      .slice(0, 8)
      .map((change) => `<@${change.userId}>: ${formatSilver(change.before)} -> ${formatSilver(change.after)}`)
      .join('\n') || 'Nenhuma alteracao encontrada.';

    return interaction.editReply({
      content: [
        'Previa da importacao CSV:',
        `Encontrados: ${preview.found}`,
        `Nao encontrados: ${preview.missing}`,
        `Total antes: ${formatSilver(preview.totalBefore)}`,
        `Total depois: ${formatSilver(preview.totalAfter)}`,
        '',
        sample
      ].join('\n'),
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`csv:confirm_import:${sessionId}`).setLabel('Confirmar importacao').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`csv:cancel_import:${sessionId}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
        )
      ]
    });
  }

  if (interaction.commandName === 'aprovar_pendentes') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para verificar pedidos pendentes.', flags: MessageFlags.Ephemeral });
    }

    const attachment = interaction.options.getAttachment('arquivo');
    if (!attachment?.url) {
      return interaction.reply({ content: 'Anexe um CSV/TSV valido.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error('Nao consegui baixar o arquivo anexado.');
    const text = await response.text();
    const { id, preview } = registration.previewPendingGuildRegistrations(text, interaction.user.id);
    return interaction.editReply({
      content: registration.pendingGuildPreviewText(preview),
      files: [registration.pendingGuildPreviewAttachment(preview)],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`registration_bulk:confirm:${id}`).setLabel('Confirmar cargos').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`registration_bulk:cancel:${id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
        )
      ]
    });
  }

  if (interaction.commandName === 'albion') {
    if (!can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Voce nao tem permissao para importar dados do Albion.', flags: MessageFlags.Ephemeral });
    }

    const subcommand = interaction.options.getSubcommand();
    const weekKey = interaction.options.getString('semana') || albionWeekly.currentWeekKey();

    if (subcommand === 'resumo') {
      return interaction.reply({ embeds: [albionWeekly.weeklySummaryEmbed(weekKey)], flags: MessageFlags.Ephemeral });
    }

    const attachment = interaction.options.getAttachment('arquivo');
    if (!attachment?.url) {
      return interaction.reply({ content: 'Anexe um arquivo TXT/CSV/TSV valido.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error('Nao consegui baixar o arquivo anexado.');
    const text = await response.text();
    const preview = subcommand === 'importar_rank'
      ? albionWeekly.previewPveRank(text, { weekKey, sourceName: attachment.name, actorId: interaction.user.id })
      : albionWeekly.previewGuildLogs(text, { weekKey, sourceName: attachment.name, actorId: interaction.user.id });
    const previewId = albionWeekly.savePreview(preview);

    return interaction.editReply({
      content: albionWeekly.previewText(preview),
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`albion_weekly:confirm:${previewId}`).setLabel('Confirmar importacao').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`albion_weekly:cancel:${previewId}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
        )
      ]
    });
  }

  if (interaction.commandName === 'relatorio_diario') {
    if (!can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Voce nao tem permissao para gerar relatorio diario.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await dailyReport.buildDailyReport({
      currentAttachment: interaction.options.getAttachment('atual'),
      previousAttachment: interaction.options.getAttachment('anterior'),
      voiceAttachment: interaction.options.getAttachment('voz'),
      dateText: interaction.options.getString('data')
    });
    return interaction.editReply({ content: result.content, files: result.files });
  }

  if (interaction.commandName === 'auditar_guilda') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para verificar a guild inteira.', flags: MessageFlags.Ephemeral });
    }

    const attachment = interaction.options.getAttachment('arquivo');
    if (!attachment?.url) {
      return interaction.reply({ content: 'Anexe o arquivo exportado do jogo.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error('Nao consegui baixar o arquivo anexado.');
    const text = await response.text();
    const result = await albionVerification.analyzeGuildFromText(interaction.guild, text, interaction.user.id);
    return interaction.editReply({
      content: [
        albionVerification.summarizeAnalysis(result),
        '',
        'Principais pendencias:',
        albionVerification.importantLines(result)
      ].join('\n').slice(0, 1900),
      files: albionVerification.analysisAttachments(result)
    });
  }

  if (interaction.commandName === 'aplicar_verificacao_guild') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para aplicar verificacao de guild.', flags: MessageFlags.Ephemeral });
    }

    const verificationId = interaction.options.getInteger('codigo');
    const action = interaction.options.getString('acao');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (action === 'renomear_parecidos') {
      const results = await albionVerification.applySimilarRenames(interaction.guild, verificationId, interaction.user.id);
      const renamed = results.filter((row) => row.resultado === 'renomeado').length;
      return interaction.editReply({
        content: `Verificacao #${verificationId}: ${renamed}/${results.length} membros renomeados.`,
        files: [albionVerification.actionAttachment(results, `verificacao_${verificationId}_renomes.csv`)]
      });
    }

    if (action === 'perguntar_nao_encontrados') {
      const results = await albionVerification.askMissingMembers(interaction.guild, verificationId);
      const sent = results.filter((row) => row.resultado === 'dm_enviada').length;
      return interaction.editReply({
        content: `Verificacao #${verificationId}: DM enviada para ${sent}/${results.length} membros nao encontrados.`,
        files: [albionVerification.actionAttachment(results, `verificacao_${verificationId}_dms.csv`)]
      });
    }

    return interaction.editReply({ content: 'Acao desconhecida.' });
  }

  if (interaction.commandName === 'renomear_canais') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Voce nao tem permissao para renomear canais.', flags: MessageFlags.Ephemeral });
    }

    const apply = interaction.options.getBoolean('aplicar') ?? false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const results = await renameConfiguredChannels(interaction.guild, ids, { apply });
    return interaction.editReply({ content: formatRenameResults(results, { apply }) });
  }

  if (interaction.commandName === 'auditar_canais') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Voce nao tem permissao para auditar canais.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const rows = await auditGuildChannels(interaction.guild, ids);
    return interaction.editReply({
      content: formatAuditSummary(rows),
      files: [auditAttachment(rows)]
    });
  }

}

module.exports = {
  handleCommand,
  input,
  modal
};

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
