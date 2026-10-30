import test from 'node:test';
import assert from 'node:assert/strict';
import {
  binomial,
  combinations,
  countCombos,
  evaluateSpecialTickets,
  evaluateTickets
} from '../src/combinatorics.js';

test('binomial & combinations 基础正确', () => {
  assert.equal(binomial(49, 1), 49);
  assert.equal(binomial(7, 1), 7);
  assert.equal(countCombos(7, 1), 7);
  assert.deepEqual(combinations([3, 8, 21], 1), [[3], [8], [21]]);
});

test('evaluateSpecialTickets：只核对特码，正码命中不计奖', () => {
  const draw = {
    id: '2026-300',
    numbers: [3, 11, 18, 25, 34, 42],
    special: 49
  };
  // 全部压在正码上 -> 0 注中奖
  const miss = evaluateSpecialTickets([[3], [11], [18], [25], [34], [42], [7]], draw, {
    stake: 10,
    oddsSpecial: 48
  });
  assert.equal(miss.totalBets, 7);
  assert.equal(miss.cost, 70);
  assert.equal(miss.winCount, 0);
  assert.equal(miss.payout, 0);
  assert.equal(miss.net, -70);

  // 含特码 49 -> 命中 1 注，返奖 480 元
  const hit = evaluateSpecialTickets([[3], [11], [18], [25], [34], [42], [49]], draw, {
    stake: 10,
    oddsSpecial: 48
  });
  assert.equal(hit.totalBets, 7);
  assert.equal(hit.winCount, 1);
  assert.equal(hit.payout, 480);
  assert.equal(hit.net, 410);
});

test('evaluateTickets：三组 21 注含跨组重叠特码时叠加中奖', () => {
  const draw = {
    id: '2026-301',
    numbers: [2, 9, 15, 27, 33, 41],
    special: 23
  };
  // 模拟三组各 7 码，其中 23 在第 1 组和第 3 组重叠出现
  const g1 = [5, 8, 17, 23, 25, 38, 40].map((n) => [n]);
  const g2 = [3, 6, 22, 29, 34, 37, 41].map((n) => [n]);
  const g3 = [2, 11, 14, 23, 25, 38, 46].map((n) => [n]);

  const all21 = [...g1, ...g2, ...g3];
  const res = evaluateTickets(all21, draw, { stake: 10, oddsSpecial: 48 });
  assert.equal(res.totalBets, 21);
  assert.equal(res.cost, 210);
  assert.equal(res.winCount, 2);
  assert.equal(res.payout, 960);
  assert.equal(res.net, 750);
});
