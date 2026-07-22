const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase, transaction } = require('../../database/connection');

const ANNOUNCEMENT_KEY = 'hideout-defense:sunstrand-shoal:2026-07-22';
const ACK_BUTTON_ID = 'ho_defense:ack:2026-07-22';
const PARTICIPATE_BUTTON_ID = 'ho_defense:participate:2026-07-22';

function listAcknowledgements() {
  return getDatabase().prepare(`
    SELECT user_id, acknowledged_at
    FROM announcement_acknowledgements
    WHERE announcement_key = ?
    ORDER BY acknowledged_at, user_id
  `).all(ANNOUNCEMENT_KEY);
}

function listParticipations() {
  return getDatabase().prepare(`
    SELECT user_id, participating_at
    FROM announcement_participations
    WHERE announcement_key = ?
    ORDER BY participating_at, user_id
  `).all(ANNOUNCEMENT_KEY);
}

const toggleAcknowledgement = transaction((userId) => {
  const db = getDatabase();
  const existing = db.prepare(`
    SELECT 1
    FROM announcement_acknowledgements
    WHERE announcement_key = ? AND user_id = ?
  `).get(ANNOUNCEMENT_KEY, userId);

  if (existing) {
    db.prepare(`
      DELETE FROM announcement_acknowledgements
      WHERE announcement_key = ? AND user_id = ?
    `).run(ANNOUNCEMENT_KEY, userId);
    return { added: false, acknowledgements: listAcknowledgements() };
  }

  db.prepare(`
    INSERT INTO announcement_acknowledgements (announcement_key, user_id)
    VALUES (?, ?)
  `).run(ANNOUNCEMENT_KEY, userId);
  return { added: true, acknowledgements: listAcknowledgements() };
});

const toggleParticipation = transaction((userId) => {
  const db = getDatabase();
  const existing = db.prepare(`
    SELECT 1
    FROM announcement_participations
    WHERE announcement_key = ? AND user_id = ?
  `).get(ANNOUNCEMENT_KEY, userId);

  if (existing) {
    db.prepare(`
      DELETE FROM announcement_participations
      WHERE announcement_key = ? AND user_id = ?
    `).run(ANNOUNCEMENT_KEY, userId);
    return { added: false, participations: listParticipations() };
  }

  db.prepare(`
    INSERT INTO announcement_participations (announcement_key, user_id)
    VALUES (?, ?)
  `).run(ANNOUNCEMENT_KEY, userId);
  return { added: true, participations: listParticipations() };
});

function memberListFields(rows, labels) {
  if (!rows.length) {
    return [{ name: `${labels.title} (0)`, value: labels.empty }];
  }

  const chunks = [];
  let current = '';
  for (const row of rows) {
    const mention = `<@${row.user_id}>`;
    const candidate = current ? `${current}\n${mention}` : mention;
    if (candidate.length > 1000) {
      chunks.push(current);
      current = mention;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  return chunks.map((value, index) => ({
    name: index === 0 ? `${labels.title} (${rows.length})` : `${labels.title} (continuação)`,
    value
  }));
}

function announcementPayload(options = {}) {
  const acknowledgements = options.acknowledgements || listAcknowledgements();
  const participations = options.participations || listParticipations();
  const embed = new EmbedBuilder()
    .setColor(0xd97706)
    .setTitle('🛡️ DEFESA DA HO — SUNSTRAND SHOAL')
    .setDescription([
      'Hoje, **21/07**, concluímos a primeira fase da instalação da nossa HO em **Sunstrand Shoal**. Agora precisamos da força de todos para protegê-la durante a segunda fase!',
      '',
      'A presença de cada membro é fundamental. Venha fazer parte desta nova etapa e deixar seu nome marcado na história da nossa guilda!'
    ].join('\n'))
    .addFields(
      {
        name: '📅 Cronograma — 22/07 (UTC)',
        value: [
          '**21:45:** início da preparação',
          '**22:00:** todos já devem estar no mapa',
          '**22:00–22:15:** defesa da HO (15 minutos)'
        ].join('\n')
      },
      {
        name: '📍 Encontro e destino',
        value: '**Encontro:** Bridgewatch Portal / Smuggler Vulcano\n**Destino:** Sunstrand Shoal'
      },
      {
        name: '⚔️ Equipamento e composição',
        value: '**Build:** T8 equivalente\n**Estilo de luta:** Brawl'
      },
      {
        name: '💠 Por que essa HO é importante?',
        value: [
          'Ela nos ajudará a pontuar na temporada com **Orbs (Anomalias de Poder)** e permitirá organizar melhor a divisão dos loots dos **World Bosses**, realizados nos finais de semana entre **00:00 e 02:00 UTC**.'
        ].join('\n')
      },
      ...memberListFields(acknowledgements, {
        title: 'Membros cientes',
        empty: '*Nenhum membro confirmou a leitura ainda.*'
      }),
      ...memberListFields(participations, {
        title: 'Vão participar',
        empty: '*Nenhum membro confirmou participação ainda.*'
      })
    )
    .setFooter({ text: 'Use “Eu li” para confirmar a leitura e “Eu vou participar” para confirmar presença. Clique novamente para remover.' });

  return {
    content: `<@&${ids.roles.member}>`,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(ACK_BUTTON_ID)
          .setLabel('Eu li')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(PARTICIPATE_BUTTON_ID)
          .setLabel('Eu vou participar')
          .setEmoji('⚔️')
          .setStyle(ButtonStyle.Success)
      )
    ],
    allowedMentions: options.pingMembers
      ? { parse: [], roles: [ids.roles.member] }
      : { parse: [] }
  };
}

async function postAnnouncementIfNeeded(client) {
  const db = getDatabase();
  const existing = db.prepare(`
    SELECT message_id, channel_id
    FROM operation_reminders
    WHERE reminder_key = ?
  `).get(ANNOUNCEMENT_KEY);

  if (existing?.message_id && existing?.channel_id) {
    const existingChannel = await client.channels.fetch(existing.channel_id).catch(() => null);
    const existingMessage = existingChannel?.isTextBased()
      ? await existingChannel.messages.fetch(existing.message_id).catch(() => null)
      : null;
    if (existingMessage) {
      await existingMessage.edit(announcementPayload());
      return { message: existingMessage, created: false };
    }
  }

  const channel = await client.channels.fetch(ids.channels.campaignAnnouncements).catch(() => null);
  if (!channel?.isTextBased()) {
    throw new Error(`Canal de avisos ${ids.channels.campaignAnnouncements} nao encontrado ou nao e um canal de texto.`);
  }

  const message = await channel.send(announcementPayload({ pingMembers: true }));
  db.prepare(`
    INSERT INTO operation_reminders (reminder_key, type, message_id, channel_id)
    VALUES (?, 'hideout_defense', ?, ?)
    ON CONFLICT(reminder_key) DO UPDATE SET
      message_id = excluded.message_id,
      channel_id = excluded.channel_id,
      sent_at = CURRENT_TIMESTAMP
  `).run(ANNOUNCEMENT_KEY, message.id, channel.id);
  return { message, created: true };
}

module.exports = {
  ANNOUNCEMENT_KEY,
  ACK_BUTTON_ID,
  BUTTON_ID: ACK_BUTTON_ID,
  PARTICIPATE_BUTTON_ID,
  announcementPayload,
  listAcknowledgements,
  listParticipations,
  postAnnouncementIfNeeded,
  toggleAcknowledgement,
  toggleParticipation
};
