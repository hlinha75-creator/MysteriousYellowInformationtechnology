const state = {
  view: 'events',
  balance: 0,
  received: 0,
  registration: 'sem registro',
  event: {
    title: 'FastContent',
    description: 'Pergunte na Call',
    location: 'Pergunte na Call',
    time: defaultTime(),
    status: 'created',
    voice: '',
    netLoot: 11380000,
    slots: { tank: 3, healer: 3, support: 3, dps: 11 },
    participants: [
      { name: 'Tmaiusculo', role: 'dps', weaponId: 'dps-repetidor-1', weapon: 'Repetidor 1', minutes: 70 },
      { name: 'Jokker1998', role: 'tank', weaponId: 'tank-martelo', weapon: 'Martelo', minutes: 70 },
      { name: 'WillHue', role: 'healer', weaponId: 'healer-hallow', weapon: 'Hallow', minutes: 70 }
    ],
    spectators: []
  },
  log: ['Simulador carregado. Nenhum dado real foi alterado.']
};

const roleInfo = {
  tank: { label: 'Tank', button: 'tank', icon: 'Tank.webp' },
  healer: { label: 'Healer', button: 'healer', icon: 'Healer.webp' },
  support: { label: 'Suporte', button: 'support', icon: 'Supp.webp' },
  dps: { label: 'DPS', button: 'dps', icon: 'DPS.webp' }
};

const weaponSlots = [
  { id: 'tank-martelo', name: 'Martelo', file: 'Martelo.webp', role: 'tank' },
  { id: 'tank-incubus', name: 'Incubus', file: 'Incubus.webp', role: 'tank' },
  { id: 'tank-quebra', name: 'Quebra', file: 'Quebra.webp', role: 'tank' },
  { id: 'healer-hallow', name: 'Hallow', file: 'queda santa.webp', role: 'healer' },
  { id: 'healer-fallen', name: 'Fallen', file: 'Fallen.webp', role: 'healer' },
  { id: 'healer-raiz', name: 'Raiz', file: 'Iron.webp', role: 'healer' },
  { id: 'support-sc', name: 'SC', file: 'SC.webp', role: 'support' },
  { id: 'support-damnation', name: 'Danacao', file: 'Damnation.webp', role: 'support' },
  { id: 'support-enig', name: 'Enig', file: 'Enig.webp', role: 'support' },
  { id: 'dps-repetidor-1', name: 'Repetidor 1', file: 'Repetidor.webp', role: 'dps' },
  { id: 'dps-lc', name: 'LC', file: 'LC.webp', role: 'dps' },
  { id: 'dps-chill', name: 'Chill', file: 'chill.webp', role: 'dps' },
  ...Array.from({ length: 8 }, (_, index) => ({
    id: `dps-repetidor-${index + 2}`,
    name: `Repetidor ${index + 2}`,
    file: 'Repetidor.webp',
    role: 'dps'
  }))
];

const views = {
  events: { id: 'eventsView', label: '# ⚔️ eventos' },
  finance: { id: 'financeView', label: '# 💰 financeiro' },
  balance: { id: 'balanceView', label: '# 💵 consultar-saldo' },
  registration: { id: 'registrationView', label: '# 📝 registro' },
  admin: { id: 'adminView', label: '# 🛠️ painel-adm' },
  member: { id: 'memberView', label: '# 🤖 assistente-geral' }
};

const eventModal = document.querySelector('#eventModal');

document.addEventListener('click', (event) => {
  const channel = event.target.closest('.channel');
  const actionButton = event.target.closest('[data-action]');

  if (channel) {
    changeView(channel.dataset.view);
    return;
  }

  if (actionButton) {
    handleAction(actionButton.dataset.action, actionButton);
  }
});

document.querySelector('#saveEvent').addEventListener('click', (event) => {
  event.preventDefault();
  const slots = parseSlots(document.querySelector('#eventSlots').value);
  state.event = {
    title: valueOrDefault('#eventTitle', 'FastContent'),
    description: valueOrDefault('#eventDescription', 'Pergunte na Call'),
    location: valueOrDefault('#eventLocation', 'Pergunte na Call'),
    time: valueOrDefault('#eventTime', defaultTime()),
    status: 'created',
    voice: '',
    netLoot: 11380000,
    slots,
    participants: [],
    spectators: []
  };
  addLog(`Evento "${state.event.title}" criado.`);
  eventModal.close();
  render();
});

