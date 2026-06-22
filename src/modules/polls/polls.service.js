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
const blackForFunQuestion = 'Qual melhor horario para voce fazer conteudo de grupo hoje?';
const blackForFunOptions = ['10h', '11h', '12h', '13h', '14h', '15h', '16h', '17h', '18h', '19h', '20h', '21h', '22h', '23h', '00h', '01h', '02h', '03h'];
const botCreatorId = 'system';

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
  await maybeHandleBlackForFunMilestones(interaction.client, pollId);
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
  const embed = new EmbedBuilder()
    .setTitle(pollTitle(poll))
    .setDescription(`**${poll.question}**`)
    .setColor(poll.status === 'closed' ? 0x718096 : 0x3182ce)
    .setTimestamp(new Date());

  if (poll.options.length <= 21) {
    embed.addFields(...compactPollFields(poll, counts));
  } else {
    embed.addFields({ name: 'Placar', value: pollResultsSummary(poll, votes, counts), inline: false });
  }

  embed.addFields(
    { name: 'Votantes', value: String(totalVoters), inline: true },
    { name: 'Mais votado', value: winner ? `${pollOptionCode(winner.option)} (${winner.count})` : 'Sem votos', inline: true },
    { name: 'Criador', value: poll.creator_id === botCreatorId ? 'NOTAG' : `<@${poll.creator_id}>`, inline: true }
  );

  return embed;
}

function pollNamesEmbed(pollId) {
  const poll = repo.getPoll(pollId);
  if (!poll) throw new Error('Enquete nao encontrada.');
  const votes = repo.listVotes(poll.id);
  const counts = tally(poll, votes);
  const embed = new EmbedBuilder()
    .setTitle(`Votos da enquete #${poll.id}`)
    .setDescription(`**${poll.question}**`)
    .setColor(0x2d3748)
    .setTimestamp(new Date());

  for (const option of poll.options.slice(0, 25)) {
    const voters = votes
      .filter((vote) => vote.options.includes(option))
      .map((vote) => `<@${vote.user_id}>`);
    const count = counts.get(option) || 0;
    embed.addFields({
      name: `${pollOptionLabel(option)} - ${count} voto(s)`,
      value: compactMentions(voters, 950) || 'Ninguem ainda.',
      inline: false
    });
  }

  return embed;
}

async function ensureDailyBlackForFunPoll(client) {
  const now = new Date();
  if (now.getUTCHours() !== 10) return null;
  const key = dailyBlackPollKey(now);
  let poll = repo.getPollByKey(key);
  if (poll) {
    if (poll.question !== blackForFunQuestion || JSON.stringify(poll.options) !== JSON.stringify(blackForFunOptions)) {
      poll = repo.updatePollContent({ id: poll.id, question: blackForFunQuestion, options: blackForFunOptions });
      await refreshPollMessage(client, poll.id);
    }
    return poll;
  }

  poll = repo.createPoll({
    creatorId: client.user?.id || botCreatorId,
    question: blackForFunQuestion,
    options: blackForFunOptions,
    pollKey: key
  });

  const channel = await client.channels.fetch(ids.channels.notagChat);
  const message = await channel.send({
    content: `<@&${ids.roles.member}>`,
    embeds: [pollEmbed(poll)],
    components: pollComponents(poll),
    allowedMentions: { roles: [ids.roles.member] }
  });
  repo.setPollMessage({ id: poll.id, channelId: channel.id, messageId: message.id });
  return repo.getPoll(poll.id);
}

async function maybeHandleBlackForFunMilestones(client, pollId) {
  const poll = repo.getPoll(pollId);
  if (!poll?.poll_key?.startsWith('black_for_fun:') || poll.status !== 'open') return;
  const winner = winningOption(poll.id);
  const winnerCount = winner?.count || 0;

  if (winnerCount >= 10 && !poll.staff_alerted_at) {
    const channel = await client.channels.fetch(ids.channels.notagChat).catch(() => null);
    await channel?.send({
      content: `${staffMentions()} enquete Black For-Fun chegou a ${winnerCount} membro(s) no horario ${pollOptionLabel(winner.option)}.`,
      allowedMentions: { roles: staffRoleIds() }
    }).catch(() => {});
    repo.markStaffAlerted(poll.id);
  }

  if (winnerCount >= 20 && !poll.auto_event_id) {
    await createBlackForFunEvent(client, poll.id);
  }
}

async function createBlackForFunEvent(client, pollId) {
  const poll = repo.getPoll(pollId);
  const winner = winningOption(poll.id);
  if (!winner) return null;
  const scheduledTime = pollOptionLabel(winner.option);
  const existing = events.findEventByTitleAndSchedule?.({ title: 'Black For-Fun', scheduledTime });
  if (existing) {
    repo.setAutoEvent({ id: poll.id, eventId: existing.id });
    return existing;
  }

  const guild = await client.guilds.fetch(ids.guildId);
  const event = await events.createEventFromFields({
    client,
    guild,
    user: { id: client.user?.id || botCreatorId }
  }, {
    creatorId: client.user?.id || botCreatorId,
    title: 'Black For-Fun',
    description: 'Content na black for fun criado automaticamente pela enquete diaria.',
    location: 'Black Zone',
    scheduledTime,
    tankSlots: 2,
    healerSlots: 2,
    supportSlots: 1,
    dpsSlots: 15
  });

  const voters = repo.listVotes(poll.id).filter((vote) => vote.options.includes(winner.option)).slice(0, 20);
  const roles = ['tank', 'tank', 'healer', 'healer', 'support', ...Array(15).fill('dps')];
  for (const [index, vote] of voters.entries()) {
    events.addParticipantDirect({ guild, eventId: event.id, discordId: vote.user_id, role: roles[index] || 'dps' });
  }
  await events.refreshEventMessage(client, event.id);
  repo.setAutoEvent({ id: poll.id, eventId: event.id });

  const channel = await client.channels.fetch(ids.channels.notagChat).catch(() => null);
  await channel?.send(`Evento **Black For-Fun** criado automaticamente para ${pollOptionLabel(winner.option)} com ${voters.length} interessado(s).`).catch(() => {});
  return event;
}

