import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../data/draws.js';
import { replayRecord } from '../src/combined.js';

test('回放工作线程按批报告进度并返回与原引擎一致的记录', async () => {
  const saved = globalThis.self;
  const messages = [];
  globalThis.self = { postMessage(message) { messages.push(message); } };
  try {
    await import('../src/replay-worker.js');
    const draws = db.draws.slice(0, 65);
    await globalThis.self.onmessage({ data: { draws } });
    assert.deepEqual(messages.map(m => m.type), ['progress', 'progress', 'done']);
    assert.deepEqual(messages.slice(0, 2).map(m => m.processed), [64, 65]);
    assert.deepEqual(messages[2].records, draws.map(d => replayRecord(draws, d)).filter(Boolean));
    messages.length = 0;
    await globalThis.self.onmessage({ data: { draws: null } });
    assert.equal(messages[0].type, 'error');
  } finally {
    if (saved === undefined) delete globalThis.self;
    else globalThis.self = saved;
  }
});
