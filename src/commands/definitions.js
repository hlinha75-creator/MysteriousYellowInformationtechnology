const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Posta ou atualiza os paineis fixos do bot.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('saldo')
    .setDescription('Consulta saldo.')
    .addUserOption((option) => option.setName('membro').setDescription('Membro para consultar.')),
  new SlashCommandBuilder()
    .setName('evento')
    .setDescription('Manutencao de eventos.')
    .addStringOption((option) => option.setName('codigo').setDescription('Codigo do evento, ex: EVT-000001').setRequired(true)),
  new SlashCommandBuilder()
    .setName('registro')
    .setDescription('Abre registro de nome em jogo.'),
  new SlashCommandBuilder()
    .setName('exportar')
    .setDescription('Exporta dados em CSV.')
    .addStringOption((option) => option
      .setName('tipo')
      .setDescription('Tipo de exportacao')
      .setRequired(true)
      .addChoices(
        { name: 'Saldos', value: 'balances' },
        { name: 'Financeiro', value: 'transactions' },
        { name: 'Auditoria', value: 'audit' }
      )),
  new SlashCommandBuilder()
    .setName('importar')
    .setDescription('Importa CSV de saldos. Use o painel/fluxo com confirmacao.')
    .addAttachmentOption((option) => option.setName('arquivo').setDescription('CSV de saldos').setRequired(true)),
  new SlashCommandBuilder()
    .setName('verificar_membro')
    .setDescription('Verifica se um membro do Discord esta na guild do Albion.')
    .addUserOption((option) => option.setName('membro').setDescription('Membro para verificar.')),
  new SlashCommandBuilder()
    .setName('verificar_guild')
    .setDescription('Verifica os membros do Discord contra a guild do Albion.')
    .addBooleanOption((option) => option
      .setName('avisar_nao_encontrados')
      .setDescription('Envia DM pedindo confirmacao de nick para quem nao for encontrado.'))
];

module.exports = commands.map((command) => command.toJSON());
