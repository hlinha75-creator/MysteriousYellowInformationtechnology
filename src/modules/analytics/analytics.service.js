const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder
} = require('discord.js');
const repo = require('./analytics.repository');

const dashboardDir = path.resolve(__dirname, '..', '..', '..', 'dashboard');
const reportPath = path.join(dashboardDir, 'relatorio.html');
const reportWindowDays = 30;

const knownFeatures = [
  { type: 'command', name: '/setup', label: 'Atualizar paineis fixos' },
  { type: 'command', name: '/saldo', label: 'Consultar saldo' },
  { type: 'command', name: '/registro', label: 'Registro de nick Albion' },
  { type: 'command', name: '/enquete', label: 'Criar enquete' },
  { type: 'command', name: '/leilao', label: 'Criar ou editar leilao' },
  { type: 'command', name: '/objetivo', label: 'Avisar objetivo temporario' },
  { type: 'command', name: '/exportar', label: 'Exportar HTML/CSV' },
  { type: 'command', name: '/importar', label: 'Importar CSV' },
  { type: 'command', name: '/relatorio_diario', label: 'Relatorio diario' },
  { type: 'command', name: '/sincronizar_albion', label: 'Sincronizar Discord x Albion' },
  { type: 'command', name: '/renomear_canais', label: 'Renomear canais' },
  { type: 'command', name: '/auditar_canais', label: 'Auditar canais' },
  { type: 'button', name: 'panel:create_event', label: 'Criar evento pelo painel' },
  { type: 'button', name: 'panel:create_auction', label: 'Criar leilao pelo painel' },
  { type: 'button', name: 'finance:withdraw', label: 'Solicitar saque' },
  { type: 'button', name: 'deposit:create', label: 'Deposito rapido' },
  { type: 'button', name: 'admin:remove_balance', label: 'Remover saldo manual' },
  { type: 'select', name: 'event:join', label: 'Entrar em evento por funcao' },
  { type: 'select', name: 'poll:vote', label: 'Votar em enquete' },
  { type: 'modal', name: 'event:create', label: 'Formulario de criacao de evento' },
  { type: 'modal', name: 'event:loot', label: 'Revisao de loot' },
  { type: 'modal', name: 'finance:withdraw_modal', label: 'Formulario de saque' },
  { type: 'message', name: 'guild_message', label: 'Mensagens em canais de texto' }
];
const textChannelTypes = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum
].filter((value) => value != null));
if (ChannelType.GuildMedia != null) textChannelTypes.add(ChannelType.GuildMedia);

function channelUsagePanelPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Uso dos canais')
        .setDescription('Gere um HTML para revisar canais de texto e voz menos usados. Texto mede uso ativo: mensagem, botao, comando, menu ou modal. Voz mede entrada e saida da call.')
        .setColor(0x4f46e5)
        .setTimestamp(new Date())
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('analytics:channel_usage:7').setLabel('7 dias').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('analytics:channel_usage:30').setLabel('30 dias').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('analytics:channel_usage:60').setLabel('60 dias').setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

async function channelUsageReportPayload({ guild, days = 30 }) {
  const safeDays = Math.max(1, Math.min(365, Number(days || 30)));
  const channels = await guild.channels.fetch();
  const textStats = new Map(repo.textChannelStats(safeDays).map((row) => [row.channelId, row]));
  const voiceStats = new Map(repo.voiceChannelStats(safeDays).map((row) => [row.channelId, row]));
  const rows = collectChannelUsageRows({ channels, textStats, voiceStats });
  const textRows = rows.filter((row) => row.kind === 'texto');
  const voiceRows = rows.filter((row) => row.kind === 'voz');
  const summary = {
    days: safeDays,
    totalText: textRows.length,
    totalVoice: voiceRows.length,
    textCandidates: textRows.filter((row) => row.status === 'candidato').length,
    voiceCandidates: voiceRows.filter((row) => row.status === 'candidato').length,
    textReview: textRows.filter((row) => row.status === 'revisar').length,
    voiceReview: voiceRows.filter((row) => row.status === 'revisar').length
  };
  const html = renderChannelUsageHtml({
    days: safeDays,
    generatedAt: new Date(),
    summary,
    textRows: sortTextRows(textRows),
    voiceRows: sortVoiceRows(voiceRows)
  });

  return {
    content: `Relatorio de uso dos canais nos ultimos ${safeDays} dias.`,
    files: [
      new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `uso-canais-${safeDays}d.html` })
    ],
    allowedMentions: { parse: [] }
  };
}

