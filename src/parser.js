/**
 * 六合彩开奖记录通用解析器与幂等合并工具
 * 支持：
 * 1. https://2026kj.zkclhb.com:2025/am.html 及 2022~2026 历史 HTML 源码解析
 * 2. 网页 Ctrl+A / Ctrl+C 直接复制出的纯文本解析（含跨行球号与生肖）
 * 3. 单行/多行手工快捷格式（如 "297期 2026-10-24 03 14 25 31 38 45 + 12"）
 * 4. JSON 数组或 { draws: [...] } 结构导入
 */

import { getColorForNumber, getZodiacForNumber, padPeriod } from './constants.js';

/**
 * 规范化日期字符串为 YYYY-MM-DD（兼容 2025-8-31 等单数月/日）
 * @param {string} rawDate
 * @returns {string}
 */
export function normalizeDateString(rawDate) {
  const m = String(rawDate || '').trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!m) return String(rawDate || '').trim();
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * 严格校验日期：必须是真实存在的 YYYY-MM-DD
 * 既排除 2026-13-45 这类「格式对但日期不存在」的非法值，
 * 也把 <img src=x onerror=...> 这类注入载荷挡在外面（不会进入 innerHTML）。
 * @param {string} value
 * @returns {boolean}
 */
export function isValidISODate(value) {
  const s = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(dt.getTime())
    && dt.getUTCFullYear() === y
    && dt.getUTCMonth() + 1 === m
    && dt.getUTCDate() === d;
}

/**
 * 规范化单条开奖记录对象
 * @param {object} raw
 * @returns {object|null}
 */
export function normalizeDrawRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;

  // 日期必须合法：非法日期（2026-13-45）或注入载荷一律丢弃，改用兜底日期
  const rawDate = normalizeDateString(raw.date || '');
  const date = isValidISODate(rawDate) ? rawDate : '';
  const yearFromDate = date ? date.slice(0, 4) : '';
  const year = Number(raw.year || yearFromDate || 2026);
  const periodNum = Number(String(raw.periodNum ?? raw.period ?? '').replace(/\D+/g, ''));
  if (!Number.isInteger(year) || !Number.isInteger(periodNum) || periodNum <= 0) {
    return null;
  }

  const period = padPeriod(periodNum);
  const id = `${year}-${period}`;

  let numbers = Array.isArray(raw.numbers) ? raw.numbers.map(Number) : [];
  let special = raw.special != null ? Number(raw.special) : null;

  if (numbers.length === 7 && (special == null || Number.isNaN(special))) {
    special = numbers[6];
    numbers = numbers.slice(0, 6);
  }

  if (
    numbers.length !== 6 ||
    numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 49) ||
    !Number.isInteger(special) ||
    special < 1 ||
    special > 49
  ) {
    return null;
  }

  const allSeven = [...numbers, special];
  const colors =
    Array.isArray(raw.colors) && raw.colors.length === 7
      ? raw.colors.map((c, i) => c || getColorForNumber(allSeven[i]))
      : allSeven.map((n) => getColorForNumber(n));

  const zodiacs =
    Array.isArray(raw.zodiacs) && raw.zodiacs.length === 7
      ? raw.zodiacs.map((z, i) => z || getZodiacForNumber(allSeven[i], date || year))
      : allSeven.map((n) => getZodiacForNumber(n, date || year));

  return {
    id,
    year,
    period,
    periodNum,
    date: date || `${year}-01-01`,
    numbers,
    special,
    colors,
    zodiacs
  };
}

/**
 * 解析 https://2026kj.zkclhb.com:2025/am.html 结构的 HTML 源码
 * @param {string} html
 * @returns {object[]}
 */
