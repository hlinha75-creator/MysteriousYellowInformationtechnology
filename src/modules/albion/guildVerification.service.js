const { AttachmentBuilder } = require('discord.js');
const env = require('../../config/env');
const ids = require('../../config/ids');
const registrationRepo = require('../registration/registration.repository');

const STATUS = {
  ok: 'OK',
  outsideGuild: 'FORA_DA_GUILD',
  notFound: 'NAO_ENCONTRADO',
  apiError: 'ERRO_API',
  roleMismatch: 'CARGO_DIVERGENTE'
};

const REQUEST_TIMEOUT_MS = 10000;
const VERIFY_CONCURRENCY = 4;

function memberAlbionName(member) {
  return String(member?.nickname || member?.displayName || member?.user?.username || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function sameName(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

function hasMemberRole(member) {
  return Boolean(member?.roles?.cache?.has(ids.roles.member));
}

function guildMatches(player) {
  return sameName(player.guildName, env.albionGuildName);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Albion API respondeu ${response.status}`);
    }
    return response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Albion API demorou demais para responder');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function searchPlayerByName(name) {
  const url = `${env.albionApiBaseUrl}/search?q=${encodeURIComponent(name)}`;
  const data = await fetchJson(url);
  const players = Array.isArray(data?.players) ? data.players : [];
  const exact = players.find((player) => sameName(player.Name, name) || sameName(player.name, name));
  const match = exact;
  if (!match) return null;

  const id = match.Id || match.id;
  if (!id) {
    return normalizePlayer(match);
  }

  try {
    const details = await fetchJson(`${env.albionApiBaseUrl}/players/${encodeURIComponent(id)}`);
    return normalizePlayer({ ...match, ...details, Id: id });
  } catch {
    return normalizePlayer(match);
  }
}

function normalizePlayer(player) {
  if (!player) return null;
  return {
    id: player.Id || player.id || null,
    name: player.Name || player.name || null,
    guildId: player.GuildId || player.guildId || null,
    guildName: player.GuildName || player.guildName || null,
    allianceName: player.AllianceName || player.allianceName || null
  };
}

async function verifyDiscordMember(member) {
  const guessedName = memberAlbionName(member);
  if (!guessedName) {
    return {
      discordId: member.id,
      discordTag: member.user?.tag || member.user?.username || member.id,
      guessedName,
      status: STATUS.notFound,
      player: null,
      hasMemberRole: hasMemberRole(member),
      expectedGuild: env.albionGuildName,
      reason: 'Sem apelido/nome para consultar.'
    };
  }

  let player;
  try {
    player = await searchPlayerByName(guessedName);
  } catch (error) {
    return {
      discordId: member.id,
      discordTag: member.user?.tag || member.user?.username || member.id,
      guessedName,
      status: STATUS.apiError,
      player: null,
      hasMemberRole: hasMemberRole(member),
      expectedGuild: env.albionGuildName,
      reason: error.message
    };
  }

  if (!player) {
    return {
      discordId: member.id,
      discordTag: member.user?.tag || member.user?.username || member.id,
      guessedName,
      status: STATUS.notFound,
      player: null,
      hasMemberRole: hasMemberRole(member),
      expectedGuild: env.albionGuildName,
      reason: 'Personagem nao encontrado.'
    };
  }

  const inGuild = guildMatches(player);
  const hasRole = hasMemberRole(member);
  const status = inGuild
    ? hasRole ? STATUS.ok : STATUS.roleMismatch
    : hasRole ? STATUS.roleMismatch : STATUS.outsideGuild;

  return {
    discordId: member.id,
    discordTag: member.user?.tag || member.user?.username || member.id,
    guessedName,
    status,
    player,
    hasMemberRole: hasRole,
    expectedGuild: env.albionGuildName,
    reason: inGuild ? null : `Guild atual: ${player.guildName || 'sem guild'}`
  };
}

async function verifyGuildMembers(guild, { notifyMissing = true } = {}) {
  const members = await guild.members.fetch();
  const users = members.filter((member) => !member.user.bot);
  const results = [];
  const queue = Array.from(users.values());

  for (let index = 0; index < queue.length; index += VERIFY_CONCURRENCY) {
    const chunk = queue.slice(index, index + VERIFY_CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map((member) => verifyDiscordMember(member)));
    results.push(...chunkResults);

    if (notifyMissing) {
      await Promise.all(chunkResults.map((result, resultIndex) => {
        if (result.status !== STATUS.notFound) return null;
        return notifyNickConfirmation(chunk[resultIndex], result).catch(() => {});
      }));
    }
  }

  return results;
}

async function notifyNickConfirmation(member, result) {
  registrationRepo.upsertUser({
    discordId: member.id,
    discordName: member.user?.tag || member.user?.username || member.id,
    albionName: null,
    registrationStatus: 'unregistered'
  });

  await member.send([
    `Oi! Nao consegui encontrar seu personagem no Albion usando o nome do Discord: ${result.guessedName || 'sem nome'}.`,
    `Se esse nao for seu nick exato no jogo, use /registro no servidor ou clique em Registrar Nick para confirmar.`
  ].join('\n'));
}

function summarizeResults(results) {
  const counts = {
    ok: results.filter((item) => item.status === STATUS.ok).length,
    outsideGuild: results.filter((item) => item.status === STATUS.outsideGuild).length,
    notFound: results.filter((item) => item.status === STATUS.notFound).length,
    apiError: results.filter((item) => item.status === STATUS.apiError).length,
    roleMismatch: results.filter((item) => item.status === STATUS.roleMismatch).length
  };

  return [
    `Verificacao da guild ${env.albionGuildName}`,
    '',
    `OK: ${counts.ok}`,
    `Fora da guild: ${counts.outsideGuild}`,
    `Nao encontrados: ${counts.notFound}`,
    `Cargo divergente: ${counts.roleMismatch}`,
    `Erro API: ${counts.apiError}`
  ].join('\n');
}

function resultLine(result) {
  const guildName = result.player?.guildName || 'sem guild';
  const playerName = result.player?.name || result.guessedName || 'desconhecido';
  return `<@${result.discordId}> | ${playerName} | ${result.status} | ${guildName}`;
}

function importantLines(results, limit = 15) {
  const important = results
    .filter((item) => item.status !== STATUS.ok)
    .slice(0, limit)
    .map(resultLine);
  return important.length ? important.join('\n') : 'Nenhuma divergencia encontrada.';
}

function csvAttachment(results) {
  const header = ['discord_id', 'discord_tag', 'nome_usado', 'albion_name', 'guild', 'cargo_membro', 'status', 'motivo'];
  const rows = results.map((result) => [
    result.discordId,
    result.discordTag,
    result.guessedName,
    result.player?.name || '',
    result.player?.guildName || '',
    result.hasMemberRole ? 'sim' : 'nao',
    result.status,
    result.reason || ''
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map(csvCell).join(','))
    .join('\n');
  return new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: 'verificacao_guild.csv' });
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

module.exports = {
  STATUS,
  csvAttachment,
  importantLines,
  resultLine,
  summarizeResults,
  verifyDiscordMember,
  verifyGuildMembers
};
