/**
 * 特码选号引擎（每日推荐 3 组 7 码 · 允许跨组重叠 · 独立累计共 21 注）
 *
 * 核心规则（严格对齐原站特码模块，去掉三中三 / 四中四）：
 *   1. 特码是 **1 中 1**：1 个号码 = 1 注，单注命中概率 P = 1/49 ≈ 2.0408%，理论公平赔率 49 倍
 *      （默认赔率 48 倍 → 期望回报率 48/49 ≈ 97.96%）。
 *   2. 命中判定只看当期开奖的**最后一个号码（特码）**，前 6 个正码不计入命中。
 *   3. 每期由三套不同维度的特码模型各自独立选出 **7 个不重复号码**（每组 7 注，3 组合计 21 注）：
 *        #1 🔥 热态顺势  聚焦近 15/30/60 期特码高频活跃号 + EMA 动量 + 上期特码邻号 / 平转特联动
 *        #2 🎯 遗漏回补  聚焦近 400 期特码个人间隔分位偏高（久未开特）+ 冷尾回补 + 正码蓄势号
 *        #3 ⚖️ 周期均衡  聚焦特码中位周期回马枪 + 波色/区段历史转移倾向 + 三区2-2-3 / 三波2-2-3 / 7尾全开
 *   4. **允许跨组重叠**：三组独立选优、互不排斥。强信号号码若同时被 2 组或 3 组选中，
 *      即形成跨组重叠号（共识重点号）；若开奖特码命中重叠号，中几组就叠加结算几份奖金。
 *   5. 严格无未来函数：第 T 期推荐只使用严格早于 T 期的历史开奖数据。
 *   6. 100% 确定性：同一期号永远生成完全相同的 3 组 7 码（无重摇入口）。
 */

import {
  ALL_NUMBERS,
  PLAY_MODES,
  SPECIAL_GROUP_COUNT,
  SPECIAL_GROUP_SIZE,
  SPECIAL_TOTAL_BETS,
  betsPerTicket,
  getColorForNumber,
  getPlayMode,
  getZodiacForNumber
} from './constants.js';
import { isUsableDraw } from './audit.js';
import { evaluateTickets, normalizeNumbers } from './combinatorics.js';
import { getPriorDraws, selectBalancedSeven } from './strategy.js';

/** 每日三组 7 码策略目录（3 组全部为策略推荐，无纯随机组） */
export const DAILY_THREE_CATALOG = [
  {
    id: 'hot',
    code: '#1',
    name: '热态顺势',
    icon: '🔥',
    random: false,
    description: '近 15/30/60 期特码活跃度 + 特码邻号与平码转特动量，顺势取 7 码'
  },
  {
    id: 'cold',
    code: '#2',
    name: '遗漏回补',
    icon: '🎯',
    random: false,
    description: '按特码自身历史间隔分位与当前遗漏期数，捕捉久未开特的回补 7 码'
  },
  {
    id: 'cycle',
    code: '#3',
    name: '周期均衡',
    icon: '⚖️',
    random: false,
    description: '特码温态周期回马枪 + 波色区段转移，三区 2-2-3 · 三波齐全 · 7 尾不重'
  }
];

/** 保持原导出名兼容页面与单测调用 */
export const DAILY_FIVE_CATALOG = DAILY_THREE_CATALOG;

export { PLAY_MODES };

/** 返回特码三组 7 码目录副本 */
export function catalogForMode() {
  return DAILY_THREE_CATALOG.map((m) => ({ ...m }));
}

/**
 * 随机理论期望（3 组共 21 注场均命中注数 = 21/49 = 3/7 ≈ 0.4286 注）
 * @param {'total'|'group'|string|number} [scope='total']
 * @returns {number}
 */
export function randomExpectedHits(scope = 'total') {
  if (scope === 'group' || scope === 7 || scope === '7') {
    return SPECIAL_GROUP_SIZE / 49;
  }
  return SPECIAL_TOTAL_BETS / 49;
}

export const RANDOM_EXPECTED_HITS = randomExpectedHits('total');

/* ------------------------------------------------------------------ 工具 */

/** 确定性微调（同年 + 期号 + 号码 + 盐值下 100% 可复现，仅用于打破并列分） */
function deterministicJitter(year, periodNum, num, salt = 1) {
  let x = ((year * 1009 + periodNum * 9176 + num * 379 + salt * 131071) >>> 0) || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) % 10000) / 10000;
}

