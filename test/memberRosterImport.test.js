const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notag-member-roster-test-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempRoot, 'member-roster.sqlite');

const { getDatabase } = require('../src/database/connection');
const { migrate } = require('../src/database/migrate');
const registrationRepo = require('../src/modules/registration/registration.repository');
const snapshots = require('../src/modules/members/memberSnapshot.service');
const { getMemberRosterData, manageMemberRoster } = require('../src/web/staff-member-roster.service');

migrate();
test.after(() => {
  getDatabase().close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const firstRoster = [
  '"Character Name"\t"Last Seen"\t"Roles"',
  '"HeroOne"\t"Online"\t"Member"',
  '"NewHero"\t"07/29/2026 03:35:40"\t"Officer;Member"',
  '"newhero"\t"07/29/2026 03:35:40"\t"Officer;Member"'
].join('\n');

test('analisa e confirma a lista atual sem salvar antes da confirmação', async () => {
  registrationRepo.upsertUser({ discordId: 'linked-1', discordName: 'linked', albionName: 'HeroOne', registrationStatus: 'member' });
  registrationRepo.upsertUser({ discordId: 'outside-1', discordName: 'outside', albionName: 'OutsideHero', registrationStatus: 'member' });

  const previewResult = await manageMemberRoster({ action: 'preview', rosterText: firstRoster, sourceName: 'membros.tsv', actorId: 'staff-1' });
  assert.equal(previewResult.preview.memberCount, 2);
  assert.equal(previewResult.preview.onlineCount, 1);
  assert.equal(previewResult.preview.linkedCount, 1);
  assert.equal(previewResult.preview.unlinkedCount, 1);
  assert.equal(previewResult.preview.duplicateCount, 1);
  assert.deepEqual(previewResult.preview.registeredOutside.map((row) => row.albionName), ['OutsideHero']);
  assert.equal(snapshots.latestSnapshot(), undefined);

  const confirmed = await manageMemberRoster({ action: 'confirm', rosterText: firstRoster, sourceName: 'membros.tsv', actorId: 'staff-1' });
  assert.match(confirmed.message, /Lista atualizada com 2 membros/);
  assert.equal(confirmed.roster.memberCount, 2);
  assert.equal(confirmed.roster.linkedCount, 1);
  assert.equal(getDatabase().prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE type = 'website_member_roster_imported'").get().total, 1);
});

test('nova prévia mostra quem entrou e quem saiu desde a lista anterior', () => {
  const secondRoster = [
    '"Character Name"\t"Last Seen"\t"Roles"',
    '"HeroOne"\t"Online"\t"Member"',
    '"ThirdHero"\t"Online"\t"Member"'
  ].join('\n');
  const preview = snapshots.previewMemberSnapshot(secondRoster);
  assert.deepEqual(preview.additions, ['ThirdHero']);
  assert.deepEqual(preview.removals, ['NewHero']);
});

test('resumo atual expõe apenas dados operacionais necessários ao painel', () => {
  const roster = getMemberRosterData();
  assert.equal(roster.memberCount, 2);
  assert.equal(roster.unlinkedCount, 1);
  assert.equal('rows' in roster, false);
});
