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
const guildVerification = require('./modules/albion/guildVerification.service');
const dailyPveRanking = require('./modules/albion/dailyPveRanking.service');
const killFeed = require('./modules/albion/killFeed.service');
const balanceBackup = require('./modules/csv/balanceBackup.service');
const operations = require('./modules/operations/operations.service');
const { startResourceMonitor } = require('./modules/operations/resourceMonitor');
const campaigns = require('./modules/campaigns/campaigns.service');
const guildReverification = require('./modules/members/guildReverification.service');
const lochMarket = require('./modules/community/lochMarket.service');
const hideoutDefense = require('./modules/operations/hideoutDefense.service');
const giveaways = require('./modules/giveaways/giveaways.service');
const { handleInteraction } = require('./interactions/router');
const { isExpiredOrDuplicateInteraction } = require('./utils/interactions');

migrate();
backupDatabase('startup');
startResourceMonitor();

const recovered = voice.markRunningEventsForReview();
if (recovered > 0) {
  console.log(`${recovered} evento(s) em andamento marcados como precisam de revisao apos reinicio.`);
}
const closedVoiceSessions = voice.closeOpenVoiceSessionsOnStartup();
if (closedVoiceSessions > 0) {
  console.log(`${closedVoiceSessions} sessao(oes) de voz fechada(s) apos reinicio do bot.`);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

client.once('clientReady', () => {
  console.log(`Notag bot online como ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    const botVoice = guild.members.me?.voice;
    if (botVoice?.channelId) {
      botVoice.disconnect('O bot nao deve permanecer em canais de voz').catch((error) => {
        console.error(`Falha ao retirar o bot da call no servidor ${guild.id}:`, error);
      });
    }
  }
  events.cleanupExpiredReviewChannels(client).catch((error) => console.error('Falha ao limpar canais de revisao:', error));
  balanceBackup.postDailyBackupIfNeeded(client).catch((error) => console.error('Falha ao postar backup diario de saldos:', error));
  operations.postDailyAdminReportIfNeeded(client).catch((error) => console.error('Falha ao enviar relatorio diario ADM:', error));
  operations.postReleaseAnnouncementIfNeeded(client).catch((error) => console.error('Falha ao anunciar atualizacao do bot:', error));
  operations.postWeeklyAlbionReminderIfNeeded(client).catch((error) => console.error('Falha ao postar lembrete semanal Albion:', error));
  operations.postMonthlyInactivityPreviewIfNeeded(client).catch((error) => console.error('Falha ao postar previa mensal de inatividade:', error));
  campaigns.refreshActiveCampaignProgress(client).catch((error) => console.error('Falha ao atualizar progresso da campanha:', error));
  campaigns.processExpiredEventPayouts(client).catch((error) => console.error('Falha ao processar escolhas vencidas da campanha:', error));
  guildVerification.processIdentificationNoticeQueue(client).catch((error) => console.error('Falha ao processar avisos de regularizacao:', error));
  voice.postWeeklyCoreAwardsIfNeeded(client).catch((error) => console.error('Falha ao publicar jogadores constantes:', error));
  guildReverification.postReminderIfNeeded(client).catch((error) => console.error('Falha ao processar verificacao da guilda:', error));
  dailyPveRanking.postDailyPveRankingIfNeeded(client).catch((error) => console.error('Falha ao publicar Top 5 PvE:', error));
  dailyPveRanking.postWeeklyRankingIfNeeded(client).catch((error) => console.error('Falha ao publicar ranking semanal de fama:', error));
  lochMarket.postAnnouncementIfNeeded(client).catch((error) => console.error('Falha ao publicar comunicado do mercado de Loch:', error));
  hideoutDefense.postAnnouncementIfNeeded(client).catch((error) => console.error('Falha ao publicar aviso da defesa da HO:', error));
  killFeed.pollKillFeed(client).catch((error) => console.error('Falha ao consultar killfeed:', error));
  giveaways.processDueGiveaways(client).catch((error) => console.error('Falha ao processar sorteios:', error));
  setInterval(() => {
    events.refreshRunningEventMessages(client).catch((error) => console.error('Falha ao atualizar eventos em andamento:', error));
  }, 60000);
  setInterval(() => {
    events.checkEventStartWarnings(client).catch((error) => console.error('Falha ao verificar avisos de eventos:', error));
  }, 30000);
  setInterval(() => {
    giveaways.processDueGiveaways(client).catch((error) => console.error('Falha ao processar sorteios:', error));
  }, 30000);
  setInterval(() => {
    killFeed.pollKillFeed(client).catch((error) => console.error('Falha ao consultar killfeed:', error));
  }, 30000);
  setInterval(() => {
    campaigns.processExpiredEventPayouts(client).catch((error) => console.error('Falha ao processar escolhas vencidas da campanha:', error));
  }, 10 * 60 * 1000);
  setInterval(() => {
    campaigns.refreshActiveCampaignProgress(client).catch((error) => console.error('Falha ao atualizar progresso da campanha:', error));
  }, 10 * 60 * 1000);
  setInterval(() => {
    guildVerification.processIdentificationNoticeQueue(client).catch((error) => console.error('Falha ao processar avisos de regularizacao:', error));
  }, 10 * 60 * 1000);
  setInterval(() => {
    events.cleanupExpiredReviewChannels(client).catch((error) => console.error('Falha ao limpar canais de revisao:', error));
  }, 60 * 60 * 1000);
  setInterval(() => {
    balanceBackup.postDailyBackupIfNeeded(client).catch((error) => console.error('Falha ao postar backup diario de saldos:', error));
    operations.postDailyAdminReportIfNeeded(client).catch((error) => console.error('Falha ao enviar relatorio diario ADM:', error));
    dailyPveRanking.postDailyPveRankingIfNeeded(client).catch((error) => console.error('Falha ao publicar Top 5 PvE:', error));
    dailyPveRanking.postWeeklyRankingIfNeeded(client).catch((error) => console.error('Falha ao publicar ranking semanal de fama:', error));
  }, 60 * 60 * 1000);
  setInterval(() => {
    operations.postWeeklyAlbionReminderIfNeeded(client).catch((error) => console.error('Falha ao postar lembrete semanal Albion:', error));
    operations.postMonthlyInactivityPreviewIfNeeded(client).catch((error) => console.error('Falha ao postar previa mensal de inatividade:', error));
    voice.postWeeklyCoreAwardsIfNeeded(client).catch((error) => console.error('Falha ao publicar jogadores constantes:', error));
    guildReverification.postReminderIfNeeded(client).catch((error) => console.error('Falha ao processar verificacao da guilda:', error));
  }, 60 * 60 * 1000);
});

client.on('error', (error) => {
  if (isExpiredOrDuplicateInteraction(error)) return;
  console.error('Erro no client Discord:', error);
});

client.on('guildMemberAdd', registration.handleGuildMemberAdd);
client.on('guildMemberRemove', registration.handleGuildMemberRemove);
client.on('voiceStateUpdate', voice.handleVoiceStateUpdate);
client.on('voiceStateUpdate', (_oldState, newState) => {
  if (newState.id !== client.user.id || !newState.channelId) return;
  newState.disconnect('O bot nao deve permanecer em canais de voz').catch((error) => {
    console.error(`Falha ao retirar o bot da call no servidor ${newState.guild.id}:`, error);
  });
});
client.on('interactionCreate', handleInteraction);
client.on('messageCreate', (message) => {
  guildVerification.handleDirectNickReply(message).catch((error) => console.error('Falha ao tratar resposta de nick por DM:', error));
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

client.login(env.requireEnv('DISCORD_TOKEN'));
