import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

test('最新期回放优先展示节奏灯，全量年度统计完成前保持计算中', async () => {
  const html = fs.readFileSync('tests/fixtures/six-tier.html','utf8');
  const dom = new JSDOM(html, {url:'https://example.com/app/', pretendToBeVisual:true});
  const names = ['window','document','navigator','location','Worker'];
  const saved = Object.fromEntries(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  let instance;
  class WorkerStub {
    constructor() { instance=this; }
    postMessage(data) { this.draws=data.draws; }
    terminate() {}
  }
  try {
    globalThis.window=dom.window; globalThis.document=dom.window.document;
    Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
    globalThis.location=dom.window.location; globalThis.Worker=WorkerStub;
    dom.window.__SKIP_AUTO_SYNC__=true;
    await import(`../src/six-tier-app.js?progress=${Date.now()}`);
    await new Promise(resolve=>setTimeout(resolve,85));
    assert.ok(instance?.draws);
    const newest=instance.draws.slice().reverse();
    const latestRecords=newest.slice(0,24).map((d,i)=>({id:d.id,spRank:i<9?9:8}));
    instance.onmessage({data:{type:'progress',records:latestRecords,processed:24,total:newest.length}});
    assert.match(dom.window.document.querySelector('#rhythmBar').textContent, /近期顺风.*命中 11 次.*连黑 9 期/);
    assert.ok(dom.window.document.querySelector('#rhythmBar').classList.contains('green'));
    assert.match(dom.window.document.querySelector('#yearlyBody').textContent, /正在计算/);
    const allRecords=newest.map((d,i)=>({id:d.id,spRank:i<9?9:i<24?8:49}));
    instance.onmessage({data:{type:'done',records:allRecords}});
    assert.equal(dom.window.document.querySelector('#yearlyBody tr[data-yr="ALL"]').cells.length,4);
    assert.match(dom.window.document.querySelector('#rhythmBar').textContent, /命中 11 次.*连黑 9 期/);
  } finally {
    dom.window.close();
    for(const k of names) { if(saved[k]) Object.defineProperty(globalThis,k,saved[k]); else delete globalThis[k]; }
  }
});
