const assert = require('node:assert/strict');
const test = require('node:test');
const { describeMatch, isShortQuestion, wavFromPcm } = require('../src/modules/voice/questionListening.service');

test('identifica perguntas curtas e rejeita frases comuns', () => {
  assert.equal(isShortQuestion('Que horas começa?'), true);
  assert.equal(isShortQuestion('onde vai ser o encontro'), true);
  assert.equal(isShortQuestion('Eu ja estou chegando no portal.'), false);
  assert.equal(isShortQuestion('onde?'), false);
});

test('relaciona horario, local e build com os dados do evento', () => {
  const event = { scheduled_time: '2026-07-12T20:00:00', location: 'Bridgewatch', description: 'Build T8 equivalente' };
  assert.equal(describeMatch('Que horas começa?', event).inDescription, true);
  assert.match(describeMatch('Onde é o encontro?', event).answer, /Bridgewatch/);
  assert.equal(describeMatch('Qual build precisa?', event).inDescription, true);
  assert.equal(describeMatch('Quem sera o caller?', event).inDescription, false);
});

test('gera WAV PCM valido para a API de transcricao', () => {
  const wav = wavFromPcm(Buffer.alloc(100));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(40), 100);
  assert.equal(wav.length, 144);
});
