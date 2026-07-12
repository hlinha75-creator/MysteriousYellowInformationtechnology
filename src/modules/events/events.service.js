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
const campaigns = require('../campaigns/campaigns.service');
const repo = require('./events.repository');
const { calculateNetLoot, calculatePayouts } = require('./lootCalculator');
const { formatSilver } = require('../../utils/silver');
const { backupDatabase } = require('../../database/backup');
const { normalizeAllowedMentions, safeSend } = require('../../utils/discord');

const roleConfigs = {
  tank: { label: 'Tank', slots: 'tank_slots', style: ButtonStyle.Primary },
  healer: { label: 'Healer', slots: 'healer_slots', style: ButtonStyle.Success },
  support: { label: 'Suporte', slots: 'support_slots', style: ButtonStyle.Secondary },
  dps: { label: 'DPS', slots: 'dps_slots', style: ButtonStyle.Danger }
};
const eventRoles = Object.keys(roleConfigs);
const eventReminderDeleteAfterMs = 5 * 60 * 1000;
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
    hallow: { name: 'QuesaSanta', id: '1481801328161329152' },
    queda_santa: { name: 'QuesaSanta', id: '1481801328161329152' },
    fallen: { name: 'Fallen', id: '1517097238336110742' },
    raiz: { name: 'Iron', id: '1517097588518813767' },
    raiz_ferrea: { name: 'Iron', id: '1517097588518813767' },
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
    furabruma: { name: 'Furabruma', id: '1517189201232138240' },
    repetidor: { name: 'Repetidor', id: '1517098209749766255' }
  }
};
const raidAvalonSlots = { tank: 3, healer: 3, support: 3, dps: 11 };
const raidAvalonWeaponSlots = {
  tank: ['Martelo', 'Incubus', 'Quebra Reinos'],
  healer: ['Fallen', 'Raiz', 'Hallow'],
  support: ['SC', 'Enig', 'Danacao'],
  dps: ['Aguia', 'Uivo Frio', 'Furabruma', 'Repetidor 1', 'Repetidor 2', 'Repetidor 3', 'Repetidor 4', 'Repetidor 5', 'Repetidor 6', 'Repetidor 7', 'Repetidor 8']
};
const raidAvalonUnlockRules = {
  raiz: 6,
  quebra_reinos: 7,
  danacao: 8,
  hallow: 9
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
const defaultFunctionByRole = {
  tank: 'Incubus',
  healer: 'Hallow',
  support: 'SC',
  dps: 'Furabruma'
};
const careerCategories = {
  tank: { key: 'classe_tank', name: 'Tank' },
  healer: { key: 'classe_healer', name: 'Healer' },
  support: { key: 'classe_support', name: 'Suporte' },
  dps: { key: 'classe_dps', name: 'DPS' },
  caller: { key: 'classe_caller', name: 'Caller' }
};
const careerHelperCategories = {
  scout: 'support',
  looter: 'support'
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
      .setTitle(null)
      .setDescription(commonEventAnnouncement(event, participants, { running: true, elapsed }))
      .addFields(
        { name: 'Voz', value: event.voice_channel_id ? `<#${event.voice_channel_id}>` : 'Sala em criacao', inline: true }
      );
  }

  return embed
    .setTitle(null)
    .setDescription(commonEventAnnouncement(event, participants));
}

function commonEventAnnouncement(event, participants, options = {}) {
  const title = formatEventTitle(event.title).toUpperCase();
  const totalSlots = eventRoles.reduce((total, role) => total + Number(event[roleConfigs[role].slots] || 0), 0);
  const active = participants.filter((participant) => !participant.is_spectator);
  const spectators = participants.filter((participant) => participant.is_spectator);
  const filled = active.length;
  const timing = options.running
    ? `em andamento - ${options.elapsed || '0m'}`
    : eventTimeLabel(event.scheduled_time);
  const lines = [
    `## ${eventEmoji(event)} ${title}${timing ? ` (${timing})` : ''}`,
    '',
    `**Local:** ${event.location || 'Nao informado'}`,
    `**Build:** ${event.description || 'Nao informado'}`,
    '',
    `### Composicao (${filled}/${totalSlots})`,
    '',
    ...compositionLines(event, active),
    '',
    `**Espectadores:** ${spectators.length ? spectators.map((participant) => `<@${participant.discord_id}>`).join(', ') : 'Vazio'}`
  ];
  return lines.join('\n').slice(0, 4096);
}

function compositionLines(event, participants) {
  const remaining = new Map();
  for (const role of eventRoles) {
    remaining.set(role, participants.filter((participant) => participant.role === role));
  }

  return eventRoles.flatMap((role) => {
    const slots = Number(event[roleConfigs[role].slots] || 0);
    return Array.from({ length: slots }, (_, index) => {
      const participant = remaining.get(role).shift();
      return `${roleLineLabel(role, index, slots)} > ${participant ? `<@${participant.discord_id}>` : 'Vazio'}`;
    });
  });
}

function roleLineLabel(role, index, total) {
  const labels = {
    tank: '\u{1F6E1}\uFE0F **Tank**',
    healer: '\u270B **Healer**',
    support: '\u{1F7E7} **Suporte**',
    dps: `\u2694\uFE0F **DPS ${index + 1}**`
  };
  if (role === 'dps') return labels.dps;
  return total > 1 ? `${labels[role]} ${index + 1}` : labels[role];
}
function eventEmoji(event) {
  const text = `${event.title || ''} ${event.description || ''}`.toLowerCase();
  if (text.includes('dg') || text.includes('dungeon')) return '\u{1F300}';
  if (text.includes('raid')) return '\u2694\uFE0F';
  return '\u{1F300}';
}
function eventTimeLabel(value) {
  const start = parseAlbionEventTime(value);
  if (!start) return value || '';
  return discordTimestamp(start, 'R');
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
  const dpsCount = raidDpsCount(participants);
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
    if (!match && !isRaidWeaponUnlocked(weapon, dpsCount)) return `${label} \u{1F512} libera com ${raidWeaponRequiredDps(weapon)} DPS`;
    if (!match) return `${label} \u{1F7E2} Livre`;
    const count = careerPointsForCategory(match.participant.discord_id, role);
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
    const countText = careerHelperCategories[raid?.helper_role] ? ` (${careerPointsForCategory(participant.discord_id, 'support')})` : '';
    return `<@${participant.discord_id}> - ${label}${countText}`;
  }).join('\n');
}