/**
 * 把一期开奖的正码列表清洗成「合法且不重复」的号码
 * @param {Array<number|string>} rawNumbers
 * @param {number} [limit=6]
 * @returns {number[]}
 */
export function cleanNumbers(rawNumbers = [], limit = 6) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(rawNumbers) ? rawNumbers : []) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 49 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 从「最新在前」的出现矩阵里计算当前遗漏与历史间隔分布（无未来函数）
 * @param {Array<ArrayLike<number>>} matrix 最新在前的出现矩阵
 * @param {number} window 窗口期数
 */
export function buildOmissionSeries(matrix = [], window = matrix.length) {
  const size = Math.max(1, Math.trunc(Number(window) || 0));
  const lastSeen = new Array(50).fill(-1);
  const prevSeen = new Array(50).fill(-1);
  const gapHistory = Array.from({ length: 50 }, () => []);
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i] || [];
    for (let n = 1; n <= 49; n++) {
      if (!row[n]) continue;
      if (lastSeen[n] < 0) lastSeen[n] = i;
      if (prevSeen[n] >= 0) gapHistory[n].push(i - prevSeen[n] - 1);
      prevSeen[n] = i;
    }
  }
  const omission = new Array(50).fill(size);
  for (let n = 1; n <= 49; n++) {
    omission[n] = lastSeen[n] >= 0 ? lastSeen[n] : size;
  }
  return { omission, gapHistory, lastSeen };
}

/**
 * 遗漏分位：当前遗漏在该号自身历史间距序列中的分位（0~1）
 * @param {number[]} gaps
 * @param {number} cur
 * @returns {number}
 */
export function omissionPercentile(gaps = [], cur = 0) {
  if (!Array.isArray(gaps) || gaps.length === 0) return 1;
  const le = gaps.filter((g) => g <= cur).length;
  return le / gaps.length;
}

/* -------------------------------------------------------------- 特征计算 */

/**
 * 计算 01~49 每个号码的特码与辅助联动特征（严格只用 priorDraws，无未来函数）
 * @param {object[]} priorDraws 严格早于目标期的开奖记录（降序，最新在前）
 * @param {{ date?: string|number, year?: number }} [targetMeta]
 */
