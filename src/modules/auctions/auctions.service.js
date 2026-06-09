const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const ids = require('../../config/ids');
const { transaction } = require('../../database/connection');
const { can } = require('../../config/permissions');
const audit = require('../audit/audit.repository');
const repo = require('./auctions.repository');
const { formatSilver } = require('../../utils/silver');

const drafts = new Map();
const DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000;
const MIN_DURATION_MS = 60 * 1000;
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function createDraft({ imageUrl }) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  drafts.set(id, { id, imageUrl: imageUrl || null, createdAt: Date.now() });
  return drafts.get(id);
}

function takeDraft(id) {
  const draft = drafts.get(id);
  drafts.delete(id);
  return draft;
}

function auctionEmbed(auction) {
  const isOpen = auction.status === 'open';
  const remainingMs = getRemainingMs(auction);
  const embed = new EmbedBuilder()
    .setAuthor({ name: 'NOTAG Leiloes' })
    .setTitle(`${isOpen ? 'LEILAO ABERTO' : 'LEILAO ENCERRADO'} #${auction.id}`)
    .setDescription([
      `**Item:** ${auction.item_name}`,
      isOpen ? 'Maior lance valido no fim do prazo vence.' : 'Resultado final do leilao.'
    ].join('\n'))
    .setColor(isOpen ? 0xf6ad55 : 0x718096)
    .addFields(
      { name: 'LANCE ATUAL', value: `**${formatSilver(auction.current_bid)}**`, inline: true },
      { name: 'TEMPO RESTANTE', value: isOpen ? `**${formatRemaining(remainingMs)}**` : '**Encerrado**', inline: true },
      { name: 'MAIOR LANCE', value: auction.current_winner_id ? `<@${auction.current_winner_id}>` : 'Ninguem ainda', inline: true },
      { name: 'Incremento minimo', value: formatSilver(auction.min_increment), inline: true },
      { name: 'Criado por', value: `<@${auction.created_by}>`, inline: true }
    )
    .setTimestamp(auction.ends_at ? new Date(auction.ends_at) : new Date(auction.created_at))
    .setFooter({ text: isOpen ? 'Leilao encerra automaticamente no prazo.' : 'Leilao finalizado.' });

  if (auction.pickup_info) {
    embed.addFields({ name: 'Retirada', value: auction.pickup_info });
  }
  if (auction.image_url) {
    embed.setImage(auction.image_url);
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
      new ButtonBuilder().setCustomId(`auction:bid:${auction.id}`).setLabel('Dar lance').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`auction:close:${auction.id}`).setLabel('Encerrar leilao').setStyle(ButtonStyle.Secondary)
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
    endsAt: new Date(Date.now() + (data.durationMs || DEFAULT_DURATION_MS)).toISOString(),
    createdBy: interaction.user.id
  });
  const auction = repo.getAuction(Number(result.lastInsertRowid));
  const channel = await interaction.client.channels.fetch(data.channelId || ids.channels.consultBalance);
  if (!channel?.isTextBased()) throw new Error('Canal de leilao invalido.');
  const message = await channel.send({
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
  if (isExpired(auction)) {
    throw new Error('Este leilao acabou pelo tempo limite.');
  }
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

async function updateAuctionImage({ client, auctionId, imageUrl, actorId, member }) {
  const auction = repo.getAuction(auctionId);
  if (!auction) throw new Error('Leilao nao encontrado.');
  if (auction.created_by !== actorId && !can(member, 'approvePayment')) {
    throw new Error('Somente o criador ou staff/tesouraria pode alterar a imagem deste leilao.');
  }

  repo.updateImage({ id: auctionId, imageUrl });
  const updated = repo.getAuction(auctionId);
  await refreshAuctionMessage(client, updated);
  audit.createAuditLog({
    type: 'auction_image_updated',
    actorId,
    targetId: auction.created_by,
    reason: `Leilao #${auctionId}`,
    metadata: { auctionId, imageUrl }
  });
  return updated;
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

async function refreshOpenAuctions(client) {
  const openAuctions = repo.listOpenAuctions();
  for (const auction of openAuctions) {
    const current = isExpired(auction)
      ? closeAuction({ auctionId: auction.id, actorId: client.user?.id || 'system' })
      : auction;
    await refreshAuctionMessage(client, current);
    if (current.status !== 'open' && current.current_winner_id) {
      await notifyWinner(client, current);
    }
  }
}

async function notifyWinner(client, auction) {
  const user = await client.users.fetch(auction.current_winner_id).catch(() => null);
  await user?.send(winnerMessage(auction)).catch(() => {});
}

function winnerMessage(auction) {
  return [
    `Voce venceu o leilao #${auction.id}: ${auction.item_name}.`,
    `Lance vencedor: ${formatSilver(auction.current_bid)}.`,
    auction.pickup_info ? `Retirada: ${auction.pickup_info}` : 'Combine a retirada com o criador do leilao.'
  ].join('\n');
}

function getRemainingMs(auction) {
  const endsAt = auction.ends_at ? new Date(auction.ends_at).getTime() : Date.now();
  return Math.max(0, endsAt - Date.now());
}

function isExpired(auction) {
  return auction.ends_at && getRemainingMs(auction) <= 0;
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function parseDurationMs(value) {
  const text = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!text) return DEFAULT_DURATION_MS;
  const match = text.match(/^(\d{1,3})(d|dia|dias|h|hora|horas|m|min|minuto|minutos)?$/);
  if (!match) {
    throw new Error('Tempo invalido. Use algo como 24h, 2d ou 90min.');
  }

  const amount = Number(match[1]);
  const unit = match[2] || 'h';
  const durationMs = unit.startsWith('d')
    ? amount * 24 * 60 * 60 * 1000
    : unit.startsWith('m')
      ? amount * 60 * 1000
      : amount * 60 * 60 * 1000;

  if (durationMs < MIN_DURATION_MS) {
    throw new Error('O tempo minimo do leilao e 1 minuto.');
  }
  if (durationMs > MAX_DURATION_MS) {
    throw new Error('O tempo maximo do leilao e 7 dias.');
  }
  return durationMs;
}

function isImageAttachment(attachment) {
  if (!attachment) return false;
  if (attachment.contentType?.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp)(\?\S*)?$/i.test(attachment.url || '');
}

module.exports = {
  auctionComponents,
  auctionEmbed,
  closeAuction,
  createAuctionFromModal,
  createDraft,
  formatRemaining,
  isImageAttachment,
  isExpired,
  parseDurationMs,
  placeBid,
  refreshOpenAuctions,
  refreshAuctionMessage,
  takeDraft,
  notifyWinner,
  updateAuctionImage,
  winnerMessage
};