function raidDpsCount(participants) {
  return participants.filter((participant) => participant.role === 'dps' && !participant.is_spectator).length;
}

function raidWeaponRequiredDps(weapon) {
  return raidAvalonUnlockRules[weaponKey(weapon)] || 0;
}

function isRaidWeaponUnlocked(weapon, dpsCount) {
  const required = raidWeaponRequiredDps(weapon);
  return required <= 0 || Number(dpsCount || 0) >= required;
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
      new ButtonBuilder().setCustomId(`event:spectate:${event.id}:raid`).setLabel('Assistir').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`event:raid_slot:${event.id}:raid`).setLabel('Trocar vaga').setStyle(ButtonStyle.Primary),
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
  } else if (event.status === 'running') {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`event:change_role:${event.id}:main`)
        .setLabel('Trocar funcao')
        .setStyle(ButtonStyle.Primary)
    ));
  }

  const buttons = event.status === 'running'
    ? isRaid
    ? [
      new ButtonBuilder().setCustomId(`event:pause:${event.id}:raid`).setLabel('Pausar participacao').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`event:finish:${event.id}:raid`).setLabel('Finalizar').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`event:cancel:${event.id}:raid`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
    ]
    : [
      new ButtonBuilder().setCustomId(`event:auto_join:${event.id}:main`).setLabel('Quero participar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`event:spectate:${event.id}:main`).setLabel('Assistir').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`event:pause:${event.id}:main`).setLabel('Pausar participacao').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`event:finish:${event.id}:main`).setLabel('Finalizar').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`event:cancel:${event.id}:main`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
    ]
    : isRaid
    ? [
      new ButtonBuilder().setCustomId(`event:start:${event.id}:raid`).setLabel('Iniciar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`event:cancel:${event.id}:raid`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
    ]
    : [
      new ButtonBuilder().setCustomId(`event:spectate:${event.id}:main`).setLabel('Assistir').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`event:start:${event.id}:main`).setLabel('Iniciar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`event:cancel:${event.id}:main`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
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
    dpsSlots: raidAvalonSlots.dps,
    postChannelId: ids.channels.participate
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

  const channelId = eventPostChannelId(fields);
  const channel = await interaction.client.channels.fetch(channelId);
  const message = await channel.send({
    embeds: [eventEmbed(event, [])],
    components: eventComponents(event)
  });
  repo.updateEvent(event.id, { message_id: message.id, message_channel_id: channel.id });
  if (interaction.guild) {
    await ensureEventTempRole(interaction.guild, event).catch(() => null);
  }

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
  const channel = await fetchEventMessageChannel(client, event);
  const message = await channel?.messages.fetch(event.message_id).catch(() => null);
  if (message) {
    await message.edit({ embeds: [eventEmbed(event, participants)], components: eventComponents(event) });
  }
}

function eventPostChannelId(fields = {}) {
  if (fields.postChannelId) return fields.postChannelId;
  return isRaidEventFields(fields) ? ids.channels.participate : ids.channels.pingContent || ids.channels.participate;
}

function isRaidEventFields(fields = {}) {
  const text = `${fields.title || ''} ${fields.description || ''}`.toLowerCase();
  return /\braid\b|avalon|ava/.test(text);
}

async function fetchEventMessageChannel(client, event) {
  const channelIds = [event.message_channel_id, ids.channels.participate, ids.channels.pingContent].filter(Boolean);
  for (const channelId of [...new Set(channelIds)]) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel) return channel;
  }
  return null;
}
async function refreshRunningEventMessages(client) {
  // Open signups also need refreshing so a restart repairs missing controls.
  const events = repo.listInteractiveEvents();
  for (const event of events) {
    await refreshEventMessage(client, event.id).catch((error) => console.error(`Falha ao atualizar ${event.event_code}:`, error));
  }
}

async function joinEvent(interaction, eventId, role) {
  const event = repo.getEvent(eventId);
  if (!event || !['created', 'running'].includes(event.status)) throw new Error('Evento nao esta aberto.');
  if (!canJoinEventRole(event, interaction.user.id, role)) {
    throw new Error(`Nao ha vaga livre para ${roleButtonLabel(role)} neste evento.`);
  }
  const previous = repo.getParticipant({ eventId, discordId: interaction.user.id });
  repo.upsertParticipant({ eventId, discordId: interaction.user.id, role, isSpectator: 0 });
  await addEventRoleToMember(interaction.guild, event, interaction.user.id).catch(() => {});
  let voiceResult = null;
  if (event.status === 'running') {
    voiceResult = await ensureParticipantVoiceSession(interaction, event);
  }
  audit.createAuditLog({
    type: previous?.is_spectator ? 'event_spectator_promoted' : 'event_joined',
    actorId: interaction.user.id,
    targetId: String(eventId),
    beforeValue: previous ? JSON.stringify({ role: previous.role, isSpectator: previous.is_spectator }) : null,
    afterValue: role,
    metadata: { voiceResult }
  });
  await refreshEventMessage(interaction.client, eventId);
}

function canJoinEventRole(event, discordId, role) {
  if (!eventRoles.includes(role)) return false;
  const slots = Number(event[roleConfigs[role].slots] || 0);
  const participants = repo.listParticipants(event.id);
  const current = participants.find((participant) => participant.discord_id === discordId && !participant.is_spectator);
  if (current?.role === role) return true;
  const used = participants.filter((participant) => (
    participant.role === role && !participant.is_spectator && participant.discord_id !== discordId
  )).length;
  return slots > used;
}