export function computeDailyFiveFeatures(priorDraws = [], targetMeta = {}) {
  const usablePrior = priorDraws.filter(isUsableDraw);
  const w180 = usablePrior.slice(0, 180);
  const w60 = usablePrior.slice(0, 60);
  const w30 = usablePrior.slice(0, 30);
  const w15 = usablePrior.slice(0, 15);
  const dateOrYear = targetMeta.date || targetMeta.year || priorDraws[0]?.date || 2026;

  // 正码辅助频率（用于「平码预热 / 平码转特码」联动信号）
  const normalFreq = { 15: new Array(50).fill(0), 30: new Array(50).fill(0), 60: new Array(50).fill(0), 180: new Array(50).fill(0) };
  const normalMatrix = [];
  for (let i = 0; i < w180.length; i++) {
    const normals = cleanNumbers(w180[i]?.numbers, 6);
    const row = new Array(50).fill(0);
    for (const n of normals) {
      row[n] = 1;
      normalFreq[180][n]++;
      if (i < 60) normalFreq[60][n]++;
      if (i < 30) normalFreq[30][n]++;
      if (i < 15) normalFreq[15][n]++;
    }
    normalMatrix.push(row);
  }
  const { omission: normalOmission, gapHistory: normalGapHistory } = buildOmissionSeries(normalMatrix, w180.length || 1);

  const lastNormals = new Set(cleanNumbers(usablePrior[0]?.numbers, 6));
  const recent3Normals = new Set();
  for (let i = 0; i < Math.min(3, usablePrior.length); i++) {
    for (const n of cleanNumbers(usablePrior[i]?.numbers, 6)) recent3Normals.add(n);
  }

  // ————————————————————————————————————————————————————————————
  // 特码核心特征：该号作为「特码（第 7 个号码）」出现的频率、EMA、遗漏分位、转移规律
  // ————————————————————————————————————————————————————————————
  const specialOf = (d) => {
    const s = Number(d?.special);
    return Number.isInteger(s) && s >= 1 && s <= 49 ? s : null;
  };

  // 特码每期仅 1 个，放宽到 420 期让每个号平均拥有 ~8.5 次出现样本，个人间隔分位更稳健
  const specialGapWindow = Math.min(usablePrior.length, 420);
  const specialMatrix = [];
  const specialSeq = []; // 最新在前的特码序列
  for (let i = 0; i < usablePrior.length && specialMatrix.length < specialGapWindow; i++) {
    const s = specialOf(usablePrior[i]);
    if (s == null) continue;
    const row = new Array(50).fill(0);
    row[s] = 1;
    specialMatrix.push(row);
    specialSeq.push({ special: s, normals: cleanNumbers(usablePrior[i]?.numbers, 6), date: usablePrior[i]?.date });
  }

  const specialFreq = {
    15: new Array(50).fill(0),
    30: new Array(50).fill(0),
    60: new Array(50).fill(0),
    120: new Array(50).fill(0),
    180: new Array(50).fill(0)
  };
  for (let i = 0; i < Math.min(180, specialSeq.length); i++) {
    const s = specialSeq[i].special;
    specialFreq[180][s]++;
    if (i < 120) specialFreq[120][s]++;
    if (i < 60) specialFreq[60][s]++;
    if (i < 30) specialFreq[30][s]++;
    if (i < 15) specialFreq[15][s]++;
  }

  const { omission: specialOmission, gapHistory: specialGapHistory } = buildOmissionSeries(
    specialMatrix,
    specialMatrix.length || 1
  );

  // 特码指数平滑活跃度（按时间从旧到新递推）
  const computeSpecialEma = (span) => {
    const alpha = 2 / (span + 1);
    const out = new Array(50).fill(1 / 49);
    const slice = specialMatrix.slice(0, Math.min(span * 3, specialMatrix.length)).reverse();
    for (const row of slice) {
      for (let n = 1; n <= 49; n++) {
        out[n] = out[n] * (1 - alpha) + alpha * row[n];
      }
    }
    return out;
  };
  const specialEma20 = computeSpecialEma(20);
  const specialEma45 = computeSpecialEma(45);

  // 特码尾数与生肖近 60 期热度
  const specialTailFreq60 = new Array(10).fill(0);
  const specialZodiacFreq60 = {};
  for (let i = 0; i < Math.min(60, specialSeq.length); i++) {
    const s = specialSeq[i].special;
    specialTailFreq60[s % 10]++;
    const z = getZodiacForNumber(s, dateOrYear);
    specialZodiacFreq60[z] = (specialZodiacFreq60[z] || 0) + 1;
  }
  const maxSpecialTail = Math.max(1, ...specialTailFreq60);
  const minSpecialTail = Math.min(...specialTailFreq60);
  const maxSpecialZodiac = Math.max(1, ...Object.values(specialZodiacFreq60));

  // 上期特码及邻码 / 同尾
  const lastSpecial = specialSeq[0]?.special ?? null;
  const specialNeighbor = new Set();
  if (lastSpecial != null) {
    if (lastSpecial > 1) specialNeighbor.add(lastSpecial - 1);
    if (lastSpecial < 49) specialNeighbor.add(lastSpecial + 1);
    if (lastSpecial > 2) specialNeighbor.add(lastSpecial - 2);
    if (lastSpecial < 48) specialNeighbor.add(lastSpecial + 2);
  }
  const lastSpecialTail = lastSpecial != null ? lastSpecial % 10 : -1;

  // 正转特历史转化率：某号出现在前 1~2 期正码后，当期开出特码的次数（近 240 期）
  const normToSpecHits = new Array(50).fill(0);
  const normAppearances = new Array(50).fill(0);
  for (let i = 0; i < Math.min(240, specialSeq.length - 1); i++) {
    const curSpec = specialSeq[i].special;
    const prevNorms = new Set([
      ...(specialSeq[i + 1]?.normals || []),
      ...(specialSeq[i + 2]?.normals || [])
    ]);
    for (const pn of prevNorms) {
      normAppearances[pn]++;
      if (pn === curSpec) normToSpecHits[pn]++;
    }
  }

  // 特码马尔可夫特征转移：给定上期特码的 (波色, 三区, 奇偶)，统计下一期特码各波色/三区/奇偶经验概率
  const zoneOf = (n) => (n <= 16 ? 1 : n <= 33 ? 2 : 3);
  const colorTrans = { red: 1 / 3, blue: 1 / 3, green: 1 / 3 };
  const zoneTrans = { 1: 1 / 3, 2: 1 / 3, 3: 1 / 3 };
  const parityTrans = { true: 0.5, false: 0.5 };

  if (lastSpecial != null && specialSeq.length >= 10) {
    const lastColor = getColorForNumber(lastSpecial);
    const lastZone = zoneOf(lastSpecial);
    const lastOdd = lastSpecial % 2 === 1;

    const cCnt = { red: 1, blue: 1, green: 1 };
    let cTot = 3;
    const zCnt = { 1: 1, 2: 1, 3: 1 };
    let zTot = 3;
    const pCnt = { true: 1, false: 1 };
    let pTot = 2;

    const transLen = Math.min(240, specialSeq.length - 1);
    for (let i = 0; i < transLen; i++) {
      const cur = specialSeq[i].special;
      const prev = specialSeq[i + 1].special;
      if (getColorForNumber(prev) === lastColor) {
        cCnt[getColorForNumber(cur)]++;
        cTot++;
      }
      if (zoneOf(prev) === lastZone) {
        zCnt[zoneOf(cur)]++;
        zTot++;
      }
      if ((prev % 2 === 1) === lastOdd) {
        pCnt[cur % 2 === 1]++;
        pTot++;
      }
    }
    for (const k of ['red', 'blue', 'green']) colorTrans[k] = cCnt[k] / cTot;
    for (const k of [1, 2, 3]) zoneTrans[k] = zCnt[k] / zTot;
    parityTrans[true] = pCnt[true] / pTot;
    parityTrans[false] = pCnt[false] / pTot;
  }

  const stats = {};
  const specialStats = {};
  for (let n = 1; n <= 49; n++) {
    const color = getColorForNumber(n);
    const zodiac = getZodiacForNumber(n, dateOrYear);
    const zone = zoneOf(n);
    const odd = n % 2 === 1;

    const nGaps = normalGapHistory[n];
    const nCur = normalOmission[n];
    stats[n] = {
      num: n,
      color,
      zodiac,
      tail: n % 10,
      zone,
      odd,
      freq15: normalFreq[15][n],
      freq30: normalFreq[30][n],
      freq60: normalFreq[60][n],
      freq180: normalFreq[180][n],
      omission: nCur,
      omissionPct: omissionPercentile(nGaps, nCur),
      gapCount: nGaps.length,
      isRepeat: lastNormals.has(n),
      isRecent3Normal: recent3Normals.has(n),
      isShortRest: nCur >= 1 && nCur <= 3
    };

    const sGaps = specialGapHistory[n];
    const sCur = specialOmission[n];
    const sPct = omissionPercentile(sGaps, sCur);
    const sortedGaps = sGaps.slice().sort((a, b) => a - b);
    const medianGap = sortedGaps.length
      ? sortedGaps[Math.floor(sortedGaps.length / 2)]
      : 34;
    const convRate = normAppearances[n] >= 3
      ? normToSpecHits[n] / normAppearances[n]
      : 1 / 49;

    specialStats[n] = {
      num: n,
      color,
      zodiac,
      tail: n % 10,
      zone,
      odd,
      freq15: specialFreq[15][n],
      freq30: specialFreq[30][n],
      freq60: specialFreq[60][n],
      freq120: specialFreq[120][n],
      freq180: specialFreq[180][n],
      ema20: specialEma20[n],
      ema45: specialEma45[n],
      omission: sCur,
      omissionPct: sPct,
      medianGap,
      gapCount: sGaps.length,
      isLastSpecial: lastSpecial === n,
      isDirectNeighbor: lastSpecial != null && Math.abs(n - lastSpecial) === 1,
      isNearNeighbor: specialNeighbor.has(n),
      isTailMatch: lastSpecialTail >= 0 && n % 10 === lastSpecialTail,
      isShortRest: sCur >= 1 && sCur <= 6,
      tailNorm: specialTailFreq60[n % 10] / maxSpecialTail,
      tailColdNorm: (maxSpecialTail - specialTailFreq60[n % 10]) / Math.max(1, maxSpecialTail - minSpecialTail),
      zodiacNorm: (specialZodiacFreq60[zodiac] || 0) / maxSpecialZodiac,
      normToSpecRate: convRate,
      transScore: 0.45 * (colorTrans[color] * 3) + 0.35 * (zoneTrans[zone] * 3) + 0.20 * (parityTrans[odd] * 2)
    };
  }

  return {
    stats,
    specialStats,
    sampleSize: w60.length,
    priorCount: priorDraws.length,
    lastSpecial,
    lastSpecialTail
  };
}

