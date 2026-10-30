import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPECIAL_BASELINE,
  anyHitByDistinct,
  directBaseline,
  expectedReturnRate,
  formatPercent,
  specialBaseline
} from '../src/statistics.js';

test('specialBaseline：特码 3 组 × 7 码理论基准精确无误', () => {
  const b = specialBaseline();
  assert.equal(b.totalSpace, 49);
  assert.equal(b.groupCount, 3);
  assert.equal(b.groupSize, 7);
  assert.equal(b.totalBets, 21);
  assert.equal(b.fairOdds, 49);
  assert.ok(Math.abs(b.hitProb - 1 / 49) < 1e-12);
  assert.ok(Math.abs(b.hitProbPerTicket - 7 / 49) < 1e-12);
  assert.ok(Math.abs(b.expectedHitsPerGroup - 7 / 49) < 1e-12);
  assert.ok(Math.abs(b.expectedHits - 21 / 49) < 1e-12);
  assert.deepEqual(directBaseline(), SPECIAL_BASELINE);
});

test('anyHitByDistinct：覆盖 K 个不同号码时至少中 1 注概率为 K/49', () => {
  assert.equal(anyHitByDistinct(0), 0);
  assert.ok(Math.abs(anyHitByDistinct(18) - 18 / 49) < 1e-12);
  assert.ok(Math.abs(anyHitByDistinct(21) - 21 / 49) < 1e-12);
  assert.equal(anyHitByDistinct(49), 1);
});

test('expectedReturnRate：支持直接传赔率或 (mode, odds)', () => {
  assert.ok(Math.abs(expectedReturnRate(48) - 48 / 49) < 1e-12);
  assert.ok(Math.abs(expectedReturnRate('special', 48) - 48 / 49) < 1e-12);
  assert.equal(expectedReturnRate(49), 1);
  assert.equal(formatPercent(7 / 49, 2), '14.29%');
});
