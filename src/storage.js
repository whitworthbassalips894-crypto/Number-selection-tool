/**
 * 本地存储（localStorage）读写与跨工具隔离
 *
 * 设计要点：
 * 1. 本工具使用独立键名（mark6_nst_*_v1），与同一个 GitHub Pages 域名下部署的其它工具
 *    （如 Pick-3-out-of-3-Pick-4-out-of-4、lottery-tool）完全隔离，互不污染配置。
 * 2. 遇到损坏的 JSON / 非法数值时静默降级为默认值，绝不让整页白屏。
 * 3. 所有函数都接受一个 storage 后端参数，方便单元测试用内存实现替换浏览器 localStorage。
 */

/** 当前版本使用的规范键名（nst = Number-selection-tool） */
export const STORAGE_KEYS = {
  CONFIG: 'mark6_nst_config_v1',
  LOCAL_DRAWS: 'mark6_nst_local_draws_v1'
};

/** 本工具历史别名（仅限 nst / numsel 前缀，绝不碰 pick3 / lottery-tool 键） */
export const LEGACY_KEY_ALIASES = {
  CONFIG: ['mark6_nst_config', 'nst_config', 'numsel_config'],
  LOCAL_DRAWS: ['mark6_nst_local_draws', 'nst_local_draws', 'numsel_local_draws']
};

const KEY_HINTS = {
  CONFIG: ['config', 'setting', 'odds', 'stake'],
  LOCAL_DRAWS: ['draw', 'result', 'history']
};

/** 兜底扫描时只认明确带 nst / numsel 标识的键名，防止误读同域其它工具 */
const OWNER_KEY_PATTERN = /(^|[_.-])(nst|numsel)([_.-]|$)/i;

/**
 * 判断某个键名是否属于本工具命名空间
 * @param {string} key
 * @returns {boolean}
 */
export function isOwnedStorageKey(key) {
  return OWNER_KEY_PATTERN.test(String(key || ''));
}

const VALUE_SHAPES = {
  CONFIG: (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
    && ('stake' in v || 'oddsSpecial' in v),
  LOCAL_DRAWS: (v) => Array.isArray(v)
};

function isStorageLike(backend) {
  return Boolean(backend && typeof backend.getItem === 'function' && typeof backend.setItem === 'function');
}

function safeParse(raw) {
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * 列出 storage 中的全部键（浏览器与内存实现都支持）
 * @param {object} backend
 * @returns {string[]}
 */
export function listKeys(backend) {
  if (!isStorageLike(backend)) return [];
  if (typeof backend.keys === 'function') {
    try {
      return Array.from(backend.keys());
    } catch {
      return [];
    }
  }
  if (typeof backend.length === 'number' && typeof backend.key === 'function') {
    const out = [];
    for (let i = 0; i < backend.length; i++) {
      const k = backend.key(i);
      if (k) out.push(k);
    }
    return out;
  }
  return [];
}

/**
 * 查找某个用途的候选键（规范键优先 → 已知别名表 → 窄范围兜底扫描）
 * @param {object} backend
 * @param {'CONFIG'|'LOCAL_DRAWS'} kind
 * @returns {string|null}
 */
export function findSourceKey(backend, kind) {
  if (!isStorageLike(backend)) return null;
  const canonical = STORAGE_KEYS[kind];
  const shapeOk = VALUE_SHAPES[kind];

  const usable = (key) => {
    if (key == null) return false;
    const raw = backend.getItem(key);
    if (raw == null) return false;
    if (!shapeOk) return true;
    const parsed = safeParse(raw);
    return parsed !== undefined && shapeOk(parsed);
  };

  if (usable(canonical)) return canonical;

  for (const alias of LEGACY_KEY_ALIASES[kind] || []) {
    if (usable(alias)) return alias;
  }

  const hints = (KEY_HINTS[kind] || []).map((h) => h.toLowerCase());
  const candidate = listKeys(backend).find((k) => {
    const lk = String(k).toLowerCase();
    if (lk === String(canonical).toLowerCase()) return false;
    if (!OWNER_KEY_PATTERN.test(lk)) return false;
    return hints.some((h) => lk.includes(h));
  });
  return candidate && usable(candidate) ? candidate : null;
}

/**
 * 清洗本金/特码赔率配置：非法值回落到默认值
 * @param {any} raw
 * @param {object} defaults
 * @returns {{config: object, repaired: boolean}}
 */
export function sanitizeConfig(raw, defaults = {}) {
  const base = { stake: 10, oddsSpecial: 48, ...defaults, playMode: 'special' };
  const out = { ...base };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...out, config: out, repaired: Boolean(raw) };
  }
  let repaired = false;
  const num = (value, fallback, min, max) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      if (value != null) repaired = true;
      return fallback;
    }
    if (n < min || n > max) {
      repaired = true;
      return Math.min(max, Math.max(min, n));
    }
    return n;
  };
  out.stake = num(raw.stake, base.stake, 1, 1_000_000);

  const LEGACY_SPECIAL_ODDS = 9.6;
  const rawSpecialOdds = Number(raw.oddsSpecial);
  if (rawSpecialOdds === LEGACY_SPECIAL_ODDS) {
    repaired = true;
    out.oddsSpecial = base.oddsSpecial;
  } else {
    out.oddsSpecial = num(raw.oddsSpecial, base.oddsSpecial, 1, 1_000_000);
  }

  out.playMode = 'special';
  if (raw.remoteSourceUrl) out.remoteSourceUrl = String(raw.remoteSourceUrl);
  return { ...out, config: out, repaired };
}

