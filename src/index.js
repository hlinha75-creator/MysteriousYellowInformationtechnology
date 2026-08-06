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
const giveaways = require('./modules/giveaways/giveaways.service');
const seasonAnnouncement = require('./modules/albion/seasonAnnouncement.service');
const { startWebServer } = require('./web/server');
const { handleInteraction } = require('./interactions/router');
const { isExpiredOrDuplicateInteraction } = require('./utils/interactions');
const { runTasks, scheduleTaskGroups } = require('./runtime/taskScheduler');

function backgroundTask(run, errorMessage) {
  return { run, errorMessage };
}

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
  events.recoverRunningEventsOnStartup(client)
    .then((result) => {
      if (result.checked > 0) {
        console.log(`[EVENTOS] Em andamento recuperados: ${result.restored}/${result.checked}; ${result.sessions} sessao(oes) retomada(s); ${result.failed} falha(s).`);
      }
    })
    .catch((error) => console.error('Falha ao recuperar eventos em andamento:', error));
  events.repairMisroutedEventPublications(client)
    .then((eventIds) => {
      if (eventIds.length > 0) console.log(`[EVENTOS] Publicacoes movidas para ping-content: ${eventIds.length}.`);
    })
    .catch((error) => console.error('Falha ao corrigir canal de publicacao dos eventos:', error));
  events.recoverInterruptedEventReviews(client)
    .then((result) => {
      if (result.checked > 0) {
        console.log(`[EVENTOS] Revisoes verificadas no inicio: ${result.recovered}/${result.checked}; ${result.failed} falha(s).`);
      }
      return events.reconcileEventWorkflowMessages(client);
    })
    .then((result) => {
      if (result.checked > 0) {
        console.log(`[EVENTOS] Mensagens sincronizadas no inicio: ${result.review} revisao, ${result.finance} financeiro, ${result.failed} falha(s).`);
      }
    })
    .catch((error) => console.error('Falha ao reconciliar mensagens de eventos:', error));
  void runTasks([
    backgroundTask(() => balanceBackup.postDailyBackupIfNeeded(client), 'Falha ao postar backup diario de saldos:'),
    backgroundTask(() => operations.postDailyAdminReportIfNeeded(client), 'Falha ao enviar relatorio diario ADM:'),
    backgroundTask(() => operations.postReleaseAnnouncementIfNeeded(client), 'Falha ao anunciar atualizacao do bot:'),
    backgroundTask(() => operations.postWeeklyAlbionReminderIfNeeded(client), 'Falha ao postar lembrete semanal Albion:'),
    backgroundTask(() => operations.postMonthlyInactivityPreviewIfNeeded(client), 'Falha ao postar previa mensal de inatividade:'),
    backgroundTask(() => campaigns.refreshActiveCampaignProgress(client), 'Falha ao atualizar progresso da campanha:'),
    backgroundTask(() => campaigns.processExpiredEventPayouts(client), 'Falha ao processar escolhas vencidas da campanha:'),
    backgroundTask(() => guildVerification.processIdentificationNoticeQueue(client), 'Falha ao processar avisos de regularizacao:'),
    backgroundTask(() => voice.postWeeklyCoreAwardsIfNeeded(client), 'Falha ao publicar jogadores constantes:'),
    backgroundTask(() => guildReverification.postReminderIfNeeded(client), 'Falha ao processar verificacao da guilda:'),
    backgroundTask(() => dailyPveRanking.postDailyPveRankingIfNeeded(client), 'Falha ao publicar Top 5 PvE:'),
    backgroundTask(() => dailyPveRanking.postWeeklyRankingIfNeeded(client), 'Falha ao publicar ranking semanal de fama:'),
    backgroundTask(() => lochMarket.postAnnouncementIfNeeded(client), 'Falha ao publicar comunicado do mercado de Loch:'),
    backgroundTask(() => killFeed.pollKillFeed(client), 'Falha ao consultar killfeed:'),
    backgroundTask(() => giveaways.processDueGiveaways(client), 'Falha ao processar sorteios:'),
    backgroundTask(() => seasonAnnouncement.publishSeasonAnnouncement(client), 'Falha ao publicar anuncio Ouro da temporada:')
  ]);

  scheduleTaskGroups([
    { intervalMs: 60000, tasks: [backgroundTask(() => events.refreshRunningEventMessages(client), 'Falha ao atualizar eventos em andamento:')] },
    { intervalMs: 30000, tasks: [backgroundTask(() => events.checkEventStartWarnings(client), 'Falha ao verificar avisos de eventos:')] },
    { intervalMs: 30000, tasks: [backgroundTask(() => giveaways.processDueGiveaways(client), 'Falha ao processar sorteios:')] },
    { intervalMs: 30000, tasks: [backgroundTask(() => killFeed.pollKillFeed(client), 'Falha ao consultar killfeed:')] },
    { intervalMs: 10 * 60 * 1000, tasks: [backgroundTask(() => campaigns.processExpiredEventPayouts(client), 'Falha ao processar escolhas vencidas da campanha:')] },
    { intervalMs: 10 * 60 * 1000, tasks: [backgroundTask(() => campaigns.refreshActiveCampaignProgress(client), 'Falha ao atualizar progresso da campanha:')] },
    { intervalMs: 10 * 60 * 1000, tasks: [backgroundTask(() => guildVerification.processIdentificationNoticeQueue(client), 'Falha ao processar avisos de regularizacao:')] },
    { intervalMs: 60 * 60 * 1000, tasks: [backgroundTask(() => events.cleanupExpiredReviewChannels(client), 'Falha ao limpar canais de revisao:')] },
    {
      intervalMs: 60 * 60 * 1000,
      tasks: [
        backgroundTask(() => balanceBackup.postDailyBackupIfNeeded(client), 'Falha ao postar backup diario de saldos:'),
        backgroundTask(() => operations.postDailyAdminReportIfNeeded(client), 'Falha ao enviar relatorio diario ADM:'),
        backgroundTask(() => dailyPveRanking.postDailyPveRankingIfNeeded(client), 'Falha ao publicar Top 5 PvE:'),
        backgroundTask(() => dailyPveRanking.postWeeklyRankingIfNeeded(client), 'Falha ao publicar ranking semanal de fama:')
      ]
    },
    {
      intervalMs: 60 * 60 * 1000,
      tasks: [
        backgroundTask(() => operations.postWeeklyAlbionReminderIfNeeded(client), 'Falha ao postar lembrete semanal Albion:'),
        backgroundTask(() => operations.postMonthlyInactivityPreviewIfNeeded(client), 'Falha ao postar previa mensal de inatividade:'),
        backgroundTask(() => voice.postWeeklyCoreAwardsIfNeeded(client), 'Falha ao publicar jogadores constantes:'),
        backgroundTask(() => guildReverification.postReminderIfNeeded(client), 'Falha ao processar verificacao da guilda:')
      ]
    }
  ]);
});

client.on('error', (error) => {
  if (isExpiredOrDuplicateInteraction(error)) return;
  console.error('Erro no client Discord:', error);
});

const webServer = startWebServer(client);

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

process.on('exit', (code) => {
  console.log(`[PROCESSO] Encerrando com codigo ${code}.`);
});

let shuttingDown = false;
function handleShutdownSignal(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.warn(`[PROCESSO] Sinal ${signal} recebido; encerrando conexao com o Discord.`);
  const forceExit = setTimeout(() => process.exit(0), 1500);
  webServer.close();
  Promise.resolve(client.destroy())
    .catch((error) => console.error('[PROCESSO] Falha no encerramento do client Discord:', error))
    .finally(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
}

process.once('SIGTERM', () => handleShutdownSignal('SIGTERM'));
process.once('SIGINT', () => handleShutdownSignal('SIGINT'));

client.login(env.requireEnv('DISCORD_TOKEN'));
