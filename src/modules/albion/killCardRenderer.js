const { createCanvas, loadImage, clearAllCache } = require('@napi-rs/canvas');

const WIDTH = 1200;
const SLOT = 76;
const MAX_ICON_CACHE_ENTRIES = positiveInteger(process.env.KILLFEED_ICON_CACHE_ENTRIES, 64);
const MAX_ICON_CACHE_BYTES = positiveInteger(process.env.KILLFEED_ICON_CACHE_MB, 8) * 1048576;
const ICON_CACHE_TTL_MS = positiveInteger(process.env.KILLFEED_ICON_CACHE_TTL_MINUTES, 30) * 60 * 1000;
const iconCache = new Map();
let iconCacheBytes = 0;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function itemUrl(item) {
  return `https://render.albiononline.com/v1/item/${encodeURIComponent(item.Type)}.png?quality=${Number(item.Quality || 1)}`;
}

function deleteCachedIcon(key) {
  const entry = iconCache.get(key);
  if (!entry) return;
  iconCacheBytes = Math.max(0, iconCacheBytes - Number(entry.bytes || 0));
  iconCache.delete(key);
}

function trimIconCache(now = Date.now()) {
  for (const [key, entry] of iconCache) {
    if (now - entry.lastUsedAt > ICON_CACHE_TTL_MS) deleteCachedIcon(key);
  }
  while (iconCache.size > MAX_ICON_CACHE_ENTRIES || iconCacheBytes > MAX_ICON_CACHE_BYTES) {
    const oldestKey = iconCache.keys().next().value;
    if (oldestKey === undefined) break;
    deleteCachedIcon(oldestKey);
  }
}

function clearIconCache() {
  iconCache.clear();
  iconCacheBytes = 0;
  clearAllCache();
}

function getIconCacheStats() {
  return {
    entries: iconCache.size,
    bytes: iconCacheBytes,
    maxEntries: MAX_ICON_CACHE_ENTRIES,
    maxBytes: MAX_ICON_CACHE_BYTES
  };
}

async function itemIconBuffer(item, fetchImpl = fetch) {
  if (!item?.Type) return null;
  const key = `${item.Type}:${item.Quality || 1}`;
  const cached = iconCache.get(key);
  if (cached) {
    cached.lastUsedAt = Date.now();
    // Reinsert so Map order also works as a small LRU queue.
    iconCache.delete(key);
    iconCache.set(key, cached);
    return cached.promise;
  }
  trimIconCache();
  const entry = { bytes: 0, lastUsedAt: Date.now(), promise: null };
  const promise = (async () => {
    try {
      const response = await fetchImpl(itemUrl(item));
      if (!response.ok) return null;
      return Buffer.from(await response.arrayBuffer());
    } catch (_) {
      return null;
    }
  })().then((buffer) => {
    if (!buffer) {
      deleteCachedIcon(key);
      return null;
    }
    if (iconCache.get(key) === entry) {
      entry.bytes = buffer.length;
      iconCacheBytes += buffer.length;
      trimIconCache();
    }
    return buffer;
  });
  entry.promise = promise;
  iconCache.set(key, entry);
  trimIconCache();
  return promise;
}

async function itemIcon(item, fetchImpl, renderImageCache) {
  if (!item?.Type) return null;
  const key = `${item.Type}:${item.Quality || 1}`;
  if (!renderImageCache.has(key)) {
    renderImageCache.set(key, itemIconBuffer(item, fetchImpl).then((buffer) => (
      buffer ? loadImage(buffer) : null
    )));
  }
  return renderImageCache.get(key);
}

function fitText(ctx, text, maxWidth, startSize = 25) {
  let size = startSize;
  do {
    ctx.font = `bold ${size}px Arial`;
    if (ctx.measureText(String(text)).width <= maxWidth) return size;
    size -= 1;
  } while (size >= 13);
  return size;
}

function roundedRect(ctx, x, y, width, height, radius, fill) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
}

async function drawItem(ctx, item, x, y, size = SLOT, fetchImpl = fetch, renderImageCache = new Map()) {
  roundedRect(ctx, x, y, size, size, 9, item ? '#9c8069' : '#bca28a');
  if (!item) return;
  const icon = await itemIcon(item, fetchImpl, renderImageCache);
  if (icon) ctx.drawImage(icon, x + 2, y + 2, size - 4, size - 4);
  if (Number(item.Count || 1) > 1) {
    const count = String(item.Count);
    ctx.font = 'bold 17px Arial';
    const width = ctx.measureText(count).width + 12;
    roundedRect(ctx, x + size - width - 4, y + size - 25, width, 21, 6, 'rgba(18,18,18,.82)');
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(count, x + size - width / 2 - 4, y + size - 9);
  }
}

