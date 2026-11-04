/** 将逐期选号移出主线程；每批汇报进度，选号仍调用未经修改的引擎。 */
import { replayRecord } from './combined.js';

self.onmessage = async (event) => {
  try {
    const draws = event.data.draws;
    const records = [];
    for (let i = 0; i < draws.length; i += 64) {
      for (const draw of draws.slice(i, i + 64)) {
        const record = replayRecord(draws, draw);
        if (record) records.push(record);
      }
      self.postMessage({ type: 'progress', processed: Math.min(i + 64, draws.length), total: draws.length });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    self.postMessage({ type: 'done', records });
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || '计算失败' });
  }
};
