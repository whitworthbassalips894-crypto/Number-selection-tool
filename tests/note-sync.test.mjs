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
  year: 2026, periodNum: 327, date: '2026-11-23',
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
  assert.throws(() => planSync(local, changed), /不一致/);

  const gap = normalizeDrawRecord({
    year: 2026, periodNum: 328, date: '2026-11-24',
    numbers: [8, 9, 10, 11, 12, 13], special: 14
  });
  assert.throws(() => planSync(local, [gap, ...remote]), /不连续/);
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
    assert.equal(doc.getElementById('nextTargetHead').textContent, '2026-328');
    assert.equal(doc.getElementById('totalCount').textContent, '1787');
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
    assert.match(dom.window.document.getElementById('syncStatus').textContent, /已从仓库同步 1 期/);
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
    assert.match(doc.getElementById('recentSummary').textContent, /最近 30 期 · 10码中 \d+ 期/);

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
    assert.equal(JSON.parse(dom.window.localStorage.getItem('mark6_tool2_heat_v2')).locked.label, '2026-327');

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

test("5/7/10/12 码按三策略综合分截取、18 码为三组去重并集，复制文本为中文逗号格式", async () => {
  const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  try {
    await waitForRecommendation(dom);
    const doc = dom.window.document;
    const tabs = [...doc.querySelectorAll('#tierTabs .tier-btn')];
    assert.deepEqual(tabs.map(t => t.getAttribute('data-tier')), ['5', '7', '10', '12', '18']);
    // 前四档写死码数，最后一档写「并集全取」并跟上当期实际码数（不写死 18）
    assert.deepEqual(tabs.slice(0, 4).map(t => t.textContent.match(/^\d+码/)[0]), ['5码', '7码', '10码', '12码']);
    assert.match(tabs[4].textContent, /^并集全取\s*\d+码$/);

    // [2026-11-23] 修正大小均衡项符号 bug 后的基准；并集档 = 综合前 12 ∪ 三组去重
    const expect = {
      5: '03，05，26，38，46',
      7: '02，03，05，26，38，43，46',
      10: '02，03，05，19，21，26，38，43，46，47',
      12: '02，03，05，15，19，21，23，26，38，43，46，47',
      18: '01，02，03，04，05，06，15，19，21，22，23，26，29，37，38，39，43，46，47'
    };
    for (const size of [5, 7, 10, 12]) {
      doc.querySelector(`#tierTabs .tier-btn[data-tier="${size}"]`).click();
      assert.equal(doc.querySelectorAll('#optHero .pick-chip').length, size);
      const copy = doc.getElementById('copyMainBtn');
      const text = copy.getAttribute('data-copy');
      assert.equal(text, expect[size], `${size} 码复制文本错误`);
      assert.match(text, /^(?:\d{2})(?:，\d{2})*$/, '必须为两位数字 + 中文逗号');
      assert.ok(!text.includes(','), '不应包含英文逗号');
      assert.equal(doc.querySelectorAll('#optHero .pick-chip .pick-tag').length, size, '每个号码都应有标签');
    }

    // 18 码档位 = #1∪#2∪#3 去重后的全部号码（当期有多少码就显示多少码）
    doc.querySelector('#tierTabs .tier-btn[data-tier="18"]').click();
    const unionChips = doc.querySelectorAll('#optHero .pick-chip').length;
    assert.ok(unionChips >= 12 && unionChips <= 21, `并集码数异常：${unionChips}`);
    const unionText = doc.getElementById('copyMainBtn').getAttribute('data-copy');
    assert.equal(unionText, expect[18]);
    const unionNums = unionText.split('，').map(Number);
    assert.equal(unionNums.length, unionChips, '复制文本应与并集号码一致');
    assert.deepEqual(unionNums, [...unionNums].sort((a, b) => a - b), '并集号码应升序');
    assert.equal(new Set(unionNums).size, unionNums.length, '并集号码不应重复');
    assert.match(doc.querySelector('#tierTabs .tier-btn[data-tier="18"]').textContent, new RegExp(`并集全取\\s*${unionChips}码`), '并集按钮应显示当期实际码数');
    assert.ok(!doc.querySelector('#tierTabs .tier-btn[data-tier="18"]').textContent.startsWith('18码'), '并集档位不应写死 18 码');
    assert.match(doc.getElementById('recentTierColHead').textContent, new RegExp(`当前并集（${unionChips}码）`));
    assert.match(doc.getElementById('recentSummary').textContent, /并集全取中 \d+ 期/);
    assert.match(doc.querySelector('#optHero .copy-preview').textContent, new RegExp(`三组并集共 ${unionChips} 码`));
    // 号码越多，18 码档位应包含 5 码档位的全部号码
    const unionShown = [...doc.querySelectorAll('#optHero .pick-chip .ball')].map(x => Number(x.textContent));
    assert.deepEqual(unionShown, unionNums);
    doc.querySelector('#tierTabs .tier-btn[data-tier="5"]').click();
    const five = doc.getElementById('copyMainBtn').getAttribute('data-copy').split('，').map(Number);
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
    // 基线文案随档位动态生成：必须给出「当前档位覆盖率」与「95% 正常区间」
    assert.match(baseline.textContent, /本表三组各 7 码：单组随机基线 14\.3%/);
    assert.match(baseline.textContent, /当前主推档位「10码」覆盖 10\/49/);
    assert.match(baseline.textContent, /都算正常波动/);

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
    assert.match(doc.querySelector('.pick-mix').textContent, /热态 \d+/);
    assert.match(doc.querySelector('.pick-mix').textContent, /遗漏 \d+/);
    assert.match(doc.querySelector('.pick-mix').textContent, /周期 \d+/);
    doc.querySelector('#tierTabs .tier-btn[data-tier="18"]').click();
    assert.ok(doc.querySelector('.pick-mix'), '18 码并集档位同样显示构成');
    assert.match(doc.querySelector('#tierTabs .tier-btn[data-tier="18"]').textContent, /并集全取/);

    // 顶部同步时间
    assert.match(doc.getElementById('syncStamp').textContent, /本地校验于 \d{2}:\d{2}/);

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
    // [2026-11-23] 符号 bug 修正后基准
    assert.deepEqual(rates, ['23.3%', '20.0%', '23.3%']);

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
    assert.match(doc.getElementById('modalTotalBadge').textContent, /1786/);
    assert.match(doc.getElementById('modalMoreBar').textContent, /已显示 120 \/ 1786 期/);

    doc.getElementById('modalLoadAll').click();
    assert.equal(doc.querySelectorAll('#fullHistoryBody tr.main-row').length, 1786);
    assert.match(doc.getElementById('modalMoreBar').textContent, /已显示全部 1786 期/);

    doc.getElementById('closeHistoryModal').click();
    assert.equal(doc.getElementById('historyModal').hidden, true);
    assert.equal(doc.body.classList.contains('modal-open'), false);
  } finally {
    dom.window.close();
  }
});

