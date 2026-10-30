/**
 * 组合数学与「特码（1 中 1）· 三组 7 码」命中核对与收益计算引擎
 *
 * 特码口径（1 中 1）：
 *   - **1 个号码 = 1 注**。
 *   - 开奖的**最后一个号码（特码）**等于某组里的某个号码，该号码就中 1 注；
 *   - 6 个正码（平一～平六）不参与特码玩法的判定；
 *   - 每组 7 个不重复号 = 7 注；3 组允许号码重叠，独立累计共 21 注：
 *       成本 = 总注数 × 单注本金（3 组 × 7 注 = 21 注）
 *       返奖 = 命中总注数 × 单注本金 × 特码赔率（若重叠号开出特码，中几组就返几份奖金）
 */

import { DEFAULT_CONFIG } from './constants.js';

/**
 * 计算组合数 C(n, k)
 * @param {number} n
 * @param {number} k
 * @returns {number}
 */
export function binomial(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  const m = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= m; i++) {
    result = Math.round((result * (n - m + i)) / i);
  }
  return result;
}

export const countCombos = binomial;

/**
 * 生成数组的所有 C(n, k) 组合（字典序升序）
 * @template T
 * @param {T[]} items
 * @param {number} k
 * @returns {T[][]}
 */
export function combinations(items, k) {
  const arr = Array.isArray(items) ? items.slice() : [];
  const n = arr.length;
  if (k <= 0 || k > n) return [];
  const results = [];
  const current = new Array(k);

  function backtrack(start, depth) {
    if (depth === k) {
      results.push(current.slice());
      return;
    }
    const maxStart = n - (k - depth);
    for (let i = start; i <= maxStart; i++) {
      current[depth] = arr[i];
      backtrack(i + 1, depth + 1);
    }
  }

  backtrack(0, 0);
  return results;
}

/**
 * 清洗并规范化号码列表（1..49 整数、去重、可选排序）
 * @param {Array<number|string>} rawNums
 * @param {{ sort?: boolean, maxCount?: number }} [options]
 * @returns {number[]}
 */
export function normalizeNumbers(rawNums, options = {}) {
  const { sort = true, maxCount = 49 } = options;
  if (!Array.isArray(rawNums)) return [];
  const seen = new Set();
  const out = [];
  for (const item of rawNums) {
    const n = Number(item);
    if (Number.isInteger(n) && n >= 1 && n <= 49 && !seen.has(n)) {
      seen.add(n);
      out.push(n);
      if (out.length >= maxCount) break;
    }
  }
  if (sort) {
    out.sort((a, b) => a - b);
  }
  return out;
}

/**
 * 提取某期开奖的正码与特码
 * @param {{ numbers?: Array<number|string>, special?: number|string } | Array<number|string>} draw
 * @returns {{ normalList: number[], normalSet: Set<number>, special: number|null }}
 */
export function extractDrawNormals(draw) {
  if (!draw) {
    return { normalList: [], normalSet: new Set(), special: null };
  }
  const rawNormals = Array.isArray(draw)
    ? draw.slice(0, 6)
    : Array.isArray(draw.numbers)
      ? draw.numbers.slice(0, 6)
      : [];
  const normalList = [];
  const normalSet = new Set();
  for (const item of rawNormals) {
    const n = Number(item);
    if (Number.isInteger(n) && n >= 1 && n <= 49) {
      normalList.push(n);
      normalSet.add(n);
    }
  }
  const rawSpecial = !Array.isArray(draw) && draw.special != null ? Number(draw.special) : null;
  const special = Number.isInteger(rawSpecial) && rawSpecial >= 1 && rawSpecial <= 49 ? rawSpecial : null;
  return { normalList, normalSet, special };
}

/**
 * 核对一组「特码」注单（1 中 1：**1 个号码 = 1 注**）
 *
 * 命中规则：开奖的最后一个号码（特码）等于某组里的某个号码，该组即中 1 注；
 * 6 个正码不参与判定。每组有几个号码就是几注，多组之间若重叠号命中特码则独立叠加结算：
 *   成本 = 总注数 × 本金
 *   返奖 = 命中总注数 × 本金 × 赔率
 *
 * @param {Array<Array<number|string>>} tickets 每组（或每注）号码数组
 * @param {{ numbers?: number[], special?: number } | null} draw 开奖结果
 * @param {{ stake?: number, oddsSpecial?: number, targetSize?: number, size?: number }} [userConfig]
 */
export function evaluateSpecialTickets(tickets, draw, userConfig = {}) {
  const stake = Math.max(0, Number(userConfig.stake ?? DEFAULT_CONFIG.stake));
  const odds = Math.max(0, Number(userConfig.oddsSpecial ?? DEFAULT_CONFIG.oddsSpecial ?? 48));
  const rawSize = Math.trunc(Number(userConfig.targetSize ?? userConfig.size ?? 0));
  const maxSize = rawSize > 0 ? Math.min(49, rawSize) : 49;

  const { normalList, special } = extractDrawNormals(draw);
  const hasSpecial = Number.isInteger(special) && special >= 1 && special <= 49;

  const normalizedTickets = (Array.isArray(tickets) ? tickets : [])
    .map((t) => normalizeNumbers(t, { sort: true, maxCount: maxSize }))
    .filter((t) => t.length > 0);

  const details = normalizedTickets.map((nums, idx) => {
    const hitNums = hasSpecial && nums.includes(special) ? [special] : [];
    const hitCount = hitNums.length;
    const bets = nums.length;
    return {
      index: idx + 1,
      nums,
      bets,
      hitNums,
      hitCount,
      isWin: hitCount > 0,
      cost: bets * stake,
      payout: hitCount * stake * odds
    };
  });

  const winningTickets = details.filter((d) => d.isWin);
  const totalBets = details.reduce((sum, d) => sum + d.bets, 0);
  const winCount = details.reduce((sum, d) => sum + d.hitCount, 0);
  const cost = totalBets * stake;
  const payout = hasSpecial ? winCount * stake * odds : 0;
  const netProfit = hasSpecial ? payout - cost : 0;
  const roi = hasSpecial && cost > 0 ? Number(((netProfit / cost) * 100).toFixed(2)) : 0;

  return {
    targetSize: maxSize,
    playMode: 'special',
    hasDraw: hasSpecial,
    hasSpecial,
    normalList,
    special,
    totalBets,
    winCount,
    cost,
    payout,
    net: netProfit,
    netProfit,
    roi,
    stake,
    odds,
    details,
    winningTickets
  };
}

/**
 * 统一注单核对入口（本工具仅保留特码 1 中 1 玩法）
 */
export function evaluateTickets(tickets, draw, userConfig = {}) {
  return evaluateSpecialTickets(tickets, draw, userConfig);
}
