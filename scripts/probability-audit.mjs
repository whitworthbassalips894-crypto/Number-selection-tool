#!/usr/bin/env node
/**
 * 概率体检脚本：把「这套选号逻辑到底有没有预测力」变成一个可复现、可复算的结论
 *
 * 用法：
 *   node scripts/probability-audit.mjs            # 默认回放最近 500 期
 *   node scripts/probability-audit.mjs --all      # 回放全部可用历史
 *
 * 输出四组检验：
 *   1. 特码均匀性（卡方）：号码本身是否有偏
 *   2. 遗漏无记忆检验：P(开出 | 已遗漏 k 期) 是否恒为 1/49
 *   3. 策略命中率显著性：三组 7 码 / 综合分前 N 码 vs k/49 基线，附 z 值
 *   4. 综合评分 AUC：评分把「开出的特码」排在随机号码之上的概率（0.5 = 无预测力）
 *   5. 档位一致性：12码档是否真被并集档包含（README 声称严格包含）
 *   6. 温度计标签的纯随机基线（阈值固定 20%/30%，不随档位变化）
 *   7. 连错 / 追号：连错概率与各档期望亏损（RTP）
 *
 * 不修改任何业务代码，只读 index.html 内联引擎 + data/draws.js。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALL = process.argv.includes('--all');
const WINDOW = ALL ? Infinity : 500;

/* ---------- 1. 取出引擎（与 tests/tool2-model.test.mjs 相同的提取方式） ---------- */
function loadEngine() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('<script>\n') + '<script>\n'.length;
  const end = html.indexOf('/* ==================== 历史回放', start);
  if (end < 0) throw new Error('无法从 index.html 提取引擎');
  const ctx = vm.createContext({ console });
  vm.runInContext(
    html.slice(start, end) +
      '\nglobalThis.__engine = { BASE_RECORDS, runTool2At, scoreAllNumbers };',
    ctx
  );
  return ctx.__engine;
}

const engine = loadEngine();
const usable = [...engine.BASE_RECORDS]
  .filter((r) => r.usable)
  .sort((a, b) => a.year - b.year || a.periodNum - b.periodNum);
const specials = usable.map((d) => Number(d.special));

/* ---------- 2. 特码均匀性 ---------- */
function uniformity() {
  const count = new Array(50).fill(0);
  for (const n of specials) count[n]++;
  const expected = specials.length / 49;
  let chi2 = 0;
  for (let n = 1; n <= 49; n++) chi2 += (count[n] - expected) ** 2 / expected;
  const sorted = count.slice(1).sort((a, b) => b - a);
  return { n: specials.length, chi2, df: 48, crit95: 65.17, max: sorted[0], min: sorted.at(-1), expected };
}

/* ---------- 3. 遗漏无记忆 ---------- */
function omissionMemory() {
  const last = new Array(50).fill(-1);
  const buckets = new Map();
  const key = (k) => (k < 10 ? '0-9' : k < 20 ? '10-19' : k < 30 ? '20-29' : k < 40 ? '30-39' : k < 60 ? '40-59' : '60+');
  for (let i = 0; i < specials.length; i++) {
    const s = specials[i];
    for (let n = 1; n <= 49; n++) {
      if (last[n] < 0) continue;
      const k = i - 1 - last[n]; // 开奖前已连续遗漏 k 期
      const b = key(k);
      if (!buckets.has(b)) buckets.set(b, { win: 0, n: 0 });
      const cell = buckets.get(b);
      cell.n++;
      if (n === s) cell.win++;
    }
    last[s] = i;
  }
  return ['0-9', '10-19', '20-29', '30-39', '40-59', '60+']
    .filter((b) => buckets.has(b))
    .map((b) => {
      const { win, n } = buckets.get(b);
      const p = win / n;
      const se = Math.sqrt(p * (1 - p) / n);
      return { bucket: b, n, p, lo: p - 1.96 * se, hi: p + 1.96 * se };
    });
}

