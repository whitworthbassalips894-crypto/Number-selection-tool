import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { APP_BUILD, APP_VERSION_LABEL, CACHE_PREFIX } from '../src/constants.js';

const ROOT = process.cwd();

test('APP_BUILD / CACHE_PREFIX 在 constants.js、sw.js、index.html、package.json 中完全一致', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  assert.match(sw, new RegExp(`const BUILD_ID = '${APP_BUILD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}';`));
  assert.match(sw, new RegExp(`const CACHE_PREFIX = '${CACHE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}';`));

  assert.ok(html.includes(`?v=${APP_BUILD}`), 'index.html 静态资源必须携带当前构建版本号');
  assert.ok(html.includes(APP_VERSION_LABEL), 'index.html 必须展示当前版本标签');
  assert.ok(html.includes(`var CACHE_PREFIX = '${CACHE_PREFIX}';`), '看门狗脚本 CACHE_PREFIX 必须一致');
  assert.ok(pkg.version, 'package.json 必须包含版本号');
});

test('sw.js 中预缓存的 SHELL_FILES 在仓库中全部真实存在', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const m = sw.match(/const SHELL_FILES = \[([\s\S]*?)\];/);
  assert.ok(m, '应能解析 SHELL_FILES');
  const files = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.ok(files.length >= 10);
  for (const rel of files) {
    if (rel === './') continue;
    const diskPath = path.join(ROOT, rel.replace(/^\.\//, ''));
    assert.ok(fs.existsSync(diskPath), `SHELL_FILES 中缺失文件: ${rel}`);
  }
});

test('index.html 已彻底移除三中三与四中四控件，仅保留特码三组 7 码', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(!html.includes('id="modeSwitch"'), '不应存在玩法切换分段按钮');
  assert.ok(!html.includes('id="cfgOdds3"'), '不应存在三中三赔率输入框');
  assert.ok(!html.includes('id="cfgOdds4"'), '不应存在四中四赔率输入框');
  assert.ok(!html.includes('三中三'), '页面不应再出现三中三界面文案');
  assert.ok(!html.includes('四中四'), '页面不应再出现四中四界面文案');
  assert.ok(html.includes('id="cfgOddsSpecial"'), '必须保留特码赔率输入框');
});
