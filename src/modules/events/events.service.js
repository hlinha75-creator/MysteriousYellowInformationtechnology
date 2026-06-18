const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits
} = require('discord.js');
const ids = require('../../config/ids');
const { transaction } = require('../../database/connection');
const audit = require('../audit/audit.repository');
const finance = require('../finance/finance.service');
const repo = require('./events.repository');
const { calculateNetLoot, calculatePayouts } = require('./lootCalculator');
const { formatSilver } = require('../../utils/silver');
const { backupDatabase } = require('../../database/backup');

const roleConfigs = {
  tank: { label: 'Tank', slots: 'tank_slots', style: ButtonStyle.Primary },
  healer: { label: 'Healer', slots: 'healer_slots', style: ButtonStyle.Success },
  support: { label: 'Suporte', slots: 'support_slots', style: ButtonStyle.Secondary },
  dps: { label: 'DPS', slots: 'dps_slots', style: ButtonStyle.Danger }
};
const eventRoles = Object.keys(roleConfigs);
const emojiRefs = {
  role: {
    tank: { name: 'Tank', id: '1517095771659436153' },
    healer: { name: 'Healer', id: '1517096201915334829' },
    support: { name: 'Support', id: '1517095620769349662' },
    dps: { name: 'DPS', id: '1517096370412982423' }
  },
  weapon: {
    martelo: { name: 'Martelo', id: '1517096973352702032' },
    incubus: { name: 'Incubus', id: '1517096493457342474' },
    quebra: { name: 'RealBreaker', id: '1517097073768665180' },
    quebra_reinos: { name: 'RealBreaker', id: '1517097073768665180' },
    hallow: { name: 'QuesaSanta', id: '1517097701148459131' },
    queda_santa: { name: 'QuesaSanta', id: '1517097701148459131' },
    fallen: { name: 'Fallen', id: '1517097839107379211' },
    raiz: { name: 'Iron', id: '1517098127490940968' },
    raiz_ferrea: { name: 'Iron', id: '1517098127490940968' },
    sc: { name: 'Shadow', id: '1517097701148459131' },
    shadow_caller: { name: 'Shadow', id: '1517097701148459131' },
    danacao: { name: 'Damnation', id: '1517097839107379211' },
    damnation: { name: 'Damnation', id: '1517097839107379211' },
    enig: { name: 'Enig', id: '1517098127490940968' },
    enigmatico: { name: 'Enig', id: '1517098127490940968' },
    aguia: { name: 'LightCaller', id: '1517098287251853312' },
    lc: { name: 'LightCaller', id: '1517098287251853312' },
    uivo_frio: { name: 'Chill', id: '1517098366155227279' },
    chill: { name: 'Chill', id: '1517098366155227279' },
    repetidor: { name: 'Repetidor', id: '1517098209749766255' }
  }
};
const raidAvalonSlots = { tank: 3, healer: 3, support: 3, dps: 11 };
const raidAvalonWeaponSlots = {
  tank: ['Martelo', 'Incubus', 'Quebra Reinos'],
  healer: ['Hallow', 'Fallen', 'Raiz'],
  support: ['SC', 'Danacao', 'Enig'],
  dps: ['Aguia', 'Uivo Frio', 'Furabruma', 'Repetidor 1', 'Repetidor 2', 'Repetidor 3', 'Repetidor 4', 'Repetidor 5', 'Repetidor 6', 'Repetidor 7', 'Repetidor 8']
};
const raidAvalonWeapons = Object.fromEntries(
  Object.entries(raidAvalonWeaponSlots).map(([role, weapons]) => [role, [...new Set(weapons)]])
);
const raidAvalonWeaponInfo = {
  martelo: {
    iconUrl: 'https://albiononlinegrind.com/images/fallback/T8_2H_HAMMER_CRYSTAL.png',
    buildUrl: 'https://prnt.sc/Y-z2-06j746K'
  },
  incubus: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_MACE_HELL.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/TU9zh2Ez58aR'
  },
  quebra_reinos: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_AXE_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/mn4C8rnsSsaY'
  },
  quebra: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_AXE_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/mn4C8rnsSsaY'
  },
  queda_santa: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_HOLYSTAFF_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/LOnzuabDHwiE'
  },
  hallow: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_HOLYSTAFF_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/LOnzuabDHwiE'
  },
  corrompido: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_HOLYSTAFF_HELL.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/J7lD2RLeVkti'
  },
  fallen: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_HOLYSTAFF_HELL.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/J7lD2RLeVkti'
  },
  raiz_ferrea: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_NATURESTAFF_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/tbnvRFhoZPaG'
  },
  raiz: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_NATURESTAFF_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/tbnvRFhoZPaG'
  },
  shadow_caller: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_CURSEDSTAFF_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/mpbQ1v8vgR-f'
  },
  sc: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_CURSEDSTAFF_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/mpbQ1v8vgR-f'
  },
  danacao: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_CURSEDSTAFF_MORGANA.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/mpbQ1v8vgR-f'
  },
  enigmatico: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_ENIGMATICSTAFF.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/sYmochYnSwfo'
  },
  enig: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_ENIGMATICSTAFF.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/sYmochYnSwfo'
  },
  repetidor: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_REPEATINGCROSSBOW_UNDEAD.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/zJhF3t_ePQIb'
  },
  aguia: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_SHAPESHIFTER_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/GPBXB_qGTYTD'
  },
  lc: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_SHAPESHIFTER_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/GPBXB_qGTYTD'
  },
  uivo_frio: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_FROSTSTAFF_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/wekmGkxwXrl0'
  },
  chill: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_FROSTSTAFF_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/wekmGkxwXrl0'
  },
  mist_repetidor: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_REPEATINGCROSSBOW_UNDEAD.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/zJhF3t_ePQIb'
  },
  mistpiercer: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_BOW_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/rMl0DPRnsss7'
  },
  furabruma: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_BOW_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/rMl0DPRnsss7'
  }
};
const raidAvalonHelpers = {
  scout: 'Scout',
  looter: 'Looter',
  uper: 'Uper'
};

