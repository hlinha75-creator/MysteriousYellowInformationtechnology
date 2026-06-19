const priorities = [
  {
    risk: 'critico',
    title: 'Padronizar horario antes de crescer mais',
    body: 'O projeto ja mostra UTC na interface, mas MEMORY e mockups antigos ainda citam UTC-3. Tambem existe parser antigo de UTC-3. Isso precisa virar uma decisao unica para evitar evento no horario errado.',
    action: 'Decisao sugerida: manter tudo em UTC no bot e documentar conversao para os jogadores.'
  },
  {
    risk: 'critico',
    title: 'Criar rotina de restore do banco',
    body: 'Backup existe, ledger existe, CSV existe. O ponto fraco agora e saber restaurar quando estiver nervoso e com a guild esperando.',
    action: 'Uma vez por mes: baixar backup, restaurar em copia local e abrir saldos para conferir.'
  },
  {
    risk: 'alto',
    title: 'Separar arquivos grandes',
    body: 'events.service.js passou de 62 KB e buttons.js passou de 41 KB. Isso aumenta chance de quebrar uma coisa ao mexer em outra.',
    action: 'Separar por dominio: eventLifecycle, eventReview, eventReminders, financeButtons, memberButtons.'
  },
  {
    risk: 'alto',
    title: 'Colocar chave para desligar automacoes',
    body: 'Black For-Fun diario e auto-start sao uteis, mas precisam de botao de emergencia via .env.',
    action: 'Exemplo: ENABLE_BLACK_FOR_FUN=false e ENABLE_EVENT_AUTOSTART=false.'
  },
  {
    risk: 'alto',
    title: 'Auditar permissao de cargos temporarios',
    body: 'Eventos agora criam tags temporarias. Se o cargo do bot estiver baixo na hierarquia, ele falha sem o ADM perceber.',
    action: 'Testar criar cargo, mencionar, adicionar em membro e apagar apos 24h.'
  },
  {
    risk: 'medio',
    title: 'Renomear tabela de carreira no futuro',
    body: 'raid_avalon_weapon_career agora guarda pontos de classe/funcao de varios eventos, nao so Raid Avalon.',
    action: 'Planejar migracao calma para event_career_points quando o bot estiver estavel.'
  },
  {
    risk: 'medio',
    title: 'Registrar falha de DM',
    body: 'O bot manda historico de saldo no privado, mas alguns membros bloqueiam DM. Sem log disso, a staff acha que todos foram avisados.',
    action: 'Gerar audit log quando DM falhar.'
  },
  {
    risk: 'baixo',
    title: 'Arquivar prototipos antigos',
    body: 'A pasta dashboard tem varios previews. Isso e bom para memoria, mas ruim se voce nao souber qual e o atual.',
    action: 'Mover previews antigos para dashboard/arquivo ou resumir no MEMORY.md.'
  }
];

const weeklyTasks = [
  {
    id: 'backup',
    title: 'Conferir backup de saldos',
    detail: 'Verificar se o CSV automatico apareceu no canal de arquivos e se o banco teve backup recente.'
  },
  {
    id: 'restore',
    title: 'Treinar restore em copia local',
    detail: 'Pelo menos mensalmente, restaurar backup fora do Discloud e conferir alguns saldos.'
  },
  {
    id: 'guilda',
    title: 'Enviar CSV/TSV da guild do Albion',
    detail: 'Usar a verificacao de pendentes para aprovar membros que realmente estao na guild.'
  },
  {
    id: 'pontos',
    title: 'Atualizar pontos do Albion',
    detail: 'Importar ou substituir arquivos semanais de temporada/influencia quando voce exportar.'
  },
  {
    id: 'builds',
    title: 'Revisar builds PvE',
    detail: 'Preencher lacunas de imagem/detalhe e remover builds desatualizadas.'
  },
  {
    id: 'financeiro',
    title: 'Limpar filas financeiras',
    detail: 'Eventos pendentes, eventos devolvidos, saques solicitados e depositos recentes.'
  },
  {
    id: 'logs',
    title: 'Ler logs do Discloud',
    detail: 'Procurar Unknown interaction, falha de DM, falha de cargo, erro em saque e erro de voz.'
  }
];

const storageKey = 'notag-review-weekly-v1';
const doneState = JSON.parse(localStorage.getItem(storageKey) || '{}');

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(doneState));
}

function badge(risk) {
  const labels = {
    critico: 'Critico',
    alto: 'Alto',
    medio: 'Medio',
    baixo: 'Baixo'
  };
  return `<span class="badge ${risk}">${labels[risk]}</span>`;
}

function renderPriorities(filter = 'todos') {
  const list = document.querySelector('#priorityList');
  const items = priorities.filter((item) => filter === 'todos' || item.risk === filter);
  list.innerHTML = items.map((item) => `
    <article>
      ${badge(item.risk)}
      <h2>${item.title}</h2>
      <p>${item.body}</p>
      <p><strong>Proxima acao:</strong> ${item.action}</p>
    </article>
  `).join('');
}

function renderChecklist() {
  const list = document.querySelector('#weeklyChecklist');
  list.innerHTML = weeklyTasks.map((task) => {
    const state = doneState[task.id];
    const checked = state?.done ? 'checked' : '';
    const date = state?.date ? `Feito em ${state.date}` : 'Ainda nao marcado';
    return `
      <label class="task">
        <input type="checkbox" data-task="${task.id}" ${checked}>
        <span>
          <strong>${task.title}</strong>
          <span>${task.detail}</span>
          <span>${date}</span>
        </span>
        <button type="button" data-mark="${task.id}">Hoje</button>
      </label>
    `;
  }).join('');
}

document.querySelectorAll('.tab').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
    document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
    button.classList.add('active');
    document.querySelector(`#${button.dataset.view}`).classList.add('active');
  });
});

document.querySelector('#riskFilter')?.addEventListener('change', (event) => {
  renderPriorities(event.target.value);
});

document.addEventListener('change', (event) => {
  if (!event.target.matches('[data-task]')) return;
  const id = event.target.dataset.task;
  doneState[id] = {
    done: event.target.checked,
    date: event.target.checked ? new Date().toLocaleDateString('pt-BR') : ''
  };
  saveState();
  renderChecklist();
});

document.addEventListener('click', (event) => {
  if (!event.target.matches('[data-mark]')) return;
  const id = event.target.dataset.mark;
  doneState[id] = {
    done: true,
    date: new Date().toLocaleDateString('pt-BR')
  };
  saveState();
  renderChecklist();
});

renderPriorities();
renderChecklist();
