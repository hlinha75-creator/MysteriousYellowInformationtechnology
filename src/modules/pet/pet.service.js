const { EmbedBuilder } = require('discord.js');
const ids = require('../../config/ids');
const { transaction } = require('../../database/connection');
const audit = require('../audit/audit.repository');
const eventsRepo = require('../events/events.repository');
const repo = require('./pet.repository');

const fruits = [
  { type: 'silver_banana', name: 'Banana de prata', chance: 70, points: 1 },
  { type: 'gold_apple', name: 'Maca de ouro', chance: 25, points: 3 },
  { type: 'emerald_grape', name: 'Uva esmeralda roxa', chance: 5, points: 10 }
];

async function rewardEventParticipants({ client, guild, eventId }) {
  const event = eventsRepo.getEvent(eventId);
  if (!event) throw new Error('Evento nao encontrado para frutas.');
  eventsRepo.refreshParticipantSeconds(eventId);

  const result = transaction(() => {
    if (!repo.tryMarkEventRewarded(eventId)) {
      return { alreadyRewarded: true, event, rewards: [], stars: [], totalFruits: 0 };
    }

    const participants = eventsRepo.listParticipants(eventId)
      .filter((participant) => !participant.is_spectator)
      .map((participant) => ({
        ...participant,
        seconds: participant.manual_seconds ?? participant.calculated_seconds ?? 0
      }));

    const rewards = [];
    const starChanges = [];

    for (const participant of participants) {
      const fruitCount = fruitBlocks(participant.seconds);
      if (fruitCount <= 0) continue;

      const member = guild?.members?.cache?.get(participant.discord_id);
      const baseDisplayName = cleanBaseName(member?.displayName || null);
      const memberFruits = [];
      let points = 0;

      for (let index = 0; index < fruitCount; index += 1) {
        const fruit = drawFruit();
        memberFruits.push(fruit);
        points += fruit.points;
        repo.addFeedLog({ eventId, discordId: participant.discord_id, fruitType: fruit.type, points: fruit.points });
      }

      const update = repo.upsertMember({
        discordId: participant.discord_id,
        baseDisplayName,
        fruitCount,
        points
      });

      rewards.push({
        discordId: participant.discord_id,
        seconds: participant.seconds,
        fruits: memberFruits,
        points,
        after: update.after
      });

      if (update.gainedStars > 0) {
        starChanges.push({
          discordId: participant.discord_id,
          gainedStars: update.gainedStars,
          starCount: update.after.star_count,
          baseDisplayName: update.after.base_display_name
        });
      }
    }

    audit.createAuditLog({
      type: 'pet_event_rewarded',
      targetId: String(eventId),
      reason: event.event_code,
      metadata: {
        rewards: rewards.map((reward) => ({
          discordId: reward.discordId,
          fruits: reward.fruits.map((fruit) => fruit.type),
          points: reward.points
        })),
        starChanges
      }
    });

    return {
      alreadyRewarded: false,
      event,
      rewards,
      stars: starChanges,
      totalFruits: rewards.reduce((sum, reward) => sum + reward.fruits.length, 0)
    };
  })();

  if (result.alreadyRewarded || result.totalFruits <= 0) return result;

  result.renameFailures = await applyStarNicknames(guild, result.stars);
  await postEventSummary(client, result);
  return result;
}

async function postDailyPetReport(client) {
  const now = utcMinus3Now();
  if (now.hour < 18) return null;

  const dateKey = now.dateKey;
  const existing = repo.getDailyRaffle(dateKey);
  if (existing) return existing;

  const candidates = repo.raffleCandidates();
  const winner = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : null;
  const chestNumber = winner ? Math.floor(Math.random() * 14) + 1 : null;
  const raffle = repo.createDailyRaffle({
    dateKey,
    winnerId: winner?.discord_id || null,
    chestNumber
  });

  await postDailyReportMessage(client, raffle);
  return raffle;
}

async function applyStarNicknames(guild, starChanges) {
  const failures = [];
  if (!guild || starChanges.length === 0) return failures;

  for (const change of starChanges) {
    const member = await guild.members.fetch(change.discordId).catch(() => null);
    if (!member) {
      failures.push(change.discordId);
      continue;
    }

    const baseName = change.baseDisplayName || cleanBaseName(member.displayName) || member.user.username;
    const nickname = `${baseName} ${change.starCount}`.slice(0, 32);
    const changed = await member.setNickname(nickname, 'Estrelinha do jogo de frutas NOTAG')
      .then(() => true)
      .catch(() => false);
    if (!changed) failures.push(change.discordId);
  }

  return failures;
}