function eventEmbed(event, participants = []) {
  const count = (role) => participants.filter((p) => p.role === role && !p.is_spectator).length;
  const elapsed = event.started_at ? formatDuration(Math.floor((Date.now() - Date.parse(event.started_at)) / 1000)) : '0m';
  const raidMeta = repo.getRaidAvalonEventMeta(event.id);
  const embed = new EmbedBuilder()
    .setTitle(formatEventTitle(event.title))
    .setColor(event.status === 'running' ? 0x38a169 : event.status === 'cancelled' ? 0xe53e3e : 0x3182ce)
    .setTimestamp(new Date());

  if (raidMeta) {
    const fields = [
      ...eventRoles.map((role) => ({
        name: `${roleStatsLabel(role)} ${count(role)}/${event[roleConfigs[role].slots]}`,
        value: roleOccupants(event, participants, role),
        inline: false
      })),
      { name: 'Auxiliares', value: raidHelpersSummary(participants), inline: false }
    ];
    if (event.status === 'running') {
      fields.unshift({ name: 'Tempo em andamento', value: elapsed, inline: true });
    }
    return embed
      .setTitle(raidAnnouncementTitle(raidMeta))
      .setDescription(raidAnnouncementDescription(event))
      .addFields(fields);
  }

  if (event.status === 'running') {
    return embed
      .setDescription(`**${event.description || 'Evento em andamento'}**\nCriador: <@${event.creator_id}>\n${statusLabel(event.status)} | ${event.location || 'Local nao informado'} | ${event.scheduled_time || 'Horario nao informado'}`)
      .addFields(
        { name: 'Tempo em andamento', value: elapsed, inline: true },
        { name: 'Vagas', value: eventRoles.map((role) => `${roleStatsLabel(role)} ${count(role)}/${event[roleConfigs[role].slots]}`).join(' | '), inline: false },
        { name: 'Participantes', value: runningParticipantsSummary(participants), inline: false },
        { name: 'Voz', value: event.voice_channel_id ? `<#${event.voice_channel_id}>` : 'Sala em criacao', inline: true }
      );
  }

  return embed
    .setDescription(`**${event.description || 'Sem descricao.'}**\nCriador: <@${event.creator_id}>`)
    .addFields(
      { name: 'Status', value: statusLabel(event.status), inline: true },
      { name: 'Local', value: event.location || 'Nao informado', inline: true },
      { name: 'Horario UTC', value: event.scheduled_time || 'Nao informado', inline: true },
      ...eventRoles.map((role) => ({
        name: `${roleStatsLabel(role)} ${count(role)}/${event[roleConfigs[role].slots]}`,
        value: roleOccupants(event, participants, role),
        inline: true
      })),
      ...(raidMeta ? [{ name: 'Auxiliares', value: raidHelpersSummary(participants), inline: false }] : [])
    );
}

function roleOccupants(event, participants, role) {
  if (repo.getRaidAvalonEventMeta(event.id)) {
    return raidRoleSlotsSummary(participants, role);
  }

  const users = participants
    .filter((p) => p.role === role && !p.is_spectator)
    .map((p) => raidParticipantLabel(p));
  const text = users.length > 0 ? users.join(', ') : 'Vazio';
  return text.length > 1024 ? `${text.slice(0, 1018)}...` : text;
}

function raidRoleSlotsSummary(participants, role) {
  const roleParticipants = participants.filter((p) => p.role === role && !p.is_spectator);
  const remaining = new Map();
  for (const participant of roleParticipants) {
    const raid = repo.getRaidAvalonParticipant({ eventId: participant.event_id, discordId: participant.discord_id });
    const key = weaponKey(raid?.weapon_name);
    if (!key) continue;
    if (!remaining.has(key)) remaining.set(key, []);
    remaining.get(key).push({ participant, raid });
  }

  const lines = (raidAvalonWeaponSlots[role] || []).map((weapon) => {
    const key = weaponKey(weapon);
    const match = remaining.get(key)?.shift();
    const label = `${weaponEmoji(weapon)} ${weapon}`.trim();
    if (!match) return `${label} Livre`;
    const career = repo.getRaidAvalonCareer({ discordId: match.participant.discord_id, weaponKey: match.raid.weapon_key });
    const count = career?.points || 0;
    return `${label} <@${match.participant.discord_id}> | ${match.raid.item_power || '?'} IP (${count})`;
  });

  return lines.join('\n') || 'Vazio';
}

function raidHelpersSummary(participants) {
  const helpers = participants.filter((participant) => participant.is_spectator);
  if (helpers.length === 0) return 'Vazio';
  return helpers.map((participant) => {
    const raid = repo.getRaidAvalonParticipant({ eventId: participant.event_id, discordId: participant.discord_id });
    const label = raid?.helper_role ? raidAvalonHelpers[raid.helper_role] || raid.helper_role : 'Assistir';
    return `<@${participant.discord_id}> - ${label}`;
  }).join('\n');
}

function raidParticipantLabel(participant) {
  const raid = repo.getRaidAvalonParticipant({ eventId: participant.event_id, discordId: participant.discord_id });
  if (!raid?.weapon_name && !raid?.helper_role) return `<@${participant.discord_id}>`;
  const details = [
    raid.weapon_name,
    raid.item_power ? `IP ${raid.item_power}` : null,
    raid.helper_role ? raidAvalonHelpers[raid.helper_role] || raid.helper_role : null
  ].filter(Boolean).join(' | ');
  return `<@${participant.discord_id}> - ${details}`;
}

function runningParticipantsSummary(participants) {
  const order = { tank: 1, healer: 2, support: 3, dps: 4, spectator: 5 };
  const lines = participants
    .slice()
    .sort((a, b) => (order[a.role] || 99) - (order[b.role] || 99))
    .map((participant) => {
      const role = participant.is_spectator ? 'spectator' : participant.role;
      return `${raidParticipantLabel(participant)} - ${roleLabel(role)}`;
    });

  if (lines.length === 0) return 'Nenhum participante ainda.';

  const visible = [];
  let totalLength = 0;
  for (const line of lines) {
    const nextLength = totalLength + line.length + (visible.length > 0 ? 1 : 0);
    if (nextLength > 950) break;
    visible.push(line);
    totalLength = nextLength;
  }

  const hidden = lines.length - visible.length;
  if (hidden > 0) visible.push(`... e mais ${hidden}`);
  return visible.join('\n');
}