/* ------------------------------------------------------------ 三组评分模型 */

/**
 * 构建三套特码独立评分表：
 *   - hot   (#1 热态顺势)：特码短中期活跃频率 + EMA 动量 + 特码邻号 + 平码转特联动 + 热尾热肖
 *   - cold  (#2 遗漏回补)：特码个人历史间隔分位 + 遗漏深度 + 冷尾回补 + 正码近期预热蓄势
 *   - cycle (#3 周期均衡)：特码个人中位周期回马枪 + 波色/区段/奇偶马尔可夫转移 + 温号稳态
 */
export function buildThreeSpecialScoreMaps(features, year, periodNum) {
  const { stats, specialStats } = features;
  const maps = { hot: {}, cold: {}, cycle: {} };

  for (let n = 1; n <= 49; n++) {
    const sp = specialStats[n];
    const nm = stats[n];

    const j1 = deterministicJitter(year, periodNum, n, 17);
    const j2 = deterministicJitter(year, periodNum, n, 43);
    const j3 = deterministicJitter(year, periodNum, n, 89);

    const rel15 = (sp.freq15 * 49) / 15;
    const rel30 = (sp.freq30 * 49) / 30;
    const rel60 = (sp.freq60 * 49) / 60;
    const emaRel = sp.ema20 * 49;

    // #1 🔥 热态顺势：近期特码高频 + EMA 动量 + 邻号/同尾联动 + 上期正码转特动能
    maps.hot[n] =
      1.35 * rel15 +
      1.65 * rel30 +
      1.05 * rel60 +
      1.20 * emaRel +
      (sp.isDirectNeighbor ? 0.95 : sp.isNearNeighbor ? 0.45 : 0) +
      (sp.isTailMatch && !sp.isLastSpecial ? 0.40 : 0) +
      (nm.isRecent3Normal ? 0.45 + Math.min(0.6, sp.normToSpecRate * 12) : 0) +
      0.55 * sp.tailNorm +
      0.35 * sp.zodiacNorm -
      (sp.isLastSpecial ? 0.65 : 0) +
      j1 * 0.42;

    // #2 🎯 遗漏回补：特码个人历史间隔分位偏高 + 遗漏期数饱满 + 冷尾回补 + 近期平码露面预热
    const omDepth = Math.min(sp.omission, 100) / 50; // 0 ~ 2.0
    const normalWarmup = (nm.isRepeat ? 0.65 : nm.isRecent3Normal ? 0.35 : 0)
      + (nm.freq15 >= 2 && nm.freq15 <= 4 ? 0.35 : 0);
    const zoneShift = features.lastSpecial != null && sp.zone !== specialStats[features.lastSpecial]?.zone ? 0.30 : 0;
    maps.cold[n] =
      2.35 * sp.omissionPct +
      0.95 * omDepth +
      0.55 * sp.tailColdNorm +
      normalWarmup +
      zoneShift +
      (sp.omission > sp.medianGap ? 0.45 : 0) -
      (sp.omission <= 6 ? 1.80 : 0) +
      j2 * 0.85;

    // #3 ⚖️ 周期均衡：个人中位间隔附近的回马枪（omissionPct ≈ 0.40~0.70）+ 马尔可夫特征转移 + 温号稳态
    const gapRatio = sp.medianGap > 0 ? sp.omission / sp.medianGap : 1;
    const cycleWindow = Math.exp(-Math.pow(gapRatio - 0.95, 2) / 0.55); // 在个人中位周期附近达峰值 1.0
    const steadyFreq = 1 / (1 + Math.abs(sp.freq120 - 120 / 49));
    maps.cycle[n] =
      1.75 * cycleWindow +
      1.45 * sp.transScore +
      1.10 * steadyFreq +
      0.60 * (sp.ema45 * 49) +
      (nm.isRepeat ? 0.35 : 0) -
      (sp.isLastSpecial ? 0.80 : 0) +
      j3 * 0.45;
  }

  return maps;
}

