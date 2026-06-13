const commands = [
  {
    name: '/setup',
    audience: 'Staff',
    description: 'Posta ou atualiza os paineis fixos do bot.',
    options: ['permissao: gerenciar servidor']
  },
  {
    name: '/saldo',
    audience: 'Membros',
    description: 'Consulta saldo proprio ou de um membro selecionado.',
    options: ['membro opcional']
  },
  {
    name: '/evento',
    audience: 'Membros',
    description: 'Consulta ou acompanha a manutencao de um evento pelo codigo.',
    options: ['codigo obrigatorio', 'ex: EVT-000001']
  },
  {
    name: '/season',
    audience: 'Membros',
    description: 'Apresenta o resultado da Season 32 da NoTag.',
    options: ['sem opcoes']
  },
  {
    name: '/registro',
    audience: 'Membros',
    description: 'Abre o fluxo de registro do nome em jogo.',
    options: ['sem opcoes']
  },
  {
    name: '/enquete',
    audience: 'Staff',
    description: 'Cria uma enquete no canal de eventos.',
    options: ['use no canal adequado']
  },
  {
    name: '/leilao',
    audience: 'Staff',
    description: 'Cria um leilao de item para membros da guild.',
    options: ['codigo opcional', 'imagem opcional']
  },
  {
    name: '/objetivo',
    audience: 'Staff',
    description: 'Avisa um objetivo temporario no chat Notag.',
    options: ['alerta obrigatorio', 'imagem opcional']
  },
  {
    name: '/exportar',
    audience: 'Staff',
    description: 'Exporta dados em CSV para saldos, financeiro, auditoria ou voz.',
    options: ['tipo obrigatorio', 'data opcional']
  },
  {
    name: '/importar',
    audience: 'Staff',
    description: 'Importa CSV de saldos usando fluxo com confirmacao.',
    options: ['arquivo obrigatorio']
  },
  {
    name: '/relatorio_diario',
    audience: 'Staff',
    description: 'Gera relatorio comparando membros do Albion e voz no Discord.',
    options: ['atual obrigatorio', 'anterior opcional', 'voz opcional', 'data opcional']
  },
  {
    name: '/membros_relatorio',
    audience: 'Staff',
    description: 'Recebe a lista atual de membros do Albion, compara com o ultimo envio salvo e atualiza o HTML de membros.',
    options: ['arquivo obrigatorio', 'data opcional']
  },
  {
    name: '/verificar_membro',
    audience: 'Staff',
    description: 'Verifica se um membro do Discord esta na guild do Albion.',
    options: ['membro opcional']
  },
  {
    name: '/verificar_guild',
    audience: 'Staff',
    description: 'Verifica membros do Discord contra arquivo exportado do Albion.',
    options: ['arquivo obrigatorio']
  },
  {
    name: '/aplicar_verificacao_guild',
    audience: 'Staff',
    description: 'Aplica uma verificacao de guild ja analisada.',
    options: ['codigo obrigatorio', 'acao obrigatoria']
  },
  {
    name: '/renomear_canais',
    audience: 'Staff',
    description: 'Mostra ou aplica a padronizacao dos nomes dos canais do bot.',
    options: ['aplicar opcional', 'permissao: gerenciar servidor']
  },
  {
    name: '/auditar_canais',
    audience: 'Staff',
    description: 'Lista canais e categorias do servidor, marcando os conhecidos pelo bot.',
    options: ['permissao: gerenciar servidor']
  }
];

const commandList = document.querySelector('#commandList');
const commandSearch = document.querySelector('#commandSearch');
const toast = document.querySelector('#toast');
const resetChecklist = document.querySelector('#resetChecklist');

commandSearch.addEventListener('input', renderCommands);
resetChecklist.addEventListener('click', () => {
  document.querySelectorAll('.checklist input[type="checkbox"]').forEach((input) => {
    input.checked = false;
  });
  showToast('Checklist limpo.');
});

document.querySelectorAll('.copy-command').forEach((button) => {
  button.addEventListener('click', () => copyText(button.dataset.command));
});

renderCommands();

function renderCommands() {
  const query = normalize(commandSearch.value);
  const filtered = commands.filter((command) => {
    const text = `${command.name} ${command.audience} ${command.description} ${command.options.join(' ')}`;
    return !query || normalize(text).includes(query);
  });

  commandList.innerHTML = filtered.length
    ? filtered.map(commandCard).join('')
    : '<div class="empty">Nenhum comando encontrado para essa busca.</div>';

  commandList.querySelectorAll('.copy-command').forEach((button) => {
    button.addEventListener('click', () => copyText(button.dataset.command));
  });
}

function commandCard(command) {
  return `
    <article class="command-card">
      <header>
        <div>
          <div class="command-name">${escapeHtml(command.name)}</div>
          <span class="command-tag">${escapeHtml(command.audience)}</span>
        </div>
        <button class="copy-command" type="button" data-command="${escapeHtml(command.name)}">Copiar</button>
      </header>
      <p>${escapeHtml(command.description)}</p>
      <div class="command-options">
        ${command.options.map((option) => `<span>${escapeHtml(option)}</span>`).join('')}
      </div>
    </article>
  `;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`Copiado: ${text}`);
  } catch (error) {
    showToast('Nao foi possivel copiar automaticamente.');
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(showToast.timeoutId);
  showToast.timeoutId = setTimeout(() => toast.classList.remove('visible'), 2200);
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
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
