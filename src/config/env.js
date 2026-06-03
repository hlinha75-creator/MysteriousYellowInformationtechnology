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
  nodeEnv: process.env.NODE_ENV || 'development'
};
