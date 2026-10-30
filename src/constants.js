/**
 * 六合彩基础常量：49码波色、生肖映射、特码「三组 7 码」玩法定义与默认本金赔率配置
 */

/**
 * 构建版本号（Build ID）
 *
 * 作用：Service Worker 缓存名、index.html 静态资源版本参数、页面底部版本号三处必须一致，
 * 任何一次改动前端文件都必须同步提升该版本号，否则旧缓存会与新代码混用导致页面卡死。
 * 由 tests/build-version.test.mjs 自动校验三处一致性。
 */
export const APP_BUILD = '2026.10.30-r1';

/** 页面上显示的版本标签 */
export const APP_VERSION_LABEL = `v${APP_BUILD}`;

/** 本工具专属缓存名前缀（与同域其它 GitHub Pages 工具严格隔离） */
export const CACHE_PREFIX = 'mark6-nst-';

export const ALL_NUMBERS = Array.from({ length: 49 }, (_, i) => i + 1);

export const WAVE_COLORS = {
  red: [1, 2, 7, 8, 12, 13, 18, 19, 23, 24, 29, 30, 34, 35, 40, 45, 46],
  blue: [3, 4, 9, 10, 14, 15, 20, 25, 26, 31, 36, 37, 41, 42, 47, 48],
  green: [5, 6, 11, 16, 17, 21, 22, 27, 28, 32, 33, 38, 39, 43, 44, 49]
};

export const NUMBER_TO_COLOR = (() => {
  const map = {};
  for (const [color, nums] of Object.entries(WAVE_COLORS)) {
    for (const n of nums) {
      map[n] = color;
    }
  }
  return map;
})();

export const COLOR_LABELS = {
  red: '红波',
  blue: '蓝波',
  green: '绿波'
};

export const ZODIACS = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];

/**
 * 农历正月初一（春节）公历日期表，用于精确推算任意日期下 01~49 号对应的生肖
 */
export const LUNAR_NEW_YEAR_DATES = {
  2020: { date: '2020-01-25', zodiac: '鼠', prevZodiac: '猪' },
  2021: { date: '2021-02-12', zodiac: '牛', prevZodiac: '鼠' },
  2022: { date: '2022-02-01', zodiac: '虎', prevZodiac: '牛' },
  2023: { date: '2023-01-22', zodiac: '兔', prevZodiac: '虎' },
  2024: { date: '2024-02-10', zodiac: '龙', prevZodiac: '兔' },
  2025: { date: '2025-01-29', zodiac: '蛇', prevZodiac: '龙' },
  2026: { date: '2026-02-17', zodiac: '马', prevZodiac: '蛇' },
  2027: { date: '2027-02-06', zodiac: '羊', prevZodiac: '马' },
  2028: { date: '2028-01-26', zodiac: '猴', prevZodiac: '羊' }
};

/**
 * 获取指定日期/年份对应的当年生肖
 * @param {string|number} [dateOrYear='2026-10-30']
 * @returns {string} 生肖名称
 */
export function getYearZodiac(dateOrYear = '2026-10-30') {
  const str = String(dateOrYear || '2026-10-30').trim();
  const yearMatch = str.match(/^(\d{4})/);
  const year = yearMatch ? Number(yearMatch[1]) : 2026;
  const info = LUNAR_NEW_YEAR_DATES[year];
  if (info) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      return str >= info.date ? info.zodiac : info.prevZodiac;
    }
    return info.zodiac;
  }
  const idx = ((year - 2020) % 12 + 12) % 12;
  return ZODIACS[idx];
}

/**
 * 根据号码 (1..49) 和开奖日期获取对应生肖
 * @param {number} num 1..49
 * @param {string|number} [dateOrYear='2026-10-30']
 * @returns {string}
 */
export function getZodiacForNumber(num, dateOrYear = '2026-10-30') {
  const n = Number(num);
  if (!Number.isInteger(n) || n < 1 || n > 49) return '';
  const yearZodiac = getYearZodiac(dateOrYear);
  const baseIdx = ZODIACS.indexOf(yearZodiac);
  const idx = ((baseIdx - (n - 1)) % 12 + 12) % 12;
  return ZODIACS[idx];
}

/**
 * 获取号码波色 ('red' | 'blue' | 'green')
 * @param {number} num 1..49
 * @returns {'red'|'blue'|'green'}
 */
export function getColorForNumber(num) {
  return NUMBER_TO_COLOR[Number(num)] || 'blue';
}

