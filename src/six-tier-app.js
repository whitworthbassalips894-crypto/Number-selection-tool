import INITIAL_DB from '../data/draws.js';
import { APP_BUILD, DEFAULT_CONFIG } from './constants.js';
import { isUsableDraw } from './audit.js';
import { normalizeDrawRecord, mergeDraws, parseDrawsInput } from './parser.js';
import { nextPeriodMeta } from './periods.js';
import { compareDrawSets, formatSyncSummary, rawGithubDbUrl, chinaSyncStatus } from './sync.js';
import { STORAGE_KEYS, loadPersistedState, safeSet } from './storage.js';
import { sixTierPlan, ALL_49, TIER_DEFS, WAVE_MAP, WAVE_COLOR, pad2, parseLabel, periodToDate, validSevenNums, yearZodiacBaseIdx, zodiacByBase } from './six-tier.js';

const $ = id => document.getElementById(id);
let localDraws = loadPersistedState(window.localStorage, { normalizeDrawRecord }).localDraws;
let usable = [];
let nextLabel = '';
let currentPlan = null;
let activeTier = 8, pickOrder = 'num', selectedYear = 'ALL', historyLimit = 80;
let heatScope = 'special', heatSort = 'num';
const planCache = new Map();
let cachedKey = '';
let generation = 0, worker = null;

function allDraws() { return mergeDraws(INITIAL_DB.draws, localDraws).merged; }
function saveDraws(draws) {
  if (!safeSet(window.localStorage, STORAGE_KEYS.LOCAL_DRAWS, draws)) {
    showFlash('本地保存失败，请检查浏览器存储权限', true);
    return false;
  }
  localDraws = draws;
  return true;
}
function showFlash(msg, isErr = false) {
  const el = $('entryFlash');
  el.textContent = msg;
  el.className = 'entry-flash show' + (isErr ? ' err' : '');
}
function ballHtml(n, extraCls = '') {
  return `<span class="ball ${extraCls}" style="background:${WAVE_COLOR[WAVE_MAP[n]]}">${pad2(n)}</span>`;
}

function bindCopyButtons(root) {
  root.querySelectorAll('button[data-copy]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const txt = btn.getAttribute('data-copy') || '';
      try { await navigator.clipboard.writeText(txt); } catch {
        const ta = document.createElement('textarea');
        ta.value = txt; document.body.append(ta); ta.select();
        document.execCommand('copy'); ta.remove();
      }
      const old = btn.textContent;
      btn.classList.add('copied');
      btn.textContent = '已复制 ✓';
      setTimeout(() => { btn.classList.remove('copied'); btn.textContent = old; }, 1100);
    });
  });
}

