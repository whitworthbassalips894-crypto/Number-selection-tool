import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { planSync } from '../src/note-sync.js';
import { normalizeDrawRecord } from '../src/parser.js';
import { NUMBER_TO_COLOR } from '../src/constants.js';

const html = fs.readFileSync('index.html', 'utf8');
const data = vm.runInNewContext(html.match(/const COMPRESSED_DATA = (\[[\s\S]*?\]);/)[1]);
const local = data.map(r => ({
  label: `${r[0]}-${String(r[1]).padStart(3, '0')}`,
  year: r[0],
  periodNum: r[1],
  raw7: r.slice(2),
  usable: new Set(r.slice(2)).size === 7
}));
const remote = JSON.parse(fs.readFileSync('data/draws.json')).draws.map(normalizeDrawRecord);
const fresh = normalizeDrawRecord({
  year: 2026, periodNum: 321, date: '2026-11-17',
  numbers: [1, 2, 3, 4, 5, 6], special: 7
});
const WAVE_HEX = { red: '#e54b4b', blue: '#3b82f6', green: '#10a878' };
const WAVE_RGB = Object.fromEntries(Object.entries(WAVE_HEX).map(([key, hex]) => {
  const value = hex.slice(1);
  return [key, `rgb(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)})`];
}));

async function waitForRecommendation(dom) {
  const deadline = Date.now() + 12000;
  const rendered = () => dom.window.document.querySelectorAll('#optHero .ball').length > 0;
  while (Date.now() < deadline) {
    if (rendered()) return;
    await new Promise(resolve => dom.window.setTimeout(resolve, 25));
  }
  throw new Error('工具2推荐号码未在预期时间内生成');
}

test('内置仓库底库与 data/draws.json 一致，一键同步只追加连续新期', () => {
  assert.equal(local.length, remote.length);
  assert.deepEqual(planSync(local, remote), []);
  assert.deepEqual(planSync(local, [fresh, ...remote]).map(d => d.id), [fresh.id]);

  const lastLocal = remote.find(d => d.id === local.at(-1).label);
  assert.ok(lastLocal, `仓库底库应包含 ${local.at(-1).label}`);
  const alternate = Array.from({ length: 49 }, (_, i) => i + 1)
    .find(n => n !== lastLocal.special && !lastLocal.numbers.includes(n));
  const changed = remote.map(d => d.id === lastLocal.id ? { ...d, special: alternate } : d);
  assert.throws(() => planSync(local, changed), /冲突/);

  const gap = normalizeDrawRecord({
    year: 2026, periodNum: 322, date: '2026-11-18',
    numbers: [8, 9, 10, 11, 12, 13], special: 14
  });
  assert.throws(() => planSync(local, [gap, ...remote]), /缺口/);
});

test('附件页面启动并把同步数据写入 mark6_tool2_heat_v2', async () => {
  const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  try {
    const doc = dom.window.document;
    assert.ok(dom.window.noteSync);
    assert.equal(dom.window.noteSync.records().length, remote.length);
    assert.deepEqual(planSync(dom.window.noteSync.records(), remote), []);
    assert.match(doc.getElementById('syncNow').textContent, /一键同步/);
    assert.ok(doc.getElementById('syncStatus'));
    assert.equal(doc.querySelector('.signal-rules'), null);
    assert.ok(!doc.body.textContent.includes('选号与补位规则'));
    assert.ok(!doc.body.textContent.includes('固定 12 码'));

    dom.window.noteSync.apply([fresh]);
    const saved = JSON.parse(dom.window.localStorage.getItem('mark6_tool2_heat_v2'));
    assert.equal(saved.version, 3);
    assert.equal(saved.labels.length, 1);
    assert.equal(saved.labels.at(-1), fresh.id);
    assert.equal(saved.locked, null);
    assert.deepEqual(saved.locks, []);
    assert.equal(doc.getElementById('noticeLatest').textContent, fresh.id);
    assert.equal(doc.getElementById('nextTargetHead').textContent, '2026-322');
    assert.equal(doc.getElementById('totalCount').textContent, '1781');
    assert.equal(doc.getElementById('storageLine').hidden, false);
    assert.match(doc.getElementById('dataSourceLabel').textContent, /本机同步记录/);
    assert.equal(dom.window.noteSync.records().at(-1).label, fresh.id);
  } finally {
    dom.window.close();
  }
});

