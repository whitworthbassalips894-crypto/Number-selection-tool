import test from 'node:test';
import assert from 'node:assert/strict';
import { replayPick3, summarizePick3 } from '../src/pick3-history.js';
import { generateDailyFive } from '../src/tool1/dailyfive.js';

const draw = (periodNum, numbers, special) => ({ year: 2026, periodNum, label: `2026-${String(periodNum).padStart(3, '0')}`, date: `2026-01-${String(periodNum).padStart(2, '0')}`, numbers, special });

test('三中三回放采用旧五组，仅按六个正码判定，目标期和未来期不参与选号', () => {
  const prior = draw(1, [1, 2, 3, 4, 5, 6], 7);
  const target = draw(2, [8, 9, 10, 11, 12, 13], 14);
  const future = draw(3, [15, 16, 17, 18, 19, 20], 21);
  const plan = generateDailyFive([future, target, prior], target, { mode: 'pick3', randomSalt: 0 });
  const record = replayPick3([future, target, prior], target);
  assert.equal(record.five.length, 5);
  assert.deepEqual(record.five.map(e => e.numbers), plan.five.map(e => e.numbers));
  assert.deepEqual(record.five.map(e => e.numbers), replayPick3([prior], target).five.map(e => e.numbers));
  const picked = plan.five[0].numbers;
  const remaining = Array.from({length: 49}, (_, i) => i + 1).filter(n => !picked.includes(n));
  const win = { ...target, numbers: [...picked, ...remaining.slice(0, 3)], special: remaining[3] };
  assert.equal(replayPick3([prior], win).five[0].isWin, true);
  const notWin = { ...target, numbers: [...picked.slice(0, 2), ...remaining.slice(0, 4)], special: picked[2] };
  assert.equal(replayPick3([prior], notWin).five[0].isWin, false);
  assert.deepEqual(summarizePick3([replayPick3([prior], win)]), { periods: 1, hits: 1, rate: 1 });
  assert.deepEqual(summarizePick3([]), { periods: 0, hits: 0, rate: 0 });
});
