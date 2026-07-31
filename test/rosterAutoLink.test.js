const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notag-roster-link-test-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempRoot, 'roster-link.sqlite');

const { getDatabase } = require('../src/database/connection');
const { migrate } = require('../src/database/migrate');
const { buildMatchPlan, normalizeName, similarity } = require('../src/modules/members/rosterAutoLink.service');

migrate();
test.after(() => {
  getDatabase().close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function discordMember(id, username, displayName = username) {
  return {
    id,
    displayName,
    nickname: null,
    user: { id, username, globalName: null, bot: false }
  };
}

test('normaliza nomes de Discord sem pontuação, espaços ou acentos', () => {
  assert.equal(normalizeName('!Tmáiusculo (hlinha)'), 'tmaiusculohlinha');
  assert.ok(similarity('NewHero', 'NewHer0') >= 0.84);
});

test('nome exato e único entra no plano automático', () => {
  const plan = buildMatchPlan(
    [{ characterName: 'SoulTavio' }],
    [discordMember('1', 'SoulTavio'), discordMember('2', 'Outro')],
    []
  );
  assert.equal(plan.automatic.length, 1);
  assert.equal(plan.automatic[0].discordId, '1');
  assert.equal(plan.confirmation.length, 0);
  assert.equal(plan.pending.length, 0);
});

test('nome parecido exige confirmação e não promove automaticamente', () => {
  const plan = buildMatchPlan(
    [{ characterName: 'NewHero' }],
    [discordMember('1', 'NewHer0'), discordMember('2', 'CompletamenteOutro')],
    []
  );
  assert.equal(plan.automatic.length, 0);
  assert.equal(plan.confirmation.length, 1);
  assert.equal(plan.confirmation[0].discordId, '1');
});

test('nomes exatos duplicados ficam para revisão da staff', () => {
  const plan = buildMatchPlan(
    [{ characterName: 'Spotk' }],
    [discordMember('1', 'Spotk'), discordMember('2', 'Spotk')],
    []
  );
  assert.equal(plan.automatic.length, 0);
  assert.equal(plan.confirmation.length, 0);
  assert.equal(plan.pending.length, 1);
  assert.match(plan.pending[0].reason, /Mais de uma/);
});

test('uma conta Discord que representa dois personagens da lista não é promovida sozinha', () => {
  const member = discordMember('1', 'AltHero', 'MainHero (AltHero)');
  const plan = buildMatchPlan(
    [{ characterName: 'MainHero' }, { characterName: 'AltHero' }],
    [member],
    []
  );
  assert.equal(plan.automatic.length, 0);
  assert.equal(plan.confirmation.length, 0);
  assert.equal(plan.pending.length, 2);
});

test('não reaproveita Discord ou personagem que já possui outro vínculo', () => {
  const plan = buildMatchPlan(
    [{ characterName: 'CharacterB' }, { characterName: 'CharacterC' }],
    [discordMember('1', 'CharacterB'), discordMember('2', 'CharacterC')],
    [
      { discord_id: '1', albion_name: 'CharacterA' },
      { discord_id: '3', albion_name: 'CharacterC' }
    ]
  );
  assert.equal(plan.automatic.length, 0);
  assert.equal(plan.confirmation.length, 0);
  assert.equal(plan.pending.length, 1);
  assert.equal(plan.pending[0].characterName, 'CharacterB');
});