test('一键同步按钮读取仓库 JSON，并把连续新期写入页面', async () => {
  const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  const keys = ['window', 'document', 'navigator', 'location', 'fetch'];
  const savedGlobals = Object.fromEntries(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  try {
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
    globalThis.location = dom.window.location;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ draws: [fresh, ...remote] }) });
    await import(`../src/note-sync.js?click=${Date.now()}`);
    dom.window.document.getElementById('syncNow').click();
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.match(dom.window.document.getElementById('syncStatus').textContent, /已同步 1 期/);
    assert.equal(dom.window.document.getElementById('noticeLatest').textContent, fresh.id);
    assert.equal(JSON.parse(dom.window.localStorage.getItem('mark6_tool2_heat_v2')).labels.at(-1), fresh.id);
  } finally {
    dom.window.close();
    for (const k of keys) {
      if (savedGlobals[k]) Object.defineProperty(globalThis, k, savedGlobals[k]);
      else delete globalThis[k];
    }
  }
});

test('推荐、开奖、热度、锁定与输入号码按波色显示，回放/备份入口可用', async () => {
  const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  try {
    await waitForRecommendation(dom);
    const doc = dom.window.document;
    const checkWave = el => {
      const n = Number(el.textContent.trim());
      assert.ok(Number.isInteger(n) && n >= 1 && n <= 49, `号码无效：${el.textContent}`);
      const wave = NUMBER_TO_COLOR[n];
      assert.equal(el.dataset.wave, wave, `号码 ${n} 的波色标记错误`);
      assert.equal(dom.window.getComputedStyle(el).backgroundColor, WAVE_RGB[wave], `号码 ${n} 未按波色着色`);
    };
    const sample = (selector, min) => {
      const list = [...doc.querySelectorAll(selector)];
      assert.ok(list.length >= min, `${selector} 数量不足：${list.length}`);
      const picks = [...new Set([...list.slice(0, 80), ...list.slice(-20)])];
      picks.forEach(checkWave);
      return list;
    };
    sample('#latestDrawBalls .ball', 7);
    sample('#optHero .ball', 10);
    sample('#heatHighlights .ball', 1);
    const heatNumbers = sample('#heatmap .hc-number', 49);
    assert.equal(doc.querySelectorAll('#heatmap .heat-cell').length, 49);
    for (const el of heatNumbers) assert.equal(el.parentElement.dataset.wave, el.dataset.wave);

    // 热度网格：高频热号与 0 次冷号都有标记
    assert.ok(doc.querySelectorAll('#heatmap .hc-flag.hot').length >= 1, '应标记高频热号');
    assert.ok(doc.querySelectorAll('#heatmap .hc-flag.cold').length >= 1, '应标记 0 次冷号');
    assert.ok(!doc.getElementById('heatSection').querySelector('select'), '热度卡片不再有期号导航');

    // 近 30 期命中简表 & 完整历史在弹窗内
    const recentRows = doc.querySelectorAll('#historyBody tr.main-row');
    assert.equal(recentRows.length, 30);
    assert.match(doc.querySelector('#recentHistorySection h2').textContent, /近 30 期命中简表/);

    // 简表不再展示「提纯主推」列，命中概览改为按当前码数统计
    const homeHead = [...doc.querySelectorAll('#recentHistorySection thead th')].map(th => th.textContent.trim());
    assert.equal(homeHead.length, 7);
    assert.ok(!homeHead.includes('提纯主推'), '首页简表不应再有提纯主推列');
    assert.equal(recentRows[0].querySelectorAll(':scope > td').length, 7, '首页简表每行应有 7 列');
    assert.match(doc.getElementById('recentSummary').textContent, /当前10码中 \d+ 期/);

    // 展开明细的 colspan 必须与表头列数一致，否则整行错位
    doc.querySelector('#historyBody .exp-btn').click();
    const homeDetail = doc.querySelector('#historyBody tr.detail-row td');
    assert.equal(Number(homeDetail.getAttribute('colspan')), homeHead.length);
    assert.match(homeDetail.textContent, /推荐 10码/);
    doc.querySelector('#historyBody .exp-btn').click();
    sample('#historyBody .num', 70);
    assert.equal(doc.getElementById('historyModal').hidden, true);
    assert.equal(doc.querySelectorAll('#fullHistoryBody tr.main-row').length, 0);

    assert.equal(doc.querySelectorAll('.head-meta .wave-dot').length, 3);
    assert.equal(doc.querySelectorAll('#heatLegend .wave-dot').length, 3);
    for (const selector of ['.head-meta', '#heatLegend']) {
      for (const [index, key] of ['red', 'blue', 'green'].entries()) {
        const chip = doc.querySelectorAll(`${selector} .wave-dot`)[index];
        assert.equal(chip.dataset.wave, key);
        assert.equal(dom.window.getComputedStyle(chip).backgroundColor, WAVE_RGB[key]);
      }
    }

    const quick = doc.getElementById('quickPaste');
    quick.value = '01 02 03 04 05 06 07';
    quick.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const inputs = [...doc.querySelectorAll('#ballInputs .ball-input')];
    assert.deepEqual(inputs.map(x => x.dataset.wave), ['red', 'red', 'blue', 'blue', 'green', 'green', 'red']);
    for (const input of inputs) {
      const wave = NUMBER_TO_COLOR[Number(input.value)];
      assert.equal(dom.window.getComputedStyle(input).backgroundColor, WAVE_RGB[wave]);
    }

    assert.equal(doc.getElementById('deriveFold'), null, '选号依据模块应已移除');
    for (const id of ['syncNow', 'syncStatus', 'exportBtn', 'importBtn', 'importFile', 'heatmap', 'historyBody', 'lockBtn', 'lockCurrent']) {
      assert.ok(doc.getElementById(id), `缺少 ${id}`);
    }
    assert.ok(doc.getElementById('syncNow').classList.contains('sync'));

    doc.getElementById('lockBtn').click();
    const currentBalls = [...doc.querySelectorAll('#lockCurrent .lock-ball')];
    assert.equal(currentBalls.length, 10, '默认锁定 10 码');
    currentBalls.forEach(checkWave);
    assert.equal(JSON.parse(dom.window.localStorage.getItem('mark6_tool2_heat_v2')).locked.label, '2026-321');

    dom.window.noteSync.apply([fresh]);
    assert.match(doc.getElementById('lockHistoryCount').textContent, /1 条/);
    const historyBalls = [...doc.querySelectorAll('#lockHistory .lock-ball')];
    assert.ok(historyBalls.length > 0);
    historyBalls.forEach(checkWave);
    assert.equal(JSON.parse(dom.window.localStorage.getItem('mark6_tool2_heat_v2')).locks.length, 1);
  } finally {
    dom.window.close();
  }
});

