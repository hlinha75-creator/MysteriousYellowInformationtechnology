const state = { data: null, lastLoadedAt: 0, currentView: 'overview', csrf: null, famePreview: null, fameCategory: 'pve', fameSourceName: null, rankingCategory: 'overall' };
const number = new Intl.NumberFormat('pt-BR');
const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

function formatCompact(value) {
  const numeric = Number(value || 0);
  const absolute = Math.abs(numeric);
  const formatScaled = (divisor, suffix) => {
    const scaled = numeric / divisor;
    const decimals = Math.abs(scaled) >= 100 ? 0 : 1;
    return `${scaled.toFixed(decimals).replace(/\.0$/, '')}${suffix}`;
  };
  if (absolute >= 1_000_000_000) return formatScaled(1_000_000_000, 'b');
  if (absolute >= 1_000_000) return formatScaled(1_000_000, 'm');
  if (absolute >= 1_000) return formatScaled(1_000, 'k');
  return String(Math.round(numeric));
}

const compact = { format: formatCompact };
const silver = { format: formatCompact };

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

function normalizeText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

function controlValue(id, fallback = '') {
  return document.querySelector(`#${id}`)?.value ?? fallback;
}

function includesQuery(row, query, fields) {
  const normalized = normalizeText(query).trim();
  return !normalized || fields.some((field) => normalizeText(row[field]).includes(normalized));
}

function dateValue(value) {
  return parseDatabaseDate(value)?.getTime() || 0;
}

function sortRows(rows, sort, options) {
  const compare = options[sort] || options.default;
  return [...rows].sort(compare);
}