document.querySelector('#resetDemo').addEventListener('click', () => {
  window.location.reload();
});

function handleAction(action, element) {
  const actions = {
    createEvent: () => eventModal.showModal(),
    joinTank: () => joinRole('tank'),
    joinHealer: () => joinRole('healer'),
    joinSupport: () => joinRole('support'),
    joinDps: () => joinRole('dps'),
    joinWeapon: () => joinWeapon(element.dataset.weapon),
    startEvent,
    finishEvent,
    cancelEvent,
    spectate,
    pause,
    approvePayment,
    checkBalance: () => addLog(`Saldo consultado: ${formatSilver(state.balance)}.`),
    withdraw: () => addLog('Pedido de saque simulado: o saldo so sairia quando a staff aprovar/pagar.'),
    register,
    approveRegister,
    keepGuest,
    deposit,
    exportCsv: () => addLog('CSV de saldos exportado no canal Arquivar/CSV.'),
    importCsv: () => addLog('Importacao CSV simulada: previa, confirmacao e auditoria.'),
    verifyGuild: () => addLog('Verificacao de guilda simulada: nomes encontrados virariam Membro.'),
    seasonPoints: () => addLog('Pontos temporada: 18.420 pontos.'),
    influencePoints: () => addLog('Pontos influencia: 7.930 pontos.'),
    builds: () => addLog('Builds PvE: Raid Avalon Full, Raid reduzida, Gold Chest, DG Grupo e WorldBoss.'),
    askStaff: () => addLog('Pergunta enviada para uma staff online e resposta voltaria por DM.'),
    anonymousReport: () => addLog('Denuncia anonima enviada para pendencia de membros.'),
    botHelp: () => addLog('Bot reconheceu palavra-chave: saldo, saque, evento ou registro.')
  };
  actions[action]?.();
  render();
}

function changeView(view) {
  state.view = view;
  document.querySelectorAll('.channel').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach((section) => {
    section.classList.toggle('active-view', section.id === views[view].id);
  });
  document.querySelector('#channelName').textContent = views[view].label;
}

function joinRole(role) {
  if (state.event.status !== 'created' && state.event.status !== 'running') {
    addLog('Evento nao aceita novas participacoes nesse status.');
    return;
  }

  const used = state.event.participants.filter((person) => person.role === role).length;
  if (used >= state.event.slots[role]) {
    addLog(`Nao ha vaga livre para ${roleInfo[role].label}.`);
    return;
  }

  const existing = state.event.participants.find((person) => person.name === 'Voce');
  if (existing) existing.role = role;
  else state.event.participants.push({ name: 'Voce', role, minutes: state.event.status === 'running' ? 1 : 0 });
  addLog(`Voce entrou como ${roleInfo[role].label}.`);
}

function joinWeapon(weaponId) {
  const slot = weaponSlots.find((item) => item.id === weaponId);
  if (!slot) return;
  if (state.event.status !== 'created' && state.event.status !== 'running') {
    addLog('Evento nao aceita novas participacoes nesse status.');
    return;
  }

  const occupied = state.event.participants.find((person) => person.weaponId === slot.id && person.name !== 'Voce');
  if (occupied) {
    addLog(`${slot.name} ja esta ocupado por ${occupied.name}.`);
    return;
  }

  const existing = state.event.participants.find((person) => person.name === 'Voce');
  if (existing) {
    existing.role = slot.role;
    existing.weaponId = slot.id;
    existing.weapon = slot.name;
  } else {
    state.event.participants.push({
      name: 'Voce',
      role: slot.role,
      weaponId: slot.id,
      weapon: slot.name,
      minutes: state.event.status === 'running' ? 1 : 0
    });
  }
  addLog(`Voce pegou a vaga ${slot.name} (${roleInfo[slot.role].label}).`);
}

function startEvent() {
  if (state.event.status !== 'created') {
    addLog('Esse evento ja foi iniciado ou encerrado.');
    return;
  }
  state.event.status = 'running';
  state.event.voice = state.event.title;
  state.event.startedAt = Date.now();
  addLog(`Evento iniciado. Sala de voz criada: ${state.event.voice}.`);
}

