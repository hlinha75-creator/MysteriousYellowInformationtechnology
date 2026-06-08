const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
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
      return interaction.reply({ content: 'Voce nao tem permissao para rodar o setup.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    await upsertSetupPanels(interaction.client);
    return interaction.editReply({ content: 'Paineis atualizados.' });
  }

  if (interaction.commandName === 'saldo') {
    const user = interaction.options.getUser('membro') || interaction.user;
    if (user.id !== interaction.user.id && !can(interaction.member, 'withdrawBalance')) {
      return interaction.reply({ content: 'Voce so pode consultar seu proprio saldo.', ephemeral: true });
    }
    const balance = financeRepo.getBalance(user.id);
    return interaction.reply({ content: `Saldo de ${user}: ${formatSilver(balance)} prata.`, ephemeral: true });
  }

  if (interaction.commandName === 'registro') {
    return interaction.showModal(modal('registration:submit', 'Registro Albion', [
      input('albionName', 'Nome do personagem no Albion')
    ]));
  }

  if (interaction.commandName === 'enquete') {
    if (!can(interaction.member, 'createPoll')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar enquete.', ephemeral: true });
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
      return interaction.reply({ content: 'Voce precisa ser membro para criar leilao.', ephemeral: true });
    }
    const image = interaction.options.getAttachment('imagem');
    const draft = auctions.createDraft({ imageUrl: image?.url });
    return interaction.reply({
      content: 'Escolha em qual canal de texto o leilao sera postado:',
      components: [auctionChannelSelect(draft.id)],
      ephemeral: true
    });
  }

  if (interaction.commandName === 'objetivo') {
    if (!can(interaction.member, 'createObjective')) {
      return interaction.reply({ content: 'Voce precisa ser membro para avisar objetivo.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const result = await objectives.createObjective(interaction);
    return interaction.editReply({
      content: `Objetivo avisado em <#${result.message.channelId}>. A mensagem sera apagada quando o tempo acabar.`
    });
  }

  if (interaction.commandName === 'exportar') {
    if (!can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Voce nao tem permissao para exportar.', ephemeral: true });
    }
    const type = interaction.options.getString('tipo');
    const attachment = type === 'balances'
      ? csv.balancesAttachment()
      : type === 'transactions'
        ? csv.transactionsAttachment()
        : csv.auditAttachment();
    return interaction.reply({ content: 'Exportacao gerada.', files: [attachment], ephemeral: true });
  }

  if (interaction.commandName === 'importar') {
    if (!can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Voce nao tem permissao para importar.', ephemeral: true });
    }
    const attachment = interaction.options.getAttachment('arquivo');
    if (!attachment?.url) {
      return interaction.reply({ content: 'Anexe um CSV valido.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
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

  if (interaction.commandName === 'verificar_membro') {
    const user = interaction.options.getUser('membro') || interaction.user;
    if (user.id !== interaction.user.id && !can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce so pode verificar voce mesmo.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const member = await interaction.guild.members.fetch(user.id);
    const result = await albionVerification.verifyDiscordMember(member);
    const player = result.player;
    return interaction.editReply({
      content: [
        `Discord: <@${result.discordId}>`,
        `Nome usado: ${result.guessedName || 'nao informado'}`,
        `Albion: ${player?.name || 'nao encontrado'}`,
        `Guild no Albion: ${player?.guildName || 'sem guild/nao encontrada'}`,
        `Guild esperada: ${result.expectedGuild}`,
        `Cargo Membro no Discord: ${result.hasMemberRole ? 'sim' : 'nao'}`,
        `Status: ${result.status}`,
        result.reason ? `Motivo: ${result.reason}` : null
      ].filter(Boolean).join('\n')
    });
  }

  if (interaction.commandName === 'verificar_guild') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para verificar a guild inteira.', ephemeral: true });
    }

    const notifyMissing = interaction.options.getBoolean('avisar_nao_encontrados') ?? true;
    await interaction.deferReply({ ephemeral: true });
    const results = await albionVerification.verifyGuildMembers(interaction.guild, { notifyMissing });
    return interaction.editReply({
      content: [
        albionVerification.summarizeResults(results),
        '',
        'Divergencias principais:',
        albionVerification.importantLines(results),
        '',
        notifyMissing ? 'DM enviada para os nao encontrados quando possivel.' : 'DM para nao encontrados desativada nesta execucao.'
      ].join('\n').slice(0, 1900),
      files: [albionVerification.csvAttachment(results)]
    });
  }

  if (interaction.commandName === 'renomear_canais') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Voce nao tem permissao para renomear canais.', ephemeral: true });
    }

    const apply = interaction.options.getBoolean('aplicar') ?? false;
    await interaction.deferReply({ ephemeral: true });
    const results = await renameConfiguredChannels(interaction.guild, ids, { apply });
    return interaction.editReply({ content: formatRenameResults(results, { apply }) });
  }

  if (interaction.commandName === 'auditar_canais') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Voce nao tem permissao para auditar canais.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const rows = await auditGuildChannels(interaction.guild, ids);
    return interaction.editReply({
      content: formatAuditSummary(rows),
      files: [auditAttachment(rows)]
    });
  }

  if (interaction.commandName === 'evento') {
    const code = interaction.options.getString('codigo');
    return interaction.reply({ content: `Manutencao do evento ${code} sera feita pelos paineis do evento.`, ephemeral: true });
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
