const {
  Client,
  GatewayIntentBits,
  Partials
} = require('discord.js');
const env = require('./config/env');
const { migrate } = require('./database/migrate');
const { backupDatabase } = require('./database/backup');
const registration = require('./modules/registration/registration.service');
const voice = require('./modules/voice/voice.service');
const events = require('./modules/events/events.service');
const { handleInteraction } = require('./interactions/router');

migrate();
backupDatabase('startup');

const recovered = voice.markRunningEventsForReview();
if (recovered > 0) {
  console.log(`${recovered} evento(s) em andamento marcados como precisam de revisao apos reinicio.`);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

client.once('clientReady', () => {
  console.log(`Notag bot online como ${client.user.tag}`);
  setInterval(() => {
    events.refreshRunningEventMessages(client).catch((error) => console.error('Falha ao atualizar eventos em andamento:', error));
  }, 60000);
  setInterval(() => {
    events.checkEventStartWarnings(client).catch((error) => console.error('Falha ao verificar avisos de eventos:', error));
  }, 30000);
});

client.on('error', (error) => {
  console.error('Erro no client Discord:', error);
});

client.on('guildMemberAdd', registration.handleGuildMemberAdd);
client.on('voiceStateUpdate', voice.handleVoiceStateUpdate);
client.on('interactionCreate', handleInteraction);

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

client.login(env.requireEnv('DISCORD_TOKEN'));