function setSummary(id, shown, total) {
  const target = document.querySelector(`#${id}`);
  if (target) target.textContent = `Exibindo ${number.format(shown)} de ${number.format(total)} registros`;
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

function renderMembers(members) {
  const query = controlValue('member-search');
  const status = controlValue('member-status');
  const filtered = members.filter((row) => (!status || row.registration_status === status) && includesQuery(row, query, ['albion_name', 'discord_name', 'registration_status']));
  const sorted = sortRows(filtered, controlValue('member-sort', 'name-asc'), {
    'name-asc': (a, b) => collator.compare(a.albion_name || '', b.albion_name || ''),
    'name-desc': (a, b) => collator.compare(b.albion_name || '', a.albion_name || ''),
    'balance-desc': (a, b) => Number(b.balance || 0) - Number(a.balance || 0),
    'balance-asc': (a, b) => Number(a.balance || 0) - Number(b.balance || 0),
    'events-desc': (a, b) => Number(b.events_total || 0) - Number(a.events_total || 0),
    'events-asc': (a, b) => Number(a.events_total || 0) - Number(b.events_total || 0),
    default: (a, b) => collator.compare(a.albion_name || '', b.albion_name || '')
  });
  setSummary('members-summary', sorted.length, members.length);
  document.querySelector('#members-table').innerHTML = sorted.length ? sorted.map((row) => `<tr><td class="primary-cell">${escapeHtml(row.albion_name || 'Sem nome Albion')}</td><td>${badge(row.registration_status)}</td><td>${escapeHtml(row.discord_name || '—')}</td><td>${number.format(row.events_total)}</td><td class="number-cell">${escapeHtml(formatSilver(row.balance))}</td></tr>`).join('') : emptyRow(5);
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
  const query = controlValue('registration-search');
  const status = controlValue('registration-status');
  const filtered = members.filter((row) => (!status || row.registration_status === status) && includesQuery(row, query, ['albion_name', 'discord_name', 'registration_status']));
  const sorted = sortRows(filtered, controlValue('registration-sort', 'updated-desc'), {
    'updated-desc': (a, b) => dateValue(b.updated_at) - dateValue(a.updated_at),
    'updated-asc': (a, b) => dateValue(a.updated_at) - dateValue(b.updated_at),
    'name-asc': (a, b) => collator.compare(a.albion_name || '', b.albion_name || ''),
    'name-desc': (a, b) => collator.compare(b.albion_name || '', a.albion_name || ''),
    default: (a, b) => dateValue(b.updated_at) - dateValue(a.updated_at)
  });
  setSummary('registrations-summary', sorted.length, members.length);
  document.querySelector('#registrations-table').innerHTML = sorted.length ? sorted.map((row) => `<tr><td class="primary-cell">${escapeHtml(row.albion_name || 'Sem nome Albion')}</td><td>${escapeHtml(row.discord_name || '—')}</td><td>${badge(row.registration_status)}</td><td>${formatDate(row.updated_at)}</td></tr>`).join('') : emptyRow(4);
}

function renderEvents(events) {
  const query = controlValue('event-search');
  const status = controlValue('event-status');
  const eventDate = (row) => row.ended_at || row.started_at || row.created_at;
  const filtered = events.filter((row) => (!status || row.status === status) && includesQuery(row, query, ['title', 'event_code', 'location', 'status', 'review_status']));
  const sorted = sortRows(filtered, controlValue('event-sort', 'date-desc'), {
    'date-desc': (a, b) => dateValue(eventDate(b)) - dateValue(eventDate(a)),
    'date-asc': (a, b) => dateValue(eventDate(a)) - dateValue(eventDate(b)),
    'participants-desc': (a, b) => Number(b.participants || 0) - Number(a.participants || 0),
    'participants-asc': (a, b) => Number(a.participants || 0) - Number(b.participants || 0),
    'name-asc': (a, b) => collator.compare(a.title || '', b.title || ''),
    'name-desc': (a, b) => collator.compare(b.title || '', a.title || ''),
    default: (a, b) => dateValue(eventDate(b)) - dateValue(eventDate(a))
  });
  setSummary('events-summary', sorted.length, events.length);
  document.querySelector('#events-table').innerHTML = sorted.length ? sorted.map((row) => `<tr><td class="primary-cell">${escapeHtml(row.title)}<span class="secondary-text">${escapeHtml(row.event_code)}</span></td><td>${escapeHtml(row.location || '—')}</td><td>${badge(row.status)}</td><td>${number.format(row.participants)}</td><td>${row.review_status ? badge(row.review_status) : '—'}</td><td>${formatDate(eventDate(row))}</td></tr>`).join('') : emptyRow(6);
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
  const transactionQuery = controlValue('transaction-search');
  const kind = controlValue('transaction-kind');
  const transactionFiltered = finance.transactions.filter((row) => {
    const amount = Number(row.amount || 0);
    return (!kind || (kind === 'credit' ? amount >= 0 : amount < 0)) && includesQuery(row, transactionQuery, ['albion_name', 'type', 'reason']);
  });
  const transactionSorted = sortTransactions(transactionFiltered, controlValue('transaction-sort', 'date-desc'));
  setSummary('transactions-summary', transactionSorted.length, finance.transactions.length);
  document.querySelector('#transactions-table').innerHTML = transactionRows(transactionSorted);

  const allDeposits = finance.transactions.filter((row) => Number(row.amount) > 0 && String(row.type).toLowerCase().includes('deposit'));
  const depositQuery = controlValue('deposit-search');
  const depositFiltered = allDeposits.filter((row) => includesQuery(row, depositQuery, ['albion_name', 'type', 'reason']));
  const depositSorted = sortTransactions(depositFiltered, controlValue('deposit-sort', 'date-desc'));
  setSummary('deposits-summary', depositSorted.length, allDeposits.length);
  document.querySelector('#deposits-table').innerHTML = transactionRows(depositSorted, true);
}

function sortTransactions(rows, sort) {
  return sortRows(rows, sort, {
    'date-desc': (a, b) => dateValue(b.created_at) - dateValue(a.created_at),
    'date-asc': (a, b) => dateValue(a.created_at) - dateValue(b.created_at),
    'amount-desc': (a, b) => Number(b.amount || 0) - Number(a.amount || 0),
    'amount-asc': (a, b) => Number(a.amount || 0) - Number(b.amount || 0),
    'name-asc': (a, b) => collator.compare(a.albion_name || '', b.albion_name || ''),
    'name-desc': (a, b) => collator.compare(b.albion_name || '', a.albion_name || ''),
    default: (a, b) => dateValue(b.created_at) - dateValue(a.created_at)
  });
}

function renderRankings(rankings) {
  document.querySelector('#pve-period').textContent = rankings.pve.label;
  document.querySelector('#participation-period').textContent = rankings.participation.label;
  renderRanking('pve-ranking-full', rankings.pve.rows, 'pve');
  renderRanking('participation-ranking-full', rankings.participation.rows, 'participation');
  renderFameRankings(rankings.fame);
}

const fameCategoryLabels = { pve: 'PvE', pvp: 'PvP', gathering: 'Coleta', crafting: 'Craft' };
const fameRankingConfigs = {
  overall: { label: 'Geral', title: 'Classificação geral', valueField: 'overall_score', rankField: 'overall_rank', score: true },
  pve: { label: 'PvE', title: 'Classificação PvE', valueField: 'pve_fame', rankField: 'pve_fame_rank' },
  pvp: { label: 'PvP', title: 'Classificação PvP', valueField: 'pvp_fame', rankField: 'pvp_fame_rank' },
  gathering: { label: 'Coleta', title: 'Classificação de coleta', valueField: 'gathering_fame', rankField: 'gathering_fame_rank' },
  crafting: { label: 'Craft', title: 'Classificação de craft', valueField: 'crafting_fame', rankField: 'crafting_fame_rank' }
};

function fameValue(row, config) {
  const value = row[config.valueField];
  if (value === null || value === undefined || (!config.score && Number(value) <= 0)) return 'Sem pontos';
  return config.score ? `${Number(value).toFixed(1)} pts` : compact.format(value);
}

function renderFameRankings(fameData) {
  const rows = fameData?.rows || [];
  const config = fameRankingConfigs[state.rankingCategory] || fameRankingConfigs.overall;
  const query = controlValue('ranking-search');
  const linkFilter = controlValue('ranking-link');
  const sort = controlValue('ranking-sort', 'rank');
  const hasValue = (row) => row[config.rankField] !== null && row[config.rankField] !== undefined;
  const filtered = rows.filter((row) => includesQuery(row, query, ['albion_name', 'discord_name'])
    && (!linkFilter || (linkFilter === 'linked' ? row.linked : !row.linked)));
  const positiveFirst = (a, b, direction) => {
    if (hasValue(a) !== hasValue(b)) return hasValue(a) ? -1 : 1;
    const difference = (Number(a[config.valueField] || 0) - Number(b[config.valueField] || 0)) * direction;
    return difference || Number(a[config.rankField] || Number.MAX_SAFE_INTEGER) - Number(b[config.rankField] || Number.MAX_SAFE_INTEGER)
      || collator.compare(a.albion_name || '', b.albion_name || '');
  };
  const sorted = sortRows(filtered, sort, {
    rank: (a, b) => Number(a[config.rankField] || Number.MAX_SAFE_INTEGER) - Number(b[config.rankField] || Number.MAX_SAFE_INTEGER)
      || collator.compare(a.albion_name || '', b.albion_name || ''),
    'value-desc': (a, b) => positiveFirst(a, b, -1),
    'value-asc': (a, b) => positiveFirst(a, b, 1),
    'name-asc': (a, b) => collator.compare(a.albion_name || '', b.albion_name || ''),
    'name-desc': (a, b) => collator.compare(b.albion_name || '', a.albion_name || ''),
    default: (a, b) => Number(a[config.rankField] || Number.MAX_SAFE_INTEGER) - Number(b[config.rankField] || Number.MAX_SAFE_INTEGER)
  });

  const imports = fameData?.imports || [];
  const latestImports = state.rankingCategory === 'overall'
    ? imports.map((item) => item.latest).filter(Boolean)
    : imports.filter((item) => item.category === state.rankingCategory).map((item) => item.latest).filter(Boolean);
  const latest = latestImports.sort((a, b) => dateValue(b.created_at) - dateValue(a.created_at))[0] || null;
  const classified = rows.filter(hasValue).length;
  const linked = rows.filter((row) => row.linked).length;
  document.querySelector('#fame-ranking-metrics').innerHTML = [
    metricCard('Jogadores no histórico', number.format(rows.length), 'Inclui ausentes preservados', '#5865f2'),
    metricCard('Classificados', number.format(classified), 'Jogadores com pontuação', '#23a55a'),
    metricCard('Vinculados', number.format(linked), `${number.format(Math.max(0, rows.length - linked))} aguardando Discord`, '#37c9ef'),
    metricCard('Última atualização', latest ? formatDate(latest.created_at) : '—', config.label, '#f0b232')
  ].join('');
  document.querySelector('#fame-ranking-title').textContent = config.title;
  document.querySelector('#fame-ranking-scope').textContent = config.label;
  document.querySelector('#fame-ranking-period').textContent = latest ? `All-time · ${formatDate(latest.created_at)}` : 'All-time · sem importação';
  setSummary('fame-ranking-summary', sorted.length, rows.length);

  const generalColumns = '<tr><th>Posição</th><th>Jogador</th><th>Vínculo</th><th class="number-cell">Índice geral</th><th class="number-cell">PvE</th><th class="number-cell">PvP</th><th class="number-cell">Coleta</th><th class="number-cell">Craft</th></tr>';
  const categoryColumns = `<tr><th>Posição</th><th>Jogador</th><th>Vínculo</th><th class="number-cell">Pontos ${escapeHtml(config.label)}</th><th class="number-cell">Índice geral</th></tr>`;
  document.querySelector('#fame-ranking-head').innerHTML = state.rankingCategory === 'overall' ? generalColumns : categoryColumns;
  document.querySelector('#fame-ranking-table').innerHTML = sorted.length ? sorted.map((row) => {
    const position = row[config.rankField] ? `#${number.format(row[config.rankField])}` : '—';
    const discordLabel = row.discord_name || (row.linked ? 'Discord vinculado' : 'Sem Discord');
    const player = `<td class="primary-cell">${escapeHtml(row.albion_name)}<span class="secondary-text">${escapeHtml(discordLabel)}</span></td>`;
    const link = `<td>${row.linked ? '<span class="badge member">Vinculado</span>' : '<span class="badge pending">Aguardando vínculo</span>'}</td>`;
    if (state.rankingCategory === 'overall') {
      return `<tr><td class="ranking-table-position">${position}</td>${player}${link}<td class="number-cell ranking-primary-value">${escapeHtml(fameValue(row, config))}</td><td class="number-cell">${Number(row.pve_fame || 0) > 0 ? escapeHtml(compact.format(row.pve_fame)) : '<span class="no-points">Sem pontos</span>'}</td><td class="number-cell">${Number(row.pvp_fame || 0) > 0 ? escapeHtml(compact.format(row.pvp_fame)) : '<span class="no-points">Sem pontos</span>'}</td><td class="number-cell">${Number(row.gathering_fame || 0) > 0 ? escapeHtml(compact.format(row.gathering_fame)) : '<span class="no-points">Sem pontos</span>'}</td><td class="number-cell">${Number(row.crafting_fame || 0) > 0 ? escapeHtml(compact.format(row.crafting_fame)) : '<span class="no-points">Sem pontos</span>'}</td></tr>`;
    }
    const overall = row.overall_score === null ? 'Sem pontos' : `${Number(row.overall_score).toFixed(1)} pts`;
    return `<tr><td class="ranking-table-position">${position}</td>${player}${link}<td class="number-cell ranking-primary-value">${escapeHtml(fameValue(row, config))}</td><td class="number-cell">${escapeHtml(overall)}</td></tr>`;
  }).join('') : emptyRow(state.rankingCategory === 'overall' ? 8 : 5, 'Nenhum jogador encontrado com estes filtros.');
}

function resetFamePreview() {
  state.famePreview = null;
  document.querySelector('#fame-preview-empty').hidden = false;
  document.querySelector('#fame-preview-content').hidden = true;
  document.querySelector('#fame-preview-status').textContent = 'Aguardando tabela';
  document.querySelector('#fame-confirm-reductions').checked = false;
}

function renderFameImportStatus(fameData) {
  const imports = fameData?.imports || [];
  for (const button of document.querySelectorAll('.fame-category')) {
    const item = imports.find((entry) => entry.category === button.dataset.category);
    const small = button.querySelector('small');
    small.textContent = item?.latest
      ? `${formatDate(item.latest.created_at)} · ${number.format(item.latest.rows_count)} jogadores`
      : 'Sem importação';
  }
}

function renderFamePreview(preview) {
  state.famePreview = preview;
  document.querySelector('#fame-preview-empty').hidden = true;
  document.querySelector('#fame-preview-content').hidden = false;
  document.querySelector('#fame-preview-status').textContent = preview.errors.length
    ? `${preview.errors.length} erro${preview.errors.length === 1 ? '' : 's'}`
    : 'Pronta para confirmar';
  const summary = preview.summary;
  document.querySelector('#fame-preview-metrics').innerHTML = [
    metricCard('Encontrados', number.format(summary.players), `${number.format(summary.withPoints)} com pontuação`, '#5865f2'),
    metricCard('Vinculados', number.format(summary.linked), 'Contas Discord reconhecidas', '#23a55a'),
    metricCard('Aguardam vínculo', number.format(summary.unmatched), 'Visíveis somente para a staff', '#37c9ef'),
    metricCard('Reduções', number.format(summary.reductions), 'Exigem confirmação especial', '#f0b232')
  ].join('');
  document.querySelector('#fame-reduction-warning').hidden = summary.reductions === 0;
  document.querySelector('#fame-preview-summary').textContent = `${summary.missing} ausentes preservados · ${summary.zero} sem pontos · ${summary.errors} erros`;
  document.querySelector('#fame-preview-errors').textContent = preview.errors.length
    ? preview.errors.slice(0, 3).map((error) => `Linha ${error.line}: ${error.message}`).join(' · ')
    : '';
  document.querySelector('#fame-confirm').disabled = preview.errors.length > 0;
  document.querySelector('#fame-preview-table').innerHTML = preview.rows.length
    ? preview.rows.map((row) => {
      const deltaClass = row.delta < 0 ? 'negative-value' : 'positive-value';
      return `<tr><td class="primary-cell">${escapeHtml(row.albionName)}${row.guildRole ? `<span class="secondary-text">${escapeHtml(row.guildRole)}</span>` : ''}</td><td>${row.discordId ? '<span class="badge member">Vinculado</span>' : '<span class="badge pending">Sem Discord</span>'}</td><td class="number-cell">${escapeHtml(compact.format(row.previousAmount))}</td><td class="number-cell">${escapeHtml(compact.format(row.amount))}</td><td class="number-cell ${deltaClass}">${row.delta >= 0 ? '+' : ''}${escapeHtml(compact.format(row.delta))}</td></tr>`;
    }).join('')
    : emptyRow(5, 'Nenhum jogador válido encontrado.');
}

function renderAudit(rows) {
  const query = controlValue('audit-search');
  const filtered = rows.filter((row) => includesQuery(row, query, ['type', 'actor_id', 'target_id', 'reason']));
  const sorted = sortRows(filtered, controlValue('audit-sort', 'date-desc'), {
    'date-desc': (a, b) => dateValue(b.created_at) - dateValue(a.created_at),
    'date-asc': (a, b) => dateValue(a.created_at) - dateValue(b.created_at),
    'type-asc': (a, b) => collator.compare(a.type || '', b.type || ''),
    'type-desc': (a, b) => collator.compare(b.type || '', a.type || ''),
    default: (a, b) => dateValue(b.created_at) - dateValue(a.created_at)
  });
  setSummary('audit-summary', sorted.length, rows.length);
  document.querySelector('#audit-table').innerHTML = sorted.length ? sorted.map((row) => `<tr><td class="primary-cell">${escapeHtml(row.type)}</td><td>${escapeHtml(row.actor_id || 'Sistema')}</td><td>${escapeHtml(row.target_id || '—')}</td><td>${escapeHtml(row.reason || '—')}</td><td>${formatDate(row.created_at)}</td></tr>`).join('') : emptyRow(5);
}

function render(data) {
  renderOverview(data);
  renderMembers(data.members);
  renderRegistrations(data.members, data.operations.registrationsPending);
  renderEvents(data.events);
  renderOperations(data.operations);
  renderFinance(data.finance, data.overview.totalMemberBalance);
  renderRankings(data.rankings);
  renderFameImportStatus(data.rankings.fame);
  renderAudit(data.audit);
  document.querySelector('#freshness').textContent = data.freshness ? `Dados até ${formatDate(data.freshness)}` : `Atualizado ${formatDate(data.generatedAt)}`;
}

async function fetchJson(path) {
  const response = await fetch(path, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (response.status === 401) {
    window.location.assign('/?login=required');
    throw new Error('Sessão encerrada.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível carregar os dados.');
  return data;
}

async function postForm(path, values) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...values, csrf: state.csrf || '' })
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) window.location.assign('/?login=required');
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a ação.');
  return data;
}

