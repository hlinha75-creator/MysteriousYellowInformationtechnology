const test = require('node:test');
const assert = require('node:assert/strict');

const ids = require('../src/config/ids');
const announcement = require('../src/modules/albion/seasonAnnouncement.service');

test('monta anúncio Ouro com Top 20, meta, menção controlada e botão do portal', () => {
  const payload = announcement.buildSeasonAnnouncementPayload({ notifyMembers: true });
  const embed = payload.embeds[0].toJSON();
  const button = payload.components[0].toJSON().components[0];

  assert.equal(payload.content, `<@&${ids.roles.member}>`);
  assert.deepEqual(payload.allowedMentions, { roles: [ids.roles.member] });
  assert.match(embed.title, /NOTAG É OURO/);
  assert.match(embed.description, /81\.043 pontos/);
  assert.match(embed.description, /mais de 20 dias/);
  assert.match(embed.description, /120\.000 pontos/);
  assert.match(embed.description, /QG Qualidade 5/);
  assert.match(embed.fields[0].value, /Tmaiusculo/);
  assert.equal(embed.fields[1].value.split('\n').length, 17);
  assert.equal(button.label, 'Ver ranking completo');
  assert.match(button.url, /\/portal\/temporada$/);
});

test('não menciona novamente os membros no canal espelho', () => {
  const payload = announcement.buildSeasonAnnouncementPayload({ notifyMembers: false });
  assert.equal(payload.content, undefined);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});
