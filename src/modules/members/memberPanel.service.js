const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase } = require('../../database/connection');
const { parseCsv } = require('../../utils/csv');
const { formatSilver } = require('../../utils/silver');
const { safeSend } = require('../../utils/discord');

const pointsDir = path.resolve(__dirname, '..', '..', '..', 'resources', 'season32');
const normalPointsPath = path.join(pointsDir, 'pontos_normais.csv');
const seasonPointsPath = path.join(pointsDir, 'pontos_temporada.csv');
const buildsUrl = 'https://notag.xyz/builds/pve/Raid/';
const graphUrl = 'https://notag.xyz/S32/pizza.html';
const buildCatalog = [
  {
    category: 'Padrao PVE universal',
    items: [
      ['Incubus'],
      ['Queda Santa'],
      ['Chama Sombra'],
      ['Repetidor', 'https://prnt.sc/j8TM6Ug0Qsve', 'https://albionfreemarket.com/builds/details/6a3418bb65245f624c119f56'],
      ['Prisma'],
      ['Furabruma', 'https://prnt.sc/ShmbQMoteKMi', 'https://albionfreemarket.com/builds/details/6a33dba765245f624c119f2e'],
      ['Fulgurante']
    ]
  },
  {
    category: 'Raid Full',
    items: [
      ['Tank Martelo'],
      ['Tank Incubus'],
      ['Tank Quebra Reinos'],
      ['Healer Queda Santa'],
      ['Healer Corrompido'],
      ['Healer Raiz Ferrea'],
      ['Suporte Chama Sombra'],
      ['Suporte Danacao'],
      ['Suporte Enig'],
      ['DPS Aguia'],
      ['DPS Uivo Frio'],
      ['DPS Repetidor', 'https://prnt.sc/j8TM6Ug0Qsve', 'https://albionfreemarket.com/builds/details/6a3418bb65245f624c119f56'],
      ['DPS Furabruma', 'https://prnt.sc/ShmbQMoteKMi', 'https://albionfreemarket.com/builds/details/6a33dba765245f624c119f2e']
    ]
  },
  {
    category: 'Raid Reduzida',
    items: [
      ['Tank Martelo'],
      ['Tank Incubus'],
      ['Healer Corrompido'],
      ['Suporte Chama Sombra'],
      ['Suporte Danacao'],
      ['DPS Aguia'],
      ['DPS Uivo Frio'],
      ['DPS Repetidor', 'https://prnt.sc/j8TM6Ug0Qsve', 'https://albionfreemarket.com/builds/details/6a3418bb65245f624c119f56']
    ]
  },
  {
    category: 'DG Grupo',
    items: [
      ['Tank Incubus'],
      ['Healer Queda Santa'],
      ['Suporte Chama Sombra'],
      ['DPS Repetidor', 'https://prnt.sc/j8TM6Ug0Qsve', 'https://albionfreemarket.com/builds/details/6a3418bb65245f624c119f56'],
      ['DPS Furabruma', 'https://prnt.sc/ShmbQMoteKMi', 'https://albionfreemarket.com/builds/details/6a33dba765245f624c119f2e']
    ]
  },
  {
    category: 'Bau Dourado',
    items: [
      ['Tank Incubus'],
      ['Healer Queda Santa'],
      ['Suporte Chama Sombra'],
      ['DPS Repetidor', 'https://prnt.sc/j8TM6Ug0Qsve', 'https://albionfreemarket.com/builds/details/6a3418bb65245f624c119f56'],
      ['DPS Furabruma', 'https://prnt.sc/ShmbQMoteKMi', 'https://albionfreemarket.com/builds/details/6a33dba765245f624c119f2e'],
      ['DPS Fulgurante'],
      ['DPS Prisma']
    ]
  },
  {
    category: 'Cacada',
    items: [
      ['Tank Incubus'],
      ['Healer Queda Santa'],
      ['Suporte Chama Sombra'],
      ['DPS Virotes'],
      ['DPS Adaga 1H'],
      ['DPS Susurrante'],
      ['DPS Diabrete']
    ]
  }
];

function panelPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Painel do Membro')
        .setDescription('Consultas rapidas, builds, atendimento com staff, sugestoes e historico pessoal.')
        .setColor(0x38a169)
    ],
    components: panelComponents()
  };
}

function panelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('member_panel:points_normal').setLabel('Pontos influencia').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('member_panel:points_season').setLabel('Pontos temporada').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('member_panel:builds').setLabel('Builds PvE').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('member_panel:history').setLabel('Meu historico').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('member_panel:ask_staff').setLabel('Perguntar staff').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('member_panel:report').setLabel('Denuncia anonima').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('member_panel:suggestion').setLabel('Sugestao').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('member_panel:chat_bot').setLabel('Conversar com bot').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('member_panel:channels').setLabel('Ver/Ocultar').setStyle(ButtonStyle.Secondary)
    )
  ];
}

function pointsEmbed(userId, kind) {
  const user = getUser(userId);
  const lookupName = user?.albion_name || '';
  const file = kind === 'season' ? seasonPointsPath : normalPointsPath;
  const row = findPointsRow(file, lookupName);
  const title = kind === 'season' ? 'Pontos de temporada' : 'Pontos de influencia';

  if (!lookupName) {
    return baseEmbed(title)
      .setDescription('Voce ainda nao tem nick Albion registrado no bot. Use o painel de registro primeiro.');
  }

  if (!row) {
    return baseEmbed(title)
      .setDescription(`Nao encontrei **${lookupName}** no CSV atual.\nGrafico: ${graphUrl}`);
  }

  const total = kind === 'season'
    ? row.season_points_estimado_total
    : row.pontos_normais_total;
  const rank = kind === 'season' ? row.rank_estimado : row.rank_pontos_normais;

  return baseEmbed(title)
    .setDescription(`Consulta para **${lookupName}**`)
    .addFields(
      { name: 'Rank', value: String(rank || '-'), inline: true },
      { name: 'Total', value: numberText(total), inline: true },
      { name: 'Grafico', value: graphUrl, inline: false },
      { name: 'Destaques', value: topPointColumns(row, kind).join('\n') || 'Sem detalhes.', inline: false }
    );
}

function buildsEmbed() {
  return baseEmbed('Builds PvE')
    .setDescription([
      'Catalogo simples para consulta rapida.',
      `Pagina geral temporaria: ${buildsUrl}`,
      'Onde aparecer `pendente`, a staff ainda vai preencher os links.'
    ].join('\n'))
    .addFields(buildCatalog.map((section) => ({
      name: section.category,
      value: section.items.map(buildLine).join('\n'),
      inline: false
    })));
}

function buildLine([name, imageUrl, detailUrl]) {
  const links = [
    imageUrl ? `[img](${imageUrl})` : 'img pendente',
    detailUrl ? `[detalhes](${detailUrl})` : 'detalhes pendente'
  ].join(' | ');
  return `**${name}** - ${links}`;
}

function historyEmbed(userId) {
  const stats = memberStats(userId);
  return baseEmbed('Meu historico')
    .addFields(
      { name: 'Eventos participados', value: String(stats.events), inline: true },
      { name: 'Tempo em eventos', value: formatDuration(stats.eventSeconds), inline: true },
      { name: 'Tempo em voz', value: formatDuration(stats.voiceSeconds), inline: true },
      { name: 'Saldo acumulado', value: formatSilver(stats.earnedSilver), inline: true },
      { name: 'Saldo atual', value: formatSilver(stats.currentBalance), inline: true }
    );
}

function channelsEmbed() {
  return baseEmbed('Canais importantes')
    .setDescription('Por enquanto eu nao vou alterar permissoes automaticamente. Use os atalhos abaixo para navegar pelos canais principais.')
    .addFields({
      name: 'Atalhos',
      value: ids.importantChannels.map((channelId) => `<#${channelId}>`).join('\n'),
      inline: false
    });
}

async function sendMemberQuestion({ client, user, text }) {
  return safeSend(client, ids.channels.memberRequests, {
    content: `Pergunta de <@${user.id}>`,
    embeds: [requestEmbed('Pergunta para staff', text, user)],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`member_panel_staff:answer:${user.id}`).setLabel('Responder membro').setStyle(ButtonStyle.Primary)
      )
    ]
  });
}

async function sendAnonymousReport({ client, text }) {
  return safeSend(client, ids.channels.memberRequests, {
    embeds: [requestEmbed('Denuncia anonima', text, null).setColor(0xe53e3e)]
  });
}

async function sendSuggestion({ client, user, text, anonymous }) {
  return safeSend(client, ids.channels.memberRequests, {
    content: anonymous ? 'Sugestao anonima' : `Sugestao de <@${user.id}>`,
    embeds: [requestEmbed(anonymous ? 'Sugestao anonima' : 'Sugestao', text, anonymous ? null : user)]
  });
}