test("5/7/10/12 码按三策略综合分截取、18 码为三组去重并集，复制文本为纯 ASCII 逗号格式", async () => {
  const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  try {
    await waitForRecommendation(dom);
    const doc = dom.window.document;
    const tabs = [...doc.querySelectorAll('#tierTabs .tier-btn')];
    assert.deepEqual(tabs.map(t => t.getAttribute('data-tier')), ['5', '7', '10', '12', '18']);
    // 前四档写死码数，最后一档写「并集全取」并跟上当期实际码数（不写死 18）
    assert.deepEqual(tabs.slice(0, 4).map(t => t.textContent.match(/^\d+码/)[0]), ['5码', '7码', '10码', '12码']);
    assert.match(tabs[4].textContent, /^并集全取\s*\d+码$/);

    const expect = {
      5: '13,17,26,38,46',
      7: '05,13,14,17,26,38,46',
      10: '05,13,14,17,19,20,26,37,38,46',
      12: '05,06,13,14,17,19,20,23,26,37,38,46',
      18: '04,05,06,12,13,14,17,19,20,26,29,31,37,38,39,41,46'
    };
    for (const size of [5, 7, 10, 12]) {
      doc.querySelector(`#tierTabs .tier-btn[data-tier="${size}"]`).click();
      assert.equal(doc.querySelectorAll('#optHero .pick-chip').length, size);
      const copy = doc.getElementById('copyMainBtn');
      const text = copy.getAttribute('data-copy');
      assert.equal(text, expect[size], `${size} 码复制文本错误`);
      assert.match(text, /^(?:\d{2})(?:,\d{2})*$/, '必须为两位数字 + 英文逗号');
      assert.equal(doc.querySelectorAll('#optHero .pick-chip .pick-tag').length, size, '每个号码都应有标签');
    }

    // 18 码档位 = #1∪#2∪#3 去重后的全部号码（当期有多少码就显示多少码）
    doc.querySelector('#tierTabs .tier-btn[data-tier="18"]').click();
    const unionChips = doc.querySelectorAll('#optHero .pick-chip').length;
    assert.ok(unionChips >= 12 && unionChips <= 21, `并集码数异常：${unionChips}`);
    const unionText = doc.getElementById('copyMainBtn').getAttribute('data-copy');
    assert.equal(unionText, expect[18]);
    const unionNums = unionText.split(',').map(Number);
    assert.equal(unionNums.length, unionChips, '复制文本应与并集号码一致');
    assert.deepEqual(unionNums, [...unionNums].sort((a, b) => a - b), '并集号码应升序');
    assert.equal(new Set(unionNums).size, unionNums.length, '并集号码不应重复');
    assert.match(doc.querySelector('#tierTabs .tier-btn[data-tier="18"]').textContent, new RegExp(`并集全取\\s*${unionChips}码`), '并集按钮应显示当期实际码数');
    assert.ok(!doc.querySelector('#tierTabs .tier-btn[data-tier="18"]').textContent.startsWith('18码'), '并集档位不应写死 18 码');
    assert.match(doc.getElementById('recentTierColHead').textContent, new RegExp(`当前并集（${unionChips}码）`));
    assert.match(doc.getElementById('recentSummary').textContent, /三组并集中 \d+ 期/);
    assert.match(doc.querySelector('#optHero .copy-preview').textContent, new RegExp(`三组并集共 ${unionChips} 码`));
    // 号码越多，18 码档位应包含 5 码档位的全部号码
    const unionShown = [...doc.querySelectorAll('#optHero .pick-chip .ball')].map(x => Number(x.textContent));
    assert.deepEqual(unionShown, unionNums);
    doc.querySelector('#tierTabs .tier-btn[data-tier="5"]').click();
    const five = doc.getElementById('copyMainBtn').getAttribute('data-copy').split(',').map(Number);
    for (const n of five) assert.ok(unionNums.includes(n), `${n} 应同时出现在三组并集里`);
    doc.querySelector('#tierTabs .tier-btn[data-tier="18"]').click();

    // 档位切换后锁定跟随当前档位
    doc.querySelector('#tierTabs .tier-btn[data-tier="5"]').click();
    doc.getElementById('lockBtn').click();
    assert.equal(doc.querySelectorAll('#lockCurrent .lock-ball').length, 5);
    doc.getElementById('lockBtn').click();
  } finally {
    dom.window.close();
  }
});

