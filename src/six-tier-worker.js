import { sixTierPlan } from './six-tier.js';

// 最新期优先，节奏提醒不必等全量历史回放计算结束。
self.onmessage = async ({ data }) => {
  try {
    const draws = data.draws;
    const newest = draws.slice().reverse();
    const records = [];
    for (let i = 0; i < newest.length; i += 24) {
      const batch = [];
      for (const draw of newest.slice(i, i + 24)) {
        const plan = sixTierPlan(draws, draw);
        batch.push({ id: draw.id, spRank: plan.rankOf[draw.special] });
      }
      records.push(...batch);
      self.postMessage({ type: 'progress', processed: records.length, total: draws.length, records: batch });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    self.postMessage({ type: 'done', records });
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || '计算失败' });
  }
};
