require('dotenv').config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variavel de ambiente ausente: ${name}`);
  }
  return value;
}

module.exports = {
  token: process.env.DISCORD_TOKEN,
  requireEnv,
  databasePath: process.env.DATABASE_PATH || './data/notag.sqlite',
  nodeEnv: process.env.NODE_ENV || 'development',
  idleHostUserIds: (process.env.IDLE_HOST_USER_IDS || process.env.IDLE_HOST_USER_ID || '1276439186513203234,1436716667894759475')
    .split(',').map((id) => id.trim()).filter(Boolean),
  idleTopicId: process.env.IDLE_TOPIC_ID || '1525824031784304770',
  dashboardPort: Number(process.env.DASHBOARD_PORT || 8081)
};
