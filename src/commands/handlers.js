const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { can } = require('../config/permissions');
const { upsertSetupPanels } = require('../modules/setup/panels');
const financeRepo = require('../modules/finance/finance.repository');
const csv = require('../modules/csv/csv.service');
const { formatSilver } = require('../utils/silver');

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
