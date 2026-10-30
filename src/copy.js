/**
 * 复制内容格式化（纯函数，便于单元测试）
 *
 * 规则：
 *  - 复制出来**只有号码**，每组一行；
 *  - 同一组的号码之间用顿号「、」分隔，例如 `03、08、15、22、31、39、46`；
 *  - 组与组之间用换行分隔（三组 7 码共 3 行）；
 *  - 不要任何汉字、标题、组号、日期、赔率等多余文字与数字。
 */

import { pad2 } from './constants.js';

/** 号码分隔符：顿号 */
export const NUMBER_SEPARATOR = '、';

/** 单组号码 → "03、08、15、22、31、39、46" */
export function formatNumberLine(nums) {
  return (nums || []).map(pad2).join(NUMBER_SEPARATOR);
}

/**
 * 多组 → 每组一行
 * @param {number[][]} tickets
 * @returns {string}
 */
export function formatTickets(tickets) {
  return (tickets || []).map((t) => formatNumberLine(t)).join('\n');
}

/** 今日推荐（特码 3 组 7 码，每组一行，共 3 行） */
export function formatFiveTickets(groups) {
  return formatTickets((groups || []).map((e) => e.numbers));
}

/** 单组（7 码一行） */
export function formatSingleTicket(numbers) {
  return formatNumberLine(numbers);
}
