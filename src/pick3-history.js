/** 三中三历史回放：使用旧五组模型，目标期只使用此前有效开奖记录。 */
import { buildDailyFiveRecords } from './tool1/dailyfive.js';

export function replayPick3(draws, draw) {
  return buildDailyFiveRecords(draws, [draw], { mode: 'pick3', randomSalt: 0 })[0];
}

export function summarizePick3(records) {
  const hits = records.filter(r => r.five.some(e => e.isWin)).length;
  return { periods: records.length, hits, rate: records.length ? hits / records.length : 0 };
}