function showToast(message) {
  const toast = document.querySelector('#error-toast');
  toast.textContent = message;
  toast.hidden = false;
  window.setTimeout(() => { toast.hidden = true; }, 6000);
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
  const { user, csrf } = await fetchJson('/api/session');
  state.csrf = csrf;
  document.querySelector('#user-name').textContent = user.name;
  if (user.avatarUrl) {
    const avatar = document.querySelector('#user-avatar');
    avatar.src = user.avatarUrl;
    avatar.alt = `Avatar de ${user.name}`;
    avatar.hidden = false;
  }
}

async function analyzeFameTable() {
  const text = document.querySelector('#fame-text').value.trim();
  if (!text) return showToast('Cole a tabela ou selecione um arquivo primeiro.');
  const button = document.querySelector('#fame-analyze');
  button.disabled = true;
  button.textContent = 'Analisando…';
  try {
    const preview = await postForm('/api/fame/import/preview', {
      category: state.fameCategory,
      sourceName: state.fameSourceName || 'texto-colado',
      text
    });
    renderFamePreview(preview);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Analisar tabela';
  }
}

async function confirmFameImport() {
  if (!state.famePreview) return;
  const reductions = Number(state.famePreview.summary.reductions || 0);
  const confirmed = document.querySelector('#fame-confirm-reductions').checked;
  if (reductions > 0 && !confirmed) return showToast('Revise e confirme os valores All-time menores.');
  const button = document.querySelector('#fame-confirm');
  button.disabled = true;
  button.textContent = 'Salvando…';
  try {
    const result = await postForm('/api/fame/import/confirm', {
      previewId: state.famePreview.previewId,
      confirmReductions: String(confirmed)
    });
    showToast(`${result.categoryLabel} atualizado com ${result.summary.players} jogadores.`);
    document.querySelector('#fame-text').value = '';
    state.fameSourceName = null;
    document.querySelector('#fame-source-name').textContent = 'Nenhum arquivo selecionado';
    resetFamePreview();
    await loadDashboard();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Confirmar importação';
  }
}

