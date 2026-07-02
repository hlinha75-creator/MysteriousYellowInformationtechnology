const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase } = require('../../database/connection');
const { testLatestBackupRestore } = require('../../database/backup');
const { formatSilver } = require('../../utils/silver');
const inactiveEvents = require('../members/inactiveEvents.service');
const inactiveGuests = require('../members/inactiveGuests.service');

const dailyAdminRecipients = ['1436716667894759475', '1276439186513203234'];

function pendingQueuePayload() {
  const summary = pendingSummary();
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Fila de pendencias')
        .setDescription('Resumo rapido para ADM/staff saber onde precisa agir.')
        .addFields(
          { name: 'Eventos', value: [
            `Abertos: ${summary.events.created}`,
            `Em andamento: ${summary.events.running}`,
            `Em revisao: ${summary.events.review}`,
            `Financeiro: ${summary.events.pendingPayment}`
          ].join('\n'), inline: true },
          { name: 'Financeiro', value: [
            `Saques solicitados: ${summary.withdraws.requested}`,
            `Saques aprovados: ${summary.withdraws.approved}`,
            `Pedidos de pagamento: ${summary.paymentRequests.requested}`,
            `Backups com erro: ${summary.backups.failed}`,
            `Ultimo backup: ${summary.backups.lastSent || 'nenhum'}`
          ].join('\n'), inline: true },
          { name: 'Membros', value: [
            `Registros pendentes: ${summary.registrations.pending}`,
            `DMs de guild pendentes: ${summary.guildReplies.pending}`,
            `Enquetes abertas: ${summary.polls.open}`
          ].join('\n'), inline: true },
          { name: 'Rotina Albion semanal', value: weeklyChecklistText(), inline: false }
        )
        .setColor(0xf6ad55)
        .setTimestamp(new Date())
    ],
    components: adminMainComponents()
  };
}

function adminPanelPayload() {
  const queue = pendingQueuePayload();
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Painel ADM')
        .setDescription('Use os botoes principais. Os detalhes abrem em menus privados para nao poluir o canal.')
        .setColor(0xdd6b20),
      ...queue.embeds
    ],
    components: adminMainComponents()
  };
}

function adminMainComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('admin:remove_balance').setLabel('Retirar saldo').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('admin_menu:finance').setLabel('Financeiro').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('admin_menu:albion').setLabel('Albion').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('admin_menu:events').setLabel('Eventos').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('admin_menu:members').setLabel('Membros').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('admin_menu:files').setLabel('Arquivos').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('admin_menu:tutorial').setLabel('Tutorial').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('admin:daily_report').setLabel('Relatorio ADM').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('admin:test_backup').setLabel('Teste backup').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('admin:refresh_pending_queue').setLabel('Atualizar fila').setStyle(ButtonStyle.Primary)
    )
  ];
}

