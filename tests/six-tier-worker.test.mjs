import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../data/draws.js';
import {isUsableDraw} from '../src/audit.js';
import {sixTierPlan} from '../src/six-tier.js';

test('六档 worker 分批汇报真实回放顺位并能报告错误', async () => {
  const messages = [];
  const old = globalThis.self;
  globalThis.self = {postMessage: x => messages.push(x)};
  try {
    await import('../src/six-tier-worker.js');
    const draws = db.draws.filter(isUsableDraw).slice(-25).reverse();
    await self.onmessage({data:{draws}});
    assert.deepEqual(messages.filter(m=>m.type==='progress').map(m=>m.processed), [24,25]);
    const records = messages.at(-1).records;
    assert.equal(records.length,25);
    assert.equal(records[0].id, draws[24].id);
    assert.equal(records[0].spRank, sixTierPlan(draws, draws[24]).rankOf[draws[24].special]);
    assert.equal(messages[0].records.length, 24);
    assert.equal(messages[1].records.length, 1);
    await self.onmessage({data:{}});
    assert.equal(messages.at(-1).type,'error');
  } finally { if (old === undefined) delete globalThis.self; else globalThis.self=old; }
});
