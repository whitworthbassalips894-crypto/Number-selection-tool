/** 顺序为最新在前，命中只以该期 8 码回放顺位判定。 */
export function rhythmSummary(ranks, { complete = false } = {}) {
  if (ranks.length < 20) return { state: complete ? 'insufficient' : 'pending', sample: ranks.length };
  const recentHits = ranks.slice(0, 20).filter(rank => rank <= 8).length;
  let losingStreak = 0;
  while (losingStreak < ranks.length && ranks[losingStreak] > 8) losingStreak++;
  if (losingStreak === ranks.length && !complete) return { state: 'pending', sample: ranks.length };
  if (losingStreak >= 10 || recentHits <= 1) {
    return { state: 'orange', recentHits, losingStreak, message: '阶段逆风 · 严禁倍投追号，建议减半或观望一期' };
  }
  if (recentHits >= 4) return { state: 'green', recentHits, losingStreak, message: '近期顺风 · 保持固定平注，切勿加码' };
  return { state: 'yellow', recentHits, losingStreak, message: '正常波动 · 复制即走，守住纪律' };
}
