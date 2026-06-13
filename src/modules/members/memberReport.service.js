const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');
const { parseMemberExport } = require('../reports/dailyReport.service');
const { toCsv } = require('../../utils/csv');
const repo = require('./memberReport.repository');

const dashboardDir = path.resolve(__dirname, '..', '..', '..', 'dashboard');
const htmlReportPath = path.join(dashboardDir, 'membros.html');

async function buildMemberReport({ attachment, actorId, dateText }) {
  if (!attachment?.url) throw new Error('Anexe a lista de membros exportada do Albion.');

  const currentText = await downloadText(attachment);
  const currentMembers = parseMemberExport(currentText);
  if (currentMembers.length === 0) {
    throw new Error('Nao encontrei membros no arquivo. O formato esperado tem Character Name, Last Seen e Roles.');
  }

  const previous = repo.getLatestSnapshot();
  const reportDate = normalizeReportDate(dateText);
  const comparison = compareSnapshots({
    currentMembers,
    previousMembers: previous?.members || [],
    reportDate
  });

  const snapshotId = repo.createSnapshot({
    createdBy: actorId,
    sourceName: attachment.name || '',
    members: currentMembers
  });

  const htmlPath = writeHtmlReport({
    comparison,
    reportDate,
    snapshotId,
    previousSnapshot: previous,
    sourceName: attachment.name || ''
  });

  return {
    content: formatDiscordSummary(comparison, {
      reportDate,
      snapshotId,
      previousSnapshot: previous,
      htmlPath
    }),
    files: [comparisonAttachment(comparison.rows, reportDate, snapshotId)],
    snapshotId,
    htmlPath
  };
}

async function downloadText(attachment) {
  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error(`Nao consegui baixar o anexo ${attachment.name || attachment.url}.`);
  return response.text();
}

function compareSnapshots({ currentMembers, previousMembers, reportDate }) {
  const current = mapByKey(currentMembers);
  const previous = mapByKey(previousMembers);
  const keys = new Set([...current.keys(), ...previous.keys()]);
  const rows = [...keys].map((key) => {
    const now = current.get(key);
    const before = previous.get(key);
    return {
      character_name: now?.characterName || before?.characterName || '',
      status: now && before ? 'permaneceu' : now ? 'novo' : 'saiu',
      last_seen_atual: now?.lastSeen || '',
      last_seen_anterior: before?.lastSeen || '',
      inactive_days: now ? daysSince(now.lastSeenDate, reportDate) : '',
      online: now?.isOnline ? 'sim' : 'nao',
      roles_current: now?.roles.join('|') || '',
      roles_previous: before?.roles.join('|') || '',
      role_changes: roleChanges(before?.roles || [], now?.roles || [])
    };
  }).sort((a, b) => statusWeight(a.status) - statusWeight(b.status) || a.character_name.localeCompare(b.character_name));

  return {
    rows,
    currentMembers,
    previousMembers
  };
}

function formatDiscordSummary(comparison, { reportDate, snapshotId, previousSnapshot }) {
  const rows = comparison.rows;
  const currentRows = rows.filter((row) => row.status !== 'saiu');
  const newRows = rows.filter((row) => row.status === 'novo');
  const removedRows = rows.filter((row) => row.status === 'saiu');
  const changedRoles = rows.filter((row) => row.role_changes);
  const online = comparison.currentMembers.filter((member) => member.isOnline).length;
  const inactive7 = currentRows.filter((row) => Number(row.inactive_days) >= 7).length;
  const inactive14 = currentRows.filter((row) => Number(row.inactive_days) >= 14).length;
  const inactive30 = currentRows.filter((row) => Number(row.inactive_days) >= 30).length;

  const lines = [
    `Relatorio de membros Notag - ${reportDate}`,
    `Snapshot salvo: #${snapshotId}`,
    previousSnapshot ? `Comparado com snapshot #${previousSnapshot.id} de ${formatDateTime(previousSnapshot.created_at)}` : 'Primeiro envio salvo. Na proxima vez eu ja comparo automaticamente.',
    '',
    `Membros no arquivo atual: ${currentRows.length}`,
    `Online no Albion: ${online}`,
    previousSnapshot ? `Novos desde o ultimo envio: ${newRows.length}` : null,
    previousSnapshot ? `Sairam desde o ultimo envio: ${removedRows.length}` : null,
    previousSnapshot ? `Mudaram cargos: ${changedRoles.length}` : null,
    `Inativos 7+ dias: ${inactive7}`,
    `Inativos 14+ dias: ${inactive14}`,
    `Inativos 30+ dias: ${inactive30}`,
    '',
    'Sugestoes:',
    inactive14 > 0 ? `- Revisar ${inactive14} membro(s) com 14+ dias sem login.` : '- Sem alerta forte de inatividade 14+ dias.',
    removedRows.length > 0 ? `- Conferir ${removedRows.length} membro(s) que sumiram do arquivo.` : null,
    newRows.length > 0 ? `- Validar cargos/registro dos ${newRows.length} membro(s) novos.` : null,
    '',
    'CSV detalhado anexado. HTML atualizado em dashboard/membros.html.'
  ].filter(Boolean);

  return lines.join('\n').slice(0, 1900);
}