async function postEventSummary(client, result) {
  const channel = await client.channels.fetch(ids.channels.notagChat).catch(() => null);
  if (!channel) return null;

  return channel.send({
    embeds: [eventSummaryEmbed(result)]
  });
}

async function postDailyReportMessage(client, raffle) {
  const channel = await client.channels.fetch(ids.channels.notagChat).catch(() => null);
  if (!channel) return null;

  const top = repo.topMembers(20);
  const winnerText = raffle?.winner_id
    ? `Parabens <@${raffle.winner_id}>, voce ganhou o premio do bau numero ${raffle.chest_number}.`
    : 'Ainda nao ha participantes para o sorteio.';

  return channel.send({
    content: raffle?.winner_id ? `<@${raffle.winner_id}>` : undefined,
    embeds: [
      new EmbedBuilder()
        .setColor(0xf6ad55)
        .setTitle('NOTAG feliz - ranking diario')
        .setDescription('Top 20 acumulado de quem mais alimentou o bot.')
        .addFields(...rankingFields(top), { name: 'Sorteio surpresa', value: winnerText, inline: false })
        .setTimestamp(new Date())
    ],
    allowedMentions: { users: raffle?.winner_id ? [raffle.winner_id] : [] }
  });
}

function eventSummaryEmbed(result) {
  const lines = result.rewards.map((reward) => {
    const fruitText = fruitSummary(reward.fruits);
    return `<@${reward.discordId}>: ${fruitText} (${reward.points} ponto${reward.points === 1 ? '' : 's'})`;
  });
  const starLines = result.stars.map((star) => `<@${star.discordId}> ganhou +${star.gainedStars} estrelinha e agora tem ${star.starCount}.`);
  const renameFailureLines = (result.renameFailures || []).map((discordId) => `Nao consegui renomear <@${discordId}>, mas a estrelinha foi registrada.`);

  return new EmbedBuilder()
    .setColor(0x9f7aea)
    .setTitle('NOTAG foi alimentado')
    .setDescription(`Evento: **${result.event.title}**\n${result.event.event_code}`)
    .addFields(
      { name: 'Frutas', value: trimField(lines.join('\n') || 'Nenhuma fruta distribuida.'), inline: false },
      { name: 'Estrelinhas novas', value: trimField(starLines.join('\n') || 'Nenhuma estrelinha nova dessa vez.'), inline: false },
      { name: 'Apelidos', value: trimField(renameFailureLines.join('\n') || 'Apelidos atualizados quando necessario.'), inline: false }
    )
    .setTimestamp(new Date());
}

function rankingLines(rows) {
  return rows.map((row, index) => {
    const stars = row.star_count > 0 ? `⭐ ${row.star_count}x` : '⭐ 0x';
    return `${index + 1}. ${stars} <@${row.discord_id}> - ${row.current_points} ponto${row.current_points === 1 ? '' : 's'} restantes`;
  });
}

function rankingFields(rows) {
  if (rows.length === 0) {
    return [{ name: 'Ranking', value: 'Ninguem ganhou frutas ainda.', inline: false }];
  }

  const lines = rankingLines(rows);
  return [
    { name: 'Ranking 1-10', value: lines.slice(0, 10).join('\n'), inline: false },
    { name: 'Ranking 11-20', value: lines.slice(10, 20).join('\n') || 'Sem mais membros.', inline: false }
  ];
}

function fruitSummary(items) {
  const counts = new Map();
  for (const fruit of items) {
    counts.set(fruit.name, (counts.get(fruit.name) || 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => count > 1 ? `${count}x ${name}` : name).join(', ');
}

function fruitBlocks(seconds) {
  const minutes = Math.max(0, Number(seconds || 0) / 60);
  if (minutes < 25) return 0;
  return Math.max(1, Math.round(minutes / 30));
}

function drawFruit() {
  const roll = Math.random() * 100;
  let accumulated = 0;
  for (const fruit of fruits) {
    accumulated += fruit.chance;
    if (roll < accumulated) return fruit;
  }
  return fruits[0];
}

function cleanBaseName(name) {
  const value = String(name || '').trim();
  if (!value) return null;
  return value.replace(/\s+\d+$/, '').trim() || value;
}

function trimField(value) {
  const text = String(value || '');
  return text.length > 1024 ? `${text.slice(0, 1018)}...` : text;
}

function utcMinus3Now() {
  const shifted = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return {
    hour: shifted.getUTCHours(),
    dateKey: [
      shifted.getUTCFullYear(),
      String(shifted.getUTCMonth() + 1).padStart(2, '0'),
      String(shifted.getUTCDate()).padStart(2, '0')
    ].join('-')
  };
}

module.exports = {
  postDailyPetReport,
  rewardEventParticipants
};