function eventComponents(event) {
  if (!['created', 'running'].includes(event.status)) return [];

  const rows = [];
  const isRaid = isRaidAvalonEvent(event);
  if (isRaid) {
    rows.push(new ActionRowBuilder().addComponents(
      eventRoles.map((role) => new ButtonBuilder()
        .setCustomId(`event:raid_role:${event.id}:${role}`)
        .setLabel(roleButtonLabel(role))
        .setEmoji(roleButtonEmoji(role))
        .setStyle(roleConfigs[role].style))
    ));
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`event:spectate:${event.id}`).setLabel('Assistir').setStyle(ButtonStyle.Secondary),
      ...Object.entries(raidAvalonHelpers).map(([key, label]) => new ButtonBuilder()
        .setCustomId(`event:raid_helper:${event.id}:${key}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Secondary))
    ));
  } else if (event.status === 'created') {
    rows.push(new ActionRowBuilder().addComponents(
      eventRoles.map((role) => new ButtonBuilder()
        .setCustomId(`event:join_role:${event.id}:${role}`)
        .setLabel(roleButtonLabel(role))
        .setEmoji(roleButtonEmoji(role))
        .setStyle(roleConfigs[role].style))
    ));
  }

  const buttons = event.status === 'running'
    ? isRaid
    ? [
      new ButtonBuilder().setCustomId(`event:pause:${event.id}`).setLabel('Pausar participação').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`event:finish:${event.id}`).setLabel('Finalizar').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`event:cancel:${event.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
    ]
    : [
      new ButtonBuilder().setCustomId(`event:auto_join:${event.id}`).setLabel('Quero participar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`event:spectate:${event.id}`).setLabel('Assistir').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`event:pause:${event.id}`).setLabel('Pausar participação').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`event:finish:${event.id}`).setLabel('Finalizar').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`event:cancel:${event.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
    ]
    : [
      new ButtonBuilder().setCustomId(`event:start:${event.id}`).setLabel('Iniciar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`event:cancel:${event.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
    ];

  rows.push(new ActionRowBuilder().addComponents(buttons));
  return rows;
}

async function createEventFromModal(interaction, fields) {
  return createEventFromFields(interaction, {
    creatorId: interaction.user.id,
    ...fields
  });
}

async function createRaidAvalonFullFromModal(interaction, fields) {
  const event = await createEventFromFields(interaction, {
    creatorId: interaction.user.id,
    title: 'Raid Avalon Full',
    description: `Raid Avalon Full | DG ${fields.dungeonTier || 'Nao informado'} | Build ${fields.buildTier || 'Nao informado'}`,
    location: fields.location,
    scheduledTime: fields.scheduledTime,
    tankSlots: raidAvalonSlots.tank,
    healerSlots: raidAvalonSlots.healer,
    supportSlots: raidAvalonSlots.support,
    dpsSlots: raidAvalonSlots.dps
  });
  repo.createRaidAvalonEventMeta({
    eventId: event.id,
    dungeonTier: fields.dungeonTier,
    buildTier: fields.buildTier
  });
  await refreshEventMessage(interaction.client, event.id);
  return repo.getEvent(event.id);
}

async function createEventFromFields(interaction, fields) {
  const event = repo.createEvent({
    creatorId: fields.creatorId || interaction.user.id,
    title: fields.title,
    description: fields.description,
    location: fields.location,
    scheduledTime: fields.scheduledTime,
    tankSlots: fields.tankSlots,
    healerSlots: fields.healerSlots,
    supportSlots: fields.supportSlots,
    dpsSlots: fields.dpsSlots
  });

  const channel = await interaction.client.channels.fetch(ids.channels.participate);
  const message = await channel.send({
    embeds: [eventEmbed(event, [])],
    components: eventComponents(event)
  });
  repo.updateEvent(event.id, { message_id: message.id });

  audit.createAuditLog({
    type: 'event_created',
    actorId: interaction.user.id,
    targetId: String(event.id),
    afterValue: event.event_code,
    reason: 'Evento criado'
  });

  return event;
}

async function refreshEventMessage(client, eventId) {
  const event = repo.getEvent(eventId);
  if (!event?.message_id) return;
  const participants = repo.listParticipants(eventId);
  const channel = await client.channels.fetch(ids.channels.participate).catch(() => null);
  const message = await channel?.messages.fetch(event.message_id).catch(() => null);
  if (message) {
    await message.edit({ embeds: [eventEmbed(event, participants)], components: eventComponents(event) });
  }
}

async function refreshRunningEventMessages(client) {
  const events = repo.listActiveEvents();
  for (const event of events) {
    await refreshEventMessage(client, event.id).catch((error) => console.error(`Falha ao atualizar ${event.event_code}:`, error));
  }
}

async function joinEvent(interaction, eventId, role) {
  const event = repo.getEvent(eventId);
  if (!event || ['cancelled', 'approved'].includes(event.status)) throw new Error('Evento indisponivel.');
  repo.upsertParticipant({ eventId, discordId: interaction.user.id, role, isSpectator: 0 });
  audit.createAuditLog({ type: 'event_joined', actorId: interaction.user.id, targetId: String(eventId), afterValue: role });
  if (event.status === 'running') {
    await moveMemberToEventVoice(interaction, event);
  }
  await refreshEventMessage(interaction.client, eventId);
}

async function joinRaidAvalonRole(interaction, { eventId, role, weapon, itemPower }) {
  const event = repo.getEvent(eventId);
  if (!event || ['cancelled', 'approved'].includes(event.status)) throw new Error('Evento indisponivel.');
  if (!repo.getRaidAvalonEventMeta(eventId)) throw new Error('Esse evento nao e uma Raid Avalon Full.');
  const normalizedWeapon = normalizeRaidWeapon(role, weapon);
  const normalizedWeaponKey = weaponKey(normalizedWeapon);
  const occupied = repo
    .listRaidAvalonParticipants(eventId)
    .find((participant) => participant.weapon_key === normalizedWeaponKey && participant.discord_id !== interaction.user.id);
  if (occupied) throw new Error(`A vaga ${normalizedWeapon} ja esta ocupada por <@${occupied.discord_id}>.`);
  repo.upsertParticipant({ eventId, discordId: interaction.user.id, role, isSpectator: 0 });
  repo.upsertRaidAvalonParticipant({
    eventId,
    discordId: interaction.user.id,
    weaponKey: normalizedWeaponKey,
    weaponName: normalizedWeapon,
    itemPower,
    helperRole: null
  });
  audit.createAuditLog({
    type: 'raid_avalon_joined',
    actorId: interaction.user.id,
    targetId: String(eventId),
    afterValue: JSON.stringify({ role, weapon: normalizedWeapon, itemPower })
  });
  if (event.status === 'running') {
    await moveMemberToEventVoice(interaction, event);
  }
  await refreshEventMessage(interaction.client, eventId);
  return normalizedWeapon;
}

async function joinRaidAvalonHelper(interaction, eventId, helperRole) {
  const event = repo.getEvent(eventId);
  if (!event || ['cancelled', 'approved'].includes(event.status)) throw new Error('Evento indisponivel.');
  if (!repo.getRaidAvalonEventMeta(eventId)) throw new Error('Esse evento nao e uma Raid Avalon Full.');
  if (!raidAvalonHelpers[helperRole]) throw new Error('Funcao auxiliar invalida.');
  repo.upsertParticipant({ eventId, discordId: interaction.user.id, role: helperRole, isSpectator: 1 });
  repo.upsertRaidAvalonParticipant({ eventId, discordId: interaction.user.id, helperRole });
  audit.createAuditLog({ type: 'raid_avalon_helper_joined', actorId: interaction.user.id, targetId: String(eventId), afterValue: helperRole });
  if (event.status === 'running') {
    await moveMemberToEventVoice(interaction, event);
  }
  await refreshEventMessage(interaction.client, eventId);
  return raidAvalonHelpers[helperRole];
}

async function pauseParticipation(interaction, eventId) {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'running') throw new Error('Evento nao esta em andamento.');
  const participant = repo.getParticipant({ eventId, discordId: interaction.user.id });
  if (!participant || participant.is_spectator) throw new Error('Voce nao esta participando deste evento.');
  const now = new Date().toISOString();
  closeParticipantOpenSession(eventId, interaction.user.id, now);
  repo.refreshParticipantSeconds(eventId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const waiting = await interaction.guild.channels.fetch(ids.channels.waitingVoice).catch(() => null);
  if (member?.voice?.channelId === event.voice_channel_id && waiting) {
    await member.voice.setChannel(waiting).catch(() => {});
  }
  audit.createAuditLog({ type: 'event_participation_paused', actorId: interaction.user.id, targetId: String(eventId), reason: 'Pausa manual' });
  await refreshEventMessage(interaction.client, eventId);
}

async function spectateEvent(interaction, eventId) {
  const event = repo.getEvent(eventId);
  if (!event || !['created', 'running'].includes(event.status)) throw new Error('Evento nao esta aberto.');
  repo.upsertParticipant({ eventId, discordId: interaction.user.id, role: 'spectator', isSpectator: 1 });
  audit.createAuditLog({ type: 'event_spectator', actorId: interaction.user.id, targetId: String(eventId) });
  if (event.status === 'running') await moveMemberToEventVoice(interaction, event);
  await refreshEventMessage(interaction.client, eventId);
}

async function autoJoinRunningEvent(interaction, eventId) {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'running') throw new Error('Evento nao esta em andamento.');
  const existing = repo.getParticipant({ eventId, discordId: interaction.user.id });
  const role = existing && !existing.is_spectator ? existing.role : firstAvailableRole(event, repo.listParticipants(eventId));
  if (!role) throw new Error('Nao ha vagas livres neste evento. Use Assistir se quiser acompanhar.');
  await joinEvent(interaction, eventId, role);
  return role;
}

function firstAvailableRole(event, participants) {
  const order = [
    ['tank', event.tank_slots],
    ['healer', event.healer_slots],
    ['support', event.support_slots],
    ['dps', event.dps_slots]
  ];
  for (const [role, slots] of order) {
    const used = participants.filter((participant) => participant.role === role && !participant.is_spectator).length;
    if (used < slots) return role;
  }
  return null;
}

async function moveMemberToEventVoice(interaction, event) {
  if (!event.voice_channel_id) return { moved: false, reason: 'missing_voice' };
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member?.voice?.channel) return { moved: false, reason: 'not_in_voice' };
  await member.voice.setChannel(event.voice_channel_id).catch(() => {});
  return { moved: true };
}

async function startEvent(interaction, eventId) {
  const event = repo.getEvent(eventId);
  if (!event) throw new Error('Evento nao encontrado.');
  if (event.status !== 'created') throw new Error('Evento nao pode ser iniciado.');

  const voice = await interaction.guild.channels.create({
    name: eventVoiceChannelName(event),
    type: ChannelType.GuildVoice,
    parent: ids.categories.activeEvents,
    reason: `Evento ${event.event_code} iniciado`
  });

  const now = new Date().toISOString();
  repo.updateEvent(eventId, { status: 'running', voice_channel_id: voice.id, started_at: now });
  const startedEvent = repo.getEvent(eventId);
  await deleteWarningMessage(interaction.client, startedEvent).catch(() => {});
  await removeWarningRole(interaction.guild, startedEvent).catch(() => {});
  const participants = repo.listParticipants(eventId).filter((participant) => !participant.is_spectator);
  for (const participant of participants) {
    const member = await interaction.guild.members.fetch(participant.discord_id).catch(() => null);
    if (member?.voice?.channel) {
      await member.voice.setChannel(voice).catch(() => {});
      repo.startVoiceSession({ eventId, discordId: participant.discord_id, joinedAt: now });
    }
  }

  audit.createAuditLog({ type: 'event_started', actorId: interaction.user.id, targetId: String(eventId), afterValue: voice.id });
  await refreshEventMessage(interaction.client, eventId);
  return voice;
}

async function finishEvent(interaction, eventId) {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'running') throw new Error('Evento nao esta em andamento.');

  const now = new Date().toISOString();
  await closeAllOpenSessions(eventId, now);
  repo.refreshParticipantSeconds(eventId);
  repo.updateEvent(eventId, { status: 'review', ended_at: now, review_required: 1 });

  const voice = await interaction.guild.channels.fetch(event.voice_channel_id).catch(() => null);
  const waiting = await interaction.guild.channels.fetch(ids.channels.waitingVoice).catch(() => null);
  if (voice?.members && waiting) {
    for (const member of voice.members.values()) {
      await member.voice.setChannel(waiting).catch(() => {});
    }
  }
  await voice?.delete(`Evento ${event.event_code} finalizado`).catch(() => {});
  const reviewedEvent = repo.getEvent(eventId);
  await deleteWarningMessage(interaction.client, reviewedEvent).catch(() => {});
  await removeWarningRole(interaction.guild, reviewedEvent).catch(() => {});

  audit.createAuditLog({ type: 'event_finished', actorId: interaction.user.id, targetId: String(eventId) });
  await deleteEventMessage(interaction.client, eventId);
}

async function cancelEvent(interaction, eventId, reason) {
  const event = repo.getEvent(eventId);
  if (!event) throw new Error('Evento nao encontrado.');
  repo.updateEvent(eventId, { status: 'cancelled', cancel_reason: reason });
  const voice = event.voice_channel_id ? await interaction.guild.channels.fetch(event.voice_channel_id).catch(() => null) : null;
  await voice?.delete(`Evento cancelado: ${reason}`).catch(() => {});
  await deleteWarningMessage(interaction.client, event).catch(() => {});
  await removeWarningRole(interaction.guild, event).catch(() => {});
  audit.createAuditLog({ type: 'event_cancelled', actorId: interaction.user.id, targetId: String(eventId), reason });
  await deleteEventMessage(interaction.client, eventId);
}

function saveLootReview({ eventId, lootTotal, repair, silverBags, taxPercent, evidenceNotes }) {
  const netLoot = calculateNetLoot({ lootTotal, repair, silverBags, taxPercent });
  repo.refreshParticipantSeconds(eventId);

  transaction(() => {
    repo.upsertReview({ eventId, lootTotal, repair, silverBags, taxPercent, netLoot, status: 'review' });
    repo.updateReviewMetadata(eventId, { evidence_notes: evidenceNotes || null });
    recalculatePayouts(eventId);
    repo.updateEvent(eventId, { status: 'review' });
  })();

  audit.createAuditLog({
    type: 'event_review_submitted',
    targetId: String(eventId),
    afterValue: formatSilver(netLoot),
    metadata: { lootTotal, repair, silverBags, taxPercent, evidenceNotes }
  });
  return { netLoot };
}

async function createPostEventReviewSpace(interaction, eventId) {
  const event = repo.getEvent(eventId);
  if (!event) throw new Error('Evento nao encontrado.');
  const reviewChannel = await createReviewChannel(interaction.guild, eventId);
  repo.updateReviewMetadata(eventId, {
    review_channel_id: reviewChannel.id
  });
  await reviewChannel.send({
    content: [
      `Revisao do evento ${event.event_code}.`,
      'Anexe aqui o CSV do loot logger e prints complementares se precisar.',
      'Depois ajuste a participacao e clique em Enviar Financeiro.'
    ].join('\n'),
    embeds: [reviewEmbed(eventId)],
    components: reviewComponents(eventId, 'review')
  });
  return reviewChannel;
}

async function createReviewChannel(guild, eventId) {
  const event = repo.getEvent(eventId);
  const participants = repo.listParticipants(eventId).filter((participant) => !participant.is_spectator);
  const creator = await guild.members.fetch(event.creator_id).catch(() => null);
  const creatorName = creator?.displayName || `criador-${event.creator_id.slice(-4)}`;
  const name = reviewChannelName(creatorName, event.scheduled_time || event.event_code);
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    ...reviewStaffRoleIds().map((roleId) => ({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    })),
    {
      id: event.creator_id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    },
    ...participants.map((participant) => ({
      id: participant.discord_id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    }))
  ];

  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: ids.categories.activeEvents,
    permissionOverwrites: dedupeOverwrites(overwrites),
    reason: `Revisao do evento ${event.event_code}`
  });
}

