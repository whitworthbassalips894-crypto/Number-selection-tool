import test from 'node:test';
import assert from 'node:assert/strict';
import INITIAL_DB from '../data/draws.js';
import { buildDailyFiveRecords, summarizeDailyFive } from '../src/dailyfive.js';

const DRAWS = INITIAL_DB.draws;

test('buildDailyFiveRecords + summarizeDailyFive：21 注独立核算、重叠多中叠加返奖、逐组对比精确一致', () => {
  const targets = DRAWS.slice(0, 60);
  const cfg = { stake: 10, oddsSpecial: 48 };
  const records = buildDailyFiveRecords(DRAWS, targets, cfg);
  assert.equal(records.length, 60);

  let manualWinPeriods = 0;
  let manualMultiPeriods = 0;
  let manualTotalHits = 0;
  let manualTotalPayout = 0;

  for (const r of records) {
    assert.equal(r.five.length, 3);
    assert.equal(r.totalBets, 21);
    assert.equal(r.totalCost, 210);

    let hitsThisPeriod = 0;
    for (const g of r.five) {
      assert.equal(g.bets, 7);
      assert.equal(g.cost, 70);
      const shouldHit = g.numbers.includes(r.draw.special) ? 1 : 0;
      assert.equal(g.hitCount, shouldHit, '仅当包含特码时计中 1 注，正码绝不计奖');
      assert.equal(g.payout, shouldHit * 480);
      if (shouldHit) {
        assert.deepEqual(g.hitNums, [r.draw.special]);
      } else {
        assert.deepEqual(g.hitNums, []);
      }
      hitsThisPeriod += shouldHit;
    }

    assert.equal(r.totalHits, hitsThisPeriod);
    assert.equal(r.totalPayout, hitsThisPeriod * 480);
    assert.equal(r.totalNet, hitsThisPeriod * 480 - 210);
    if (hitsThisPeriod > 0) manualWinPeriods++;
    if (hitsThisPeriod >= 2) manualMultiPeriods++;
    manualTotalHits += hitsThisPeriod;
    manualTotalPayout += hitsThisPeriod * 480;
  }

  const sum = summarizeDailyFive(records, cfg);
  assert.equal(sum.periods, 60);
  assert.equal(sum.winPeriods, manualWinPeriods);
  assert.equal(sum.multiWinPeriods, manualMultiPeriods);
  assert.equal(sum.totalHits, manualTotalHits);
  assert.equal(sum.totalCost, 60 * 210);
  assert.equal(sum.totalPayout, manualTotalPayout);
  assert.equal(sum.catalog.length, 3);

  // 三组独立命中数之和恒等于 21 注总命中数
  const sumGroupHits = sum.catalog.reduce((acc, c) => acc + c.hits, 0);
  const sumGroupCost = sum.catalog.reduce((acc, c) => acc + c.cost, 0);
  const sumGroupPayout = sum.catalog.reduce((acc, c) => acc + c.payout, 0);
  assert.equal(sumGroupHits, sum.totalHits);
  assert.equal(sumGroupCost, sum.totalCost);
  assert.equal(sumGroupPayout, sum.totalPayout);
});