function renderRecommendations(usable, nextLabel) {
  const p = parseLabel(nextLabel) || { year: 2026, periodNum: 316 };
  const nextDate = periodToDate(p.year, p.periodNum);
  const plan = currentPlan;
  if (!plan) return;
  const baseZ = yearZodiacBaseIdx(nextDate);

  document.getElementById('recPeriodTag').textContent = nextLabel;

  const hasReplay = cachedKey !== '';
  const allRows = hasReplay ? usable.map(d => planCache.get(d.label)).filter(Boolean) : [];
  const totalN = allRows.length || 1;

  // 1. 六档切换器
  const tabsEl = document.getElementById('tierTabs');
  tabsEl.innerHTML = TIER_DEFS.map(td => {
    let hits = 0;
    for (let i = 0; i < allRows.length; i++) if (allRows[i].spRank <= td.size) hits++;
    const subTxt = allRows.length ? `${td.desc} · ${((hits / totalN) * 100).toFixed(1)}%` : td.desc;
    return `<button type="button" class="tier-tab${td.size === activeTier ? ' active' : ''}" data-tier="${td.size}">
      <b>${td.icon} ${td.label}</b>
      <small>${subTxt}</small>
    </button>`;
  }).join('');

  tabsEl.querySelectorAll('.tier-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTier = Number(btn.getAttribute('data-tier'));
      renderRecommendations(usable, nextLabel);
    });
  });

  // 2. 当前选中档位主面板（实心圆彩球 + 生肖 + 前5核心暖金底）
  const curDef = TIER_DEFS.find(t => t.size === activeTier) || TIER_DEFS[2];
  const tierSlice = plan.ranked.slice(0, activeTier);
  const displayBalls = pickOrder === 'num' ? tierSlice.slice().sort((a, b) => a - b) : tierSlice;
  const copyStr = tierSlice.slice().sort((a, b) => a - b).map(pad2).join(' ');

  let curHits = 0;
  for (let i = 0; i < allRows.length; i++) if (allRows[i].spRank <= activeTier) curHits++;
  const metaHtml = allRows.length
    ? `<span class="hero-meta">历史命中 ${curHits}/${totalN}（${((curHits / totalN) * 100).toFixed(1)}% · 均 ${curHits ? (totalN / curHits).toFixed(1) : '—'} 期1中）</span>`
    : '';

  const heroEl = document.getElementById('tierHero');
  heroEl.innerHTML = `
    <div class="hero-head">
      <div class="hero-title">
        <span class="hero-badge">${curDef.icon} 当前档位：${curDef.label}（${curDef.desc}）</span>
        ${metaHtml}
      </div>
      <button type="button" class="btn brand sm" data-copy="${copyStr}">一键复制 ${curDef.label}</button>
    </div>
    <div class="pick-cards">
      ${displayBalls.map(n => {
        const rk = plan.rankOf[n];
        const isCore5 = rk <= 5;
        return `<div class="pick-item${isCore5 ? ' core5' : ''}">
          <span class="pick-rank">#${rk}</span>
          ${ballHtml(n, 'lg')}
          <span class="pick-zod">${zodiacByBase(n, baseZ)}</span>
        </div>`;
      }).join('')}
    </div>
  `;
  bindCopyButtons(heroEl);

  // 3. 六档同心圆增量阶梯表
  let prevK = 0;
  const ladderEl = document.getElementById('ladderBox');
  ladderEl.innerHTML = TIER_DEFS.map(td => {
    const added = plan.ranked.slice(prevK, td.size).sort((a, b) => a - b);
    const fullSorted = plan.ranked.slice(0, td.size).sort((a, b) => a - b);
    const copyLine = fullSorted.map(pad2).join(' ');
    const isBase = prevK === 0;
    prevK = td.size;
    return `<div class="ladder-row${td.size === activeTier ? ' is-selected' : ''}">
      <div class="lr-name">${td.icon} ${td.label} <small>${isBase ? '胆码' : '+' + added.length + '码'}</small></div>
      <div class="lr-balls">
        ${isBase ? '' : '<span class="plus-lbl">新增：</span>'}
        ${added.map(n => ballHtml(n, 'sm')).join('')}
      </div>
      <button type="button" class="btn sm" data-copy="${copyLine}">复制${td.size}码</button>
    </div>`;
  }).join('');
  bindCopyButtons(ladderEl);

  // 4. 冷却排除与注码提示条
  document.getElementById('killStrip').innerHTML = `
    <div><b>⛔ 近4期特码冷却排除：</b><span class="kill-balls">${plan.cool4.map(n => ballHtml(n, 'sm')).join('')}</span></div>
    <div>仅供统计参考，理性娱乐</div>
  `;
}

