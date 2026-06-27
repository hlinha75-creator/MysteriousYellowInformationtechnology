const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase } = require('../../database/connection');
const memberList = require('../members/memberList.service');
const memberPanel = require('../members/memberPanel.service');
const operations = require('../operations/operations.service');

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
        new ButtonBuilder().setCustomId('panel:create_raid_full').setLabel('Raid Full').setStyle(ButtonStyle.Success)
      )
    ]
  },
  {
    type: 'registration',
    channelId: ids.channels.register,
    embed: new EmbedBuilder().setTitle('Registro').setDescription('Clique para registrar seu nick do Albion e liberar acesso inicial.').setColor(0x38a169),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel:registration').setLabel('Registrar Nick').setStyle(ButtonStyle.Primary)
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
        new ButtonBuilder().setCustomId('panel:create_auction').setLabel('Criar leilao').setStyle(ButtonStyle.Success)
      )
    ]
  },
  {
    type: 'admin',
    channelId: ids.channels.adminPanel,
    dynamic: adminPanelPayload
  },
  {
    type: 'deposit',
    channelId: ids.channels.deposit,
    embed: new EmbedBuilder().setTitle('Deposito').setDescription('Staff pode criar deposito rapido dividido igualmente entre participantes.').setColor(0x38a169),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('deposit:create').setLabel('Criar deposito').setStyle(ButtonStyle.Primary)
      )
    ]
  },
  {
    type: 'member_list',
    channelId: ids.channels.memberList,
    dynamic: memberList.panelPayload
  },
  {
    type: 'member_panel',
    channelId: ids.channels.memberPanel,
    dynamic: memberPanel.panelPayload
  },
  {
    type: 'archive',
    channelId: ids.channels.archive,
    embed: archiveEmbed,
    components: archiveComponents
  }
];

function adminPanelPayload() {
  const queue = operations.pendingQueuePayload();
  return {
    embeds: [
      new EmbedBuilder().setTitle('Painel ADM').setDescription('Acoes administrativas e fila de pendencias.').setColor(0xdd6b20),
      ...queue.embeds,
      archiveEmbed
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('admin:remove_balance').setLabel('Retirar saldo').setStyle(ButtonStyle.Danger)
      ),
      ...queue.components,
      ...archiveComponents
    ]
  };
}

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
}

module.exports = {
  upsertSetupPanels
};
