/** 回放按期统计：每期最多计一次命中，跨方案重号不叠加。 */
export const REPLAY_KEYS = ['opt', 'a', 'b', 'ab'];

export function periodHitSummary(records = []) {
  const periods = records.length;
  const strategies = {};
  for (const key of REPLAY_KEYS) {
    const wins = records.reduce((total, r) => total + (r.picks[key].includes(Number(r.draw.special)) ? 1 : 0), 0);
    strategies[key] = { wins, rate: periods ? wins * 100 / periods : 0, interval: wins ? periods / wins : null };
  }
  return { periods, strategies };
}
