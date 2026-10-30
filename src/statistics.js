/**
 * 统计基线工具：特码（1 中 1）· 每日三组 7 码（共 21 注，允许重叠）的随机概率与期望基线
 *
 * 数学口径：
 *   - 号码池 49 个（01~49），每期开出 1 个特码；
 *   - 1 个号 = 1 注（1 中 1），单注命中概率 P = 1/49 ≈ 2.0408%，理论公平赔率 = 49 倍；
 *   - 单组 7 码（组内 7 个互不重复号码 = 7 注）：
 *       组内各号互斥，该组命中特码的概率 = 7/49 = 1/7 ≈ 14.2857%，场均期望中奖 7/49 ≈ 0.1429 注；
 *   - 三组 7 码独立累计（共 3 × 7 = 21 注，组与组之间允许重叠）：
 *       · 由期望的线性性，无论组间重叠几个号，21 注场均期望命中总注数恒为 21 × (1/49) = 3/7 ≈ 0.4286 注；
 *       · 每一注的期望回报率恒为 赔率 × (1/49)（48 倍时 48/49 ≈ 97.96%）；
 *       · 「至少中 1 注（至少 1 组命中）」的概率取决于当期 3 组去重后的覆盖号码数 K：
 *         精确值 = K / 49（重叠越多，K 越小，不中概率略升，但一旦命中重叠号会同时中 2~3 注，总期望不变）。
 */

import { SPECIAL_GROUP_COUNT, SPECIAL_GROUP_SIZE, SPECIAL_TOTAL_BETS } from './constants.js';

/**
 * 组合数 C(n, k)
 * @param {number} n
 * @param {number} k
 * @returns {number}
 */
export function comb(n, k) {
  const N = Math.trunc(Number(n));
  const K = Math.trunc(Number(k));
  if (!Number.isFinite(N) || !Number.isFinite(K) || K < 0 || K > N) return 0;
  const m = Math.min(K, N - K);
  let result = 1;
  for (let i = 1; i <= m; i++) {
    result = (result * (N - m + i)) / i;
  }
  return result;
}

/**
 * 把概率格式化为百分比字符串
 * @param {number} p 0~1
 * @param {number} [digits=2]
 * @returns {string}
 */
export function formatPercent(p, digits = 2) {
  const v = Number(p);
  if (!Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

/**
 * 特码三组 7 码基线
 */
export function specialBaseline() {
  const population = 49;
  const size = SPECIAL_GROUP_SIZE; // 每组 7 个号
  const groups = SPECIAL_GROUP_COUNT; // 每期 3 组
  const betsPerGroup = SPECIAL_GROUP_SIZE; // 每组 7 注
  const totalBets = SPECIAL_TOTAL_BETS; // 合计 21 注
  const hitProb = 1 / population; // 单注（1 个号）命中率 1/49
  const groupHitProb = size / population; // 单组（7 码）命中率 7/49 = 1/7
  return {
    size,
    groupSize: size,
    groups,
    groupCount: groups,
    bets: betsPerGroup,
    totalBets,
    population,
    totalSpace: population,
    draws: 1,
    marked: 1,
    playMode: 'special',
    /** 单注（1 个号）命中概率 1/49 */
    hitProb,
    /** 单组（7 个不重复号 = 7 注）命中概率 7/49 */
    hitProbPerTicket: groupHitProb,
    /** 理论公平赔率 49 倍 */
    fairOdds: population,
    /** 单组场均期望命中注数 7/49 ≈ 0.1429 */
    expectedHitsPerGroup: size * hitProb,
    /** 3 组 21 注合计场均期望命中注数 21/49 = 3/7 ≈ 0.4286（与是否重叠无关） */
    expectedHits: totalBets * hitProb,
    /** 3 组完全不重叠（覆盖 21 个号）时至少中 1 注的概率上界 21/49 */
    anyHitProbUpper: Math.min(1, totalBets * hitProb),
    /** 3 组完全重叠（只覆盖 7 个号）时至少中 1 注的概率下界 7/49 */
    anyHitProbLower: groupHitProb
  };
}

/** 兼容性别名：本工具仅保留特码玩法 */
export function directBaseline() {
  return specialBaseline();
}

export const SPECIAL_BASELINE = specialBaseline();

/**
 * 按去重后的实际覆盖号码数计算「至少中 1 注」精确概率
 * @param {number} distinctNumbers 去重后的号码个数
 * @param {number} [population=49]
 * @returns {number}
 */
export function anyHitByDistinct(distinctNumbers, population = 49) {
  const k = Math.max(0, Math.min(population, Math.trunc(Number(distinctNumbers) || 0)));
  return k / population;
}

/**
 * 按当前特码赔率计算期望回报率（赔率 × 单注命中概率 1/49）
 * 兼容旧签名 expectedReturnRate(mode, odds) 与单参 expectedReturnRate(odds)
 * @param {number|string} modeOrOdds
 * @param {number} [maybeOdds]
 * @returns {number}
 */
export function expectedReturnRate(modeOrOdds = 'special', maybeOdds = undefined) {
  const odds = maybeOdds === undefined && typeof modeOrOdds === 'number'
    ? modeOrOdds
    : (maybeOdds ?? 48);
  const o = Number(odds);
  if (!Number.isFinite(o) || o <= 0) return 0;
  return o / SPECIAL_BASELINE.population;
}
