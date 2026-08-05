const assert = require('node:assert/strict');
const test = require('node:test');

const { embedFieldValue, embedLinesFields } = require('../src/modules/events/eventPresentation');

test('campo de embed normaliza valor vazio e limita texto longo', () => {
  assert.equal(embedFieldValue('   '), '-');
  assert.equal(embedFieldValue('texto curto'), 'texto curto');

  const truncated = embedFieldValue('x'.repeat(80), 40);
  assert.equal(truncated.length, 38);
  assert.match(truncated, /\.\.\. texto cortado$/);
});

test('linhas de embed sao divididas em campos dentro do limite', () => {
  const fields = embedLinesFields('Participantes', [' primeiro ', '', 'segundo', 'terceiro'], 'Nenhum', 16);

  assert.deepEqual(fields, [
    { name: 'Participantes', value: 'primeiro\nsegundo', inline: false },
    { name: 'Participantes 2', value: 'terceiro', inline: false }
  ]);
  assert.equal(fields.every(({ value }) => value.length <= 16), true);
});

test('linhas de embed retornam vazio seguro, truncam itens e respeitam vinte campos', () => {
  assert.deepEqual(embedLinesFields('Itens', [], 'Nenhum'), [
    { name: 'Itens', value: 'Nenhum', inline: false }
  ]);

  const longLine = embedLinesFields('Itens', ['x'.repeat(80)], 'Nenhum', 40);
  assert.equal(longLine[0].value.length, 38);

  const manyFields = embedLinesFields('Itens', Array.from({ length: 25 }, (_, index) => `item-${index}`), 'Nenhum', 8);
  assert.equal(manyFields.length, 20);
  assert.equal(manyFields.at(-1).name, 'Itens 20');
});
