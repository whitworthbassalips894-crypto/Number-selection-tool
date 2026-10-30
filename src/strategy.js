/**
 * 六合彩「特码 · 三组 7 码」公共选号辅助与约束求解器
 *
 * 职责：
 *   1. getPriorDraws：严格提取早于目标期的历史开奖记录（无未来函数地基）
 *   2. selectBalancedSeven：在单组评分表（scoreMap）上选出满足形态约束的 7 个互不重复号码
 *      （组内 7 码严格不重复；组与组之间各自独立求解，允许自然重叠）
 */

import { ALL_NUMBERS, SPECIAL_GROUP_SIZE, getColorForNumber } from './constants.js';
import { normalizeNumbers } from './combinatorics.js';

/**
 * 过滤出严格早于目标期号的历史开奖记录（假设 draws 按时间降序排列，最新在前）
 * @param {object[]} allDraws
 * @param {{ year: number, periodNum: number }} target
 * @returns {object[]}
 */
export function getPriorDraws(allDraws, target) {
  if (!Array.isArray(allDraws) || allDraws.length === 0) return [];
  const tYear = Number(target?.year || 2026);
  const tPeriod = Number(target?.periodNum || 999);

  const prior = [];
  for (let i = 0; i < allDraws.length; i++) {
    const d = allDraws[i];
    if (d.year < tYear || (d.year === tYear && d.periodNum < tPeriod)) {
      prior.push(d);
    }
  }
  return prior;
}

const zoneOf = (n) => (n <= 16 ? 1 : n <= 33 ? 2 : 3);
const isBig = (n) => n >= 25;
const isOdd = (n) => n % 2 === 1;

/**
 * 从评分表中选出单组 7 码（组内互不重复，满足三区 / 波色 / 奇偶 / 大小 / 尾数约束）
 *
 * @param {Record<number, number>} scoreMap 号码 1..49 → 评分
 * @param {{
 *   size?: number,
 *   pinned?: number[],
 *   minPerZone?: number,
 *   maxPerZone?: number,
 *   minPerColor?: number,
 *   maxPerColor?: number,
 *   oddRange?: [number, number],
 *   bigRange?: [number, number],
 *   maxTailRepeat?: number
 * }} [opts]
 * @returns {number[]} 升序排列的号码数组（默认 7 个号）
 */
export function selectBalancedSeven(scoreMap = {}, opts = {}) {
  const size = Math.max(1, Math.min(49, Math.trunc(Number(opts.size ?? SPECIAL_GROUP_SIZE))));
  const minPerZone = Math.max(0, Math.trunc(Number(opts.minPerZone ?? 1)));
  const maxPerZone = Math.max(1, Math.trunc(Number(opts.maxPerZone ?? 3)));
  const minPerColor = Math.max(0, Math.trunc(Number(opts.minPerColor ?? 1)));
  const maxPerColor = Math.max(1, Math.trunc(Number(opts.maxPerColor ?? 3)));
  const oddRange = Array.isArray(opts.oddRange) ? opts.oddRange : [3, 4];
  const bigRange = Array.isArray(opts.bigRange) ? opts.bigRange : [3, 4];
  const maxTailRepeat = Math.max(1, Math.trunc(Number(opts.maxTailRepeat ?? 2)));

  // 归一化基础分到 0..1，便于与软约束权重稳定叠加
  let lo = Infinity;
  let hi = -Infinity;
  for (let n = 1; n <= 49; n++) {
    const v = Number(scoreMap[n] ?? 0);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo;
  const normScore = (n) => (span > 1e-12 ? (Number(scoreMap[n] ?? 0) - lo) / span : 0.5);

  const chosen = normalizeNumbers(opts.pinned || [], { sort: false, maxCount: size });
  const chosenSet = new Set(chosen);

  const countState = (list) => {
    const zones = { 1: 0, 2: 0, 3: 0 };
    const colors = { red: 0, blue: 0, green: 0 };
    const tails = new Array(10).fill(0);
    let odd = 0;
    let big = 0;
    for (const n of list) {
      zones[zoneOf(n)]++;
      colors[getColorForNumber(n)]++;
      tails[n % 10]++;
      if (isOdd(n)) odd++;
      if (isBig(n)) big++;
    }
    return { zones, colors, tails, odd, big };
  };

  /** 判断加入候选号 cand 后，剩余坑位是否仍可满足各项硬上下界 */
  const isFeasibleNext = (list, cand, strict = true) => {
    const nextList = [...list, cand];
    const k = nextList.length;
    const rem = size - k;
    const st = countState(nextList);

    if (strict) {
      if (st.zones[zoneOf(cand)] > maxPerZone) return false;
      if (st.colors[getColorForNumber(cand)] > maxPerColor) return false;
      if (st.tails[cand % 10] > maxTailRepeat) return false;

      // 三区最低配额可行性
      const zoneDeficit = [1, 2, 3].reduce((acc, z) => acc + Math.max(0, minPerZone - st.zones[z]), 0);
      if (zoneDeficit > rem) return false;

      // 三色最低配额可行性
      const colorDeficit = ['red', 'blue', 'green'].reduce(
        (acc, c) => acc + Math.max(0, minPerColor - st.colors[c]),
        0
      );
      if (colorDeficit > rem) return false;

      // 奇偶范围可行性
      if (size === SPECIAL_GROUP_SIZE) {
        if (st.odd > oddRange[1]) return false;
        if (st.odd + rem < oddRange[0]) return false;
        if (st.big > bigRange[1]) return false;
        if (st.big + rem < bigRange[0]) return false;
      }
    }
    return true;
  };

  const candidates = ALL_NUMBERS
    .filter((n) => !chosenSet.has(n))
    .sort((a, b) => normScore(b) - normScore(a) || a - b);

  while (chosen.length < size) {
    const st = countState(chosen);
    let bestNum = null;
    let bestVal = -Infinity;

    for (const strict of [true, false]) {
      for (const n of candidates) {
        if (chosenSet.has(n)) continue;
        if (!isFeasibleNext(chosen, n, strict)) continue;

        let val = normScore(n);
        const z = zoneOf(n);
        const c = getColorForNumber(n);

        // 空缺区 / 空缺波色温和加分，促使早早铺开而不过度扭曲原始高分
        if (st.zones[z] < minPerZone) val += 0.18;
        else if (st.zones[z] >= maxPerZone - 1) val -= 0.06;

        if (st.colors[c] < minPerColor) val += 0.14;
        else if (st.colors[c] >= maxPerColor - 1) val -= 0.05;

        if (st.tails[n % 10] > 0) val -= 0.12 * st.tails[n % 10];

        // 奇偶与大小向 3.5 中心轻微靠拢
        const targetMid = size / 2;
        const nextOddDist = Math.abs(st.odd + (isOdd(n) ? 1 : 0) - targetMid);
        const nextBigDist = Math.abs(st.big + (isBig(n) ? 1 : 0) - targetMid);
        val -= 0.05 * nextOddDist - 0.05 * nextBigDist;

        if (val > bestVal) {
          bestVal = val;
          bestNum = n;
        }
      }
      if (bestNum != null) break;
    }

    if (bestNum == null) break;
    chosen.push(bestNum);
    chosenSet.add(bestNum);
  }

  return chosen.sort((a, b) => a - b);
}

/** 兼容旧导出名 */
export const selectDirectNumbers = (scoreMap, _features, opts = {}) =>
  selectBalancedSeven(scoreMap, opts);