export function parseAmHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const results = [];

  // 匹配 <dt><b>296</b>期(开奖时间:2026-10-23)</dt> ... <dl>...</dl>
  const itemRegex =
    /<dt>\s*<b>\s*(\d+)\s*<\/b>\s*期\s*[（(]\s*开奖时间[:：]\s*(\d{4}-\d{1,2}-\d{1,2})\s*[)）]\s*<\/dt>\s*<dl>([\s\S]*?)<\/dl>/gi;

  let match;
  while ((match = itemRegex.exec(html)) !== null) {
    const [, rawPeriod, rawDate, dlContent] = match;
    const date = normalizeDateString(rawDate);
    const year = Number(date.slice(0, 4));
    const periodNum = Number(rawPeriod);

    // 解析每个球：<span class="blue">14</span><b>蛇</b>
    const ballRegex =
      /<div[^>]*class=["'][^"']*ball[^"']*["'][^>]*>[\s\S]*?<span[^>]*class=["']([^"']+)["'][^>]*>\s*(\d+)\s*<\/span>\s*<b>\s*([^<\s]*)\s*<\/b>/gi;
    const balls = [];
    let bMatch;
    while ((bMatch = ballRegex.exec(dlContent)) !== null) {
      const colorClass = bMatch[1].trim().toLowerCase();
      const color = ['red', 'blue', 'green'].find((c) => colorClass.includes(c)) || null;
      const num = Number(bMatch[2]);
      const zodiac = bMatch[3].trim();
      balls.push({ num, color, zodiac });
    }

    if (balls.length >= 7) {
      const sevenBalls = balls.slice(0, 7);
      const record = normalizeDrawRecord({
        year,
        period: padPeriod(periodNum),
        periodNum,
        date,
        numbers: sevenBalls.slice(0, 6).map((b) => b.num),
        special: sevenBalls[6].num,
        colors: sevenBalls.map((b) => b.color || getColorForNumber(b.num)),
        zodiacs: sevenBalls.map((b) => b.zodiac || getZodiacForNumber(b.num, date))
      });
      if (record) {
        results.push(record);
      }
    }
  }

  return results;
}

/**
 * 解析从网页直接复制的纯文本或手工输入的简写文本
 * 支持：
 * - 网页复制块："296期(开奖时间:2026-10-23)\n14\n蛇\n43\n鼠..."
 * - 单行快捷："297期 2026-10-24 14 43 26 45 03 31 + 23"
 * - 单行无日期："2026-297 2026-10-24 14,43,26,45,03,31,23"
 * @param {string} text
 * @param {{ defaultYear?: number }} [options]
 * @returns {object[]}
 */
export function parsePlainTextDraws(text, options = {}) {
  if (!text || typeof text !== 'string') return [];
  const defaultYear = options.defaultYear || 2026;
  const results = [];

  // 兼容阅读器/代理返回的 Markdown（如 **305** 期(...)）：去掉粗体标记后再解析
  const normalizedText = text.replace(/\*\*/g, '');

  // 形态 1：网页直接复制的含 "XXX期(开奖时间:YYYY-MM-DD)" 段落
  const blockHeaderRegex = /(\d{1,3})\s*期\s*[（(]\s*开奖时间[:：]\s*(\d{4}-\d{1,2}-\d{1,2})\s*[)）]/g;
  const headers = [...normalizedText.matchAll(blockHeaderRegex)];

  if (headers.length > 0) {
    for (let i = 0; i < headers.length; i++) {
      const curr = headers[i];
      const periodNum = Number(curr[1]);
      const date = normalizeDateString(curr[2]);
      const year = Number(date.slice(0, 4));
      const sliceStart = curr.index + curr[0].length;
      const sliceEnd = i + 1 < headers.length ? headers[i + 1].index : normalizedText.length;
      const body = normalizedText.slice(sliceStart, sliceEnd);

      const numMatches = [...body.matchAll(/\b(0?[1-9]|[1-4]\d)\b/g)].map((m) => Number(m[1]));
      if (numMatches.length >= 7) {
        const seven = numMatches.slice(0, 7);
        const rec = normalizeDrawRecord({
          year,
          periodNum,
          date,
          numbers: seven.slice(0, 6),
          special: seven[6]
        });
        if (rec) results.push(rec);
      }
    }
    if (results.length > 0) return results;
  }

  // 形态 2：逐行解析手工/简写输入
  const lines = normalizedText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // 提取日期 YYYY-MM-DD（若有）
    let workLine = line;
    let date = '';
    const dateMatch = workLine.match(/(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/);
    if (dateMatch) {
      date = normalizeDateString(dateMatch[1]);
      workLine = workLine.replace(dateMatch[0], ' ');
    }

    // 提取期号：支持 "2026-297期"、"2026297"、"第297期"、"297期"
    let year = date ? Number(date.slice(0, 4)) : defaultYear;
    let periodNum = null;

    const yearPeriodMatch = workLine.match(/\b(20\d{2})[-/]?(\d{3})\s*期?\b/);
    if (yearPeriodMatch) {
      year = Number(yearPeriodMatch[1]);
      periodNum = Number(yearPeriodMatch[2]);
      workLine = workLine.replace(yearPeriodMatch[0], ' ');
    } else {
      const periodMatch = workLine.match(/第?\s*(\d{1,3})\s*期/);
      if (periodMatch) {
        periodNum = Number(periodMatch[1]);
        workLine = workLine.replace(periodMatch[0], ' ');
      }
    }

    const nums = [...workLine.matchAll(/\b(0?[1-9]|[1-4]\d)\b/g)].map((m) => Number(m[1]));
    if (periodNum != null && nums.length >= 7) {
      const seven = nums.slice(0, 7);
      const rec = normalizeDrawRecord({
        year,
        periodNum,
        date: date || `${year}-01-01`,
        numbers: seven.slice(0, 6),
        special: seven[6]
      });
      if (rec) results.push(rec);
    } else if (periodNum == null && nums.length === 8) {
      // 若第一个数字为期号 + 后 7 个为开奖号（需要行首期号匹配）
      const rawTokens = workLine.trim().split(/[\s,;+|]+/).filter(Boolean);
      const firstToken = Number(rawTokens[0]);
      if (Number.isInteger(firstToken) && firstToken >= 1 && firstToken <= 366) {
        const seven = rawTokens.slice(1, 8).map(Number);
        const rec = normalizeDrawRecord({
          year,
          periodNum: firstToken,
          date: date || `${year}-01-01`,
          numbers: seven.slice(0, 6),
          special: seven[6]
        });
        if (rec) results.push(rec);
      }
    }
  }

  return results;
}

