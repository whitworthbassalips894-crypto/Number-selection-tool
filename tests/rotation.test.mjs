import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const scriptStart = html.indexOf('<script>\n') + '<script>\n'.length;
const scriptEnd = html.indexOf('/* 本页的整理、存储与界面。所有计算均在本地进行。 */', scriptStart);
if (scriptStart < '<script>\n'.length || scriptEnd < 0) throw new Error('无法从 index.html 提取选号模型');
const script = html.slice(scriptStart, scriptEnd) + `
globalThis.__selection = {
  makeSelection, runSignalModelAt, allocationOrderFor, SIGNAL_META, SIGNAL_ROTATION,
  rankSignals, canAddSelection, FIXED_SELECTION_SIZE, SIGNAL_QUOTA, selectionZoneOf,
  COMPRESSED_DATA
};
`;
const context = vm.createContext({});
vm.runInContext(script, context);
const api = context.__selection;

function planFromLists(lists) {
  const scores = {};
  for (const [id, list] of Object.entries(lists)) {
    const arr = new Float64Array(50);
    list.forEach((n, i) => { arr[n] = 1000 - i; });
    scores[id] = arr;
  }
  return {scores, details: {}, historyLength: 0};
}

// 三份排名故意让前 4 名大量重叠，用来验证「谁先挑」确实随期号变化。
const core = [1, 13, 25, 37, 2, 14, 26, 38, 3, 15, 27, 39];
const rest = Array.from({length: 49}, (_, i) => i + 1).filter(n => !core.includes(n));
const hotList = [...core, ...rest];
const omitList = [...core, ...rest];
const cycleList = [2, 14, 26, 38, 3, 15, 27, 39, 1, 13, 25, 37, ...rest];
const overlapPlan = planFromLists({hot: hotList, omit: omitList, cycle: cycleList});

function checkInvariants(sel, expectedAllocation) {
  assert.deepEqual([...sel.allocation], expectedAllocation);
  assert.equal(sel.order.length, api.FIXED_SELECTION_SIZE);
  assert.equal(new Set(sel.order.map(p => p.n)).size, api.FIXED_SELECTION_SIZE);
  for (const meta of api.SIGNAL_META) assert.equal(sel.groups[meta.id].length, api.SIGNAL_QUOTA);
  const allPicks = Object.values(sel.groups).flat();
  assert.equal(new Set(allPicks.map(p => p.n)).size, api.FIXED_SELECTION_SIZE);
  const zones = [0, 0, 0, 0];
  for (const p of allPicks) zones[api.selectionZoneOf(p.n)]++;
  for (const count of zones) assert.ok(count >= 2 && count <= 4, `区间配额越界：${zones.join(',')}`);
  for (const p of allPicks) {
    assert.ok(p.signals.includes(p.source), `号码 ${p.n} 缺少本路共鸣标签`);
    assert.deepEqual([...p.resonance], [...p.signals].filter(id => id !== p.source), `号码 ${p.n} 共鸣标签不一致`);
  }
}

test('目标期期号 ÷ 3 决定三路分配顺序', () => {
  assert.deepEqual([...api.allocationOrderFor(1)], ['hot', 'omit', 'cycle']);
  assert.deepEqual([...api.allocationOrderFor(2)], ['omit', 'cycle', 'hot']);
  assert.deepEqual([...api.allocationOrderFor(3)], ['cycle', 'hot', 'omit']);
  assert.deepEqual([...api.allocationOrderFor(4)], ['hot', 'omit', 'cycle']);
  assert.deepEqual([...api.allocationOrderFor(319)], ['hot', 'omit', 'cycle']);
  assert.deepEqual([...api.allocationOrderFor(320)], ['omit', 'cycle', 'hot']);
  assert.deepEqual([...api.allocationOrderFor(318)], ['cycle', 'hot', 'omit']);
  assert.deepEqual([...api.makeSelection(overlapPlan).allocation], ['hot', 'omit', 'cycle']);
  for (const [periodNum, expected] of [[1, ['hot','omit','cycle']], [2, ['omit','cycle','hot']], [3, ['cycle','hot','omit']]]) {
    checkInvariants(api.makeSelection(overlapPlan, periodNum), expected);
  }
});

test('轮换改变先选权；后路跳过已占号码并继续补选', () => {
  const first = [1, 13, 25, 37];
  const second = [2, 14, 26, 38];
  const third = [3, 15, 27, 39];
  const s1 = api.makeSelection(overlapPlan, 1);
  const s2 = api.makeSelection(overlapPlan, 2);
  const s0 = api.makeSelection(overlapPlan, 3);

  assert.deepEqual([...s1.groups.hot.map(p => p.n)], first);
  assert.deepEqual([...s1.groups.omit.map(p => p.n)], second);
  assert.deepEqual([...s1.groups.cycle.map(p => p.n)], third);
  assert.deepEqual([...s2.groups.omit.map(p => p.n)], first);
  assert.deepEqual([...s2.groups.cycle.map(p => p.n)], second);
  assert.deepEqual([...s2.groups.hot.map(p => p.n)], third);
  assert.deepEqual([...s0.groups.cycle.map(p => p.n)], second);
  assert.deepEqual([...s0.groups.hot.map(p => p.n)], first);
  assert.deepEqual([...s0.groups.omit.map(p => p.n)], third);

  for (const sel of [s1, s2, s0]) {
    const groups = Object.values(sel.groups);
    for (let i = 0; i < groups.length; i++) {
      const earlier = new Set(groups.slice(0, i + 1).flat().map(p => p.n));
      for (const p of groups[i + 1] || []) assert.ok(!earlier.has(p.n), `号码 ${p.n} 被后路重复占用`);
    }
  }

  const hotOne = s1.groups.hot.find(p => p.n === 1);
  assert.deepEqual([...hotOne.signals], ['hot', 'omit']);
  assert.deepEqual([...hotOne.resonance], ['omit']);
});

test('真实底库下三种轮换都保持 12 码、区间与共鸣约束', () => {
  const rows = api.COMPRESSED_DATA.map(r => ({special: r[8]}));
  const plan = api.runSignalModelAt(rows, rows.length);
  for (const periodNum of [318, 319, 320]) {
    checkInvariants(api.makeSelection(plan, periodNum), [...api.allocationOrderFor(periodNum)]);
  }
});
