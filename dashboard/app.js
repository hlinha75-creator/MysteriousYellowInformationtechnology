const emptyDatasets = () => ({
  membros: [],
  pve: [],
  pvp: [],
  coletores: [],
  crafters: [],
  movimentacao: [],
  finance: [],
  voice: []
});

const state = {
  files: {
    previous: [],
    current: []
  },
  datasets: {
    previous: emptyDatasets(),
    current: emptyDatasets()
  }
};

const weekdayOrder = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const previousFileInput = document.querySelector('#previousFileInput');
const currentFileInput = document.querySelector('#currentFileInput');
const memberSearch = document.querySelector('#memberSearch');
const channelFilter = document.querySelector('#channelFilter');
const sectionFilter = document.querySelector('#sectionFilter');
const exportMerged = document.querySelector('#exportMerged');
const clearAll = document.querySelector('#clearAll');

previousFileInput.addEventListener('change', (event) => loadFiles('previous', [...event.target.files]));
currentFileInput.addEventListener('change', (event) => loadFiles('current', [...event.target.files]));
memberSearch.addEventListener('input', render);
channelFilter.addEventListener('change', render);
sectionFilter.addEventListener('change', render);
exportMerged.addEventListener('click', exportComparisonCsv);
clearAll.addEventListener('click', clearComparison);

for (const zone of document.querySelectorAll('.drop-zone')) {
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('dragging');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('dragging');
    loadFiles(zone.dataset.period, [...event.dataTransfer.files]);
  });
}

render();

async function loadFiles(period, files) {
  const nextDatasets = emptyDatasets();
  const loaded = [];

  for (const file of files) {
    const text = await file.text();
    const type = detectType(file.name, text);
    const rows = parseAny(text, type);
    nextDatasets[type].push(...rows);
    loaded.push({ name: file.name, type, rows: rows.length });
  }

  state.files[period] = loaded;
  state.datasets[period] = nextDatasets;
  render();
}

function clearComparison() {
  state.files.previous = [];
  state.files.current = [];
  state.datasets.previous = emptyDatasets();
  state.datasets.current = emptyDatasets();
  previousFileInput.value = '';
  currentFileInput.value = '';
  render();
}

function detectType(name, text) {
  const lower = normalize(name);
  if (lower.includes('voice') || lower.includes('voz') || lower.includes('call')) return 'voice';
  if (lower.includes('finance')) return 'finance';
  if (lower.includes('moviment')) return 'movimentacao';
  if (lower.includes('colet')) return 'coletores';
  if (lower.includes('craft')) return 'crafters';
  if (lower.includes('pvp')) return 'pvp';
  if (lower.includes('pve')) return 'pve';
  if (lower.includes('membro')) return 'membros';
  if (text.includes('Character Name') && text.includes('Last Seen')) return 'membros';
  if (text.includes('channel_name') && (text.includes('joined_at') || text.includes('voice_seconds'))) return 'voice';
  return 'membros';
}

function parseAny(text, type) {
  const rows = looksLikeCsv(text) ? parseCsv(text) : parseLines(text);
  return rows.map((row) => normalizeRow(row, type)).filter((row) => row.member || row.discordId || row.discordName);
}

function looksLikeCsv(text) {
  const first = text.split(/\r?\n/).find(Boolean) || '';
  return first.includes(',') || first.includes(';') || first.includes('\t');
}

function parseCsv(text) {
  const delimiter = guessDelimiter(text);
  const rows = [];
  let current = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      row.push(current);
      current = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(current);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }

  row.push(current);
  if (row.some((cell) => cell.trim())) rows.push(row);
  const headers = rows.shift() || [];
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header.trim(), (cells[index] || '').trim()])));
}