test('三策略号码模块默认折叠，展开后展示 #1/#2/#3 各 7 码并可分组复制', async () => {
  const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  try {
    await waitForRecommendation(dom);
    const doc = dom.window.document;

    const section = doc.getElementById('strategySection');
    assert.ok(section, '应有三策略号码模块');
    const fold = doc.getElementById('strategyFold');
    assert.ok(fold && fold.tagName === 'DETAILS', '模块应为可展开的 details');
    assert.equal(fold.open, false, '默认应为折叠状态');

    // 模块顺序：紧跟主推卡片、在热度分布之前
    const order = [...doc.querySelectorAll('.page > section.card')].map(s => s.id);
    assert.ok(order.indexOf('strategySection') === order.indexOf('mainPickSection') + 1, '应紧跟在主推卡片之后');
    assert.ok(order.indexOf('strategySection') < order.indexOf('heatSection'), '应在热度分布之前');

    // 折叠时也给出三组码数摘要
    assert.match(doc.getElementById('strategySummaryHint').textContent, /#1 7码 · #2 7码 · #3 7码/);

    // 主推「并集全取」档位号码 = 三组去重并集，模块里的分组码应与之一致
    const items = [...doc.querySelectorAll('#strategyBody .strategy-item')];
    assert.equal(items.length, 3, '应展示三组策略号码');
    const groupNums = [];
    for (const [index, key] of ['hot', 'cold', 'cycle'].entries()) {
      const item = items[index];
      assert.equal(item.dataset.strategy, key);
      const balls = [...item.querySelectorAll('.strategy-balls .ball')];
      assert.equal(balls.length, 7, `第 ${index + 1} 组应有 7 码`);
      const nums = balls.map(b => Number(b.textContent));
      assert.equal(new Set(nums).size, 7, '同组内不应重复');
      for (const ball of balls) {
        const n = Number(ball.textContent);
        assert.equal(ball.dataset.wave, NUMBER_TO_COLOR[n], '号码应按波色标记');
      }
      assert.deepEqual(nums, [...nums].sort((a, b) => a - b), '同组号码应升序');
      const copy = item.querySelector('button[data-copy]');
      assert.match(copy.getAttribute('data-copy'), /^(?:\d{2})(?:，\d{2}){6}$/, '复制文本应为中文逗号分隔的 7 个两位数字');
      groupNums.push(nums);
    }

    const union = [...new Set(groupNums.flat())].sort((a, b) => a - b);
    doc.querySelector('#tierTabs .tier-btn[data-tier="18"]').click();
    const unionText = doc.getElementById('copyMainBtn').getAttribute('data-copy').split('，').map(Number);
    assert.deepEqual(unionText, union, '并集档位应与三组去重并集一致');

    // 展开后能看到 21 个号码
    fold.open = true;
    assert.equal(fold.open, true);
    assert.equal(doc.querySelectorAll('#strategyFold[open] #strategyBody .strategy-balls .ball').length, 21);
    assert.match(doc.querySelector('#strategyBody .strategy-note:last-child').textContent, new RegExp(`共 ${union.length} 个号码`));
  } finally {
    dom.window.close();
  }
});

test('档位严格包含：并集档必须包含 5/7/10/12 码档的全部号码', async () => {
  const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  try {
    await waitForRecommendation(dom);
    const doc = dom.window.document;
    const picksOf = (size) => {
      doc.querySelector(`#tierTabs .tier-btn[data-tier="${size}"]`).click();
      return doc.getElementById('copyMainBtn').getAttribute('data-copy').split('，').map(Number);
    };
    const five = picksOf(5);
    const seven = picksOf(7);
    const ten = picksOf(10);
    const twelve = picksOf(12);
    const union = picksOf(18);
    for (const [small, big, name] of [[five, seven, '5⊂7'], [seven, ten, '7⊂10'], [ten, twelve, '10⊂12'], [twelve, union, '12⊂并集']]) {
      for (const n of small) assert.ok(big.includes(n), `${name} 被破坏：${n} 不在大档位里`);
    }
    assert.equal(new Set(union).size, union.length, '并集档不应有重复号码');
    assert.equal(doc.querySelector('#tierTabs .tier-btn[data-tier="18"]').textContent.trim(), `并集全取 ${union.length}码`);
  } finally {
    dom.window.close();
  }
});

test('主推卡片给出成本/覆盖/期望，并说明回报率与选号无关', async () => {
  const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  try {
    await waitForRecommendation(dom);
    const doc = dom.window.document;
    const cost = doc.querySelector('#optHero .pick-cost');
    assert.ok(cost, '主推卡片应有成本行');
    assert.match(cost.textContent, /\d+ 注/);
    assert.match(cost.textContent, /覆盖 \d+\/49（\d+\.\d%）/);
    assert.match(cost.textContent, /每期投入 ¥\d+/);
    assert.match(cost.textContent, /期望净亏 ¥\d+\.\d{2}/);
    assert.match(cost.textContent, /回报率 97\.96%/);
    assert.ok(cost.querySelector('.cost-neg'), '期望净亏应高亮为负值');
    // 切档后成本行同步更新
    doc.querySelector('#tierTabs .tier-btn[data-tier="5"]').click();
    const costText5 = doc.querySelector('#optHero .pick-cost').textContent.replace(/\s+/g, ' ');
    assert.match(costText5, /5 注 · 覆盖 5\/49（10\.2%） · 每期投入 ¥5/);
  } finally {
    dom.window.close();
  }
});

test('连错与温度计都按当前档位的随机基线表达，不再给「建议参考」', async () => {
  const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  try {
    await waitForRecommendation(dom);
    const doc = dom.window.document;
    assert.match(doc.getElementById('losingStreakBadge').textContent, /当前连错 \d+ 期 · 随机下约 \d+% 概率/);
    const signal = doc.getElementById('signalText').textContent;
    assert.match(signal, /随机基线 \d+\.\d% · 95% 正常区间/);
    assert.match(signal, /z=\d+\.\d{2}/);
    assert.doesNotMatch(signal, /可优先参考|建议谨慎参考|建议小额参考/);
    // 阈值随档位浮动：5 码档不应因为命中率天然偏低就永远标「偏冷」
    const tags5 = () => [...doc.querySelectorAll('#thermometerList .temp-tag')].map(el => el.textContent);
    assert.deepEqual(tags5(), [...tags5()]);
    for (const tag of tags5()) assert.ok(['偏冷', '正常', '偏热'].includes(tag));
    assert.match(doc.getElementById('thermoBaseline').textContent, /当前主推档位「10码」覆盖 10\/49/);
    doc.querySelector('#tierTabs .tier-btn[data-tier="5"]').click();
    assert.match(doc.getElementById('thermoBaseline').textContent, /当前主推档位「5码」覆盖 5\/49/);
  } finally {
    dom.window.close();
  }
});

test('简表给出汇总行，未中改为浅灰点而不是满屏减号', async () => {
  const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  try {
    await waitForRecommendation(dom);
    const doc = dom.window.document;
    const stats = doc.getElementById('recentStats');
    assert.match(stats.textContent, /命中 \d+ \/ 30 期/);
    assert.match(stats.textContent, /最长连错 \d+ 期/);
    assert.match(stats.textContent, /累计 \d+ 注/);
    assert.match(stats.textContent, /随机基线 \d+~\d+ 期（95%）/);
    assert.equal(doc.querySelectorAll('#historyBody .miss-dash').length, 0, '不应再用减号表示未中');
    assert.ok(doc.querySelectorAll('#historyBody .miss-dot').length > 0, '未中应渲染为浅灰点');
  } finally {
    dom.window.close();
  }
});

test('术语说明弹窗可打开、可关闭，并解释页面上出现的黑话', async () => {
  const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  try {
    await waitForRecommendation(dom);
    const doc = dom.window.document;
    const modal = doc.getElementById('glossaryModal');
    assert.equal(modal.hidden, true);
    doc.querySelector('#optHero .glossary-btn').click();
    assert.equal(modal.hidden, false);
    assert.equal(doc.body.classList.contains('modal-open'), true);
    for (const term of ['特码', '双策共振', '综合分', '并集全取', '当前连错 N 期', '期望净亏', '底库 / 同步']) {
      assert.ok(modal.textContent.includes(term), `术语说明应包含「${term}」`);
    }
    doc.getElementById('closeGlossaryModal').click();
    assert.equal(modal.hidden, true);
    assert.equal(doc.body.classList.contains('modal-open'), false);
    // Esc 同样可关闭
    doc.querySelector('#optHero .glossary-btn').click();
    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(modal.hidden, true);
  } finally {
    dom.window.close();
  }
});

test('导出说明写明不含内置底库，导出文件带上底库版本信息', async () => {
  const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  try {
    await waitForRecommendation(dom);
    const doc = dom.window.document;
    const note = doc.querySelector('.backup-note').textContent.replace(/\s+/g, ' ');
    assert.match(note, /内置底库（\d{4}-\d{3} \/ \d+ 期）随页面一起更新，不需要导出/);
    assert.match(note, /只保存你手动补录\/同步到本机的期次与锁定快照/);
    assert.match(doc.getElementById('backupDbInfo').textContent, /^\d{4}-\d{3} \/ \d+ 期$/);
    assert.equal(doc.getElementById('exportBtn').textContent.trim(), '导出本机记录');
    assert.match(doc.getElementById('exportBtn').title, /不含随页面下发的内置底库/);
  } finally {
    dom.window.close();
  }
});

test('一键同步三态可区分：进行中 / 无新数据 / 失败，且都不会写坏数据', async () => {
  const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  const keys = ['window', 'document', 'navigator', 'location', 'fetch'];
  const savedGlobals = Object.fromEntries(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  try {
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
    globalThis.location = dom.window.location;
    const doc = dom.window.document;

    // 1) 进行中：fetch 挂起，按钮应进入 busy 态并给出「正在检查」
    // 进行中：第一次请求挂起，放行后返回「已同步 1 期」，避免再落到上游分支
    let release;
    globalThis.fetch = () => new Promise(resolve => {
      release = () => resolve({ ok: true, json: async () => ({ draws: [fresh, ...remote] }) });
    });
    await import(`../src/note-sync.js?states=${Date.now()}`);
    doc.getElementById('syncNow').click();
    await new Promise(r => setTimeout(r, 20));
    const status = doc.getElementById('syncStatus');
    assert.equal(status.dataset.state, 'pending');
    assert.match(status.textContent, /正在检查最新开奖…/);
    assert.equal(doc.getElementById('syncNow').classList.contains('is-busy'), true);
    assert.equal(doc.getElementById('syncNow').getAttribute('aria-busy'), 'true');
    release();
    await new Promise(r => setTimeout(r, 80));
    assert.equal(status.dataset.state, 'ok');
    assert.match(status.textContent, /已从仓库同步 1 期/);
    assert.equal(doc.getElementById('syncNow').getAttribute('aria-busy'), 'false');

    // 2) 无新数据：明确写「不是失败」，而不是假装成功
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ draws: remote }) });
    doc.getElementById('syncNow').click();
    await new Promise(r => setTimeout(r, 40));
    assert.equal(status.dataset.state, 'warn');
    assert.match(status.textContent, /没有更新的期次/);
    assert.match(status.textContent, /不是失败/);

    // 3) 失败：红色状态 + 人话解释，不能静默
    globalThis.fetch = async () => { throw new Error('offline'); };
    doc.getElementById('syncNow').click();
    await new Promise(r => setTimeout(r, 40));
    assert.equal(status.dataset.state, 'error');
    assert.match(status.textContent, /同步失败/);
    // 失败不能写坏数据：本机仍只有前面那一条正常同步
    assert.equal(JSON.parse(dom.window.localStorage.getItem('mark6_tool2_heat_v2')).labels.length, 1);
  } finally {
    dom.window.close();
    for (const k of keys) {
      if (savedGlobals[k]) Object.defineProperty(globalThis, k, savedGlobals[k]);
      else delete globalThis[k];
    }
  }
});

