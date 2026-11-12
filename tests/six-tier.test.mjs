import test from 'node:test';
import assert from 'node:assert/strict';
import INITIAL_DB from '../data/draws.js';
import { isUsableDraw } from '../src/audit.js';
import { sixTierPlan, TIER_DEFS } from '../src/six-tier.js';

const through315 = INITIAL_DB.draws.filter(d => d.year < 2026 || (d.year === 2026 && d.periodNum <= 315));
const target = { year: 2026, periodNum: 316, date: '2026-11-12' };

test('附件 2026-316 基准、六档同心包含与冷却', () => {
  assert.equal(through315.filter(isUsableDraw).length, 1775);
  const plan = sixTierPlan(through315, target);
  const sorted = k => plan.ranked.slice(0, k).sort((a, b) => a - b);
  assert.deepEqual(sorted(3), [16, 39, 40]);
  assert.deepEqual(sorted(5), [4, 16, 25, 39, 40]);
  assert.deepEqual(sorted(8), [4, 9, 16, 25, 27, 39, 40, 46]);
  assert.deepEqual(sorted(11), [4, 5, 9, 16, 25, 27, 28, 33, 39, 40, 46]);
  assert.deepEqual(sorted(14), [4, 5, 6, 8, 9, 16, 25, 27, 28, 33, 37, 39, 40, 46]);
  assert.deepEqual(TIER_DEFS.map(t => t.size), [3,5,8,11,14,20]);
  assert.equal(new Set(plan.ranked).size, 49);
  assert.deepEqual([...plan.ranked].sort((a,b) => a-b), Array.from({length:49}, (_, i) => i+1));
  assert.ok(plan.cool4.every(n => !plan.ranked.slice(0,20).includes(n)));
  for (let i = 1; i < TIER_DEFS.length; i++) {
    assert.ok(plan.ranked.slice(0,TIER_DEFS[i-1].size).every(n => plan.ranked.slice(0,TIER_DEFS[i].size).includes(n)));
  }
});

test('未来、目标期和无效记录不影响任何排名，输入顺序不影响结果', () => {
  const pastTarget = {year:2026,periodNum:300,date:'2026-10-27'};
  const past = through315.filter(d => d.year < 2026 || d.periodNum < 300);
  const withFuture = sixTierPlan(through315, pastTarget);
  const noFuture = sixTierPlan(past, pastTarget);
  const invalid = {id:'2026-299', year:2026,periodNum:299,date:'2026-10-26',numbers:[1,1,2,3,4,5],special:6};
  assert.deepEqual(withFuture.ranked, noFuture.ranked);
  assert.deepEqual(sixTierPlan([...past, invalid].reverse(), pastTarget).ranked, noFuture.ranked);
  assert.ok(noFuture.cool4.every(n => noFuture.rankOf[n] > 20));
});