test('温度计随机基线、选号依据已移除、本档构成与同步时间', async () => {
  const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  try {
    await waitForRecommendation(dom);
    const doc = dom.window.document;

    // 温度计随机基线提示
    const baseline = doc.getElementById('thermoBaseline');
    assert.ok(baseline, '应有随机基线提示');
    assert.match(baseline.textContent, /14\.3%/);
    assert.match(baseline.textContent, /±12pp/);

    // 选号依据模块已整体移除，页面不再出现杀码/排除口径
    assert.equal(doc.getElementById('deriveFold'), null, '选号依据模块应已移除');
    assert.equal(doc.querySelector('#mainPickSection details#deriveFold'), null);
    const visibleText = [...doc.querySelectorAll('.page *')].map(el => el.childElementCount === 0 ? el.textContent : '').join('');
    assert.ok(!visibleText.includes('选号依据'));
    assert.ok(!visibleText.includes('杀号'));
    assert.ok(!visibleText.includes('排除'));
    assert.ok(!visibleText.includes('提纯'));

    // 本档构成提示（所有档位都显示）
    assert.ok(doc.querySelector('.pick-mix'), '当前档位应显示构成');
    assert.match(doc.querySelector('.pick-mix').textContent, /含热态 \d+/);
    assert.match(doc.querySelector('.pick-mix').textContent, /含遗漏 \d+/);
    assert.match(doc.querySelector('.pick-mix').textContent, /含周期 \d+/);
    doc.querySelector('#tierTabs .tier-btn[data-tier="18"]').click();
    assert.ok(doc.querySelector('.pick-mix'), '18 码并集档位同样显示构成');
    assert.match(doc.querySelector('#tierTabs .tier-btn[data-tier="18"]').textContent, /并集全取/);

    // 顶部同步时间
    assert.match(doc.getElementById('syncStamp').textContent, /同步于 \d{2}:\d{2}/);

    // 弹窗筛选文案已改为「仅看命中」
    assert.match(doc.querySelector('#historyOnlyHit').parentElement.textContent, /仅看命中/);
  } finally {
    dom.window.close();
  }
});

