import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync('simulator.html', 'utf8');
const key = 'daily_draw_simulator_6plus1_compare_v2';
const sim = { main:[1,2,3,4,5,6], special:7 };
const draw = { id:'2026-320', date:'2026-11-16', numbers:[14,17,32,34,24,46], special:20 };
function setup(fetchImpl, actual = null) {
  return new JSDOM(html, {
    url:'https://example.test/simulator.html', runScripts:'dangerously',
    beforeParse(window) {
      window.localStorage.setItem(key, JSON.stringify({ dailyRecords:[{date:'2026-11-16',sim,actual}], replayRecords:[], realDrafts:{} }));
      window.fetch = fetchImpl; window.confirm = () => true;
    }
  });
}
function selectPeriod(window) {
  const field=window.document.getElementById('realPeriod');
  field.value='2026-320'; field.dispatchEvent(new window.Event('change'));
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const response = data => Promise.resolve({ok:true,json:async()=>data});

test('底库填入经过校验且须手动保存，不覆盖模拟号码', async () => {
  const dom=setup(()=>response({draws:[draw],latestId:'2026-320'}));
  const {window:w}=dom; selectPeriod(w);
  w.document.getElementById('fetchRealButton').click(); await tick();
  assert.equal(w.document.getElementById('realMain1').value,'14');
  assert.equal(w.document.getElementById('realSpecial').value,'20');
  let saved=JSON.parse(w.localStorage.getItem(key));
  assert.equal(saved.dailyRecords[0].actual,null);
  assert.deepEqual(saved.dailyRecords[0].sim,sim);
  w.document.getElementById('saveRealButton').click();
  saved=JSON.parse(w.localStorage.getItem(key));
  assert.deepEqual(saved.dailyRecords[0].actual,{main:[14,17,24,32,34,46],special:20});
  dom.window.close();
});

test('错误日期、重复号码和重复期号不能填入', async () => {
  for (const draws of [[{...draw,date:'2026-11-15'}],[{...draw,special:14}],[draw,draw],[]]) {
    const dom=setup(()=>response({draws})); const w=dom.window; selectPeriod(w);
    w.document.getElementById('fetchRealButton').click(); await tick();
    assert.equal(w.document.getElementById('realMain1').value,'');
    assert.match(w.document.getElementById('fetchStatus').textContent,/读取失败/);
    dom.window.close();
  }
});

test('已保存结果不会被底库覆盖；请求期间输入变化也不会被覆盖', async () => {
  let calls=0; const dom=setup(()=>{calls++;return response({draws:[draw]})},sim);
  selectPeriod(dom.window); dom.window.document.getElementById('fetchRealButton').click();
  assert.equal(calls,1); assert.match(dom.window.document.getElementById('fetchStatus').textContent,/不会覆盖/); dom.window.close();
  let finish, request=0; const next=setup(()=>{if(++request===1)return response({draws:[draw]});return new Promise(resolve=>{finish=resolve})}); const w=next.window;
  selectPeriod(w); w.document.getElementById('fetchRealButton').click();
  const input=w.document.getElementById('realMain1'); input.value='09'; input.dispatchEvent(new w.Event('input'));
  finish({ok:true,json:async()=>({draws:[draw]})}); await tick();
  assert.equal(input.value,'09'); assert.match(w.document.getElementById('fetchStatus').textContent,/输入已改变/); w.close();
});


test('启动读取最近有效底库、过滤异常并保留本机数据', async () => {
  const other={id:'2026-319',date:'2026-11-15',numbers:[6,3,15,13,25,45],special:5};
  const invalid={id:'2026-321',date:'2026-11-17',numbers:[1,1,2,3,4,5],special:6};
  const dom=setup(()=>response({draws:[invalid,other,draw],latestId:'2026-321'})); const w=dom.window;
  await tick();
  assert.match(w.document.getElementById('databaseTitle').textContent,/2026-320/);
  assert.match(w.document.getElementById('databaseStatus').textContent,/跳过 1 条异常/);
  assert.match(w.document.getElementById('replaySource').textContent,/2 期/);
  assert.equal(w.document.getElementById('replayDrawCount').textContent,'2');
  assert.equal(JSON.parse(w.localStorage.getItem(key)).dailyRecords[0].actual,null);
  const button=w.document.querySelector('[data-select-period="2026-320"]'); button.click();
  assert.equal(w.document.getElementById('realPeriod').value,'2026-320');
  dom.window.close();
});

test('底库不可用时标明旧样例，站点失败可尝试仓库源', async () => {
  const urls=[]; const dom=setup(url=>{urls.push(url);return Promise.reject(new Error('offline'))});
  await tick(); assert.equal(urls.length,2); assert.match(urls[1],/^https:\/\/raw\.githubusercontent\.com/);
  assert.match(dom.window.document.getElementById('databaseStatus').textContent,/内置旧回放样例/);
  assert.match(dom.window.document.getElementById('replaySource').textContent,/旧样例/); dom.window.close();
  const next=setup(url=>url.startsWith('https:')?response({draws:[draw]}):Promise.reject(new Error('offline')));
  await tick(); assert.match(next.window.document.getElementById('databaseStatus').textContent,/GitHub 仓库/); next.window.close();
});
