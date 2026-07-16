const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateVictimLoss, victimItems } = require('../src/modules/albion/marketValue.service');

test('soma equipamento e inventário da vítima usando quantidade e qualidade', async () => {
  const event = {
    Victim: {
      Equipment: { MainHand: { Type: 'TEST_SWORD', Quality: 2, Count: 1 } },
      Inventory: [{ Type: 'TEST_ORE', Quality: 1, Count: 10 }, null]
    }
  };
  const rows = [
    { item_id: 'TEST_SWORD', quality: 2, sell_price_min: 5000, buy_price_max: 4000 },
    { item_id: 'TEST_ORE', quality: 1, sell_price_min: 100, buy_price_max: 80 }
  ];
  const result = await estimateVictimLoss(event, {
    fetchImpl: async () => ({ ok: true, json: async () => rows })
  });
  assert.equal(victimItems(event).length, 2);
  assert.deepEqual(result, { total: 6000, priced: 2, items: 2 });
});
