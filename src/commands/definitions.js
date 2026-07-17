const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
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
    .setName('mesclar_contas')
    .setDescription('Mescla duas contas Discord do mesmo jogador.')
    .addUserOption((option) => option.setName('principal').setDescription('Conta que permanecera como principal.').setRequired(true))
    .addUserOption((option) => option.setName('secundaria').setDescription('Outra conta do mesmo jogador.').setRequired(true))
    .addStringOption((option) => option.setName('nome').setDescription('Nome publico do jogador (opcional).').setMaxLength(80)),
  new SlashCommandBuilder()
    .setName('publicar_rank')
    .setDescription('Publica manualmente o ranking completo de fama Albion.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) => option.setName('periodo').setDescription('Ranking a publicar').setRequired(true).addChoices(
      { name: 'Diário', value: 'daily' },
      { name: 'Semanal', value: 'weekly' }
    )),
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
      .setMaxValue(1440)),
  new SlashCommandBuilder()
    .setName('verificacao_guild')
    .setDescription('Gerencia a confirmacao dos membros da guilda em voz.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand
      .setName('iniciar')
      .setDescription('Inicia a verificacao usando a lista exportada da guilda.')
      .addAttachmentOption((option) => option.setName('arquivo').setDescription('CSV/TSV com a coluna Character Name.').setRequired(true))
      .addRoleOption((option) => option.setName('cargo_verificado').setDescription('Tag concedida a quem for confirmado.').setRequired(true))
      .addChannelOption((option) => option.setName('sala_recrutamento').setDescription('Sala de voz Recrutamento.').addChannelTypes(ChannelType.GuildVoice).setRequired(true))
      .addChannelOption((option) => option.setName('sala_eventos').setDescription('Sala de voz Aguardando Evento.').addChannelTypes(ChannelType.GuildVoice).setRequired(true))
      .addChannelOption((option) => option.setName('canal_avisos').setDescription('Canal dos lembretes. Padrao: canal de inatividade.').addChannelTypes(ChannelType.GuildText))
      .addStringOption((option) => option.setName('prazo_utc').setDescription('Prazo ISO em UTC. Padrao: 2026-07-24T18:00:00Z.')))
    .addSubcommand((subcommand) => subcommand
      .setName('confirmar')
      .setDescription('Confirma manualmente um jogador depois de falar com ele.')
      .addUserOption((option) => option.setName('membro').setDescription('Membro confirmado.').setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('atualizar').setDescription('Recalcula os 30 minutos com staff e mostra o status.'))
    .addSubcommand((subcommand) => subcommand.setName('status').setDescription('Mostra e exporta a lista atual.'))
    .addSubcommand((subcommand) => subcommand.setName('finalizar').setDescription('Encerra agora e publica a lista restante.'))
];

module.exports = commands.map((command) => command.toJSON());