/**
 * N 组特码方案「至少中 1 注（至少 1 组命中）」的精确概率
 *
 * 特码每期只开出 1 个号（1..49 等概率），因此多组号码无论是否重叠，
 * 「至少有 1 组包含当期特码」的事件等价于「当期特码落在所有组号码的并集里」：
 *   P(至少中 1 注) = |∪ G_i| / 49（精确值）
 *
 * @param {number[][]} tickets 每组号码
 * @returns {number} 0~1
 */
export function anyHitProbability(tickets = []) {
  const clean = (Array.isArray(tickets) ? tickets : [])
    .map((t) => normalizeNumbers(t, { sort: true, maxCount: 49 }))
    .filter((t) => t.length > 0);
  if (!clean.length) return 0;
  return Math.min(1, new Set(clean.flat()).size / 49);
}

/**
 * 把一组号码展开成实际的注单（特码 ticketSize = 1：每个号就是独立 1 注 → [[n1],[n2],…]）
 * @param {number[]} numbers
 * @param {object} [spec]
 * @returns {number[][]}
 */
export function expandEntryTickets(numbers = [], spec = {}) {
  const nums = normalizeNumbers(numbers, { sort: true });
  const ticketSize = Math.max(1, Math.trunc(Number(spec?.ticketSize ?? 1)));
  if (!nums.length) return [];
  if (ticketSize <= 1) return nums.map((n) => [n]);
  return [nums];
}

