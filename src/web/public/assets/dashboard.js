const state = { data: null, lastLoadedAt: 0, currentView: 'overview' };
const number = new Intl.NumberFormat('pt-BR');
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const silver = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function formatSilver(value) {
  return `${silver.format(Number(value || 0))} prata`;
}

function parseDatabaseDate(value) {
  if (!value) return null;
  const normalized = /Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${String(value).replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value, includeTime = true) {
  const date = parseDatabaseDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: 'short', ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {})
  }).format(date);
}

function badge(status) {
  const labels = {
    member: 'Membro', pending: 'Pendente', unregistered: 'Sem cadastro', guest: 'Convidado',
    created: 'Criado', running: 'Em andamento', approved: 'Aprovado', cancelled: 'Cancelado',
    draft: 'Rascunho', submitted: 'Em revisão', review: 'Revisão', requested: 'Solicitado'
  };
  const safe = escapeHtml(status || 'sem status');
  return `<span class="badge ${safe}">${escapeHtml(labels[status] || status || 'Sem status')}</span>`;
}

function emptyRow(columns, text = 'Nenhum registro encontrado.') {
  return `<tr><td colspan="${columns}" class="empty-row">${escapeHtml(text)}</td></tr>`;
}

function metricCard(label, value, note, _color = '#5865f2', noteClass = '') {
  return `<article class="metric-card"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${escapeHtml(value)}</strong><span class="metric-note ${escapeHtml(noteClass)}">${escapeHtml(note)}</span></article>`;
}

function renderRanking(targetId, rows, type, limit = rows.length) {
  const target = document.querySelector(`#${targetId}`);
  const selected = rows.slice(0, limit);
  if (!selected.length) {
    target.innerHTML = '<div class="empty-row">Ranking ainda sem dados para este período.</div>';
    return;
  }
  target.innerHTML = selected.map((row, index) => {
    const value = type === 'pve'
      ? `${compact.format(Number(row.amount || 0))} fama`
      : `${number.format(Number(row.events || 0))} evento${Number(row.events) === 1 ? '' : 's'}`;
    return `<div class="ranking-row"><span class="ranking-position">${index + 1}</span><span class="ranking-name">${escapeHtml(row.albion_name)}</span><span class="ranking-value">${escapeHtml(value)}</span></div>`;
  }).join('');
}

function renderActivity(rows) {
  const target = document.querySelector('#activity-chart');
  const max = Math.max(1, ...rows.map((row) => Number(row.participations || 0)));
  const weekdays = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];
  target.innerHTML = rows.map((row) => {
    const value = Number(row.participations || 0);
    const percent = Math.max(value ? 10 : 3, Math.round((value / max) * 100));
    const bucket = Math.min(100, Math.max(10, Math.ceil(percent / 10) * 10));
    const parsed = parseDatabaseDate(`${row.day}T12:00:00Z`);
    return `<div class="bar-column" title="${value} participações"><i class="h-${bucket}"></i><small>${parsed ? weekdays[parsed.getDay()] : escapeHtml(row.day)}</small></div>`;
  }).join('');
}

function renderCampaign(campaign) {
  const target = document.querySelector('#campaign-card');
  const title = document.querySelector('#campaign-title');
  if (!campaign) {
    title.textContent = 'Nenhuma campanha ativa';
    target.innerHTML = '<div class="empty-row">Não há uma campanha aberta neste momento.</div>';
    return;
  }
  title.textContent = campaign.title;
  const ratio = campaign.goal_amount > 0 ? Math.min(100, Math.round((campaign.raised / campaign.goal_amount) * 100)) : 0;
  const bucket = Math.min(100, Math.max(0, Math.round(ratio / 5) * 5));
  target.innerHTML = `<div class="campaign-progress"><div class="campaign-values"><strong>${escapeHtml(silver.format(campaign.raised))}</strong><span>de ${escapeHtml(formatSilver(campaign.goal_amount))}</span></div><div class="progress-track"><i class="p-${bucket}"></i></div><div class="campaign-meta"><span>${ratio}% concluído</span><span>${number.format(campaign.contributors)} contribuidores</span></div></div>`;
}

function transactionRows(rows, depositsOnly = false) {
  const selected = depositsOnly ? rows.filter((row) => Number(row.amount) > 0 && String(row.type).toLowerCase().includes('deposit')) : rows;
  if (!selected.length) return emptyRow(5, depositsOnly ? 'Nenhum depósito registrado.' : 'Nenhuma movimentação registrada.');
  return selected.map((row) => `<tr><td class="primary-cell">${escapeHtml(row.albion_name)}</td><td>${escapeHtml(row.type)}</td><td>${escapeHtml(row.reason)}</td><td>${formatDate(row.created_at)}</td><td class="number-cell ${Number(row.amount) >= 0 ? 'positive-value' : 'negative-value'}">${Number(row.amount) >= 0 ? '+' : ''}${escapeHtml(compact.format(row.amount))}</td></tr>`).join('');
}