/**
 * 获取号码所属三区 (1: 01~16, 2: 17~33, 3: 34~49)
 * @param {number} num 1..49
 * @returns {1|2|3}
 */
export function getZoneForNumber(num) {
  const n = Number(num);
  if (n <= 16) return 1;
  if (n <= 33) return 2;
  return 3;
}

/**
 * 格式化号码为两位字符串 ('01' ~ '49')
 * @param {number|string} num
 * @returns {string}
 */
export function pad2(num) {
  const n = Number(num);
  if (Number.isNaN(n)) return String(num);
  return String(n).padStart(2, '0');
}

/**
 * 格式化期号为三位字符串 ('001' ~ '366')
 * @param {number|string} period
 * @returns {string}
 */
export function padPeriod(period) {
  const n = Number(period);
  if (Number.isNaN(n)) return String(period).trim();
  return String(n).padStart(3, '0');
}

/** 特码三组 7 码固定参数 */
export const SPECIAL_GROUP_COUNT = 3;
export const SPECIAL_GROUP_SIZE = 7;
export const SPECIAL_TOTAL_BETS = SPECIAL_GROUP_COUNT * SPECIAL_GROUP_SIZE; // 21 注

/**
 * 默认收益与系统配置（仅保留特码模块）
 */
export const DEFAULT_CONFIG = {
  stake: 10, // 单注本金（元）：特码 1 个号 = 1 注
  // 默认特码赔率 48 倍（1 注 1 个号，命中 = 开奖特码正好是这 1 个号）
  // 单注命中率 1/49 ≈ 2.0408%，公平赔率 49 倍；市面常见 48 倍 → 期望回报率 48/49 ≈ 97.96%
  oddsSpecial: 48,
  playMode: 'special',
  remoteSourceUrl: 'https://2026kj.zkclhb.com:2025/am.html'
};

/**
 * 玩法定义（仅保留特码模块：每期推荐 3 组 7 码，允许跨组重叠，独立累计共 21 注）
 */
export const PLAY_MODES = {
  special: {
    id: 'special',
    name: '特码',
    title: '特码',
    size: SPECIAL_GROUP_SIZE, // 每组 7 个号
    groupCount: SPECIAL_GROUP_COUNT, // 每期推荐 3 组
    ticketSize: 1, // 1 个号 = 1 注
    bets: SPECIAL_GROUP_SIZE, // 每组折算 7 注
    totalBets: SPECIAL_TOTAL_BETS, // 3 组独立累计共 21 注
    layout: 'groups',
    allowOverlap: true,
    target: 'special',
    oddsKey: 'oddsSpecial',
    hitRule: '1 个号 = 1 注：开奖特码等于组内哪个号，该组即中 1 注；3 组独立累计（重叠号命中则多组同时中奖）'
  }
};

export const PLAY_MODE_ORDER = ['special'];
export const DEFAULT_PLAY_MODE = 'special';

/**
 * 取玩法定义（固定返回特码模块定义）
 * @returns {object}
 */
export function getPlayMode() {
  return PLAY_MODES.special;
}

/**
 * 每组折算成几注（每组 7 个号 = 7 注）
 * @returns {number}
 */
export function betsPerTicket() {
  return PLAY_MODES.special.bets;
}

/**
 * 每期总注数（3 组 × 7 注 = 21 注）
 * @returns {number}
 */
export function totalBetsPerPeriod() {
  return PLAY_MODES.special.totalBets;
}

/**
 * 组合数 C(n, k)
 * @param {number} n
 * @param {number} k
 * @returns {number}
 */
export function combinationsCount(n, k) {
  const N = Math.trunc(Number(n));
  const K = Math.trunc(Number(k));
  if (!Number.isFinite(N) || !Number.isFinite(K) || K < 0 || K > N) return 0;
  const m = Math.min(K, N - K);
  let result = 1;
  for (let i = 1; i <= m; i++) result = (result * (N - m + i)) / i;
  return Math.round(result);
}

/**
 * 一组号码折算成几注（特码：1 个号 = 1 注 → 号码个数）
 * @param {string} [_mode]
 * @param {number} [numberCount]
 * @returns {number}
 */
export function betsForNumbers(_mode, numberCount) {
  const count = Math.max(0, Math.trunc(Number(numberCount ?? PLAY_MODES.special.size)));
  return count;
}

/**
 * 单注本金配置键名
 * @returns {string}
 */
export function stakeKeyForMode() {
  return 'stake';
}