/* --------------------------------------------------------------- 主入口 */

/**
 * 生成某期的「特码 · 每日三组 7 码」（允许跨组重叠，独立累计共 21 注）
 *
 * @param {object[]} allDraws 完整底库（降序，最新在前）
 * @param {{ year?: number, periodNum?: number, date?: string }} [targetMeta]
 * @param {{ pinnedNumbers?: number[] }} [options]
 */
export function generateDailyFive(allDraws = [], targetMeta = {}, options = {}) {
  const latest = allDraws[0] || { year: 2026, periodNum: 302, date: '2026-10-29' };
  const year = Number(targetMeta.year || latest.year || 2026);
  const periodNum = Number(targetMeta.periodNum || (latest.periodNum || 0) + 1);
  const date = targetMeta.date || latest.date || `${year}-10-30`;
  const spec = getPlayMode();
  const size = SPECIAL_GROUP_SIZE; // 7

  const priorDraws = getPriorDraws(allDraws, { year, periodNum });
  const features = computeDailyFiveFeatures(priorDraws, { year, periodNum, date });
  const scoreMaps = buildThreeSpecialScoreMaps(features, year, periodNum);
  const pinned = normalizeNumbers(options.pinnedNumbers || [], { sort: true, maxCount: size });

  // 三组各自独立在 01..49 上求解最优 7 码，不设跨组互斥排除，允许强信号号码自然重叠
  const groupNums = {
    hot: selectBalancedSeven(scoreMaps.hot, {
      size,
      pinned,
      minPerZone: 1,
      maxPerZone: 3,
      minPerColor: 1,
      maxPerColor: 3,
      oddRange: [3, 4],
      bigRange: [3, 4],
      maxTailRepeat: 2
    }),
    cold: selectBalancedSeven(scoreMaps.cold, {
      size,
      pinned: [],
      minPerZone: 1,
      maxPerZone: 3,
      minPerColor: 1,
      maxPerColor: 3,
      oddRange: [3, 4],
      bigRange: [3, 4],
      maxTailRepeat: 2
    }),
    cycle: selectBalancedSeven(scoreMaps.cycle, {
      size,
      pinned: [],
      minPerZone: 2,
      maxPerZone: 3,
      minPerColor: 2,
      maxPerColor: 3,
      oddRange: [3, 4],
      bigRange: [3, 4],
      maxTailRepeat: 1 // 周期均衡组强制 7 码 7 个不同尾数
    })
  };

  // 统计每个号码在 3 组中出现的次数，识别跨组重叠号（出现 ≥ 2 组）
  const freqAcrossGroups = new Map();
  for (const nums of Object.values(groupNums)) {
    for (const n of nums) {
      freqAcrossGroups.set(n, (freqAcrossGroups.get(n) || 0) + 1);
    }
  }
  const consensus = [...freqAcrossGroups.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([num]) => num);
  const overlapCounts = Object.fromEntries(freqAcrossGroups.entries());

  const catalog = catalogForMode();
  const spStats = features.specialStats;

  const entries = catalog.map((meta) => {
    const numbers = groupNums[meta.id] || [];
    const hotList = numbers.filter((n) => spStats[n].freq60 >= 2 || spStats[n].freq30 >= 1);
    const coldList = numbers.filter((n) => !hotList.includes(n) && spStats[n].omission >= 35);
    const odd = numbers.filter((n) => spStats[n].odd).length;
    const sharedInGroup = numbers.filter((n) => (freqAcrossGroups.get(n) || 0) >= 2);

    return {
      ...meta,
      numbers,
      bets: numbers.length,
      sharedNumbers: sharedInGroup,
      killed: [],
      rationale: meta.description,
      seed: null,
      shape: {
        hot: hotList.length,
        warm: numbers.length - hotList.length - coldList.length,
        cold: coldList.length,
        red: numbers.filter((n) => spStats[n].color === 'red').length,
        blue: numbers.filter((n) => spStats[n].color === 'blue').length,
        green: numbers.filter((n) => spStats[n].color === 'green').length,
        zone1: numbers.filter((n) => spStats[n].zone === 1).length,
        zone2: numbers.filter((n) => spStats[n].zone === 2).length,
        zone3: numbers.filter((n) => spStats[n].zone === 3).length,
        odd,
        even: numbers.length - odd,
        big: numbers.filter((n) => n >= 25).length,
        small: numbers.filter((n) => n <= 24).length,
        sum: numbers.reduce((a, b) => a + b, 0)
      }
    };
  });

  const distinct = freqAcrossGroups.size;
  const totalSlots = size * entries.length; // 21
  const overlap = totalSlots - distinct; // 跨组重复人次
  const betsPerOption = betsPerTicket(); // 7
  const totalBets = betsPerOption * entries.length; // 21
  const perBet = 1 / 49;
  const perTicket = size / 49; // 单组 7 码命中率 7/49 = 1/7
  const anyHit = anyHitProbability(entries.map((e) => e.numbers));

  return {
    target: { year, periodNum, period: String(periodNum).padStart(3, '0'), date },
    priorSampleCount: priorDraws.length,
    featureWindow: features.sampleSize,
    randomSalt: 0,
    mode: spec.id,
    size,
    groupCount: SPECIAL_GROUP_COUNT,
    layout: 'groups',
    five: entries,
    consensus,
    overlapCounts,
    coverage: {
      distinct,
      overlap,
      consensusCount: consensus.length,
      perTicket,
      perBet,
      betsPerOption,
      totalBets,
      anyHit,
      allBlank: 1 - anyHit
    },
    stats: features.stats,
    specialStats: features.specialStats,
    killedNumbers: [],
    lastSpecial: features.lastSpecial ?? null
  };
}

