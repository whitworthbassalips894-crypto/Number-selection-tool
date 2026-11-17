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
  selectBalancedSeven, runTool2At, computeHeatSnapshot
};
`;
const context = vm.createContext({ console });
vm.runInContext(script, context);
const api = context.__tool2;

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

test('工具2输出三组各 7 码，提纯与并集关系保持不变', () => {
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

  const seen = new Set(), recentCoolExpected = [];
  for (const r of usable.slice(-5).reverse()) {
    if (!seen.has(r.special)) { seen.add(r.special); recentCoolExpected.push(r.special); }
  }
  assert.deepEqual([...plan.recentCool], recentCoolExpected);
  const cycSet = new Set(cycle), coolSet = new Set(recentCoolExpected);
  const hcUnion = sortedUnique([...hot, ...cold]);
  assert.deepEqual([...plan.optPicks], hcUnion.filter(n => !cycSet.has(n) && !coolSet.has(n)));
  assert.deepEqual([...plan.killedByCyc], hcUnion.filter(n => cycSet.has(n)));
  assert.deepEqual([...plan.killedByCool], hcUnion.filter(n => !cycSet.has(n) && coolSet.has(n)));
  assert.deepEqual([...plan.hotColdShared], hot.filter(n => cold.includes(n)));
  assert.deepEqual([...plan.hotKept], hot.filter(n => !cycSet.has(n) && !coolSet.has(n)));
  assert.deepEqual([...plan.coldKept], cold.filter(n => !cycSet.has(n) && !coolSet.has(n)));
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
