const commands = [
  {
    name: '/setup',
    category: 'Manutencao',
    access: 'Staff/ADM/Tesouraria',
    description: 'Posta ou atualiza os paineis fixos do bot nos canais configurados.',
    options: 'Sem opcoes.',
    when: 'Use depois de atualizar painel, botao ou canal fixo.'
  },
  {
    name: '/saldo',
    category: 'Financeiro',
    access: 'Todos para si; staff pode consultar outros',
    description: 'Consulta o saldo de prata de um membro.',
    options: 'membro opcional.',
    when: 'Use para conferir saldo rapidamente sem abrir painel.'
  },
  {
    name: '/registro',
    category: 'Registro',
    access: 'Todos',
    description: 'Abre o modal para registrar o nick do Albion.',
    options: 'Sem opcoes.',
    when: 'Use se o painel de registro nao estiver a mao.'
  },
  {
    name: '/enquete',
    category: 'Eventos',
    access: 'Membro ou superior',
    description: 'Cria uma enquete no canal de eventos.',
    options: 'Pergunta e horarios/opcoes no modal.',
    when: 'Use para decidir horario de raid ou atividade.'
  },
  {
    name: '/leilao',
    category: 'Guilda',
    access: 'Membro ou superior',
    description: 'Cria um leilao de item para membros da guild.',
    options: 'codigo opcional, imagem opcional.',
    when: 'Use para vender item com lances no Discord.'
  },
  {
    name: '/objetivo',
    category: 'Eventos',
    access: 'Membro ou superior',
    description: 'Avisa um objetivo temporario no chat NOTAG.',
    options: 'alerta obrigatorio, imagem opcional.',
    when: 'Use para avisar orb, bau, mapa ou chamada rapida.'
  },
  {
    name: '/exportar',
    category: 'Arquivos',
    access: 'Staff/ADM/Tesouraria',
    description: 'Exporta dados em CSV.',
    options: 'tipo: saldos, financeiro, auditoria, voz diaria ou voz bruta. data opcional.',
    when: 'Use para backup manual, conferencia ou planilha.'
  },
  {
    name: '/importar',
    category: 'Arquivos',
    access: 'Staff/ADM/Tesouraria',
    description: 'Importa CSV de saldos com previa e confirmacao.',
    options: 'arquivo CSV obrigatorio.',
    when: 'Use para restaurar ou ajustar saldos por arquivo.'
  },
  {
    name: '/aprovar_pendentes',
    category: 'Registro',
    access: 'Staff/ADM/Recrutador',
    description: 'Aprova pedidos pendentes de registro usando CSV/TSV da guild Albion.',
    options: 'arquivo CSV/TSV obrigatorio.',
    when: 'Use no canal de solicitacoes quando houver muitos registros pendentes.'
  },
  {
    name: '/relatorio_diario',
    category: 'Relatorios',
    access: 'Staff/ADM/Tesouraria',
    description: 'Gera relatorio comparando membros Albion e voz Discord.',
    options: 'arquivo atual obrigatorio, anterior opcional, voz opcional, data opcional.',
    when: 'Use para rotina diaria de acompanhamento da guild.'
  },
  {
    name: '/auditar_guilda',
    category: 'Auditoria',
    access: 'Staff/ADM/Recrutador',
    description: 'Audita membros do Discord contra a lista da guild no Albion.',
    options: 'arquivo exportado do jogo obrigatorio.',
    when: 'Use para achar nicks divergentes, ausentes ou parecidos.'
  },
  {
    name: '/aplicar_verificacao_guild',
    category: 'Auditoria',
    access: 'Staff/ADM/Recrutador',
    description: 'Aplica uma verificacao de guild ja analisada.',
    options: 'codigo obrigatorio, acao obrigatoria.',
    when: 'Use depois de /auditar_guilda para renomear parecidos ou perguntar nao encontrados.'
  },
  {
    name: '/renomear_canais',
    category: 'Manutencao',
    access: 'Staff/ADM/Tesouraria',
    description: 'Mostra ou aplica a padronizacao de nomes dos canais do bot.',
    options: 'aplicar opcional.',
    when: 'Use quando canais foram criados/renomeados manualmente.'
  },
  {
    name: '/auditar_canais',
    category: 'Manutencao',
    access: 'Staff/ADM/Tesouraria',
    description: 'Lista canais e categorias do servidor e marca os conhecidos pelo bot.',
    options: 'Sem opcoes.',
    when: 'Use para conferir IDs e descobrir canal novo.'
  }
];

const searchInput = document.querySelector('#searchInput');
const categoryFilter = document.querySelector('#categoryFilter');
const commandList = document.querySelector('#commandList');
const countBadge = document.querySelector('#countBadge');

const categories = [...new Set(commands.map((command) => command.category))].sort((a, b) => a.localeCompare(b));
for (const category of categories) {
  const option = document.createElement('option');
  option.value = category;
  option.textContent = category;
  categoryFilter.appendChild(option);
}

searchInput.addEventListener('input', render);
categoryFilter.addEventListener('change', render);

function render() {
  const query = normalize(searchInput.value);
  const category = categoryFilter.value;
  const rows = commands.filter((command) => {
    const matchesCategory = category === 'all' || command.category === category;
    const searchable = normalize(Object.values(command).join(' '));
    return matchesCategory && (!query || searchable.includes(query));
  });

  countBadge.textContent = `${rows.length} comando${rows.length === 1 ? '' : 's'}`;
  commandList.innerHTML = rows.length ? rows.map(commandCard).join('') : '<div class="empty">Nenhum comando encontrado.</div>';
}

function commandCard(command) {
  const staffClass = command.access.toLowerCase().includes('staff') || command.access.toLowerCase().includes('adm')
    ? ' staff'
    : '';
  return `
    <article class="command-card">
      <div class="command-main">
        <div class="command-head">
          <h2 class="command-name">${escapeHtml(command.name)}</h2>
          <span class="tag${staffClass}">${escapeHtml(command.category)}</span>
        </div>
        <p class="description">${escapeHtml(command.description)}</p>
      </div>
      <div class="meta">
        <div class="meta-row"><strong>Quem usa</strong><span>${escapeHtml(command.access)}</span></div>
        <div class="meta-row"><strong>Opcoes</strong><span>${escapeHtml(command.options)}</span></div>
        <div class="meta-row"><strong>Quando usar</strong><span>${escapeHtml(command.when)}</span></div>
      </div>
    </article>
  `;
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
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