function finishEvent() {
  if (state.event.status !== 'running') {
    addLog('Somente evento em andamento pode ser finalizado.');
    return;
  }
  state.event.status = 'review';
  state.event.participants = state.event.participants.map((person) => ({
    ...person,
    minutes: person.minutes || 70
  }));
  addLog('Evento finalizado. Revisao de participacao criada e enviada para financeiro.');
  changeView('finance');
}

function cancelEvent() {
  state.event.status = 'cancelled';
  addLog('Evento cancelado com motivo simulado.');
}

function spectate() {
  if (!state.event.spectators.includes('Voce')) state.event.spectators.push('Voce');
  addLog('Voce entrou como espectador. Tempo nao sera contado.');
}

function pause() {
  addLog('Participacao pausada. Na versao real, sair da call tambem pausa automaticamente.');
}

function approvePayment() {
  if (state.event.status !== 'review') {
    addLog('Nao existe evento pendente de pagamento.');
    return;
  }
  const payout = splitLoot()[0]?.payout || 0;
  state.balance += payout;
  state.received += payout;
  state.event.status = 'approved';
  addLog(`Financeiro aprovado. Voce recebeu ${formatSilver(payout)} e receberia DM.`);
}

function register() {
  const nick = document.querySelector('#albionName').value.trim() || 'Tmaiusculo';
  state.registration = `pendente: ${nick}`;
  addLog(`${nick} registrado. Cargo Convidado aplicado e pendencia enviada para staff.`);
}

function approveRegister() {
  state.registration = 'membro aprovado';
  addLog('Registro aprovado. Convidado removido e Membro aplicado.');
}

function keepGuest() {
  state.registration = 'permanece convidado';
  addLog('Registro resolvido mantendo Convidado.');
}

function deposit() {
  state.balance += 9000000;
  state.received += 9000000;
  addLog('Deposito rapido simulado: Voce recebeu 9m.');
}

function render() {
  renderEvent();
  renderFinance();
  renderState();
  document.querySelector('#balanceValue').textContent = formatSilver(state.balance);
  document.querySelector('#receivedValue').textContent = formatSilver(state.received);
}

function renderEvent() {
  const event = state.event;
  const embed = document.querySelector('#eventEmbed');
  embed.className = `discord-embed event-embed ${event.status}`;
  embed.innerHTML = `
    <h2>${escapeHtml(event.title)}</h2>
    <p><strong>${escapeHtml(event.description)}</strong> · Criador @Tmaiusculo</p>
    <div class="event-meta">
      <div><span>Status</span><b>${statusLabel(event.status)}</b></div>
      <div><span>Local</span><b>${escapeHtml(event.location)}</b></div>
      <div><span>UTC-3</span><b>${escapeHtml(event.time)}</b></div>
      <div><span>Voz</span><b>${event.voice || 'Ainda nao criada'}</b></div>
    </div>
    <div class="role-grid">${Object.keys(roleInfo).map(roleCard).join('')}</div>
    <div class="weapon-grid">${weaponSlots.map(weaponCard).join('')}</div>
    <div class="participants">${participantsText()}</div>
  `;

  const actions = document.querySelector('#eventActions');
  if (event.status === 'created') {
    actions.innerHTML = `
      <button class="primary" data-action="createEvent">Criar/editar evento</button>
      <button class="success" data-action="startEvent">Iniciar</button>
      <button class="danger" data-action="cancelEvent">Cancelar</button>
    `;
    return;
  }
  if (event.status === 'running') {
    actions.innerHTML = `
      <button class="success" data-action="joinDps">Quero participar</button>
      <button class="secondary" data-action="spectate">Assistir</button>
      <button class="secondary" data-action="pause">Pausar participacao</button>
      <button class="primary" data-action="finishEvent">Finalizar</button>
      <button class="danger" data-action="cancelEvent">Cancelar</button>
    `;
    return;
  }
  actions.innerHTML = '<button class="primary" data-action="createEvent">Criar novo evento</button>';
}