async function joinRaidAvalonRole(interaction, { eventId, role, weapon, itemPower }) {
  const event = repo.getEvent(eventId);
  if (!event || !['created', 'running'].includes(event.status)) throw new Error('Evento nao esta aberto.');
  if (!repo.getRaidAvalonEventMeta(eventId)) throw new Error('Esse evento nao e uma Raid Avalon Full.');
  const normalizedWeapon = normalizeRaidWeapon(role, weapon);
  const normalizedWeaponKey = weaponKey(normalizedWeapon);
  const occupied = repo
    .listRaidAvalonParticipants(eventId)
    .find((participant) => participant.weapon_key === normalizedWeaponKey && participant.discord_id !== interaction.user.id);
  if (occupied) throw new Error(`A vaga ${normalizedWeapon} ja esta ocupada por <@${occupied.discord_id}>.`);
  const currentParticipant = repo.getRaidAvalonParticipant({ eventId, discordId: interaction.user.id });
  const isKeepingOwnSlot = currentParticipant?.weapon_key === normalizedWeaponKey;
  if (!isKeepingOwnSlot && !isRaidWeaponUnlocked(normalizedWeapon, raidDpsCount(repo.listParticipants(eventId)))) {
    throw new Error(`${normalizedWeapon} libera com ${raidWeaponRequiredDps(normalizedWeapon)} DPS inscritos.`);
  }
  const previous = repo.getParticipant({ eventId, discordId: interaction.user.id });
  repo.upsertParticipant({ eventId, discordId: interaction.user.id, role, isSpectator: 0 });
  await addEventRoleToMember(interaction.guild, event, interaction.user.id).catch(() => {});
  repo.upsertRaidAvalonParticipant({
    eventId,
    discordId: interaction.user.id,
    weaponKey: normalizedWeaponKey,
    weaponName: normalizedWeapon,
    itemPower,
    helperRole: null
  });
  let voiceResult = null;
  if (event.status === 'running') {
    voiceResult = await ensureParticipantVoiceSession(interaction, event);
  }
  audit.createAuditLog({
    type: previous?.is_spectator ? 'raid_avalon_spectator_promoted' : 'raid_avalon_joined',
    actorId: interaction.user.id,
    targetId: String(eventId),
    beforeValue: previous ? JSON.stringify({ role: previous.role, isSpectator: previous.is_spectator }) : null,
    afterValue: JSON.stringify({ role, weapon: normalizedWeapon, itemPower }),
    metadata: { voiceResult }
  });
  await refreshEventMessage(interaction.client, eventId);
  return normalizedWeapon;
}

async function joinRaidAvalonHelper(interaction, eventId, helperRole) {
  const event = repo.getEvent(eventId);
  if (!event || !['created', 'running'].includes(event.status)) throw new Error('Evento nao esta aberto.');
  if (!repo.getRaidAvalonEventMeta(eventId)) throw new Error('Esse evento nao e uma Raid Avalon Full.');
  if (!raidAvalonHelpers[helperRole]) throw new Error('Funcao auxiliar invalida.');
  const previous = repo.getParticipant({ eventId, discordId: interaction.user.id });
  const now = new Date().toISOString();
  if (event.status === 'running' && previous && !previous.is_spectator) {
    closeParticipantOpenSession(eventId, interaction.user.id, now);
    repo.refreshParticipantSeconds(eventId);
  }
  repo.upsertParticipant({ eventId, discordId: interaction.user.id, role: helperRole, isSpectator: 1 });
  repo.upsertRaidAvalonParticipant({ eventId, discordId: interaction.user.id, helperRole });
  audit.createAuditLog({
    type: 'raid_avalon_helper_joined',
    actorId: interaction.user.id,
    targetId: String(eventId),
    beforeValue: previous ? JSON.stringify({ role: previous.role, isSpectator: previous.is_spectator }) : null,
    afterValue: helperRole
  });
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
  const previous = repo.getParticipant({ eventId, discordId: interaction.user.id });
  const now = new Date().toISOString();
  if (event.status === 'running' && previous && !previous.is_spectator) {
    closeParticipantOpenSession(eventId, interaction.user.id, now);
    repo.refreshParticipantSeconds(eventId);
  }
  repo.upsertParticipant({ eventId, discordId: interaction.user.id, role: 'spectator', isSpectator: 1 });
  await addEventRoleToMember(interaction.guild, event, interaction.user.id).catch(() => {});
  audit.createAuditLog({
    type: 'event_spectator',
    actorId: interaction.user.id,
    targetId: String(eventId),
    beforeValue: previous ? JSON.stringify({ role: previous.role, isSpectator: previous.is_spectator }) : null
  });
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

async function ensureParticipantVoiceSession(interaction, event) {
  if (!event.voice_channel_id) return { moved: false, started: false, reason: 'missing_voice' };
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member?.voice?.channel) return { moved: false, started: false, reason: 'not_in_voice' };

  const now = new Date().toISOString();
  if (member.voice.channelId !== event.voice_channel_id) {
    const moved = await member.voice.setChannel(event.voice_channel_id).then(() => true).catch(() => false);
    if (!moved) return { moved: false, started: false, reason: 'move_failed' };
  }

  const open = repo.getOpenVoiceSession({ eventId: event.id, discordId: interaction.user.id });
  if (!open) {
    repo.startVoiceSession({ eventId: event.id, discordId: interaction.user.id, joinedAt: now });
    repo.refreshParticipantSeconds(event.id);
    return { moved: true, started: true };
  }

  return { moved: true, started: false };
}

async function startEvent(interaction, eventId) {
  return startEventWithGuild({
    client: interaction.client,
    guild: interaction.guild,
    eventId,
    actorId: interaction.user.id
  });
}

