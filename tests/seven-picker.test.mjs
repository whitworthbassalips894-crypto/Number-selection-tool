/**
 * 选号求解器唯一性回归测试。
 *
 * 背景：这段算法曾经在 index.html / src/strategy.js / src/six-tier.js 各有一份
 * 副本，2026-11-23 的「均衡项符号写反」缺陷就同时存在于三处。此测试从两个
 * 方向守住它：
 *   1. 三处入口调用同一份实现，输出必须逐位一致（防止有人再复制一份）；
 *   2. 仓库里不应再出现第二份求解器实现（防止内联复制悄悄回来）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { selectBalancedSeven as viaStrategy } from '../src/strategy.js';
import { picker, html } from './helpers/page.mjs';

const OPTS = [
  { minPerZone: 1, maxPerZone: 3, minPerColor: 1, maxPerColor: 3, oddRange: [3, 4], bigRange: [3, 4], maxTailRepeat: 2 },
  { minPerZone: 2, maxPerZone: 3, minPerColor: 2, maxPerColor: 3, oddRange: [3, 4], bigRange: [3, 4], maxTailRepeat: 1 },
  // 注意：minPerZone=1 配 maxPerZone=2 在 7 码里数学上不可行（3 区各 1 码后剩余
  // 4 码无处安放），算法会退化为「忽略配额尽量凑满」。用例必须本身可满足。
  { minPerZone: 1, maxPerZone: 3, minPerColor: 2, maxPerColor: 4, oddRange: [2, 5], bigRange: [2, 5], maxTailRepeat: 3 },
];

const zoneOf = (n) => (n <= 16 ? 1 : n <= 33 ? 2 : 3);

/** 波色表，与 index.html 的 WAVE_MAP 同源。 */
function colorTable() {
  const out = {};
  for (const n of [1, 2, 7, 8, 12, 13, 18, 19, 23, 24, 29, 30, 34, 35, 40, 45, 46]) out[n] = 'red';
  for (const n of [3, 4, 9, 10, 14, 15, 20, 25, 26, 31, 36, 37, 41, 42, 47, 48]) out[n] = 'blue';
  for (let n = 1; n <= 49; n++) if (!out[n]) out[n] = 'green';
  return out;
}

/** 同一套确定性伪随机分数表，保证用例可复现。 */
function scoreTable(seed) {
  let s = seed;
  const next = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const map = {};
  for (let n = 1; n <= 49; n++) map[n] = Math.round(next() * 1000) / 1000;
  return map;
}

test('strategy.js 与 seven-picker.js 输出逐位一致（含并列分数）', () => {
  let cases = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const map = scoreTable(seed);
    for (const opts of OPTS) {
      cases++;
      assert.deepEqual(
        viaStrategy(map, opts),
        picker.selectBalancedSeven(map, opts),
        `seed=${seed} maxTailRepeat=${opts.maxTailRepeat} 两份实现结果不一致`
      );
    }
  }
  // 大量并列分数是贪心算法的边界，单独压一遍
  for (let seed = 1; seed <= 30; seed++) {
    const map = {};
    for (let n = 1; n <= 49; n++) map[n] = (n * seed) % 7;
    for (const opts of OPTS) {
      cases++;
      assert.deepEqual(viaStrategy(map, opts), picker.selectBalancedSeven(map, opts));
    }
  }
  assert.ok(cases >= 500, `用例数应足够覆盖，实际 ${cases}`);
});

test('求解器输出结构正确：恰好 7 个互不重复号码，且升序', () => {
  for (let seed = 1; seed <= 40; seed++) {
    for (const opts of OPTS) {
      const chosen = picker.selectBalancedSeven(scoreTable(seed), opts);
      assert.equal(chosen.length, 7, '必须恰好 7 码');
      assert.equal(new Set(chosen).size, 7, '不得重复');
      assert.deepEqual(chosen, [...chosen].sort((a, b) => a - b), '结果应升序');
      assert.ok(chosen.every((n) => Number.isInteger(n) && n >= 1 && n <= 49));
    }
  }
});

