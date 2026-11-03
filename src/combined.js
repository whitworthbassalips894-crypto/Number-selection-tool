/** 双方案适配层。两个引擎保持原样，均只读取严格早于目标期的数据。 */
import { generateDailyFive as tool1 } from './tool1/dailyfive.js';
import { generateDailyFive as tool2 } from './dailyfive.js';
import { isUsableDraw } from './audit.js';

export const STRATEGIES = {
  a: '方案 A · 双工具共振（剔除随机）',
  b: '方案 B · 热+冷 5 码',
  ab: '方案 A + 方案 B',
  tool2: '工具 2 · 原版 21 注（重复号累计）',
  tool2Unique: '工具 2 · 三组去重',
  tool1: '工具 1 · 原版 12 码'
};

export function combinedPlan(draws, target, threePlan = null) {
  const three = threePlan || tool2(draws, target);
  const twelve = tool1(draws, target, { mode: 'special', randomSalt: 0 }).five[0];
  const groups = three.five.map(e => e.numbers);
  const union = new Set(groups.flat());
  const a = twelve.numbers.filter(n => twelve.styles[n] !== 'random' && union.has(n));
  const b = twelve.numbers.filter(n => ['hot', 'cold'].includes(twelve.styles[n]));
  // 两套方案各自下注；共同号在两套方案中各计一注，不能去重。
  const ab = [...a, ...b];
  return { three, twelve, a, b, ab, tool2: groups.flat(), tool2Unique: [...union].sort((a, b) => a - b), tool1: twelve.numbers };
}

export function replayRecord(draws, draw) {
  if (!isUsableDraw(draw)) return null;
  const p = combinedPlan(draws, draw);
  const picks = Object.fromEntries(Object.keys(STRATEGIES).map(k => [k, p[k]]));
  return { draw, picks };
}

/** 净收益按时间正序结算；年度表从该年零余额重置，总计贯穿全年。 */
export function summarize(records, key, stake = 10, odds = 48) {
  const chronological = [...records].sort((a, b) => a.draw.year - b.draw.year || a.draw.periodNum - b.draw.periodNum);
  let bets = 0, hits = 0, net = 0, peak = 0, maxDrawdown = 0, losing = 0, longestLosing = 0;
  for (const r of chronological) {
    const numbers = r.picks[key];
    const wins = numbers.filter(n => n === Number(r.draw.special)).length;
    bets += numbers.length; hits += wins;
    net += stake * (wins * odds - numbers.length);
    peak = Math.max(peak, net);
    maxDrawdown = Math.max(maxDrawdown, peak - net);
    losing = wins ? 0 : losing + 1;
    longestLosing = Math.max(longestLosing, losing);
  }
  const cost = bets * stake;
  return { periods: chronological.length, bets, hits, hitRate: bets ? hits / bets : 0, net, roi: cost ? net / cost : 0, maxDrawdown, longestLosing };
}
