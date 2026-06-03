const repo = require('../events/events.repository');

async function handleVoiceStateUpdate(oldState, newState) {
  const userId = newState.id || oldState.id;
  const now = new Date().toISOString();

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
        await newState.member.voice.disconnect('Nao inscrito no evento').catch(() => {});
        await newState.member.send('Voce precisa participar do evento ou clicar em Espectador antes de entrar na sala.').catch(() => {});
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

module.exports = {
  handleVoiceStateUpdate,
  markRunningEventsForReview
};
