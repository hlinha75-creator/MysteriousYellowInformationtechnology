const { handleCommand } = require('../commands/handlers');
const { handleButton } = require('./buttons');
const { handleModal } = require('./modals');
const { handleSelect } = require('./selects');
const events = require('../modules/events/events.service');
const { MessageFlags } = require('discord.js');

async function handleInteraction(interaction) {
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
    const message = error.message || 'Erro inesperado.';
    if (!isUserFacingError(error)) {
      console.error('Erro em interaction:', error);
    }
    const payload = { content: `Erro: ${message}`, flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) return interaction.followUp(payload).catch(() => {});
    return interaction.reply(payload).catch(() => {});
  }
}

function isUserFacingError(error) {
  return error?.isUserFacing === true;
}

module.exports = {
  handleInteraction
};
