import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFiveTickets, formatSingleTicket } from '../src/copy.js';

test('formatSingleTicket：单组 7 码以两位数 + 顿号输出，不含任何文字标签', () => {
  const line = formatSingleTicket([5, 8, 17, 23, 25, 38, 40]);
  assert.equal(line, '05、08、17、23、25、38、40');
  assert.doesNotMatch(line, /[^\d、]/);
});

test('formatFiveTickets：三组 7 码（含跨组重叠）输出 3 行纯号码', () => {
  const groups = [
    { id: 'hot', name: '热态顺势', numbers: [5, 8, 17, 23, 25, 38, 40] },
    { id: 'cold', name: '遗漏回补', numbers: [3, 6, 22, 29, 34, 37, 41] },
    { id: 'cycle', name: '周期均衡', numbers: [2, 11, 14, 23, 25, 38, 46] }
  ];
  const out = formatFiveTickets(groups);
  const lines = out.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], '05、08、17、23、25、38、40');
  assert.equal(lines[1], '03、06、22、29、34、37、41');
  assert.equal(lines[2], '02、11、14、23、25、38、46');
  for (const l of lines) {
    assert.match(l, /^\d{2}(、\d{2}){6}$/);
  }
});
