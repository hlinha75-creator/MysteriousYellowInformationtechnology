const {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  joinVoiceChannel
} = require('@discordjs/voice');
const prism = require('prism-media');
const eventsRepo = require('../events/events.repository');
const env = require('../../config/env');

const sessions = new Map();
const MAX_UTTERANCE_BYTES = 48_000 * 2 * 2 * 20;
const MIN_UTTERANCE_BYTES = 48_000 * 2 * 2 * 0.35;
const MAX_ITEMS = 100;

function normalize(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function isShortQuestion(text) {
  const clean = String(text || '').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 25) return false;
  return /\?$/.test(clean) || /^(quem|o que|qual|quais|onde|aonde|quando|como|por que|porque|que horas|quanto|quantos|quantas|cade|vai|tem|precisa|pode|posso|devemos)\b/i.test(normalize(clean));
}

function describeMatch(question, event) {
  const q = normalize(question);
  if (/\b(que horas|horario|quando|comeca|inicio)\b/.test(q) && event?.scheduled_time) {
    return { inDescription: true, answer: `Horario programado: ${event.scheduled_time}` };
  }
  if (/\b(onde|aonde|local|encontro)\b/.test(q) && event?.location) {
    return { inDescription: true, answer: `Local: ${event.location}` };
  }
  const source = String(event?.description || '').trim();
  const meaningful = q.split(/\W+/).filter((word) => word.length >= 4 && !['qual', 'quais', 'como', 'onde', 'quando', 'precisa', 'pode', 'posso'].includes(word));
  const normalizedSource = normalize(source);
  const hits = meaningful.filter((word) => normalizedSource.includes(word));
  if (source && hits.length > 0) return { inDescription: true, answer: source };
  return { inDescription: false, answer: '' };
}

function wavFromPcm(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(48_000, 24);
  header.writeUInt32LE(48_000 * 2 * 2, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function transcribe(pcm, fetchImpl = fetch) {
  if (!env.openaiApiKey) throw new Error('OPENAI_API_KEY nao configurada.');
  const form = new FormData();
  form.append('model', env.voiceTranscriptionModel);
  form.append('language', 'pt');
  form.append('file', new Blob([wavFromPcm(pcm)], { type: 'audio/wav' }), 'fala.wav');
  const response = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.openaiApiKey}` },
    body: form
  });
  if (!response.ok) throw new Error(`Transcricao recusada (${response.status}): ${String(await response.text()).slice(0, 180)}`);
  return String((await response.json()).text || '').trim();
}

function captureSpeaker(session, userId) {
  if (session.stopping || session.activeSpeakers.has(userId) || session.items.length >= MAX_ITEMS) return;
  const member = session.channel.members.get(userId);
  if (!member || member.user.bot) return;
  session.activeSpeakers.add(userId);
  const opus = session.connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 900 }
  });
  const decoder = new prism.opus.Decoder({ rate: 48_000, channels: 2, frameSize: 960 });
  const chunks = [];
  let size = 0;
  let truncated = false;
  decoder.on('data', (chunk) => {
    if (size + chunk.length > MAX_UTTERANCE_BYTES) {
      truncated = true;
      opus.destroy();
      return;
    }
    chunks.push(chunk);
    size += chunk.length;
  });
  const finish = async () => {
    if (!session.activeSpeakers.delete(userId) || size < MIN_UTTERANCE_BYTES || truncated || session.stopping) return;
    session.pending += 1;
    try {
      const text = await transcribe(Buffer.concat(chunks));
      if (isShortQuestion(text) && session.items.length < MAX_ITEMS) {
        session.items.push({ userId, name: member.displayName || member.user.username, text, at: new Date(), ...describeMatch(text, session.event) });
      }
    } catch (error) {
      session.errors.push(error.message);
    } finally {
      session.pending -= 1;
    }
  };
  decoder.once('end', finish);
  decoder.once('error', (error) => {
    session.activeSpeakers.delete(userId);
    session.errors.push(`Audio de ${member.displayName}: ${error.message}`);
  });
  opus.on('error', (error) => session.errors.push(`Recepcao de ${member.displayName}: ${error.message}`));
  opus.pipe(decoder);
}

async function start({ guild, member, textChannel }) {
  if (!env.openaiApiKey) throw new Error('Configure OPENAI_API_KEY na Discloud antes de iniciar a escuta.');
  const channel = member?.voice?.channel;
  if (!channel) throw new Error('Entre na sala de voz do evento antes de usar este comando.');
  if (sessions.has(guild.id)) throw new Error('A escuta de perguntas ja esta ativa neste servidor.');
  const existing = getVoiceConnection(guild.id);
  if (existing) {
    throw new Error('O bot ja esta usando uma call (por exemplo, a Estacao de Foco). Encerre essa sessao primeiro.');
  }
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true
  });
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  const event = eventsRepo.getEventByVoiceChannel(channel.id) || null;
  const session = { connection, channel, textChannel, event, startedAt: new Date(), items: [], errors: [], activeSpeakers: new Set(), pending: 0, stopping: false };
  session.onStart = (userId) => captureSpeaker(session, userId);
  connection.receiver.speaking.on('start', session.onStart);
  sessions.set(guild.id, session);
  await textChannel.send({
    content: `🎙️ **Transcricao de perguntas ativada em ${channel}.** Falas curtas poderao ser transcritas para gerar um relatorio da staff. O audio e temporario e nao sera armazenado.`,
    allowedMentions: { parse: [] }
  });
  return { channel, event };
}

async function stop(guildId) {
  const session = sessions.get(guildId);
  if (!session) throw new Error('A escuta de perguntas nao esta ativa.');
  session.stopping = true;
  session.connection.receiver.speaking.off('start', session.onStart);
  for (let attempt = 0; attempt < 40 && session.pending > 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 250));
  session.connection.destroy();
  sessions.delete(guildId);
  return session;
}

function status(guildId) {
  const session = sessions.get(guildId);
  return session ? { active: true, channel: session.channel, count: session.items.length, startedAt: session.startedAt } : { active: false };
}

function report(session) {
  const rows = session.items.map((item, index) => `${index + 1}. ${item.at.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })} — **${item.name}**: “${item.text}”\n   ${item.inDescription ? `✅ Ja informado — ${item.answer}` : '🆕 Nao identificado na descricao'}`);
  const errors = session.errors.length ? `\n\n⚠️ ${session.errors.length} trecho(s) nao puderam ser processados.` : '';
  return [`**Relatorio de perguntas em voz**`, `Call: ${session.channel.name}`, `Perguntas curtas: ${session.items.length}`, '', rows.join('\n') || 'Nenhuma pergunta curta foi detectada.', errors].join('\n').slice(0, 3900);
}

module.exports = { describeMatch, isShortQuestion, report, start, status, stop, transcribe, wavFromPcm };
