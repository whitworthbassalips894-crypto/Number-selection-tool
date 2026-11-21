import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync('index.html', 'utf8');

test('录入第7位特码后，综合7码命中独立记录且切换档位仍可见', () => {
  const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  try {
    const doc = dom.window.document;
    doc.querySelector('[data-tier="7"]').click();
    const seven = [...doc.querySelectorAll('#optHero .ball')].map(el => Number(el.textContent));
    doc.querySelector('[data-tier="5"]').click();
    const five = [...doc.querySelectorAll('#optHero .ball')].map(el => Number(el.textContent));
    const special = seven.find(n => !five.includes(n));
    assert.ok(special);
    const normals = Array.from({length: 49}, (_, i) => i + 1).filter(n => n !== special).slice(0, 6);
    const inputs = [...doc.querySelectorAll('#ballInputs input')];
    assert.equal(inputs.length, 7);
    assert.equal(inputs[6].getAttribute('aria-label'), '第7位特码');
    [...normals, special].forEach((n, i) => { inputs[i].value = String(n); });
    doc.querySelector('#submitDraw').click();
    const saved = JSON.parse(dom.window.localStorage.getItem('mark6_tool2_heat_v2'));
    assert.deepEqual(saved.draws.at(-1), [...normals, special]);
    const row = doc.querySelector('#historyBody tr.main-row');
    assert.equal(row.querySelector('.seven-hit').textContent, String(special).padStart(2, '0'));
    assert.equal(row.cells[2].textContent.trim(), '-');
    assert.match(doc.querySelector('#recentSummary').textContent, /7码中 \d+ 期/);
    assert.equal(doc.querySelector('#latestDrawBalls .is-sp .ball').textContent, String(special).padStart(2, '0'));
    doc.querySelector('[data-tier="10"]').click();
    assert.equal(doc.querySelector('#historyBody tr.main-row .seven-hit').textContent, String(special).padStart(2, '0'));
  } finally { dom.window.close(); }
});