function adminMenuPayload(menu) {
  const menus = {
    finance: {
      title: 'Financeiro',
      description: 'Saldo, logs financeiros e importacao manual de saldos.',
      rows: [[
        button('admin:remove_balance', 'Retirar saldo', ButtonStyle.Danger),
        button('csv:export_balances', 'Exportar saldos'),
        button('csv:export_transactions', 'Logs financeiros'),
        button('csv:import_help', 'Importar CSV', ButtonStyle.Primary)
      ]]
    },
    albion: {
      title: 'Albion',
      description: 'Sincronizacao da guild, rank PvE semanal e logs manuais do Albion.',
      rows: [[
        button('admin:verify_pending_registrations', 'Sincronizar Albion', ButtonStyle.Primary),
        button('albion_weekly:help:rank', 'Importar Rank PvE'),
        button('albion_weekly:help:logs', 'Importar Logs'),
        button('albion_weekly:summary:current', 'Resumo Albion'),
        button('albion_weekly:export:pve', 'Exportar PvE')
      ], [
        button('albion_weekly:export:logs', 'Exportar Logs')
      ]]
    },
    events: {
      title: 'Eventos',
      description: 'Carreira por arma, recalculo e inatividade por eventos/calls.',
      rows: [[
        button('admin:refresh_career_panel', 'Atualizar carreira', ButtonStyle.Primary),
        button('admin:preview_career_rebuild', 'Previa recalc carreira'),
        button('inactive_events:preview', 'Inativos eventos'),
        button('admin:presence_report', 'Relatorio presenca')
      ]]
    },
    members: {
      title: 'Membros',
      description: 'Vinculos Discord x Albion, convidados inativos e lista comparativa.',
      rows: [[
        button('admin:verify_pending_registrations', 'Sincronizar Albion', ButtonStyle.Primary),
        button('inactive_guests:preview', 'Inativos convidados'),
        button('guild:export_members_html', 'Discord x Albion'),
        button('admin:member_profile', 'Perfil membro', ButtonStyle.Primary)
      ]]
    },
    files: {
      title: 'Arquivos',
      description: 'Exportacoes e importacoes manuais para conferencia e backup.',
      rows: [[
        button('csv:export_balances', 'Exportar saldos'),
        button('csv:export_transactions', 'Logs financeiros'),
        button('csv:export_audit', 'Auditoria'),
        button('guild:export_members_html', 'Discord x Albion')
      ], [
        button('admin:pending_html', 'Fila HTML', ButtonStyle.Primary),
        button('admin:test_backup', 'Teste backup'),
        button('csv:import_help', 'Importar CSV', ButtonStyle.Primary)
      ]]
    },
    tutorial: {
      title: 'Tutorial Staff',
      description: 'Baixe um HTML com o guia completo para ADM/staff/caller/recrutador/tesouraria.',
      rows: [[
        button('tutorial:staff_html', 'Baixar tutorial HTML', ButtonStyle.Primary)
      ]]
    }
  };

  const data = menus[menu] || menus.files;
  return {
    embeds: [new EmbedBuilder().setTitle(data.title).setDescription(data.description).setColor(0x4f46e5)],
    components: data.rows.map((row) => new ActionRowBuilder().addComponents(...row))
  };
}

function button(customId, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}
function pendingSummary() {
  const db = getDatabase();
  return {
    events: {
      created: count(db, "SELECT COUNT(*) AS total FROM events WHERE status = 'created'"),
      running: count(db, "SELECT COUNT(*) AS total FROM events WHERE status = 'running'"),
      review: count(db, "SELECT COUNT(*) AS total FROM events WHERE status = 'review'"),
      pendingPayment: count(db, "SELECT COUNT(*) AS total FROM events WHERE status = 'pending_payment'")
    },
    withdraws: {
      requested: count(db, "SELECT COUNT(*) AS total FROM withdraw_requests WHERE status = 'requested'"),
      approved: count(db, "SELECT COUNT(*) AS total FROM withdraw_requests WHERE status = 'approved'")
    },
    paymentRequests: {
      requested: count(db, "SELECT COUNT(*) AS total FROM payment_requests WHERE status = 'requested'")
    },
    registrations: {
      pending: count(db, "SELECT COUNT(*) AS total FROM registrations WHERE status = 'pending'")
    },
    guildReplies: {
      pending: count(db, "SELECT COUNT(*) AS total FROM guild_verification_pending_replies WHERE status = 'pending'")
    },
    polls: {
      open: count(db, "SELECT COUNT(*) AS total FROM polls WHERE status = 'open'")
    },
    backups: {
      failed: count(db, "SELECT COUNT(*) AS total FROM balance_csv_backups WHERE status = 'failed'"),
      lastSent: lastBackupLabel(db)
    }
  };
}

async function refreshPendingQueueMessage(interaction) {
  if (interaction.message) {
    await interaction.message.edit(adminPanelPayload());
  }
}

