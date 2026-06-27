const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase } = require('../../database/connection');
const inactiveEvents = require('../members/inactiveEvents.service');
const inactiveGuests = require('../members/inactiveGuests.service');

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
    components: pendingQueueComponents()
  };
}

function pendingQueueComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('admin:refresh_pending_queue').setLabel('Atualizar fila').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('admin:refresh_career_panel').setLabel('Atualizar carreira').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('admin:preview_career_rebuild').setLabel('Previa recalc carreira').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('admin:verify_pending_registrations').setLabel('Sincronizar Albion').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('inactive_events:preview').setLabel('Inativos eventos').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('albion_weekly:help:rank').setLabel('Importar Rank PvE').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('albion_weekly:help:logs').setLabel('Importar Logs Albion').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('albion_weekly:summary:current').setLabel('Resumo Albion').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('albion_weekly:export:pve').setLabel('Exportar PvE').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('albion_weekly:export:logs').setLabel('Exportar Logs').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('inactive_guests:preview').setLabel('Inativos convidados').setStyle(ButtonStyle.Secondary)
    )
  ];
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
    await interaction.message.edit(pendingQueuePayload());
  }
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

function count(db, sql) {
  return Number(db.prepare(sql).get()?.total || 0);
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

function weekKey() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const diffDays = Math.floor((now - start) / 86400000);
  const week = Math.floor(diffDays / 7) + 1;
  return `${now.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
}

module.exports = {
  pendingQueuePayload,
  postMonthlyInactivityPreviewIfNeeded,
  postWeeklyAlbionReminderIfNeeded,
  refreshPendingQueueMessage,
  weeklyChecklistText
};
