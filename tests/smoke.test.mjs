import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import INITIAL_DB from '../data/draws.js';
import { combinedPlan } from '../src/combined.js';

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
    'quickPreview', 'btnQuickSave', 'quickMsg',
    'heroPeriod', 'heroMeta', 'heroShare', 'periodSelect', 'btnPrevPeriod', 'btnNextPeriod', 'btnNext', 'btnCopyAll',
    'dualBoard', 'combinedStrategy', 'historyIncludeRandom', 'combinedStatus', 'yearlyBody', 'combinedBody', 'combinedCount',
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

    // 双方案首屏：随机撞号开关与双方重叠核心同步更新
    const board = dom.window.document.getElementById('dualBoard');
    assert.deepEqual([...board.querySelectorAll('.plan-a .dual-number b')].map(x => x.textContent), ['06','23','25','34']);
    assert.deepEqual([...board.querySelectorAll('.plan-b .dual-number b')].map(x => x.textContent), ['10','23','25','37','43']);
    assert.deepEqual([...board.querySelectorAll('.plan-a .dual-shared b')].map(x => x.textContent), ['23','25']);
    const toggle = dom.window.document.getElementById('includeRandom');
    toggle.checked = false;
    toggle.dispatchEvent(new dom.window.Event('change', {bubbles:true}));
    assert.deepEqual([...board.querySelectorAll('.plan-a .dual-number b')].map(x => x.textContent), ['23','25','34']);


    // 快速录入：粘贴号码自动识别 6 正码 + 1 特码，正码升序，可保存到本机开奖
    const quickInput = dom.window.document.getElementById('quickPasteInput');
    quickInput.value = '08 14 23 26 31 45 + 12';
    quickInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 450));
    assert.deepEqual(
      [...dom.window.document.querySelectorAll('#quickPreview .lotto-ball')].map((el) => el.textContent),
      ['08', '14', '23', '26', '31', '45', '12'],
      '预览应为 6 正码（升序）+ 特码'
    );
    assert.match(dom.window.document.getElementById('quickMsg').textContent, /识别/, '自动识别后应提示');

    dom.window.document.getElementById('btnQuickSave').click();
    assert.match(dom.window.document.getElementById('quickMsg').textContent, /已保存/, '保存后应提示已保存');
    assert.equal(dom.window.document.getElementById('localCountSync').textContent, '1', '本机录入应增加 1 期');
    assert.equal(dom.window.document.querySelectorAll('#quickPreview .lotto-ball').length, 0, '保存后应清空预览');

    // 示例按钮：填入 6 正码 + 1 特码
    dom.window.document.getElementById('btnQuickDemo').click();
    assert.deepEqual(
      [...dom.window.document.querySelectorAll('#quickPreview .lotto-ball')].map((el) => el.textContent),
      ['08', '14', '23', '26', '31', '45', '12'],
      '示例应填好 6 正码 + 特码'
    );
    dom.window.document.getElementById('btnQuickClear').click();
    assert.equal(dom.window.document.querySelectorAll('#quickPreview .lotto-ball').length, 0, '清空后应回到空预览');

    // 刚粘贴完就点保存：应先从输入框识别，再按下一期保存
    quickInput.value = '03 07 11 19 27 35 + 42';
    quickInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    dom.window.document.getElementById('btnQuickSave').click();
    assert.match(dom.window.document.getElementById('quickMsg').textContent, /已保存/, '粘贴后立即保存也应成功');
    assert.equal(dom.window.document.getElementById('localCountSync').textContent, '2', '本机录入应累计 2 期');

    // 验证 URL 归一为 ?p=NEXT（清除了旧链接遗留的 m=special）
    assert.equal(dom.window.location.search, '?p=NEXT');

    // 复制的是当前可见的 A / B，不再复制已移除的原版三组。
    dom.window.document.getElementById('btnCopyAll').click();
    await new Promise((r) => setTimeout(r, 10));
    assert.match(copied, /^方案 A：.*\n方案 B：/);

    // 历史期切换仍保留，双方案展示当前开奖号的命中状态。
    const hitDraw = INITIAL_DB.draws.slice(0, 60).find(d => {
      const p = combinedPlan(INITIAL_DB.draws, d);
      return p.b.includes(d.special);
    });
    assert.ok(hitDraw);
    const sel = dom.window.document.getElementById('periodSelect');
    sel.value = hitDraw.id;
    sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.match(board.querySelector('.plan-b .dual-meta').textContent, /命中/);

    // 全量回放：不分页、不显示逐期金额，展开 / 收起和方案切换均使用正确的号码。
    const deadline = Date.now() + 60000;
    const status = dom.window.document.getElementById('combinedStatus');
    while (!status.textContent.startsWith('✓') && Date.now() < deadline) {
      if (status.textContent.includes('失败')) assert.fail(status.textContent);
      await new Promise(r => setTimeout(r, 100));
    }
    assert.match(status.textContent, /^✓/);
    const strategy = dom.window.document.getElementById('combinedStrategy');
    assert.deepEqual([...strategy.options].map(o => o.value), ['a', 'b', 'ab']);
    const body = dom.window.document.getElementById('combinedBody');
    assert.equal(body.querySelectorAll('tr.main-row').length, INITIAL_DB.draws.length + 1); // 两期本地录入，减去一条无效底库
    assert.equal(dom.window.document.getElementById('yearlyBody').querySelectorAll('tr').length, 6);
    assert.equal(dom.window.document.getElementById('btnMoreHist'), null);
    assert.equal(dom.window.document.getElementById('fiveGrid'), null);
    assert.equal(dom.window.document.getElementById('histBody'), null);
    assert.doesNotMatch(body.textContent, /元|¥/);
    const row305 = [...body.querySelectorAll('tr.main-row')].find(row => row.querySelector('.col-period').textContent.includes('2026-305'));
    const plan305 = combinedPlan(INITIAL_DB.draws, INITIAL_DB.draws[0]);
    row305.click();
    assert.deepEqual([...row305.nextElementSibling.querySelectorAll('.fd-nums .d-num')].map(x => Number(x.textContent)), plan305.aPure);
    assert.equal(row305.querySelector('.col-hits').textContent.includes('命中'), plan305.aPure.includes(INITIAL_DB.draws[0].special));
    row305.click();
    const firstRow = body.querySelector('tr.main-row');
    assert.equal(firstRow.querySelectorAll('.d-num').length, 7);
    assert.equal(firstRow.querySelectorAll('.d-num:not(.special).hit').length, 0);
    let expand = firstRow.querySelector('button');
    expand.click();
    assert.equal(expand.getAttribute('aria-expanded'), 'true');
    assert.match(firstRow.nextElementSibling.textContent, /方案 A/);
    assert.doesNotMatch(firstRow.nextElementSibling.textContent, /元|¥/);
    expand.click();
    assert.equal(expand.getAttribute('aria-expanded'), 'false');
    assert.equal(body.querySelector('.feat-detail'), null);
    strategy.value = 'b';
    strategy.dispatchEvent(new dom.window.Event('change', {bubbles:true}));
    assert.equal(dom.window.document.getElementById('historyRandomLabel').hidden, true);
    expand = body.querySelector('button');
    expand.click();
    assert.match(body.querySelector('.feat-detail').textContent, /方案 B/);
    assert.equal(body.querySelectorAll('.feat-detail .d-num').length, 5);
    strategy.value = 'ab';
    strategy.dispatchEvent(new dom.window.Event('change', {bubbles:true}));
    assert.equal(dom.window.document.getElementById('historyRandomLabel').hidden, false);
    assert.equal(dom.window.document.getElementById('combinedTerms').hidden, false);
    let row303 = [...body.querySelectorAll('tr.main-row')].find(row => row.querySelector('.col-period').textContent.includes('2026-303'));
    const draw303 = INITIAL_DB.draws.find(d => d.id === '2026-303');
    const plan303 = combinedPlan(INITIAL_DB.draws, draw303);
    assert.match(row303.querySelector('.col-hits').textContent, /^命中 2\/8$/);
    row303.click();
    assert.deepEqual([...row303.nextElementSibling.querySelectorAll('.fd-nums .d-num')].map(x => Number(x.textContent)), plan303.abPure);
    assert.match(row303.nextElementSibling.textContent, /方案 A \+ 方案 B/);
    assert.match(row303.nextElementSibling.textContent, /中 2 注/);
    assert.equal(row303.nextElementSibling.querySelectorAll('.d-num.hit').length, 2);
    const randomAB = dom.window.document.getElementById('historyIncludeRandom');
    randomAB.checked = true;
    randomAB.dispatchEvent(new dom.window.Event('change', {bubbles:true}));
    row303 = [...body.querySelectorAll('tr.main-row')].find(row => row.querySelector('.col-period').textContent.includes('2026-303'));
    row303.click();
    assert.deepEqual([...row303.nextElementSibling.querySelectorAll('.fd-nums .d-num')].map(x => Number(x.textContent)), plan303.ab);
    assert.equal(dom.window.document.getElementById('includeRandom').checked, true);
    randomAB.checked = false;
    randomAB.dispatchEvent(new dom.window.Event('change', {bubbles:true}));
    strategy.value = 'a';
    strategy.dispatchEvent(new dom.window.Event('change', {bubbles:true}));
    assert.equal(dom.window.document.getElementById('historyIncludeRandom').checked, false);
    const historyToggle = dom.window.document.getElementById('historyIncludeRandom');
    historyToggle.checked = true;
    historyToggle.dispatchEvent(new dom.window.Event('change', {bubbles:true}));
    assert.equal(dom.window.document.getElementById('includeRandom').checked, true);
  } finally {
    for (const k of keys) {
      if (prevGlobals[k] === undefined) delete globalThis[k];
      else Object.defineProperty(globalThis, k, { value: prevGlobals[k], configurable: true, writable: true });
    }
  }
});