async function postDpsMeterSummary(client, eventId) {
  const channel = await client.channels.fetch(ids.channels.dpsMeter).catch(() => null);
  if (!channel) return null;
  const participants = repo.listParticipants(eventId).filter((participant) => !participant.is_spectator);
  const mentions = participants.map((participant) => `<@${participant.discord_id}>`).join(' ');
  const message = await channel.send({
    content: mentions || undefined,
    embeds: [dpsMeterEmbed(eventId)],
    allowedMentions: { users: participants.map((participant) => participant.discord_id) }
  });
  repo.updateReviewMetadata(eventId, { dps_message_id: message.id });
  return message;
}

async function moveReviewChannelToClosed(client, eventId) {
  const review = repo.getReview(eventId);
  if (!review?.review_channel_id) return null;
  const channel = await client.channels.fetch(review.review_channel_id).catch(() => null);
  if (!channel) return null;
  await channel.setParent(ids.categories.closedEvents, { lockPermissions: false }).catch(() => {});
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone.id, { ViewChannel: false }).catch(() => {});
  return channel;
}

async function scheduleReviewChannelDeletion(client, eventId, hours = 14) {
  const review = repo.getReview(eventId);
  if (!review?.review_channel_id) return;
  const deleteAfter = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  repo.updateReviewMetadata(eventId, { review_channel_delete_after: deleteAfter });
  await cleanupExpiredReviewChannels(client);
}

