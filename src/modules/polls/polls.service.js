const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder
} = require('discord.js');
const ids = require('../../config/ids');
const events = require('../events/events.service');
const repo = require('./polls.repository');

const defaultQuestion = 'Voce quer Raid Avalon hoje? Que horas?';
const defaultOptions = ['17h', '18h', '19h', '20h', '21h', '22h', '23h'];

async function createPollFromModal(interaction) {
  const question = fieldOrDefault(interaction, 'question', defaultQuestion);
  const options = parseOptions(fieldOrDefault(interaction, 'options', defaultOptions.join(', ')));
  const poll = repo.createPoll({ creatorId: interaction.user.id, question, options });
  const channel = await interaction.client.channels.fetch(ids.channels.participate);
  const message = await channel.send({
    content: mentionContent(),
    embeds: [pollEmbed(poll)],
    components: pollComponents(poll),
    allowedMentions: { roles: mentionRoleIds() }
  });
  repo.setPollMessage({ id: poll.id, channelId: channel.id, messageId: message.id });
  return repo.getPoll(poll.id);
}

async function vote({ interaction, pollId, options }) {
  const poll = repo.getPoll(pollId);
  if (!poll) throw new Error('Enquete nao encontrada.');
  if (poll.status !== 'open') throw new Error('Essa enquete ja foi fechada.');
  const valid = options.filter((option) => poll.options.includes(option));
  repo.upsertVote({ pollId, userId: interaction.user.id, options: valid });
  await refreshPollMessage(interaction.client, pollId);
  return valid;
}

async function closePoll({ interaction, pollId }) {
  const poll = repo.getPoll(pollId);
  if (!poll) throw new Error('Enquete nao encontrada.');
  if (poll.creator_id !== interaction.user.id) throw new Error('Somente o criador pode fechar esta enquete.');
  const closed = repo.closePoll(pollId);
  await refreshPollMessage(interaction.client, pollId, { closed: true });
  return closed;
}

async function createEventFromPoll({ interaction, pollId }) {
  const poll = repo.getPoll(pollId);
  if (!poll) throw new Error('Enquete nao encontrada.');
  if (poll.creator_id !== interaction.user.id) throw new Error('Somente o criador da enquete pode criar evento por ela.');
  if (poll.status !== 'closed') throw new Error('Feche a enquete antes de criar o evento.');
  const winner = winningOption(poll.id);
  if (!winner) throw new Error('Nao ha votos nesta enquete para escolher horario.');

  return events.createEventFromModal(interaction, {
    title: 'Raid Avalon',
    description: `Criado pela enquete: ${poll.question}`,
    location: 'Pergunte na Call',
    scheduledTime: winner.option,
    tankSlots: 1,
    healerSlots: 1,
    supportSlots: 1,
    dpsSlots: 17
  });
}

async function refreshPollMessage(client, pollId, options = {}) {
  const poll = repo.getPoll(pollId);
  if (!poll?.channel_id || !poll?.message_id) return;
  const channel = await client.channels.fetch(poll.channel_id).catch(() => null);
  const message = await channel?.messages.fetch(poll.message_id).catch(() => null);
  if (!message) return;
  await message.edit({
    content: options.closed || poll.status === 'closed' ? 'Enquete fechada.' : mentionContent(),
    embeds: [pollEmbed(poll)],
    components: options.closed || poll.status === 'closed' ? [] : pollComponents(poll),
    allowedMentions: { parse: [] }
  });
}

function pollEmbed(poll) {
  const votes = repo.listVotes(poll.id);
  const counts = tally(poll, votes);
  const totalVoters = votes.length;
  const winner = winningOption(poll.id);
  return new EmbedBuilder()
    .setTitle(poll.status === 'closed' ? 'Enquete fechada' : 'Enquete')
    .setDescription(`**${poll.question}**`)
    .addFields(
      { name: 'Placar', value: pollResultsSummary(poll, votes, counts), inline: false },
      { name: 'Votantes', value: String(totalVoters), inline: true },
      { name: 'Mais votado', value: winner ? `${winner.option} (${winner.count})` : 'Sem votos', inline: true },
      { name: 'Criador', value: `<@${poll.creator_id}>`, inline: true }
    )
    .setColor(poll.status === 'closed' ? 0x718096 : 0x3182ce)
    .setTimestamp(new Date());
}

