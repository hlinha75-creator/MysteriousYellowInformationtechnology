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
const { registerAcknowledgement } = require('../src/modules/operations/announcementAcknowledgement.service');

migrate();

test.after(() => {
  getDatabase().close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('registra somente um OK por membro em cada aviso', () => {
  const first = registerAcknowledgement('roaming-120k-2026-08-08', 'member-1');
  const duplicate = registerAcknowledgement('roaming-120k-2026-08-08', 'member-1');
  const anotherMember = registerAcknowledgement('roaming-120k-2026-08-08', 'member-2');

  assert.deepEqual(first, { added: true });
  assert.deepEqual(duplicate, { added: false });
  assert.deepEqual(anotherMember, { added: true });
});
