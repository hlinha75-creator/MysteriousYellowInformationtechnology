const ids = require('../config/ids');
const env = require('../config/env');
const audit = require('../modules/audit/audit.repository');
const repo = require('../modules/registration/registration.repository');

const DEFAULT_ALBION_API = 'https://gameinfo-ams.albiononline.com/api/gameinfo';

function normalizeName(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US');
}

function validateAlbionName(value) {
  const name = String(value || '').trim();
  if (name.length < 3 || name.length > 32) throw new Error('Informe um nome Albion entre 3 e 32 caracteres.');
  if (!/^[\p{L}\p{N}_'-]+$/u.test(name)) throw new Error('O nome Albion contém caracteres inválidos.');
  return name;
}

async function findAlbionCharacter(value, options = {}) {
  const requestedName = validateAlbionName(value);
  const fetchImpl = options.fetchImpl || fetch;
  const apiBase = String(options.apiBase || process.env.ALBION_API_BASE_URL || process.env.ALBION_API_BASE || DEFAULT_ALBION_API).replace(/\/$/, '');
  const response = await fetchImpl(`${apiBase}/search?q=${encodeURIComponent(requestedName)}`);
  if (!response.ok) throw new Error('A consulta ao Albion está temporariamente indisponível.');
  const search = await response.json();
  const match = (search.players || []).find((player) => normalizeName(player.Name) === normalizeName(requestedName));
  if (!match?.Id) throw new Error('Personagem não encontrado no servidor Europa do Albion.');
  return { id: match.Id, name: match.Name || requestedName };
}

function hasAnyRole(member, roleIds) {
  return roleIds.some((roleId) => roleId && member.roles?.cache?.has(roleId));
}

async function ensureGuestMember(client, discordUser, accessToken) {
  const guild = await client.guilds.fetch(ids.guildId);
  let member = await guild.members.fetch(discordUser.id).catch(() => null);
  if (!member) {
    member = await guild.members.add(discordUser.id, {
      accessToken,
      roles: ids.roles.guest ? [ids.roles.guest] : []
    });
  } else if (!hasAnyRole(member, [ids.roles.adm, ids.roles.staff, ids.roles.member, ids.roles.guest])) {
    await member.roles.add(ids.roles.guest, 'Entrada pelo site da Notag');
  }
  return member;
}

async function completeOnboarding(client, session, albionName, options = {}) {
  const character = await findAlbionCharacter(albionName, options);
  const owner = repo.findUserByAlbionName(character.name, session.id);
  if (owner) throw new Error('Esse personagem Albion já está vinculado a outra conta. Procure a staff.');

  const current = repo.getUser(session.id);
  const currentName = normalizeName(current?.albion_name);
  const requestedName = normalizeName(character.name);
  if (currentName && currentName !== requestedName && current.registration_status !== 'unregistered') {
    throw new Error(`Sua conta já possui o personagem ${current.albion_name}. Procure a staff para alterar.`);
  }

  const guild = await client.guilds.fetch(ids.guildId);
  const member = await guild.members.fetch(session.id);
  const isMember = current?.registration_status === 'member' || hasAnyRole(member, [ids.roles.member]);
  const nickname = character.name.slice(0, 32);
  if (member.nickname !== nickname) await member.setNickname(nickname, 'Personagem informado no site da Notag');

  if (!isMember) {
    if (ids.roles.noTag && member.roles.cache.has(ids.roles.noTag)) {
      await member.roles.remove(ids.roles.noTag, 'Cadastro iniciado pelo site da Notag');
    }
    if (ids.roles.guest && !member.roles.cache.has(ids.roles.guest)) {
      await member.roles.add(ids.roles.guest, 'Cadastro iniciado pelo site da Notag');
    }
  }

  const pending = repo.getPendingRegistrationForDiscord(session.id);
  const status = isMember ? 'member' : (current?.registration_status === 'guest' ? 'guest' : 'pending');
  repo.upsertUser({
    discordId: session.id,
    discordName: session.username,
    albionName: character.name,
    registrationStatus: status
  });
  if (!isMember && !pending) repo.createRegistration({ discordId: session.id, albionName: character.name });

  audit.createAuditLog({
    type: 'website_onboarding_completed',
    actorId: session.id,
    targetId: session.id,
    afterValue: character.name,
    reason: 'Cadastro concluído pelo site',
    metadata: { albionPlayerId: character.id, existingMember: isMember }
  });

  return {
    albionName: character.name,
    alreadyMember: isMember,
    voiceUrl: `https://discord.com/channels/${ids.guildId}/${ids.channels.guestVoice}`
  };
}

function onboardingConfigured() {
  return Boolean(env.token && env.discordClientId && env.discordClientSecret && env.dashboardSessionSecret && ids.roles.guest && ids.channels.guestVoice);
}

module.exports = {
  completeOnboarding,
  ensureGuestMember,
  findAlbionCharacter,
  onboardingConfigured,
  validateAlbionName
};