function renderOverview(data) {
  const overview = data.overview;
  const campaign = overview.campaign;
  document.querySelector('#overview-metrics').innerHTML = [
    metricCard('Saldo dos membros', formatSilver(overview.totalMemberBalance), 'Soma das contas individuais', '#23a55a'),
    metricCard('Campanha ativa', campaign ? silver.format(campaign.raised) : '—', campaign ? `Meta: ${silver.format(campaign.goal_amount)}` : 'Nenhuma campanha aberta', '#f0b232'),
    metricCard('Membros ativos', number.format(overview.activeMembers), 'Cadastros com status membro', '#5865f2'),
    metricCard('Depósitos — 7 dias', formatSilver(overview.deposits7d.amount), `${number.format(overview.deposits7d.count)} registros`, '#37c9ef')
  ].join('');
  renderActivity(overview.activity);
  renderCampaign(campaign);
  renderRanking('pve-ranking-mini', data.rankings.pve.rows, 'pve', 5);
  renderRanking('participation-ranking-mini', data.rankings.participation.rows, 'participation', 5);
  const deposits = overview.recentDeposits;
  document.querySelector('#recent-deposits-table').innerHTML = deposits.length
    ? deposits.slice(0, 7).map((row) => `<tr><td class="primary-cell">${escapeHtml(row.albion_name)}</td><td>${escapeHtml(row.reason)}</td><td>${formatDate(row.created_at)}</td><td class="number-cell positive-value">+${escapeHtml(compact.format(row.amount))}</td></tr>`).join('')
    : emptyRow(4, 'Nenhum depósito recente encontrado.');
}

function renderMembers(members, query = '') {
  const normalized = query.trim().toLocaleLowerCase('pt-BR');
  const filtered = normalized ? members.filter((row) => [row.albion_name, row.discord_name, row.registration_status].some((value) => String(value || '').toLocaleLowerCase('pt-BR').includes(normalized))) : members;
  document.querySelector('#members-table').innerHTML = filtered.length ? filtered.map((row) => `<tr><td class="primary-cell">${escapeHtml(row.albion_name || 'Sem nome Albion')}</td><td>${badge(row.registration_status)}</td><td>${escapeHtml(row.discord_name || '—')}</td><td>${number.format(row.events_total)}</td><td class="number-cell">${escapeHtml(formatSilver(row.balance))}</td></tr>`).join('') : emptyRow(5);
}

function renderRegistrations(members, pending) {
  const counts = members.reduce((result, row) => {
    result[row.registration_status || 'unregistered'] = (result[row.registration_status || 'unregistered'] || 0) + 1;
    return result;
  }, {});
  document.querySelector('#registration-metrics').innerHTML = [
    metricCard('Membros', number.format(counts.member || 0), 'Cadastro ativo', '#23a55a'),
    metricCard('Pendentes', number.format(pending), 'Aguardando análise', '#f0b232'),
    metricCard('Outros status', number.format(members.length - (counts.member || 0)), 'Convidados e não cadastrados', '#5865f2')
  ].join('');
  document.querySelector('#registrations-table').innerHTML = members.length ? members.map((row) => `<tr><td class="primary-cell">${escapeHtml(row.albion_name || 'Sem nome Albion')}</td><td>${escapeHtml(row.discord_name || '—')}</td><td>${badge(row.registration_status)}</td><td>${formatDate(row.updated_at)}</td></tr>`).join('') : emptyRow(4);
}

function renderEvents(events) {
  document.querySelector('#events-table').innerHTML = events.length ? events.map((row) => `<tr><td class="primary-cell">${escapeHtml(row.title)}<span class="secondary-text">${escapeHtml(row.event_code)}</span></td><td>${escapeHtml(row.location || '—')}</td><td>${badge(row.status)}</td><td>${number.format(row.participants)}</td><td>${row.review_status ? badge(row.review_status) : '—'}</td><td>${formatDate(row.ended_at || row.started_at || row.created_at)}</td></tr>`).join('') : emptyRow(6);
}

function renderOperations(operations) {
  document.querySelector('#operations-metrics').innerHTML = [
    metricCard('Eventos ativos', number.format(operations.activeEvents), 'Criados, em andamento ou revisão', '#5865f2'),
    metricCard('Revisões pendentes', number.format(operations.reviewsPending), 'Loot splits aguardando conclusão', '#f0b232'),
    metricCard('Cadastros pendentes', number.format(operations.registrationsPending), 'Solicitações aguardando staff', '#37c9ef'),
    metricCard('Pagamentos pendentes', number.format(operations.paymentRequestsPending), 'Pedidos em análise', '#23a55a')
  ].join('');
}