async function startEventWithGuild({ client, guild, eventId, actorId }) {
  const event = repo.getEvent(eventId);
  if (!event) throw new Error('Evento nao encontrado.');
  if (event.status !== 'created') throw new Error('Evento nao pode ser iniciado.');

  const voice = await guild.channels.create({
    name: eventVoiceChannelName(event),
    type: ChannelType.GuildVoice,
    parent: ids.categories.activeEvents,
    reason: `Evento ${event.event_code} iniciado`
  });

  const now = new Date().toISOString();
  repo.updateEvent(eventId, { status: 'running', voice_channel_id: voice.id, started_at: now });
  const startedEvent = repo.getEvent(eventId);
  await deleteWarningMessage(client, startedEvent).catch(() => {});
  const participants = repo.listParticipants(eventId).filter((participant) => !participant.is_spectator);
  for (const participant of participants) {
    const member = await guild.members.fetch(participant.discord_id).catch(() => null);
    if (member?.voice?.channel) {
      await member.voice.setChannel(voice).catch(() => {});
      repo.startVoiceSession({ eventId, discordId: participant.discord_id, joinedAt: now });
    }
  }

  audit.createAuditLog({ type: 'event_started', actorId, targetId: String(eventId), afterValue: voice.id });
  await refreshEventMessage(client, eventId);
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

  audit.createAuditLog({ type: 'event_finished', actorId: interaction.user.id, targetId: String(eventId) });
  await deleteEventMessage(interaction.client, eventId);
}

