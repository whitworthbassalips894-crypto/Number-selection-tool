import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/constants.js';
import { normalizeDrawRecord } from '../src/parser.js';
import {
  STORAGE_KEYS,
  isOwnedStorageKey,
  loadPersistedState,
  persistMigratedState,
  sanitizeConfig
} from '../src/storage.js';

function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(String(k), String(v)); },
    removeItem(k) { map.delete(k); }
  };
}

test('STORAGE_KEYS 与同域其它六合彩工具完全隔离', () => {
  assert.equal(STORAGE_KEYS.CONFIG, 'mark6_nst_config_v1');
  assert.equal(STORAGE_KEYS.LOCAL_DRAWS, 'mark6_nst_local_draws_v1');

  assert.equal(isOwnedStorageKey('mark6_nst_config_v1'), true);
  assert.equal(isOwnedStorageKey('mark6_numsel_config_v0'), true);
  // 绝对不能认领兄弟站点（Pick-3-out-of-3 / lottery-tool）的存储键
  assert.equal(isOwnedStorageKey('mark6_p3_config_v3'), false);
  assert.equal(isOwnedStorageKey('mark6_lt_config_v1'), false);
});

test('sanitizeConfig：清洗本金与特码赔率，旧 9.6 倍自动迁移到 48 倍，playMode 恒为 special', () => {
  const c1 = sanitizeConfig({ stake: 20, oddsSpecial: 47, playMode: 'pick3' });
  assert.equal(c1.stake, 20);
  assert.equal(c1.oddsSpecial, 47);
  assert.equal(c1.playMode, 'special');

  const c2 = sanitizeConfig({ stake: -5, oddsSpecial: 9.6 });
  assert.equal(c2.stake, DEFAULT_CONFIG.stake);
  assert.equal(c2.oddsSpecial, 48);
});

test('loadPersistedState + persistMigratedState：不影响兄弟站点缓存键', () => {
  const store = createMemoryStorage({
    mark6_p3_config_v3: JSON.stringify({ stake: 99, playMode: 'pick4' }),
    mark6_numsel_config_v0: JSON.stringify({ stake: 15, oddsSpecial: 48.5 })
  });

  const persisted = loadPersistedState(store, {
    defaults: DEFAULT_CONFIG,
    normalizeDrawRecord
  });
  assert.equal(persisted.config.stake, 15);
  assert.equal(persisted.config.oddsSpecial, 48.5);
  assert.equal(persisted.config.playMode, 'special');

  persistMigratedState(store, persisted);
  // 兄弟站点的键完好无损
  assert.equal(store.getItem('mark6_p3_config_v3'), JSON.stringify({ stake: 99, playMode: 'pick4' }));
  // 新键已写入
  assert.ok(store.getItem(STORAGE_KEYS.CONFIG));
});
