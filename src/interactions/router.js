const { handleCommand } = require('../commands/handlers');
const { handleButton } = require('./buttons');
const { handleModal } = require('./modals');
const { handleSelect } = require('./selects');
const events = require('../modules/events/events.service');
const analytics = require('../modules/analytics/analytics.service');
const { MessageFlags } = require('discord.js');

async function handleInteraction(interaction) {
  analytics.trackInteraction(interaction);

  try {
    if (interaction.isChatInputCommand()) return await handleCommand(interaction);
    if (interaction.isButton()) return await handleButton(interaction);
    if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu() || interaction.isChannelSelectMenu()) return await handleSelect(interaction);
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('event:cancel_modal:')) {
        const eventId = Number(interaction.customId.split(':')[2]);
        const reason = interaction.fields.getTextInputValue('reason');
        await events.cancelEvent(interaction, eventId, reason);
        return interaction.reply({ content: 'Evento cancelado.', flags: MessageFlags.Ephemeral });
      }
      return await handleModal(interaction);
    }
  } catch (error) {
    if (error.code === 10062 || error.code === 40060) return;
    const message = readableInteractionError(error);
    if (!isUserFacingError(error)) {
      console.error('Erro em interaction:', error);
    }
    const payload = { content: `Erro: ${message}`, flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) return interaction.followUp(payload).catch(() => {});
    return interaction.reply(payload).catch(() => {});
  }
}

function isUserFacingError(error) {
  return error?.isUserFacing === true || (error instanceof Error && error.name === 'Error' && !error.code);
}

function readableInteractionError(error) {
  const details = collectErrorMessages(error);
  if (details.length > 0) return details.slice(0, 3).join(' | ');
  return error.message || 'Erro inesperado.';
}

function collectErrorMessages(error) {
  const messages = [];
  if (error?.errors instanceof Map) {
    for (const value of error.errors.values()) {
      messages.push(...collectErrorMessages(value));
    }
  }
  if (Array.isArray(error?.errors)) {
    for (const value of error.errors) {
      messages.push(...collectErrorMessages(value));
    }
  }
  if (Array.isArray(error)) {
    for (const value of error) {
      messages.push(...collectErrorMessages(value));
    }
  }
  if (error?.message && error.message !== 'Received one or more errors') {
    messages.push(error.message);
  }
  return [...new Set(messages.map((message) => String(message).slice(0, 220)))];
}

module.exports = {
  handleInteraction
};
