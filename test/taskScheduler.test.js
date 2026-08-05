const assert = require('node:assert/strict');
const test = require('node:test');

const { runTask, runTasks, scheduleTaskGroups } = require('../src/runtime/taskScheduler');

test('executor isola falhas assincronas e sincronas das tarefas em segundo plano', async () => {
  const errors = [];
  const logger = { error: (...args) => errors.push(args) };
  let completed = 0;

  await runTasks([
    { run: async () => { completed += 1; }, errorMessage: 'nao deveria falhar' },
    { run: async () => { throw new Error('falha assincrona'); }, errorMessage: 'erro async' },
    { run: () => { throw new Error('falha sincrona'); }, errorMessage: 'erro sync' }
  ], logger);

  assert.equal(completed, 1);
  assert.deepEqual(errors.map(([message]) => message).sort(), ['erro async', 'erro sync']);
  assert.deepEqual(errors.map(([, error]) => error.message).sort(), ['falha assincrona', 'falha sincrona']);
});

test('agendador preserva os intervalos e executa cada grupo', async () => {
  const scheduled = [];
  const calls = [];
  const setIntervalFn = (callback, intervalMs) => {
    scheduled.push({ callback, intervalMs });
    return `timer-${intervalMs}`;
  };

  const timers = scheduleTaskGroups([
    { intervalMs: 30000, tasks: [{ run: () => { calls.push('rapida'); }, errorMessage: 'erro' }] },
    { intervalMs: 60000, tasks: [{ run: () => { calls.push('lenta'); }, errorMessage: 'erro' }] }
  ], { setIntervalFn, logger: { error: () => {} } });

  assert.deepEqual(timers, ['timer-30000', 'timer-60000']);
  assert.deepEqual(scheduled.map(({ intervalMs }) => intervalMs), [30000, 60000]);

  scheduled.forEach(({ callback }) => callback());
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['rapida', 'lenta']);
});

test('executor individual resolve mesmo quando a tarefa falha', async () => {
  const errors = [];
  await assert.doesNotReject(runTask(
    { run: () => Promise.reject(new Error('indisponivel')), errorMessage: 'falha controlada' },
    { error: (...args) => errors.push(args) }
  ));
  assert.equal(errors[0][0], 'falha controlada');
});