/**
 * 解析实际使用的键
 * @param {object} backend
 * @param {'CONFIG'|'LOCAL_DRAWS'} kind
 * @returns {string|null}
 */
export function resolveKey(backend, kind) {
  if (!isStorageLike(backend)) return null;
  const canonical = STORAGE_KEYS[kind];
  if (backend.getItem(canonical) != null) return canonical;
  return findSourceKey(backend, kind);
}

/**
 * 读取并迁移本地持久化数据
 * @param {object} backend localStorage 兼容对象
 * @param {{defaults: object, normalizeDrawRecord: Function}} options
 * @returns {{config: object, localDraws: object[], migrations: string[], errors: string[]}}
 */
export function loadPersistedState(backend, options = {}) {
  const defaults = options.defaults || {};
  const normalizeDrawRecord = options.normalizeDrawRecord || ((x) => x);
  const migrations = [];
  const errors = [];

  let config = { ...defaults, playMode: 'special' };
  const configKey = resolveKey(backend, 'CONFIG');
  if (configKey) {
    const parsed = safeParse(backend.getItem(configKey));
    const { config: clean, repaired } = sanitizeConfig(parsed, defaults);
    config = clean;
    if (repaired) errors.push(`配置 ${configKey} 中存在非法数值，已重置为默认值`);
    if (configKey !== STORAGE_KEYS.CONFIG) {
      migrations.push(`${configKey} → ${STORAGE_KEYS.CONFIG}`);
    }
  }

  let localDraws = [];
  const drawsKey = resolveKey(backend, 'LOCAL_DRAWS');
  if (drawsKey) {
    const parsed = safeParse(backend.getItem(drawsKey));
    if (Array.isArray(parsed)) {
      localDraws = parsed.map(normalizeDrawRecord).filter(Boolean);
    } else if (parsed != null) {
      errors.push(`本地开奖 ${drawsKey} 格式损坏，已忽略`);
    }
    if (drawsKey !== STORAGE_KEYS.LOCAL_DRAWS) {
      migrations.push(`${drawsKey} → ${STORAGE_KEYS.LOCAL_DRAWS}`);
    }
  }

  return { config, localDraws, migrations, errors };
}

/**
 * 安全写入（隐私模式 / 配额满时不抛错）
 */
export function safeSet(backend, key, value) {
  if (!isStorageLike(backend)) return false;
  try {
    backend.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * 把迁移过来的旧键数据写回规范键名
 */
export function persistMigratedState(backend, state) {
  if (!isStorageLike(backend)) return;
  if (state.migrations.length === 0) return;
  safeSet(backend, STORAGE_KEYS.CONFIG, state.config);
  safeSet(backend, STORAGE_KEYS.LOCAL_DRAWS, state.localDraws);
}
