const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('todo comando registrado possui handler e comandos removidos nao voltam', () => {
  const commands = require('../src/commands/definitions');
  const handler = fs.readFileSync(path.join(root, 'src/commands/handlers.js'), 'utf8');
  for (const command of commands) {
    assert.match(handler, new RegExp(`interaction\\.commandName === ['"]${command.name}['"]`), `handler ausente para /${command.name}`);
  }

  for (const removed of ['objetivo', 'list', 'albion', 'relatorio_diario', 'renomear_canais', 'auditar_canais']) {
    assert.equal(commands.some((command) => command.name === removed), false, `/${removed} nao deve ser registrado`);
    assert.doesNotMatch(handler, new RegExp(`interaction\\.commandName === ['"]${removed}['"]`), `handler antigo de /${removed} voltou`);
  }
});

test('recursos pontuais removidos nao possuem handlers no runtime', () => {
  const buttons = fs.readFileSync(path.join(root, 'src/interactions/buttons.js'), 'utf8');
  const memberPanel = fs.readFileSync(path.join(root, 'src/modules/members/memberPanel.service.js'), 'utf8');
  assert.doesNotMatch(buttons, /hideoutDefense|hideout-defense:sunstrand/i);
  assert.doesNotMatch(memberPanel, /member_panel:builds|buildsEmbed|buildCatalog|img pendente/i);
});

test('arquivo de release participa do gatilho e do pacote de deploy', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-discloud.yml'), 'utf8');
  const ignore = fs.readFileSync(path.join(root, '.discloudignore'), 'utf8');
  assert.match(workflow, /- "RELEASE\.json"/);
  assert.doesNotMatch(ignore, /^RELEASE\.json$/m);
});

test('emojis de suporte usam os IDs confirmados', () => {
  const events = fs.readFileSync(path.join(root, 'src/modules/events/events.service.js'), 'utf8');
  assert.match(events, /Shadow[^\n]+1517097701148459131/);
  assert.match(events, /Damnation[^\n]+1517097839107379211/);
  assert.match(events, /Enig[^\n]+1517098127490940968/);
});
