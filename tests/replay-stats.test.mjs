import test from 'node:test';
import assert from 'node:assert/strict';
import { periodHitSummary } from '../src/replay-stats.js';

test('四方案按期命中：A+B 同期双中仍只计一期，空样本与零命中可安全展示', () => {
  const records = [
    { draw: { special: '23' }, picks: { opt: [23], a: [23], b: [23], ab: [23, 23] } },
    { draw: { special: 5 }, picks: { opt: [], a: [5], b: [3], ab: [5, 3] } },
    { draw: { special: 1 }, picks: { opt: [2], a: [], b: [], ab: [] } }
  ];
  const summary = periodHitSummary(records);
  assert.equal(summary.periods, 3);
  assert.equal(summary.strategies.opt.wins, 1);
  assert.equal(summary.strategies.a.wins, 2);
  assert.equal(summary.strategies.b.wins, 1);
  assert.equal(summary.strategies.ab.wins, 2);
  assert.equal(summary.strategies.ab.interval, 1.5);
  assert.equal(summary.strategies.ab.rate.toFixed(1), '66.7');
  const empty = periodHitSummary([]);
  assert.equal(empty.strategies.opt.rate, 0);
  assert.equal(empty.strategies.opt.interval, null);
  assert.equal(periodHitSummary(records.slice(2)).strategies.opt.interval, null);
});