async function cleanupExpiredReviewChannels(client) {
  const expired = repo.listExpiredReviewChannels(new Date().toISOString());
  for (const review of expired) {
    const channel = await client.channels.fetch(review.review_channel_id).catch(() => null);
    await channel?.delete(`Revisao ${review.event_code} expirada apos aprovacao financeira`).catch(() => {});
    repo.updateReviewMetadata(review.event_id, {
      review_channel_id: null,
      review_channel_delete_after: null
    });
  }
}

function recalculatePayouts(eventId) {
  const review = repo.getReview(eventId);
  if (!review) throw new Error('Revisao do evento nao encontrada.');
  const participants = repo.listParticipants(eventId);
  const payouts = calculatePayouts({ participants, netLoot: review.net_loot });
  repo.clearParticipantPayouts(eventId);
  for (const payout of payouts) {
    repo.setParticipantPayout({ eventId, discordId: payout.discordId, payoutAmount: payout.payout });
  }
  return payouts;
}

function editParticipantReview({ eventId, actorId, discordId, role, minutes, reason }) {
  const before = repo.getParticipant({ eventId, discordId });
  if (!before) throw new Error('Participante nao encontrado neste evento.');
  const manualSeconds = Math.max(0, Math.round(minutes * 60));
  repo.setParticipantReview({ eventId, discordId, role, manualSeconds });
  const payouts = recalculatePayouts(eventId);
  audit.createAuditLog({
    type: 'event_participation_edited',
    actorId,
    targetId: discordId,
    beforeValue: JSON.stringify({ role: before.role, seconds: before.manual_seconds ?? before.calculated_seconds }),
    afterValue: JSON.stringify({ role, seconds: manualSeconds }),
    reason,
    metadata: { eventId, payouts }
  });
}

function addParticipantReview({ eventId, actorId, discordId, role, minutes, reason }) {
  const before = repo.getParticipant({ eventId, discordId });
  const manualSeconds = Math.max(0, Math.round(minutes * 60));
  repo.upsertParticipant({ eventId, discordId, role, isSpectator: 0 });
  repo.setParticipantReview({ eventId, discordId, role, manualSeconds });
  const payouts = recalculatePayouts(eventId);
  audit.createAuditLog({
    type: before ? 'event_participation_readded' : 'event_participation_added',
    actorId,
    targetId: discordId,
    beforeValue: before ? JSON.stringify(before) : null,
    afterValue: JSON.stringify({ role, seconds: manualSeconds }),
    reason,
    metadata: { eventId, payouts }
  });
}

function removeParticipantReview({ eventId, actorId, discordId, reason }) {
  const before = repo.getParticipant({ eventId, discordId });
  if (!before) throw new Error('Participante nao encontrado neste evento.');
  repo.removeParticipant({ eventId, discordId });
  const payouts = recalculatePayouts(eventId);
  audit.createAuditLog({
    type: 'event_participation_removed',
    actorId,
    targetId: discordId,
    beforeValue: JSON.stringify(before),
    reason,
    metadata: { eventId, payouts }
  });
}