function guessDelimiter(text) {
  const line = text.split(/\r?\n/).find(Boolean) || '';
  const counts = [',', ';', '\t'].map((char) => [char, line.split(char).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][0];
}

function parseLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^[-=#]{3,}$/.test(line))
    .map((line) => {
      const values = Object.fromEntries([...line.matchAll(/([\w ]+)\s*[:=]\s*([^|;,]+)/g)].map((match) => [match[1].trim(), match[2].trim()]));
      if (Object.keys(values).length > 0) return values;
      const parts = line.split(/[|;,]\s*/).filter(Boolean);
      return {
        nome: parts[0] || line,
        valor: parts[1] || '',
        extra: parts.slice(2).join(' | ')
      };
    });
}

function normalizeRow(row, type) {
  const member = first(row, ['Character Name', 'character_name', 'albion_name', 'Albion_Name', 'Albion', 'Nick', 'nome', 'Nome', 'player', 'Player', 'member', 'Membro']);
  const discordId = first(row, ['discord_id', 'Discord_ID', 'user_id', 'User_ID', 'ID', 'id']);
  const discordName = first(row, ['discord_name', 'Discord_Name', 'Discord', 'name', 'Nome Discord']);
  const seconds = number(first(row, ['voice_seconds', 'seconds', 'segundos']));
  const amount = number(first(row, ['amount', 'balance', 'saldo', 'valor', 'Silver', 'silver']));
  const roles = first(row, ['Roles', 'roles', 'Cargos', 'cargos']);
  const lastSeen = first(row, ['Last Seen', 'last_seen', 'Visto por ultimo', 'ultimo_login']);
  return {
    type,
    member: cleanName(member || first(row, ['nome'])),
    discordId,
    discordName,
    channelName: first(row, ['top_channels', 'channel_name', 'Canal', 'sala', 'Sala']),
    categoryName: first(row, ['category_name', 'Categoria']),
    joinedAt: first(row, ['first_joined_at', 'joined_at', 'entrada', 'Entrou', 'created_at']),
    leftAt: first(row, ['last_left_at', 'left_at', 'saida', 'Saiu']),
    lastSeen,
    roles,
    weekday: normalize(first(row, ['weekday', 'dia', 'Dia'])),
    joinedHour: first(row, ['favorite_hours', 'joined_hour', 'hora', 'Hora']),
    seconds,
    sessions: number(first(row, ['voice_sessions', 'sessions', 'sessoes'])),
    amount,
    raw: row
  };
}

function buildMembers(period) {
  const members = new Map();
  const add = (key, patch) => {
    const normalizedKey = normalize(key);
    if (!normalizedKey) return null;
    const item = members.get(normalizedKey) || {
      key: normalizedKey,
      member: '',
      discordId: '',
      discordName: '',
      sections: new Set(),
      voiceSeconds: 0,
      voiceSessions: 0,
      channels: new Map(),
      weekdays: new Map(),
      hours: new Map(),
      financeAmount: 0,
      lastSeen: '',
      roles: new Set()
    };
    Object.assign(item, patch);
    members.set(normalizedKey, item);
    return item;
  };

  for (const type of ['membros', 'pve', 'pvp', 'coletores', 'crafters', 'movimentacao']) {
    for (const row of state.datasets[period][type]) {
      const item = add(row.member || row.discordName || row.discordId, {
        member: row.member || row.discordName || row.discordId,
        discordId: row.discordId,
        discordName: row.discordName,
        lastSeen: row.lastSeen
      });
      if (item) {
        item.sections.add(type);
        for (const role of splitRoles(row.roles)) item.roles.add(role);
      }
    }
  }

  for (const row of state.datasets[period].finance) {
    const item = add(row.member || row.discordName || row.discordId, {
      member: row.member || row.discordName || row.discordId,
      discordId: row.discordId,
      discordName: row.discordName
    });
    if (item) item.financeAmount += row.amount;
  }

  for (const row of state.datasets[period].voice) {
    const item = add(row.member || row.discordName || row.discordId, {
      member: row.member || row.discordName || row.discordId,
      discordId: row.discordId,
      discordName: row.discordName
    });
    if (!item) continue;
    item.voiceSeconds += row.seconds;
    item.voiceSessions += row.sessions || 1;
    addDelimitedValues(item.channels, row.channelName || 'Sem canal', row.seconds);
    addDelimitedValues(item.weekdays, row.weekday || weekdayFromDate(row.joinedAt), row.seconds);
    addDelimitedValues(item.hours, row.joinedHour || hourFromDate(row.joinedAt), row.seconds);
  }

  return members;
}

function buildComparison() {
  const previous = buildMembers('previous');
  const current = buildMembers('current');
  const keys = new Set([...previous.keys(), ...current.keys()]);
  const rows = [...keys].map((key) => {
    const before = previous.get(key) || null;
    const after = current.get(key) || null;
    return {
      key,
      member: after?.member || before?.member || '',
      discordId: after?.discordId || before?.discordId || '',
      discordName: after?.discordName || before?.discordName || '',
      before,
      after,
      status: after && before ? 'permaneceu' : after ? 'novo' : 'saiu',
      voiceDelta: (after?.voiceSeconds || 0) - (before?.voiceSeconds || 0),
      sectionDelta: (after?.sections.size || 0) - (before?.sections.size || 0)
    };
  });

  const search = normalize(memberSearch.value);
  const channel = channelFilter.value;
  const section = sectionFilter.value;
  return rows
    .filter((row) => !search || normalize(`${row.member} ${row.discordName} ${row.discordId}`).includes(search))
    .filter((row) => !section || row.before?.sections.has(section) || row.after?.sections.has(section))
    .filter((row) => !channel || row.before?.channels.has(channel) || row.after?.channels.has(channel))
    .sort((a, b) => statusWeight(a.status) - statusWeight(b.status) || Math.abs(b.voiceDelta) - Math.abs(a.voiceDelta));
}

function statusWeight(status) {
  return { novo: 0, saiu: 1, permaneceu: 2 }[status] ?? 3;
}

function render() {
  const comparison = buildComparison();
  renderFilters();
  renderMetrics(comparison);
  renderRows(comparison);
  renderCharts([...buildMembers('current').values()]);
  renderChannels([...buildMembers('current').values()]);
  renderFiles();
}

function renderFilters() {
  const currentValue = channelFilter.value;
  const channels = [...new Set([
    ...state.datasets.previous.voice.map((row) => row.channelName).filter(Boolean),
    ...state.datasets.current.voice.map((row) => row.channelName).filter(Boolean)
  ])].flatMap((value) => value.split('|').map((item) => item.trim())).filter(Boolean).sort();
  const uniqueChannels = [...new Set(channels)];
  channelFilter.innerHTML = '<option value="">Todos</option>' + uniqueChannels.map((channel) => `<option value="${escapeHtml(channel)}">${escapeHtml(channel)}</option>`).join('');
  channelFilter.value = uniqueChannels.includes(currentValue) ? currentValue : '';
}

function renderMetrics(rows) {
  const currentMembers = rows.filter((row) => row.after).length;
  const newMembers = rows.filter((row) => row.status === 'novo').length;
  const removedMembers = rows.filter((row) => row.status === 'saiu').length;
  const voiceDelta = rows.reduce((sum, row) => sum + row.voiceDelta, 0);
  document.querySelector('#metrics').innerHTML = [
    metric('Membros no dia atual', currentMembers),
    metric('Novos no comparativo', newMembers),
    metric('Sumiram do comparativo', removedMembers),
    metric('Delta de voz', signedHours(voiceDelta))
  ].join('');
}

function metric(label, value) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function renderRows(rows) {
  document.querySelector('#rowCount').textContent = `${rows.length} linhas`;
  document.querySelector('#memberRows').innerHTML = rows.length
    ? rows.map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.member || '-')}</strong><br><span class="tagline">${escapeHtml(row.discordName || row.discordId || '-')}</span></td>
        <td>${memberSnapshot(row.after)}</td>
        <td>${memberSnapshot(row.before)}</td>
        <td><span class="status ${row.status}">${labelStatus(row.status)}</span><br>${signedNumber(row.sectionDelta)} sessoes</td>
        <td>${formatHours(row.after?.voiceSeconds || 0)}<br><span class="tagline">${row.after?.voiceSessions || 0} calls</span></td>
        <td><strong>${signedHours(row.voiceDelta)}</strong></td>
        <td>${tags(topKeys(row.after?.channels || new Map(), 4))}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="7" class="empty">Carregue o dia anterior e o dia atual para comparar.</td></tr>';
}

