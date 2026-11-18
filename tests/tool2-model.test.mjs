import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const scriptStart = html.indexOf('<script>\n') + '<script>\n'.length;
const scriptEnd = html.indexOf('/* ==================== 历史回放', scriptStart);
if (scriptStart < '<script>\n'.length || scriptEnd < 0) throw new Error('无法从 index.html 提取工具2模型');
const script = html.slice(scriptStart, scriptEnd) + `
globalThis.__tool2 = {
  COMPRESSED_DATA, BASE_RECORDS, WAVE_MAP, WAVE_COLOR, zoneOf,
  selectBalancedSeven, runTool2At, computeHeatSnapshot,
  scoreAllNumbers, strategyPercentile, STRATEGY_WEIGHTS, rankCandidatesFromPlan
};
`;
const context = vm.createContext({ console });
vm.runInContext(script, context);
const api = context.__tool2;

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

test('三策略输出三组各 7 码，并集与提纯逻辑已移除', () => {
  const usable = [...api.BASE_RECORDS].filter(r => r.usable);
  assert.equal(usable.length, 1780);
  const plan = api.runTool2At(usable, usable.length, 2026, 321, '2026-11-17');
  const hot = [...plan.groups.hot], cold = [...plan.groups.cold], cycle = [...plan.groups.cycle];
  for (const list of [hot, cold, cycle]) {
    assert.equal(list.length, 7);
    assert.equal(new Set(list).size, 7);
    assert.deepEqual(list, [...list].sort((a, b) => a - b));
  }

  const unionExpected = sortedUnique([...hot, ...cold, ...cycle]);
  assert.deepEqual([...plan.union], unionExpected);
  assert.ok(unionExpected.length >= 12 && unionExpected.length <= 21);

  // 不再有杀号 / 冷却池 / 提纯等排除口径
  for (const key of ['optPicks', 'killedByCyc', 'killedByCool', 'recentCool', 'coolSet', 'cycSet', 'hotKept', 'coldKept', 'hotColdShared']) {
    assert.equal(plan[key], undefined, `不应再输出 ${key}`);
  }
});

test('综合评分：49 码全部参与排序，权重与组内加成可复现', () => {
  const usable = [...api.BASE_RECORDS].filter(r => r.usable);
  const plan = api.runTool2At(usable, usable.length, 2026, 321, '2026-11-17');
  const rows = api.scoreAllNumbers(plan.scores, plan.groups);
  assert.equal(rows.length, 49);
  assert.deepEqual(sortedUnique(rows.map(r => r.n)), Array.from({ length: 49 }, (_, i) => i + 1));
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].score >= rows[i].score, '应按综合分降序');

  const weights = api.STRATEGY_WEIGHTS;
  assert.ok(Math.abs(weights.hot + weights.cold + weights.cycle - 1) < 1e-9, '三策略权重之和应为 1');

  const pctHot = api.strategyPercentile(plan.scores.hot);
  const sample = rows[0];
  const base = weights.hot * pctHot[sample.n]
    + weights.cold * api.strategyPercentile(plan.scores.cold)[sample.n]
    + weights.cycle * api.strategyPercentile(plan.scores.cycle)[sample.n];
  assert.ok(sample.score > base, '进入策略 7 码的号码应获得组内加成');

  // 每个档位都是同一份综合分排序的前 N 码（没有任何号码被提前剔除）
  const ranked = api.rankCandidatesFromPlan(plan);
  assert.deepEqual(ranked, rows.map(r => r.n));
  assert.equal(ranked.length, 49);
  for (const size of [5, 7, 10, 12, 18]) {
    const picks = ranked.slice(0, size);
    assert.equal(new Set(picks).size, size, `${size} 码档位不应有重复号码`);
  }
  // 三组 7 码里的号码整体应排在未入组号码之前
  const groupMembers = new Set([...plan.groups.hot, ...plan.groups.cold, ...plan.groups.cycle]);
  const top18 = ranked.slice(0, 18);
  assert.ok(top18.filter(n => groupMembers.has(n)).length >= 14, '前 18 码应以三策略命中号码为主');
});

test('selectBalancedSeven 同时满足区间、波色、单双大小与尾数约束', () => {
  const scores = new Float64Array(50);
  for (let n = 1; n <= 49; n++) scores[n] = n;
  const chosen = [...api.selectBalancedSeven(scores, {
    minPerZone: 1, maxPerZone: 3, minPerColor: 1, maxPerColor: 3,
    oddRange: [3, 4], bigRange: [3, 4], maxTailRepeat: 2
  })];
  assert.equal(chosen.length, 7);
  assert.equal(new Set(chosen).size, 7);
  const zones = [0, 0, 0, 0];
  const colors = { red: 0, blue: 0, green: 0 };
  const tails = new Array(10).fill(0);
  let odd = 0, big = 0;
  for (const n of chosen) {
    zones[api.zoneOf(n)]++;
    colors[api.WAVE_MAP[n]]++;
    tails[n % 10]++;
    if (n & 1) odd++;
    if (n >= 25) big++;
  }
  for (let z = 1; z <= 3; z++) assert.ok(zones[z] >= 1 && zones[z] <= 3, `区间配额越界：${zones.join(',')}`);
  for (const c of Object.values(colors)) assert.ok(c >= 1 && c <= 3, `波色配额越界：${JSON.stringify(colors)}`);
  assert.ok(odd >= 3 && odd <= 4);
  assert.ok(big >= 3 && big <= 4);
  assert.ok(Math.max(...tails) <= 2);
});

test('近100期热度快照正确追踪滑入 +1 与滑出 -1', () => {
  const rows = Array.from({ length: 101 }, (_, i) => {
    const sp = i === 0 ? 1 : 2;
    return {
      label: `T-${String(i).padStart(3, '0')}`,
      date: '2026-11-16',
      special: sp,
      numbers: [3, 4, 5, 6, 7, 8],
      raw7: [3, 4, 5, 6, 7, 8, sp],
      usable: true
    };
  });
  const snap = api.computeHeatSnapshot(rows, 100, 'special');
  assert.equal(snap.enteredDraw.special, 2);
  assert.equal(snap.exitedDraw.special, 1);
  assert.equal(snap.currFreq[2], 100);
  assert.equal(snap.prevFreq[2], 99);
  assert.equal(snap.currFreq[1], 0);
  assert.equal(snap.prevFreq[1], 1);
  assert.deepEqual([...snap.increased].map(x => ({ n: Number(x.n), prev: Number(x.prev), curr: Number(x.curr) })), [{ n: 2, prev: 99, curr: 100 }]);
  assert.deepEqual([...snap.decreased].map(x => ({ n: Number(x.n), prev: Number(x.prev), curr: Number(x.curr) })), [{ n: 1, prev: 1, curr: 0 }]);
  assert.equal([...snap.cancelled].length, 0);
});