async function undoFameImport() {
  const label = fameCategoryLabels[state.fameCategory];
  if (!window.confirm(`Desfazer a importação mais recente de ${label}?`)) return;
  try {
    const result = await postForm('/api/fame/import/undo', { category: state.fameCategory });
    showToast(`Importação de ${result.categoryLabel} desfeita. ${result.restoredRows} jogadores restaurados.`);
    resetFamePreview();
    await loadDashboard();
  } catch (error) {
    showToast(error.message);
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
document.querySelectorAll('.fame-category').forEach((button) => button.addEventListener('click', () => {
  state.fameCategory = button.dataset.category;
  document.querySelectorAll('.fame-category').forEach((item) => item.classList.toggle('active', item === button));
  document.querySelector('#fame-import-title').textContent = `Importar ${fameCategoryLabels[state.fameCategory]}`;
  resetFamePreview();
}));
document.querySelector('#fame-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 512 * 1024) return showToast('O arquivo deve ter no máximo 512 KB.');
  state.fameSourceName = file.name;
  document.querySelector('#fame-source-name').textContent = file.name;
  document.querySelector('#fame-text').value = await file.text();
  resetFamePreview();
});
document.querySelector('#fame-analyze').addEventListener('click', analyzeFameTable);
document.querySelector('#fame-confirm').addEventListener('click', confirmFameImport);
document.querySelector('#fame-undo').addEventListener('click', undoFameImport);
document.querySelectorAll('.ranking-tab').forEach((button) => button.addEventListener('click', () => {
  state.rankingCategory = button.dataset.rankingCategory;
  document.querySelectorAll('.ranking-tab').forEach((item) => {
    const selected = item === button;
    item.classList.toggle('active', selected);
    item.setAttribute('aria-selected', String(selected));
  });
  if (state.data) renderFameRankings(state.data.rankings.fame);
}));
document.querySelectorAll('.table-controls input, .table-controls select').forEach((control) => {
  control.addEventListener(control.matches('input') ? 'input' : 'change', () => {
    if (!state.data) return;
    renderMembers(state.data.members);
    renderRegistrations(state.data.members, state.data.operations.registrationsPending);
    renderEvents(state.data.events);
    renderFinance(state.data.finance, state.data.overview.totalMemberBalance);
    renderRankings(state.data.rankings);
    renderAudit(state.data.audit);
  });
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - state.lastLoadedAt >= 30000) loadDashboard();
});

Promise.all([loadSession(), loadDashboard()]).catch(() => {});
window.setInterval(() => { if (!document.hidden) loadDashboard(); }, 30000);
