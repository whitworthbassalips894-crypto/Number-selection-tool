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
  year: 2026, periodNum: 320, date: '2026-11-16',
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
    year: 2026, periodNum: 321, date: '2026-11-17',
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
    assert.equal(doc.getElementById('nextTargetHead').textContent, '2026-321');
    assert.equal(doc.getElementById('totalCount').textContent, '1780');
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
    sample('#optHero .ball', 1);
    sample('#tool2Panels .ball', 21);
    sample('#tool2Summary .ball', 1);
    sample('#deltaBoard .ball', 1);
    const heatNumbers = sample('#heatmap .hc-number', 49);
    assert.equal(doc.querySelectorAll('#heatmap .heat-cell').length, 49);
    for (const el of heatNumbers) assert.equal(el.parentElement.dataset.wave, el.dataset.wave);
    sample('#historyBody .num', 3500);

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

    assert.equal(doc.querySelectorAll('#tool2Panels .panel').length, 3);
    assert.equal(doc.querySelectorAll('#yearlyBody tr').length, 6);
    assert.equal(doc.querySelectorAll('#historyBody tr.main-row').length, 500);
    for (const id of ['syncNow', 'syncStatus', 'exportBtn', 'importBtn', 'importFile', 'deltaSelect', 'deltaPrev', 'deltaNext', 'deltaLatest', 'heatmap', 'yearlyBody', 'historyBody']) {
      assert.ok(doc.getElementById(id), `缺少 ${id}`);
    }
    assert.ok(doc.getElementById('syncNow').classList.contains('sync'));

    doc.getElementById('lockBtn').click();
    assert.equal(doc.getElementById('lockTitle').textContent, '本期号码已锁定');
    const currentBalls = [...doc.querySelectorAll('#lockCurrent .lock-ball')];
    assert.ok(currentBalls.length > 0);
    currentBalls.forEach(checkWave);
    assert.equal(JSON.parse(dom.window.localStorage.getItem('mark6_tool2_heat_v2')).locked.label, '2026-320');

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