function renderReplaySection(usable) {
  const byYear = new Map();
  for (const d of usable) {
    if (!byYear.has(d.year)) byYear.set(d.year, []);
    byYear.get(d.year).push(d);
  }
  const years = [...byYear.keys()].sort((a, b) => b - a);

  const renderYrRow = (yrKey, label, list, isTotal) => {
    const n = list.length || 1;
    const cells = TIER_DEFS.map(td => {
      let h = 0;
      for (const d of list) if ((planCache.get(d.label)?.spRank ?? 99) <= td.size) h++;
      const pct = ((h / n) * 100).toFixed(1);
      const avgG = h > 0 ? (n / h).toFixed(1) : '—';
      const hi = td.size === activeTier ? ' hi-col' : '';
      return `<td><span class="rate-main${hi}">${pct}%</span><span class="rate-sub">${h}/${list.length} · 均${avgG}期</span></td>`;
    }).join('');
    const cls = isTotal ? 'yr-total' : (selectedYear === yrKey ? 'yr-active' : '');
    return `<tr class="${cls}" data-yr="${yrKey}">
      <td class="yr-label">${label}</td>
      <td class="yr-cnt">${list.length}</td>
      ${cells}
    </tr>`;
  };

  const yBody = document.getElementById('yearlyBody');
  yBody.innerHTML =
    years.map(y => renderYrRow(String(y), `${y}年`, byYear.get(y), false)).join('') +
    renderYrRow('ALL', '总计', usable, true);

  yBody.querySelectorAll('tr[data-yr]').forEach(tr => {
    tr.addEventListener('click', () => {
      selectedYear = tr.getAttribute('data-yr') || 'ALL';
      historyLimit = 80;
      renderReplaySection(usable);
    });
  });

  const yTabs = document.getElementById('yearTabs');
  const yOpts = ['ALL', ...years.map(String)];
  if (!yOpts.includes(selectedYear)) selectedYear = 'ALL';
  yTabs.innerHTML = yOpts.map(y => `
    <button type="button" class="tab${selectedYear === y ? ' active' : ''}" data-yr="${y}">
      ${y === 'ALL' ? '全部年份' : y + '年'}
    </button>
  `).join('');
  yTabs.querySelectorAll('button[data-yr]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedYear = btn.getAttribute('data-yr');
      historyLimit = 80;
      renderReplaySection(usable);
    });
  });

  const filtered = (selectedYear === 'ALL' ? usable : usable.filter(d => String(d.year) === selectedYear)).slice().reverse();
  const shown = filtered.slice(0, historyLimit);

  let hHtml = shown.map(d => {
    const rk = planCache.get(d.label)?.spRank ?? 99;
    const rowCls = rk <= 5 ? 'row-hit5' : rk <= 20 ? 'row-hit20' : '';
    const rkCls = rk <= 5 ? 'rk-pill top5' : rk <= 20 ? 'rk-pill top20' : 'rk-pill';
    const balls = d.numbers.map(n => `<span class="num" style="background:${WAVE_COLOR[WAVE_MAP[n]]}">${pad2(n)}</span>`).join('')
      + `<span class="num sp" style="background:${WAVE_COLOR[WAVE_MAP[d.special]]}">${pad2(d.special)}</span>`;
    const tierCols = TIER_DEFS.map(td => {
      if (rk > td.size) return '<td><span class="miss-dash">—</span></td>';
      const bCls = td.size <= 5 ? 'badge hit-gold' : 'badge hit';
      return `<td><span class="${bCls}">✓</span></td>`;
    }).join('');
    return `<tr class="${rowCls}">
      <td class="col-period">${d.label}</td>
      <td><div class="nums">${balls}</div></td>
      <td><span class="${rkCls}">#${rk}</span></td>
      ${tierCols}
    </tr>`;
  }).join('');

  if (filtered.length > historyLimit) {
    hHtml += `<tr><td colspan="9" style="padding:10px"><button type="button" class="btn sm" id="loadMoreHist">加载更多（剩余 ${filtered.length - historyLimit} 期）</button></td></tr>`;
  }
  document.getElementById('historyBody').innerHTML = hHtml;
  const moreBtn = document.getElementById('loadMoreHist');
  if (moreBtn) {
    moreBtn.addEventListener('click', () => {
      historyLimit += 120;
      renderReplaySection(usable);
    });
  }
}

function heatColorStyle(count, maxC, scope) {
  if (count === 0) return 'background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe';
  const r = maxC > 0 ? count / maxC : 0;
  if (scope === 'special') {
    if (count >= 5) return 'background:#dc2626;color:#fff';
    if (count === 4) return 'background:#ef4444;color:#fff';
    if (count === 3) return 'background:#fb923c;color:#fff';
    if (count === 2) return 'background:#fef08a;color:#854d0e';
    return 'background:#f1f5f9;color:#334155';
  }
  if (r >= 0.85) return 'background:#dc2626;color:#fff';
  if (r >= 0.72) return 'background:#f97316;color:#fff';
  if (r >= 0.58) return 'background:#fde047;color:#854d0e';
  if (r <= 0.35) return 'background:#dbeafe;color:#1e40af';
  return 'background:#f1f5f9;color:#334155';
}

function renderHeatSection(usable) {
  const win = usable.slice(-100);
  const cnt = new Int16Array(50);
  for (const d of win) {
    if (heatScope === 'special') cnt[d.special]++;
    else for (const n of d.raw7) cnt[n]++;
  }
  let maxC = 1;
  for (let n = 1; n <= 49; n++) if (cnt[n] > maxC) maxC = cnt[n];

  const order = ALL_49.slice();
  if (heatSort === 'freq') order.sort((a, b) => (cnt[b] - cnt[a]) || (a - b));

  document.getElementById('heatmap').innerHTML = order.map(n => `
    <div class="heat-cell" style="${heatColorStyle(cnt[n], maxC, heatScope)}">
      ${pad2(n)}
      <small>${cnt[n]}次</small>
    </div>
  `).join('');
}


