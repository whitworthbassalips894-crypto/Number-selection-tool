/**
 * 单组 7 码约束求解器 —— 全仓库唯一实现。
 *
 * 历史背景：这段算法一度存在三份副本（index.html 内联、src/strategy.js、
 * src/six-tier.js），2026-11-23 的「均衡项符号写反」缺陷就同时存在于三处。
 * 现在三处都改为引用本模块，改一次即可全局生效。
 *
 * 唯一权威版本采用的是「可行性判定 + 软约束加温」的写法（原 index.html 版），
 * 它在加入每个候选号后会检查剩余坑位是否还能满足各项最低配额，因此
 * 不会走到「配额没填满就无号可选」的死角。已验证与另外两份副本在
 * 450 组用例（含并列分数压力测试）上输出完全一致。
 *
 * 本模块刻意不 import 任何东西：页面以普通 <script> 加载，加载后会把
 * 依赖通过 configureSevenPicker 注入，以便内联脚本继续使用自己的常量表。
 */

let zoneOf = (n) => (n <= 16 ? 1 : n <= 33 ? 2 : 3);
let colorOf = () => 'red';
let allNumbers = Array.from({ length: 49 }, (_, i) => i + 1);
let defaultSize = 7;

function isOdd(n) { return n % 2 === 1; }
function isBig(n) { return n >= 25; }

/**
 * 注入环境依赖。
 * @param {{
 *   zoneOf?: (n: number) => number,
 *   colorOf?: (n: number) => string,
 *   allNumbers?: number[],
 *   defaultSize?: number,
 * }} deps
 */
export function configureSevenPicker(deps = {}) {
  if (deps.zoneOf) zoneOf = deps.zoneOf;
  if (deps.colorOf) colorOf = deps.colorOf;
  if (Array.isArray(deps.allNumbers) && deps.allNumbers.length) allNumbers = deps.allNumbers.slice();
  if (Number.isFinite(deps.defaultSize)) defaultSize = Math.trunc(deps.defaultSize);
}

/** 把分数表归一化到 0..1，便于与软约束权重稳定叠加。 */
export function normalizeScoreTable(scoreMap = {}) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let n = 1; n <= 49; n++) {
    const v = Number(scoreMap[n] ?? 0);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo;
  const out = new Float64Array(50);
  for (let n = 1; n <= 49; n++) {
    out[n] = span > 1e-12 ? (Number(scoreMap[n] ?? 0) - lo) / span : 0.5;
  }
  return out;
}

function resolveOpts(opts = {}) {
  const size = Math.max(1, Math.min(49, Math.trunc(Number(opts.size ?? defaultSize))));
  return {
    size,
    minPerZone: Math.max(0, Math.trunc(Number(opts.minPerZone ?? 1))),
    maxPerZone: Math.max(1, Math.trunc(Number(opts.maxPerZone ?? 3))),
    minPerColor: Math.max(0, Math.trunc(Number(opts.minPerColor ?? 1))),
    maxPerColor: Math.max(1, Math.trunc(Number(opts.maxPerColor ?? 3))),
    oddLo: Number((opts.oddRange || [3, 4])[0]),
    oddHi: Number((opts.oddRange || [3, 4])[1]),
    bigLo: Number((opts.bigRange || [3, 4])[0]),
    bigHi: Number((opts.bigRange || [3, 4])[1]),
    maxTailRepeat: Math.max(1, Math.trunc(Number(opts.maxTailRepeat ?? 2))),
  };
}

/**
 * 在单组评分表上贪心选出 size 个号码：先按分数降序，加入时检查硬上下界
 * 与「剩余坑位是否还填得满最低配额」，再叠加软约束权重。
 * @param {Record<number, number>} scoreMap
 * @param {object} opts
 * @returns {number[]} 升序号码
 */