function adminDailyReportPayload() {
  const summary = pendingSummary();
  const today = saoPauloDateKey();
  const finance = financeLast24h();
  const events = eventsLast24h();
  const campaign = campaignSummary();
  const backup = testLatestBackupRestore();

  const embed = new EmbedBuilder()
    .setTitle(`Relatorio ADM - ${today}`)
    .setDescription('Resumo diario automatico do NOTAG Bot.')
    .addFields(
      {
        name: 'Pendencias agora',
        value: [
          `Eventos em revisao: ${summary.events.review}`,
          `Eventos no financeiro: ${summary.events.pendingPayment}`,
          `Saques solicitados/aprovados: ${summary.withdraws.requested}/${summary.withdraws.approved}`,
          `Pedidos de pagamento: ${summary.paymentRequests.requested}`,
          `Registros pendentes: ${summary.registrations.pending}`
        ].join('\n'),
        inline: true
      },
      {
        name: 'Ultimas 24h',
        value: [
          `Eventos aprovados: ${events.approved}`,
          `Eventos criados: ${events.created}`,
          `Entrou saldo: ${formatSilver(finance.inflow)}`,
          `Saiu saldo: ${formatSilver(Math.abs(finance.outflow))}`,
          `Transacoes: ${finance.transactions}`
        ].join('\n'),
        inline: true
      },
      {
        name: 'Meta 900m',
        value: campaign
          ? [
            `${formatSilver(campaign.raised)} / ${formatSilver(campaign.goal)} (${campaign.percent.toFixed(1)}%)`,
            `Contribuidores: ${campaign.contributors}`,
            `Pendentes DM: ${campaign.pending}`
          ].join('\n')
          : 'Nenhuma meta aberta.',
        inline: true
      },
      {
        name: 'Backup',
        value: [
          backup.ok ? 'Teste: OK' : 'Teste: ATENCAO',
          backup.latest ? `Arquivo: ${backup.latest.name}` : 'Arquivo: nenhum',
          backup.latest ? `Tamanho: ${bytesText(backup.latest.size)}` : null
        ].filter(Boolean).join('\n'),
        inline: false
      },
      { name: 'Rotina semanal Albion', value: weeklyChecklistText(), inline: false }
    )
    .setColor(backup.ok ? 0x38a169 : 0xd69e2e)
    .setTimestamp(new Date());

  return {
    content: 'Relatorio diario do NOTAG Bot.',
    embeds: [embed],
    allowedMentions: { parse: [] }
  };
}

async function postDailyAdminReportIfNeeded(client) {
  const hour = saoPauloHour();
  if (hour < 9) return null;

  const key = `admin-daily:${saoPauloDateKey()}`;
  const db = getDatabase();
  const existing = db.prepare('SELECT reminder_key FROM operation_reminders WHERE reminder_key = ?').get(key);
  if (existing) return null;

  const payload = adminDailyReportPayload();
  let sent = 0;
  for (const userId of dailyAdminRecipients) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) continue;
    await user.send(payload).then(() => { sent += 1; }).catch(() => {});
  }

  db.prepare(`
    INSERT INTO operation_reminders (reminder_key, type, message_id, channel_id)
    VALUES (?, ?, ?, ?)
  `).run(key, 'admin_daily_report', String(sent), 'dm');
  return { sent };
}

function backupTestPayload() {
  const result = testLatestBackupRestore();
  const checks = result.checks.map((check) => `${check.ok ? 'OK' : 'ERRO'} ${check.name}: ${check.value}`).join('\n') || 'Nenhum teste executado.';
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(result.ok ? 'Teste de backup OK' : 'Teste de backup com atencao')
        .setDescription(result.message)
        .addFields(
          { name: 'Ultimo backup', value: result.latest ? `${result.latest.name}\n${bytesText(result.latest.size)}\n${result.latest.modifiedAt.toISOString()}` : 'Nenhum backup encontrado.', inline: false },
          { name: 'Checks', value: truncate(checks, 1024), inline: false }
        )
        .setColor(result.ok ? 0x38a169 : 0xe53e3e)
        .setTimestamp(new Date())
    ]
  };
}

