const test = require('node:test');
const assert = require('node:assert/strict');

const seasonPoints = require('../src/modules/albion/seasonPoints.service');

test('calcula a proporcao Black do Tmaiusculo no snapshot Ouro', () => {
  const player = seasonPoints.findSeasonPlayer('tmaiusculo');
  assert.ok(player);
  assert.equal(player.rank, 1);
  assert.equal(Number(player.totalPoints.toFixed(2)), 4080.39);

  const guildChallenge = player.categories.find((category) => category.name === 'Guild Challenge');
  assert.equal(guildChallenge.amount, 2577237);
  assert.equal(Number(guildChallenge.points.toFixed(2)), 250.08);

  const keeper = player.categories.find((category) => category.name === 'Keeper Uprising');
  assert.equal(keeper.amount, 256560);
  assert.equal(Number(keeper.points.toFixed(2)), 3210.89);
});

test('expõe metadados e a lacuna conhecida sem distribuir bracket ou Personal Stats', () => {
  const ranking = seasonPoints.calculateSeasonRanking();
  assert.equal(ranking.season, 33);
  assert.equal(ranking.officialGuildPoints, 81043);
  assert.deepEqual(ranking.missingRanks['Guild Challenge'], [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50]);
  assert.equal(ranking.categories.reduce((sum, category) => sum + category.seasonPoints, 0), 81043);
  assert.equal(ranking.categories.some((category) => category.name === 'Guild Season Bracket Level Up'), false);
});