function rebuild() {
  $('chinaSyncDate').textContent = chinaSyncStatus(allDraws()[0]);
  const token = ++generation;
  worker?.terminate(); worker = null;
  planCache.clear(); cachedKey = '';
  const all = allDraws();
  usable = all.filter(isUsableDraw).reverse().map(d => ({
    ...d, label: d.id, raw7: [...d.numbers, d.special], usable: true
  }));
  const meta = nextPeriodMeta(all[0]);
  nextLabel = `${meta.year}-${String(meta.periodNum).padStart(3, '0')}`;
  currentPlan = sixTierPlan(usable, meta);
  $('totalCount').textContent = String(usable.length);
  $('nextTargetHead').textContent = nextLabel;
  $('periodLabel').value = nextLabel;
  $('undoDraw').disabled = !localDraws.length;
  renderRecommendations(usable, nextLabel);
  renderHeatSection(usable);
  $('yearlyBody').innerHTML = '<tr><td colspan="8">正在计算历史统计…</td></tr>';
  $('historyBody').innerHTML = '<tr><td colspan="9">正在计算历史回放…</td></tr>';
  $('yearTabs').innerHTML = '';
  const records = [];
  const complete = rows => {
    if (token !== generation) return;
    planCache.clear();
    for (const r of rows) planCache.set(r.id, { spRank: r.spRank });
    cachedKey = 'ready';
    renderRecommendations(usable, nextLabel);
    renderReplaySection(usable);
  };
  const fallback = () => {
    let i = 0;
    const batch = () => {
      if (token !== generation) return;
      try {
        const end = Math.min(i + 4, usable.length);
        for (; i < end; i++) {
          const d = usable[i];
          records.push({ id: d.id, spRank: sixTierPlan(usable, d).rankOf[d.special] });
        }
        $('yearlyBody').innerHTML = `<tr><td colspan="8">正在计算历史统计 ${i}/${usable.length}…</td></tr>`;
        if (i < usable.length) setTimeout(batch, 0); else complete(records);
      } catch (error) {
        $('yearlyBody').textContent = `历史计算失败：${error.message}`;
      }
    };
    setTimeout(batch, 0);
  };
  setTimeout(() => {
    if (token !== generation) return;
    if (typeof Worker === 'undefined') { fallback(); return; }
    try {
      const w = new Worker(new URL('./six-tier-worker.js', import.meta.url), { type: 'module' });
      worker = w;
      let settled = false;
      const fail = () => {
        if (settled || token !== generation) return;
        settled = true; w.terminate(); worker = null; fallback();
      };
      w.onerror = fail;
      w.onmessage = ({ data }) => {
        if (settled || token !== generation) return;
        if (data.type === 'progress') $('yearlyBody').innerHTML = `<tr><td colspan="8">正在计算历史统计 ${data.processed}/${data.total}…</td></tr>`;
        else if (data.type === 'done') { settled = true; w.terminate(); worker = null; complete(data.records); }
        else if (data.type === 'error') fail();
      };
      w.postMessage({ draws: usable });
    } catch { fallback(); }
  }, 60);
}

async function fetchDraws(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const rows = (Array.isArray(payload.draws) ? payload.draws : []).map(normalizeDrawRecord).filter(Boolean);
    if (!rows.length) throw new Error('数据源没有有效记录');
    return rows;
  } finally { clearTimeout(timer); }
}

// 与原同步按钮一样，在仓库尚未更新时尝试公开开奖源及其代理。
async function fetchUpstream() {
  const url = DEFAULT_CONFIG.remoteSourceUrl;
  const candidates = [url, `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?${encodeURIComponent(url)}`, `https://r.jina.ai/${url}`];
  for (const source of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), source.includes('r.jina.ai') ? 12000 : 5000);
    try {
      const res = await fetch(source, { cache: 'no-store', signal: controller.signal });
      if (!res.ok) continue;
      const rows = parseDrawsInput(await res.text());
      if (rows.length) return rows;
    } catch { /* 继续尝试其他源 */ }
    finally { clearTimeout(timer); }
  }
  return [];
}

