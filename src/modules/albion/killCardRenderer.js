const { createCanvas, loadImage } = require('@napi-rs/canvas');

const WIDTH = 1000;
const SLOT = 76;
const iconCache = new Map();

function itemUrl(item) {
  return `https://render.albiononline.com/v1/item/${encodeURIComponent(item.Type)}.png?quality=${Number(item.Quality || 1)}`;
}

async function itemIcon(item, fetchImpl = fetch) {
  if (!item?.Type) return null;
  const key = `${item.Type}:${item.Quality || 1}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const promise = (async () => {
    try {
      const response = await fetchImpl(itemUrl(item));
      if (!response.ok) return null;
      return loadImage(Buffer.from(await response.arrayBuffer()));
    } catch (_) {
      return null;
    }
  })();
  iconCache.set(key, promise);
  if (iconCache.size > 500) iconCache.delete(iconCache.keys().next().value);
  return promise;
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

async function drawItem(ctx, item, x, y, size = SLOT, fetchImpl = fetch) {
  roundedRect(ctx, x, y, size, size, 9, item ? '#9c8069' : '#bca28a');
  if (!item) return;
  const icon = await itemIcon(item, fetchImpl);
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

async function drawEquipment(ctx, player, startX, fetchImpl) {
  const equipment = player?.Equipment || {};
  const layout = [
    ['MainHand', 0, 1], ['Head', 1, 0], ['Armor', 1, 1], ['Shoes', 1, 2],
    ['OffHand', 2, 1], ['Bag', 0, 0], ['Cape', 2, 0], ['Mount', 0, 2], ['Potion', 2, 2]
  ];
  await Promise.all(layout.map(([key, col, row]) => drawItem(
    ctx, equipment[key], startX + col * (SLOT + 8), 116 + row * (SLOT + 8), SLOT, fetchImpl
  )));
}

function playerHeading(ctx, player, centerX) {
  const name = player?.Name || 'Desconhecido';
  fitText(ctx, name, 360, 27);
  ctx.fillStyle = '#211b18';
  ctx.textAlign = 'center';
  ctx.fillText(name, centerX, 49);
  ctx.font = '18px Arial';
  ctx.fillStyle = '#57473e';
  const guild = player?.GuildName || 'Sem guilda';
  const alliance = player?.AllianceName ? `[${player.AllianceName}] ` : '';
  ctx.fillText(`${alliance}${guild}`, centerX, 75);
  ctx.font = 'bold 17px Arial';
  ctx.fillText(`IP ${Math.round(Number(player?.AverageItemPower || 0))}`, centerX, 99);
}

async function renderKillCard(event, type, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const inventory = (event.Victim?.Inventory || []).filter(Boolean).slice(0, 16);
  const height = inventory.length > 8 ? 650 : 550;
  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d4b59a';
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.strokeStyle = '#8c6750';
  ctx.lineWidth = 5;
  ctx.strokeRect(3, 3, WIDTH - 6, height - 6);

  playerHeading(ctx, event.Killer, 225);
  playerHeading(ctx, event.Victim, 775);
  await Promise.all([
    drawEquipment(ctx, event.Killer, 95, fetchImpl),
    drawEquipment(ctx, event.Victim, 645, fetchImpl)
  ]);

  ctx.textAlign = 'center';
  ctx.fillStyle = type === 'death' ? '#7f1d1d' : '#14532d';
  ctx.font = 'bold 38px Arial';
  ctx.fillText(type === 'death' ? 'DEATH' : 'KILL', 500, 196);
  ctx.fillStyle = '#372820';
  ctx.font = 'bold 21px Arial';
  ctx.fillText(`${new Intl.NumberFormat('pt-BR').format(Number(event.TotalVictimKillFame || 0))} FAMA`, 500, 235);
  if (Number(options.estimatedLoss || 0) > 0) {
    ctx.fillStyle = '#6b4f12';
    ctx.font = 'bold 20px Arial';
    ctx.fillText(`~ ${new Intl.NumberFormat('pt-BR').format(options.estimatedLoss)} PRATA PERDIDA`, 500, 263);
  }
  ctx.fillStyle = '#372820';
  ctx.font = '17px Arial';
  ctx.fillText(`${event.numberOfParticipants || event.Participants?.length || 1} participante(s)`, 500, 289);
  const when = event.TimeStamp ? new Date(event.TimeStamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
  ctx.fillText(when, 500, 314);
  ctx.font = 'bold 15px Arial';
  ctx.fillStyle = '#705444';
  ctx.fillText(`Evento #${event.EventId} • NOTAG KILLFEED`, 500, 340);

  ctx.fillStyle = '#372820';
  ctx.font = 'bold 20px Arial';
  ctx.fillText('INVENTÁRIO DA VÍTIMA', 500, 409);
  const totalWidth = 8 * (SLOT + 8) - 8;
  const originX = (WIDTH - totalWidth) / 2;
  const slots = Math.max(8, inventory.length);
  await Promise.all(Array.from({ length: Math.min(16, slots) }, (_, index) => drawItem(
    ctx,
    inventory[index],
    originX + (index % 8) * (SLOT + 8),
    430 + Math.floor(index / 8) * (SLOT + 8),
    SLOT,
    fetchImpl
  )));
  if (event.Victim?.Inventory?.filter(Boolean).length > 16) {
    ctx.fillStyle = '#7f1d1d';
    ctx.font = 'bold 15px Arial';
    ctx.fillText(`+${event.Victim.Inventory.filter(Boolean).length - 16} itens no link do evento`, 500, height - 13);
  }
  return canvas.toBuffer('image/png');
}

module.exports = { renderKillCard };
