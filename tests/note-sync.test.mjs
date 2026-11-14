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
const local = data.map(r => ({label: `${r[0]}-${String(r[1]).padStart(3,'0')}`, year: r[0], periodNum: r[1], raw7: r.slice(2), usable: new Set(r.slice(2)).size === 7}));
const remote = JSON.parse(fs.readFileSync('data/draws.json')).draws.map(normalizeDrawRecord);
const expected = planSync(local, remote).map(d => d.id);
const WAVE_HEX = {red: '#e54b4b', blue: '#3b82f6', green: '#10a878'};
const WAVE_RGB = Object.fromEntries(Object.entries(WAVE_HEX).map(([key, hex]) => {
  const value = hex.slice(1);
  return [key, `rgb(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)})`];
}));

async function waitForRecommendation(dom) {
  const deadline = Date.now() + 12000;
  const rendered = () => dom.window.document.querySelectorAll('#mainBalls .ball').length >= 5;
  while (Date.now() < deadline) {
    if (rendered()) return;
    await new Promise(resolve => dom.window.setTimeout(resolve, 25));
  }
  if (rendered()) return;
  throw new Error('推荐号码未在预期时间内生成');
}

test('附件底库与仓库同步，连续追加最新开奖', () => {
  const rows = planSync(local, remote);
  assert.deepEqual(rows.map(d => d.id), expected);
  assert.ok(expected.length > 0, '仓库底库应比附件内置底库更新');
  assert.throws(() => planSync(local, remote.filter(d => d.id !== expected[0])), /缺口/);
  const lastLocalId = local.at(-1).label;
  const lastLocal = remote.find(d => d.id === lastLocalId);
  assert.ok(lastLocal, `仓库底库应包含 ${lastLocalId}`);
  const alternate = Array.from({length: 49}, (_, i) => i + 1)
    .find(n => n !== lastLocal.special && !lastLocal.numbers.includes(n));
  const changed = remote.map(d => d.id === lastLocalId ? {...d, special: alternate} : d);
  assert.throws(() => planSync(local, changed), /冲突/);
});

test('新页面启动并保存同步数据', async () => {
  const dom = new JSDOM(html, {url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true});
  try {
    const doc = dom.window.document;
    assert.ok(dom.window.noteSync);
    assert.match(doc.getElementById('syncNow').textContent, /一键同步/);
    assert.ok(doc.getElementById('syncStatus'));
    assert.equal(doc.querySelector('.signal-rules'), null);
    assert.ok(!doc.body.textContent.includes('选号与补位规则'));
    const rows = planSync(dom.window.noteSync.records(), remote);
    assert.deepEqual(rows.map(d => d.id), expected);
    dom.window.noteSync.apply(rows);
    const saved = JSON.parse(dom.window.localStorage.getItem('number_note_combined_v1'));
    assert.equal(saved.labels.length, expected.length);
    if (expected.length) assert.equal(saved.labels.at(-1), expected.at(-1));
  } finally {
    dom.window.close();
  }
});

test('推荐、信号、开奖与热度号码按波色显示', async () => {
  const dom = new JSDOM(html, {url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true});
  try {
    await waitForRecommendation(dom);
    const doc = dom.window.document;
    assert.equal(doc.querySelectorAll('#mainBalls .ball').length, 5);
    assert.equal(doc.querySelectorAll('#backupBalls .ball').length, 7);
    assert.equal(doc.querySelectorAll('.signal-ball').length, 12);
    const hint = doc.getElementById('allocationHint').textContent;
    assert.ok(hint.includes('波色'));
    assert.ok(hint.includes('分配'));
    assert.ok(hint.includes('→'));
    assert.ok(doc.getElementById('syncNow').classList.contains('sync'));
    assert.equal(doc.querySelectorAll('#recommendation .card-head .wave-dot').length, 3);
    assert.equal(doc.querySelectorAll('#heatLegend .wave-dot').length, 3);

    const balls = [
      ...doc.querySelectorAll('#mainBalls .ball, #backupBalls .ball, .signal-ball, .draw-num, .special-ball, .small-ball, .detail-num, .result-badge, .lock-ball, .hc-number')
    ];
    assert.ok(balls.length > 0, '页面应展示波色号码');
    for (const ball of balls) {
      const n = Number(ball.textContent.trim());
      assert.ok(Number.isInteger(n) && n >= 1 && n <= 49, `号码无效：${ball.textContent}`);
      const wave = NUMBER_TO_COLOR[n];
      assert.equal(ball.dataset.wave, wave, `号码 ${n} 的波色标记错误`);
      assert.equal(dom.window.getComputedStyle(ball).backgroundColor, WAVE_RGB[wave], `号码 ${n} 未按波色着色`);
    }

    const heatNumbers = [...doc.querySelectorAll('#heatGrid .hc-number')];
    assert.ok(heatNumbers.length > 0, '热度格号码本体应按波色显示');
    for (const el of heatNumbers) {
      const n = Number(el.textContent.trim());
      const wave = NUMBER_TO_COLOR[n];
      assert.ok(['red', 'blue', 'green'].includes(wave));
      assert.equal(el.dataset.wave, wave, `热度号码 ${n} 的波色标记错误`);
      assert.equal(el.parentElement.dataset.wave, wave, `热度格 ${n} 的波色标记错误`);
      assert.equal(dom.window.getComputedStyle(el).backgroundColor, WAVE_RGB[wave], `热度号码 ${n} 未按波色着色`);
    }
    for (const [index, key] of ['red', 'blue', 'green'].entries()) {
      const chip = doc.querySelectorAll('#heatLegend .wave-dot')[index];
      assert.equal(dom.window.getComputedStyle(chip).backgroundColor, WAVE_RGB[key]);
    }
  } finally {
    dom.window.close();
  }
});