function pollComponents(poll) {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`poll:vote:${poll.id}`)
        .setPlaceholder('Escolha um ou mais horarios')
        .setMinValues(1)
        .setMaxValues(Math.min(poll.options.length, 25))
        .addOptions(poll.options.map((option) => ({ label: option, value: option })))
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`poll:close:${poll.id}`)
        .setLabel('Fechar enquete')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function closeDecisionComponents(pollId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`poll:create_event:${pollId}`)
        .setLabel('Criar evento')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`poll:no_event:${pollId}`)
        .setLabel('Nao criar')
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function tally(poll, votes) {
  const counts = new Map(poll.options.map((option) => [option, 0]));
  for (const vote of votes) {
    for (const option of vote.options) {
      if (counts.has(option)) counts.set(option, counts.get(option) + 1);
    }
  }
  return counts;
}

function pollResultsSummary(poll, votes, counts) {
  const lines = [];
  let used = 0;
  let hiddenOptions = 0;

  for (const option of poll.options) {
    const voters = votes
      .filter((vote) => vote.options.includes(option))
      .map((vote) => `<@${vote.user_id}>`);
    const count = counts.get(option) || 0;
    const votersText = compactMentions(voters, 650);
    const line = `**${option}** - ${count} voto(s)\n${votersText || 'Ninguem ainda.'}`;
    const nextLength = used + line.length + (lines.length > 0 ? 2 : 0);
    if (nextLength > 3900) {
      hiddenOptions += 1;
      continue;
    }
    lines.push(line);
    used = nextLength;
  }

  if (hiddenOptions > 0) lines.push(`... e mais ${hiddenOptions} horario(s).`);
  return lines.join('\n\n') || 'Sem opcoes.';
}

function compactMentions(mentions, maxLength) {
  const visible = [];
  let used = 0;
  for (const mention of mentions) {
    const nextLength = used + mention.length + (visible.length > 0 ? 2 : 0);
    if (nextLength > maxLength) break;
    visible.push(mention);
    used = nextLength;
  }
  const hidden = mentions.length - visible.length;
  if (hidden > 0) visible.push(`e mais ${hidden}`);
  return visible.join(', ');
}

function winningOption(pollId) {
  const poll = repo.getPoll(pollId);
  if (!poll) return null;
  const counts = tally(poll, repo.listVotes(poll.id));
  let winner = null;
  for (const option of poll.options) {
    const count = counts.get(option) || 0;
    if (count <= 0) continue;
    if (!winner || count > winner.count) winner = { option, count };
  }
  return winner;
}

function parseOptions(value) {
  const options = String(value || '')
    .split(/[,;\n]/)
    .map((option) => option.trim())
    .filter(Boolean)
    .slice(0, 25);
  const unique = [...new Set(options)];
  if (unique.length < 2) throw new Error('Informe pelo menos 2 opcoes para a enquete.');
  return unique;
}

function fieldOrDefault(interaction, id, fallback) {
  const value = interaction.fields.getTextInputValue(id).trim();
  return value || fallback;
}

function mentionRoleIds() {
  return [
    ids.roles.member,
    ids.roles.caller,
    ids.roles.recruiter,
    ids.roles.treasurer,
    ids.roles.staff,
    ids.roles.adm
  ].filter(Boolean);
}

function mentionContent() {
  return mentionRoleIds().map((roleId) => `<@&${roleId}>`).join(' ');
}

module.exports = {
  closeDecisionComponents,
  closePoll,
  createEventFromPoll,
  createPollFromModal,
  defaultOptions,
  defaultQuestion,
  pollEmbed,
  vote
};