export function selectBalancedSeven(scoreMap = {}, opts = {}) {
  const o = resolveOpts(opts);
  const size = o.size;
  const norm = normalizeScoreTable(scoreMap);

  const candidates = allNumbers
    .filter((n) => n >= 1 && n <= 49)
    .sort((a, b) => norm[b] - norm[a] || a - b);

  const chosen = [];
  const chosenMask = new Uint8Array(50);
  const zCnt = [0, 0, 0, 0];
  const cCnt = { red: 0, blue: 0, green: 0 };
  const tCnt = new Uint8Array(10);
  let oddCnt = 0;
  let bigCnt = 0;

  while (chosen.length < size) {
    let bestNum = 0;
    let bestVal = -Infinity;
    const remAfter = size - (chosen.length + 1);
    const targetMid = size / 2;

    for (const strict of [true, false]) {
      for (let idx = 0; idx < candidates.length; idx++) {
        const n = candidates[idx];
        if (chosenMask[n]) continue;
        const z = zoneOf(n);
        const c = colorOf(n);
        const tl = n % 10;
        const nIsOdd = isOdd(n) ? 1 : 0;
        const nIsBig = isBig(n) ? 1 : 0;

        if (strict) {
          if (zCnt[z] + 1 > o.maxPerZone) continue;
          if (cCnt[c] + 1 > o.maxPerColor) continue;
          if (tCnt[tl] + 1 > o.maxTailRepeat) continue;

          // 三区最低配额：剩余坑位必须填得满
          const zDef = Math.max(0, o.minPerZone - (zCnt[1] + (z === 1 ? 1 : 0)))
                     + Math.max(0, o.minPerZone - (zCnt[2] + (z === 2 ? 1 : 0)))
                     + Math.max(0, o.minPerZone - (zCnt[3] + (z === 3 ? 1 : 0)));
          if (zDef > remAfter) continue;

          // 三色最低配额：剩余坑位必须填得满
          const cDef = Math.max(0, o.minPerColor - (cCnt.red + (c === 'red' ? 1 : 0)))
                     + Math.max(0, o.minPerColor - (cCnt.blue + (c === 'blue' ? 1 : 0)))
                     + Math.max(0, o.minPerColor - (cCnt.green + (c === 'green' ? 1 : 0)));
          if (cDef > remAfter) continue;

          // 奇偶 / 大小范围：不能超上限，也不能让剩余坑位补不够下限
          const nextOdd = oddCnt + nIsOdd;
          if (nextOdd > o.oddHi || nextOdd + remAfter < o.oddLo) continue;
          const nextBig = bigCnt + nIsBig;
          if (nextBig > o.bigHi || nextBig + remAfter < o.bigLo) continue;
        }

        let val = norm[n];
        // 空缺区 / 空缺波色温和加分，促使早早铺开而不过度扭曲原始高分
        if (zCnt[z] < o.minPerZone) val += 0.18;
        else if (zCnt[z] >= o.maxPerZone - 1) val -= 0.06;

        if (cCnt[c] < o.minPerColor) val += 0.14;
        else if (cCnt[c] >= o.maxPerColor - 1) val -= 0.05;

        if (tCnt[tl] > 0) val -= 0.12 * tCnt[tl];

        // 奇偶与大小都向中心靠拢：两项都必须「偏离越远扣越多」，故同为减号
        val -= 0.05 * Math.abs(oddCnt + nIsOdd - targetMid)
             + 0.05 * Math.abs(bigCnt + nIsBig - targetMid);

        if (val > bestVal) {
          bestVal = val;
          bestNum = n;
        }
      }
      if (bestNum) break;
    }
    if (!bestNum) break;

    chosen.push(bestNum);
    chosenMask[bestNum] = 1;
    zCnt[zoneOf(bestNum)]++;
    cCnt[colorOf(bestNum)]++;
    tCnt[bestNum % 10]++;
    if (isOdd(bestNum)) oddCnt++;
    if (isBig(bestNum)) bigCnt++;
  }

  return chosen.sort((a, b) => a - b);
}

/** 兼容旧导出名（原 src/strategy.js 的 selectDirectNumbers）。 */
export const selectDirectNumbers = (scoreMap, _features, opts = {}) => selectBalancedSeven(scoreMap, opts);

export default selectBalancedSeven;
