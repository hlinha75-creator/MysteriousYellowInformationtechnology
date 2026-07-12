const { joinVoiceChannel, entersState, VoiceConnectionStatus, createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus } = require('@discordjs/voice');
const { execFileSync } = require('child_process');
const { Readable } = require('stream');
const fs = require('fs');
const path = require('path');
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
const audioPlayer = createAudioPlayer();
let lastBuchaSpeechAt = 0;
const BUCHA_COOLDOWN_MS = 15_000;

function nowIso() { return new Date().toISOString(); }
function displayName(member) { return member?.displayName || member?.user?.globalName || member?.user?.username || member?.id; }
function isHost(userId) { return env.idleHostUserIds.includes(userId); }
function eligibleMembers(channel) { return [...channel.members.values()].filter((m) => !m.user.bot && !isHost(m.id)); }
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
  connection.subscribe(audioPlayer);
}

function pcmFromWav(buffer) {
  const marker = buffer.indexOf(Buffer.from('data'));
  if (marker < 0 || marker + 8 > buffer.length) throw new Error('Audio WAV sem bloco de dados.');
  const size = buffer.readUInt32LE(marker + 4);
  return buffer.subarray(marker + 8, Math.min(buffer.length, marker + 8 + size));
}

function createLocalSpeech(text) {
  const cacheDir = path.resolve('data', 'idle-audio');
  const audioPath = path.join(cacheDir, 'bucha-voce.wav');
  if (!fs.existsSync(audioPath)) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const safePath = audioPath.replace(/'/g, "''");
    const safeText = text.replace(/'/g, "''");
    const script = [
      "$voice = New-Object -ComObject SAPI.SpVoice",
      "$stream = New-Object -ComObject SAPI.SpFileStream",
      "$format = New-Object -ComObject SAPI.SpAudioFormat",
      '$format.Type = 39',
      `$stream.Format = $format`,
      `$stream.Open('${safePath}', 3, $false)`,
      '$voice.AudioOutputStream = $stream',
      `$voice.Speak('${safeText}') | Out-Null`,
      '$stream.Close()'
    ].join('; ');
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
  }
  return pcmFromWav(fs.readFileSync(audioPath));
}

async function speak(text) {
  if (!connection || !activeChannel) return false;
  try {
    const me = activeChannel.guild.members.me;
    if (!me || !activeChannel.permissionsFor(me)?.has('Speak')) {
      console.error(`O bot nao tem permissao Falar na call ${activeChannel.name}.`);
      return false;
    }
    const pcm = createLocalSpeech(text);
    if (!connection.rejoin({ selfDeaf: false, selfMute: false })) throw new Error('Nao foi possivel liberar a voz do bot.');
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
    audioPlayer.play(createAudioResource(Readable.from(pcm), { inputType: StreamType.Raw }));
    return true;
  } catch (error) {
    console.error('Falha ao falar na estacao de foco:', error);
    return false;
  }
}

audioPlayer.on(AudioPlayerStatus.Idle, () => {
  if (connection) connection.rejoin({ selfDeaf: false, selfMute: true });
});
audioPlayer.on('error', (error) => console.error('Erro no audio da estacao de foco:', error));

function handleMessage(message) {
  if (!activeChannel || message.author?.bot || message.channelId !== activeChannel.id) return false;
  if (!String(message.content || '').toLocaleLowerCase('pt-BR').includes('bucha')) return false;
  const now = Date.now();
  if (now - lastBuchaSpeechAt < BUCHA_COOLDOWN_MS || audioPlayer.state.status !== AudioPlayerStatus.Idle) return false;
  lastBuchaSpeechAt = now;
  speak('Você são tudo bucha.');
  return true;
}

async function startSession(channel) {
  repo.endRunningSessions(nowIso());
  const activeHost = [...channel.members.values()].find((member) => isHost(member.id));
  const session = repo.startSession({ guildId: channel.guild.id, channelId: channel.id, channelName: channel.name, hostId: activeHost?.id || env.idleHostUserIds[0], startedAt: nowIso() });
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
  let channel = env.idleHostUserIds.map((id) => guild?.members.cache.get(id)?.voice?.channel).find(Boolean);
  if (!channel) {
    for (const id of env.idleHostUserIds) {
      const host = await guild?.members.fetch(id).catch(() => null);
      if (host?.voice?.channel) { channel = host.voice.channel; break; }
    }
  }
  if (!channel) return stopSession();
  if (activeChannel?.id !== channel.id || !repo.getRunningSession()) await startSession(channel);
}

function handleSpeaking(userId) {
  const session = repo.getRunningSession();
  if (!session || !activeChannel?.members.has(userId) || isHost(userId)) return;
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
  if (isHost(newState.id) || isHost(oldState.id)) await syncHost();
  const session = repo.getRunningSession();
  if (!session) return;
  const userId = newState.id || oldState.id;
  if (newState.channelId === session.voice_channel_id && !newState.member.user.bot && !isHost(userId)) {
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

module.exports = { start, stopSession, handleVoiceStateUpdate, handleMessage, getDashboardState, handleSpeaking, farmTick, speak, createLocalSpeech };
