const { AttachmentBuilder } = require('discord.js');
const { backupDatabase } = require('../../database/backup');
const { transaction } = require('../../database/connection');
const { parseSilver } = require('../../utils/silver');
const { parseCsv, toCsv } = require('../../utils/csv');
const audit = require('../audit/audit.repository');
const financeRepo = require('../finance/finance.repository');
const registrationRepo = require('../registration/registration.repository');
const finance = require('../finance/finance.service');
const voiceRepo = require('../voice/voice.repository');

const importPreviews = new Map();

function balancesAttachment() {
  const rows = financeRepo.listBalances();
  const csv = toCsv(rows, ['discord_id', 'discord_name', 'albion_name', 'balance', 'last_updated']);
  return new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: 'saldos-guilda.csv' });
}

function balancesHtmlAttachment() {
  const rows = financeRepo.listAllBalances().map((row) => ({
    discord_id: row.discord_id || '',
    discord_name: row.discord_name || '',
    albion_name: row.albion_name || '',
    balance: Number(row.balance || 0),
    last_updated: row.last_updated || ''
  }));
  return new AttachmentBuilder(Buffer.from(renderBalancesHtml(rows), 'utf8'), { name: 'saldos-guilda.html' });
}

function renderBalancesHtml(rows) {
  const generatedAt = new Date().toISOString();
  const json = JSON.stringify(rows).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Saldos da guilda</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #1f2937;
      --muted: #667085;
      --line: #d9dee7;
      --accent: #0f766e;
      --danger: #b42318;
      --warn: #b54708;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(1180px, calc(100% - 32px));
      margin: 24px auto 40px;
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-end;
      margin-bottom: 18px;
    }
    h1 { margin: 0 0 6px; font-size: 28px; }
    p { margin: 0; color: var(--muted); }
    .filters, .metrics, .table-wrap {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .filters {
      display: grid;
      grid-template-columns: minmax(220px, 1.3fr) repeat(4, minmax(140px, 1fr));
      gap: 12px;
      padding: 14px;
      margin-bottom: 14px;
    }
    label {
      display: grid;
      gap: 6px;
      font-size: 12px;
      font-weight: 700;
      color: var(--muted);
      text-transform: uppercase;
    }
    input, select {
      width: 100%;
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px 10px;
      font: inherit;
      color: var(--text);
      background: #fff;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1px;
      overflow: hidden;
      margin-bottom: 14px;
    }
    .metric {
      padding: 14px;
      background: #fff;
    }
    .metric span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .metric strong {
      display: block;
      margin-top: 5px;
      font-size: 22px;
    }
    .table-wrap { overflow: auto; }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 860px;
      background: #fff;
    }
    th, td {
      padding: 11px 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }
    th {
      position: sticky;
      top: 0;
      background: #f8fafc;
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      z-index: 1;
    }
    td.amount, th.amount { text-align: right; }
    .name { font-weight: 800; }
    .sub { color: var(--muted); font-size: 13px; margin-top: 2px; }
    .positive { color: var(--accent); font-weight: 800; }
    .negative { color: var(--danger); font-weight: 800; }
    .zero { color: var(--warn); font-weight: 800; }
    .empty {
      padding: 28px;
      text-align: center;
      color: var(--muted);
    }
    @media (max-width: 820px) {
      main { width: min(100% - 20px, 1180px); margin-top: 14px; }
      header { display: block; }
      .filters { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Saldos da guilda</h1>
        <p>Gerado em ${escapeHtml(generatedAt)}. Use os filtros para procurar membros e faixas de saldo.</p>
      </div>
      <p id="visibleCount">0 linhas</p>
    </header>

    <section class="filters">
      <label>Buscar
        <input id="search" type="search" placeholder="Nick, Discord ou ID">
      </label>
      <label>Status
        <select id="status">
          <option value="">Todos</option>
          <option value="positive">Saldo positivo</option>
          <option value="zero">Saldo zero</option>
          <option value="negative">Saldo negativo</option>
        </select>
      </label>
      <label>Saldo minimo
        <input id="minBalance" type="number" inputmode="numeric" placeholder="Ex: 0">
      </label>
      <label>Saldo maximo
        <input id="maxBalance" type="number" inputmode="numeric" placeholder="Ex: 1000000">
      </label>
      <label>Ordenar
        <select id="sort">
          <option value="name">Nome A-Z</option>
          <option value="balance_desc">Maior saldo</option>
          <option value="balance_asc">Menor saldo</option>
          <option value="updated_desc">Atualizado recente</option>
        </select>
      </label>
    </section>

    <section class="metrics" id="metrics"></section>
    <section class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Membro</th>
            <th>Discord</th>
            <th>ID</th>
            <th class="amount">Saldo</th>
            <th>Atualizado</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </section>
  </main>
  <script>
    const balances = ${json};
    const search = document.querySelector('#search');
    const status = document.querySelector('#status');
    const minBalance = document.querySelector('#minBalance');
    const maxBalance = document.querySelector('#maxBalance');
    const sort = document.querySelector('#sort');
    const rowsEl = document.querySelector('#rows');
    const metricsEl = document.querySelector('#metrics');
    const visibleCount = document.querySelector('#visibleCount');

    for (const input of [search, status, minBalance, maxBalance, sort]) {
      input.addEventListener('input', render);
      input.addEventListener('change', render);
    }

    function normalize(value) {
      return String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
    }

    function filteredRows() {
      const query = normalize(search.value);
      const min = minBalance.value === '' ? null : Number(minBalance.value);
      const max = maxBalance.value === '' ? null : Number(maxBalance.value);
      const statusValue = status.value;
      return balances
        .filter((row) => !query || normalize(row.albion_name + ' ' + row.discord_name + ' ' + row.discord_id).includes(query))
        .filter((row) => statusValue !== 'positive' || row.balance > 0)
        .filter((row) => statusValue !== 'zero' || row.balance === 0)
        .filter((row) => statusValue !== 'negative' || row.balance < 0)
        .filter((row) => min == null || row.balance >= min)
        .filter((row) => max == null || row.balance <= max)
        .sort(sorter(sort.value));
    }

    function sorter(mode) {
      if (mode === 'balance_desc') return (a, b) => b.balance - a.balance || nameOf(a).localeCompare(nameOf(b));
      if (mode === 'balance_asc') return (a, b) => a.balance - b.balance || nameOf(a).localeCompare(nameOf(b));
      if (mode === 'updated_desc') return (a, b) => String(b.last_updated).localeCompare(String(a.last_updated));
      return (a, b) => nameOf(a).localeCompare(nameOf(b));
    }

    function nameOf(row) {
      return row.albion_name || row.discord_name || row.discord_id || '';
    }

    function render() {
      const rows = filteredRows();
      const total = rows.reduce((sum, row) => sum + row.balance, 0);
      const positive = rows.filter((row) => row.balance > 0).length;
      const zero = rows.filter((row) => row.balance === 0).length;
      const negative = rows.filter((row) => row.balance < 0).length;
      visibleCount.textContent = rows.length + ' linhas';
      metricsEl.innerHTML = [
        metric('Total filtrado', silver(total)),
        metric('Positivos', positive),
        metric('Zerados', zero),
        metric('Negativos', negative)
      ].join('');
      rowsEl.innerHTML = rows.length ? rows.map(rowHtml).join('') : '<tr><td colspan="5" class="empty">Nenhum saldo encontrado com esses filtros.</td></tr>';
    }

    function metric(label, value) {
      return '<div class="metric"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
    }

    function rowHtml(row) {
      const klass = row.balance > 0 ? 'positive' : row.balance < 0 ? 'negative' : 'zero';
      return '<tr>' +
        '<td><div class="name">' + escapeHtml(row.albion_name || '-') + '</div><div class="sub">' + escapeHtml(row.discord_name || '-') + '</div></td>' +
        '<td>' + escapeHtml(row.discord_name || '-') + '</td>' +
        '<td>' + escapeHtml(row.discord_id || '-') + '</td>' +
        '<td class="amount ' + klass + '">' + silver(row.balance) + '</td>' +
        '<td>' + escapeHtml(row.last_updated || '-') + '</td>' +
      '</tr>';
    }

    function silver(value) {
      return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
    }

    function escapeHtml(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char]));
    }

    render();
  </script>
