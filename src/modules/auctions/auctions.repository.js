const { getDatabase } = require('../../database/connection');

function createAuction({ itemName, imageUrl, pickupInfo, startingBid, minIncrement, endsAt, createdBy }) {
  return getDatabase()
    .prepare(`
      INSERT INTO auctions
        (item_name, image_url, pickup_info, starting_bid, min_increment, current_bid, ends_at, created_by)
      VALUES
        (@itemName, @imageUrl, @pickupInfo, @startingBid, @minIncrement, @startingBid, @endsAt, @createdBy)
    `)
    .run({
      itemName,
      imageUrl: imageUrl || null,
      pickupInfo: pickupInfo || null,
      startingBid,
      minIncrement,
      endsAt,
      createdBy
    });
}

function getAuction(id) {
  return getDatabase().prepare('SELECT * FROM auctions WHERE id = ?').get(id);
}

function updateAuctionMessage({ id, channelId, messageId }) {
  return getDatabase()
    .prepare('UPDATE auctions SET channel_id = ?, message_id = ? WHERE id = ?')
    .run(channelId, messageId, id);
}

function insertBid({ auctionId, userId, amount }) {
  return getDatabase()
    .prepare('INSERT INTO auction_bids (auction_id, user_id, amount) VALUES (?, ?, ?)')
    .run(auctionId, userId, amount);
}

function updateCurrentBid({ id, userId, amount }) {
  return getDatabase()
    .prepare('UPDATE auctions SET current_bid = ?, current_winner_id = ? WHERE id = ?')
    .run(amount, userId, id);
}

function updateImage({ id, imageUrl }) {
  return getDatabase()
    .prepare('UPDATE auctions SET image_url = ? WHERE id = ?')
    .run(imageUrl || null, id);
}

function closeAuction({ id, closedBy }) {
  return getDatabase()
    .prepare("UPDATE auctions SET status = 'closed', closed_by = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(closedBy, id);
}

function listOpenAuctions() {
  return getDatabase()
    .prepare("SELECT * FROM auctions WHERE status = 'open' ORDER BY id ASC")
    .all();
}

function listBids(auctionId, limit = 5) {
  return getDatabase()
    .prepare('SELECT * FROM auction_bids WHERE auction_id = ? ORDER BY amount DESC, id ASC LIMIT ?')
    .all(auctionId, limit);
}

module.exports = {
  closeAuction,
  createAuction,
  getAuction,
  insertBid,
  listOpenAuctions,
  listBids,
  updateImage,
  updateAuctionMessage,
  updateCurrentBid
};