async function checkBlackForFunAutoStart(client) {
  await ensureDailyBlackForFunPoll(client).catch((error) => console.error('Falha ao criar enquete diaria Black For-Fun:', error));
  await events.autoStartBlackForFunEvents(client).catch((error) => console.error('Falha ao iniciar Black For-Fun automatico:', error));
}

function pollComponents(poll) {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`poll:vote:${poll.id}`)
        .setPlaceholder('Escolha um ou mais horarios')
        .setMinValues(1)
        .setMaxValues(Math.min(poll.options.length, 25))
        .addOptions(poll.options.map((option) => ({ label: pollOptionLabel(option), value: option })))
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`poll:view_names:${poll.id}`)
        .setLabel('Ver nomes')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`poll:history:${poll.id}`)
        .setLabel('Historico')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`poll:close:${poll.id}`)
        .setLabel('Fechar enquete')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function primeTimeHistoryEmbed(days = 14) {
  const polls = repo.listPollsByKeyPrefix('black_for_fun:', days);
  const totals = new Map(blackForFunOptions.map((option) => [option, { votes: 0, winnerDays: 0 }]));
  let totalVoters = 0;

  for (const poll of polls) {
    const votes = repo.listVotes(poll.id);
    totalVoters += votes.length;
    const counts = tally({ ...poll, options: blackForFunOptions }, votes);
    let dayWinner = null;
    for (const option of blackForFunOptions) {
      const count = counts.get(option) || 0;
      const item = totals.get(option);
      item.votes += count;
      if (count > 0 && (!dayWinner || count > dayWinner.count)) dayWinner = { option, count };
    }
    if (dayWinner) totals.get(dayWinner.option).winnerDays += 1;
  }

  const lines = [...totals.entries()]
    .filter(([, item]) => item.votes > 0)
    .sort((a, b) => b[1].votes - a[1].votes || b[1].winnerDays - a[1].winnerDays)
    .slice(0, 12)
    .map(([option, item], index) => `${index + 1}. **${pollOptionLabel(option)}** - ${item.votes} voto(s), venceu ${item.winnerDays} dia(s)`);
  const voice = repo.blackForFunVoiceSummary(days);

  return new EmbedBuilder()
    .setTitle('Historico PRIME TIME')
    .setDescription([
      `Ultimos ${days} dias de enquetes Black For-Fun.`,
      '',
      '**Horarios mais fortes**',
      lines.length ? lines.join('\n') : 'Ainda nao ha votos historicos.',
      '',
      '**Voz Black For-Fun**',
      `Eventos: ${voice?.events || 0}`,
      `Membros em voz: ${voice?.members || 0}`,
      `Horas em voz: ${Math.round(((voice?.seconds || 0) / 3600) * 10) / 10}`
    ].join('\n'))
    .setColor(0xf6ad55)
    .setTimestamp(new Date());
}

function pollTitle(poll) {
  if (poll.poll_key?.startsWith('black_for_fun:')) return poll.status === 'closed' ? 'PRIME TIME encerrado' : 'PRIME TIME';
  return poll.status === 'closed' ? 'Enquete fechada' : 'Enquete';
}

function compactPollFields(poll, counts) {
  return poll.options.map((option) => ({
    name: pollOptionCode(option),
    value: `${counts.get(option) || 0} voto(s)`,
    inline: true
  }));
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
    const count = counts.get(option) || 0;
    const line = `**${pollOptionLabel(option)}** - ${count} voto(s)`;
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

function pollOptionLabel(option) {
  const text = String(option || '').trim();
  const match = text.match(/^(\d{1,2})h$/i);
  if (!match) return text;
  return `${String(Number(match[1])).padStart(2, '0')}:00`;
}

function pollOptionCode(option) {
  return `\`${pollOptionLabel(option)}\``;
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

function staffRoleIds() {
  return [ids.roles.staff, ids.roles.adm, ids.roles.caller].filter(Boolean);
}

function staffMentions() {
  return staffRoleIds().map((roleId) => `<@&${roleId}>`).join(' ');
}

function dailyBlackPollKey(date) {
  return `black_for_fun:${date.toISOString().slice(0, 10)}`;
}

function mentionContent() {
  return mentionRoleIds().map((roleId) => `<@&${roleId}>`).join(' ');
}

module.exports = {
  closeDecisionComponents,
  closePoll,
  checkBlackForFunAutoStart,
  createEventFromPoll,
  createPollFromModal,
  defaultOptions,
  defaultQuestion,
  pollEmbed,
  primeTimeHistoryEmbed,
  pollNamesEmbed,
  vote
};
