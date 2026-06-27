const repo = require('../events/events.repository');
const events = require('../events/events.service');
const audit = require('../audit/audit.repository');
const voiceRepo = require('./voice.repository');

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

module.exports = {
  closeOpenVoiceSessionsOnStartup,
  handleVoiceStateUpdate,
  markRunningEventsForReview
};