async function syncNow(write = true) {
  const btn = $('syncNow'), status = $('syncStatus');
  const showStatus = text => { status.textContent = text; $('chinaSyncDate').textContent = chinaSyncStatus(allDraws()[0]); };
  btn.disabled = true; showStatus('正在读取仓库开奖数据…');
  try {
    const urls = [new URL(`./data/draws.json?_r=${Date.now()}`, location.href).href];
    const raw = rawGithubDbUrl(location.href);
    if (raw) urls.push(`${raw}?_r=${Date.now()}`);
    const results = await Promise.allSettled(urls.map(fetchDraws));
    const sources = results.filter(x => x.status === 'fulfilled').map(x => x.value);
    if (!sources.length && write) { const upstream = await fetchUpstream(); if (upstream.length) sources.push(upstream); }
    if (!sources.length) throw new Error('网络或仓库数据源不可用');
    sources.sort((a, b) => {
      const newest = rows => rows.reduce((max, d) => Math.max(max, d.year * 1000 + d.periodNum), 0);
      return newest(b) - newest(a);
    });
    let r = compareDrawSets(allDraws(), sources[0]);
    if (r.conflictCount || r.gapCount) { showStatus(`未写入：${formatSyncSummary(r)}。`); return; }
    const valid = r.appendable.every(isUsableDraw);
    if (!valid) { showStatus('未写入：数据源包含无效开奖，请检查仓库数据。'); return; }
    if (!write) { showStatus(`自动检查：${formatSyncSummary(r)}${r.appendable.length ? '，可点击同步最新开奖。' : '。'}`); return; }
    let upstreamUnavailable = false;
    if (!r.appendable.length && results.some(x => x.status === 'fulfilled')) {
      showStatus('仓库暂无新期次，正在尝试上游开奖源…');
      const upstream = await fetchUpstream();
      if (!upstream.length) upstreamUnavailable = true;
      if (upstream.length) {
        r = compareDrawSets(allDraws(), upstream);
        if (r.conflictCount || r.gapCount) { showStatus(`未写入：${formatSyncSummary(r)}。`); return; }
        if (!r.appendable.every(isUsableDraw)) { showStatus('未写入：上游包含无效开奖。'); return; }
      }
    }
    if (r.appendable.length) {
      const updated = mergeDraws(localDraws, r.appendable).merged;
      if (!saveDraws(updated)) { showStatus('同步失败：无法写入本地存储。'); return; }
      rebuild();
      showStatus(`已同步 ${r.appendable.length} 期，最新 ${r.appendable.at(-1).id}。`);
    } else if (upstreamUnavailable) showStatus('仓库暂无新期次，上游暂不可用，请稍后重试或手动录入。');
    else showStatus(`同步完成：${formatSyncSummary(r)}。`);
  } catch (error) { showStatus(`同步失败：${error.message}。可稍后重试或手动录入。`); }
  finally { btn.disabled = false; }
}

