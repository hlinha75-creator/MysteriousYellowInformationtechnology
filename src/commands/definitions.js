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
    .setName('enquete')
    .setDescription('Cria uma enquete no canal de eventos.'),
  new SlashCommandBuilder()
    .setName('leilao')
    .setDescription('Cria um leilao de item para membros da guild.')
    .addIntegerOption((option) => option
      .setName('codigo')
      .setDescription('Codigo do leilao para trocar a imagem depois. Opcional.'))
    .addAttachmentOption((option) => option
      .setName('imagem')
      .setDescription('Imagem do item do leilao. Opcional.')),
  new SlashCommandBuilder()
    .setName('objetivo')
    .setDescription('Avisa um objetivo temporario no chat notag.')
    .addStringOption((option) => option
      .setName('alerta')
      .setDescription('Formato: tipo, mapa, tempo. Ex: orb roxa, ho loch, 5min')
      .setRequired(true))
    .addAttachmentOption((option) => option
      .setName('imagem')
      .setDescription('Print do objetivo. Opcional.')),
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
        { name: 'Auditoria', value: 'audit' },
        { name: 'Voz diaria', value: 'voice_daily' },
        { name: 'Voz bruta', value: 'voice' },
        { name: 'Membros Discord', value: 'members_discord' },
        { name: 'Albion Rank PvE', value: 'albion_pve' },
        { name: 'Albion Logs', value: 'albion_logs' }
      ))
    .addStringOption((option) => option
      .setName('data')
      .setDescription('Data para voz AAAA-MM-DD ou semana Albion 2026-W25.')),
  new SlashCommandBuilder()
    .setName('list')
    .setDescription('Gera lista HTML filtravel de saldos com Discord e Albion.'),
  new SlashCommandBuilder()
    .setName('importar')
    .setDescription('Importa CSV de saldos. Use o painel/fluxo com confirmacao.')
    .addAttachmentOption((option) => option.setName('arquivo').setDescription('CSV de saldos').setRequired(true)),
  new SlashCommandBuilder()
    .setName('aprovar_pendentes')
    .setDescription('Aprova pedidos pendentes de registro usando CSV/TSV da guild Albion.')
    .addAttachmentOption((option) => option
      .setName('arquivo')
      .setDescription('CSV/TSV com os nicks oficiais da guild no Albion.')
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('albion')
    .setDescription('Importa e consulta dados semanais manuais do Albion.')
    .addSubcommand((subcommand) => subcommand
      .setName('importar_rank')
      .setDescription('Importa o Rank PvE semanal do Albion.')
      .addAttachmentOption((option) => option
        .setName('arquivo')
        .setDescription('Arquivo TXT/CSV/TSV do Rank PvE.')
        .setRequired(true))
      .addStringOption((option) => option
        .setName('semana')
        .setDescription('Semana do arquivo. Ex: 2026-W25. Sem preencher, usa semana atual.')))
    .addSubcommand((subcommand) => subcommand
      .setName('importar_logs')
      .setDescription('Importa os logs gerais semanais da guild Albion.')
      .addAttachmentOption((option) => option
        .setName('arquivo')
        .setDescription('Arquivo TXT/CSV/TSV dos logs gerais.')
        .setRequired(true))
      .addStringOption((option) => option
        .setName('semana')
        .setDescription('Semana do arquivo. Ex: 2026-W25. Sem preencher, usa semana atual.')))
    .addSubcommand((subcommand) => subcommand
      .setName('resumo')
      .setDescription('Mostra resumo semanal dos dados importados do Albion.')
      .addStringOption((option) => option
        .setName('semana')
        .setDescription('Semana para consultar. Ex: 2026-W25. Sem preencher, usa semana atual.'))),
  new SlashCommandBuilder()
    .setName('relatorio_diario')
    .setDescription('Gera relatorio diario comparando membros Albion e voz Discord.')
    .addAttachmentOption((option) => option
      .setName('atual')
      .setDescription('Arquivo atual de membros do Albion.')
      .setRequired(true))
    .addAttachmentOption((option) => option
      .setName('anterior')
      .setDescription('Arquivo anterior de membros do Albion para comparar.'))
    .addAttachmentOption((option) => option
      .setName('voz')
      .setDescription('CSV diario de voz gerado pelo bot.'))
    .addStringOption((option) => option
      .setName('data')
      .setDescription('Data do relatorio no formato AAAA-MM-DD.')),
  new SlashCommandBuilder()
    .setName('auditar_guilda')
    .setDescription('Audita membros do Discord contra a guild do Albion.')
    .addAttachmentOption((option) => option
      .setName('arquivo')
      .setDescription('Arquivo exportado do jogo com a coluna Character Name.')
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('aplicar_verificacao_guild')
    .setDescription('Aplica uma verificacao de guild ja analisada.')
    .addIntegerOption((option) => option
      .setName('codigo')
      .setDescription('Codigo da verificacao gerado no relatorio.')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('acao')
      .setDescription('Acao para aplicar.')
      .setRequired(true)
      .addChoices(
        { name: 'Renomear parecidos', value: 'renomear_parecidos' },
        { name: 'Perguntar nao encontrados', value: 'perguntar_nao_encontrados' }
      )),
  new SlashCommandBuilder()
    .setName('renomear_canais')
    .setDescription('Mostra ou aplica a padronizacao de nomes dos canais do bot.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((option) => option
      .setName('aplicar')
      .setDescription('Use sim para renomear de verdade. Sem isso, mostra so a previa.')),
  new SlashCommandBuilder()
    .setName('auditar_canais')
    .setDescription('Lista todos os canais/categorias do servidor e marca os conhecidos pelo bot.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
];

module.exports = commands.map((command) => command.toJSON());