/**
 * 快速录入：把任意文本洗成「只留 1–49 号码」的串
 *
 * 自动剔除日期（2026-10-29 / 2026年10月29日）、期号（第 297 期 / 2026-297）、
 * 时间、生肖与「开奖号码 / 特码 / 正码」等标签，避免把 2026、10、29 这类
 * 非开奖数字误当成号码。全角数字会先转成半角。
 * @param {string} text
 * @returns {string}
 */
export function normalizeQuickDrawText(text) {
  return String(text ?? '')
    .replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[＋]/g, '+')
    .replace(/[，、；;|／]/g, ' ')
    .replace(/[：]/g, ' ')
    // 日期：2026-10-29 / 2026/10/29 / 2026年10月29日
    .replace(/\d{4}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*日?/g, ' ')
    // 年份+期号：2026-297 / 2026297
    .replace(/\b20\d{2}\s*[-/]?\s*\d{3}\b/g, ' ')
    // 号码范围说明（如「（1-49，」「1-80个」）不是开奖号码
    .replace(/[（(]\s*\d{1,2}\s*[-–—~至]\s*\d{1,2}/g, ' ')
    .replace(/\d{1,2}\s*[-–—~至]\s*\d{1,2}\s*(个|码|号)/g, ' ')
    // 数量说明（如「7 个开奖号码」「20 个」）不是开奖号码
    .replace(/\d{1,2}\s*个/g, ' ')
    // 期号：第 297 期 / 297期
    .replace(/第?\s*\d{1,3}\s*期/g, ' ')
    // 时间：12:30
    .replace(/\d{1,2}\s*:\s*\d{2}/g, ' ')
    // 生肖与常见标签
    .replace(/[鼠牛虎兔龙蛇马羊猴鸡狗猪]/g, ' ')
    .replace(/(开奖时间|开奖日期|开奖号码|开奖结果|特码|正码|平码|号码|日期|时间|期号|星期|期|号|球)/g, ' ');
}

/**
 * 从清洗后的文本里按出现顺序抽取不重复的 1–49 号码
 * @param {string} cleaned
 * @returns {number[]}
 */
