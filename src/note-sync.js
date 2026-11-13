import { normalizeDrawRecord, parseDrawsInput } from './parser.js';
import { isUsableDraw } from './audit.js';
import { rawGithubDbUrl } from './sync.js';
import { DEFAULT_CONFIG } from './constants.js';

// Compare the seven numbers irrespective of the order of the six regular balls.
export function planSync(local, remote) {
  const existing = new Map(local.map(r => [r.label, r]));
  const seen = new Map();
  for (const d of remote) {
    if (!d) throw new Error('数据源包含无效开奖');
    if (!isUsableDraw(d)) {
      const latest = local.at(-1);
      if (d.year > latest.year || (d.year === latest.year && d.periodNum > latest.periodNum)) throw new Error(`数据源 ${d.id} 开奖无效`);
      continue; // 历史底库可能含无效样本，不参与同步
    }
    const nums = [...d.numbers, d.special];
    const signature = a => [...a.slice(0, 6)].sort((x,y) => x-y).join(',') + '|' + a[6];
    if (seen.has(d.id) && signature(seen.get(d.id)) !== signature(nums)) throw new Error(`数据源期号 ${d.id} 冲突`);
    seen.set(d.id, nums);
    const old = existing.get(d.id);
    if (old && old.usable && signature(old.raw7) !== signature(nums)) throw new Error(`期号 ${d.id} 与本地记录冲突，请先核对`);
  }
  const latest = local.at(-1);
  let year = latest.year, period = latest.periodNum;
  const later = remote.filter(d => d.year > year || (d.year === year && d.periodNum > period)).sort((a,b) => a.year-b.year || a.periodNum-b.periodNum);
  const result = [];
  for (const d of later) {
    if (result.some(r => r.id === d.id)) continue;
    const days = (Date.UTC(year+1,0,1)-Date.UTC(year,0,1))/86400000;
    if (++period > days) { year++; period = 1; }
    const expected = `${year}-${String(period).padStart(3,'0')}`;
    if (d.id !== expected) throw new Error(`期号缺口：应为 ${expected}，数据源为 ${d.id}`);
    result.push(d);
  }
  return result;
}

async function request(url, json = false, timeout = 8000) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {cache:'no-store', signal:controller.signal});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!json) return parseDrawsInput(await response.text());
    const payload = await response.json();
    if (!Array.isArray(payload.draws) || !payload.draws.length) throw new Error('数据源没有开奖记录');
    return payload.draws.map(d => { const row = normalizeDrawRecord(d); if (!row) throw new Error('数据源包含无效开奖'); return row; });
  } finally { clearTimeout(timer); }
}
async function upstream() {
  const url = DEFAULT_CONFIG.remoteSourceUrl;
  for (const source of [url, `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, `https://corsproxy.io/?${encodeURIComponent(url)}`, `https://r.jina.ai/${url}`]) {
    try { const rows = await request(source, false, 5000); if (rows.length) return rows; } catch {}
  }
  return [];
}
async function syncNow() {
  const button = document.getElementById('syncNow'), status = document.getElementById('syncStatus');
  button.disabled = true; status.textContent = '正在检查最新开奖…';
  try {
    const urls = [new URL(`./data/draws.json?_r=${Date.now()}`, location.href).href];
    const raw = rawGithubDbUrl(location.href); if (raw) urls.push(`${raw}?_r=${Date.now()}`);
    const responses = await Promise.allSettled(urls.map(url => request(url, true)));
    const sources = responses.filter(r => r.status === 'fulfilled').map(r => r.value);
    sources.sort ( (a,b) => Math.max(...b.map(d=>d.year*1000+d.periodNum)) - Math.max(...a.map(d=>d.year*1000+d.periodNum)) );
    let rows = sources.length ? planSync(window.noteSync.records(), sources[0]) : [];
    if (!rows.length) {
      status.textContent = '仓库暂无新期次，正在尝试上游开奖源…';
      const remote = await upstream();
      if (remote.length) rows = planSync(window.noteSync.records(), remote);
      else if (!sources.length) throw new Error('网络或数据源不可用');
      else { status.textContent = '仓库暂无新期次，上游暂不可用，请稍后重试。'; return; }
    }
    if (!rows.length) { status.textContent = '同步完成，没有新期次。'; return; }
    window.noteSync.apply(rows);
    status.textContent = `已同步 ${rows.length} 期，最新 ${rows.at(-1).id}。`;
  } catch (e) { status.textContent = `未写入：${e.message}。`; }
  finally { button.disabled = false; }
}
if (typeof document !== 'undefined') {
  document.getElementById('syncNow').addEventListener('click', syncNow);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
}