function renderFinance(finance, totalBalance) {
  const campaign = finance.campaign;
  document.querySelector('#finance-metrics').innerHTML = [
    metricCard('Saldo dos membros', formatSilver(totalBalance), 'Soma das contas individuais', '#23a55a'),
    metricCard('Campanha arrecadada', campaign ? formatSilver(campaign.raised) : '—', campaign?.title || 'Sem campanha ativa', '#f0b232'),
    metricCard('Movimentações exibidas', number.format(finance.transactions.length), 'Registros mais recentes', '#5865f2')
  ].join('');
  document.querySelector('#transactions-table').innerHTML = transactionRows(finance.transactions);
  document.querySelector('#deposits-table').innerHTML = transactionRows(finance.transactions, true);
}

function renderRankings(rankings) {
  document.querySelector('#pve-period').textContent = rankings.pve.label;
  document.querySelector('#participation-period').textContent = rankings.participation.label;
  renderRanking('pve-ranking-full', rankings.pve.rows, 'pve');
  renderRanking('participation-ranking-full', rankings.participation.rows, 'participation');
}

function renderAudit(rows) {
  document.querySelector('#audit-table').innerHTML = rows.length ? rows.map((row) => `<tr><td class="primary-cell">${escapeHtml(row.type)}</td><td>${escapeHtml(row.actor_id || 'Sistema')}</td><td>${escapeHtml(row.target_id || '—')}</td><td>${escapeHtml(row.reason || '—')}</td><td>${formatDate(row.created_at)}</td></tr>`).join('') : emptyRow(5);
}

function render(data) {
  renderOverview(data);
  renderMembers(data.members);
  renderRegistrations(data.members, data.operations.registrationsPending);
  renderEvents(data.events);
  renderOperations(data.operations);
  renderFinance(data.finance, data.overview.totalMemberBalance);
  renderRankings(data.rankings);
  renderAudit(data.audit);
  document.querySelector('#freshness').textContent = data.freshness ? `Dados até ${formatDate(data.freshness)}` : `Atualizado ${formatDate(data.generatedAt)}`;
}

async function fetchJson(path) {
  const response = await fetch(path, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (response.status === 401) {
    window.location.assign('/?login=required');
    throw new Error('Sessão encerrada.');
  }
  if (!response.ok) throw new Error('Não foi possível carregar os dados.');
  return response.json();
}

async function loadDashboard({ manual = false } = {}) {
  const button = document.querySelector('#refresh-button');
  if (manual) button.classList.add('spinning');
  try {
    const data = await fetchJson('/api/dashboard');
    state.data = data;
    state.lastLoadedAt = Date.now();
    render(data);
    document.querySelector('#loading-panel').hidden = true;
    document.querySelector(`#view-${state.currentView}`).classList.add('active');
  } catch (error) {
    const toast = document.querySelector('#error-toast');
    toast.textContent = error.message;
    toast.hidden = false;
    window.setTimeout(() => { toast.hidden = true; }, 6000);
  } finally {
    button.classList.remove('spinning');
  }
}

async function loadSession() {
  const { user } = await fetchJson('/api/session');
  document.querySelector('#user-name').textContent = user.name;
  if (user.avatarUrl) {
    const avatar = document.querySelector('#user-avatar');
    avatar.src = user.avatarUrl;
    avatar.alt = `Avatar de ${user.name}`;
    avatar.hidden = false;
  }
}

function switchView(view) {
  const next = document.querySelector(`#view-${view}`);
  if (!next) return;
  state.currentView = view;
  document.querySelectorAll('.view').forEach((item) => item.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  next.classList.add('active');
  document.querySelector('#page-title').textContent = next.dataset.title;
  document.querySelector('#page-kicker').textContent = next.dataset.kicker;
  closeSidebar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openSidebar() {
  document.querySelector('#sidebar').classList.add('open');
  document.querySelector('#mobile-scrim').classList.add('open');
}

function closeSidebar() {
  document.querySelector('#sidebar').classList.remove('open');
  document.querySelector('#mobile-scrim').classList.remove('open');
}

document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.go)));
document.querySelector('#menu-toggle').addEventListener('click', openSidebar);
document.querySelector('#sidebar-close').addEventListener('click', closeSidebar);
document.querySelector('#mobile-scrim').addEventListener('click', closeSidebar);
document.querySelector('#refresh-button').addEventListener('click', () => loadDashboard({ manual: true }));
document.querySelector('#member-search').addEventListener('input', (event) => {
  if (state.data) renderMembers(state.data.members, event.target.value);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - state.lastLoadedAt >= 30000) loadDashboard();
});

Promise.all([loadSession(), loadDashboard()]).catch(() => {});
window.setInterval(() => { if (!document.hidden) loadDashboard(); }, 30000);
