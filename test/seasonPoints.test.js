const test = require('node:test');
const assert = require('node:assert/strict');

const seasonPoints = require('../src/modules/albion/seasonPoints.service');

test('calcula a proporcao Black do Tmaiusculo no snapshot Ouro', () => {
  const player = seasonPoints.findSeasonPlayer('tmaiusculo');
  assert.ok(player);
  assert.equal(player.rank, 1);
  assert.equal(Number(player.totalPoints.toFixed(2)), 4080.23);

  const guildChallenge = player.categories.find((category) => category.name === 'Guild Challenge');
  assert.equal(guildChallenge.amount, 2577237);
  assert.equal(Number(guildChallenge.points.toFixed(2)), 249.91);

  const keeper = player.categories.find((category) => category.name === 'Keeper Uprising');
  assert.equal(keeper.amount, 256560);
  assert.equal(Number(keeper.points.toFixed(2)), 3210.89);
});

test('expõe o snapshot completo sem distribuir bracket ou Personal Stats', () => {
  const ranking = seasonPoints.calculateSeasonRanking();
  assert.equal(ranking.season, 33);
  assert.equal(ranking.officialGuildPoints, 81043);
  assert.deepEqual(ranking.missingRanks, {});
  const challenge = ranking.categories.find((category) => category.name === 'Guild Challenge');
  assert.equal(challenge.totalAmount, 136126000);
  assert.equal(ranking.rows.find((row) => row.name === 'jordansPt').categories.some((category) => category.amount === 988349), true);
  assert.equal(ranking.categories.reduce((sum, category) => sum + category.seasonPoints, 0), 81043);
  assert.equal(ranking.categories.some((category) => category.name === 'Guild Season Bracket Level Up'), false);
});

test('cada ranking de categoria possui uma linha por personagem e colocação', () => {
  const snapshot = require('../data/season33/snapshot-gold.json');
  for (const category of snapshot.categories) {
    const names = category.rows.map((row) => row.player.trim().toLocaleLowerCase('pt-BR'));
    const ranks = category.rows.map((row) => row.rank);
    assert.equal(new Set(names).size, names.length, `${category.name} contém personagem duplicado`);
    assert.equal(new Set(ranks).size, ranks.length, `${category.name} contém colocação duplicada`);
  }
});