function extractNumbersFromCleaned(cleaned) {
  const out = [];
  const seen = new Set();
  for (const m of String(cleaned).matchAll(/\d{1,3}/g)) {
    const n = Number(m[0]);
    if (!Number.isInteger(n) || n < 1 || n > 49 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * 快速录入解析：从一段任意文本里识别「6 正码 + 1 特码」
 *
 * 识别规则（与工具玩法一致）：
 *  - 号码范围固定 1–49，重复号码自动去重；
 *  - 有「+」分隔时优先把 + 后面的第一个号码当特码（如 `05 14 23 31 38 45 + 08`）；
 *  - 没有「+」时按出现顺序取前 7 个，第 7 个即特码；
 *  - 日期、期号、生肖、标签等干扰内容会被忽略。
 * @param {string} text
 * @returns {{ numbers: number[], special: number|null, ignored: number }}
 */
export function parseQuickDrawInput(text) {
  const cleaned = normalizeQuickDrawText(text);
  let regular = [];
  let special = null;
  let ignored = 0;

  const plusIndex = cleaned.lastIndexOf('+');
  if (plusIndex >= 0) {
    const headNums = extractNumbersFromCleaned(cleaned.slice(0, plusIndex));
    const tailNums = extractNumbersFromCleaned(cleaned.slice(plusIndex + 1));
    if (headNums.length >= 6 && tailNums.length >= 1) {
      regular = headNums.slice(0, 6);
      // 特码不能与正码重复；若重复则顺延取 + 后面下一个不重复的号码
      special = tailNums.find((n) => !regular.includes(n)) ?? null;
      ignored = (headNums.length - 6) + Math.max(0, tailNums.length - 1);
    }
  }

  if (special == null) {
    const all = extractNumbersFromCleaned(cleaned);
    if (all.length >= 7) {
      regular = all.slice(0, 6);
      special = all[6];
      ignored = all.length - 7;
    } else {
      regular = all.slice(0, 6);
    }
  }

  return { numbers: regular, special, ignored };
}

/**
 * 自动识别并解析任意输入（JSON / HTML 源码 / 网页纯文本 / 手工行）
 * @param {string|object} input
 * @param {{ defaultYear?: number }} [options]
 * @returns {object[]}
 */
export function parseDrawsInput(input, options = {}) {
  if (!input) return [];

  if (Array.isArray(input)) {
    return input.map(normalizeDrawRecord).filter(Boolean);
  }
  if (typeof input === 'object' && Array.isArray(input.draws)) {
    return input.draws.map(normalizeDrawRecord).filter(Boolean);
  }

  const text = String(input).trim();
  if (!text) return [];

  // 1. 尝试 JSON
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed.draws) ? parsed.draws : [];
      const normalized = arr.map(normalizeDrawRecord).filter(Boolean);
      if (normalized.length > 0) return normalized;
    } catch {
      // 非合法 JSON，继续走 HTML/文本解析
    }
  }

  // 2. 尝试 HTML 解析
  if (text.includes('<dt>') || text.includes('class="ball"') || text.includes("class='ball'")) {
    const htmlRecords = parseAmHtml(text);
    if (htmlRecords.length > 0) return htmlRecords;
  }

  // 3. 退回纯文本解析
  return parsePlainTextDraws(text, options);
}

/**
 * 幂等合并历史记录与新记录，按年份降序、期号降序排列（最新一期排在最前）
 * @param {object[]} existingDraws
 * @param {object[]} incomingDraws
 * @returns {{ merged: object[], addedCount: number, updatedCount: number }}
 */
export function mergeDraws(existingDraws = [], incomingDraws = []) {
  const map = new Map();

  for (const item of existingDraws) {
    const norm = normalizeDrawRecord(item);
    if (norm) {
      map.set(norm.id, norm);
    }
  }

  let addedCount = 0;
  let updatedCount = 0;

  for (const item of incomingDraws) {
    const norm = normalizeDrawRecord(item);
    if (!norm) continue;
    const prev = map.get(norm.id);
    if (!prev) {
      addedCount++;
      map.set(norm.id, norm);
    } else {
      const prevSig = `${prev.date}|${prev.numbers.join(',')}|${prev.special}`;
      const nextSig = `${norm.date}|${norm.numbers.join(',')}|${norm.special}`;
      if (prevSig !== nextSig) {
        updatedCount++;
        map.set(norm.id, norm);
      }
    }
  }

  const merged = Array.from(map.values()).sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    if (b.periodNum !== a.periodNum) return b.periodNum - a.periodNum;
    return b.date.localeCompare(a.date);
  });

  return { merged, addedCount, updatedCount };
}
