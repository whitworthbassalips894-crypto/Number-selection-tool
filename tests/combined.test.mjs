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
  assert.deepEqual(p.a, [23,25,34]);
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
    assert.ok(p.a.every(n => p.twelve.styles[n] !== 'random'));
    assert.deepEqual(p.ab, [...p.a, ...p.b]);
    assert.ok(p.ab.every(n => p.twelve.styles[n] !== 'random'));
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

test('A + B 固定剔除随机号，重叠号码按两注结算', () => {
  const p = combinedPlan(db.draws, target);
  assert.deepEqual(p.ab, [23,25,34,10,23,25,37,43]);
  const draw = { id: '2026-306', year: 2026, periodNum: 306, date: '2026-11-02', numbers: [1,2,3,4,5,7], special: 23 };
  const record = replayRecord(db.draws, draw);
  assert.deepEqual(record.picks.a, p.a);
  assert.deepEqual(record.picks.ab, p.ab);
  assert.equal('aPure' in record.picks, false);
  assert.equal('abPure' in record.picks, false);
  const result = summarize([record], 'ab', 10, 48);
  assert.equal(result.bets, 8);
  assert.equal(result.hits, 2);
  assert.equal(result.net, 880);
  assert.equal(result.hitRate, 2 / 8);
});

test('优选仅过滤最近四期有效特码，去重且不读取当期或未来', () => {
  const t = { year: 2026, periodNum: 306, date: '2026-11-02' };
  const prior = db.draws.filter(d => d.year < t.year || (d.year === t.year && d.periodNum < t.periodNum));
  const p = combinedPlan(prior, t);
  assert.deepEqual(p.recentSpecials4, [26, 21, 17, 45]);
  const unique = [...new Set([...p.a, ...p.b])].sort((a, b) => a - b);
  assert.deepEqual(p.opt, unique.filter(n => !p.recentSpecials4.includes(n)));
  assert.deepEqual(p.droppedRecent4, unique.filter(n => p.recentSpecials4.includes(n)));
  assert.equal(new Set(p.opt).size, p.opt.length);
  assert.ok(p.opt.every(n => !p.recentSpecials4.includes(n)));

  const invalid = { ...prior[0], numbers: [1, 1, 2, 3, 4, 5], special: 49 };
  const replaced = [invalid, ...prior.slice(1)];
  const withInvalid = combinedPlan(replaced, t);
  assert.deepEqual(withInvalid.recentSpecials4, [21, 17, 45, 17]);
  assert.ok(withInvalid.opt.every(n => !withInvalid.recentSpecials4.includes(n)));
  const recentDraws = prior.slice(0, 3);
  assert.deepEqual(combinedPlan(recentDraws, t).recentSpecials4, [26, 21, 17]);
  assert.deepEqual(combinedPlan([], t).recentSpecials4, []);

  const withFuture = [...prior, ...db.draws.filter(d => d.year > t.year || (d.year === t.year && d.periodNum >= t.periodNum))];
  const shuffled = combinedPlan(withFuture, t);
  assert.deepEqual(shuffled.opt, p.opt);
  assert.deepEqual(shuffled.recentSpecials4, p.recentSpecials4);
  assert.deepEqual(shuffled.droppedRecent4, p.droppedRecent4);
  const undated = { year: t.year, periodNum: t.periodNum };
  const futureWithDifferentYear = { ...db.draws[0], year: 2027, periodNum: 1, date: '2027-02-10' };
  assert.deepEqual(combinedPlan([futureWithDifferentYear, ...prior], undated).opt, combinedPlan(prior, undated).opt);
});

test('截至 2026-306 的有效历史全量回测与 2026-307 基准', () => {
  const draws = db.draws.filter(d => d.year < 2026 || (d.year === 2026 && d.periodNum <= 306));
  assert.ok(draws.some(d => d.year === 2026 && d.periodNum === 306), '底库必须包含基准截止期');
  assert.deepEqual(combinedPlan(draws, { year: 2026, periodNum: 307, date: '2026-11-03' }).opt, [6,10,23,38,41,48]);
  const records = draws.map(d => replayRecord(draws, d)).filter(Boolean);
  const totals = summarize(records, 'opt', 10, 48);
  assert.equal(totals.periods, 1766);
  // 原始引擎的特码间隔会读取无效的 2022-132；严格有效历史与原始口径不同。
  assert.equal(totals.bets, 10139);
  assert.equal(totals.hits, 247);
  assert.equal(totals.net, 17170);
  assert.equal(totals.maxDrawdown, 2970);
  assert.equal(totals.longestLosing, 32);
  for (const year of [2022, 2023, 2024, 2025, 2026]) {
    assert.ok(summarize(records.filter(r => r.draw.year === year), 'opt', 10, 48).net > 0, `${year} 净收益应为正`);
  }
});


test('隔离 2022-132 无效期后，工具 1 不得从该行读取特码', () => {
  const bad = db.draws.find(d => d.id === '2022-132');
  const draw = db.draws.find(d => d.id === '2022-133');
  const validPlan = combinedPlan(db.draws, draw);
  const withoutBad = combinedPlan(db.draws.filter(d => d.id !== bad.id), draw);
  assert.deepEqual(validPlan.a, withoutBad.a);
  assert.deepEqual(validPlan.b, withoutBad.b);
  assert.deepEqual(validPlan.opt, withoutBad.opt);
  const original = original1(db.draws, draw, {mode: 'special', randomSalt: 0}).five[0];
  const originalA = original.numbers.filter(n => original.styles[n] !== 'random' && validPlan.tool2Unique.includes(n));
  assert.deepEqual(originalA, [9,21,22,34,39,48]);
  assert.deepEqual(validPlan.a, [9,21,22,34,39]);
});