function submitEventToFinance({ eventId, actorId }) {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'review') throw new Error('Evento nao esta em revisao.');
  recalculatePayouts(eventId);
  repo.updateEvent(eventId, { status: 'pending_payment' });
  const review = repo.getReview(eventId);
  if (review) {
    repo.upsertReview({
      eventId,
      lootTotal: review.loot_total,
      repair: review.repair,
      silverBags: review.silver_bags,
      taxPercent: review.tax_percent,
      netLoot: review.net_loot,
      status: 'pending_approval'
    });
  }
  audit.createAuditLog({ type: 'event_submitted_to_finance', actorId, targetId: String(eventId), reason: event.event_code });
}

const approveEventPayment = transaction(({ eventId, actorId }) => {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'pending_payment') throw new Error('Evento nao esta pendente de pagamento.');
  backupDatabase('before_event_payment');
  const participants = repo.listParticipants(eventId).filter((participant) => !participant.is_spectator && participant.payout_amount > 0);
  const transactions = [];
  for (const participant of participants) {
    const item = {
      type: 'event_payout',
      userId: participant.discord_id,
      amount: participant.payout_amount,
      reason: `Pagamento do evento ${event.event_code}`,
      referenceType: 'event',
      referenceId: String(event.id),
      createdBy: actorId
    };
    const result = finance.applyBalanceTransaction(item);
    transactions.push(result);
  }
  repo.updateEvent(eventId, { status: 'approved' });
  repo.markReviewApproved({ eventId, approvedBy: actorId });
  audit.createAuditLog({ type: 'event_payment_approved', actorId, targetId: String(eventId), reason: event.event_code });
  return transactions;
});

async function deleteEventMessage(client, eventId) {
  const event = repo.getEvent(eventId);
  if (!event?.message_id) return;
  const channel = await client.channels.fetch(ids.channels.participate).catch(() => null);
  const message = await channel?.messages.fetch(event.message_id).catch(() => null);
  await message?.delete().catch(() => {});
}

function reviewEmbed(eventId) {
  const event = repo.getEvent(eventId);
  const review = repo.getReview(eventId);
  repo.refreshParticipantSeconds(eventId);
  const participants = repo.listParticipants(eventId).filter((participant) => !participant.is_spectator);
  const lines = participants.map((participant) => {
    const seconds = participant.manual_seconds ?? participant.calculated_seconds ?? 0;
    return `${raidParticipantLabel(participant)} | ${roleLabel(participant.role)} | ${formatDuration(seconds)} | ${formatSilver(participant.payout_amount)}`;
  });
  const finalizedBy = review?.approved_by ? `<@${review.approved_by}>` : 'desconhecido';
  const help = event.status === 'approved'
    ? `Finalizado por ${finalizedBy}.`
    : event.status === 'pending_payment'
    ? 'Aguardando staff/tesoureiro/adm aprovar o pagamento.'
    : [
      'Editar membro: escolha alguem na lista e ajuste funcao/tempo.',
      'Adicionar membro: coloca alguem que faltou no split.',
      'Remover membro: escolha alguem na lista para tirar do split.',
      'Tempo sempre em minutos. Ex: 75 = 1h15min.'
    ].join('\n');

  return new EmbedBuilder()
    .setTitle(event.status === 'approved' ? 'Evento finalizado' : event.status === 'pending_payment' ? 'Pagamento pendente' : 'Revisao de participacao')
    .setDescription(`**${formatEventTitle(event.title)}**\n${event.event_code}`)
    .addFields(
      { name: 'Loot liquido', value: formatSilver(review?.net_loot || 0), inline: true },
      { name: 'Evidencias', value: review?.evidence_notes || 'Anexe/cole DPS meter, fama total e CSV do loot logger no canal de revisao.', inline: false },
      { name: event.status === 'approved' ? 'Status' : 'Como ajustar', value: help, inline: false },
      { name: 'Participantes', value: lines.length ? lines.slice(0, 20).join('\n') : 'Nenhum participante com tempo contabilizado.', inline: false }
    )
    .setColor(0xd69e2e)
    .setTimestamp(new Date());
}

function reviewComponents(eventId, mode = 'review') {
  if (mode === 'finance') {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`event:approve:${eventId}`).setLabel('Aprovar pagamento').setStyle(ButtonStyle.Success)
      )
    ];
  }

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`event_review:edit:${eventId}`).setLabel('Editar membro').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`event_review:add:${eventId}`).setLabel('Adicionar membro').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`event_review:remove:${eventId}`).setLabel('Remover membro').setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`event_review:submit:${eventId}`).setLabel('Enviar Financeiro').setStyle(ButtonStyle.Secondary)
    )
  ];
}