/* -------------------------------------------------------------- 逐期回放 */

/**
 * 逐期生成三组 7 码回放记录（严格无未来函数，3 组独立累计共 21 注）
 * @param {object[]} allDraws
 * @param {object[]} targets
 * @param {{ stake?: number, oddsSpecial?: number }} [options]
 */
export function buildDailyFiveRecords(allDraws = [], targets = [], options = {}) {
  const { stake = 10, oddsSpecial = 48 } = options;
  const spec = getPlayMode();
  const size = spec.size; // 7
  const records = [];

  for (const draw of targets) {
    if (!draw) continue;
    const plan = generateDailyFive(allDraws, {
      year: draw.year,
      periodNum: draw.periodNum,
      date: draw.date
    });
    const five = plan.five.map((e) => {
      const tickets = expandEntryTickets(e.numbers, spec); // 7 个单号注单
      const ev = evaluateTickets(tickets, draw, {
        stake,
        oddsSpecial,
        playMode: 'special',
        targetSize: 1
      });
      const winners = ev.winningTickets || [];
      const hitNums = [...new Set((ev.details || []).flatMap((d) => d.hitNums || []))];
      return {
        id: e.id,
        code: e.code,
        name: e.name,
        icon: e.icon,
        random: false,
        numbers: e.numbers,
        sharedNumbers: e.sharedNumbers || [],
        layout: 'groups',
        hitNums,
        hitCount: winners.length, // 0 或 1（单组 7 个不重复号最多中 1 注特码）
        isWin: winners.length > 0,
        cost: ev.cost ?? tickets.length * stake,
        payout: ev.payout || 0,
        bets: tickets.length, // 7 注
        winningTickets: winners.length
      };
    });

    const totalHits = five.reduce((s, e) => s + (e.hitCount || 0), 0);
    const totalCost = five.reduce((s, e) => s + (e.cost || 0), 0);
    const totalPayout = five.reduce((s, e) => s + (e.payout || 0), 0);
    records.push({
      draw,
      five,
      consensus: plan.consensus,
      overlapCounts: plan.overlapCounts,
      distinct: plan.coverage.distinct,
      overlap: plan.coverage.overlap,
      totalHits,
      totalCost,
      totalPayout,
      totalNet: totalPayout - totalCost,
      size,
      mode: 'special',
      ticketSize: 1,
      betsPerEntry: plan.coverage.betsPerOption,
      totalBets: plan.coverage.totalBets
    });
  }
  return records;
}

