const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase } = require('../../database/connection');
const operations = require('../operations/operations.service');
const staffTutorial = require('../tutorials/staffTutorial.service');

const archiveEmbed = new EmbedBuilder()
  .setTitle('Arquivar')
  .setDescription('Exportacao e importacao manual de dados.')
  .setColor(0x805ad5);

const archiveComponents = [
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('csv:export_balances').setLabel('Exportar saldos').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('csv:export_transactions').setLabel('Logs financeiros').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('csv:export_audit').setLabel('Auditoria').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('guild:export_members_html').setLabel('Discord x Albion').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('csv:import_help').setLabel('Importar CSV').setStyle(ButtonStyle.Primary)
  )
];

const panels = [
  {
    type: 'create_event',
    channelId: ids.channels.createEvent,
    embed: new EmbedBuilder().setTitle('Criar evento').setDescription('Use o botao abaixo para criar um evento da guild.').setColor(0x3182ce),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel:create_event').setLabel('Criar Evento').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('panel:create_raid_full').setLabel('Raid Full').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('panel:create_world_boss').setLabel('World Boss').setStyle(ButtonStyle.Danger)
      )
    ]
  },
  {
    type: 'registration',
    channelId: ids.channels.register,
    embed: new EmbedBuilder().setTitle('Registro').setDescription('Clique para registrar seu nick do Albion e liberar acesso inicial.').setColor(0x38a169),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel:registration').setLabel('Registrar Nick').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('panel:member_profile').setLabel('Meu perfil').setStyle(ButtonStyle.Secondary)
      )
    ]
  },
  {
    type: 'balance',
    channelId: ids.channels.consultBalance,
    embed: new EmbedBuilder().setTitle('Saldo').setDescription('Consulte saldo ou solicite saque.').setColor(0x38a169),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('finance:balance').setLabel('Consultar').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('finance:withdraw').setLabel('Sacar').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('finance:payment_request').setLabel('Pedir pagamento').setStyle(ButtonStyle.Success)
      )
    ]
  },
  {
    type: 'admin',
    channelId: ids.channels.adminPanel,
    dynamic: operations.adminPanelPayload
  },
  {
    type: 'deposit',
    channelId: ids.channels.deposit,
    embed: new EmbedBuilder().setTitle('Deposito').setDescription('Staff pode criar deposito rapido dividido igualmente entre participantes.').setColor(0x38a169),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('deposit:create').setLabel('Criar deposito').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('deposit:create_list').setLabel('Deposito por lista').setStyle(ButtonStyle.Success)
      )
    ]
  },
  {
    type: 'archive',
    channelId: ids.channels.archive,
    embed: archiveEmbed,
    components: archiveComponents
  },
  {
    type: 'staff_tutorial',
    channelId: ids.channels.staffTutorial,
    dynamic: staffTutorial.panelPayload
  }
];

const disabledPanelChannelIds = [
  ids.channels.memberList,
  ids.channels.memberPanel,
  ids.channels.notagChat,
  '1521169204059836607',
  ids.channels.pveCareer
].filter(Boolean);

async function upsertSetupPanels(client) {
  const db = getDatabase();
  for (const panel of panels) {
    const channel = await client.channels.fetch(panel.channelId);
    const previous = db.prepare('SELECT * FROM setup_messages WHERE channel_id = ?').get(panel.channelId);
    let message = previous ? await channel.messages.fetch(previous.message_id).catch(() => null) : null;
    const payload = panel.dynamic
      ? await panel.dynamic(channel.guild)
      : { embeds: panel.embeds || [panel.embed], components: panel.components };
    if (message) {
      await message.edit(payload);
    } else {
      message = await channel.send(payload);
    }
    db.prepare(`
      INSERT INTO setup_messages (channel_id, message_id, panel_type, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(channel_id) DO UPDATE SET message_id = excluded.message_id, panel_type = excluded.panel_type, updated_at = CURRENT_TIMESTAMP
    `).run(panel.channelId, message.id, panel.type);
  }
  await deleteDisabledSetupPanels(client, db);
}

async function deleteDisabledSetupPanels(client, db) {
  for (const channelId of disabledPanelChannelIds) {
    const previous = db.prepare('SELECT * FROM setup_messages WHERE channel_id = ?').get(channelId);
    if (!previous) continue;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    const message = channel?.messages
      ? await channel.messages.fetch(previous.message_id).catch(() => null)
      : null;
    await message?.delete().catch(() => {});
    db.prepare('DELETE FROM setup_messages WHERE channel_id = ?').run(channelId);
  }
}

module.exports = {
  upsertSetupPanels
};

