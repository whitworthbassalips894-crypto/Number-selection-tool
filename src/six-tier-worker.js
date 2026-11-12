import { sixTierPlan } from './six-tier.js';

self.onmessage = async ({ data }) => {
  try {
    const draws = data.draws;
    const records = [];
    for (let i = 0; i < draws.length; i += 24) {
      for (const draw of draws.slice(i, i + 24)) {
        const plan = sixTierPlan(draws, draw);
        records.push({ id: draw.id, spRank: plan.rankOf[draw.special] });
      }
      self.postMessage({ type: 'progress', processed: Math.min(i + 24, draws.length), total: draws.length });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    self.postMessage({ type: 'done', records });
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || '计算失败' });
  }
};
