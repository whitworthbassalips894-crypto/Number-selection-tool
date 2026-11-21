import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

test('特码开奖列表与三中三历史筛选、命中展示及数据更新', async () => {
  const dom = new JSDOM(`<div id="specialDrawList"></div><button id="specialMore"></button><button id="pick3Start"></button><div id="pick3Status"></div><div id="pick3Summary"></div><select id="pick3Year"><option value="ALL">全部</option></select><input id="pick3Search"><input type="checkbox" id="pick3OnlyHit"><table><tbody id="pick3Body"></tbody></table><button id="pick3More"></button>`, { url: 'https://example.com/' });
  const saved = Object.fromEntries(['window', 'document', 'Worker'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const d = { year: 2026, periodNum: 1, label: '2026-001', date: '2026-01-01', numbers: [1,2,3,4,5,6], special: 7 };
  let draws = [d], instances = [];
  class FakeWorker {
    constructor() { instances.push(this); }
    postMessage({ requestId }) { this.onmessage({ data: { requestId, rows: [{ draw: d, five: [{ code: '#1', numbers: [1,2,3], isWin: true }] }], done: 1, total: 1 } }); }
    terminate() {}
  }
  try {
    globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.Worker = FakeWorker;
    dom.window.getHistoryDraws = () => draws;
    await import(`../src/history-panel.js?test=${Date.now()}`);
    assert.match(document.querySelector('#specialDrawList').textContent, /2026-001.*07/);
    document.querySelector('#pick3Start').click();
    assert.match(document.querySelector('#pick3Summary').textContent, /命中 1 期/);
    assert.match(document.querySelector('#pick3Body').textContent, /01 · 02 · 03/);
    document.querySelector('#pick3Search').value = '2025';
    document.querySelector('#pick3Search').dispatchEvent(new dom.window.Event('input'));
    assert.match(document.querySelector('#pick3Body').textContent, /暂无符合条件/);
    dom.window.dispatchEvent(new dom.window.Event('history-data-change'));
    assert.equal(instances.length, 1);
    draws = [{ ...d, periodNum: 2, label: '2026-002', special: 8 }];
    dom.window.dispatchEvent(new dom.window.Event('history-data-change'));
    assert.equal(instances.length, 2);
    assert.match(document.querySelector('#specialDrawList').textContent, /2026-002.*08/);
  } finally {
    for (const [k, descriptor] of Object.entries(saved)) descriptor ? Object.defineProperty(globalThis, k, descriptor) : delete globalThis[k];
    dom.window.close();
  }
});
