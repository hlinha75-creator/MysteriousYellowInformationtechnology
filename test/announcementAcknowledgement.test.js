const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notag-announcement-ack-test-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempRoot, 'announcement-ack.sqlite');

const { getDatabase } = require('../src/database/connection');
const { migrate } = require('../src/database/migrate');
const {
  acknowledgementComponents,
  acknowledgementCount,
  acknowledgementListPages,
  listAcknowledgements,
  registerAcknowledgement
} = require('../src/modules/operations/announcementAcknowledgement.service');

migrate();

test.after(() => {
  getDatabase().close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('registra somente um OK por membro em cada aviso', () => {
  const first = registerAcknowledgement('roaming-120k-2026-08-08', 'member-1');
  const duplicate = registerAcknowledgement('roaming-120k-2026-08-08', 'member-1');
  const anotherMember = registerAcknowledgement('roaming-120k-2026-08-08', 'member-2');

  assert.deepEqual(first, { added: true, count: 1 });
  assert.deepEqual(duplicate, { added: false, count: 1 });
  assert.deepEqual(anotherMember, { added: true, count: 2 });
  assert.equal(acknowledgementCount('roaming-120k-2026-08-08'), 2);
  assert.deepEqual(listAcknowledgements('roaming-120k-2026-08-08').map((row) => row.user_id), ['member-1', 'member-2']);
});

test('monta contador, botao de lista e resposta sem mencao ativa', () => {
  const components = acknowledgementComponents('roaming-120k-2026-08-08', 2).map((row) => row.toJSON());
  assert.equal(components[0].components[0].label, 'OK (2)');
  assert.equal(components[0].components[1].label, 'Ver lista');
  assert.match(acknowledgementListPages('roaming-120k-2026-08-08')[0], /member-1/);
});