</body>
</html>`;
}

function transactionsAttachment() {
  const rows = financeRepo.listTransactions(5000).map((row) => ({
    id: row.id,
    type: row.type,
    user_id: row.user_id,
    amount: row.amount,
    before_balance: row.before_balance,
    after_balance: row.after_balance,
    reason: row.reason,
    created_by: row.created_by,
    created_at: row.created_at
  }));
  const csv = toCsv(rows, ['id', 'type', 'user_id', 'amount', 'before_balance', 'after_balance', 'reason', 'created_by', 'created_at']);
  return new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: 'logs-financeiros.csv' });
}

function auditAttachment() {
  const rows = audit.listAuditLogs(5000);
  const csv = toCsv(rows, ['id', 'type', 'actor_id', 'target_id', 'before_value', 'after_value', 'reason', 'metadata', 'created_at']);
  return new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: 'audit-logs.csv' });
}

function voiceAttachment() {
  const rows = voiceRepo.listSessions(20000).map((row) => ({
    ...row,
    weekday: weekdayName(row.joined_at),
    joined_hour: hourOfDay(row.joined_at),
    duration_minutes: Math.round((row.seconds / 60) * 100) / 100
  }));
  const columns = [
    'id',
    'discord_id',
    'discord_name',
    'albion_name',
    'channel_id',
    'channel_name',
    'category_id',
    'category_name',
    'joined_at',
    'left_at',
    'seconds',
    'duration_minutes',
    'weekday',
    'joined_hour'
  ];
  const csv = toCsv(rows, columns);
  return new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: 'voice-sessions.csv' });
}

function voiceDailyAttachment(dateText = todayIsoDate()) {
  dateText = normalizeIsoDate(dateText);
  const sessions = voiceRepo.listSessions(50000).filter((session) => dateInSaoPaulo(session.joined_at) === dateText);
  const byMember = new Map();

  for (const session of sessions) {
    const key = session.discord_id;
    const item = byMember.get(key) || {
      date: dateText,
      discord_id: session.discord_id,
      discord_name: session.discord_name || '',
      albion_name: session.albion_name || '',
      voice_sessions: 0,
      voice_seconds: 0,
      voice_minutes: 0,
      first_joined_at: session.joined_at,
      last_left_at: session.left_at || '',
      top_channels: new Map(),
      favorite_hours: new Map(),
      weekday: weekdayName(session.joined_at)
    };

    item.voice_sessions += 1;
    item.voice_seconds += session.seconds;
    item.voice_minutes = Math.round((item.voice_seconds / 60) * 100) / 100;
    if (session.joined_at < item.first_joined_at) item.first_joined_at = session.joined_at;
    if ((session.left_at || '') > item.last_left_at) item.last_left_at = session.left_at || '';
    incrementMap(item.top_channels, session.channel_name || 'Sem canal', session.seconds);
    incrementMap(item.favorite_hours, hourOfDay(session.joined_at), session.seconds);
    byMember.set(key, item);
  }

  const rows = [...byMember.values()].map((item) => ({
    ...item,
    top_channels: topKeys(item.top_channels, 5).join('|'),
    favorite_hours: topKeys(item.favorite_hours, 5).join('|')
  }));

  const columns = [
    'date',
    'discord_id',
    'discord_name',
    'albion_name',
    'voice_sessions',
    'voice_seconds',
    'voice_minutes',
    'first_joined_at',
    'last_left_at',
    'weekday',
    'top_channels',
    'favorite_hours'
  ];
  const csv = toCsv(rows, columns);
  return new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: `voice-daily-${dateText}.csv` });
}

function todayIsoDate() {
  return formatSaoPauloDate(new Date());
}

function normalizeIsoDate(dateText) {
  const normalized = String(dateText || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : todayIsoDate();
}

function dateInSaoPaulo(dateText) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return todayIsoDate();
  return formatSaoPauloDate(date);
}

function formatSaoPauloDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function incrementMap(map, key, value) {
  map.set(key, (map.get(key) || 0) + value);
}

function topKeys(map, limit) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key]) => key);
}

function weekdayName(dateText) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return '';
  return ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'][date.getDay()];
}

function hourOfDay(dateText) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return '';
  return String(date.getHours()).padStart(2, '0');
}

function previewBalanceImport(csvText) {
  const rows = parseCsv(csvText);
  const changes = [];
  let found = 0;
  let missing = 0;
  let totalBefore = 0;
  let totalAfter = 0;

  for (const row of rows) {
    const normalized = normalizeBalanceRow(row);
    const discordId = normalized.discordId;
    const albionName = normalized.albionName;
    const discordName = normalized.discordName;
    const amount = parseSilver(normalized.balance);
    let user = discordId ? registrationRepo.getUser(discordId) : null;
    if (!user && albionName) {
      user = require('../../database/connection')
        .getDatabase()
        .prepare('SELECT * FROM users WHERE lower(albion_name) = lower(?)')
        .get(albionName);
    }

    if (!user && !discordId) {
      missing += 1;
      continue;
    }

    const userId = user?.discord_id || discordId;
    if (!user && discordId) {
      registrationRepo.upsertUser({
        discordId,
        discordName: discordName || discordId,
        albionName,
        registrationStatus: albionName ? 'guest' : 'unregistered'
      });
    }

    const before = financeRepo.getBalance(userId);
    totalBefore += before;
    totalAfter += amount;
    found += 1;
    changes.push({ userId, albionName: user?.albion_name || albionName || discordName, before, after: amount });
  }

  return { found, missing, totalBefore, totalAfter, changes };
}

function normalizeBalanceRow(row) {
  const discordId = firstValue(row, ['discord_id', 'Discord_ID', 'ID', 'id']);
  const explicitAlbionName = firstValue(row, ['albion_name', 'Albion_Name', 'Albion', 'Nick']);
  return {
    discordId,
    discordName: firstValue(row, ['discord_name', 'Discord_Name', 'Nome', 'name']),
    albionName: explicitAlbionName || (discordId ? '' : firstValue(row, ['Nome'])),
    balance: firstValue(row, ['balance', 'Balance', 'Saldo', 'saldo']) || '0'
  };
}

function firstValue(row, keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== '') return String(row[key]).trim();
  }
  return '';
}

function saveImportPreview({ preview, actorId }) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  importPreviews.set(id, { preview, actorId, createdAt: Date.now() });
  return id;
}

function takeImportPreview(id) {
  const session = importPreviews.get(id);
  importPreviews.delete(id);
  return session;
}

const applyBalanceImport = transaction(({ preview, actorId }) => {
  backupDatabase('before_csv_import');
  const transactions = [];
  for (const change of preview.changes) {
    const diff = change.after - change.before;
    if (diff !== 0) {
      const item = {
        type: 'csv_import',
        userId: change.userId,
        amount: diff,
        reason: 'Importacao CSV de saldos',
        referenceType: 'csv_import',
        referenceId: null,
        createdBy: actorId
      };
      finance.applyBalanceTransaction(item);
      transactions.push(item);
    }
  }
  audit.createAuditLog({
    type: 'csv_import_applied',
    actorId,
    reason: 'Importacao CSV confirmada',
    metadata: {
      found: preview.found,
      missing: preview.missing,
      totalBefore: preview.totalBefore,
      totalAfter: preview.totalAfter
    }
  });
  return transactions;
});

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

module.exports = {
  applyBalanceImport,
  auditAttachment,
  balancesAttachment,
  balancesHtmlAttachment,
  saveImportPreview,
  previewBalanceImport,
  takeImportPreview,
  transactionsAttachment,
  voiceAttachment,
  voiceDailyAttachment
};
