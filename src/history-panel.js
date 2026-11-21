import { replayPick3, summarizePick3 } from './pick3-history.js';

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
let worker = null, requestId = 0, records = [], draws = [], limit = 30, specialLimit = 30, started = false, dataSignature = "";

function renderSpecial() {
  const rows = window.getHistoryDraws().slice().reverse();
  $('specialDrawList').innerHTML = rows.slice(0, specialLimit).map(d =>
    `<div class="special-draw"><span>${d.label}</span><b class="special-number" data-wave="${wave(d.special)}">${pad(d.special)}</b><small>${d.date || ''}</small></div>`).join('') || '<p class="dc-note">暂无有效开奖数据</p>';
  $('specialMore').hidden = specialLimit >= rows.length;
}
function wave(n) {
  if ([1,2,7,8,12,13,18,19,23,24,29,30,34,35,40,45,46].includes(n)) return 'red';
  if ([3,4,9,10,14,15,20,25,26,31,36,37,41,42,47,48].includes(n)) return 'blue';
  return 'green';
}
function renderPick3() {
  const year = $('pick3Year').value;
  const query = $('pick3Search').value.trim();
  const filtered = records.filter(r => (year === 'ALL' || String(r.draw.year) === year) && r.draw.label.includes(query) && (!$('pick3OnlyHit').checked || r.five.some(e => e.isWin)));
  const stats = summarizePick3(records.filter(r => year === 'ALL' || String(r.draw.year) === year));
  $('pick3Summary').textContent = `已回放 ${stats.periods} 期 · 命中 ${stats.hits} 期 · 命中率 ${stats.periods ? (stats.rate * 100).toFixed(1) + '%' : '—'}`;
  $('pick3Body').innerHTML = filtered.slice(0, limit).map(r => {
    const winning = r.five.filter(e => e.isWin).length;
    const groups = r.five.map(e => `<span class="pick3-group${e.isWin ? ' won' : ''}">${e.code || e.name} ${e.numbers.map(pad).join(' · ')}${e.isWin ? ' ✓' : ''}</span>`).join('');
    return `<tr class="${winning ? 'row-hit' : ''}"><td class="col-period">${r.draw.label}</td><td>${r.draw.numbers.map(pad).join(' ')}</td><td><div class="pick3-groups">${groups}</div></td><td>${winning ? `<span class="badge hit">${winning} 注</span>` : '—'}</td></tr>`;
  }).join('') || '<tr><td colspan="4" class="empty">暂无符合条件的记录</td></tr>';
  $('pick3More').hidden = filtered.length <= limit;
}
function startReplay() {
  started = true;
  if (worker) worker.terminate();
  const id = ++requestId;
  records = [];
  draws = window.getHistoryDraws().slice().reverse(); // 旧模型按新到旧处理历史
  dataSignature = JSON.stringify(draws);
  const years = [...new Set(draws.map(d => d.year))].sort((a,b) => b-a);
  $('pick3Year').innerHTML = '<option value="ALL">全部年份</option>' + years.map(y => `<option value="${y}">${y}年</option>`).join('');
  $('pick3Start').hidden = true;
  $('pick3Status').textContent = '正在回放历史数据…';
  renderPick3();
  if (!draws.length) { $('pick3Status').textContent = '暂无有效开奖数据。'; $('pick3Start').hidden = false; return; }
  const receive = data => {
    if (id !== requestId) return;
    if (data.error) {
      $('pick3Status').textContent = `回放失败：${data.error}。请重试。`;
      $('pick3Start').hidden = false;
      return;
    }
    records.push(...data.rows);
    $('pick3Status').textContent = data.done === data.total ? '回放完成。结果为历史模拟，并非当期锁定记录。' : `正在回放 ${data.done} / ${data.total} 期…`;
    renderPick3();
  };
  if (typeof Worker !== 'undefined') {
    try {
      worker = new Worker(new URL('./pick3-history-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = e => receive(e.data);
      worker.onerror = () => { worker?.terminate(); worker = null; receive({ error: '后台计算不可用' }); };
      worker.postMessage({ draws, requestId: id });
      return;
    } catch (_) { worker = null; }
  }
  // 无 Worker 的浏览器分批执行，避免长时间阻塞页面。
  let i = 0;
  function step() {
    if (id !== requestId) return;
    try {
      const rows = [];
      for (let end = Math.min(i + 5, draws.length); i < end; i++) rows.push(replayPick3(draws, draws[i]));
      receive({ rows, done: i, total: draws.length });
      if (i < draws.length) setTimeout(step, 0);
    } catch (error) { receive({ error: String(error?.message || error) }); }
  }
  step();
}
$('specialMore').addEventListener('click', () => { specialLimit += 30; renderSpecial(); });
$('pick3Start').addEventListener('click', startReplay);
$('pick3More').addEventListener('click', () => { limit += 30; renderPick3(); });
for (const id of ['pick3Year', 'pick3Search', 'pick3OnlyHit']) $(id).addEventListener('input', () => { limit = 30; renderPick3(); });
window.addEventListener('history-data-change', () => {
  renderSpecial();
  if (started && JSON.stringify(window.getHistoryDraws().slice().reverse()) !== dataSignature) startReplay();
});
renderSpecial();
