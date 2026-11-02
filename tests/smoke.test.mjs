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
    'quickEntry', 'quickPeriod', 'quickDate', 'quickPasteInput', 'btnQuickRecognize', 'btnQuickDemo', 'btnQuickClear',
    'quickGrid', 'quickCount', 'quickPreview', 'btnQuickSave', 'quickMsg',
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

    // 快速录入：点选 1–49 号码，第 7 个自动成为特码，可保存到本机开奖
    const quickGrid = dom.window.document.getElementById('quickGrid');
    assert.equal(quickGrid.querySelectorAll('.quick-num').length, 49, '快速录入应展示 1–49 共 49 个号码');
    for (const n of [8, 14, 23, 26, 31, 45, 12]) {
      quickGrid.querySelector(`[data-quick-num="${n}"]`).click();
    }
    assert.equal(dom.window.document.getElementById('quickCount').textContent, '已选 7 / 7');
    const quickSelected = [...quickGrid.querySelectorAll('.quick-num.selected')];
    assert.equal(quickSelected.length, 7, '应选中 7 个号码');
    const quickSpecial = quickGrid.querySelector('.quick-num.is-special');
    assert.equal(quickSpecial.dataset.quickNum, '12', '最后点选的号码应为特码');
    assert.ok(quickSpecial.classList.contains('selected'), '特码应处于选中状态');
    assert.equal(dom.window.document.querySelectorAll('#quickPreview .lotto-ball').length, 7, '预览应为 6 正码 + 1 特码');

    dom.window.document.getElementById('btnQuickSave').click();
    assert.match(dom.window.document.getElementById('quickMsg').textContent, /已保存/, '保存后应提示已保存');
    assert.equal(dom.window.document.getElementById('localCountSync').textContent, '1', '本机录入应增加 1 期');
    assert.equal(dom.window.document.getElementById('quickCount').textContent, '已选 0 / 7', '保存后应清空选择');

    quickGrid.querySelector('[data-quick-num="12"]').click();
    assert.equal(dom.window.document.getElementById('quickCount').textContent, '已选 1 / 7', '保存后可重新点选');
    quickGrid.querySelector('[data-quick-num="12"]').click();
    assert.equal(dom.window.document.getElementById('quickCount').textContent, '已选 0 / 7', '再点一次应取消选择');
    dom.window.document.getElementById('btnQuickClear').click();
    assert.equal(dom.window.document.getElementById('quickCount').textContent, '已选 0 / 7', '清空后应回到 0 个');

    // 输入框自动识别：粘贴/输入号码后自动填好 6 正码 + 特码，正码升序
    const quickInput = dom.window.document.getElementById('quickPasteInput');
    quickInput.value = '02 08 09 13 14 31 + 45';
    quickInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 450));
    assert.equal(dom.window.document.getElementById('quickCount').textContent, '已选 7 / 7', '输入后应自动识别 7 个号码');
    assert.equal(dom.window.document.querySelector('#quickGrid .quick-num.is-special').dataset.quickNum, '45', '+ 后号码应为特码');
    assert.deepEqual(
      [...dom.window.document.querySelectorAll('#quickPreview .lotto-ball')].map((el) => el.textContent),
      ['02', '08', '09', '13', '14', '31', '45'],
      '正码应升序排列，特码在最后'
    );

    // 刚粘贴完就点保存：应先从输入框识别，再按下一期保存
    dom.window.document.getElementById('btnQuickClear').click();
    quickInput.value = '03 07 11 19 27 35 + 42';
    quickInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    dom.window.document.getElementById('btnQuickSave').click();
    assert.match(dom.window.document.getElementById('quickMsg').textContent, /已保存/, '粘贴后立即保存也应成功');
    assert.equal(dom.window.document.getElementById('localCountSync').textContent, '2', '本机录入应累计 2 期');

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