function collectChannelUsageRows({ channels, textStats, voiceStats }) {
  const rows = [];
  for (const channel of channels.values()) {
    if (!channel || channel.isThread?.()) continue;
    const categoryName = channel.parent?.name || 'Sem categoria';

    if (textChannelTypes.has(channel.type)) {
      const stats = textStats.get(channel.id) || {};
      const activeEvents = Number(stats.activeEvents || 0);
      const messages = Number(stats.messages || 0);
      const interactions = Number(stats.interactions || 0);
      const uniqueUsers = Number(stats.uniqueUsers || 0);
      rows.push({
        kind: 'texto',
        id: channel.id,
        name: channel.name,
        categoryName,
        type: channelTypeLabel(channel.type),
        activeEvents,
        messages,
        interactions,
        uniqueUsers,
        totalSeconds: 0,
        sessions: 0,
        lastUsedAt: stats.lastUsedAt || '',
        status: textChannelStatus({ activeEvents, uniqueUsers }),
        note: textChannelNote({ activeEvents })
      });
      continue;
    }

    if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
      const stats = voiceStats.get(channel.id) || {};
      const totalSeconds = Number(stats.totalSeconds || 0);
      const sessions = Number(stats.sessions || 0);
      const uniqueUsers = Number(stats.uniqueUsers || 0);
      rows.push({
        kind: 'voz',
        id: channel.id,
        name: channel.name,
        categoryName,
        type: channelTypeLabel(channel.type),
        activeEvents: 0,
        messages: 0,
        interactions: 0,
        uniqueUsers,
        totalSeconds,
        sessions,
        lastUsedAt: stats.lastUsedAt || '',
        status: voiceChannelStatus({ totalSeconds, uniqueUsers, sessions }),
        note: voiceChannelNote({ totalSeconds, sessions })
      });
    }
  }
  return rows;
}

function textChannelStatus({ activeEvents, uniqueUsers }) {
  if (activeEvents <= 0) return 'candidato';
  if (activeEvents <= 2 || uniqueUsers <= 1) return 'revisar';
  return 'manter';
}

function voiceChannelStatus({ totalSeconds, uniqueUsers, sessions }) {
  if (totalSeconds <= 0 && sessions <= 0) return 'candidato';
  if (totalSeconds < 30 * 60 || uniqueUsers <= 1) return 'revisar';
  return 'manter';
}

function textChannelNote({ activeEvents }) {
  if (activeEvents <= 0) return 'Sem uso ativo registrado no periodo.';
  if (activeEvents <= 2) return 'Quase sem uso ativo no periodo.';
  return 'Tem atividade registrada.';
}

function voiceChannelNote({ totalSeconds, sessions }) {
  if (totalSeconds <= 0 && sessions <= 0) return 'Sem entrada em voz registrada no periodo.';
  if (totalSeconds < 30 * 60) return 'Pouco tempo total em voz.';
  return 'Tem uso de voz registrado.';
}

function sortTextRows(rows) {
  return [...rows].sort((a, b) => (
    statusScore(a.status) - statusScore(b.status)
    || a.activeEvents - b.activeEvents
    || lastUsedScore(a.lastUsedAt) - lastUsedScore(b.lastUsedAt)
    || a.name.localeCompare(b.name, 'pt-BR')
  ));
}

function sortVoiceRows(rows) {
  return [...rows].sort((a, b) => (
    statusScore(a.status) - statusScore(b.status)
    || a.totalSeconds - b.totalSeconds
    || a.sessions - b.sessions
    || lastUsedScore(a.lastUsedAt) - lastUsedScore(b.lastUsedAt)
    || a.name.localeCompare(b.name, 'pt-BR')
  ));
}

function statusScore(status) {
  return { candidato: 0, revisar: 1, manter: 2 }[status] ?? 9;
}