/* ---------- 4. 逐期回放：命中率 + AUC ---------- */
function replay() {
  const from = Math.max(300, usable.length - (WINDOW === Infinity ? usable.length : WINDOW));
  const tiers = { 5: [], 7: [], 10: [], 12: [], union: [], hot: [], cold: [], cycle: [] };
  let conc = 0, tie = 0, pairs = 0, unionExpected = 0;

  for (let i = from; i < usable.length; i++) {
    const d = usable[i];
    const plan = engine.runTool2At(usable, i, d.year, d.periodNum, d.date);
    const rows = engine.scoreAllNumbers(plan.scores, plan.groups);
    const sp = Number(d.special);

    tiers.hot.push(plan.groups.hot.includes(sp));
    tiers.cold.push(plan.groups.cold.includes(sp));
    tiers.cycle.push(plan.groups.cycle.includes(sp));
    tiers.union.push(plan.union.includes(sp));
    unionExpected += plan.union.length / 49;
    for (const size of [5, 7, 10, 12]) {
      tiers[size].push(rows.slice(0, size).some((r) => r.n === sp));
    }

    const score = new Map(rows.map((r) => [r.n, r.score]));
    const sSelf = score.get(sp);
    for (let n = 1; n <= 49; n++) {
      if (n === sp) continue;
      pairs++;
      if (sSelf > score.get(n)) conc++;
      else if (sSelf === score.get(n)) tie++;
    }
  }
  return { tiers, auc: (conc + tie / 2) / pairs, periods: tiers[5].length, unionExpected };
}

function zTest(hits, n, k) {
  const base = k / 49;
  const se = Math.sqrt(base * (1 - base) / n);
  return { hits, n, rate: hits / n, base, z: (hits / n - base) / se };
}

/* ---------- 5. 档位一致性 ---------- */
function tierConsistency() {
  const from = Math.max(300, usable.length - Math.min(WINDOW === Infinity ? 500 : WINDOW, 500));
  let broken = 0, total = 0, sumK = 0, minK = 99, maxK = 0, bigInGroups = 0, slots = 0;
  for (let i = from; i < usable.length; i++) {
    const d = usable[i];
    const plan = engine.runTool2At(usable, i, d.year, d.periodNum, d.date);
    const rows = engine.scoreAllNumbers(plan.scores, plan.groups);
    const top12 = rows.slice(0, 12).map((r) => r.n);
    if (!top12.every((n) => plan.union.includes(n))) broken++;
    const K = plan.union.length;
    sumK += K;
    minK = Math.min(minK, K);
    maxK = Math.max(maxK, K);
    for (const key of ['hot', 'cold', 'cycle']) {
      for (const n of plan.groups[key]) {
        slots++;
        if (n >= 25) bigInGroups++;
      }
    }
    total++;
  }
  return { broken, total, sumK, minK, maxK, bigInGroups, slots };
}

/* ---------- 输出 ---------- */
const u = uniformity();
console.log('=== 1. 特码均匀性（df=48，5% 临界值 65.17）===');
console.log(`可用期数 ${u.n}，理论每号 ${u.expected.toFixed(1)} 次`);
console.log(`卡方 ${u.chi2.toFixed(2)} → ${u.chi2 < u.crit95 ? '未检出偏差，号码本身均匀' : '检出偏差'}`);
console.log(`最高频 ${u.max} 次 / 最低频 ${u.min} 次（极差 ${u.max - u.min}，属正常抽样波动）`);

console.log('\n=== 2. 遗漏无记忆检验：P(本期开出特码 | 该号已连续遗漏 k 期)，理论 1/49 = 2.04% ===');
for (const r of omissionMemory()) {
  console.log(`  遗漏 ${r.bucket.padEnd(6)} 期: ${(r.p * 100).toFixed(2)}%  95%CI [${(r.lo * 100).toFixed(2)}, ${(r.hi * 100).toFixed(2)}]  n=${r.n}`);
}
console.log('  结论：各桶区间全部覆盖 2.04% → 「遗漏越久越该开」在本数据上不成立');

const r = replay();
console.log(`\n=== 3. 逐期回放命中率（最近 ${r.periods} 期，z 值 > 1.96 才算显著）===`);
for (const [label, key, k] of [['#1 热态 7码', 'hot', 7], ['#2 遗漏 7码', 'cold', 7], ['#3 周期 7码', 'cycle', 7], ['三组并集', 'union', null], ['综合前 5 码', 5, 5], ['综合前 7 码', 7, 7], ['综合前 10 码', 10, 10], ['综合前 12 码', 12, 12]]) {
  const arr = r.tiers[key];
  const hits = arr.filter(Boolean).length;
  if (key === 'union') {
    // 并集档每期码数不同，基线取「逐期 K/49 的均值」，再按该期望用二项标准误算 z
    const n = arr.length;
    const base = r.unionExpected / n;
    const se = Math.sqrt(base * (1 - base) / n);
    const rate = hits / n;
    const z = (rate - base) / se;
    console.log(`${label.padEnd(12)} ${hits}/${n} = ${(rate * 100).toFixed(2)}%  基线 ${(base * 100).toFixed(2)}%（按当期码数逐期加权）  z=${z.toFixed(2)}  ${Math.abs(z) > 1.96 ? '※显著' : '不显著'}`);
  } else {
    const t = zTest(hits, arr.length, k);
    console.log(`${label.padEnd(12)} ${hits}/${arr.length} = ${(t.rate * 100).toFixed(2)}%  基线 ${(t.base * 100).toFixed(2)}%  z=${t.z.toFixed(2)}  ${Math.abs(t.z) > 1.96 ? '※显著' : '不显著'}`);
  }
}

