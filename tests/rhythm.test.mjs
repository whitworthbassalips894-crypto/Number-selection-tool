import test from 'node:test';
import assert from 'node:assert/strict';
import {rhythmSummary} from '../src/rhythm.js';

// 输入从最新期到最旧期；数字 8 是命中，9 是未中。
const ranks = (hits, misses = 0) => [...Array(misses).fill(9), ...Array(hits).fill(8), ...Array(20-misses-hits).fill(9)];
test('节奏灯：20期命中与连黑阈值、顺序和边界', () => {
  assert.equal(rhythmSummary(ranks(4,9),{complete:true}).state,'green');
  assert.equal(rhythmSummary(ranks(3,9),{complete:true}).state,'yellow');
  assert.equal(rhythmSummary(ranks(2),{complete:true}).state,'yellow');
  assert.equal(rhythmSummary(ranks(1),{complete:true}).state,'orange');
  const r = rhythmSummary(ranks(4,10),{complete:true});
  assert.equal(r.state,'orange'); assert.equal(r.losingStreak,10); assert.equal(r.recentHits,4);
  const long = rhythmSummary([...Array(25).fill(9),8],{complete:true});
  assert.equal(long.losingStreak,25); assert.equal(long.recentHits,0);
});
test('节奏灯：未完成、样本不足和全部未中不能误报', () => {
  assert.equal(rhythmSummary([]).state,'pending');
  assert.equal(rhythmSummary(Array(19).fill(8),{complete:true}).state,'insufficient');
  assert.equal(rhythmSummary(Array(24).fill(9)).state,'pending');
  const allMiss = rhythmSummary(Array(24).fill(9),{complete:true});
  assert.equal(allMiss.state,'orange'); assert.equal(allMiss.losingStreak,24);
});
