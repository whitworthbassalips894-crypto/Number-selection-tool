import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import INITIAL_DB from '../data/draws.js';
import { nextPeriodMeta } from '../src/periods.js';
import { isUsableDraw } from '../src/audit.js';
import { sixTierPlan } from '../src/six-tier.js';

test('六档页面启动、排序、录入、年份筛选、热度与同步', async () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const dom = new JSDOM(html, {url:'https://example.com/Number-selection-tool/', pretendToBeVisual:true});
  const keys = ['window','document','navigator','location','Worker','fetch'];
  const saved = Object.fromEntries(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis,k)]));
  let copied = '';
  let sent = null;
  class FakeWorker {
    postMessage({draws}) {
      sent = draws;
      setTimeout(() => this.onmessage?.({data:{type:'done',records:draws.map((d,i)=>({id:d.id,spRank:i%49+1}))}}),0);
    }
    terminate() {}
  }
  try {
    globalThis.window = dom.window; globalThis.document = dom.window.document;
    Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
    globalThis.location = dom.window.location; globalThis.Worker = FakeWorker;
    Object.defineProperty(dom.window.navigator,'clipboard',{value:{writeText:async value => {copied=value;}},configurable:true});
    dom.window.__SKIP_AUTO_SYNC__ = true;
    await import(`../src/six-tier-app.js?test=${Date.now()}`);
    const doc = dom.window.document;
    const style = doc.createElement('style');
    style.textContent = fs.readFileSync('assets/six-tier.css', 'utf8');
    doc.head.append(style);
    assert.equal(dom.window.__APP_BOOTED__, true);
    assert.equal(doc.querySelectorAll('.tier-tab').length, 6);
    assert.match(doc.querySelector('.tier-tab.active').textContent, /8码/);
    const next = nextPeriodMeta(INITIAL_DB.draws[0]);
    const nextId = `${next.year}-${next.period}`;
    const subsequent = nextPeriodMeta(next);
    const subsequentId = `${subsequent.year}-${subsequent.period}`;
    const plan = sixTierPlan(INITIAL_DB.draws, next);
    assert.deepEqual([...doc.querySelectorAll('#tierHero .ball')].map(x=>Number(x.textContent)), plan.ranked.slice(0,8).sort((a,b)=>a-b));
    doc.querySelector('[data-order="rank"]').click();
    assert.deepEqual([...doc.querySelectorAll('#tierHero .ball')].map(x=>Number(x.textContent)), plan.ranked.slice(0,8));
    doc.querySelector('#tierHero button[data-copy]').click(); await Promise.resolve();
    assert.equal(copied, plan.ranked.slice(0,8).sort((a,b)=>a-b).map(n=>String(n).padStart(2,'0')).join(' '));
    assert.equal(doc.querySelector('details.heat-fold').open, false);
    assert.equal(doc.querySelectorAll('#heatmap .heat-cell').length, 49);
    doc.querySelector('[data-scope="all7"]').click();
    assert.ok([...doc.querySelectorAll('#heatmap small')].some(el=>parseInt(el.textContent)>5));
    await new Promise(r => setTimeout(r, 160));
    assert.equal(sent.length, INITIAL_DB.draws.filter(isUsableDraw).length);
    assert.equal(doc.querySelectorAll('#yearlyBody tr').length, new Set(sent.map(d => d.year)).size + 1);
    const totalRow = doc.querySelector('#yearlyBody tr[data-yr="ALL"]');
    const expectedHits = sent.filter((d,i) => i % 49 + 1 <= 3).length;
    assert.match(totalRow.cells[2].textContent, new RegExp(`${expectedHits}/${sent.length}`));
    assert.equal(totalRow.cells[2].querySelector('.rate-main').textContent, `${(expectedHits / sent.length * 100).toFixed(1)}%`);
    assert.equal(doc.querySelectorAll('#historyBody tr').length, 81);
    doc.querySelector('#yearlyBody tr[data-yr="2025"]').click();
    assert.match(doc.querySelector('#historyBody tr').textContent, /2025-/);
    doc.querySelector('#loadMoreHist').click();
    assert.equal(doc.querySelectorAll('#historyBody tr').length, 201);
    // 手动输入、补零、自动跳格与退格回退。
    const slots = [...doc.querySelectorAll('#ballInputs input')];
    const input = (slot, value) => { slot.value = value; slot.dispatchEvent(new dom.window.Event('input', { bubbles:true })); };
    const key = (slot, value) => slot.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key:value, bubbles:true, cancelable:true }));
    assert.equal(slots.length, 7);
    assert.equal(dom.window.getComputedStyle(slots[6]).backgroundColor, 'rgb(255, 255, 255)');
    slots[0].focus(); input(slots[0], '1');
    assert.equal(slots[0].dataset.wave, 'red');
    assert.equal(dom.window.getComputedStyle(slots[0]).backgroundColor, 'rgb(229, 75, 75)');
    slots[1].focus();
    assert.equal(slots[0].value, '01');
    slots[0].focus(); input(slots[0], '5');
    assert.equal(slots[0].value, '05');
    assert.equal(doc.activeElement, slots[1]);
    assert.equal(dom.window.getComputedStyle(slots[0]).backgroundColor, 'rgb(16, 168, 120)');
    input(slots[1], '03');
    assert.equal(doc.activeElement, slots[2]);
    assert.equal(dom.window.getComputedStyle(slots[1]).backgroundColor, 'rgb(59, 130, 246)');
    key(slots[2], 'Backspace'); assert.equal(doc.activeElement, slots[1]);
    slots[2].focus(); input(slots[2], '4'); key(slots[2], ' ');
    assert.equal(slots[2].value, '04'); assert.equal(doc.activeElement, slots[3]);
    input(slots[3], '2'); key(slots[3], ',');
    assert.equal(slots[3].value, '02'); assert.equal(doc.activeElement, slots[4]);
    input(slots[4], '50'); assert.equal(slots[4].dataset.wave, undefined);
    input(slots[4], ''); assert.equal(dom.window.getComputedStyle(slots[4]).backgroundColor, 'rgb(255, 255, 255)');

    // 任意球位粘贴完整开奖，七球都补零并设置波色；异常粘贴不改变现有号码。
    const paste = (target, text) => {
      const event = new dom.window.Event('paste', { bubbles:true, cancelable:true });
      Object.defineProperty(event, 'clipboardData', { value:{ getData: () => text } });
      target.dispatchEvent(event); return event;
    };
    assert.equal(paste(slots[4], '1, 3, 5, 7, 9, 11 + 49').defaultPrevented, true);
    assert.deepEqual(slots.map(x => x.value), ['01','03','05','07','09','11','49']);
    assert.deepEqual(slots.map(x => x.dataset.wave), ['red','blue','green','red','blue','green','green']);
    assert.equal(dom.window.getComputedStyle(slots[6]).backgroundColor, 'rgb(16, 168, 120)');
    paste(slots[2], '1 1 3 4 5 6 7');
    assert.deepEqual(slots.map(x => x.value), ['01','03','05','07','09','11','49']);
    assert.match(doc.querySelector('#entryFlash').textContent, /不重复/);

    doc.querySelector('#quickPaste').value = '01 02 03 04 05 06 07';
    doc.querySelector('#quickPaste').dispatchEvent(new dom.window.Event('input', {bubbles:true}));
    assert.deepEqual(slots.map(x => x.dataset.wave), ['red','red','blue','blue','green','green','red']);
    doc.querySelector('#submitDraw').click();
    assert.ok(slots.every(x => x.value === '' && !x.dataset.wave));
    assert.equal(dom.window.getComputedStyle(slots[6]).backgroundColor, 'rgb(255, 255, 255)');
    assert.match(doc.querySelector('#entryFlash').textContent, /已保存/);
    assert.equal(JSON.parse(dom.window.localStorage.getItem('mark6_nst_local_draws_v1')).length, 1);
    assert.equal(doc.querySelector('#nextTargetHead').textContent, subsequentId);
    doc.querySelector('#undoDraw').click();
    assert.equal(doc.querySelector('#nextTargetHead').textContent, nextId);
    const fresh = { ...next, id: nextId, numbers: [1,2,3,4,5,6], special: 7 };
    globalThis.fetch = async () => ({ok:true,json:async()=>({draws:[fresh,...INITIAL_DB.draws]})});
    doc.querySelector('#syncNow').click();
    await new Promise(r => setTimeout(r, 40));
    assert.match(doc.querySelector('#syncStatus').textContent, /已同步 1 期/);
    assert.equal(doc.querySelector('#nextTargetHead').textContent, subsequentId);
    assert.equal(JSON.parse(dom.window.localStorage.getItem('mark6_nst_local_draws_v1'))[0].id, nextId);
    await new Promise(r => setTimeout(r, 180));
  } finally {
    dom.window.close();
    for (const k of keys) {
      if (saved[k]) Object.defineProperty(globalThis,k,saved[k]); else delete globalThis[k];
    }
  }
});
