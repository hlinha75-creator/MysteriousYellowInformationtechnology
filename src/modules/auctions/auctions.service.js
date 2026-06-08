const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const ids = require('../../config/ids');
const { transaction } = require('../../database/connection');
const audit = require('../audit/audit.repository');
const repo = require('./auctions.repository');
const { formatSilver } = require('../../utils/silver');

function auctionEmbed(auction) {
  const isOpen = auction.status === 'open';
  const embed = new EmbedBuilder()
    .setTitle(`Leilao #${auction.id}: ${auction.item_name}`)
    .setColor(isOpen ? 0xd69e2e : 0x718096)
    .addFields(
      { name: 'Status', value: isOpen ? 'Aberto' : 'Encerrado', inline: true },
      { name: 'Lance atual', value: formatSilver(auction.current_bid), inline: true },
      { name: 'Incremento minimo', value: formatSilver(auction.min_increment), inline: true },
      { name: 'Maior lance', value: auction.current_winner_id ? `<@${auction.current_winner_id}>` : 'Ninguem ainda', inline: true },
      { name: 'Criado por', value: `<@${auction.created_by}>`, inline: true }
    )
    .setTimestamp(new Date(auction.created_at));

  if (auction.pickup_info) {
    embed.addFields({ name: 'Retirada', value: auction.pickup_info });
  }
  if (auction.image_url) {
    embed.addFields({ name: 'Imagem', value: auction.image_url });
    if (isDirectImageUrl(auction.image_url)) {
      embed.setImage(auction.image_url);
    }
  }
  if (!isOpen && auction.current_winner_id) {
    embed.addFields({ name: 'Vencedor', value: `<@${auction.current_winner_id}> por ${formatSilver(auction.current_bid)}` });
  }
  return embed;
}

function auctionComponents(auction) {
  const buttons = [];
  if (auction.status === 'open') {
    buttons.push(
      new ButtonBuilder().setCustomId(`auction:bid:${auction.id}`).setLabel('Dar lance').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`auction:close:${auction.id}`).setLabel('Encerrar').setStyle(ButtonStyle.Secondary)
    );
  }
  return buttons.length ? [new ActionRowBuilder().addComponents(...buttons)] : [];
}

async function createAuctionFromModal(interaction, data) {
  const result = repo.createAuction({
    itemName: data.itemName,
    imageUrl: data.imageUrl,
    pickupInfo: data.pickupInfo,
    startingBid: data.startingBid,
    minIncrement: data.minIncrement,
    createdBy: interaction.user.id
  });
  const auction = repo.getAuction(Number(result.lastInsertRowid));
  const channel = await interaction.client.channels.fetch(ids.channels.consultBalance);
  const content = auction.image_url && !isDirectImageUrl(auction.image_url) ? auction.image_url : null;
  const message = await channel.send({
    content,
    embeds: [auctionEmbed(auction)],
    components: auctionComponents(auction)
  });
  repo.updateAuctionMessage({ id: auction.id, channelId: channel.id, messageId: message.id });
  audit.createAuditLog({
    type: 'auction_created',
    actorId: interaction.user.id,
    afterValue: auction.starting_bid,
    reason: auction.item_name,
    metadata: { auctionId: auction.id, imageUrl: auction.image_url }
  });
  return repo.getAuction(auction.id);
}

const placeBid = transaction(({ auctionId, userId, amount }) => {
  const auction = repo.getAuction(auctionId);
  if (!auction) throw new Error('Leilao nao encontrado.');
  if (auction.status !== 'open') throw new Error('Este leilao ja foi encerrado.');
  if (auction.current_winner_id === userId) throw new Error('Voce ja tem o maior lance neste leilao.');

  const minimum = auction.current_winner_id
    ? auction.current_bid + auction.min_increment
    : auction.current_bid;
  if (amount < minimum) {
    throw new Error(`Lance minimo atual: ${formatSilver(minimum)}.`);
  }

  repo.insertBid({ auctionId, userId, amount });
  repo.updateCurrentBid({ id: auctionId, userId, amount });
  audit.createAuditLog({
    type: 'auction_bid',
    actorId: userId,
    targetId: auction.created_by,
    afterValue: amount,
    reason: `Leilao #${auctionId}`,
    metadata: { auctionId }
  });
  return repo.getAuction(auctionId);
});

async function refreshAuctionMessage(client, auction) {
  if (!auction.channel_id || !auction.message_id) return;
  const channel = await client.channels.fetch(auction.channel_id).catch(() => null);
  const message = channel ? await channel.messages.fetch(auction.message_id).catch(() => null) : null;
  if (!message) return;
  await message.edit({
    embeds: [auctionEmbed(auction)],
    components: auctionComponents(auction)
  });
}

function closeAuction({ auctionId, actorId }) {
  const auction = repo.getAuction(auctionId);
  if (!auction) throw new Error('Leilao nao encontrado.');
  if (auction.status !== 'open') throw new Error('Este leilao ja foi encerrado.');
  repo.closeAuction({ id: auctionId, closedBy: actorId });
  audit.createAuditLog({
    type: 'auction_closed',
    actorId,
    targetId: auction.current_winner_id,
    afterValue: auction.current_bid,
    reason: `Leilao #${auctionId}`,
    metadata: { auctionId }
  });
  return repo.getAuction(auctionId);
}

function isDirectImageUrl(url) {
  return /^https?:\/\/\S+\.(png|jpe?g|gif|webp)(\?\S*)?$/i.test(String(url || '').trim());
}

module.exports = {
  auctionComponents,
  auctionEmbed,
  closeAuction,
  createAuctionFromModal,
  placeBid,
  refreshAuctionMessage
};