test('配额宽松时，单双/大小/三区下限全部满足', () => {
  const colors = colorTable();
  const feasible = OPTS.filter((o) => o.minPerColor <= 1);
  for (let seed = 1; seed <= 40; seed++) {
    for (const opts of feasible) {
      const chosen = picker.selectBalancedSeven(scoreTable(seed), opts);
      const zones = [0, 0, 0, 0];
      const cnt = { red: 0, blue: 0, green: 0 };
      let odd = 0, big = 0;
      for (const n of chosen) {
        zones[zoneOf(n)]++;
        cnt[colors[n]]++;
        if (n % 2) odd++;
        if (n >= 25) big++;
      }
      for (let z = 1; z <= 3; z++) assert.ok(zones[z] >= opts.minPerZone, `单区低于下限 ${zones.join(',')}`);
      assert.ok(odd >= opts.oddRange[0] && odd <= opts.oddRange[1], `单双越界 ${odd}`);
      assert.ok(big >= opts.bigRange[0] && big <= opts.bigRange[1], `大小越界 ${big}`);
    }
  }
});

/**
 * 已知缺陷（本次重构未改动语义，仅锁定现状）：
 * 页面 #3 周期组用的配置是 minPerColor=2 / maxPerColor=3 / maxTailRepeat=1。
 * 这个组合下「三色各≥2 码」与「尾数不重复」互相挤压，贪心算法的严格轮次会
 * 走进死路，随后的兜底轮次会放宽全部约束（包括三色下限），于是少数情况下
 * 三色中会有一色只剩 1 码 —— 与界面上「选号依据」承诺的三色下限不符。
 * 这里记录实测发生率，防止后续改动让它恶化；真正的修法是让兜底轮次只放宽
 * 下限、仍守住上限，那会改变选定号码，需要单独评估。
 */
test('已知：周期组配置下三色下限偶发不满足（记录发生率，防止恶化）', () => {
  const colors = colorTable();
  const cycleOpts = { minPerZone: 2, maxPerZone: 3, minPerColor: 2, maxPerColor: 3, oddRange: [3, 4], bigRange: [3, 4], maxTailRepeat: 1 };
  let violated = 0;
  let tailViolated = 0;
  const total = 200;
  for (let seed = 1; seed <= total; seed++) {
    const chosen = picker.selectBalancedSeven(scoreTable(seed), cycleOpts);
    const cnt = { red: 0, blue: 0, green: 0 };
    const tails = new Array(10).fill(0);
    for (const n of chosen) {
      cnt[colors[n]]++;
      tails[n % 10]++;
    }
    if (Object.values(cnt).some((c) => c < cycleOpts.minPerColor)) violated++;
    if (Math.max(...tails) > cycleOpts.maxTailRepeat) tailViolated++;
  }
  assert.ok(violated / total <= 0.10, `三色下限违例率恶化：${violated}/${total}`);
  assert.ok(tailViolated / total <= 0.10, `尾数上限违例率恶化：${tailViolated}/${total}`);
  assert.ok(violated > 0 || tailViolated > 0,
    '若两者都为 0 说明约束已收紧到严格成立，应更新本测试与「选号依据」文案');
});

test('仓库里只保留一份求解器实现，index.html 不再内联算法', () => {
  // index.html 只应保留转发壳，不应出现原算法里的特征常量
  assert.ok(html.includes('src/seven-picker.js'), 'index.html 应引用 src/seven-picker.js');
  assert.ok(!html.includes('if (zDef > remAfter) continue;'), 'index.html 中不应再内联配额可行性判定');
  assert.ok(!html.includes('cursor += 0.12'), 'index.html 中不应残留尾数惩罚逻辑');

  const files = fs.readdirSync('src', { recursive: true })
    .filter(f => f.endsWith('.js'))
    .map(f => `src/${f}`);
  const withAlgorithm = files.filter(f => {
    const src = fs.readFileSync(f, 'utf8');
    // 只保留真正的实现：出现函数定义且包含软约束权重
    return /function selectBalancedSeven\s*\(/.test(src) && src.includes('0.18') && src.includes('remAfter');
  });
  assert.deepEqual(withAlgorithm, ['src/seven-picker.js'], `求解器实现应只有一份，实际：${withAlgorithm.join(', ')}`);
});

test('求解器可接受空分数表并稳定返回 7 码（不抛错）', () => {
  for (const opts of OPTS) {
    const chosen = picker.selectBalancedSeven({}, opts);
    assert.equal(chosen.length, 7);
    assert.deepEqual(chosen, [...chosen].sort((a, b) => a - b), '结果应升序');
  }
});
