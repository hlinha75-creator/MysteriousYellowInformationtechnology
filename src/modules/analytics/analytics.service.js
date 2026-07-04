const fs = require('fs');
const path = require('path');
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
  generateReportHtml,
  reportPath,
  trackInteraction,
  trackMessage
};