function renderFinance() {
  const split = splitLoot();
  const pending = state.event.status === 'review';
  document.querySelector('#financeEmbed').innerHTML = `
    <h2>${pending ? 'Pagamento pendente' : 'Financeiro'}</h2>
    <p>${pending ? 'Staff aprova para depositar os saldos.' : 'Nenhum evento pendente agora.'}</p>
    <div class="metric-row">
      <div><span>Loot liquido</span><strong>${formatSilver(state.event.netLoot)}</strong></div>
      <div><span>Participantes</span><strong>${state.event.participants.length}</strong></div>
    </div>
    <div class="participants">${split.map((item) => `${item.name} - ${roleInfo[item.role]?.label || item.role}${item.weapon ? ` / ${escapeHtml(item.weapon)}` : ''} - ${item.minutes}m - ${formatSilver(item.payout)}`).join('<br>') || 'Sem split calculado.'}</div>
  `;
  document.querySelector('#financeActions').innerHTML = pending
    ? '<button class="success" data-action="approvePayment">Aprovar pagamento</button>'
    : '<button class="secondary" data-action="exportCsv">Exportar saldos</button>';
}

function renderState() {
  const event = state.event;
  const rows = [
    ['Evento', event.title],
    ['Status', statusLabel(event.status)],
    ['Participantes', event.participants.length],
    ['Espectadores', event.spectators.length],
    ['Saldo', formatSilver(state.balance)],
    ['Registro', state.registration]
  ];
  document.querySelector('#stateList').innerHTML = rows.map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`).join('');
  document.querySelector('#demoLog').innerHTML = state.log.slice(-12).reverse().map((line) => `<li>${escapeHtml(line)}</li>`).join('');
}

function roleCard(role) {
  const used = state.event.participants.filter((person) => person.role === role).length;
  const names = state.event.participants.filter((person) => person.role === role).map((person) => person.name).join(', ') || 'Vazio';
  return `<div class="role-card ${role}">
    <img src="${iconPath(roleInfo[role].icon)}" alt="">
    <strong>${roleInfo[role].label} ${used}/${state.event.slots[role]}</strong>
    <b>${escapeHtml(names)}</b>
  </div>`;
}

function weaponCard(slot) {
  const occupant = state.event.participants.find((person) => person.weaponId === slot.id);
  const isFree = !occupant;
  const actionAttrs = isFree || occupant.name === 'Voce' ? `data-action="joinWeapon" data-weapon="${slot.id}"` : '';
  return `<button class="weapon-card ${slot.role} ${isFree ? 'free' : 'busy'}" ${actionAttrs}>
    <img src="${iconPath(slot.file)}" alt="">
    <span>${escapeHtml(slot.name)}</span>
    <strong>${isFree ? 'Livre' : escapeHtml(occupant.name)}</strong>
  </button>`;
}

function participantsText() {
  const people = state.event.participants.map((person) => `${escapeHtml(person.name)} - ${roleInfo[person.role].label}${person.weapon ? ` / ${escapeHtml(person.weapon)}` : ''} - ${person.minutes || 0}m`);
  const spectators = state.event.spectators.map((name) => `${escapeHtml(name)} - 👁️ Espectador`);
  return [...people, ...spectators].join('<br>') || 'Nenhum participante ainda.';
}

function splitLoot() {
  const totalMinutes = state.event.participants.reduce((sum, person) => sum + (person.minutes || 0), 0);
  if (!totalMinutes) return [];
  return state.event.participants.map((person) => ({
    ...person,
    payout: Math.round(state.event.netLoot * (person.minutes || 0) / totalMinutes)
  }));
}

function statusLabel(status) {
  return {
    created: '🟦 Aberto',
    running: '🟢 Em andamento',
    review: '🟡 Em revisao',
    approved: '✅ Finalizado',
    cancelled: '🔴 Cancelado'
  }[status] || status;
}

function parseSlots(value) {
  const [tank, healer, support, dps] = value.split(',').map((part) => Number(part.trim()));
  return {
    tank: tank || 1,
    healer: healer || 1,
    support: support || 1,
    dps: dps || 17
  };
}

function valueOrDefault(selector, fallback) {
  return document.querySelector(selector).value.trim() || fallback;
}

function defaultTime() {
  const date = new Date(Date.now() + 10 * 60 * 1000);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatSilver(value) {
  if (Math.abs(value) >= 1000000) return `${stripZero(value / 1000000)}m`;
  if (Math.abs(value) >= 1000) return `${stripZero(value / 1000)}k`;
  return String(value);
}

function stripZero(value) {
  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function iconPath(file) {
  return `assets/event-icons/${encodeURIComponent(file)}`;
}

function addLog(line) {
  state.log.push(line);
}

document.querySelector('#eventTime').value = defaultTime();
render();
