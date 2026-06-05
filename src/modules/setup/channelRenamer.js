const names = {
  categories: {
    activeEvents: '⚔️ EVENTOS ATIVOS',
    closedEvents: '📁 EVENTOS FINALIZADOS'
  },
  channels: {
    createEvent: '➕criar-evento',
    participate: '⚔️eventos',
    deposit: '💰depositos',
    finance: '🧾financeiro-staff',
    consultBalance: '💵consultar-saldo',
    bankLogs: '📒logs-do-banco',
    guildBalances: '🏦saldos-da-guilda',
    adminPanel: '🛠️painel-adm',
    archive: '📦arquivos-csv',
    register: '📝registro',
    registrationRequests: '📥solicitacoes-registro',
    waitingVoice: '🔊 Aguardando Evento'
  }
};

function plannedRenames(ids) {
  return [
    ...Object.entries(names.categories).map(([key, name]) => ({
      kind: 'category',
      key,
      id: ids.categories[key],
      name
    })),
    ...Object.entries(names.channels).map(([key, name]) => ({
      kind: 'channel',
      key,
      id: ids.channels[key],
      name
    }))
  ];
}

async function renameConfiguredChannels(guild, ids, { apply = false } = {}) {
  await guild.channels.fetch();

  const results = [];
  for (const item of plannedRenames(ids)) {
    const channel = guild.channels.cache.get(item.id);
    if (!channel) {
      results.push({ ...item, status: 'missing' });
      continue;
    }

    if (channel.name === item.name) {
      results.push({ ...item, status: 'same', oldName: channel.name });
      continue;
    }

    results.push({ ...item, status: apply ? 'renamed' : 'preview', oldName: channel.name });
    if (apply) {
      await channel.setName(item.name, 'Padronizacao de nomes dos canais da guild Notag');
    }
  }

  return results;
}

function formatRenameResults(results, { apply = false } = {}) {
  const header = apply ? 'Renomes aplicados:' : 'Previa dos renomes:';
  const lines = results.map((item) => {
    if (item.status === 'missing') return `- ${item.kind}.${item.key}: nao encontrado (${item.id})`;
    if (item.status === 'same') return `- ${item.kind}.${item.key}: ja esta como "${item.name}"`;
    return `- ${item.kind}.${item.key}: "${item.oldName}" -> "${item.name}"`;
  });

  const footer = apply ? null : 'Para aplicar, use /renomear_canais aplicar:sim';
  return [header, ...lines, footer].filter(Boolean).join('\n').slice(0, 1900);
}

module.exports = {
  formatRenameResults,
  names,
  plannedRenames,
  renameConfiguredChannels
};