function pendingQueueHtmlPayload() {
  const html = renderPendingQueueHtml();
  return {
    content: 'Fila completa de pendencias em HTML.',
    files: [
      new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `fila-pendencias-${saoPauloDateKey()}.html` })
    ],
    allowedMentions: { parse: [] }
  };
}

function presenceReportPayload(days = 30) {
  const rows = presenceRows(days);
  const html = renderPresenceHtml(rows, days);
  const active = rows.filter((row) => row.event_seconds > 0 || row.voice_seconds > 0).length;
  return {
    content: `Relatorio de presenca dos ultimos ${days} dias. Membros com atividade: ${active}/${rows.length}.`,
    files: [
      new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `presenca-${days}d-${saoPauloDateKey()}.html` })
    ],
    allowedMentions: { parse: [] }
  };
}

function memberProfilePayload(userId) {
  const db = getDatabase();
  const user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(userId);
  const balance = db.prepare('SELECT COALESCE(balance, 0) AS balance FROM balances WHERE discord_id = ?').get(userId);
  const finance = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS earned,
      COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) AS spent,
      COUNT(*) AS transactions
    FROM balance_transactions
    WHERE user_id = ?
  `).get(userId);
  const events = db.prepare(`
    SELECT
      COUNT(DISTINCT ep.event_id) AS events,
      COALESCE(SUM(COALESCE(ep.manual_seconds, ep.calculated_seconds, 0)), 0) AS event_seconds,
      COALESCE(SUM(ep.payout_amount), 0) AS payout,
      MAX(e.started_at) AS last_event_at
    FROM event_participants ep
    LEFT JOIN events e ON e.id = ep.event_id
    WHERE ep.discord_id = ?
      AND COALESCE(ep.is_spectator, 0) = 0
  `).get(userId);
  const voice = db.prepare(`
    SELECT COUNT(*) AS sessions, COALESCE(SUM(seconds), 0) AS seconds, MAX(COALESCE(left_at, joined_at)) AS last_voice_at
    FROM voice_sessions
    WHERE discord_id = ?
  `).get(userId);
  const career = db.prepare(`
    SELECT weapon_name, points
    FROM raid_avalon_weapon_career
    WHERE discord_id = ?
    ORDER BY points DESC, weapon_name COLLATE NOCASE
    LIMIT 8
  `).all(userId);

  const embed = new EmbedBuilder()
    .setTitle('Perfil do membro')
    .setDescription(`<@${userId}>`)
    .addFields(
      { name: 'Cadastro', value: [
        `Discord ID: ${userId}`,
        `Discord: ${user?.discord_name || '-'}`,
        `Albion: ${user?.albion_name || '-'}`,
        `Status: ${user?.registration_status || 'sem registro'}`
      ].join('\n'), inline: false },
      { name: 'Financeiro', value: [
        `Saldo atual: ${formatSilver(balance?.balance || 0)}`,
        `Recebido total: ${formatSilver(finance?.earned || 0)}`,
        `Saidas total: ${formatSilver(Math.abs(finance?.spent || 0))}`,
        `Transacoes: ${finance?.transactions || 0}`
      ].join('\n'), inline: true },
      { name: 'Eventos e voz', value: [
        `Eventos: ${events?.events || 0}`,
        `Tempo eventos: ${durationText(events?.event_seconds || 0)}`,
        `Tempo voz geral: ${durationText(voice?.seconds || 0)}`,
        `Ultima call: ${shortDate(voice?.last_voice_at)}`
      ].join('\n'), inline: true },
      { name: 'Carreira PvE', value: career.length ? career.map((row) => `${row.weapon_name}: ${row.points}`).join('\n') : 'Sem pontos registrados.', inline: false }
    )
    .setColor(0x4f46e5)
    .setTimestamp(new Date());

  return { embeds: [embed], allowedMentions: { users: [userId] } };
}

async function postWeeklyAlbionReminderIfNeeded(client) {
  const now = saoPauloNowParts();
  const weekday = Number(now.weekday);
  const hour = Number(now.hour);
  if (![0, 1].includes(weekday) || hour < 10) return null;

  const key = `albion-weekly:${weekKey()}`;
  const db = getDatabase();
  const existing = db.prepare('SELECT reminder_key FROM operation_reminders WHERE reminder_key = ?').get(key);
  if (existing) return null;

  const channel = await client.channels.fetch(ids.channels.adminPanel).catch(() => null);
  if (!channel?.isTextBased()) return null;

  const message = await channel.send({
    content: `<@&${ids.roles.adm}> <@&${ids.roles.staff}> lembrete semanal da rotina Albion.`,
    embeds: [
      new EmbedBuilder()
        .setTitle('Rotina semanal Albion')
        .setDescription(weeklyChecklistText())
        .setColor(0x38a169)
        .setTimestamp(new Date())
    ],
    allowedMentions: { roles: [ids.roles.adm, ids.roles.staff] }
  });

  db.prepare(`
    INSERT INTO operation_reminders (reminder_key, type, message_id, channel_id)
    VALUES (?, ?, ?, ?)
  `).run(key, 'albion_weekly', message.id, channel.id);
  return message;
}


async function postMonthlyInactivityPreviewIfNeeded(client) {
  const now = saoPauloNowParts();
  const hour = Number(now.hour);
  if (hour < 10) return null;

  const db = getDatabase();
  const last = db.prepare(`
    SELECT sent_at
    FROM operation_reminders
    WHERE type = 'inactivity_monthly'
    ORDER BY sent_at DESC
    LIMIT 1
  `).get();
  if (last?.sent_at && Date.now() - Date.parse(last.sent_at) < 30 * 24 * 60 * 60 * 1000) return null;

  const guild = await client.guilds.fetch(ids.guildId).catch(() => null);
  const channel = await client.channels.fetch(ids.channels.adminPanel).catch(() => null);
  if (!guild || !channel?.isTextBased()) return null;

  const expiresInMs = 7 * 24 * 60 * 60 * 1000;
  const actorId = client.user?.id || 'system';
  const eventsPreview = await inactiveEvents.createPreview({
    guild,
    actorId,
    daysMin: 30,
    minutesMin: inactiveEvents.defaultMinutesMin,
    expiresInMs,
    shared: true
  });
  const guestsPreview = await inactiveGuests.createPreview({
    guild,
    actorId,
    daysMin: 30,
    expiresInMs,
    shared: true
  });

  const summary = await channel.send({
    content: `<@&${ids.roles.adm}> <@&${ids.roles.staff}> previa mensal de inatividade pronta para revisao.`,
    embeds: [
      new EmbedBuilder()
        .setTitle('Previa mensal de inatividade')
        .setDescription([
          'O bot gerou a previa mensal, mas nenhum cargo foi alterado ainda.',
          'Revise os CSVs abaixo e confirme somente se estiver tudo certo.',
          '',
          `Membro -> Convidado: ${eventsPreview.candidates.length} candidato(s).`,
          `Convidado -> Sem Tag: ${guestsPreview.candidates.length} candidato(s).`,
          '',
          'As previas expiram em 7 dias.'
        ].join('\n'))
        .setColor(0xd69e2e)
        .setTimestamp(new Date())
    ],
    allowedMentions: { roles: [ids.roles.adm, ids.roles.staff] }
  });

  await channel.send({
    content: 'Previa 1/2 - Membro -> Convidado',
    ...inactiveEvents.previewPayload(eventsPreview),
    allowedMentions: { parse: [] }
  });
  await channel.send({
    content: 'Previa 2/2 - Convidado -> Sem Tag',
    ...inactiveGuests.previewPayload(guestsPreview),
    allowedMentions: { parse: [] }
  });

  const key = `inactivity-monthly:${new Date().toISOString().slice(0, 10)}`;
  db.prepare(`
    INSERT INTO operation_reminders (reminder_key, type, message_id, channel_id)
    VALUES (?, ?, ?, ?)
  `).run(key, 'inactivity_monthly', summary.id, channel.id);

  return summary;
}

function weeklyChecklistText() {
  return [
    '1. Enviar CSV/TSV atual da guild Albion para verificar registros pendentes.',
    '2. Enviar lista/rank PvE e logs gerais do Albion quando tiver arquivo novo.',
    '3. Guardar prints de pontos de temporada quando virar ciclo de 60 dias.',
    '4. Revisar links pendentes de builds PvE.',
    '5. Conferir backup de saldos no canal de arquivos.',
    '6. Olhar eventos financeiros pendentes, saques e logs do Discloud.'
  ].join('\n');
}

function financeLast24h() {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT
      COUNT(*) AS transactions,
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS inflow,
      COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) AS outflow
    FROM balance_transactions
    WHERE created_at >= datetime('now', '-1 day')
  `).get();
  return {
    transactions: Number(row?.transactions || 0),
    inflow: Number(row?.inflow || 0),
    outflow: Number(row?.outflow || 0)
  };
}