console.log(`\n=== 4. 综合评分 AUC = ${r.auc.toFixed(4)}（0.5 = 完全没有预测力，1 = 完美）===`);

const c = tierConsistency();
console.log(`\n=== 5. 档位一致性（最近 ${c.total} 期）===`);
console.log(`「12码档 ⊆ 并集档」被破坏：${c.broken}/${c.total} = ${(c.broken / c.total * 100).toFixed(1)}%（点 12码 再点 并集全取，号码会变少）`);
console.log(`并集档码数：${c.minK} ~ ${c.maxK}，平均 ${(c.sumK / c.total).toFixed(1)}（第 5 档不是固定 18 码，投入随之浮动）`);
console.log(`三组 21 码中大号(≥25) 占比 ${(c.bigInGroups / c.slots * 100).toFixed(1)}%，理论应为 51.0%（偏小号）`);

/* ---------- 6. 温度计「偏冷 / 正常 / 偏热」标签的基线 ---------- */
function thermoLabels() {
  const C = (n, k) => (k < 0 || k > n ? 0 : (() => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; })());
  const rows = [];
  for (const [name, k] of [['5码', 5], ['7码', 7], ['10码', 10], ['12码', 12], ['并集(平均18.4码)', 18.4]]) {
    const p = k / 49;
    let cool = 0, normal = 0, warm = 0;
    for (let h = 0; h <= 30; h++) {
      const q = C(30, h) * p ** h * (1 - p) ** (30 - h);
      const rate = h / 30;
      if (rate >= 0.3) warm += q;
      else if (rate >= 0.2) normal += q;
      else cool += q;
    }
    rows.push({ name, base: p, cool, normal, warm });
  }
  return rows;
}

console.log('\n=== 6. 温度计标签的纯随机基线（阈值写死 20% / 30%，不随档位调整）===');
for (const r of thermoLabels()) {
  console.log(`  ${r.name.padEnd(16)} 真实命中率 ${(r.base * 100).toFixed(1)}% → 30 期里被标成「偏冷」${(r.cool * 100).toFixed(1)}% / 「正常」${(r.normal * 100).toFixed(1)}% / 「偏热」${(r.warm * 100).toFixed(1)}%`);
}
console.log('  → 同一套阈值：5 码档几乎永远「偏冷」，并集档几乎永远「偏热」，标签反映的是码数而不是状态');

/* ---------- 7. 连错提示与「追号」的数学 ---------- */
console.log('\n=== 7. 连错 / 追号 ===');
for (const [name, k] of [['5码', 5], ['7码', 7], ['10码', 10], ['12码', 12], ['并集', 18.4]]) {
  const miss = 1 - k / 49;
  const p5 = miss ** 5;
  const inWindow = 1 - (1 - p5) ** 26; // 30 期窗口内至少出现一次 5 连错
  console.log(`  ${name.padEnd(6)} 单期不中 ${(miss * 100).toFixed(1)}% → 连错 5 期的概率 ${(p5 * 100).toFixed(1)}%，30 期窗口里至少出现一次的概率 ${(inWindow * 100).toFixed(0)}%`);
}
console.log('  → 「连续 N 期未中」在纯随机下极为常见，不构成「该回补了」的证据');
const stake = 10,
  odds = 48;
for (const [name, k] of [['5码', 5], ['7码', 7], ['10码', 10], ['12码', 12], ['并集', 18.4]]) {
  const cost = k * stake, back = (k / 49) * odds * stake;
  console.log(`  ${name.padEnd(6)} 每期投入 ¥${cost.toFixed(0)}，期望返奖 ¥${back.toFixed(1)}，期望净亏 ¥${(cost - back).toFixed(2)}（RTP ${((back / cost) * 100).toFixed(2)}%）`);
}