function formatDuration(seconds) {
  const value = Number(seconds || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m`;
}

function dpsMeterEmbed(eventId) {
  const event = repo.getEvent(eventId);
  const review = repo.getReview(eventId);
  repo.refreshParticipantSeconds(eventId);
  const participants = repo.listParticipants(eventId).filter((participant) => !participant.is_spectator);
  const lines = participants.map((participant) => {
    const seconds = participant.manual_seconds ?? participant.calculated_seconds ?? 0;
    return `${raidParticipantLabel(participant)} | ${roleLabel(participant.role)} | ${formatDuration(seconds)}`;
  });
  return new EmbedBuilder()
    .setTitle(`RESUMO DPS/FAMA - ${formatEventTitle(event.title)}`)
    .setDescription(event.event_code)
    .addFields(
      { name: 'Criador', value: `<@${event.creator_id}>`, inline: true },
      { name: 'Horario', value: event.scheduled_time || 'Nao informado', inline: true },
      { name: 'Loot liquido', value: formatSilver(review?.net_loot || 0), inline: true },
      { name: 'Evidencias', value: review?.evidence_notes || 'Aguardando prints/links/CSV no canal de revisao.', inline: false },
      { name: 'Participantes', value: lines.length ? lines.slice(0, 30).join('\n') : 'Nenhum participante.', inline: false }
    )
    .setColor(0x805ad5)
    .setTimestamp(new Date());
}

function reviewChannelName(creatorName, timeText) {
  const raw = `${creatorName}-${timeText}`.toLowerCase();
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'evento-pendente';
}

function reviewStaffRoleIds() {
  return [ids.roles.staff, ids.roles.adm, ids.roles.treasurer].filter(Boolean);
}

function dedupeOverwrites(overwrites) {
  const seen = new Set();
  return overwrites.filter((overwrite) => {
    if (!overwrite.id || seen.has(overwrite.id)) return false;
    seen.add(overwrite.id);
    return true;
  });
}

function roleLabel(role) {
  const labels = {
    tank: `${roleEmoji('tank')} Tank`,
    healer: `${roleEmoji('healer')} Healer`,
    support: `${roleEmoji('support')} Suporte`,
    dps: `${roleEmoji('dps')} DPS`,
    spectator: '👁️ Espectador',
    scout: 'Scout',
    looter: 'Looter',
    uper: 'Uper'
  };
  return labels[role] || role;
}

function roleStatsLabel(role) {
  const labels = {
    tank: `${roleEmoji('tank')} Tank`,
    healer: `${roleEmoji('healer')} Healer`,
    support: `${roleEmoji('support')} Suporte`,
    dps: `${roleEmoji('dps')} DPS`
  };
  return labels[role] || roleLabel(role);
}

function roleButtonLabel(role) {
  const labels = {
    tank: 'Tank',
    healer: 'Healer',
    support: 'Suporte',
    dps: 'DPS'
  };
  return labels[role] || role;
}

function roleButtonEmoji(role) {
  return emojiRefs.role[role] || undefined;
}

function formatEventTitle(title) {
  return String(title || 'EVENTO').toLocaleUpperCase('pt-BR');
}

function roleEmoji(role) {
  return formatCustomEmoji(emojiRefs.role[role]) || roleConfigs[role]?.label || role;
}

function weaponEmoji(weapon) {
  const key = raidWeaponInfoKey(null, weapon);
  return formatCustomEmoji(emojiRefs.weapon[key]) || '';
}

function formatCustomEmoji(ref) {
  if (!ref?.name || !ref?.id) return '';
  return `<:${ref.name}:${ref.id}>`;
}

function raidAnnouncementTitle(raidMeta) {
  const dungeon = raidMeta?.dungeon_tier || '?';
  const build = raidMeta?.build_tier || '?';
  return `RAID FULL ${dungeon} COM BUILD ${build}`.toLocaleUpperCase('pt-BR');
}

function raidAnnouncementDescription(event) {
  return [
    `<@${event.creator_id}> · ${formatRaidSchedule(event.scheduled_time)}`,
    `We mass from ${event.location || 'local nao informado'}`,
    'Obs: Se tem duvida ou precisa de build vem 30 min cedo pro PORTAL DE MARTLOCK.'
  ].join('\n');
}

function formatRaidSchedule(value) {
  const time = String(value || '').trim() || 'horario nao informado';
  const startAt = parseUtcMinus3EventTime(time);
  if (!startAt) return time;
  const diffMs = startAt.getTime() - Date.now();
  const absMinutes = Math.max(0, Math.round(Math.abs(diffMs) / 60000));
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  const relative = hours > 0
    ? `${hours} hora${hours === 1 ? '' : 's'}${minutes ? ` e ${minutes} min` : ''}`
    : `${minutes} min`;
  return `Hoje as ${time} (${diffMs >= 0 ? 'em' : 'ha'} ${relative})`;
}

function isRaidAvalonEvent(event) {
  return Boolean(event?.id && repo.getRaidAvalonEventMeta(event.id));
}

function weaponKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function normalizeRaidWeapon(role, value) {
  const typed = String(value || '').replace(/\s+/g, ' ').trim();
  if (!typed) throw new Error('Informe a arma usada na Raid Avalon.');
  const allowed = raidAvalonWeapons[role] || [];
  const match = allowed.find((weapon) => weaponKey(weapon) === weaponKey(typed));
  return match || typed;
}

function raidWeaponSuggestions(role) {
  return (raidAvalonWeapons[role] || []).join(', ') || 'Arma';
}

function raidWeaponOptions(role) {
  return (raidAvalonWeapons[role] || []).map((weapon) => ({
    label: weapon,
    value: weaponKey(weapon)
  }));
}

function raidWeaponRoleOptions(eventId, role, discordId) {
  const occupied = new Map();
  for (const participant of repo.listRaidAvalonParticipants(eventId)) {
    if (participant.weapon_key) occupied.set(participant.weapon_key, participant.discord_id);
  }

  return (raidAvalonWeaponSlots[role] || []).map((weapon) => {
    const key = weaponKey(weapon);
    const owner = occupied.get(key);
    if (owner && owner !== discordId) return null;
    return {
      label: weapon,
      value: key,
      description: owner === discordId ? 'Sua vaga atual' : 'Livre'
    };
  }).filter(Boolean);
}

function raidWeaponSlotOptions(eventId, discordId) {
  const occupied = new Map();
  for (const participant of repo.listRaidAvalonParticipants(eventId)) {
    if (participant.weapon_key) occupied.set(participant.weapon_key, participant.discord_id);
  }

  return eventRoles.flatMap((role) => (raidAvalonWeaponSlots[role] || []).map((weapon) => {
    const key = weaponKey(weapon);
    const owner = occupied.get(key);
    if (owner && owner !== discordId) return null;
    return {
      label: weapon,
      value: `${role}|${key}`,
      description: owner === discordId ? `${roleButtonLabel(role)} - sua vaga atual` : `${roleButtonLabel(role)} - livre`
    };
  })).filter(Boolean);
}

function raidWeaponName(role, key) {
  const match = (raidAvalonWeapons[role] || []).find((weapon) => weaponKey(weapon) === key);
  if (!match) throw new Error('Arma invalida para essa funcao.');
  return match;
}

function raidWeaponBuildUrl(role, keyOrName) {
  const key = raidWeaponInfoKey(role, keyOrName);
  return raidAvalonWeaponInfo[key]?.buildUrl || null;
}

function raidWeaponIconUrl(role, keyOrName) {
  const key = raidWeaponInfoKey(role, keyOrName);
  return raidAvalonWeaponInfo[key]?.iconUrl || null;
}

function raidWeaponInfoKey(role, keyOrName) {
  const rawKey = weaponKey(keyOrName);
  if (/^repetidor_\d+$/.test(rawKey)) return 'repetidor';
  const byKnownWeapon = (raidAvalonWeapons[role] || []).find((weapon) => weaponKey(weapon) === rawKey);
  return weaponKey(byKnownWeapon || keyOrName);
}

async function grantRaidAvalonRewards({ guild, eventId }) {
  if (!repo.getRaidAvalonEventMeta(eventId)) return { granted: 0, points: 0, skipped: 0 };
  const participants = repo.listParticipants(eventId).filter((participant) => !participant.is_spectator);
  let granted = 0;
  let points = 0;
  let skipped = 0;

  for (const participant of participants) {
    const raid = repo.getRaidAvalonParticipant({ eventId, discordId: participant.discord_id });
    if (!raid?.weapon_key || !raid?.weapon_name) {
      skipped += 1;
      continue;
    }

    const member = await guild.members.fetch(participant.discord_id).catch(() => null);
    if (!member) {
      skipped += 1;
      continue;
    }

    const roleName = `Raid Avalon - ${raid.weapon_name}`;
    let role = guild.roles.cache.find((item) => item.name.toLowerCase() === roleName.toLowerCase());
    if (!role) {
      role = await guild.roles.create({ name: roleName, mentionable: false, reason: `Tag da arma ${raid.weapon_name} na Raid Avalon` }).catch(() => null);
    }
    if (!role) {
      skipped += 1;
      continue;
    }

    const alreadyHadTag = member.roles.cache.has(role.id);
    if (role && !alreadyHadTag) {
      const added = await member.roles.add(role, `Completou Raid Avalon com ${raid.weapon_name}`).then(() => true).catch(() => false);
      if (!added) {
        skipped += 1;
        continue;
      }
      granted += 1;
    }
    if (alreadyHadTag) points += 1;

    repo.upsertRaidAvalonCareer({
      discordId: participant.discord_id,
      weaponKey: raid.weapon_key,
      weaponName: raid.weapon_name,
      roleId: role?.id,
      addPoint: alreadyHadTag
    });
  }

  await refreshRaidAvalonCareerPanel(guild.client).catch(() => {});
  return { granted, points, skipped };
}

async function refreshRaidAvalonCareerPanel(client) {
  const channel = await client.channels.fetch(ids.channels.adminPanel).catch(() => null);
  if (!channel) return null;
  const rows = repo.listRaidAvalonCareer(30);
  const lines = rows.map((row, index) => `${index + 1}. <@${row.discord_id}> | ${row.weapon_name} | ${row.points} ponto(s)`);
  return channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle('Raid Avalon - carreira por arma')
        .setDescription(lines.length ? lines.join('\n') : 'Nenhum ponto registrado ainda.')
        .setColor(0x805ad5)
        .setTimestamp(new Date())
    ]
  });
}

function statusLabel(status) {
  const labels = {
    created: '🟢 Aberto',
    running: '🟢 Em andamento',
    review: '🟡 Em revisao',
    pending_payment: '🟡 Pendente financeiro',
    approved: '✅ Finalizado',
    cancelled: '🔴 Cancelado'
  };
  return labels[status] || status;
}

function eventVoiceChannelName(event) {
  const title = formatEventTitle(event.title).replace(/\s+/g, ' ').trim();
  if (!title) return event.event_code;
  return title.slice(0, 90);
}

async function closeAllOpenSessions(eventId, leftAt) {
  const event = repo.getEvent(eventId);
  if (!event) return;
  const participants = repo.listParticipants(eventId);
  for (const participant of participants) {
    closeParticipantOpenSession(eventId, participant.discord_id, leftAt);
  }
}

function closeParticipantOpenSession(eventId, discordId, leftAt) {
  const open = repo.getOpenVoiceSession({ eventId, discordId });
  if (open) {
    const seconds = Math.max(0, Math.floor((Date.parse(leftAt) - Date.parse(open.joined_at)) / 1000));
    repo.closeOpenVoiceSession({ eventId, discordId, leftAt, seconds });
  }
}

async function checkEventStartWarnings(client) {
  const events = repo.listPendingWarningEvents();
  for (const event of events) {
    const startAt = parseUtcMinus3EventTime(event.scheduled_time);
    if (!startAt) continue;
    const msUntilStart = startAt.getTime() - Date.now();
    if (msUntilStart > 60000 || msUntilStart < -60000) continue;
    await sendEventStartWarning(client, event).catch((error) => console.error(`Falha ao avisar ${event.event_code}:`, error));
  }
}

async function sendEventStartWarning(client, event) {
  const guild = await client.guilds.fetch(ids.guildId);
  const participants = repo.listParticipants(event.id).filter((participant) => !participant.is_spectator);
  if (participants.length === 0) {
    repo.updateEvent(event.id, { warning_sent: 1 });
    return;
  }

  const role = await guild.roles.create({
    name: `Evento ${event.event_code}`,
    mentionable: true,
    reason: `Aviso temporario do evento ${event.event_code}`
  });

  for (const participant of participants) {
    const member = await guild.members.fetch(participant.discord_id).catch(() => null);
    await member?.roles.add(role).catch(() => {});
  }

  const channel = await client.channels.fetch(ids.channels.participate);
  const message = await channel.send(`${role} falta 1 minuto para o evento **${formatEventTitle(event.title)}** começar. O evento nao inicia automaticamente; aguardem o criador iniciar.`);
  repo.updateEvent(event.id, { warning_role_id: role.id, warning_message_id: message.id, warning_sent: 1 });
  audit.createAuditLog({ type: 'event_start_warning_sent', targetId: String(event.id), afterValue: role.id, reason: event.event_code });
}

async function deleteWarningMessage(client, event) {
  if (!event?.warning_message_id) return;
  const channel = await client.channels.fetch(ids.channels.participate).catch(() => null);
  const message = await channel?.messages.fetch(event.warning_message_id).catch(() => null);
  await message?.delete().catch(() => {});
  repo.updateEvent(event.id, { warning_message_id: null });
}

async function removeWarningRole(guild, event) {
  if (!event?.warning_role_id) return;
  const role = await guild.roles.fetch(event.warning_role_id).catch(() => null);
  await role?.delete(`Removendo cargo temporario do evento ${event.event_code}`).catch(() => {});
  repo.updateEvent(event.id, { warning_role_id: null });
}

function parseUtcMinus3EventTime(value) {
  const text = String(value || '').trim();
  const match = text.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const now = new Date();
  const utcMinus3Now = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const year = utcMinus3Now.getUTCFullYear();
  const month = utcMinus3Now.getUTCMonth();
  const day = utcMinus3Now.getUTCDate();
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const startUtc = new Date(Date.UTC(year, month, day, hour + 3, minute, 0));
  return startUtc;
}

module.exports = {
  approveEventPayment,
  addParticipantReview,
  autoJoinRunningEvent,
  cancelEvent,
  checkEventStartWarnings,
  cleanupExpiredReviewChannels,
  createPostEventReviewSpace,
  createEventFromFields,
  createEventFromModal,
  createRaidAvalonFullFromModal,
  deleteEventMessage,
  editParticipantReview,
  finishEvent,
  grantRaidAvalonRewards,
  joinEvent,
  joinRaidAvalonHelper,
  joinRaidAvalonRole,
  pauseParticipation,
  postDpsMeterSummary,
  raidWeaponBuildUrl,
  raidWeaponIconUrl,
  raidWeaponName,
  raidWeaponOptions,
  raidWeaponRoleOptions,
  raidWeaponSlotOptions,
  raidWeaponSuggestions,
  refreshEventMessage,
  refreshRunningEventMessages,
  removeParticipantReview,
  reviewComponents,
  reviewEmbed,
  saveLootReview,
  scheduleReviewChannelDeletion,
  moveReviewChannelToClosed,
  submitEventToFinance,
  spectateEvent,
  startEvent
};