function eventsLast24h() {
  const db = getDatabase();
  return {
    created: count(db, "SELECT COUNT(*) AS total FROM events WHERE created_at >= datetime('now', '-1 day')"),
    approved: count(db, "SELECT COUNT(*) AS total FROM events WHERE status = 'approved' AND updated_at >= datetime('now', '-1 day')")
  };
}

function campaignSummary() {
  const db = getDatabase();
  const campaign = db.prepare("SELECT * FROM campaigns WHERE status = 'open' ORDER BY id ASC LIMIT 1").get();
  if (!campaign) return null;
  const raised = Number(db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM campaign_contributions
    WHERE campaign_id = ?
      AND status = 'approved'
  `).get(campaign.id)?.total || 0);
  const contributors = count(db, `SELECT COUNT(DISTINCT user_id) AS total FROM campaign_contributions WHERE campaign_id = ${Number(campaign.id)} AND status = 'approved'`);
  const pending = count(db, `SELECT COUNT(*) AS total FROM campaign_event_payouts WHERE campaign_id = ${Number(campaign.id)} AND status = 'pending'`);
  const goal = Number(campaign.goal_amount || 0);
  return {
    campaign,
    raised,
    goal,
    contributors,
    pending,
    percent: goal > 0 ? Math.min(100, (raised / goal) * 100) : 0
  };
}

function renderPendingQueueHtml() {
  const db = getDatabase();
  const sections = [
    {
      title: 'Eventos aguardando acao',
      rows: db.prepare(`
        SELECT id, event_code, title, status, creator_id, created_at, updated_at
        FROM events
        WHERE status IN ('created', 'running', 'review', 'pending_payment')
        ORDER BY updated_at DESC, id DESC
      `).all(),
      columns: ['id', 'event_code', 'title', 'status', 'creator_id', 'created_at', 'updated_at']
    },
    {
      title: 'Saques pendentes',
      rows: db.prepare(`
        SELECT id, user_id, amount, status, note, created_at, reviewed_at
        FROM withdraw_requests
        WHERE status IN ('requested', 'approved')
        ORDER BY created_at ASC
      `).all().map((row) => ({ ...row, amount: formatSilver(row.amount) })),
      columns: ['id', 'user_id', 'amount', 'status', 'note', 'created_at', 'reviewed_at']
    },
    {
      title: 'Pedidos de pagamento',
      rows: db.prepare(`
        SELECT id, user_id, amount, service, status, created_at
        FROM payment_requests
        WHERE status = 'requested'
        ORDER BY created_at ASC
      `).all().map((row) => ({ ...row, amount: formatSilver(row.amount) })),
      columns: ['id', 'user_id', 'amount', 'service', 'status', 'created_at']
    },
    {
      title: 'Registros pendentes',
      rows: db.prepare(`
        SELECT id, discord_id, albion_name, status, created_at
        FROM registrations
        WHERE status = 'pending'
        ORDER BY created_at ASC
      `).all(),
      columns: ['id', 'discord_id', 'albion_name', 'status', 'created_at']
    },
    {
      title: 'Escolhas pendentes da meta',
      rows: db.prepare(`
        SELECT id, campaign_id, event_id, user_id, amount, status, expires_at, created_at
        FROM campaign_event_payouts
        WHERE status = 'pending'
        ORDER BY expires_at ASC
      `).all().map((row) => ({ ...row, amount: formatSilver(row.amount) })),
      columns: ['id', 'campaign_id', 'event_id', 'user_id', 'amount', 'status', 'expires_at', 'created_at']
    }
  ];

  return baseHtml('Fila de pendencias NOTAG', `
    <h1>Fila de pendencias NOTAG</h1>
    <p class="muted">Gerado em ${escapeHtml(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}</p>
    ${sections.map((section) => `
      <section>
        <h2>${escapeHtml(section.title)} <span>${section.rows.length}</span></h2>
        ${htmlTable(section.rows, section.columns)}
      </section>
    `).join('')}
  `);
}

function presenceRows(days) {
  const db = getDatabase();
  return db.prepare(`
    WITH event_stats AS (
      SELECT
        ep.discord_id,
        COUNT(DISTINCT ep.event_id) AS events,
        COALESCE(SUM(COALESCE(ep.manual_seconds, ep.calculated_seconds, 0)), 0) AS event_seconds,
        COALESCE(SUM(ep.payout_amount), 0) AS payout,
        MAX(e.started_at) AS last_event_at
      FROM event_participants ep
      JOIN events e ON e.id = ep.event_id
      WHERE COALESCE(ep.is_spectator, 0) = 0
        AND COALESCE(e.started_at, e.created_at) >= datetime('now', @window)
      GROUP BY ep.discord_id
    ),
    voice_stats AS (
      SELECT
        discord_id,
        COUNT(*) AS sessions,
        COALESCE(SUM(seconds), 0) AS voice_seconds,
        MAX(COALESCE(left_at, joined_at)) AS last_voice_at
      FROM voice_sessions
      WHERE joined_at >= datetime('now', @window)
      GROUP BY discord_id
    )
    SELECT
      u.discord_id,
      u.discord_name,
      u.albion_name,
      u.registration_status,
      COALESCE(es.events, 0) AS events,
      COALESCE(es.event_seconds, 0) AS event_seconds,
      COALESCE(es.payout, 0) AS payout,
      es.last_event_at,
      COALESCE(vs.sessions, 0) AS voice_sessions,
      COALESCE(vs.voice_seconds, 0) AS voice_seconds,
      vs.last_voice_at
    FROM users u
    LEFT JOIN event_stats es ON es.discord_id = u.discord_id
    LEFT JOIN voice_stats vs ON vs.discord_id = u.discord_id
    ORDER BY event_seconds DESC, voice_seconds DESC, COALESCE(u.albion_name, u.discord_name, u.discord_id) COLLATE NOCASE
  `).all({ window: `-${Number(days || 30)} days` });
}

function renderPresenceHtml(rows, days) {
  const printableRows = rows.map((row) => ({
    discord_id: row.discord_id,
    discord_name: row.discord_name || '',
    albion_name: row.albion_name || '',
    status: row.registration_status || '',
    events: row.events,
    event_time: durationText(row.event_seconds),
    voice_sessions: row.voice_sessions,
    voice_time: durationText(row.voice_seconds),
    payout: formatSilver(row.payout),
    last_event_at: shortDate(row.last_event_at),
    last_voice_at: shortDate(row.last_voice_at)
  }));
  return baseHtml(`Presenca ${days} dias`, `
    <h1>Relatorio de presenca</h1>
    <p class="muted">Janela: ultimos ${Number(days || 30)} dias. Gerado em ${escapeHtml(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}</p>
    ${htmlTable(printableRows, ['discord_id', 'discord_name', 'albion_name', 'status', 'events', 'event_time', 'voice_sessions', 'voice_time', 'payout', 'last_event_at', 'last_voice_at'])}
  `);
}

function baseHtml(title, body) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; background: #111827; color: #e5e7eb; font-family: Arial, sans-serif; }
    main { max-width: 1180px; margin: 0 auto; padding: 24px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    h2 { margin: 28px 0 10px; font-size: 18px; }
    h2 span { color: #f59e0b; font-size: 14px; }
    .muted { color: #9ca3af; }
    .table-actions { display: flex; justify-content: flex-end; margin: 0 0 8px; }
    button { border: 0; border-radius: 7px; padding: 8px 10px; background: #2563eb; color: #fff; font-weight: 800; cursor: pointer; }
    table { width: 100%; border-collapse: collapse; background: #1f2937; border: 1px solid #374151; border-radius: 8px; overflow: hidden; margin-bottom: 16px; }
    th, td { padding: 8px 10px; border-bottom: 1px solid #374151; text-align: left; vertical-align: top; }
    th { background: #030712; position: sticky; top: 0; }
    tr:hover td { background: rgba(255,255,255,.04); }
    code { color: #bfdbfe; }
    @media (max-width: 760px) { main { padding: 12px; } table { font-size: 12px; } th, td { padding: 6px; } }
  </style>
</head>
<body><main>${body}</main>
<script>
function csvCell(value) {
  const text = String(value == null ? '' : value);
  return /[",\\n\\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
function downloadSiblingTableCsv(button, name) {
  const table = button.closest('.table-actions')?.nextElementSibling;
  if (!table) return;
  const rows = Array.from(table.querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((cell) => csvCell(cell.innerText.trim())).join(',')).join('\\n');
  const blob = new Blob([rows], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = (name || document.title || 'relatorio').toLowerCase().replace(/[^a-z0-9_-]+/g, '-') + '.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
</script>
</body>
</html>`;
}

function htmlTable(rows, columns) {
  if (!rows.length) return '<p class="muted">Nada pendente.</p>';
  return `<div class="table-actions"><button onclick="downloadSiblingTableCsv(this, 'tabela')">Baixar CSV</button></div><table data-report-table><thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => (
    `<tr>${columns.map((column) => `<td>${escapeHtml(row[column] ?? '')}</td>`).join('')}</tr>`
  )).join('')}</tbody></table>`;
}

function count(db, sql) {
  return Number(db.prepare(sql).get()?.total || 0);
}

function bytesText(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function durationText(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m`;
}

function shortDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function truncate(value, max) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 20)}\n... texto cortado` : text;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function lastBackupLabel(db) {
  const row = db.prepare(`
    SELECT sent_at
    FROM balance_csv_backups
    WHERE status = 'sent'
    ORDER BY sent_at DESC
    LIMIT 1
  `).get();
  if (!row?.sent_at) return null;
  return row.sent_at.slice(0, 16).replace('T', ' ');
}

function saoPauloNowParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  const weekdayText = parts.find((part) => part.type === 'weekday')?.value || 'Sun';
  const hour = parts.find((part) => part.type === 'hour')?.value || '00';
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: weekdays[weekdayText] ?? 0, hour };
}

function saoPauloHour() {
  return Number(saoPauloNowParts().hour || 0);
}

function saoPauloDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function weekKey() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const diffDays = Math.floor((now - start) / 86400000);
  const week = Math.floor(diffDays / 7) + 1;
  return `${now.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
}

module.exports = {
  adminDailyReportPayload,
  adminMenuPayload,
  adminPanelPayload,
  backupTestPayload,
  memberProfilePayload,
  pendingQueuePayload,
  pendingQueueHtmlPayload,
  postDailyAdminReportIfNeeded,
  postMonthlyInactivityPreviewIfNeeded,
  postWeeklyAlbionReminderIfNeeded,
  presenceReportPayload,
  refreshPendingQueueMessage,
  weeklyChecklistText
};
