const { EmbedBuilder } = require('discord.js');
const ids = require('../../config/ids');
const repository = require('./raidAvalon.repository');
const {
  RAID_BUILDS,
  ROLE_LABELS,
  ROLE_LIMITS,
  getBuildByWeapon
} = require('./raidAvalon.constants');

function validateRaidInscricao(payload) {
  const errors = [];
  const nick = cleanText(payload?.nick);
  const horarios = cleanList(payload?.horarios);
  const armas = cleanList(payload?.armas);
  const casaHoLoch = payload?.casaHoLoch === true;
  const portalMartlock = payload?.portalMartlock === true;
  const builds = armas.map((arma) => getBuildByWeapon(arma));

  if (!/^[\w .'-]{2,32}$/.test(nick)) {
    errors.push('Informe um nick valido com 2 a 32 caracteres.');
  }

  if (horarios.length === 0 || horarios.some((horario) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(horario))) {
    errors.push('Informe pelo menos um horario valido no formato HH:mm.');
  }

  if (armas.length === 0) {
    errors.push('Selecione pelo menos uma arma oficial da Raid Avalon.');
  }

  if (builds.some((build) => !build)) {
    errors.push('Todas as armas precisam ser builds oficiais da Raid Avalon.');
  }

  return {
    ok: errors.length === 0,
    errors,
    data: {
      nick,
      horarios,
      armas,
      casaHoLoch,
      portalMartlock,
      builds: builds.filter(Boolean),
      warnings: buildWarnings({ casaHoLoch, portalMartlock })
    }
  };
}

async function saveRaidInscricao(payload, options = {}) {
  const validation = validateRaidInscricao(payload);
  if (!validation.ok) return validation;

  const registration = repository.upsertRegistration(validation.data);
  const composition = buildComposition(repository.listRegistrations());

  await updateRaidMessage(options.client, composition).catch((error) => {
    console.error('Falha ao atualizar mensagem da Raid Avalon:', error);
  });

  return {
    ok: true,
    data: registration,
    composition
  };
}

function buildComposition(registrations) {
  const composition = Object.fromEntries(Object.keys(ROLE_LIMITS).map((role) => [
    role,
    { role, label: ROLE_LABELS[role], limit: ROLE_LIMITS[role], titulares: [], reserva: [] }
  ]));

  for (const registration of registrations) {
    const roles = [...new Set(registration.builds.map((build) => build.role))];
    for (const role of roles) {
      const bucket = composition[role];
      if (!bucket) continue;
      const entry = {
        nick: registration.nick,
        armas: registration.builds.filter((build) => build.role === role).map((build) => build.weapon),
        horarios: registration.horarios,
        warnings: registration.warnings
      };
      if (bucket.titulares.length < bucket.limit) {
        bucket.titulares.push(entry);
      } else {
        bucket.reserva.push(entry);
      }
    }
  }

  return {
    roles: composition,
    total: registrations.length,
    updatedAt: new Date().toISOString()
  };
}

function formatDiscordWebhookMessage(registration, composition) {
  const statusLines = Object.values(composition.roles)
    .map((role) => `${role.label}: ${role.titulares.length}/${role.limit}${role.reserva.length ? ` (+${role.reserva.length} reserva)` : ''}`)
    .join('\n');

  return {
    username: 'Inscricoes Raid Avalon',
    embeds: [
      {
        title: 'Inscricao Raid Avalon atualizada',
        color: 0x0f766e,
        fields: [
          { name: 'Nick', value: registration.nick, inline: true },
          { name: 'Horarios', value: registration.horarios.join(', '), inline: true },
          { name: 'Armas', value: registration.armas.join(', '), inline: false },
          { name: 'Avisos', value: registration.warnings.length ? registration.warnings.join('\n') : 'Nenhum aviso.', inline: false },
          { name: 'Composicao', value: statusLines || 'Sem inscritos.', inline: false }
        ],
        timestamp: new Date().toISOString()
      }
    ]
  };
}

async function updateRaidMessage(client, composition) {
  if (!client?.isReady?.()) return null;

  const channelId = process.env.RAID_AVALON_CHANNEL_ID || ids.channels.notagChat;
  if (!channelId) return null;

  const channel = await client.channels.fetch(channelId).catch((error) => {
    console.error(`Falha ao buscar canal da Raid Avalon ${channelId}:`, error);
    return null;
  });
  if (!channel?.isTextBased()) return null;

  const payload = {
    embeds: [buildCompositionEmbed(composition)]
  };
  const savedMessageId = process.env.RAID_AVALON_MESSAGE_ID || repository.getState('message_id');

  if (savedMessageId) {
    const message = await channel.messages.fetch(savedMessageId).catch(() => null);
    if (message) return message.edit(payload);
  }

  const message = await channel.send(payload);
  repository.setState('message_id', message.id);
  return message;
}

function buildCompositionEmbed(composition) {
  const embed = new EmbedBuilder()
    .setTitle('Raid Avalon - Inscricoes')
    .setColor(0x0f766e)
    .setDescription(`Composicao alvo: 3 Tank, 3 Healer, 2 Suporte, 15 DPS.\nTotal de inscritos unicos: ${composition.total}.`)
    .setTimestamp(new Date(composition.updatedAt));

  for (const role of Object.values(composition.roles)) {
    const titulares = role.titulares.length ? role.titulares.map(formatEntry).join('\n') : 'Sem titulares.';
    const reserva = role.reserva.length ? `\n\nReserva:\n${role.reserva.map(formatEntry).join('\n')}` : '';
    embed.addFields({
      name: `${role.label} (${role.titulares.length}/${role.limit})`,
      value: trimField(`${titulares}${reserva}`),
      inline: false
    });
  }

  return embed;
}

function formatEntry(entry) {
  const warnings = entry.warnings.length ? ` | ${entry.warnings.join(' | ')}` : '';
  return `**${entry.nick}** - ${entry.armas.join(', ')} - ${entry.horarios.join(', ')}${warnings}`;
}

function buildWarnings({ casaHoLoch, portalMartlock }) {
  const warnings = [];
  if (!casaHoLoch) warnings.push('Aviso: sem casa na HO Loch');
  if (!portalMartlock) warnings.push('Aviso: sem portal Martlock');
  return warnings;
}

function getRaidBuilds() {
  return RAID_BUILDS;
}

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function cleanList(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function trimField(value) {
  return value.length <= 1024 ? value : `${value.slice(0, 1018)}[...]`;
}

module.exports = {
  buildComposition,
  formatDiscordWebhookMessage,
  getRaidBuilds,
  saveRaidInscricao,
  updateRaidMessage,
  validateRaidInscricao
};