test('底库为空时不崩溃，三个模块都给出「状态 + 原因 + 下一步」', async () => {
  const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  try {
    await waitForRecommendation(dom);
    const doc = dom.window.document;
    assert.doesNotThrow(() => {
      dom.window.eval('BASE_RECORDS.length = 0; manualRecords = []; planCache.clear(); refreshAll();');
    }, '空库时 refreshAll 不应抛错（曾因 expectedNextLabel 读取 undefined.label 崩溃）');
    for (const sel of ['#optHero .empty-state', '#thermometerList .empty-state', '#strategyBody .empty-state']) {
      const box = doc.querySelector(sel);
      assert.ok(box, `${sel} 应有统一空态`);
      assert.ok(box.querySelector('.empty-state-title'), '空态需要标题');
      assert.ok(box.querySelector('.empty-state-reason'), '空态需要原因');
    }
    const actions = [...doc.querySelectorAll('button[data-empty-action]')];
    assert.equal(actions.length, 3, '三个空态各应有一个下一步按钮');
    for (const btn of actions) assert.equal(btn.getAttribute('data-empty-action'), 'sync');
    assert.match(doc.getElementById('signalText').textContent, /先点「一键同步」/);
    assert.match(doc.querySelector('.latest-period-line').textContent, /第 — 期/);
  } finally {
    dom.window.close();
  }
});
