/**
 * 六合彩「特码 · 三组 7 码」公共选号辅助
 *
 * 职责：
 *   1. getPriorDraws：严格提取早于目标期的历史开奖记录（无未来函数地基）
 *   2. selectBalancedSeven：从单组评分表选出满足形态约束的 7 个互不重复号码
 *
 * 注意：selectBalancedSeven 的唯一实现在 src/seven-picker.js，本文件只做
 * 环境注入（zoneOf / colorOf）与转发，避免再次出现多份副本各自漂移。
 */

import { ALL_NUMBERS, SPECIAL_GROUP_SIZE, getColorForNumber } from './constants.js';
import { configureSevenPicker, selectBalancedSeven as pickSeven } from './seven-picker.js';

configureSevenPicker({
  zoneOf: (n) => (n <= 16 ? 1 : n <= 33 ? 2 : 3),
  colorOf: getColorForNumber,
  allNumbers: ALL_NUMBERS,
  defaultSize: SPECIAL_GROUP_SIZE,
});

export { selectDirectNumbers } from './seven-picker.js';

export function selectBalancedSeven(scoreMap, opts = {}) {
  return pickSeven(scoreMap, { size: SPECIAL_GROUP_SIZE, ...opts });
}

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
