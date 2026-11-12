import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import INITIAL_DB from '../data/draws.js';
import { isUsableDraw } from '../src/audit.js';
import { sixTierPlan, TIER_DEFS } from '../src/six-tier.js';

const through315 = INITIAL_DB.draws.filter(d => d.year < 2026 || (d.year === 2026 && d.periodNum <= 315));
const target = { year: 2026, periodNum: 316, date: '2026-11-12' };

test('新客观模型固定基准、双档同心与冷却', () => {
  assert.equal(through315.filter(isUsableDraw).length, 1775);
  const p = sixTierPlan(through315, target);
  assert.deepEqual(p.ranked.slice(0,8), [25,37,8,40,1,9,24,27]);
  assert.deepEqual(TIER_DEFS.map(t => t.size), [5,8]);
  assert.equal(new Set(p.ranked).size, 49);
  assert.deepEqual([...p.ranked].sort((a,b)=>a-b), Array.from({length:49},(_,i)=>i+1));
  assert.ok(p.ranked.slice(0,5).every(n => p.ranked.slice(0,8).includes(n)));
  assert.ok(p.cool4.every(n => p.rankOf[n] > 8));
});

test('固定分区配额与全局分尾限制，不存在伪随机实现', () => {
  const source = fs.readFileSync('src/six-tier.js', 'utf8');
  assert.doesNotMatch(source, /detJitter|mulberry32|Math\.random|seedFor/);
  const zero = sixTierPlan([], {year:2026,periodNum:1,date:'2026-01-01'});
  assert.deepEqual(zero.curated9,[1,2,3,17,18,25,34,35,36]);
  const draws = through315.filter(isUsableDraw);
  for (const d of draws.filter((_, i) => i % 25 === 0)) {
    const plan = sixTierPlan(draws,d);
    const counts = [n=>n<=16,n=>n>=17&&n<=24,n=>n>=25&&n<=33,n=>n>=34];
    assert.deepEqual(counts.map(f=>plan.curated9.filter(f).length), [3,2,1,3]);
    assert.equal(new Set(plan.curated9).size,9);
    for (let t=0;t<10;t++) assert.ok(plan.curated9.filter(n=>n%10===t).length<=2);
    assert.ok(plan.cool4.every(n=>plan.rankOf[n]>8));
    assert.deepEqual(plan.ranked,sixTierPlan(draws,d).ranked);
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
  assert.ok(noFuture.cool4.every(n => noFuture.rankOf[n] > 8));
});
