const { EmbedBuilder } = require('discord.js');

async function safeSend(client, channelId, payload) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return null;
    return channel.send(payload);
  } catch (error) {
    console.error(`Falha ao enviar mensagem no canal ${channelId}:`, error);
    return null;
  }
}

function baseEmbed(title) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(0x2f855a)
    .setTimestamp(new Date());
}

module.exports = {
  baseEmbed,
  safeSend
};