/**
 * 汇总三组 7 码的历史回放表现（3 组独立统计 + 21 注合并总账）
 * @param {object[]} records
 * @param {{ stake?: number, oddsSpecial?: number }} [options]
 */
export function summarizeDailyFive(records = [], options = {}) {
  const { stake = 10, oddsSpecial = 48 } = options;
  const spec = getPlayMode();
  const size = spec.size; // 7
  const betsPerOption = betsPerTicket(); // 7

  const catalog = catalogForMode().map((m) => ({
    ...m,
    periods: 0,
    hitSum: 0,
    winPeriods: 0,
    bets: 0,
    cost: 0,
    payout: 0
  }));
  const index = new Map(catalog.map((c) => [c.id, c]));

  let winPeriodsAny = 0; // 至少中 1 组的期数
  let multiWinPeriods = 0; // 重叠号命中导致 ≥2 组同中的期数

  for (const rec of records) {
    let recWins = 0;
    for (const e of rec.five) {
      let agg = index.get(e.id);
      if (!agg) {
        agg = {
          id: e.id,
          code: e.code || '—',
          name: e.name || e.id,
          icon: e.icon || '',
          random: false,
          periods: 0,
          hitSum: 0,
          winPeriods: 0,
          bets: 0,
          cost: 0,
          payout: 0
        };
        catalog.push(agg);
        index.set(e.id, agg);
      }
      const betsThis = Number.isFinite(e.bets) && e.bets > 0 ? e.bets : e.numbers.length;
      const hitsThis = e.hitCount || 0;
      const payoutThis = hitsThis * stake * oddsSpecial;

      agg.periods++;
      agg.hitSum += hitsThis;
      if (hitsThis > 0) {
        agg.winPeriods++;
        recWins += hitsThis;
      }
      agg.bets += betsThis;
      agg.cost += stake * betsThis;
      agg.payout += payoutThis;
    }
    if (recWins > 0) winPeriodsAny++;
    if (recWins >= 2) multiWinPeriods++;
  }

  for (const agg of catalog) {
    agg.hits = agg.hitSum;
    agg.avgHits = agg.periods ? Number((agg.hitSum / agg.periods).toFixed(4)) : 0;
    agg.net = agg.payout - agg.cost;
    agg.roi = agg.cost > 0 ? Number(((agg.net / agg.cost) * 100).toFixed(2)) : 0;
    agg.winRate = agg.periods ? Number(((agg.winPeriods / agg.periods) * 100).toFixed(2)) : 0;
    agg.avgBets = agg.periods ? Number((agg.bets / agg.periods).toFixed(2)) : 0;
  }

  const totalCost = catalog.reduce((a, c) => a + c.cost, 0);
  const totalPayout = catalog.reduce((a, c) => a + c.payout, 0);
  const totalHits = catalog.reduce((a, c) => a + c.hitSum, 0);

  return {
    size,
    groupCount: SPECIAL_GROUP_COUNT,
    betsPerOption,
    totalBets: catalog.reduce((a, c) => a + c.bets, 0),
    mode: 'special',
    stake,
    oddsSpecial,
    odds: oddsSpecial,
    periods: records.length,
    winPeriods: winPeriodsAny,
    multiWinPeriods,
    totalHits,
    catalog,
    expectedHits: Number(randomExpectedHits('total').toFixed(4)),
    expectedHitsPerGroup: Number(randomExpectedHits('group').toFixed(4)),
    totalCost,
    totalPayout,
    totalNet: totalPayout - totalCost,
    totalRoi: totalCost > 0 ? Number((((totalPayout - totalCost) / totalCost) * 100).toFixed(2)) : 0
  };
}
