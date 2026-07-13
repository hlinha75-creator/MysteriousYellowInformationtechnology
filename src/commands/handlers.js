const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
const objectives = require('../modules/objectives/objectives.service');
const dailyReport = require('../modules/reports/dailyReport.service');
const albionWeekly = require('../modules/albion/weekly.service');
const albionFame = require('../modules/albion/fame.service');
const memberList = require('../modules/members/memberList.service');
const inactiveEvents = require('../modules/members/inactiveEvents.service');
const inactiveGuests = require('../modules/members/inactiveGuests.service');
const dailyPveRanking = require('../modules/albion/dailyPveRanking.service');

const pausedCommands = new Set([
  'albion',
  'auditar_canais',
  'list',
  'objetivo',
  'relatorio_diario',
  'renomear_canais'
]);

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
  if (pausedCommands.has(interaction.commandName)) {
    return interaction.reply({
      content: 'Esse comando foi pausado para simplificar o bot. Use os comandos principais de evento, saldo, registro, exportacao/importacao, sincronizacao ou inativos.',
      flags: MessageFlags.Ephemeral
    });
  }

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

  if (interaction.commandName === 'publicar_rank') {
    if (!can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Voce nao tem permissao para publicar rankings.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const period = interaction.options.getString('periodo');
    const result = period === 'daily'
      ? await dailyPveRanking.replaceDailyRanking(interaction.client)
      : await dailyPveRanking.publishRanking(interaction.client, { period });
    return interaction.editReply({
      content: period === 'daily' && result.replacedMessageId
        ? `Ranking diario de hoje atualizado em <#${result.channelId}>; a publicacao anterior foi removida.`
        : `Ranking ${period === 'weekly' ? 'semanal' : 'diario'} publicado em <#${result.channelId}> com ${result.totalPlayers} jogadores.`
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
                ? albionWeekly.pveRankReportAttachment(date || undefined)
                : type === 'albion_logs'
                ? albionWeekly.guildLogsReportAttachment(date || undefined)
                : csv.auditAttachment();
    return interaction.editReply({ content: 'Exportacao HTML gerada. Abra o arquivo e use Baixar CSV se precisar de planilha.', files: [attachment] });
  }

  if (interaction.commandName === 'list') {
    if (!can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Voce nao tem permissao para gerar a lista.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return interaction.editReply({
      content: 'Lista HTML de saldos gerada.',
      files: [await csv.balancesHtmlAttachment(interaction.guild)]
    });
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
      files: [csv.importPreviewAttachment(preview)],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`csv:confirm_import:${sessionId}`).setLabel('Confirmar importacao').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`csv:cancel_import:${sessionId}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
        )
      ]
    });
  }

  if (interaction.commandName === 'sincronizar_albion') {
    const syncType = interaction.options.getString('tipo') || 'membros';
    const requiredPermission = ['fama_total', 'fama_pve'].includes(syncType) ? 'importCsv' : 'approveRegistration';
    if (!can(interaction.member, requiredPermission)) {
      return interaction.reply({ content: 'Voce nao tem permissao para sincronizar esse tipo de dado Albion.', flags: MessageFlags.Ephemeral });
    }

    const attachment = interaction.options.getAttachment('arquivo');
    if (!attachment?.url) {
      return interaction.reply({ content: 'Anexe um CSV/TSV valido.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error('Nao consegui baixar o arquivo anexado.');
    const text = await response.text();

    if (['fama_total', 'fama_pve'].includes(syncType)) {
      const preview = syncType === 'fama_pve'
        ? albionFame.previewPveFame(text, {
          sourceName: attachment.name,
          actorId: interaction.user.id
        })
        : albionFame.previewFameTotals(text, {
          sourceName: attachment.name,
          actorId: interaction.user.id
        });
      const previewId = albionFame.savePreview(preview);
      return interaction.editReply({
        content: albionFame.previewText(preview),
        files: [albionFame.previewAttachment(preview)],
        components: albionFame.confirmComponents(previewId)
      });
    }

    const { id, preview } = await albionVerification.previewAlbionSync(interaction.guild, text, interaction.user.id);
    return interaction.editReply({
      content: albionVerification.syncPreviewText(preview),
      files: [albionVerification.syncPreviewAttachment(preview)],
      allowedMentions: { parse: [] },
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`albion_sync:confirm:${id}`).setLabel('Confirmar sincronizacao').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`albion_sync:cancel:${id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
        )
      ]
    });
  }
  if (interaction.commandName === 'inativos') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para verificar inativos.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const type = interaction.options.getString('tipo');
    if (type === 'eventos') {
      const preview = await inactiveEvents.createPreview({
        guild: interaction.guild,
        actorId: interaction.user.id,
        daysMin: interaction.options.getInteger('dias_minimos') || inactiveEvents.defaultDaysMin,
        minutesMin: interaction.options.getInteger('tempo_minimo') || inactiveEvents.defaultMinutesMin
      });
      return interaction.editReply(inactiveEvents.previewPayload(preview));
    }

    const preview = await inactiveGuests.createPreview({
      guild: interaction.guild,
      actorId: interaction.user.id,
      daysMin: interaction.options.getInteger('dias_minimos') || inactiveGuests.defaultDaysMin
    });
    return interaction.editReply(inactiveGuests.previewPayload(preview));
  }
  if (interaction.commandName === 'inativos_evento') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para verificar inativos de eventos.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const preview = await inactiveEvents.createPreview({
      guild: interaction.guild,
      actorId: interaction.user.id,
      daysMin: interaction.options.getInteger('dias_minimos') || inactiveEvents.defaultDaysMin,
      minutesMin: interaction.options.getInteger('tempo_minimo') || inactiveEvents.defaultMinutesMin
    });
    return interaction.editReply(inactiveEvents.previewPayload(preview));
  }

  if (interaction.commandName === 'inativos_convidados') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para verificar convidados inativos.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const preview = await inactiveGuests.createPreview({
      guild: interaction.guild,
      actorId: interaction.user.id,
      daysMin: interaction.options.getInteger('dias_minimos') || inactiveGuests.defaultDaysMin
    });
    return interaction.editReply(inactiveGuests.previewPayload(preview));
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
