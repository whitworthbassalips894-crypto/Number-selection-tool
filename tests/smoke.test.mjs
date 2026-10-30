import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import INITIAL_DB from '../data/draws.js';
import { generateDailyFive } from '../src/dailyfive.js';
import { formatFiveTickets, formatSingleTicket } from '../src/copy.js';

const ROOT = process.cwd();

test('DOM 冒烟测试（若安装 jsdom 则完整启动 app.js，否则做静态结构深度校验）', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  let JSDOM = null;
  try {
    ({ JSDOM } = await import('jsdom'));
  } catch {
    JSDOM = null;
  }

  // 基础 DOM ID 完整性断言
  const requiredIds = [
    'dbBadge', 'buildTag', 'latestLine', 'bootError',
    'syncGrid', 'auditLine', 'btnSyncCheck', 'btnSyncNow', 'btnSyncFix', 'btnExportDb',
    'heroPeriod', 'heroMeta', 'heroShare', 'periodSelect', 'btnPrevPeriod', 'btnNextPeriod', 'btnNext', 'btnCopyAll',
    'heroResult', 'consensusStrip', 'fiveGrid', 'featuredCostLine',
    'histFilter', 'btnPrevHit', 'btnNextHit', 'btnReplayRun', 'histRangeTabs', 'replayStatus',
    'histMetrics', 'histBaseline', 'histBody', 'btnMoreHist', 'histCount',
    'cfgStake', 'cfgOddsSpecial', 'btnResetCfg', 'cfgOddsNote',
    'btnCheckUpdate', 'btnRepairCache', 'btnResetServiceWorker', 'updateStatus',
    'btnCopyAllMobile', 'toastContainer'
  ];
  for (const id of requiredIds) {
    assert.ok(html.includes(`id="${id}"`), `index.html 缺少必需节点 #${id}`);
  }

  if (!JSDOM) return;

  const dom = new JSDOM(html, {
    url: 'https://whitworthbassalips894-crypto.github.io/Number-selection-tool/?p=NEXT&m=special',
    pretendToBeVisual: true
  });

  const prevGlobals = {};
  const keys = ['window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage', 'HTMLElement', 'CustomEvent', 'Event'];
  for (const k of keys) prevGlobals[k] = globalThis[k];

  try {
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
    globalThis.location = dom.window.location;
    globalThis.history = dom.window.history;
    globalThis.localStorage = dom.window.localStorage;
    globalThis.sessionStorage = dom.window.sessionStorage;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.CustomEvent = dom.window.CustomEvent;
    globalThis.Event = dom.window.Event;

    let copied = '';
    Object.defineProperty(dom.window.navigator, 'clipboard', {
      value: { writeText: async (txt) => { copied = txt; } },
      configurable: true
    });
    dom.window.__SKIP_AUTO_SYNC__ = true;

    await import(`../src/app.js?smoke=${Date.now()}`);

    assert.equal(dom.window.__APP_BOOTED__, true, 'app.js 必须无错完成初始化');
    assert.equal(dom.window.document.getElementById('bootError').hidden, true);

    // 验证 URL 归一为 ?p=NEXT（清除了旧链接遗留的 m=special）
    assert.equal(dom.window.location.search, '?p=NEXT');

    // 验证渲染了 3 张卡片、共 21 颗号码球
    const cards = dom.window.document.querySelectorAll('#fiveGrid .five-card');
    assert.equal(cards.length, 3);
    const balls = dom.window.document.querySelectorAll('#fiveGrid .lotto-ball');
    assert.equal(balls.length, 21);

    // 验证整套复制输出纯号码 3 行 × 7 码
    dom.window.document.getElementById('btnCopyAll').click();
    await new Promise((r) => setTimeout(r, 10));
    const lines = copied.split('\n');
    assert.equal(lines.length, 3);
    for (const l of lines) assert.match(l, /^\d{2}(、\d{2}){6}$/);

    // 切换到历史某期（找一期有命中的，验证只高亮特码球，正码球绝不误标 ball-hit）
    const hitDraw = INITIAL_DB.draws.slice(0, 60).find((d) => {
      const p = generateDailyFive(INITIAL_DB.draws, { year: d.year, periodNum: d.periodNum, date: d.date });
      return p.five.some((g) => g.numbers.includes(d.special)) && p.five.some((g) => d.numbers.some((n) => g.numbers.includes(n)));
    });
    assert.ok(hitDraw, '近 60 期中应存在既中特码又含正码同号的期次');

    const sel = dom.window.document.getElementById('periodSelect');
    sel.value = hitDraw.id;
    sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    const resultBalls = [...dom.window.document.querySelectorAll('#heroResult .lotto-ball')];
    assert.equal(resultBalls.length, 7, '开奖条应渲染 6 正码 + 1 特码');
    for (let i = 0; i < 6; i++) {
      assert.equal(resultBalls[i].classList.contains('ball-hit'), false, '6 个正码球在特码模块绝不应标为命中');
    }
    assert.equal(resultBalls[6].classList.contains('ball-hit'), true, '第 7 颗特码球命中时必须高亮');

    // 等待回放完成并验证 3 组对比卡片渲染
    await new Promise((r) => setTimeout(r, 400));
    const stratBoxes = dom.window.document.querySelectorAll('#histMetrics .sc-box');
    assert.equal(stratBoxes.length, 3, '回放对比面板应展示 3 组独立卡片');
  } finally {
    for (const k of keys) {
      if (prevGlobals[k] === undefined) delete globalThis[k];
      else Object.defineProperty(globalThis, k, { value: prevGlobals[k], configurable: true, writable: true });
    }
  }
});
