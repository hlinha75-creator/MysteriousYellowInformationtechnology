const repo = require('../events/events.repository');
const events = require('../events/events.service');
const audit = require('../audit/audit.repository');
const voiceRepo = require('./voice.repository');
const ids = require('../../config/ids');

const WEEKLY_CHANNEL_ID = ids.channels.notagChat;
const CORE_ROLE_ID = ids.roles.core;

async function handleVoiceStateUpdate(oldState, newState) {
  if (oldState.channelId === newState.channelId) return;

  const userId = newState.id || oldState.id;
  const now = new Date().toISOString();
  const member = newState.member || oldState.member;

  if (oldState.channelId) {
    voiceRepo.closeOpenSession({ discordId: userId, leftAt: now });
  }

  if (newState.channelId) {
    voiceRepo.startSession({
      discordId: userId,
      discordName: member?.user?.tag || member?.displayName || userId,
      channelId: newState.channelId,
      channelName: newState.channel?.name || '',
      categoryId: newState.channel?.parentId || '',
      categoryName: newState.channel?.parent?.name || '',
      joinedAt: now
    });
  }

  if (oldState.channelId) {
    const oldEvent = repo.getEventByVoiceChannel(oldState.channelId);
    if (oldEvent) {
      const open = repo.getOpenVoiceSession({ eventId: oldEvent.id, discordId: userId });
      if (open) {
        const seconds = Math.max(0, Math.floor((Date.parse(now) - Date.parse(open.joined_at)) / 1000));
        repo.closeOpenVoiceSession({ eventId: oldEvent.id, discordId: userId, leftAt: now, seconds });
        repo.refreshParticipantSeconds(oldEvent.id);
      }
    }
  }

  if (newState.channelId) {
    const newEvent = repo.getEventByVoiceChannel(newState.channelId);
    if (newEvent) {
      const participant = repo.getParticipant({ eventId: newEvent.id, discordId: userId });
      if (!participant) {
        repo.upsertParticipant({
          eventId: newEvent.id,
          discordId: userId,
          role: 'spectator',
          isSpectator: 1
        });
        audit.createAuditLog({
          type: 'event_auto_spectator_voice_join',
          actorId: userId,
          targetId: String(newEvent.id),
          reason: 'Entrou direto na sala de voz do evento e virou espectador'
        });
        await events.refreshEventMessage(newState.client, newEvent.id).catch(() => {});
        await newState.member.send('Voce entrou direto na sala do evento e foi marcado como espectador. Seu tempo nao sera contado no loot split.').catch(() => {});
        return;
      }
      if (!participant.is_spectator) {
        const open = repo.getOpenVoiceSession({ eventId: newEvent.id, discordId: userId });
        if (!open) repo.startVoiceSession({ eventId: newEvent.id, discordId: userId, joinedAt: now });
      }
    }
  }
}

function markRunningEventsForReview() {
  const activeEvents = repo.listActiveEvents();
  for (const event of activeEvents) {
    repo.updateEvent(event.id, { review_required: 1 });
  }
  return activeEvents.length;
}

function closeOpenVoiceSessionsOnStartup() {
  return voiceRepo.closeAllOpenSessions(new Date().toISOString()).changes;
}

function saoPauloDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

function isoDateUtc(date) {
  return date.toISOString().slice(0, 10);
}

function previousCompletedWeek(now = new Date()) {
  const { year, month, day } = saoPauloDateParts(now);
  const today = new Date(Date.UTC(year, month - 1, day));
  const daysSinceMonday = (today.getUTCDay() + 6) % 7;
  const currentMonday = new Date(today);
  currentMonday.setUTCDate(today.getUTCDate() - daysSinceMonday);
  const start = new Date(currentMonday);
  start.setUTCDate(start.getUTCDate() - 7);
  const end = new Date(currentMonday);
  end.setUTCDate(end.getUTCDate() - 1);
  return { weekStart: isoDateUtc(start), weekEnd: isoDateUtc(end) };
}

function brDate(dateText) {
  const [year, month, day] = dateText.split('-');
  return `${day}/${month}/${year}`;
}

async function postWeeklyCoreAwardsIfNeeded(client, now = new Date()) {
  const { weekStart, weekEnd } = previousCompletedWeek(now);
  if (voiceRepo.getWeeklyAward(weekStart)) return { sent: false, reason: 'already_sent', weekStart, weekEnd };

  const qualified = voiceRepo.listWeeklyConsistentPlayers({ weekStart, weekEnd });
  const guild = await client.guilds.fetch(ids.guildId);
  const awarded = [];
  const unavailable = [];

  for (const player of qualified) {
    const member = await guild.members.fetch(player.discord_id).catch(() => null);
    if (!member) {
      unavailable.push(player);
      continue;
    }
    const roleAdded = await member.roles.add(CORE_ROLE_ID, `Constancia em voz: ${weekStart} a ${weekEnd}`)
      .then(() => true)
      .catch(() => false);
    if (roleAdded) awarded.push(player);
    else unavailable.push(player);
  }

  const channel = await client.channels.fetch(WEEKLY_CHANNEL_ID);
  if (!channel?.isTextBased()) throw new Error(`Canal semanal de constancia indisponivel: ${WEEKLY_CHANNEL_ID}`);

  let content;
  if (awarded.length === 0) {
    content = [
      '\u{1F3C6} **JOGADORES CONSTANTES**',
      '',
      `Na semana de **${brDate(weekStart)} a ${brDate(weekEnd)}**, nenhum jogador atingiu o criterio de voz.`,
      '',
      'Para entrar na lista: participe de call por pelo menos **30 minutos em 6 dias diferentes da semana**.'
    ].join('\n');
  } else {
    content = [
      '\u{1F3C6} **JOGADORES CONSTANTES**',
      '',
      `Parabens, ${awarded.map((player) => `<@${player.discord_id}>`).join(', ')}!`,
      '',
      `Na semana de **${brDate(weekStart)} a ${brDate(weekEnd)}**, voces participaram das calls por pelo menos **30 minutos em 6 ou mais dias**, demonstrando muita constancia no Discord.`,
      '',
      `Como reconhecimento, voces ganharam a tag <@&${CORE_ROLE_ID}>! \u{1F389}`,
      '',
      'Obrigado por fortalecerem nossa comunidade. Continuem assim! \u{1F4AA}'
    ].join('\n');
  }

  const message = await channel.send({ content, allowedMentions: { users: awarded.map((player) => player.discord_id), roles: [CORE_ROLE_ID] } });
  voiceRepo.createWeeklyAward({
    weekStart,
    weekEnd,
    channelId: WEEKLY_CHANNEL_ID,
    messageId: message.id,
    qualifiedCount: qualified.length,
    awardedCount: awarded.length,
    qualifiedJson: JSON.stringify(qualified)
  });
  return { sent: true, weekStart, weekEnd, qualified, awarded, unavailable, messageId: message.id };
}

module.exports = {
  closeOpenVoiceSessionsOnStartup,
  handleVoiceStateUpdate,
  markRunningEventsForReview,
  postWeeklyCoreAwardsIfNeeded,
  previousCompletedWeek
};