function lastUsedScore(value) {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function trackInteraction(interaction) {
  const usage = interactionUsage(interaction);
  if (!usage) return;
  safeRecord(usage);
  scheduleReportRefresh();
}

function trackMessage(message) {
  if (!message || message.author?.bot || !message.guild) return;
  safeRecord({
    eventType: 'message',
    eventName: 'guild_message',
    detail: message.channel?.type ? `channel_type:${message.channel.type}` : '',
    userId: message.author.id,
    channelId: message.channelId,
    channelName: message.channel?.name || ''
  });
}

function interactionUsage(interaction) {
  const base = {
    userId: interaction.user?.id || '',
    channelId: interaction.channelId || '',
    channelName: interaction.channel?.name || ''
  };

  if (interaction.isChatInputCommand?.()) {
    return {
      ...base,
      eventType: 'command',
      eventName: `/${interaction.commandName}`,
      detail: optionSummary(interaction)
    };
  }

  if (interaction.isButton?.()) {
    return {
      ...base,
      eventType: 'button',
      eventName: compactCustomId(interaction.customId),
      detail: interaction.customId
    };
  }

  if (interaction.isStringSelectMenu?.() || interaction.isUserSelectMenu?.() || interaction.isChannelSelectMenu?.()) {
    return {
      ...base,
      eventType: 'select',
      eventName: compactCustomId(interaction.customId),
      detail: interaction.customId
    };
  }

  if (interaction.isModalSubmit?.()) {
    return {
      ...base,
      eventType: 'modal',
      eventName: compactCustomId(interaction.customId),
      detail: interaction.customId
    };
  }

  return null;
}

function safeRecord(event) {
  try {
    repo.recordEvent(event);
  } catch (error) {
    console.error('Falha ao registrar analytics:', error);
  }
}

let refreshTimeout = null;
function scheduleReportRefresh() {
  if (refreshTimeout) return;
  refreshTimeout = setTimeout(() => {
    refreshTimeout = null;
    generateReportHtml().catch((error) => console.error('Falha ao gerar relatorio de uso:', error));
  }, 30000);
}

async function generateReportHtml(days = reportWindowDays) {
  const usage = repo.summarizeUsage(days, 200);
  const channels = repo.summarizeChannels(days, 30);
  const voiceChannels = repo.summarizeVoiceChannels(days, 30);
  const voiceMembers = repo.summarizeVoiceMembers(days, 30);
  const voiceHours = repo.summarizeVoiceHours(days);
  const suggestions = buildSuggestions({ usage, voiceChannels, channels, days });
  const generatedAt = new Date();

  fs.mkdirSync(dashboardDir, { recursive: true });
  fs.writeFileSync(reportPath, renderHtml({
    days,
    generatedAt,
    usage,
    channels,
    voiceChannels,
    voiceMembers,
    voiceHours,
    suggestions
  }));

  return reportPath;
}

function buildSuggestions({ usage, voiceChannels, channels, days }) {
  const byName = new Map(usage.map((row) => [`${row.eventType}:${row.eventName}`, row]));
  const suggestions = [];

  for (const feature of knownFeatures) {
    if (feature.type === 'message') continue;
    const row = byName.get(`${feature.type}:${feature.name}`);
    const total = row?.total || 0;
    if (total === 0) {
      suggestions.push({
        level: 'remover',
        title: `${feature.name} sem uso registrado`,
        text: `${feature.label} nao apareceu nos ultimos ${days} dias. Se voce tambem nao usa, e um bom candidato para remover.`
      });
    } else if (total <= 2) {
      suggestions.push({
        level: 'revisar',
        title: `${feature.name} quase nao usado`,
        text: `${feature.label} teve apenas ${total} uso(s). Vale decidir se simplifica, junta com outro fluxo ou remove.`
      });
    }
  }

  const topVoice = voiceChannels[0];
  if (topVoice) {
    suggestions.unshift({
      level: 'manter',
      title: `Voz forte em ${topVoice.channelName}`,
      text: `Esse canal lidera com ${formatDuration(topVoice.totalSeconds)} em voz. Mantenha facil de achar e considere criar atalhos/paineis perto dele.`
    });
  }

  const topChannel = channels[0];
  if (topChannel) {
    suggestions.unshift({
      level: 'manter',
      title: `Canal mais acionado: ${topChannel.channelName}`,
      text: `Concentrou ${topChannel.total} interacoes/mensagens. Use esse canal como referencia para comunicados e paineis.`
    });
  }

  return suggestions.slice(0, 18);
}

function renderHtml(data) {
  const maxUsage = Math.max(...data.usage.map((row) => row.total), 1);
  const maxVoice = Math.max(...data.voiceChannels.map((row) => row.totalSeconds || 0), 1);
  const totalInteractions = data.usage.reduce((sum, row) => sum + row.total, 0);
  const totalVoiceSeconds = data.voiceChannels.reduce((sum, row) => sum + (row.totalSeconds || 0), 0);

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Relatorio de Uso do Servidor</title>
  <style>
    :root { color-scheme: light; --bg:#f6f7f9; --panel:#fff; --ink:#18212f; --muted:#667085; --line:#d9dee7; --accent:#0f766e; --warn:#b42318; --review:#b54708; --fill:#e7f4f2; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); }
    main { width:min(1180px, calc(100% - 32px)); margin:0 auto; padding:28px 0 44px; }
    header { display:flex; justify-content:space-between; gap:18px; align-items:end; margin-bottom:18px; }
    h1,h2,h3,p { margin:0; }
    h1 { font-size:34px; line-height:1.08; }
    p, .muted { color:var(--muted); line-height:1.5; }
    a { color:var(--accent); font-weight:800; text-decoration:none; }
    .cards { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin:18px 0; }
    .card, section, .suggestion { border:1px solid var(--line); border-radius:8px; background:var(--panel); box-shadow:0 10px 30px rgba(15,23,42,.08); }
    .card { padding:16px; }
    .card span { display:block; color:var(--muted); font-size:12px; font-weight:800; }
    .card strong { display:block; margin-top:6px; font-size:26px; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
    section { min-width:0; overflow:hidden; }
    .head { display:flex; justify-content:space-between; gap:12px; align-items:center; border-bottom:1px solid var(--line); padding:14px 16px; }
    .list { display:grid; gap:10px; padding:16px; }
    .row { display:grid; grid-template-columns:1fr auto; gap:8px; align-items:center; }
    .bar { grid-column:1/-1; height:8px; border-radius:999px; background:#eef2f6; overflow:hidden; }
    .bar span { display:block; height:100%; background:var(--accent); }
    .tag { display:inline-block; margin:2px 5px 2px 0; border-radius:999px; background:#eef2f6; padding:3px 8px; color:#344054; font-size:12px; font-weight:800; }
    .suggestions { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-bottom:14px; }
    .suggestion { padding:15px; border-left-width:5px; }
    .suggestion.manter { border-left-color:var(--accent); }
    .suggestion.revisar { border-left-color:var(--review); }
    .suggestion.remover { border-left-color:var(--warn); }
    .wide { grid-column:1/-1; }
    table { width:100%; border-collapse:collapse; min-width:720px; }
    th,td { border-bottom:1px solid var(--line); padding:10px 12px; text-align:left; font-size:13px; }
    th { background:#f9fafb; color:#344054; text-transform:uppercase; font-size:12px; }
    .table-wrap { overflow:auto; }
    @media (max-width:900px) { header, .grid, .cards, .suggestions { grid-template-columns:1fr; flex-direction:column; align-items:stretch; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Relatorio de uso do servidor</h1>
        <p>Periodo analisado: ultimos ${data.days} dias. Gerado em ${escapeHtml(formatDateTime(data.generatedAt))}.</p>
      </div>
      <a href="index.html">Voltar ao dashboard</a>
    </header>

    <div class="cards">
      <article class="card"><span>Interacoes registradas</span><strong>${number(totalInteractions)}</strong></article>
      <article class="card"><span>Canais com atividade</span><strong>${number(data.channels.length)}</strong></article>
      <article class="card"><span>Horas em voz</span><strong>${formatDuration(totalVoiceSeconds)}</strong></article>
      <article class="card"><span>Canais de voz usados</span><strong>${number(data.voiceChannels.length)}</strong></article>
    </div>

    <div class="suggestions">
      ${data.suggestions.map((item) => `
        <article class="suggestion ${escapeHtml(item.level)}">
          <span class="tag">${escapeHtml(labelLevel(item.level))}</span>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.text)}</p>
        </article>
      `).join('') || '<article class="suggestion manter"><h3>Sem sugestoes ainda</h3><p>O bot precisa acumular uso para sugerir cortes com seguranca.</p></article>'}
    </div>

    <div class="grid">
      <section>
        <div class="head"><h2>Funcoes mais usadas</h2><span class="muted">Comandos, botoes, modais e selects</span></div>
        <div class="list">
          ${data.usage.slice(0, 18).map((row) => `
            <div class="row">
              <strong>${escapeHtml(row.eventName)}</strong>
              <span>${number(row.total)} usos</span>
              <div class="muted">${escapeHtml(row.eventType)} | ${number(row.uniqueUsers)} usuarios | ultimo uso ${escapeHtml(formatDateTime(row.lastUsedAt))}</div>
              <div class="bar"><span style="width:${Math.max(3, Math.round((row.total / maxUsage) * 100))}%"></span></div>
            </div>
          `).join('') || '<p class="muted">Nenhuma interacao registrada ainda.</p>'}
        </div>
      </section>

      <section>
        <div class="head"><h2>Canais de voz mais usados</h2><span class="muted">Tempo total em call</span></div>
        <div class="list">
          ${data.voiceChannels.slice(0, 18).map((row) => `
            <div class="row">
              <strong>${escapeHtml(row.channelName)}</strong>
              <span>${formatDuration(row.totalSeconds)}</span>
              <div class="muted">${escapeHtml(row.categoryName)} | ${number(row.sessions)} sessoes | ${number(row.uniqueUsers)} usuarios</div>
              <div class="bar"><span style="width:${Math.max(3, Math.round(((row.totalSeconds || 0) / maxVoice) * 100))}%"></span></div>
            </div>
          `).join('') || '<p class="muted">Nenhuma sessao de voz registrada ainda.</p>'}
        </div>
      </section>

      <section>
        <div class="head"><h2>Membros mais ativos em voz</h2><span class="muted">Ranking por tempo</span></div>
        <div class="list">
          ${data.voiceMembers.slice(0, 18).map((row) => `
            <div class="row">
              <strong>${escapeHtml(row.displayName)}</strong>
              <span>${formatDuration(row.totalSeconds)}</span>
              <div class="muted">${number(row.sessions)} sessoes | ${number(row.channelsUsed)} canais | visto ${escapeHtml(formatDateTime(row.lastSeenAt))}</div>
            </div>
          `).join('') || '<p class="muted">Nenhum membro em voz registrado ainda.</p>'}
        </div>
      </section>

      <section>
        <div class="head"><h2>Horarios de pico em voz</h2><span class="muted">Por hora de entrada</span></div>
        <div class="list">
          ${data.voiceHours.map((row) => `
            <div class="row">
              <strong>${escapeHtml(row.hour || '00')}:00</strong>
              <span>${formatDuration(row.totalSeconds)}</span>
              <div class="muted">${number(row.sessions)} sessoes iniciadas</div>
            </div>
          `).join('') || '<p class="muted">Ainda nao ha horarios de voz registrados.</p>'}
        </div>
      </section>

      <section class="wide">
        <div class="head"><h2>Tabela completa de uso</h2><span class="muted">Base para decidir o que remover</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Tipo</th><th>Nome</th><th>Detalhe</th><th>Usos</th><th>Usuarios</th><th>Ultimo uso</th></tr></thead>
            <tbody>
              ${data.usage.map((row) => `
                <tr>
                  <td>${escapeHtml(row.eventType)}</td>
                  <td>${escapeHtml(row.eventName)}</td>
                  <td>${escapeHtml(row.detail || '-')}</td>
                  <td>${number(row.total)}</td>
                  <td>${number(row.uniqueUsers)}</td>
                  <td>${escapeHtml(formatDateTime(row.lastUsedAt))}</td>
                </tr>
              `).join('') || '<tr><td colspan="6">Nenhum uso registrado ainda.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </main>
</body>
</html>`;
}

function renderChannelUsageHtml(data) {
  const textCandidates = data.textRows.filter((row) => row.status !== 'manter');
  const voiceCandidates = data.voiceRows.filter((row) => row.status !== 'manter');

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Uso dos canais NOTAG</title>
  <style>
    :root { --bg:#0f172a; --panel:#111827; --card:#1f2937; --line:#334155; --ink:#e5e7eb; --muted:#94a3b8; --green:#22c55e; --yellow:#f59e0b; --red:#ef4444; --blue:#60a5fa; font-family: Arial, sans-serif; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); }
    main { max-width:1200px; margin:0 auto; padding:24px; }
    h1 { margin:0; font-size:28px; }
    h2 { margin:0; font-size:18px; }
    p { color:var(--muted); line-height:1.45; }
    .cards { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin:18px 0; }
    .card, section { background:var(--panel); border:1px solid var(--line); border-radius:8px; }
    .card { padding:14px; }
    .card span { display:block; color:var(--muted); font-size:12px; font-weight:700; }
    .card strong { display:block; margin-top:6px; font-size:24px; }
    section { margin:14px 0; overflow:hidden; }
    .head { display:flex; justify-content:space-between; gap:10px; align-items:center; padding:14px; border-bottom:1px solid var(--line); }
    .body { padding:14px; }
    .legend { display:flex; flex-wrap:wrap; gap:8px; }
    .tag { border-radius:999px; padding:4px 8px; font-size:12px; font-weight:800; background:#334155; color:var(--ink); }
    .tag.candidato { background:rgba(239,68,68,.15); color:#fecaca; }
    .tag.revisar { background:rgba(245,158,11,.15); color:#fde68a; }
    .tag.manter { background:rgba(34,197,94,.15); color:#bbf7d0; }
    .table-actions { display:flex; justify-content:flex-end; margin-bottom:8px; }
    button { border:0; border-radius:7px; padding:8px 10px; background:#2563eb; color:white; font-weight:800; cursor:pointer; }
    table { width:100%; border-collapse:collapse; min-width:780px; }
    th,td { padding:9px 10px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; font-size:13px; }
    th { color:#bfdbfe; background:#020617; position:sticky; top:0; }
    tr:hover td { background:rgba(255,255,255,.04); }
    code { color:#bfdbfe; }
    .wrap { overflow:auto; }
    .muted { color:var(--muted); }
    @media (max-width:800px) { main { padding:12px; } .cards { grid-template-columns:1fr 1fr; } .head { align-items:flex-start; flex-direction:column; } }
  </style>
</head>
<body>
  <main>
    <h1>Uso dos canais NOTAG</h1>
    <p>Periodo: ultimos ${data.days} dias. Gerado em ${escapeHtml(formatDateTime(data.generatedAt))}. Canal de texto mede uso ativo; o Discord nao informa quem apenas leu/abriu o canal.</p>

    <div class="cards">
      <article class="card"><span>Texto analisado</span><strong>${number(data.summary.totalText)}</strong></article>
      <article class="card"><span>Texto para revisar</span><strong>${number(data.summary.textCandidates + data.summary.textReview)}</strong></article>
      <article class="card"><span>Voz analisada</span><strong>${number(data.summary.totalVoice)}</strong></article>
      <article class="card"><span>Voz para revisar</span><strong>${number(data.summary.voiceCandidates + data.summary.voiceReview)}</strong></article>
    </div>

    <section>
      <div class="head">
        <h2>Legenda</h2>
        <div class="legend">
          <span class="tag candidato">candidato</span>
          <span class="tag revisar">revisar</span>
          <span class="tag manter">manter</span>
        </div>
      </div>
      <div class="body">
        <p><strong>candidato</strong>: sem uso registrado no periodo. <strong>revisar</strong>: pouco uso. <strong>manter</strong>: tem uso suficiente para nao parecer vazio.</p>
      </div>
    </section>

    <section>
      <div class="head"><h2>Texto menos usado</h2><span class="muted">${number(textCandidates.length)} canal(is)</span></div>
      ${usageTable(textCandidates, 'texto-menos-usado', ['status', 'name', 'categoryName', 'type', 'activeEvents', 'messages', 'interactions', 'uniqueUsers', 'lastUsedAt', 'note', 'id'])}
    </section>

    <section>
      <div class="head"><h2>Voz menos usada</h2><span class="muted">${number(voiceCandidates.length)} canal(is)</span></div>
      ${usageTable(voiceCandidates, 'voz-menos-usada', ['status', 'name', 'categoryName', 'type', 'sessions', 'uniqueUsers', 'totalTime', 'lastUsedAt', 'note', 'id'])}
    </section>

    <section>
      <div class="head"><h2>Todos os canais de texto</h2><span class="muted">${number(data.textRows.length)} canal(is)</span></div>
      ${usageTable(data.textRows, 'todos-texto', ['status', 'name', 'categoryName', 'type', 'activeEvents', 'messages', 'interactions', 'uniqueUsers', 'lastUsedAt', 'note', 'id'])}
    </section>

    <section>
      <div class="head"><h2>Todos os canais de voz</h2><span class="muted">${number(data.voiceRows.length)} canal(is)</span></div>
      ${usageTable(data.voiceRows, 'todos-voz', ['status', 'name', 'categoryName', 'type', 'sessions', 'uniqueUsers', 'totalTime', 'lastUsedAt', 'note', 'id'])}
    </section>
  </main>
  <script>
    function csvCell(value) {
      const text = String(value == null ? '' : value);
      return /[",\\n\\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    }
    function downloadTableCsv(button, name) {
      const table = button.closest('section').querySelector('table');
      if (!table) return;
      const rows = Array.from(table.querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((cell) => csvCell(cell.innerText.trim())).join(',')).join('\\n');
      const blob = new Blob([rows], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name + '.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }
  </script>
</body>
</html>`;
}

function usageTable(rows, csvName, columns) {
  if (!rows.length) return '<div class="body"><p>Nenhum canal nesta lista.</p></div>';
  return `<div class="body"><div class="table-actions"><button onclick="downloadTableCsv(this, '${escapeHtml(csvName)}')">Baixar CSV</button></div><div class="wrap"><table><thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${formatUsageCell(row, column)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}

function formatUsageCell(row, column) {
  if (column === 'status') return `<span class="tag ${escapeHtml(row.status)}">${escapeHtml(row.status)}</span>`;
  if (column === 'totalTime') return escapeHtml(formatDuration(row.totalSeconds));
  if (column === 'lastUsedAt') return escapeHtml(formatDateTime(row.lastUsedAt));
  if (column === 'id') return `<code>${escapeHtml(row.id)}</code>`;
  return escapeHtml(row[column] ?? '');
}

function compactCustomId(customId) {
  const parts = String(customId || '').split(':').filter(Boolean);
  if (parts.length === 0) return 'unknown';
  if (parts.length === 1) return parts[0];
  return `${parts[0]}:${parts[1]}`;
}

function optionSummary(interaction) {
  const data = interaction.options?.data || [];
  return data.map((option) => option.name).join(', ');
}

function formatDuration(seconds) {
  const value = Number(seconds || 0);
  const hours = value / 3600;
  if (hours >= 10) return `${Math.round(hours)}h`;
  if (hours >= 1) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round(value / 60)}min`;
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo'
  }).format(date);
}

function labelLevel(level) {
  return {
    manter: 'Manter',
    revisar: 'Revisar',
    remover: 'Candidato a remover'
  }[level] || level;
}

function channelTypeLabel(type) {
  return {
    [ChannelType.GuildText]: 'texto',
    [ChannelType.GuildAnnouncement]: 'anuncio',
    [ChannelType.GuildForum]: 'forum',
    [ChannelType.GuildVoice]: 'voz',
    [ChannelType.GuildStageVoice]: 'palco',
    [ChannelType.GuildMedia]: 'midia'
  }[type] || String(type);
}

function number(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

module.exports = {
  channelUsagePanelPayload,
  channelUsageReportPayload,
  generateReportHtml,
  reportPath,
  trackInteraction,
  trackMessage
};
