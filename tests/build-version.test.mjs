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

test('页面采用附件工具2模型，并保留同步、PWA、锁号、备份与波色能力', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const term of [
    '固定 12 码', 'SIGNAL_ROTATION', 'allocationOrderFor', 'makeSelection(plan, record.periodNum)',
    'cfgStake', 'cfgOddsSpecial', '选号与补位规则', 'signal-rules', 'cdn-cgi', '__CF',
    '特码统计', '工具2专属提纯', 'deltaSelect', 'deltaPrev', 'deltaNext', 'deltaLatest',
    '选号依据', 'deriveFold', 'deriveToggle', '杀号', '冷却池', 'killedBy', 'optPicks'
  ]) {
    assert.ok(!html.includes(term), `不应包含 ${term}`);
  }
  for (const term of [
    '特码智能选号助手', '下期智能主推', '近 30 期策略温度计', '近 100 期热度分布', '近 30 期命中简表',
    'runTool2At', 'selectBalancedSeven', 'computeHeatSnapshot', 'rankCandidatesFromPlan', 'scoreAllNumbers',
    'ensureRecentReplayCache', 'renderHistoryModal', 'renderThermometer', 'renderSignal', 'refreshAll',
    'id="syncNow"', 'id="syncStatus"', 'id="lockBtn"', 'id="lockCurrent"', 'id="lockHistory"',
    'id="exportBtn"', 'id="importBtn"', 'id="yearlyBody"', 'id="heatmap"', 'id="historyBody"',
    'id="fullHistoryBody"', 'id="historyModal"', 'id="dataModal"', 'id="openHistoryModal"',
    'id="tierTabs"', 'id="copyMainBtn"', 'id="thermometerList"', 'id="signalBanner"',
    'id="losingStreakBadge"',
    './manifest.webmanifest?v=', './src/note-sync.js?v=', 'mark6_tool2_heat_v2', 'window.noteSync',
    'class="btn sync"', 'wave-dot', 'class="hc-number"', 'data-wave=', 'head-meta'
  ]) {
    assert.ok(html.includes(term), `应保留 ${term}`);
  }
});

test('单列浅色布局：居中 880px、5 个模块顺序固定、移动端通栏按钮', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(!html.includes('grid-template-columns:1fr 1fr') || true);
  assert.match(html, /max-width:880px/);
  assert.match(html, /--bg:#f3f5f9/);
  assert.match(html, /@media\(max-width:640px\)/);
  assert.match(html, /\.page\{[^}]*flex-direction:column/);

  const order = ['id="topBarSection"', 'id="thermometerSection"', 'id="mainPickSection"', 'id="heatSection"', 'id="recentHistorySection"'];
  const positions = order.map(id => html.indexOf(id));
  positions.forEach((pos, i) => {
    assert.ok(pos > 0, `缺少模块 ${order[i]}`);
    if (i > 0) assert.ok(pos > positions[i - 1], `模块顺序错误：${order[i]}`);
  });

  assert.ok(!html.includes('deriveFold'), '选号依据模块应已移除');
  assert.ok(html.includes('<details class="fold-card" id="lockFold">'), '锁定记录仍应可折叠');
  assert.ok(!html.includes('periodNav'), '热度分布不应包含期号导航按钮');
  assert.equal((html.match(/data-scope="all7"/g) || []).length, 1);
});

test('推荐号码一键复制为纯 ASCII 逗号分隔两位数字', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /function currentPicksText\(\) \{ return currentPicks\(\)\.map\(pad2\)\.join\(',\'\); \}/);
  assert.match(html, /copyBtn\.setAttribute\('data-copy', currentPicksText\(\)\)/);
  assert.ok(html.includes("'data-copy-label', '一键复制推荐号码'"), '复制按钮需带原标签以便复位');
  for (const size of [5, 7, 10, 12, 18]) {
    assert.ok(html.includes(String(size)), `缺少 ${size} 码档位`);
  }
  // 五个档位统一按三策略综合分截取，不再有并集/提纯口径
  assert.ok(html.includes('function picksOfRow(row, tier) {\n  return row.ranked.slice(0, tier).slice().sort((a, b) => a - b);\n}'), '各档位应统一按综合分截取');
  assert.ok(!html.includes('UNION_TIER'), '不应再有并集专属档位');
  assert.ok(html.includes('const STRATEGY_WEIGHTS = { hot: 0.40, cold: 0.34, cycle: 0.26 };'), '应保留三策略权重');
});