test('近 30 期温度计、连错期数与选号依据已移除', async () => {
  const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  try {
    await waitForRecommendation(dom);
    const doc = dom.window.document;
    const rows = [...doc.querySelectorAll('#thermometerList .thermo-row')];
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.ok(row.querySelector('.thermo-track .thermo-fill'), '温度计应有进度条');
      assert.match(row.querySelector('.thermo-rate').textContent, /^\d+\.\d%$/);
    }
    const rates = rows.map(r => r.querySelector('.thermo-rate').textContent);
    assert.deepEqual(rates, ['23.3%', '23.3%', '33.3%']);

    assert.match(doc.getElementById('losingStreakBadge').textContent, /当前连错 \d+ 期/);
    assert.ok(doc.getElementById('signalText').textContent.length > 6);

    assert.equal(doc.getElementById('deriveFold'), null, '推导细节模块应已移除');
    assert.equal(doc.querySelector('#historyBody tr.main-row'), doc.querySelector('#historyBody tr.main-row'), '历史表仍可渲染');
  } finally {
    dom.window.close();
  }
});

test('查看全部打开历史弹窗，含年度总表与全部历史分页', async () => {
  const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  try {
    await waitForRecommendation(dom);
    const doc = dom.window.document;
    doc.getElementById('openHistoryModal').click();
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline && !doc.querySelector('#fullHistoryBody tr.main-row')) {
      await new Promise(resolve => dom.window.setTimeout(resolve, 40));
    }
    assert.equal(doc.getElementById('historyModal').hidden, false);
    assert.equal(doc.body.classList.contains('modal-open'), true);
    assert.ok(doc.querySelectorAll('#yearlyBody tr').length >= 6);

    // 弹窗内两张表同样不再展示「提纯主推」
    const modalHead = [...doc.querySelectorAll('#historyModal table.history thead th')].map(th => th.textContent.trim());
    const yearlyHead = [...doc.querySelectorAll('#historyModal .yearly-table thead th')].map(th => th.textContent.trim());
    assert.ok(!modalHead.includes('提纯主推'), '弹窗明细表不应再有提纯主推列');
    assert.ok(!yearlyHead.some(t => t.startsWith('提纯')), '年度总表不应再有提纯主推列');
    assert.equal(modalHead.length, 7);
    assert.equal(yearlyHead.length, 7);
    const modalFirst = doc.querySelector('#fullHistoryBody tr.main-row');
    assert.equal(modalFirst.querySelectorAll(':scope > td').length, 7);
    const yearlyTotal = doc.querySelector('#yearlyBody tr.yr-total');
    assert.equal(yearlyTotal.querySelectorAll(':scope > td').length, 7);
    doc.querySelector('#fullHistoryBody .exp-btn').click();
    const modalDetail = doc.querySelector('#fullHistoryBody tr.detail-row td');
    assert.equal(Number(modalDetail.getAttribute('colspan')), 7);
    assert.ok(!modalDetail.textContent.includes('提纯'));
    doc.querySelector('#fullHistoryBody .exp-btn').click();

    // 底部说明不再带版本号
    // 搜索无结果时空态 colspan 必须与表头列数一致（曾有写死 8 的问题）
    const search = doc.getElementById('historySearch');
    search.value = '9999-999';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 260));
    const emptyCell = doc.querySelector('#fullHistoryBody td');
    assert.equal(Number(emptyCell.getAttribute('colspan')), modalHead.length, '空态 colspan 应与表头列数一致');
    search.value = '';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 260));

    const foot = doc.querySelector('.foot-note');
    assert.ok(!/v\d{4}\.\d{2}\.\d{2}/.test(foot.textContent), '底部不应再显示构建版本号');
    assert.ok(foot.textContent.includes('仅供历史数据统计参考'));
    assert.equal(doc.querySelectorAll('#fullHistoryBody tr.main-row').length, 120);
    assert.match(doc.getElementById('modalTotalBadge').textContent, /1780/);
    assert.match(doc.getElementById('modalMoreBar').textContent, /已显示 120 \/ 1780 期/);

    doc.getElementById('modalLoadAll').click();
    assert.equal(doc.querySelectorAll('#fullHistoryBody tr.main-row').length, 1780);
    assert.match(doc.getElementById('modalMoreBar').textContent, /已显示全部 1780 期/);

    doc.getElementById('closeHistoryModal').click();
    assert.equal(doc.getElementById('historyModal').hidden, true);
    assert.equal(doc.body.classList.contains('modal-open'), false);
  } finally {
    dom.window.close();
  }
});
