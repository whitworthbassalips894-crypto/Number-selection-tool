import test from 'node:test';
import assert from 'node:assert/strict';
import INITIAL_DB from '../data/draws.js';
import { DAILY_THREE_CATALOG, generateDailyFive } from '../src/dailyfive.js';
import { getColorForNumber, getZoneForNumber } from '../src/constants.js';

const DRAWS = INITIAL_DB.draws;

test('DAILY_THREE_CATALOG：共 3 组策略推荐，不含随机对照组', () => {
  assert.equal(DAILY_THREE_CATALOG.length, 3);
  assert.deepEqual(
    DAILY_THREE_CATALOG.map((c) => c.id),
    ['hot', 'cold', 'cycle']
  );
  for (const c of DAILY_THREE_CATALOG) {
    assert.doesNotMatch(c.name, /随机/);
  }
});

test('generateDailyFive：输出 3 组 × 7 码 = 21 注，组内严格去重升序，跨组允许重叠且精确统计', () => {
  const plan = generateDailyFive(DRAWS, { year: 2026, periodNum: 303, date: '2026-10-30' });
  assert.equal(plan.five.length, 3);
  assert.equal(plan.coverage.totalBets, 21);
  assert.equal(plan.coverage.betsPerOption, 7);

  for (const g of plan.five) {
    assert.equal(g.numbers.length, 7);
    const uniq = new Set(g.numbers);
    assert.equal(uniq.size, 7, `${g.id} 组内必须无重复`);
    for (let i = 0; i < g.numbers.length; i++) {
      assert.ok(g.numbers[i] >= 1 && g.numbers[i] <= 49);
      if (i > 0) assert.ok(g.numbers[i] > g.numbers[i - 1], '组内升序');
    }
    // 均衡约束：单区至少 1 个、至多 3 个；三波色均覆盖
    assert.ok(g.shape.zone1 >= 1 && g.shape.zone1 <= 3);
    assert.ok(g.shape.zone2 >= 1 && g.shape.zone2 <= 3);
    assert.ok(g.shape.zone3 >= 1 && g.shape.zone3 <= 3);
    assert.ok(g.shape.red >= 1 && g.shape.blue >= 1 && g.shape.green >= 1);
  }

  // 第 3 组「周期均衡」严格满足三区 2-2-3、三波 2-2-3、7 码异尾
  const g3 = plan.five[2];
  const zonesSorted = [g3.shape.zone1, g3.shape.zone2, g3.shape.zone3].sort((a, b) => a - b);
  const colorsSorted = [g3.shape.red, g3.shape.blue, g3.shape.green].sort((a, b) => a - b);
  assert.deepEqual(zonesSorted, [2, 2, 3]);
  assert.deepEqual(colorsSorted, [2, 2, 3]);
  assert.equal(new Set(g3.numbers.map((n) => n % 10)).size, 7);

  // 覆盖与重叠恒等式：distinct + overlap === 21
  const all21 = plan.five.flatMap((g) => g.numbers);
  const distinctSet = new Set(all21);
  assert.equal(plan.coverage.distinct, distinctSet.size);
  assert.equal(plan.coverage.distinct + plan.coverage.overlap, 21);
  assert.ok(Math.abs(plan.coverage.anyHit - distinctSet.size / 49) < 1e-12);

  // consensus 恰好是出现次数 >= 2 的号码
  for (const n of plan.consensus) {
    assert.ok(plan.overlapCounts[n] >= 2);
  }
});

test('generateDailyFive：严格无未来函数（注入当期或未来期开奖不改变当期推荐）', () => {
  const target = DRAWS[15]; // 历史某期
  const cleanBefore = DRAWS.filter(
    (d) => d.year < target.year || (d.year === target.year && d.periodNum < target.periodNum)
  );
  const pFromClean = generateDailyFive(cleanBefore, {
    year: target.year,
    periodNum: target.periodNum,
    date: target.date
  });
  const pFromFull = generateDailyFive(DRAWS, {
    year: target.year,
    periodNum: target.periodNum,
    date: target.date
  });

  assert.deepEqual(
    pFromClean.five.map((g) => g.numbers),
    pFromFull.five.map((g) => g.numbers)
  );
});

test('generateDailyFive：三套策略真实分化（#1 热态遗漏显著低于 #2 冷态遗漏）且存在自然跨组重叠', () => {
  let hotOmSum = 0;
  let coldOmSum = 0;
  let overlapPeriods = 0;

  for (const d of DRAWS.slice(0, 80)) {
    const p = generateDailyFive(DRAWS, { year: d.year, periodNum: d.periodNum, date: d.date });
    hotOmSum += p.five[0].numbers.reduce((a, n) => a + p.specialStats[n].omission, 0) / 7;
    coldOmSum += p.five[1].numbers.reduce((a, n) => a + p.specialStats[n].omission, 0) / 7;
    if (p.consensus.length > 0) overlapPeriods++;
  }

  assert.ok(hotOmSum / 80 < 20, `热态顺势平均特码遗漏应较低，实际 ${(hotOmSum / 80).toFixed(1)}`);
  assert.ok(coldOmSum / 80 > 55, `遗漏回补平均特码遗漏应较高，实际 ${(coldOmSum / 80).toFixed(1)}`);
  assert.ok(overlapPeriods >= 50, `80 期中应有充足的自然跨组重叠期，实际 ${overlapPeriods}`);
});