function comparisonAttachment(rows, reportDate, snapshotId) {
  const columns = [
    'character_name',
    'status',
    'last_seen_atual',
    'last_seen_anterior',
    'inactive_days',
    'online',
    'roles_current',
    'roles_previous',
    'role_changes'
  ];
  const csv = toCsv(rows, columns);
  return new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: `membros-comparacao-${reportDate}-snapshot-${snapshotId}.csv` });
}

function writeHtmlReport({ comparison, reportDate, snapshotId, previousSnapshot, sourceName }) {
  fs.mkdirSync(dashboardDir, { recursive: true });
  fs.writeFileSync(htmlReportPath, renderHtml({ comparison, reportDate, snapshotId, previousSnapshot, sourceName }));
  return htmlReportPath;
}

function renderHtml({ comparison, reportDate, snapshotId, previousSnapshot, sourceName }) {
  const rows = comparison.rows;
  const currentRows = rows.filter((row) => row.status !== 'saiu');
  const newRows = rows.filter((row) => row.status === 'novo');
  const removedRows = rows.filter((row) => row.status === 'saiu');
  const changedRoles = rows.filter((row) => row.role_changes);
  const online = comparison.currentMembers.filter((member) => member.isOnline).length;
  const inactive14 = currentRows.filter((row) => Number(row.inactive_days) >= 14).length;

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Relatorio de Membros</title>
  <style>
    :root { color-scheme: light; --bg:#f6f7f9; --panel:#fff; --ink:#18212f; --muted:#667085; --line:#d9dee7; --accent:#0f766e; --warn:#b42318; --review:#b54708; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); }
    main { width:min(1180px, calc(100% - 32px)); margin:0 auto; padding:28px 0 44px; }
    header { display:flex; justify-content:space-between; gap:18px; align-items:end; margin-bottom:18px; }
    h1,h2,h3,p { margin:0; }
    h1 { font-size:34px; line-height:1.08; }
    p,.muted { color:var(--muted); line-height:1.5; }
    a { color:var(--accent); font-weight:800; text-decoration:none; }
    .cards { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:12px; margin:18px 0; }
    .card, section, .suggestion { border:1px solid var(--line); border-radius:8px; background:var(--panel); box-shadow:0 10px 30px rgba(15,23,42,.08); }
    .card { padding:16px; }
    .card span { display:block; color:var(--muted); font-size:12px; font-weight:800; }
    .card strong { display:block; margin-top:6px; font-size:26px; }
    .suggestions { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-bottom:14px; }
    .suggestion { padding:15px; border-left:5px solid var(--accent); }
    .suggestion.warn { border-left-color:var(--warn); }
    .suggestion.review { border-left-color:var(--review); }
    section { overflow:hidden; }
    .head { display:flex; justify-content:space-between; gap:12px; align-items:center; border-bottom:1px solid var(--line); padding:14px 16px; }
    .table-wrap { overflow:auto; max-height:680px; }
    table { width:100%; min-width:980px; border-collapse:collapse; }
    th,td { border-bottom:1px solid var(--line); padding:10px 12px; text-align:left; vertical-align:top; font-size:13px; }
    th { position:sticky; top:0; background:#f9fafb; color:#344054; text-transform:uppercase; font-size:12px; }
    .tag { display:inline-block; margin:2px 5px 2px 0; border-radius:999px; background:#eef2f6; padding:3px 8px; color:#344054; font-size:12px; font-weight:800; }
    .novo { background:#e7f4f2; color:#115e59; }
    .saiu { background:#fee4e2; color:#912018; }
    .permaneceu { background:#eef2f6; color:#344054; }
    @media (max-width:900px) { header, .cards, .suggestions { grid-template-columns:1fr; flex-direction:column; align-items:stretch; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Relatorio de membros</h1>
        <p>Arquivo: ${escapeHtml(sourceName || '-')} | Data: ${escapeHtml(reportDate)} | Snapshot #${snapshotId}${previousSnapshot ? ` comparado com #${previousSnapshot.id}` : ''}</p>
      </div>
      <a href="index.html">Voltar ao dashboard</a>
    </header>

    <div class="cards">
      <article class="card"><span>Membros atuais</span><strong>${number(currentRows.length)}</strong></article>
      <article class="card"><span>Online</span><strong>${number(online)}</strong></article>
      <article class="card"><span>Novos</span><strong>${number(newRows.length)}</strong></article>
      <article class="card"><span>Sairam</span><strong>${number(removedRows.length)}</strong></article>
      <article class="card"><span>Inativos 14+</span><strong>${number(inactive14)}</strong></article>
    </div>

    <div class="suggestions">
      <article class="suggestion ${inactive14 ? 'warn' : ''}">
        <h3>Inatividade</h3>
        <p>${inactive14 ? `Revisar ${inactive14} membro(s) com 14+ dias sem login.` : 'Sem alerta forte de inatividade 14+ dias.'}</p>
      </article>
      <article class="suggestion ${removedRows.length ? 'warn' : ''}">
        <h3>Saidas</h3>
        <p>${removedRows.length ? `Conferir ${removedRows.length} membro(s) que estavam no ultimo envio e sumiram agora.` : 'Ninguem sumiu em relacao ao ultimo envio.'}</p>
      </article>
      <article class="suggestion ${changedRoles.length ? 'review' : ''}">
        <h3>Cargos</h3>
        <p>${changedRoles.length ? `${changedRoles.length} membro(s) tiveram alteracao de cargo.` : 'Nenhuma mudanca de cargo detectada.'}</p>
      </article>
    </div>

    <section>
      <div class="head"><h2>Comparacao completa</h2><span class="muted">${number(rows.length)} linhas</span></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Membro</th>
              <th>Status</th>
              <th>Ultimo login atual</th>
              <th>Ultimo login anterior</th>
              <th>Inativo dias</th>
              <th>Cargos atuais</th>
              <th>Mudancas</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td><strong>${escapeHtml(row.character_name)}</strong></td>
                <td><span class="tag ${escapeHtml(row.status)}">${escapeHtml(labelStatus(row.status))}</span></td>
                <td>${escapeHtml(row.last_seen_atual || '-')}</td>
                <td>${escapeHtml(row.last_seen_anterior || '-')}</td>
                <td>${escapeHtml(row.inactive_days === '' ? '-' : row.inactive_days)}</td>
                <td>${tags(row.roles_current)}</td>
                <td>${tags(row.role_changes)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function mapByKey(rows) {
  const map = new Map();
  for (const row of rows) {
    if (row.key) map.set(row.key, row);
  }
  return map;
}

function roleChanges(beforeRoles, currentRoles) {
  const before = new Set(beforeRoles);
  const current = new Set(currentRoles);
  const added = [...current].filter((role) => !before.has(role));
  const removed = [...before].filter((role) => !current.has(role));
  return [
    ...added.map((role) => `+${role}`),
    ...removed.map((role) => `-${role}`)
  ].join('|');
}

function daysSince(date, reportDate) {
  if (!date) return 0;
  const report = new Date(`${reportDate}T12:00:00-03:00`);
  return Math.max(0, Math.floor((report.getTime() - date.getTime()) / 86400000));
}

function normalizeReportDate(dateText) {
  const normalized = String(dateText || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : formatDate(new Date());
}

function formatDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo'
  }).format(date);
}

function statusWeight(status) {
  return { novo: 0, saiu: 1, permaneceu: 2 }[status] ?? 3;
}

function labelStatus(status) {
  return { novo: 'Novo', saiu: 'Saiu', permaneceu: 'Permaneceu' }[status] || status;
}

function tags(value) {
  const values = String(value || '').split('|').filter(Boolean);
  return values.length ? values.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join('') : '-';
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
  buildMemberReport,
  compareSnapshots
};