async function handleBotConversation({ client, user, text }) {
  const answer = keywordAnswer(text);
  if (answer) return { answered: true, answer };

  await safeSend(client, ids.channels.memberRequests, {
    content: `Pergunta nao respondida pelo bot: <@${user.id}>`,
    embeds: [requestEmbed('Atualizar FAQ do bot', text, user)]
  });
  return {
    answered: false,
    answer: 'Ainda nao sei responder isso. Enviei sua pergunta para a staff atualizar minhas respostas.'
  };
}

async function answerMember({ client, staffUser, targetUserId, answer }) {
  const user = await client.users.fetch(targetUserId).catch(() => null);
  if (!user) throw new Error('Nao consegui encontrar o membro para responder.');
  await user.send(`Resposta da staff NOTAG:\n${answer}`);
  return safeSend(client, ids.channels.memberRequests, {
    content: `Resposta enviada para <@${targetUserId}> por <@${staffUser.id}>.`
  });
}

function findPointsRow(file, albionName) {
  const rows = readPoints(file);
  const normalized = normalize(albionName);
  return rows.find((row) => normalize(row.player) === normalized);
}

function readPoints(file) {
  if (!fs.existsSync(file)) return [];
  return parseCsv(fs.readFileSync(file, 'utf8'));
}

function topPointColumns(row, kind) {
  const prefix = kind === 'season' ? 'season_est_' : 'pontos_';
  return Object.entries(row)
    .filter(([key]) => key.startsWith(prefix))
    .filter(([key]) => !key.endsWith('_total') && !key.includes('total'))
    .map(([key, value]) => ({ label: key.replace(prefix, ''), value: Number(value || 0) }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
    .map((item) => `${item.label}: ${numberText(item.value)}`);
}

function memberStats(userId) {
  const db = getDatabase();
  const eventRows = db.prepare(`
    SELECT event_id, COALESCE(manual_seconds, calculated_seconds, 0) AS seconds
    FROM event_participants
    WHERE discord_id = ? AND COALESCE(is_spectator, 0) = 0
  `).all(userId);
  const voice = db.prepare('SELECT COALESCE(SUM(seconds), 0) AS seconds FROM voice_sessions WHERE discord_id = ?').get(userId);
  const earned = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM balance_transactions WHERE user_id = ? AND amount > 0').get(userId);
  const balance = db.prepare('SELECT COALESCE(balance, 0) AS balance FROM balances WHERE discord_id = ?').get(userId);
  return {
    events: new Set(eventRows.map((row) => row.event_id)).size,
    eventSeconds: eventRows.reduce((sum, row) => sum + Number(row.seconds || 0), 0),
    voiceSeconds: Number(voice?.seconds || 0),
    earnedSilver: Number(earned?.total || 0),
    currentBalance: Number(balance?.balance || 0)
  };
}

function getUser(userId) {
  return getDatabase().prepare('SELECT * FROM users WHERE discord_id = ?').get(userId);
}

function keywordAnswer(text) {
  const value = normalize(text);
  if (value.includes('saldo')) return 'Use o painel de saldo ou clique em Meu historico para ver saldo atual e acumulado.';
  if (value.includes('build')) return `As builds PvE estao aqui: ${buildsUrl}`;
  if (value.includes('registro') || value.includes('nick')) return 'Use o canal de registro para informar seu nick do Albion.';
  if (value.includes('evento')) return 'Os eventos ficam no canal de eventos. Clique em participar, assistir ou aguarde o caller iniciar.';
  if (value.includes('ponto')) return `Use os botoes Pontos influencia ou Pontos temporada. Grafico: ${graphUrl}`;
  return null;
}

function requestEmbed(title, text, user) {
  const embed = baseEmbed(title)
    .setDescription(String(text || '').slice(0, 3900));
  if (user) embed.addFields({ name: 'Autor', value: `<@${user.id}>`, inline: true });
  return embed;
}

function baseEmbed(title) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(0x38a169)
    .setTimestamp(new Date());
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}h${String(minutes).padStart(2, '0')}m`;
}

function numberText(value) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

module.exports = {
  answerMember,
  buildsEmbed,
  channelsEmbed,
  handleBotConversation,
  historyEmbed,
  panelPayload,
  pointsEmbed,
  sendAnonymousReport,
  sendMemberQuestion,
  sendSuggestion
};