async function drawEquipment(ctx, player, startX, fetchImpl, renderImageCache) {
  const equipment = player?.Equipment || {};
  const layout = [
    ['MainHand', 0, 1], ['Head', 1, 0], ['Armor', 1, 1], ['Shoes', 1, 2],
    ['OffHand', 2, 1], ['Bag', 0, 0], ['Cape', 2, 0], ['Mount', 0, 2], ['Potion', 2, 2]
  ];
  await Promise.all(layout.map(([key, col, row]) => drawItem(
    ctx, equipment[key], startX + col * (SLOT + 8), 116 + row * (SLOT + 8), SLOT, fetchImpl, renderImageCache
  )));
}

function playerHeading(ctx, player, centerX) {
  const name = player?.Name || 'Desconhecido';
  fitText(ctx, name, 350, 27);
  ctx.fillStyle = '#211b18';
  ctx.textAlign = 'center';
  ctx.fillText(name, centerX, 49);
  const guildText = `${player?.AllianceName ? `[${player.AllianceName}] ` : ''}${player?.GuildName || 'Sem guilda'}`;
  fitText(ctx, guildText, 350, 18);
  ctx.fillStyle = '#57473e';
  ctx.fillText(guildText, centerX, 75);
  ctx.font = 'bold 17px Arial';
  ctx.fillText(`IP ${Math.round(Number(player?.AverageItemPower || 0))}`, centerX, 99);
}

async function renderKillCard(event, type, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const renderImageCache = new Map();
  try {
  const allInventory = (event.Victim?.Inventory || []).filter(Boolean);
  const inventory = allInventory.slice(0, 20);
  const height = inventory.length > 10 ? 650 : 550;
  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d4b59a';
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.strokeStyle = '#8c6750';
  ctx.lineWidth = 5;
  ctx.strokeRect(3, 3, WIDTH - 6, height - 6);

  playerHeading(ctx, event.Killer, 220);
  playerHeading(ctx, event.Victim, 980);
  await Promise.all([
    drawEquipment(ctx, event.Killer, 90, fetchImpl, renderImageCache),
    drawEquipment(ctx, event.Victim, 850, fetchImpl, renderImageCache)
  ]);

  roundedRect(ctx, 375, 112, 450, 278, 18, 'rgba(242, 220, 199, .58)');
  ctx.textAlign = 'center';
  ctx.fillStyle = type === 'death' ? '#7f1d1d' : '#14532d';
  ctx.font = 'bold 40px Arial';
  ctx.fillText(type === 'death' ? 'DEATH' : 'KILL', 600, 166);
  ctx.strokeStyle = 'rgba(112, 84, 68, .35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(425, 184);
  ctx.lineTo(775, 184);
  ctx.stroke();
  ctx.fillStyle = '#372820';
  ctx.font = 'bold 13px Arial';
  ctx.fillText('FAMA DE ABATE', 600, 207);
  ctx.font = 'bold 23px Arial';
  ctx.fillText(new Intl.NumberFormat('pt-BR').format(Number(event.TotalVictimKillFame || 0)), 600, 235);
  if (Number(options.estimatedLoss || 0) > 0) {
    ctx.fillStyle = '#6b4f12';
    ctx.font = 'bold 13px Arial';
    ctx.fillText('PERDA ESTIMADA', 600, 264);
    const lossText = `~ ${new Intl.NumberFormat('pt-BR').format(options.estimatedLoss)} PRATA`;
    fitText(ctx, lossText, 390, 24);
    ctx.fillText(lossText, 600, 294);
  }
  ctx.fillStyle = '#372820';
  ctx.font = '17px Arial';
  ctx.fillText(`${event.numberOfParticipants || event.Participants?.length || 1} participante(s)`, 600, 326);
  const when = event.TimeStamp ? new Date(event.TimeStamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
  ctx.fillText(when, 600, 351);
  ctx.font = 'bold 14px Arial';
  ctx.fillStyle = '#705444';
  ctx.fillText(`Evento #${event.EventId} - NOTAG KILLFEED`, 600, 376);

  ctx.fillStyle = '#372820';
  ctx.font = 'bold 20px Arial';
  ctx.fillText('INVENTÁRIO DA VÍTIMA', 600, 421);
  const totalWidth = 10 * (SLOT + 8) - 8;
  const originX = (WIDTH - totalWidth) / 2;
  const slots = Math.max(10, inventory.length);
  await Promise.all(Array.from({ length: Math.min(20, slots) }, (_, index) => drawItem(
    ctx,
    inventory[index],
    originX + (index % 10) * (SLOT + 8),
    440 + Math.floor(index / 10) * (SLOT + 8),
    SLOT,
    fetchImpl,
    renderImageCache
  )));
  if (allInventory.length > 20) {
    ctx.fillStyle = '#7f1d1d';
    ctx.font = 'bold 15px Arial';
    ctx.fillText(`+${allInventory.length - 20} itens no link do evento`, 600, height - 13);
  }
  const output = canvas.toBuffer('image/png');
  return output;
  } finally {
    // Drop decoded per-card images and Skia's internal caches even if drawing
    // or PNG encoding fails. The persistent cache stores compressed buffers.
    renderImageCache.clear();
    clearAllCache();
  }
}

module.exports = { clearIconCache, getIconCacheStats, renderKillCard };
