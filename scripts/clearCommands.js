require('dotenv').config();
const { REST, Routes } = require('discord.js');
const ids = require('../src/config/ids');

async function main() {
  if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN ausente.');
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(Routes.applicationCommands(ids.clientId), { body: [] });
  console.log('Comandos globais antigos limpos.');

  await rest.put(Routes.applicationGuildCommands(ids.clientId, ids.guildId), { body: [] });
  console.log(`Comandos antigos da guild ${ids.guildId} limpos.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
