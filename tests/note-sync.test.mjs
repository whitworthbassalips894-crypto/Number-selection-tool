import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { planSync } from '../src/note-sync.js';
import { normalizeDrawRecord } from '../src/parser.js';
const html = fs.readFileSync('index.html','utf8');
const data = vm.runInNewContext(html.match(/const COMPRESSED_DATA = (\[[\s\S]*?\]);/)[1]);
const local = data.map(r=>({label:`${r[0]}-${String(r[1]).padStart(3,'0')}`,year:r[0],periodNum:r[1],raw7:r.slice(2),usable:new Set(r.slice(2)).size===7}));
const remote = JSON.parse(fs.readFileSync('data/draws.json')).draws.map(normalizeDrawRecord);
test('附件底库与仓库同步，连续追加最新四期', () => {
  const rows = planSync(local, remote);
  assert.deepEqual(rows.map(d=>d.id), ['2026-313','2026-314','2026-315','2026-316']);
  assert.throws(()=>planSync(local, remote.filter(d=>d.id!=='2026-313')), /缺口/);
  const changed = remote.map(d=>d.id==='2026-312'?{...d,special:1}:d);
  assert.throws(()=>planSync(local, changed), /冲突/);
});
test('新页面启动并保存同步数据', async () => {
  const dom = new JSDOM(html,{url:'https://example.com/',runScripts:'dangerously',pretendToBeVisual:true});
  try {
    assert.ok(dom.window.noteSync);
    assert.ok(dom.window.document.getElementById('syncNow'));
    const rows = planSync(dom.window.noteSync.records(), remote);
    dom.window.noteSync.apply(rows);
    const saved = JSON.parse(dom.window.localStorage.getItem('number_note_combined_v1'));
    assert.equal(saved.labels.at(-1), '2026-316');
    assert.equal(saved.labels.length, 4);
  } finally { dom.window.close(); }
});
