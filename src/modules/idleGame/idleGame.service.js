const { joinVoiceChannel, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const env = require('../../config/env');
const eventRepo = require('../events/events.repository');
const repo = require('./idleGame.repository');

const TICK_SECONDS = 10;
const BASE_POINTS_PER_TICK = 1;
let client;
let connection;
let activeChannel;
let tickTimer;
let refreshTimer;

function nowIso() { return new Date().toISOString(); }
function displayName(member) { return member?.displayName || member?.user?.globalName || member?.user?.username || member?.id; }
function eligibleMembers(channel) { return [...channel.members.values()].filter((m) => !m.user.bot && m.id !== env.idleHostUserId); }
function runningEventBonus(channelId, userId) {
  const event = eventRepo.getEventByVoiceChannel(channelId);
  const participant = event && eventRepo.getParticipant({ eventId: event.id, discordId: userId });
  return Boolean(participant && !participant.is_spectator);
}

async function postSessionMessage(session, channel) {
  if (!channel?.isTextBased()) return;
  const message = await channel.send({ content: [
    '🧘 **Estacao de Foco iniciada**',
    '',
    'Fique com o microfone mutado para produzir. Ao falar, sua producao entra em resfriamento por pelo menos 1 minuto.',
    `Dashboard local: **http://localhost:${env.dashboardPort}**`,
    `Historico permanente: <#${env.idleTopicId}>`
  ].join('\n') }).catch(() => null);
  if (message) repo.setMessageId(session.id, message.id);
}

async function updateTopic(content) {
  const topic = await client.channels.fetch(env.idleTopicId).catch(() => null);
  if (topic?.isTextBased()) await topic.send({ content }).catch(() => null);
}

async function connectTo(channel) {
  if (activeChannel?.id === channel.id && connection) return;
  if (connection) connection.destroy();
  connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true
  });
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  connection.receiver.speaking.on('start', handleSpeaking);
}

async function startSession(channel) {
  repo.endRunningSessions(nowIso());
  const session = repo.startSession({ guildId: channel.guild.id, channelId: channel.id, channelName: channel.name, hostId: env.idleHostUserId, startedAt: nowIso() });
  activeChannel = channel;
  for (const member of eligibleMembers(channel)) repo.joinPlayer({ sessionId: session.id, discordId: member.id, discordName: displayName(member), joinedAt: nowIso(), eventBonus: runningEventBonus(channel.id, member.id) });
  await connectTo(channel);
  await postSessionMessage(session, channel);
  await updateTopic(`🟢 Estacao de foco ligada em **${channel.name}**. Acompanhe em http://localhost:${env.dashboardPort}`);
}

async function stopSession() {
  const session = repo.getRunningSession();
  if (!session) return;
  repo.endRunningSessions(nowIso());
  const players = repo.listParticipation(session.id);
  const summary = players.slice(0, 10).map((p, i) => `${i + 1}. <@${p.discord_id}> — **${Math.floor(p.points)}** pontos`).join('\n') || 'Nenhum participante pontuou.';
  await updateTopic(`🏁 **Sessao encerrada — ${session.voice_channel_name}**\n${summary}`);
  if (connection) connection.destroy();
  connection = null;
  activeChannel = null;
}

async function syncHost() {
  if (!client) return;
  const guild = client.guilds.cache.get(require('../../config/ids').guildId);
  const host = guild?.members.cache.get(env.idleHostUserId) || await guild?.members.fetch(env.idleHostUserId).catch(() => null);
  const channel = host?.voice?.channel;
  if (!channel) return stopSession();
  if (activeChannel?.id !== channel.id || !repo.getRunningSession()) await startSession(channel);
}

function handleSpeaking(userId) {
  const session = repo.getRunningSession();
  if (!session || !activeChannel?.members.has(userId) || userId === env.idleHostUserId) return;
  const member = activeChannel.members.get(userId);
  if (member?.user.bot) return;
  repo.joinPlayer({ sessionId: session.id, discordId: userId, discordName: displayName(member), joinedAt: nowIso(), eventBonus: runningEventBonus(activeChannel.id, userId) });
  const now = new Date();
  const count = repo.recentSpeechCount(session.id, userId, new Date(now.getTime() - 5 * 60_000).toISOString());
  const penaltySeconds = Math.min(600, 60 + count * 30);
  repo.addSpeech({ sessionId: session.id, discordId: userId, penaltySeconds, penaltyUntil: new Date(now.getTime() + penaltySeconds * 1000).toISOString(), occurredAt: now.toISOString() });
}

function farmTick() {
  const session = repo.getRunningSession();
  if (!session || !activeChannel) return;
  const members = eligibleMembers(activeChannel);
  const multiplier = 1 + Math.min(1, Math.max(0, members.length - 1) * 0.1);
  const now = Date.now();
  for (const member of members) {
    const eventBonus = runningEventBonus(activeChannel.id, member.id);
    repo.joinPlayer({ sessionId: session.id, discordId: member.id, discordName: displayName(member), joinedAt: nowIso(), eventBonus });
    const player = repo.listParticipation(session.id).find((p) => p.discord_id === member.id);
    const muted = member.voice.selfMute || member.voice.serverMute;
    const penalized = player?.penalty_until && Date.parse(player.penalty_until) > now;
    if (muted && !penalized) repo.addFarm({ sessionId: session.id, discordId: member.id, seconds: TICK_SECONDS, points: BASE_POINTS_PER_TICK * multiplier * (eventBonus ? 1.5 : 1) });
  }
}

async function handleVoiceStateUpdate(oldState, newState) {
  if (newState.id === env.idleHostUserId || oldState.id === env.idleHostUserId) await syncHost();
  const session = repo.getRunningSession();
  if (!session) return;
  const userId = newState.id || oldState.id;
  if (newState.channelId === session.voice_channel_id && !newState.member.user.bot && userId !== env.idleHostUserId) {
    repo.joinPlayer({ sessionId: session.id, discordId: userId, discordName: displayName(newState.member), joinedAt: nowIso(), eventBonus: runningEventBonus(session.voice_channel_id, userId) });
  } else if (oldState.channelId === session.voice_channel_id && newState.channelId !== session.voice_channel_id) repo.leavePlayer(session.id, userId, nowIso());
}

function getDashboardState() {
  const session = repo.getRunningSession();
  const participants = session ? repo.listParticipation(session.id).map((p) => {
    const member = activeChannel?.members.get(p.discord_id);
    const penaltySeconds = Math.max(0, Math.ceil((Date.parse(p.penalty_until || 0) - Date.now()) / 1000));
    return { ...p, online: Boolean(member), muted: Boolean(member?.voice.selfMute || member?.voice.serverMute), penaltySeconds };
  }) : [];
  return { online: Boolean(session), session, participants, leaderboard: repo.leaderboard(), recentSessions: repo.listRecentSessions(), config: { tickSeconds: TICK_SECONDS, basePoints: BASE_POINTS_PER_TICK, port: env.dashboardPort } };
}

async function start(discordClient) {
  client = discordClient;
  await syncHost();
  tickTimer = setInterval(farmTick, TICK_SECONDS * 1000);
  refreshTimer = setInterval(syncHost, 30_000);
}

module.exports = { start, stopSession, handleVoiceStateUpdate, getDashboardState, handleSpeaking, farmTick };
