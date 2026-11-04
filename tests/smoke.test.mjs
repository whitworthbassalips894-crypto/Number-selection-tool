import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import INITIAL_DB from '../data/draws.js';
import { combinedPlan } from '../src/combined.js';
import { nextPeriodMeta } from '../src/periods.js';

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
    'dualBoard', 'replayYearTabs', 'combinedStatus', 'yearlyBody', 'combinedBody', 'combinedCount',
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
    const doc = dom.window.document;
    assert.deepEqual([...doc.querySelectorAll('main > section.page-section')].map(el => el.id), ['today', 'history', 'sync', 'more']);
    assert.deepEqual([...doc.querySelectorAll('.anchor-nav a')].map(el => el.textContent), ['推荐', '回放', '同步/录入', '设置']);
    assert.equal(doc.querySelector('#sync > details').open, false);
    assert.ok([...doc.querySelectorAll('#more > details')].every(el => !el.open));
    assert.equal(doc.getElementById('combinedStrategy'), null);


    // NEXT 根据最新底库计算，方案 A 永久剔除随机号。
    const board = dom.window.document.getElementById('dualBoard');
    const next = combinedPlan(INITIAL_DB.draws, nextPeriodMeta(INITIAL_DB.draws[0]));
    const pad = n => String(n).padStart(2, '0');
    assert.deepEqual([...board.querySelectorAll('.optimized-card .dual-number b')].map(x => x.textContent), next.opt.map(pad));
    assert.deepEqual([...board.querySelectorAll('.optimized-card .dual-shared b')].map(x => x.textContent), next.opt.filter(n => next.a.includes(n) && next.b.includes(n)).map(pad));
    assert.match(board.querySelector('.optimized-footer').textContent, new RegExp(`${next.opt.length} 注`));
    assert.deepEqual([...board.querySelectorAll('.plan-a .dual-number b')].map(x => x.textContent), next.a.map(pad));
    assert.deepEqual([...board.querySelectorAll('.plan-b .dual-number b')].map(x => x.textContent), next.b.map(pad));
    assert.deepEqual([...board.querySelectorAll('.plan-a .dual-shared b')].map(x => x.textContent), next.a.filter(n => next.b.includes(n)).map(pad));
    assert.match(board.querySelector('.plan-a p').textContent, /工具 1 精选 9 码（已剔除随机号）/);
    assert.equal(dom.window.document.getElementById('includeRandom'), null);
    assert.equal(dom.window.document.getElementById('historyIncludeRandom'), null);
    // 内置底库含 306 期时，历史期也应稳定显示给定验算基准。
    const selector = dom.window.document.getElementById('periodSelect');
    selector.value = '2026-306';
    selector.dispatchEvent(new dom.window.Event('change', {bubbles:true}));
    assert.deepEqual([...board.querySelectorAll('.plan-a .dual-number b')].map(x => x.textContent), ['23','25','34']);
    assert.deepEqual([...board.querySelectorAll('.plan-b .dual-number b')].map(x => x.textContent), ['10','23','25','37','43']);
    dom.window.document.getElementById('btnNext').click();

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
    assert.match(copied, /^优选实战：.*\n方案 A：.*\n方案 B：/);

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
    const body = dom.window.document.getElementById('combinedBody');
    const yearly = dom.window.document.getElementById('yearlyBody');
    const tabs = dom.window.document.getElementById('replayYearTabs');
    const totalRows = INITIAL_DB.draws.length + 1; // 两期本地录入，减去一条无效底库
    assert.equal(body.querySelectorAll('tr.main-row').length, totalRows);
    assert.equal(yearly.querySelectorAll('tr').length, 6);
    assert.deepEqual([...yearly.querySelectorAll('tr')].map(row => row.dataset.year), ['2026','2025','2024','2023','2022','ALL']);
    assert.deepEqual([...tabs.querySelectorAll('button')].map(btn => btn.dataset.year), ['ALL','2026','2025','2024','2023','2022']);
    assert.ok(tabs.querySelector('[data-year="ALL"]').classList.contains('active'));
    assert.ok(yearly.querySelector('[data-year="ALL"]').classList.contains('selected'));
    for (const row of yearly.querySelectorAll('tr')) {
      assert.equal(row.querySelectorAll('.year-rate').length, 4);
      for (const cell of row.querySelectorAll('.year-rate')) assert.match(cell.textContent, /\d+\.\d%.*中 · 均/);
    }
    // 总表数值必须按期统计，而非 A+B 重复注数。
    const totalSummary = yearly.querySelector('[data-year="ALL"]');
    for (const [i, key] of ['opt','a','b','ab'].entries()) {
      const wins = body.querySelectorAll(`td[data-scheme="${key}"] .hit-badge`).length;
      assert.equal(totalSummary.querySelectorAll('.year-rate strong')[i].textContent, `${(wins / totalRows * 100).toFixed(1)}%`);
      assert.match(totalSummary.querySelectorAll('.year-rate small')[i].textContent, new RegExp(`\\(${wins}中`));
    }
    assert.equal(dom.window.document.getElementById('btnMoreHist'), null);
    assert.doesNotMatch(body.textContent, /元|¥/);
    assert.ok([...body.querySelectorAll('tr.main-row')].every(row => row.querySelectorAll('td.scheme-hit').length === 4));
    const row305 = [...body.querySelectorAll('tr.main-row')].find(row => row.querySelector('.col-period').textContent.includes('2026-305'));
    const draw305 = INITIAL_DB.draws.find(d => d.id === '2026-305');
    const plan305 = combinedPlan(INITIAL_DB.draws, draw305);
    row305.click();
    const detail305 = row305.nextElementSibling;
    assert.equal(detail305.querySelector('td').getAttribute('colspan'), '7');
    assert.equal(detail305.querySelectorAll('.fd-five').length, 3);
    for (const [i, key] of ['opt','a','b'].entries()) {
      assert.deepEqual([...detail305.querySelectorAll('.fd-five')[i].querySelectorAll('.d-num')].map(x => Number(x.textContent)), plan305[key]);
    }
    assert.match(detail305.textContent, /优选实战.*方案 A · 共振.*方案 B · 热冷/);
    assert.doesNotMatch(detail305.textContent, /元|¥/);
    row305.click();
    assert.equal(body.querySelector('.feat-detail'), null);
    const row303 = [...body.querySelectorAll('tr.main-row')].find(row => row.querySelector('.col-period').textContent.includes('2026-303'));
    assert.equal(row303.querySelector('[data-scheme="ab"]').textContent, '17×2');
    assert.equal(row303.querySelector('.special').classList.contains('hit'), true);
    assert.equal(row303.classList.contains('row-win'), true);
    const firstRow = body.querySelector('tr.main-row');
    assert.equal(firstRow.querySelectorAll('.col-draw .d-num').length, 7);
    assert.equal(firstRow.querySelectorAll('.d-num:not(.special).hit').length, 0);
    const expand = firstRow.querySelector('button');
    expand.click();
    assert.equal(expand.getAttribute('aria-expanded'), 'true');
    assert.equal(firstRow.nextElementSibling.querySelectorAll('.fd-five').length, 3);
    expand.click();
    assert.equal(expand.getAttribute('aria-expanded'), 'false');

    tabs.querySelector('[data-year="2026"]').click();
    assert.ok([...body.querySelectorAll('tr.main-row')].every(row => row.querySelector('.col-period').textContent.startsWith('2026-')));
    assert.ok(yearly.querySelector('[data-year="2026"]').classList.contains('selected'));
    assert.ok(tabs.querySelector('[data-year="2026"]').classList.contains('active'));
    yearly.querySelector('[data-year="2025"]').click();
    assert.ok([...body.querySelectorAll('tr.main-row')].every(row => row.querySelector('.col-period').textContent.startsWith('2025-')));
    assert.ok(tabs.querySelector('[data-year="2025"]').classList.contains('active'));
    tabs.querySelector('[data-year="ALL"]').click();
    assert.equal(body.querySelectorAll('tr.main-row').length, totalRows);
    assert.ok(yearly.querySelector('[data-year="ALL"]').classList.contains('selected'));
  } finally {
    for (const k of keys) {
      if (prevGlobals[k] === undefined) delete globalThis[k];
      else Object.defineProperty(globalThis, k, { value: prevGlobals[k], configurable: true, writable: true });
    }
  }
});