function renderCharts(members) {
  const weekdayData = new Map(weekdayOrder.map((day) => [day, 0]));
  const hourData = new Map(Array.from({ length: 24 }, (_, hour) => [String(hour).padStart(2, '0'), 0]));

  for (const member of members) {
    for (const [day, seconds] of member.weekdays) increment(weekdayData, day, seconds);
    for (const [hour, seconds] of member.hours) increment(hourData, hour, seconds);
  }

  drawBarChart('weekdayChart', [...weekdayData.keys()], [...weekdayData.values()].map((value) => value / 3600), '#0f766e');
  drawBarChart('hourChart', [...hourData.keys()], [...hourData.values()].map((value) => value / 3600), '#7a5af8');
}

function drawBarChart(id, labels, values, color) {
  const canvas = document.getElementById(id);
  const ctx = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 500;
  const height = canvas.height;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);

  const max = Math.max(...values, 1);
  const left = 38;
  const bottom = 36;
  const top = 14;
  const chartWidth = width - left - 16;
  const chartHeight = height - top - bottom;
  const gap = 6;
  const barWidth = Math.max(6, (chartWidth - gap * (labels.length - 1)) / labels.length);

  ctx.strokeStyle = '#d9dee7';
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, top + chartHeight);
  ctx.lineTo(width - 10, top + chartHeight);
  ctx.stroke();

  labels.forEach((label, index) => {
    const x = left + index * (barWidth + gap);
    const barHeight = (values[index] / max) * chartHeight;
    const y = top + chartHeight - barHeight;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, barWidth, barHeight);
    ctx.fillStyle = '#667085';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(label.slice(0, 3), x + barWidth / 2, height - 12);
  });
}