function init() {
  const box = $('ballInputs');
  box.innerHTML = Array.from({ length: 7 }, (_, i) => `${i === 6 ? '<span class="balls-plus">+</span>' : ''}<div class="ball-slot${i === 6 ? ' sp' : ''}"><small>${i === 6 ? '特码' : `平${i + 1}`}</small><input aria-label="${i === 6 ? '特码' : `平码${i + 1}`}" inputmode="numeric" maxlength="2" class="ball-input"></div>`).join('');
  const inputs = [...box.querySelectorAll('input')];
  const updateBall = input => {
    const n = Number(input.value);
    if (/^\d{1,2}$/.test(input.value) && n >= 1 && n <= 49) input.dataset.wave = WAVE_MAP[n];
    else delete input.dataset.wave;
  };
  const clearBalls = () => inputs.forEach(input => { input.value = ''; updateBall(input); });
  const fillBalls = nums => inputs.forEach((input, i) => {
    input.value = pad2(nums[i]); updateBall(input);
  });
  const finishBall = (input, i) => {
    const n = Number(input.value);
    if (!/^\d{1,2}$/.test(input.value) || n < 1 || n > 49) return false;
    input.value = pad2(n);
    updateBall(input);
    if (i < inputs.length - 1) inputs[i + 1].focus();
    return true;
  };
  inputs.forEach((input, i) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 2);
      updateBall(input);
      if ((input.value.length === 2 || /^[5-9]$/.test(input.value)) && finishBall(input, i)) return;
    });
    input.addEventListener('blur', () => {
      const n = Number(input.value);
      if (/^\d{1,2}$/.test(input.value) && n >= 1 && n <= 49) input.value = pad2(n);
      updateBall(input);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !input.value && i > 0) {
        e.preventDefault(); inputs[i - 1].focus();
      } else if (e.key === ' ' || e.key === ',' || e.key === '，') {
        e.preventDefault(); finishBall(input, i);
      }
    });
    input.addEventListener('paste', e => {
      const text = e.clipboardData?.getData('text') || '';
      const nums = (text.match(/\d+/g) || []).map(Number);
      if (nums.length < 2) return; // 单个号码交给浏览器正常粘贴
      e.preventDefault();
      if (!validSevenNums(nums)) return showFlash('请粘贴 7 个不重复的 01–49 有效号码', true);
      fillBalls(nums);
    });
  });
  $('quickPaste').addEventListener('input', e => {
    const nums = (e.target.value.match(/\d+/g) || []).map(Number);
    clearBalls();
    if (validSevenNums(nums)) fillBalls(nums);
  });
  $('submitDraw').addEventListener('click', () => {
    const p = parseLabel($('periodLabel').value);
    const nums = inputs.map(x => Number(x.value));
    if (!p) return showFlash('期号格式应为 YYYY-NNN', true);
    if (!validSevenNums(nums)) return showFlash('请填满 7 个不重复的 01–49 有效号码', true);
    const draw = normalizeDrawRecord({ ...p, date: periodToDate(p.year, p.periodNum), numbers: nums.slice(0, 6), special: nums[6] });
    if (!saveDraws(mergeDraws(localDraws, [draw]).merged)) return;
    clearBalls(); $('quickPaste').value = '';
    rebuild(); showFlash(`已保存 ${p.label}，推荐与回放正在更新`);
  });
  $('undoDraw').addEventListener('click', () => {
    if (!localDraws.length) return;
    const latest = localDraws.reduce((a, b) => a.year * 1000 + a.periodNum > b.year * 1000 + b.periodNum ? a : b);
    if (!saveDraws(localDraws.filter(d => d.id !== latest.id))) return;
    rebuild(); showFlash(`已撤销本地记录 ${latest.id}`);
  });
  $('clearData').addEventListener('click', () => {
    if (!localDraws.length || !window.confirm('确认清空所有本地新增和同步记录吗？')) return;
    if (saveDraws([])) { rebuild(); showFlash('已清空本地记录'); }
  });
  $('exportBtn').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ draws: localDraws }, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = '特码六档精选_备份.json'; a.click(); URL.revokeObjectURL(url);
  });
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async e => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      let rows = Array.isArray(obj) ? obj : obj.draws;
      if (!Array.isArray(rows)) throw new Error('缺少开奖记录');
      if (rows.length && Array.isArray(rows[0])) {
        if (!Array.isArray(obj.labels) || obj.labels.length !== rows.length) throw new Error('期号与号码数量不一致');
        rows = rows.map((nums, i) => {
          const p = parseLabel(obj.labels[i]);
          if (!p || !validSevenNums(nums)) throw new Error('存在无效记录');
          return { ...p, date: periodToDate(p.year, p.periodNum), numbers: nums.slice(0, 6), special: nums[6] };
        });
      }
      const parsed = rows.map(normalizeDrawRecord);
      if (parsed.some(d => !d || !isUsableDraw(d))) throw new Error('存在无效记录');
      if (saveDraws(mergeDraws(localDraws, parsed).merged)) { rebuild(); showFlash(`已导入 ${parsed.length} 期`); }
    } catch (err) { showFlash(`导入失败：${err.message}`, true); }
    e.target.value = '';
  });
  $('syncNow').addEventListener('click', () => syncNow(true));
  for (const [id, attr, handler] of [
    ['sortModeGroup', 'order', v => { pickOrder = v; renderRecommendations(usable, nextLabel); }],
    ['heatScopeGroup', 'scope', v => { heatScope = v; renderHeatSection(usable); }],
    ['heatSortGroup', 'sort', v => { heatSort = v; renderHeatSection(usable); }]
  ]) {
    const group = $(id);
    group.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
      group.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); handler(btn.dataset[attr]);
    }));
  }
  rebuild();
  if (!window.__SKIP_AUTO_SYNC__ && navigator.onLine !== false) setTimeout(() => syncNow(false), 500);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      const key = `mark6_nst_reloaded_${APP_BUILD}`;
      try {
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, '1');
      } catch { /* 存储不可用时仍允许刷新一次 */ }
      location.reload();
    }, { once: true });
    navigator.serviceWorker.register(`./sw.js?v=${APP_BUILD}`, { updateViaCache: 'none' }).catch(err => console.warn('离线缓存注册失败', err));
  }
  window.__APP_BOOTED__ = true;
}
init();
