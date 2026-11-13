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

  const resourceUrls = [...html.matchAll(/(?:href|src)="(\.\/[^"#]+)"/g)].map(m => m[1]);
  assert.ok(resourceUrls.length > 0, '页面应包含静态资源');
  for (const url of resourceUrls) {
    assert.ok(url.endsWith(`?v=${APP_BUILD}`), `静态资源版本不一致：${url}`);
  }
  assert.ok(html.includes(APP_VERSION_LABEL), 'index.html 必须展示当前版本标签');
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

test('页面展示新版本选号和同步入口', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const term of ['cfgStake', 'cfgOddsSpecial', '本金', '赔率', '净收益', 'ROI', '最大回撤', '双方案']) {
    assert.ok(!html.includes(term), `不应包含 ${term}`);
  }
  assert.ok(html.includes('id="selectionSize"'));
  assert.ok(html.includes('id="syncNow"'));
  assert.ok(html.includes('id="heatScope"'));
});
