const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const { createWorker } = require('tesseract.js');
const ids = require('../../config/ids');
const { can, hasRole, isOwner } = require('../../config/permissions');
const { getDatabase } = require('../../database/connection');
const audit = require('../audit/audit.repository');
const registrationRepo = require('../registration/registration.repository');

let workerPromise = null;

function panelPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('OCR Stats Albion')
        .setDescription([
          'Teste da staff para atualizar cadastro por print do Albion.',
          '',
          'Envie neste canal um print mostrando:',
          '- nome do personagem',
          '- Member of / guild',
          '- Total Fame',
          '',
          'Se quiser aplicar em outro membro, mencione o membro junto com o print. O bot vai ler e pedir confirmacao antes de mudar cargo.'
        ].join('\n'))
        .setColor(0x3182ce)
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('stats_ocr:how_to')
          .setLabel('Como usar')
          .setStyle(ButtonStyle.Primary)
      )
    ]
  };
}

async function handleStaffMessage(message) {
  if (message.author?.bot) return false;
  if (message.channelId !== ids.channels.statsOcr) return false;

  const staffMember = message.member || await message.guild?.members.fetch(message.author.id).catch(() => null);
  if (!can(staffMember, 'approveRegistration') && !can(staffMember, 'importCsv')) return false;

  const attachment = Array.from(message.attachments.values()).find(isImageAttachment);
  if (!attachment) return false;

  const targetMember = message.mentions.members.first() || staffMember;
  const waitMessage = await message.reply({
    content: `Lendo print com OCR para ${targetMember}. A primeira leitura pode demorar um pouco...`,
    allowedMentions: { users: [targetMember.id] }
  }).catch(() => null);

  try {
    const submission = await createSubmissionFromImage({ message, attachment, targetMember });
    const payload = reviewPayload(submission);
    if (waitMessage) await waitMessage.edit(payload);
    else await message.reply(payload);
  } catch (error) {
    const content = `Nao consegui ler esse print: ${error.message}`;
    if (waitMessage) await waitMessage.edit({ content, embeds: [], components: [] }).catch(() => {});
    else await message.reply({ content }).catch(() => {});
  }
  return true;
}

async function createSubmissionFromImage({ message, attachment, targetMember }) {
  const imageBuffer = await downloadAttachment(attachment.url);
  const ocrText = await recognizeText(imageBuffer);
  const parsed = parseAlbionStatsText(ocrText);
  const row = insertSubmission({
    submittedBy: message.author.id,
    targetDiscordId: targetMember.id,
    channelId: message.channelId,
    messageId: message.id,
    imageUrl: attachment.url,
    characterName: parsed.characterName,
    guildName: parsed.guildName,
    totalFame: parsed.totalFame,
    isNotagMember: parsed.isNotagMember,
    ocrText
  });
  return getSubmission(row.lastInsertRowid);
}

async function downloadAttachment(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`falha ao baixar imagem (${response.status})`);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function recognizeText(imageBuffer) {
  const worker = await getWorker();
  const result = await worker.recognize(imageBuffer);
  return result.data?.text || '';
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng');
  }
  return workerPromise;
}

function parseAlbionStatsText(text) {
  const lines = cleanLines(text);
  const guildName = extractGuildName(lines);
  const characterName = extractCharacterName(lines);
  const totalFame = extractTotalFame(lines);
  const isNotagMember = guildName == null ? null : normalize(guildName).includes('notag');
  return { characterName, guildName, totalFame, isNotagMember };
}

function cleanLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/[|]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function extractCharacterName(lines) {
  const blocked = characterNameBlockedWords();
  const candidates = [];
  for (const [index, line] of lines.slice(0, 18).entries()) {
    const lowered = line.toLowerCase();
    if (blocked.some((word) => lowered.includes(word))) continue;
    const tokens = line.match(/[A-Za-z][A-Za-z0-9_-]{2,20}/g) || [];
    for (const token of tokens) {
      const key = token.toLowerCase();
      if (blocked.includes(key)) continue;
      let score = 0;
      if (/^[A-Z]/.test(token)) score += 4;
      if (/[A-Z]/.test(token) && /[a-z]/.test(token)) score += 4;
      if (tokens.length <= 3) score += 2;
      if (index > 0 && index < 10) score += 2;
      if (/^[a-z]+$/.test(token) && index <= 1) score -= 5;
      if (token.length < 4) score -= 2;
      candidates.push({ token, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.token.length - b.token.length);
  return candidates[0]?.token || null;
}

function characterNameBlockedWords() {
  return [
    'details',
    'member',
    'of',
    'notag',
    'guild',
    'silver',
    'total',
    'fame',
    'for',
    'killing',
    'players',
    'mobs',
    'gathering',
    'crafting',
    'killed',
    'infamy',
    'crystal',
    'league',
    'click',
    'here',
    'noble',
    'reputation'
  ];
}

function extractGuildName(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalized = normalize(line);
    if (!normalized.includes('memberof') && !normalized.includes('guild')) continue;
    const sameLine = line.match(/(?:member\s*of|guild)\s*:?\s*(.+)$/i)?.[1];
    const value = cleanGuildValue(sameLine || lines[index + 1] || '');
    if (value) return value;
  }
  const notagLine = lines.find((line) => normalize(line).includes('notag'));
  return cleanGuildValue(notagLine || '');
}

function cleanGuildValue(value) {
  const text = String(value || '')
    .replace(/member\s*of\s*:?/i, '')
    .replace(/guild\s*:?/i, '')
    .replace(/[^A-Za-z0-9 _-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  const notag = text.match(/no\s*tag|notag/i);
  if (notag) return 'NoTag';
  return text.slice(0, 40);
}

function extractTotalFame(lines) {
  for (const line of lines) {
    const normalized = normalize(line);
    if (!normalized.includes('totalfame')) continue;
    const match = line.match(/total\s*fame\D*([\d.,]+\s*[kKmMbB]?)/i);
    if (match) return normalizeNumberText(match[1]);
    const fallback = line.match(/([\d.,]+\s*[kKmMbB])\b/);
    if (fallback) return normalizeNumberText(fallback[1]);
  }
  return null;
}

function normalizeNumberText(value) {
  return String(value || '').replace(/\s+/g, '').replace(',', '.').trim();
}

function insertSubmission(data) {
  return getDatabase()
    .prepare(`
      INSERT INTO albion_stats_ocr_submissions
        (submitted_by, target_discord_id, channel_id, message_id, image_url, character_name, guild_name, total_fame, is_notag_member, ocr_text)
      VALUES
        (@submittedBy, @targetDiscordId, @channelId, @messageId, @imageUrl, @characterName, @guildName, @totalFame, @isNotagMember, @ocrText)
    `)
    .run({
      ...data,
      isNotagMember: data.isNotagMember == null ? null : data.isNotagMember ? 1 : 0
    });
}

function getSubmission(id) {
  return getDatabase().prepare('SELECT * FROM albion_stats_ocr_submissions WHERE id = ?').get(Number(id));
}

async function applySubmission({ guild, submissionId, actorId, forcedRole = null }) {
  const submission = getSubmission(submissionId);
  if (!submission) throw new Error('Leitura OCR nao encontrada.');
  if (!['pending', 'applied', 'rejected'].includes(submission.status)) throw new Error(`Status OCR invalido: ${submission.status}`);
  if (submission.status !== 'pending') throw new Error(`Essa leitura ja foi resolvida. Status: ${submission.status}.`);

  const target = await guild.members.fetch(submission.target_discord_id).catch(() => null);
  if (!target) throw new Error('Membro alvo nao encontrado no servidor.');
  if (isProtectedMember(target)) {
    throw new Error('Nao alterei cargo porque o alvo tem cargo protegido de equipe.');
  }

  const role = forcedRole || (Number(submission.is_notag_member) === 1 ? 'member' : 'guest');
  if (role === 'member') {
    await target.roles.remove(ids.roles.noTag).catch(() => {});
    await target.roles.remove(ids.roles.guest).catch(() => {});
    await target.roles.add(ids.roles.member).catch(() => {});
  } else {
    await target.roles.remove(ids.roles.noTag).catch(() => {});
    await target.roles.remove(ids.roles.member).catch(() => {});
    await target.roles.add(ids.roles.guest).catch(() => {});
  }

  const characterName = submission.character_name || null;
  if (characterName) {
    await target.setNickname(characterName.slice(0, 32), 'Cadastro atualizado por OCR de stats Albion').catch(() => {});
  }
  registrationRepo.upsertUser({
    discordId: target.id,
    discordName: target.user.tag,
    albionName: characterName,
    registrationStatus: role === 'member' ? 'member' : 'guest'
  });

  updateSubmissionStatus({ id: submission.id, status: 'applied', appliedRole: role, actorId });
  audit.createAuditLog({
    type: 'albion_stats_ocr_applied',
    actorId,
    targetId: target.id,
    afterValue: role,
    reason: `OCR stats #${submission.id}`,
    metadata: {
      characterName: submission.character_name,
      guildName: submission.guild_name,
      totalFame: submission.total_fame,
      forcedRole
    }
  });
  return getSubmission(submission.id);
}

function rejectSubmission({ submissionId, actorId }) {
  const submission = getSubmission(submissionId);
  if (!submission) throw new Error('Leitura OCR nao encontrada.');
  if (submission.status !== 'pending') throw new Error(`Essa leitura ja foi resolvida. Status: ${submission.status}.`);
  updateSubmissionStatus({ id: submission.id, status: 'rejected', appliedRole: null, actorId });
  audit.createAuditLog({
    type: 'albion_stats_ocr_rejected',
    actorId,
    targetId: submission.target_discord_id,
    reason: `OCR stats #${submission.id} rejeitado`
  });
  return getSubmission(submission.id);
}

function updateSubmissionStatus({ id, status, appliedRole, actorId }) {
  return getDatabase()
    .prepare(`
      UPDATE albion_stats_ocr_submissions
      SET status = ?, applied_role = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .run(status, appliedRole || null, actorId, Number(id));
}

function reviewPayload(submission) {
  return {
    embeds: [reviewEmbed(submission)],
    components: submission.status === 'pending' ? reviewComponents(submission.id) : [],
    allowedMentions: { parse: [] }
  };
}

function reviewEmbed(submission) {
  const resultRole = Number(submission.is_notag_member) === 1 ? 'Membro' : 'Convidado';
  return new EmbedBuilder()
    .setTitle(`OCR Stats Albion #${submission.id}`)
    .setDescription(statusText(submission))
    .addFields(
      { name: 'Alvo Discord', value: `<@${submission.target_discord_id}>`, inline: true },
      { name: 'Personagem', value: valueOrMissing(submission.character_name), inline: true },
      { name: 'Guild lida', value: valueOrMissing(submission.guild_name), inline: true },
      { name: 'Total Fame', value: valueOrMissing(submission.total_fame), inline: true },
      { name: 'Resultado sugerido', value: resultRole, inline: true },
      { name: 'Texto OCR', value: truncate(submission.ocr_text || 'Sem texto lido.', 900), inline: false }
    )
    .setImage(submission.image_url)
    .setColor(submission.status === 'applied' ? 0x38a169 : submission.status === 'rejected' ? 0xe53e3e : 0xf6ad55)
    .setTimestamp(new Date(submission.created_at));
}

function reviewComponents(id) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`stats_ocr:apply:${id}`)
        .setLabel('Aplicar resultado')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`stats_ocr:force_member:${id}`)
        .setLabel('Forcar Membro')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`stats_ocr:force_guest:${id}`)
        .setLabel('Forcar Convidado')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`stats_ocr:reject:${id}`)
        .setLabel('Leitura ruim')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function howToText() {
  return [
    '**OCR de stats Albion - teste staff**',
    '',
    'Envie um print neste canal mostrando nome do personagem, guild/Member of e Total Fame.',
    'Para aplicar em outro membro, mencione o membro junto com o print.',
    '',
    'Regra ao confirmar:',
    '- Guild lida como NoTag -> cargo Membro',
    '- Guild diferente/nao lida como NoTag -> cargo Convidado',
    '',
    'Dica: print cortado no painel do perfil funciona melhor que tela inteira cheia de nomes.'
  ].join('\n');
}

function isImageAttachment(attachment) {
  if (!attachment) return false;
  if (attachment.contentType?.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp)(\?\S*)?$/i.test(attachment.url || '');
}

function isProtectedMember(member) {
  return isOwner(member) || ['adm', 'staff', 'treasurer', 'caller', 'recruiter'].some((role) => hasRole(member, role));
}

function statusText(submission) {
  if (submission.status === 'applied') return `Aplicado como ${submission.applied_role === 'member' ? 'Membro' : 'Convidado'}.`;
  if (submission.status === 'rejected') return 'Leitura rejeitada pela staff.';
  return 'Confira a leitura antes de aplicar cargo.';
}

function valueOrMissing(value) {
  return value ? String(value).slice(0, 120) : 'nao lido';
}

function truncate(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

module.exports = {
  applySubmission,
  getSubmission,
  handleStaffMessage,
  howToText,
  panelPayload,
  parseAlbionStatsText,
  rejectSubmission,
  reviewPayload
};
