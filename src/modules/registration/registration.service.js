const ids = require('../../config/ids');
const audit = require('../audit/audit.repository');
const repo = require('./registration.repository');

async function handleGuildMemberAdd(member) {
  repo.upsertUser({
    discordId: member.id,
    discordName: member.user.tag,
    registrationStatus: 'unregistered'
  });
  await member.roles.add(ids.roles.noTag).catch((error) => console.error('Falha ao adicionar Sem Tag:', error));
}

async function submitRegistration({ interaction, albionName }) {
  const member = interaction.member;
  repo.upsertUser({
    discordId: member.id,
    discordName: interaction.user.tag,
    albionName,
    registrationStatus: 'pending'
  });
  const result = repo.createRegistration({ discordId: member.id, albionName });
  await member.roles.remove(ids.roles.noTag).catch(() => {});
  await member.roles.add(ids.roles.guest).catch(() => {});
  audit.createAuditLog({
    type: 'registration_created',
    actorId: member.id,
    targetId: member.id,
    afterValue: albionName,
    reason: 'Registro enviado'
  });
  return result.lastInsertRowid;
}

async function approveRegistration({ guild, registrationId, actorId, asMember, note }) {
  const registration = repo.getRegistration(registrationId);
  if (!registration) throw new Error('Registro nao encontrado.');

  repo.updateRegistration({
    id: registrationId,
    status: asMember ? 'approved_member' : 'approved_guest',
    reviewedBy: actorId,
    note
  });
  repo.upsertUser({
    discordId: registration.discord_id,
    albionName: registration.albion_name,
    registrationStatus: asMember ? 'member' : 'guest'
  });

  const member = await guild.members.fetch(registration.discord_id).catch(() => null);
  if (member) {
    await member.roles.remove(ids.roles.noTag).catch(() => {});
    if (asMember) {
      await member.roles.remove(ids.roles.guest).catch(() => {});
      await member.roles.add(ids.roles.member).catch(() => {});
    } else {
      await member.roles.add(ids.roles.guest).catch(() => {});
    }
  }

  audit.createAuditLog({
    type: asMember ? 'registration_approved_member' : 'registration_kept_guest',
    actorId,
    targetId: registration.discord_id,
    afterValue: registration.albion_name,
    reason: note || null
  });

  return registration;
}

module.exports = {
  approveRegistration,
  handleGuildMemberAdd,
  submitRegistration
};