async function cancelEvent(interaction, eventId, reason) {
  const event = repo.getEvent(eventId);
  if (!event) throw new Error('Evento nao encontrado.');
  const cancelReason = String(reason || '').trim() || 'Sem motivo informado';
  repo.updateEvent(eventId, { status: 'cancelled', cancel_reason: cancelReason });
  const voice = event.voice_channel_id ? await interaction.guild.channels.fetch(event.voice_channel_id).catch(() => null) : null;
  await voice?.delete(`Evento cancelado: ${cancelReason}`).catch(() => {});
  await deleteWarningMessage(interaction.client, event).catch(() => {});
  await removeWarningRole(interaction.guild, event).catch(() => {});
  audit.createAuditLog({
    type: 'event_cancelled',
    actorId: interaction.user.id,
    targetId: String(eventId),
    reason: cancelReason,
    metadata: {
      eventCode: event.event_code,
      title: event.title,
      creatorId: event.creator_id,
      previousStatus: event.status
    }
  });
  await safeSend(interaction.client, ids.channels.bankLogs, {
    content: [
      `Evento cancelado: ${event.event_code} | ${event.title}`,
      `Criador: <@${event.creator_id}>`,
      `Cancelado por: <@${interaction.user.id}>`,
      `Status anterior: ${event.status}`,
      `Motivo: ${cancelReason}`
    ].join('\n'),
    allowedMentions: normalizeAllowedMentions({ users: [event.creator_id, interaction.user.id] })
  });
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
  const mentionUserIds = [...new Set(participants.map((participant) => String(participant.discord_id)).filter(Boolean))];
  const message = await channel.send({
    content: mentions || undefined,
    embeds: [dpsMeterEmbed(eventId)],
    allowedMentions: { users: mentionUserIds }
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

async function returnEventToReview({ client, eventId, actorId }) {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'pending_payment') throw new Error('Evento nao esta pendente no financeiro.');
  const review = repo.getReview(eventId);
  if (!review) throw new Error('Revisao do evento nao encontrada.');

  repo.updateEvent(eventId, { status: 'review' });
  repo.upsertReview({
    eventId,
    lootTotal: review.loot_total,
    repair: review.repair,
    silverBags: review.silver_bags,
    taxPercent: review.tax_percent,
    netLoot: review.net_loot,
    status: 'review'
  });
  repo.updateReviewMetadata(eventId, {
    review_channel_delete_after: null
  });

  const channel = review.review_channel_id
    ? await client.channels.fetch(review.review_channel_id).catch(() => null)
    : null;
  if (channel) {
    await channel.setParent(ids.categories.activeEvents, { lockPermissions: false }).catch(() => {});
    await channel.send({
      content: `Evento devolvido pelo financeiro para o criador revisar. <@${event.creator_id}>`,
      embeds: [reviewEmbed(eventId)],
      components: reviewComponents(eventId, 'review'),
      allowedMentions: { users: [event.creator_id] }
    }).catch(() => {});
  }

  audit.createAuditLog({ type: 'event_payment_returned_to_review', actorId, targetId: String(eventId), reason: event.event_code });
  return channel;
}

const approveEventPayment = transaction(({ eventId, actorId }) => {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'pending_payment') throw new Error('Evento nao esta pendente de pagamento.');
  backupDatabase('before_event_payment');
  const participants = repo.listParticipants(eventId).filter((participant) => !participant.is_spectator && participant.payout_amount > 0);
  const campaignChoices = campaigns.createEventPayoutChoices({ event, participants, actorId });

  if (campaignChoices?.decisions?.length) {
    repo.updateEvent(eventId, { status: 'approved' });
    repo.markReviewApproved({ eventId, approvedBy: actorId });
    audit.createAuditLog({
      type: 'event_payment_approved_with_campaign_choice',
      actorId,
      targetId: String(eventId),
      reason: event.event_code,
      metadata: { campaignId: campaignChoices.campaign.id, decisions: campaignChoices.decisions.length }
    });
    return { transactions: [], campaignChoices };
  }

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
  return { transactions, campaignChoices: null };
});

async function deleteEventMessage(client, eventId) {
  const event = repo.getEvent(eventId);
  if (!event?.message_id) return;
  const channel = await fetchEventMessageChannel(client, event);
  const message = await channel?.messages.fetch(event.message_id).catch(() => null);
  await message?.delete().catch(() => {});
}

function reviewEmbed(eventId) {
  const event = repo.getEvent(eventId);
  const review = repo.getReview(eventId);
  repo.refreshParticipantSeconds(eventId);
  const allParticipants = repo.listParticipants(eventId);
  const participants = allParticipants.filter((participant) => !participant.is_spectator);
  const lines = participants.map((participant) => {
    const seconds = participant.manual_seconds ?? participant.calculated_seconds ?? 0;
    return `${raidParticipantLabel(participant)} | ${roleLabel(participant.role)} | ${formatDuration(seconds)} | ${formatSilver(participant.payout_amount)}`;
  });

  return new EmbedBuilder()
    .setTitle(event.status === 'approved' ? 'Evento finalizado' : event.status === 'pending_payment' ? 'Pagamento pendente' : 'Revisao de participacao')
    .setDescription(`**${formatEventTitle(event.title)}**\n${event.event_code}`)
    .addFields(
      { name: 'Loot liquido', value: formatSilver(review?.net_loot || 0), inline: true },
      { name: 'Evidencias', value: embedFieldValue(review?.evidence_notes || 'Anexe/cole DPS meter, fama total e CSV do loot logger no canal de revisao.'), inline: false },
      ...embedLinesFields('Participantes', lines, 'Nenhum participante com tempo contabilizado.')
    )
    .setColor(0xd69e2e)
    .setTimestamp(new Date());
}

function embedFieldValue(value, maxLength = 1024) {
  const text = String(value || '-').trim() || '-';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 20)}\n... texto cortado`;
}

function embedLinesValue(lines, emptyText, maxLength = 1024) {
  if (!lines.length) return emptyText;
  const visible = [];
  let hidden = 0;
  for (const line of lines) {
    const text = String(line || '').trim();
    if (!text) continue;
    const candidate = [...visible, text].join('\n');
    if (candidate.length > maxLength - 32) {
      hidden += 1;
    } else {
      visible.push(text);
    }
  }

  if (hidden > 0) {
    let suffix = `... e mais ${hidden}`;
    while ([...visible, suffix].join('\n').length > maxLength && visible.length > 0) {
      visible.pop();
      hidden += 1;
      suffix = `... e mais ${hidden}`;
    }
    visible.push(suffix);
  }

  return visible.join('\n') || emptyText;
}

function embedLinesFields(name, lines, emptyText, maxLength = 1024) {
  const cleanLines = lines.map((line) => String(line || '').trim()).filter(Boolean);
  if (!cleanLines.length) return [{ name, value: emptyText, inline: false }];

  const fields = [];
  let current = [];
  for (const line of cleanLines) {
    const candidate = [...current, line].join('\n');
    if (candidate.length > maxLength && current.length > 0) {
      fields.push({ name: fieldPageName(name, fields.length), value: current.join('\n'), inline: false });
      current = [line];
    } else if (line.length > maxLength) {
      fields.push({ name: fieldPageName(name, fields.length), value: embedFieldValue(line, maxLength), inline: false });
      current = [];
    } else {
      current.push(line);
    }
  }

  if (current.length > 0) {
    fields.push({ name: fieldPageName(name, fields.length), value: current.join('\n'), inline: false });
  }
  return fields.slice(0, 20);
}

function fieldPageName(name, index) {
  return index === 0 ? name : `${name} ${index + 1}`;
}

function reviewComponents(eventId, mode = 'review') {
  if (mode === 'finance') {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`event:approve:${eventId}`).setLabel('Aprovar pagamento').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`event:return_review:${eventId}`).setLabel('Recusar e devolver').setStyle(ButtonStyle.Danger)
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
      { name: 'Evidencias', value: embedFieldValue(review?.evidence_notes || 'Aguardando prints/links/CSV no canal de revisao.'), inline: false },
      ...embedLinesFields('Participantes', lines, 'Nenhum participante.')
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
    spectator: '\u{1F441}\uFE0F Espectador',
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
    `<@${event.creator_id}> - ${formatRaidSchedule(event.scheduled_time)}`,
    `We mass from ${event.location || 'local nao informado'}`,
    'Obs: Se tem duvida ou precisa de build vem 30 min cedo pro PORTAL DE MARTLOCK.'
  ].join('\n');
}

function formatRaidSchedule(value) {
  const text = String(value || '').trim();
  if (!text) return 'horario nao informado';
  const startAt = parseAlbionEventTime(text);
  if (!startAt) return text;
  return `${formatAlbionScheduleText(text, startAt)} (${discordTimestamp(startAt, 'R')})`;
}

function formatAlbionScheduleText(text, startAt) {
  const dateMatch = String(text || '').match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?\b/);
  const time = `${String(startAt.getUTCHours()).padStart(2, '0')}:${String(startAt.getUTCMinutes()).padStart(2, '0')}`;
  if (dateMatch) {
    return `${dateMatch[1].padStart(2, '0')}/${dateMatch[2].padStart(2, '0')} as ${time} UTC`;
  }
  return `Hoje as ${time} UTC`;
}

function discordTimestamp(date, style = 'R') {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
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
  const dpsCount = raidDpsCount(repo.listParticipants(eventId));

  return (raidAvalonWeaponSlots[role] || []).map((weapon) => {
    const key = weaponKey(weapon);
    const owner = occupied.get(key);
    if (owner && owner !== discordId) return null;
    if (!owner && !isRaidWeaponUnlocked(weapon, dpsCount)) return null;
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
  const dpsCount = raidDpsCount(repo.listParticipants(eventId));

  return eventRoles.flatMap((role) => (raidAvalonWeaponSlots[role] || []).map((weapon) => {
    const key = weaponKey(weapon);
    const owner = occupied.get(key);
    if (owner && owner !== discordId) return null;
    if (!owner && !isRaidWeaponUnlocked(weapon, dpsCount)) return null;
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

async function grantRaidAvalonRewards({ guild, eventId, actorId = null }) {
  repo.refreshParticipantSeconds(eventId);
  const event = repo.getEvent(eventId);
  const isRaid = Boolean(repo.getRaidAvalonEventMeta(eventId));
  const participants = repo.listParticipants(eventId);
  let granted = 0;
  let points = 0;
  let skipped = 0;
  let duplicates = 0;

  for (const participant of participants) {
    const seconds = participant.manual_seconds ?? participant.calculated_seconds ?? 0;
    const category = careerCategoryForParticipant(eventId, participant);
    const functionName = eventFunctionName(eventId, participant);
    const pointInfo = careerPointInfo({ eventId, discordId: participant.discord_id, category, seconds, source: 'event_approval' });
    if (!pointInfo) {
      skipped += 1;
      continue;
    }

    if (isRaid && !participant.is_spectator && functionName) {
      const member = await guild.members.fetch(participant.discord_id).catch(() => null);
      const roleName = `Raid Avalon - ${functionName}`;
      let discordRole = guild.roles.cache.find((item) => item.name.toLowerCase() === roleName.toLowerCase());
      if (!discordRole) {
        discordRole = await guild.roles.create({ name: roleName, mentionable: false, reason: `Tag da funcao ${functionName} na Raid Avalon` }).catch(() => null);
      }
      if (member && discordRole && !member.roles.cache.has(discordRole.id)) {
        const added = await member.roles.add(discordRole, `Completou Raid Avalon com ${functionName}`).then(() => true).catch(() => false);
        if (added) granted += 1;
      }
    }

    const result = repo.addCareerPointTransaction({ ...pointInfo.entry, createdBy: actorId });
    points += result.points;
    if (!result.inserted) duplicates += 1;
  }

  const callerInfo = careerCallerPointInfo({ event, participants, source: 'event_approval' });
  if (callerInfo) {
    const result = repo.addCareerPointTransaction({ ...callerInfo.entry, createdBy: actorId });
    points += result.points;
    if (!result.inserted) duplicates += 1;
  }

  await refreshRaidAvalonCareerPanel(guild.client).catch(() => {});
  return { granted, points, skipped, duplicates };
}

function careerPointInfo({ eventId, discordId, category, seconds, source }) {
  const pointsToAdd = Math.floor(Number(seconds || 0) / 1800);
  const info = careerCategoryInfo(category);
  if (pointsToAdd <= 0 || !discordId || !info) return null;
  return {
    entry: {
      eventId,
      discordId,
      pointType: category === 'caller' ? 'caller' : 'class',
      role: category,
      weaponKey: info.key,
      weaponName: info.name,
      seconds,
      points: pointsToAdd,
      source
    },
    points: pointsToAdd
  };
}

function careerCallerPointInfo({ event, participants, source }) {
  if (!event?.creator_id) return null;
  const creatorParticipant = participants.find((participant) => participant.discord_id === event.creator_id);
  const participantSeconds = creatorParticipant
    ? creatorParticipant.manual_seconds ?? creatorParticipant.calculated_seconds ?? 0
    : 0;
  const seconds = participantSeconds > 0 ? participantSeconds : eventDurationSeconds(event);
  return careerPointInfo({
    eventId: event.id,
    discordId: event.creator_id,
    category: 'caller',
    seconds,
    source
  });
}

function careerCategoryForParticipant(eventId, participant) {
  if (!participant?.is_spectator) return normalizeParticipantRole(participant.role);
  const raid = repo.getRaidAvalonParticipant({ eventId, discordId: participant.discord_id });
  return careerHelperCategories[raid?.helper_role] || null;
}

function careerCategoryInfo(category) {
  return careerCategories[category] || null;
}

function careerPointsForCategory(discordId, category) {
  const info = careerCategoryInfo(category);
  if (!info) return 0;
  return Number(repo.getRaidAvalonCareer({ discordId, weaponKey: info.key })?.points || 0);
}

function eventDurationSeconds(event) {
  if (!event?.started_at) return 0;
  const start = Date.parse(event.started_at);
  const end = Date.parse(event.ended_at || new Date().toISOString());
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 1000));
}

function previewCareerRebuild() {
  return buildCareerRebuildPlan({ refreshSeconds: true }).summary;
}

function rebuildCareerPoints({ actorId }) {
  const plan = buildCareerRebuildPlan({ refreshSeconds: true, createdBy: actorId });
  const result = repo.replaceCareerPointData(plan.entries);
  return {
    ...plan.summary,
    insertedTransactions: result.inserted,
    insertedPoints: result.points
  };
}

function buildCareerRebuildPlan({ refreshSeconds = false, createdBy = null } = {}) {
  const events = repo.listApprovedEventsForCareer();
  const entries = [];
  const members = new Set();
  let participantsWithPoints = 0;
  let skipped = 0;
  let eventsWithPoints = 0;

  for (const event of events) {
    if (refreshSeconds) repo.refreshParticipantSeconds(event.id);
    let eventPoints = 0;
    const participants = repo.listParticipants(event.id);
    for (const participant of participants) {
      const seconds = participant.manual_seconds ?? participant.calculated_seconds ?? 0;
      const category = careerCategoryForParticipant(event.id, participant);
      const pointInfo = careerPointInfo({
        eventId: event.id,
        discordId: participant.discord_id,
        category,
        seconds,
        source: 'career_rebuild'
      });
      if (!pointInfo) {
        skipped += 1;
        continue;
      }
      entries.push({ ...pointInfo.entry, createdBy });
      participantsWithPoints += 1;
      eventPoints += pointInfo.points;
      members.add(participant.discord_id);
    }

    const callerInfo = careerCallerPointInfo({ event, participants, source: 'career_rebuild' });
    if (callerInfo) {
      entries.push({ ...callerInfo.entry, createdBy });
      eventPoints += callerInfo.points;
      members.add(event.creator_id);
    }

    if (eventPoints > 0) eventsWithPoints += 1;
  }

  return {
    entries,
    summary: {
      approvedEvents: events.length,
      eventsWithPoints,
      uniqueMembers: members.size,
      participantsWithPoints,
      skippedParticipants: skipped,
      transactionsToCreate: entries.length,
      pointsToCreate: entries.reduce((total, entry) => total + Number(entry.points || 0), 0),
      existingTransactions: repo.countCareerPointTransactions()
    }
  };
}

async function refreshRaidAvalonCareerPanel(client) {
  const channel = await client.channels.fetch(ids.channels.pveCareer || ids.channels.adminPanel).catch(() => null);
  if (!channel) return null;
  const payload = raidAvalonCareerPanelPayload();
  const previous = repo.getPersistentMessage('raid_avalon_career_panel');
  let message = previous?.message_id
    ? await channel.messages.fetch(previous.message_id).catch(() => null)
    : null;

  if (!message) {
    message = await findExistingCareerPanelMessage(channel, client.user?.id);
  }

  if (message) {
    await message.edit(payload);
    repo.setPersistentMessage({ key: 'raid_avalon_career_panel', channelId: channel.id, messageId: message.id });
    await deleteDuplicateCareerPanelMessages(channel, message.id, client.user?.id).catch(() => {});
    return message;
  }

  const created = await channel.send(payload);
  repo.setPersistentMessage({ key: 'raid_avalon_career_panel', channelId: channel.id, messageId: created.id });
  return created;
}

async function findExistingCareerPanelMessage(channel, botId) {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return null;
  return messages.find((message) => isCareerPanelMessage(message, botId)) || null;
}

async function deleteDuplicateCareerPanelMessages(channel, keepMessageId, botId) {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return;
  const duplicates = messages.filter((message) => message.id !== keepMessageId && isCareerPanelMessage(message, botId));
  for (const message of duplicates.values()) {
    await message.delete().catch(() => {});
  }
}

function isCareerPanelMessage(message, botId) {
  if (botId && message.author?.id !== botId) return false;
  const title = message.embeds?.[0]?.title || '';
  return ['Raid Avalon - carreira por arma', 'Carreira geral por arma', 'Carreira PvE por categoria'].includes(title);
}

function raidAvalonCareerPanelPayload() {
  const categoryRows = repo.listRaidAvalonCareerByWeapon(16);
  const memberRows = repo.listRaidAvalonCareer(12);
  const categoryLines = categoryRows.map((row, index) => {
    const totalUses = Math.floor(Number(row.points || 0));
    return `${index + 1}. ${careerCategoryEmoji(row.weapon_key)} **${row.weapon_name}** - ${totalUses} ponto(s) | ${row.members} membro(s)`;
  });
  const memberLines = memberRows.map((row, index) => {
    return `${index + 1}. <@${row.discord_id}> | ${careerCategoryEmoji(row.weapon_key)} ${row.weapon_name} | ${row.points} ponto(s)`;
  });

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Carreira PvE por categoria')
        .setDescription([
          'Conta qualquer content aprovado no financeiro.',
          'Regra: 30 minutos = 1 ponto na categoria jogada. Criador tambem soma Caller.',
          'Scout e Looter contam como Suporte. Assistir nao conta.',
          '',
          '**Categorias**',
          categoryLines.length ? categoryLines.join('\n') : 'Nenhum ponto registrado ainda.',
          '',
          '**Top membros por categoria**',
          memberLines.length ? memberLines.join('\n') : 'Nenhum ponto registrado ainda.'
        ].join('\n'))
        .setColor(0x805ad5)
        .setTimestamp(new Date())
    ]
  };
}

function careerCategoryEmoji(key) {
  const emojis = {
    classe_tank: formatCustomEmoji(emojiRefs.role.tank) || '\u{1F6E1}\uFE0F',
    classe_healer: formatCustomEmoji(emojiRefs.role.healer) || '\u{1F49A}',
    classe_support: formatCustomEmoji(emojiRefs.role.support) || '\u{1F7E1}',
    classe_dps: formatCustomEmoji(emojiRefs.role.dps) || '\u2694\uFE0F',
    classe_caller: '\u{1F4E3}'
  };
  return emojis[key] || '';
}

function normalizeParticipantRole(role) {
  return eventRoles.includes(role) ? role : null;
}

function eventFunctionName(eventId, participant) {
  const raid = repo.getRaidAvalonParticipant({ eventId, discordId: participant.discord_id });
  if (raid?.weapon_name) return raid.weapon_name;
  const role = normalizeParticipantRole(participant.role);
  return role ? defaultFunctionByRole[role] : null;
}

function statusLabel(status) {
  const labels = {
    created: '\u{1F7E2} Aberto',
    running: '\u{1F7E2} Em andamento',
    review: '\u{1F7E1} Em revisao',
    pending_payment: '\u{1F7E1} Pendente financeiro',
    approved: '\u2705 Finalizado',
    cancelled: '\u{1F534} Cancelado'
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
  const events = repo.listPendingReminderEvents();
  const guild = await client.guilds.fetch(ids.guildId).catch(() => null);
  if (!guild) return;
  await cleanupExpiredEventTempRoles(guild);
  for (const event of events) {
    const startAt = parseAlbionEventTime(event.scheduled_time);
    if (!startAt) continue;
    const msUntilStart = startAt.getTime() - Date.now();
    await ensureEventTempRole(guild, event).catch(() => null);

    if (!event.reminder_10_sent && msUntilStart <= 10 * 60 * 1000 && msUntilStart > 0) {
      await sendEventReminder(client, event, 'faltam 10 minutos').catch((error) => console.error(`Falha ao avisar ${event.event_code}:`, error));
      repo.updateEvent(event.id, { reminder_10_sent: 1 });
    }

    if (!event.reminder_start_sent && msUntilStart <= 0 && msUntilStart > -10 * 60 * 1000) {
      await sendEventReminder(client, event, 'comecou agora').catch((error) => console.error(`Falha ao avisar ${event.event_code}:`, error));
      repo.updateEvent(event.id, { reminder_start_sent: 1 });
    }

  }
}

async function cleanupExpiredEventTempRoles(guild) {
  const tracked = repo.listEventsWithTempRoles();
  for (const event of tracked) {
    if (!isTempRoleExpired(event.temp_role_delete_after)) continue;
    await removeWarningRole(guild, event).catch((error) => {
      console.error(`Falha ao remover cargo temporario ${event.warning_role_id} do ${event.event_code}:`, error);
    });
  }

  const roles = await guild.roles.fetch().catch(() => guild.roles.cache);
  const now = Date.now();
  for (const role of roles.values()) {
    if (!isOrphanEventTempRole(role, now)) continue;
    await role.delete('Removendo cargo temporario antigo sem evento vinculado').catch((error) => {
      console.error(`Falha ao remover cargo temporario antigo ${role.name}:`, error);
    });
  }
}

function isTempRoleExpired(deleteAfter) {
  if (!deleteAfter) return false;
  const time = Date.parse(deleteAfter);
  return Number.isFinite(time) && time <= Date.now();
}

function isOrphanEventTempRole(role, now = Date.now()) {
  if (!/^\d{4}as\d{1,2}h$/i.test(role?.name || '')) return false;
  return now - Number(role.createdTimestamp || 0) >= 24 * 60 * 60 * 1000;
}

async function ensureEventTempRole(guild, event) {
  if (event.warning_role_id) {
    const role = await guild.roles.fetch(event.warning_role_id).catch(() => null);
    if (role) return role;
  }
  const role = await guild.roles.create({
    name: eventTempRoleName(event),
    mentionable: true,
    reason: `Tag temporaria do evento ${event.event_code}`
  });
  const deleteAfter = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  repo.updateEvent(event.id, { warning_role_id: role.id, temp_role_delete_after: deleteAfter });
  const participants = repo.listParticipants(event.id);
  for (const participant of participants) {
    await addEventRoleToMember(guild, { ...event, warning_role_id: role.id }, participant.discord_id).catch(() => {});
  }
  return role;
}

async function addEventRoleToMember(guild, event, discordId) {
  if (!event?.warning_role_id) return;
  const member = await guild.members.fetch(discordId).catch(() => null);
  await member?.roles.add(event.warning_role_id, `Participante do evento ${event.event_code}`).catch(() => {});
}

async function sendEventReminder(client, event, text) {
  const guild = await client.guilds.fetch(ids.guildId);
  const role = await ensureEventTempRole(guild, event);
  const participants = repo.listParticipants(event.id).filter((participant) => !participant.is_spectator);
  for (const participant of participants) {
    await addEventRoleToMember(guild, { ...event, warning_role_id: role.id }, participant.discord_id).catch(() => {});
  }

  await deleteWarningMessage(client, event).catch(() => {});
  const channel = await client.channels.fetch(ids.channels.notagChat);
  const message = await channel.send(`${role} ${text} para **${formatEventTitle(event.title)}**.`);
  repo.updateEvent(event.id, { warning_message_id: message.id, warning_sent: 1 });
  scheduleReminderDeletion(client, event.id, message.id);
  audit.createAuditLog({ type: 'event_start_warning_sent', targetId: String(event.id), afterValue: role.id, reason: `${event.event_code}: ${text}` });
}

async function deleteWarningMessage(client, event) {
  if (!event?.warning_message_id) return;
  const channelIds = [ids.channels.notagChat, ids.channels.participate].filter(Boolean);
  for (const channelId of channelIds) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    const message = await channel?.messages.fetch(event.warning_message_id).catch(() => null);
    if (message) {
      await message.delete().catch(() => {});
      break;
    }
  }
  repo.updateEvent(event.id, { warning_message_id: null });
}

function scheduleReminderDeletion(client, eventId, messageId) {
  const timer = setTimeout(async () => {
    const event = repo.getEvent(eventId);
    if (!event || event.warning_message_id !== messageId) return;
    const channel = await client.channels.fetch(ids.channels.notagChat).catch(() => null);
    const message = await channel?.messages.fetch(messageId).catch(() => null);
    await message?.delete().catch(() => {});

    const current = repo.getEvent(eventId);
    if (current?.warning_message_id === messageId) {
      repo.updateEvent(eventId, { warning_message_id: null });
    }
  }, eventReminderDeleteAfterMs);

  if (typeof timer.unref === 'function') timer.unref();
}

async function removeWarningRole(guild, event) {
  if (!event?.warning_role_id) return;
  const role = await guild.roles.fetch(event.warning_role_id).catch(() => null);
  if (role) {
    await role.delete(`Removendo cargo temporario do evento ${event.event_code}`);
  }
  repo.updateEvent(event.id, { warning_role_id: null, temp_role_delete_after: null });
}

function parseAlbionEventTime(value) {
  const text = String(value || '').trim();
  const textWithoutDate = text.replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/, ' ');
  const match = textWithoutDate.match(/\b(\d{1,2}):(\d{2})\b/)
    || textWithoutDate.match(/\b(\d{1,2})h\b/i)
    || textWithoutDate.match(/\b(\d{1,2})\b/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const now = new Date();
  const dateMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  let day = now.getUTCDate();
  if (dateMatch) {
    day = Number(dateMatch[1]);
    month = Number(dateMatch[2]) - 1;
    if (dateMatch[3]) {
      year = Number(dateMatch[3]);
      if (year < 100) year += 2000;
    }
  }
  const start = new Date(Date.UTC(year, month, day, hour, minute, 0));
  if (!dateMatch && hour <= 3 && now.getUTCHours() > 6) start.setUTCDate(start.getUTCDate() + 1);
  return start;
}

function eventTempRoleName(event) {
  const start = parseAlbionEventTime(event.scheduled_time) || new Date();
  const day = String(start.getUTCDate()).padStart(2, '0');
  const month = String(start.getUTCMonth() + 1).padStart(2, '0');
  const hour = String(start.getUTCHours()).padStart(2, '0');
  return `${day}${month}as${hour}h`;
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
  previewCareerRebuild,
  raidWeaponBuildUrl,
  raidWeaponIconUrl,
  raidWeaponName,
  raidWeaponOptions,
  raidWeaponRoleOptions,
  raidWeaponSlotOptions,
  raidWeaponSuggestions,
  refreshEventMessage,
  refreshRaidAvalonCareerPanel,
  refreshRunningEventMessages,
  removeParticipantReview,
  rebuildCareerPoints,
  returnEventToReview,
  reviewComponents,
  reviewEmbed,
  saveLootReview,
  scheduleReviewChannelDeletion,
  moveReviewChannelToClosed,
  submitEventToFinance,
  spectateEvent,
  startEvent
};