function renderChannels(members) {
  const channels = new Map();
  for (const member of members) {
    for (const [channel, seconds] of member.channels) increment(channels, channel, seconds);
  }
  const rows = [...channels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(...rows.map((row) => row[1]), 1);
  document.querySelector('#channelList').innerHTML = rows.length
    ? rows.map(([channel, seconds]) => `
      <div class="rank-item">
        <strong>${escapeHtml(channel)}</strong>
        <span>${formatHours(seconds)}</span>
        <div class="bar"><span style="width:${Math.round((seconds / max) * 100)}%"></span></div>
      </div>
    `).join('')
    : '<div class="empty">Nenhum CSV de voz do dia atual carregado.</div>';
}

function renderFiles() {
  const block = (title, files) => `
    <div>
      <strong>${title}</strong>
      ${files.length
        ? files.map((file) => `<br><span>${escapeHtml(file.name)} - ${file.type} - ${file.rows} linhas</span>`).join('')
        : '<br><span>Nenhum arquivo carregado.</span>'}
    </div>
  `;
  document.querySelector('#loadedFiles').innerHTML = [
    block('Dia anterior', state.files.previous),
    block('Dia atual', state.files.current)
  ].join('');
}

function exportComparisonCsv() {
  const rows = buildComparison().map((row) => ({
    membro: row.member,
    discord_id: row.discordId,
    discord_name: row.discordName,
    status: row.status,
    sessoes_anterior: [...row.before?.sections || []].join('|'),
    sessoes_atual: [...row.after?.sections || []].join('|'),
    delta_sessoes: row.sectionDelta,
    voz_anterior_segundos: row.before?.voiceSeconds || 0,
    voz_atual_segundos: row.after?.voiceSeconds || 0,
    delta_voz_segundos: row.voiceDelta,
    canais_atuais: topKeys(row.after?.channels || new Map(), 5).join('|')
    ,
    roles_anteriores: [...row.before?.roles || []].join('|'),
    roles_atuais: [...row.after?.roles || []].join('|'),
    last_seen_anterior: row.before?.lastSeen || '',
    last_seen_atual: row.after?.lastSeen || ''
  }));
  downloadCsv('notag-comparacao-diaria.csv', rows);
}

function memberSnapshot(member) {
  if (!member) return '-';
  const roleList = [...member.roles].slice(0, 4);
  return [
    tags([...member.sections]),
    member.lastSeen ? `<span class="tagline">last seen: ${escapeHtml(member.lastSeen)}</span>` : '',
    roleList.length ? tags(roleList) : ''
  ].filter(Boolean).join('<br>');
}

function downloadCsv(name, rows) {
  const columns = Object.keys(rows[0] || { vazio: '' });
  const csv = [columns.join(','), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function first(row, keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim()) return String(row[key]).trim();
  }
  return '';
}

function cleanName(value) {
  return String(value || '').replace(/^[-*\d.\s]+/, '').trim();
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function number(value) {
  const cleaned = String(value || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function increment(map, key, value) {
  const cleanKey = String(key || 'Sem dado').trim() || 'Sem dado';
  map.set(cleanKey, (map.get(cleanKey) || 0) + value);
}

function addDelimitedValues(map, value, seconds) {
  const parts = String(value || 'Sem dado').split('|').map((item) => item.trim()).filter(Boolean);
  for (const part of parts.length ? parts : ['Sem dado']) increment(map, part, seconds);
}

function topKeys(map, limit) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key]) => key);
}

function tags(values) {
  const list = values.filter(Boolean);
  return list.length ? list.map((value) => `<span class="tagline">${escapeHtml(value)}</span>`).join('') : '-';
}

function splitRoles(value) {
  return String(value || '')
    .split(/[;|,]/)
    .map((role) => role.trim())
    .filter(Boolean);
}

function weekdayFromDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Sem dia' : weekdayOrder[date.getDay()];
}

function hourFromDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '00' : String(date.getHours()).padStart(2, '0');
}

function formatHours(seconds) {
  const hours = seconds / 3600;
  if (hours >= 10) return `${Math.round(hours)}h`;
  if (hours >= 1) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round(seconds / 60)}min`;
}

function signedHours(seconds) {
  const sign = seconds > 0 ? '+' : seconds < 0 ? '-' : '';
  return `${sign}${formatHours(Math.abs(seconds))}`;
}

function signedNumber(value) {
  return value > 0 ? `+${value}` : String(value);
}

function labelStatus(status) {
  return { novo: 'Novo', saiu: 'Saiu', permaneceu: 'Permaneceu' }[status] || status;
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

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
