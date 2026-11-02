import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../data/draws.js';
import { combinedPlan, replayRecord, summarize } from '../src/combined.js';
import { generateDailyFive as original1 } from '../src/tool1/dailyfive.js';

const target = { year: 2026, periodNum: 306, date: '2026-11-02' };
test('2026-306 两个原版与双方案基准', () => {
  const p = combinedPlan(db.draws, target);
  assert.deepEqual(p.tool1, [1,6,10,15,23,24,25,30,34,37,43,48]);
  assert.deepEqual(p.twelve.breakdown.map(x => x.numbers), [[6,30,48],[10,23,25],[37,43],[1,15,24,34]]);
  assert.deepEqual(p.three.five.map(x => x.numbers), [[8,17,21,23,36,38,45],[3,6,12,27,29,34,41],[2,11,17,23,25,36,38]]);
  assert.deepEqual(p.a, [6,23,25,34]);
  assert.deepEqual(p.aPure, [23,25,34]);
  assert.deepEqual(p.b, [10,23,25,37,43]);
});
test('多个历史期原版一致且严格不读取当期和未来', () => {
  for (const i of [0, 100, 450, 800, 1200, 1700]) {
    const d = db.draws[i], p = combinedPlan(db.draws, d);
    assert.deepEqual(p.twelve, original1(db.draws, d, {mode:'special', randomSalt:0}).five[0]);
    const prior = db.draws.slice(i + 1);
    const onlyPrior = combinedPlan(prior, d);
    assert.deepEqual(p.tool1, onlyPrior.tool1);
    assert.deepEqual(p.three.five.map(x => x.numbers), onlyPrior.three.five.map(x => x.numbers));
    assert.deepEqual(p.twelve.breakdown, onlyPrior.twelve.breakdown);
  }
});
test('回测多注重叠、收益、单注命中率、跨年回撤与连黑', () => {
  const make = (year, periodNum, special, nums) => ({draw:{year,periodNum,special}, picks:{tool2:nums}});
  const records = [make(2023,2,1,[2,3]),make(2023,1,1,[1,1,2]),make(2022,2,1,[2,3]),make(2022,1,1,[2,3])];
  const all = summarize(records, 'tool2', 10, 48);
  assert.equal(all.bets, 9); assert.equal(all.hits, 2); assert.equal(all.net, 870);
  assert.equal(all.hitRate, 2/9); assert.equal(all.roi, 870/90);
  assert.equal(all.maxDrawdown, 40); assert.equal(all.longestLosing, 2);
  const annual = summarize(records.filter(r => r.draw.year === 2023), 'tool2', 10, 48);
  assert.equal(annual.maxDrawdown, 20); assert.equal(annual.longestLosing, 1);
  assert.equal(summarize([], 'tool2').roi, 0);
});
test('无效开奖不进入回放，推荐只按特码命中', () => {
  assert.equal(replayRecord(db.draws, {year:2022,periodNum:132,numbers:[1,1,2,3,4,5],special:6}), null);
  const r = replayRecord(db.draws, db.draws[0]);
  assert.equal(r.picks.tool2.length, 21);
  assert.equal(new Set(r.picks.tool2).size, r.picks.tool2Unique.length);
});

test('A + B 两套下注合计，重叠号码按两注结算，随机开关只影响 A', () => {
  const p = combinedPlan(db.draws, target);
  assert.deepEqual(p.ab, [6,10,23,23,25,25,34,37,43]);
  assert.deepEqual(p.abPure, [10,23,23,25,25,34,37,43]);
  const draw = { id: '2026-306', year: 2026, periodNum: 306, date: '2026-11-02', numbers: [1,2,3,4,5,7], special: 23 };
  const record = replayRecord(db.draws, draw);
  assert.deepEqual(record.picks.ab, p.ab);
  assert.deepEqual(record.picks.abPure, p.abPure);
  const result = summarize([record], 'ab', 10, 48);
  assert.equal(result.bets, 9);
  assert.equal(result.hits, 2);
  assert.equal(result.net, 870);
  assert.equal(result.hitRate, 2 / 9);
  const pure = summarize([record], 'abPure', 10, 48);
  assert.equal(pure.bets, 8);
  assert.equal(pure.hits, 2);
  assert.equal(pure.net, 880);
});
