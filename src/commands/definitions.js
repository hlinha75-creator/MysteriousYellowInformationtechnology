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
    .setName('registro')
    .setDescription('Abre registro de nome em jogo.'),
  new SlashCommandBuilder()
    .setName('exportar')
    .setDescription('Exporta dados em HTML com botao para baixar CSV.')
    .addStringOption((option) => option
      .setName('tipo')
      .setDescription('Tipo de exportacao')
      .setRequired(true)
      .addChoices(
        { name: 'Saldos', value: 'balances' },
        { name: 'Financeiro', value: 'transactions' },
        { name: 'Auditoria', value: 'audit' },
        { name: 'Voz diaria', value: 'voice_daily' },
        { name: 'Voz bruta', value: 'voice' },
        { name: 'Membros Discord', value: 'members_discord' }
      ))
    .addStringOption((option) => option
      .setName('data')
      .setDescription('Data para relatorio de voz no formato AAAA-MM-DD.')),
  new SlashCommandBuilder()
    .setName('importar')
    .setDescription('Importa CSV de saldos. Use o painel/fluxo com confirmacao.')
    .addAttachmentOption((option) => option.setName('arquivo').setDescription('CSV de saldos').setRequired(true)),
  new SlashCommandBuilder()
    .setName('sincronizar_albion')
    .setDescription('Sincroniza dados manuais do Albion.')
    .addAttachmentOption((option) => option
      .setName('arquivo')
      .setDescription('CSV/TSV exportado do Albion.')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('tipo')
      .setDescription('Tipo de sincronizacao')
      .addChoices(
        { name: 'Membros da guild', value: 'membros' },
        { name: 'Fama total', value: 'fama_total' },
        { name: 'Fama PvE', value: 'fama_pve' }
      )),
  new SlashCommandBuilder()
    .setName('inativos')
    .setDescription('Gera previa de inatividade para eventos ou convidados.')
    .addStringOption((option) => option
      .setName('tipo')
      .setDescription('Qual verificacao rodar')
      .setRequired(true)
      .addChoices(
        { name: 'Eventos: Membro para Convidado', value: 'eventos' },
        { name: 'Convidados: Convidado para Sem Tag', value: 'convidados' }
      ))
    .addIntegerOption((option) => option
      .setName('dias_minimos')
      .setDescription('Janela de dias. Padrao: 30.')
      .setMinValue(1)
      .setMaxValue(365))
    .addIntegerOption((option) => option
      .setName('tempo_minimo')
      .setDescription('Eventos: minutos minimos na janela para nao rebaixar. Padrao: 15.')
      .setMinValue(1)
      .setMaxValue(1440))
];

module.exports = commands.map((command) => command.toJSON());
