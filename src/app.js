/** 特码双方案页面：只核对特码；历史回放仅使用严格早于目标期的数据。 */

import {
  APP_BUILD,
  APP_VERSION_LABEL,
  CACHE_PREFIX,
  DEFAULT_CONFIG,
  getColorForNumber,
  pad2
} from './constants.js';
import { mergeDraws, normalizeDrawRecord, parseDrawsInput, parseQuickDrawInput } from './parser.js';
import { compareDrawSets, describeSourceLag, formatSyncSummary, rawGithubDbUrl } from './sync.js';
import { generateDailyFive } from './dailyfive.js';
import { expectedReturnRate, formatPercent, specialBaseline } from './statistics.js';
import { nextPeriodMeta } from './periods.js';
import { auditDraws } from './audit.js';
import {
  STORAGE_KEYS,
  loadPersistedState,
  persistMigratedState,
  safeSet
} from './storage.js';
import INITIAL_DB from '../data/draws.js';
import { combinedPlan, replayRecord, summarize } from './combined.js';

const PERIOD_SELECT_LIMIT = 120;

const state = {
  config: { ...DEFAULT_CONFIG },
  baseDraws: Array.isArray(INITIAL_DB?.draws) ? INITIAL_DB.draws : [],
  localDraws: [],
  allDraws: [],
  periodKey: 'NEXT',
  storageErrors: []
};

/** 快速录入开奖：解析后的 6 个正码 + 1 个特码 */
const quickEntry = {
  numbers: [],
  special: null,
  msg: '',
  msgType: ''
};

const planCache = new Map();
const combined = { includeRandom: true, records: [], token: 0 };


/* ==================== 小工具 ==================== */

const $ = (id) => document.getElementById(id);

const on = (id, evt, fn, opts) => {
  const el = $(id);
  if (el) el.addEventListener(evt, fn, opts);
};

function currentStake() {
  const v = Number(state.config.stake);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_CONFIG.stake;
}

function currentOdds() {
  const v = Number(state.config.oddsSpecial);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_CONFIG.oddsSpecial;
}

function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast-msg';
  el.textContent = msg;
  $('toastContainer')?.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function showBootError(msg) {
  if (typeof window.__SHOW_BOOT_ERROR__ === 'function') {
    window.__SHOW_BOOT_ERROR__(msg);
  } else {
    console.error('[boot]', msg);
  }
}

async function copyText(text, label = '已复制到剪贴板') {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    showToast(`✓ ${label}`);
  } catch {
    showToast('复制失败，请手动选择复制');
  }
}

const numsText = (nums) => (nums || []).map(pad2).join(' ');

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function miniBallHtml(num, opts = {}) {
  const n = Number(num);
  const cls = ['d-num'];
  if (opts.special) cls.push('special');
  if (opts.hit) cls.push('hit');
  if (opts.shared) cls.push('shared');
  const titleParts = [pad2(n)];
  if (opts.special) titleParts.push('（当期特码，本模块唯一命中判定球）');
  else if (opts.normalBall) titleParts.push('（正码，特码模块不计入命中）');
  if (opts.sharedCount >= 2) titleParts.push(`（跨组重叠：共 ${opts.sharedCount} 组推荐）`);
  return `<span class="${cls.join(' ')}" title="${escapeHtml(titleParts.join(''))}">${pad2(n)}</span>`;
}

/* ==================== 跨设备对齐（URL 分享参数） ==================== */

const URL_KEYS = { period: 'p' };

function readShareParams() {
  const out = {};
  try {
    const q = new URLSearchParams(window.location.search || '');
    const p = q.get(URL_KEYS.period);
    if (p && /^(NEXT|\d{4}-\d{1,3})$/.test(p)) out.period = p;
  } catch (err) {
    console.warn('[share] 网址参数解析失败', err);
  }
  return out;
}

function applyShareParams() {
  const shared = readShareParams();
  if (shared.period) {
    const exists = shared.period === 'NEXT' || state.allDraws.some((d) => d.id === shared.period);
    state.periodKey = exists ? shared.period : 'NEXT';
  }
  writeShareParams();
}

function writeShareParams() {
  if (typeof window.history?.replaceState !== 'function') return;
  try {
    const q = new URLSearchParams(window.location.search || '');
    q.set(URL_KEYS.period, state.periodKey);
    q.delete('salt');
    q.delete('m');
    window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}${window.location.hash || ''}`);
  } catch (err) {
    console.warn('[share] 网址参数写入失败', err);
  }
}

function renderShareTag() {
  const el = $('heroShare');
  if (!el) return;
  const latest = state.allDraws[0];
  el.hidden = false;
  el.textContent = `${state.periodKey === 'NEXT' ? '下一期' : state.periodKey}`
    + (latest ? ` · 本机底库 ${latest.id}` : '');
  el.title = '号码由系统按期号确定性生成，谁打开都一样；点一下复制当前网址';
}

/* ==================== 存储与数据 ==================== */

function loadSavedState() {
  const persisted = loadPersistedState(window.localStorage, {
    defaults: DEFAULT_CONFIG,
    normalizeDrawRecord
  });
  state.config = persisted.config;
  state.localDraws = persisted.localDraws;
  state.storageErrors = persisted.errors || [];
  if (persisted.migrations.length) {
    persistMigratedState(window.localStorage, persisted);
    console.info('[storage] 已迁移旧键：', persisted.migrations.join(', '));
  }
  rebuildMergedDraws();
}

function saveConfig() {
  safeSet(window.localStorage, STORAGE_KEYS.CONFIG, state.config);
}
function saveLocalDraws() {
  safeSet(window.localStorage, STORAGE_KEYS.LOCAL_DRAWS, state.localDraws);
}
function rebuildMergedDraws() {
  state.allDraws = mergeDraws(state.baseDraws, state.localDraws).merged;
  planCache.clear();
}

function getNextDrawMeta() {
  return nextPeriodMeta(state.allDraws[0] || { year: 2026, periodNum: 302, date: '2026-10-29' });
}

function getPeriodContext() {
  if (state.periodKey !== 'NEXT') {
    const found = state.allDraws.find((d) => d.id === state.periodKey);
    if (found) {
      return {
        target: {
          id: found.id,
          year: found.year,
          periodNum: found.periodNum,
          period: found.period,
          date: found.date,
          isUpcoming: false
        },
        draw: found,
        isUpcoming: false
      };
    }
  }
  return { target: getNextDrawMeta(), draw: null, isUpcoming: true };
}

function getThreePlan(target) {
  const sig = `${target.year}-${target.periodNum}|${state.allDraws.length}:${state.allDraws[0]?.id || ''}`;
  if (!planCache.has(sig)) {
    planCache.set(sig, generateDailyFive(
      state.allDraws,
      { year: target.year, periodNum: target.periodNum, date: target.date }
    ));
  }
  return planCache.get(sig);
}

/* ==================== 文案（复制与赔率提示） ==================== */

function renderOddsNote() {
  const el = $('cfgOddsNote');
  if (!el) return;
  const odds = currentOdds();
  const base = specialBaseline();
  const ev = expectedReturnRate(odds);
  const flag = ev > 1 + 1e-6 ? ' ⚠ 高于公平赔率，请核对赔率' : '';
  el.textContent = `每个号码为 1 注。单注理论命中率 ${formatPercent(base.hitProb, 4)}，公平赔率 ${base.fairOdds} 倍；当前赔率 ${odds} 倍，理论回报率 ${formatPercent(ev, 2)}${flag}。`;
}

/* ==================== 渲染：顶栏与期数 ==================== */

function renderHeader() {
  const latest = state.allDraws[0];
  const years = [...new Set(state.allDraws.map((d) => d.year))].sort((a, b) => a - b);
  const badge = $('dbBadge');
  if (badge) {
    badge.textContent = `${state.allDraws.length} 期${years.length ? ` (${years[0]}–${years[years.length - 1]})` : ''}`;
    badge.classList.remove('badge-error');
  }
  const latestLine = $('latestLine');
  if (latest && latestLine) {
    latestLine.textContent = `最新 ${latest.year}年第${latest.period}期 (${latest.date})：${numsText(latest.numbers)} + 特 ${pad2(latest.special)}`;
  }
  const cfgStake = $('cfgStake');
  if (cfgStake) cfgStake.value = state.config.stake;
  const cfgOddsSpecial = $('cfgOddsSpecial');
  if (cfgOddsSpecial) cfgOddsSpecial.value = state.config.oddsSpecial ?? DEFAULT_CONFIG.oddsSpecial;
  renderOddsNote();
  const buildTag = $('buildTag');
  if (buildTag) buildTag.textContent = APP_VERSION_LABEL;
  const buildFooter = $('buildTagFooter');
  if (buildFooter) buildFooter.textContent = APP_VERSION_LABEL;
}

function populatePeriodSelect() {
  const select = $('periodSelect');
  if (!select) return;
  const next = getNextDrawMeta();
  const opts = [`<option value="NEXT">下一期 ${next.year}年第${next.period}期 (${next.date})</option>`];
  const recent = state.allDraws.slice(0, PERIOD_SELECT_LIMIT);
  if (state.periodKey !== 'NEXT' && !recent.some((d) => d.id === state.periodKey)) {
    const d = state.allDraws.find((x) => x.id === state.periodKey);
    if (d) opts.push(`<option value="${escapeHtml(d.id)}">${d.year}年第${d.period}期 (${escapeHtml(d.date)})</option>`);
  }
  for (const d of recent) {
    opts.push(`<option value="${escapeHtml(d.id)}">${d.year}年第${d.period}期 (${escapeHtml(d.date)}) · ${numsText(d.numbers)} + ${pad2(d.special)}</option>`);
  }
  select.innerHTML = opts.join('');
  select.value = state.periodKey;
  if (select.value !== state.periodKey) select.value = 'NEXT';
}

/* ==================== 渲染：② 今日推荐（特码三组 7 码） ==================== */

function renderToday() {
  const ctx = getPeriodContext();
  const plan = getThreePlan(ctx.target);
  const t = ctx.target;
  $('heroPeriod').textContent = `${t.year}年第${t.period}期 · ${ctx.isUpcoming ? '待开奖' : '已开奖'}`;
  $('heroMeta').textContent = '每号 1 注 · 仅核对特码';
  renderShareTag();
  writeShareParams();
  renderDualBoard(ctx, plan);
}

/* 双方案与独立全量回测 */
function renderDualBoard(ctx, threePlan) {
  const p = combinedPlan(state.allDraws, ctx.target, threePlan);
  const a = combined.includeRandom ? p.a : p.aPure;
  const shared = new Set(a.filter(n => p.b.includes(n)));
  const balls = (numbers, scheme) => numbers.length ? numbers.map(n => {
    const tag = scheme === 'a' && p.twelve.styles[n] === 'random' ? '🎲' :
      scheme === 'b' ? (p.twelve.styles[n] === 'hot' ? '🔥热' : '🎯冷') : '';
    return `<span class="dual-number${shared.has(n) ? ' dual-shared' : ''}"><b>${pad2(n)}</b>${tag ? `<small>${tag}</small>` : ''}</span>`;
  }).join('') : '<span class="hint-line">本期没有共同号（0 注）</span>';
  const result = nums => ctx.draw ? ` · 特码 ${pad2(ctx.draw.special)} ${nums.includes(Number(ctx.draw.special)) ? '✓ 命中' : '未命中'}` : '';
  $('dualBoard').innerHTML = `<div class="dual-heading"><div><span class="dual-eyebrow">SPECIAL NUMBER / TWO PLANS</span><h2>双方案精选看板</h2><p>两种方案同时呈现 · 金色描边为 A、B 重叠核心号</p></div><span class="dual-core">共同核心 ${shared.size ? [...shared].map(pad2).join(' · ') : '暂无'}</span></div>
    <div class="dual-grid"><article class="dual-card plan-a"><span class="plan-label">PLAN A · 双工具共振</span><h3>双工具共振共同号</h3><p>工具 1 的 12 码 ∩ 工具 2 三组去重并集</p><div class="dual-balls">${balls(a, 'a')}</div><div class="dual-meta">${a.length} 注${result(a)}</div><label class="random-toggle"><input type="checkbox" id="includeRandom" ${combined.includeRandom ? 'checked' : ''}> 包含 🎲 随机撞号 <small>关闭则只留纯精选共振</small></label></article>
    <article class="dual-card plan-b"><span class="plan-label">PLAN B · 热冷精选</span><h3>工具 1 热 + 冷精选</h3><p>🔥 热号 3 码 + 🎯 冷号 2 码</p><div class="dual-balls">${balls(p.b, 'b')}</div><div class="dual-meta">${p.b.length} 注${result(p.b)}</div></article></div>
    <p class="dual-disclaimer">每号 1 注 · 号码仅供参考，任何选号方法均不能改变单注 1/49 的理论命中概率。</p>`;

}

let combinedTimer;
function scheduleCombinedReplay() {
  ++combined.token;
  clearTimeout(combinedTimer);
  combined.records = [];
  $('yearlyBody').innerHTML = '';
  $('combinedBody').innerHTML = '';
  $('combinedCount').textContent = '—';
  $('combinedStatus').textContent = '准备计算全量历史…';
  combinedTimer = setTimeout(() => {
    if (typeof document === 'undefined') return;
    runCombinedReplay().catch(err => {
      console.error('[combined replay]', err);
      const status = $('combinedStatus');
      if (status) status.textContent = `回测计算失败：${err.message}`;
    });
  }, 1800);
}

async function runCombinedReplay() {
  const token = ++combined.token;
  const draws = state.allDraws;
  combined.records = [];
  $('yearlyBody').innerHTML = '';
  $('combinedBody').innerHTML = '';
  const records = [];
  for (let i = 0; i < draws.length; i += 8) {
    if (token !== combined.token || typeof document === 'undefined') return;
    for (const d of draws.slice(i, i + 8)) {
      const record = replayRecord(draws, d);
      if (record) records.push(record);
    }
    $('combinedStatus').textContent = `正在回放 ${Math.min(i + 8, draws.length)} / ${draws.length} 期…`;
    await new Promise(r => setTimeout(r, 0));
  }
  if (token !== combined.token || typeof document === 'undefined') return;
  combined.records = records;
  $('combinedStatus').textContent = `✓ 全量回放 ${records.length} 期，隔离 ${draws.length - records.length} 期无效开奖；最早期历史不足时使用引擎原生兜底。`;
  renderCombinedReplay();
}

function selectedCombinedKey() {
  const selection = $('combinedStrategy').value;
  if (selection === 'b') return 'b';
  if (selection === 'ab') return combined.includeRandom ? 'ab' : 'abPure';
  return combined.includeRandom ? 'a' : 'aPure';
}

function renderCombinedReplay() {
  const select = $('combinedStrategy');
  if (!select) return;
  $('historyIncludeRandom').checked = combined.includeRandom;
  $('historyRandomLabel').hidden = select.value === 'b';
  $('combinedTerms').hidden = select.value !== 'ab';
  if (!combined.records.length) return;
  const key = selectedCombinedKey(), stake = currentStake(), odds = currentOdds();
  const currency = n => `${n > 0 ? '+' : ''}${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 元`;
  const row = (label, records) => {
    const v = summarize(records, key, stake, odds);
    return `<tr><td>${label}</td><td>${v.periods}</td><td>${v.bets}</td><td>${v.hits}</td><td>${(v.hitRate * 100).toFixed(3)}%</td><td>${currency(v.net)}</td><td>${(v.roi * 100).toFixed(2)}%</td><td>${v.maxDrawdown.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 元</td><td>${v.longestLosing} 期</td></tr>`;
  };
  const years = [...new Set([2022, 2023, 2024, 2025, 2026, ...combined.records.map(r => r.draw.year)])].sort((a,b) => a-b);
  $('yearlyBody').innerHTML = years.map(y => row(y, combined.records.filter(r => r.draw.year === y))).join('') + row('总计', combined.records);
  $('combinedCount').textContent = `共 ${combined.records.length} 期`;
  $('combinedBody').innerHTML = combined.records.map((r, index) => {
    const nums = r.picks[key], hits = nums.filter(n => n === Number(r.draw.special)).length;
    const hit = hits > 0;
    const normalBalls = r.draw.numbers.map(n => miniBallHtml(n, { normalBall: true })).join('');
    const specialBall = miniBallHtml(r.draw.special, { special: true, hit });
    return `<tr class="main-row${hit ? ' row-win' : ''}" data-replay-row="${index}"><td class="col-period">${escapeHtml(r.draw.id)}<small>${escapeHtml(r.draw.date || '')}</small></td><td class="col-draw"><div class="draw-balls">${normalBalls}<span class="d-sep"></span>${specialBall}</div></td><td class="col-hits"><span class="tk-pill${hit ? ' win' : ''}">${hit ? '命中' : '未中'} ${hits}/${nums.length}</span></td><td class="col-expand"><button type="button" class="replay-expand" data-replay-index="${index}" aria-expanded="false" aria-label="展开 ${escapeHtml(r.draw.id)} 推荐号码">展开 ▾</button></td></tr>`;
  }).join('');
}

/* ==================== 数据变更后统一刷新 ==================== */

function refreshAfterDataChange() {
  rebuildMergedDraws();
  renderHeader();
  populatePeriodSelect();
  renderToday();
  renderSyncPanel();
  renderQuickEntry();
  scheduleCombinedReplay();
}

function stepPeriod(dir) {
  const all = state.allDraws;
  if (!all.length) { showToast('没有可切换的期次'); return; }
  const idx = all.findIndex((d) => d.id === state.periodKey);
  if (idx === -1) {
    const target = dir > 0 ? all[0] : null;
    if (!target) { showToast('已经是最新一期'); return; }
    state.periodKey = target.id;
  } else {
    const nextIdx = idx + dir;
    if (nextIdx < 0) { state.periodKey = 'NEXT'; }
    else if (nextIdx >= all.length) { showToast('已经是最新一期'); return; }
    else { state.periodKey = all[nextIdx].id; }
  }
  const sel = $('periodSelect');
  if (sel) sel.value = state.periodKey;
  renderToday();
  const label = state.periodKey === 'NEXT' ? '下一期' : state.periodKey;
  showToast(`已切换到 ${label}`);
}

/* ==================== 快速录入开奖（粘贴自动识别 1–49） ==================== */

function setQuickMsg(text, type = '') {
  quickEntry.msg = text || '';
  quickEntry.msgType = type;
  const el = $('quickMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = `quick-msg${type ? ' ' + type : ''}`;
}

function renderQuickPreview() {
  const el = $('quickPreview');
  if (!el) return;
  const { numbers, special } = quickEntry;
  if (!numbers.length && special == null) {
    el.innerHTML = '<span class="quick-preview-empty">把开奖号码粘贴到上面输入框，自动识别 6 正码 + 1 特码。</span>';
    return;
  }
  const regularHtml = numbers
    .map((n) => `<span class="lotto-ball sm ${getColorForNumber(n)}" title="正码">${pad2(n)}</span>`)
    .join('');
  const specialHtml = special != null
    ? `<span class="ball-plus">+</span><span class="lotto-ball sm ${getColorForNumber(special)}" title="特码">${pad2(special)}</span>`
    : `<span class="quick-preview-label">还差 ${7 - numbers.length} 个号码（需要 6 正码 + 1 特码）</span>`;
  el.innerHTML = `<span class="quick-preview-label">正码</span>${regularHtml}${specialHtml}`;
}

function renderQuickEntry() {
  const meta = getNextDrawMeta();
  const periodEl = $('quickPeriod');
  const dateEl = $('quickDate');
  if (periodEl) periodEl.textContent = `${meta.year}-${meta.period}`;
  if (dateEl) dateEl.textContent = meta.date;
  renderQuickPreview();
  setQuickMsg(quickEntry.msg, quickEntry.msgType);
}

function fillQuickEntry(numbers, special) {
  // 正码按从小到大排列（与图片里的「自动升序排列」一致），特码单独保留
  const regular = [...new Set(numbers.slice(0, 6))]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 49)
    .sort((a, b) => a - b);
  quickEntry.numbers = regular;
  quickEntry.special = Number.isInteger(special) && special >= 1 && special <= 49 && !regular.includes(special)
    ? special
    : null;
  renderQuickEntry();
  return quickEntry.numbers.length + (quickEntry.special != null ? 1 : 0);
}

function recognizeQuickInput() {
  const input = $('quickPasteInput');
  const text = input ? input.value : '';
  if (!text.trim()) {
    setQuickMsg('先粘贴或输入号码，例如 05 14 23 31 38 45 + 08', 'bad');
    return;
  }
  const parsed = parseQuickDrawInput(text);
  if (parsed.special == null) {
    setQuickMsg(`只识别到 ${parsed.numbers.length} 个有效号码（需要 6 正码 + 1 特码，范围 1–49）`, 'bad');
    return;
  }
  const count = fillQuickEntry(parsed.numbers, parsed.special);
  if (count !== 7) {
    setQuickMsg('识别出的号码不足 7 个有效号码（1–49 且不重复），请检查后重试', 'bad');
    return;
  }
  const extra = parsed.ignored > 0 ? `，已忽略多余号码 ${parsed.ignored} 个` : '';
  setQuickMsg(`✓ 已识别 6 正码 + 特码 ${pad2(parsed.special)}${extra}`, 'good');
}

function fillQuickDemo() {
  const meta = getNextDrawMeta();
  quickEntry.numbers = [8, 14, 23, 26, 31, 45];
  quickEntry.special = 12;
  const input = $('quickPasteInput');
  if (input) input.value = `${meta.periodNum}期 ${meta.date} 08 14 23 26 31 45 + 12`;
  renderQuickEntry();
  setQuickMsg('已填入示例：08 14 23 26 31 45 为正码，12 为特码', 'good');
}

function clearQuickEntry() {
  quickEntry.numbers = [];
  quickEntry.special = null;
  const input = $('quickPasteInput');
  if (input) input.value = '';
  renderQuickEntry();
  setQuickMsg('', '');
}

function saveQuickEntry() {
  // 用户可能刚粘贴完就点保存：此时防抖还没回填，先从输入框再识别一次
  if (quickEntry.numbers.length !== 6 || quickEntry.special == null) {
    const input = $('quickPasteInput');
    const text = input ? input.value.trim() : '';
    if (text) {
      const parsed = parseQuickDrawInput(text);
      if (parsed.special != null) fillQuickEntry(parsed.numbers, parsed.special);
    }
  }
  if (quickEntry.numbers.length !== 6 || quickEntry.special == null) {
    setQuickMsg('还差 6 正码 + 1 特码：请把 7 个号码粘贴到输入框后点「识别」', 'bad');
    return;
  }
  const meta = getNextDrawMeta();
  const record = normalizeDrawRecord({
    year: meta.year,
    periodNum: meta.periodNum,
    date: meta.date,
    numbers: quickEntry.numbers,
    special: quickEntry.special
  });
  if (!record) {
    setQuickMsg('号码不符合规则：必须是 1–49 且不重复的 7 个号码', 'bad');
    return;
  }
  const exists = state.allDraws.some((d) => d.id === record.id);
  if (exists && !window.confirm(`第 ${record.id} 期已存在，是否用本次录入覆盖本机记录？`)) {
    return;
  }
  state.localDraws = mergeDraws(state.localDraws, [record]).merged;
  saveLocalDraws();
  quickEntry.numbers = [];
  quickEntry.special = null;
  const input = $('quickPasteInput');
  if (input) input.value = '';
  refreshAfterDataChange();
  renderQuickEntry();
  setQuickMsg(`✓ 已保存第 ${record.id} 期到本机开奖`, 'good');
  showToast(`已录入第 ${record.id} 期开奖`);
}

/* ==================== 事件绑定 ==================== */

function bindEvents() {
  /* 今日推荐 */
  on('periodSelect', 'change', (e) => {
    state.periodKey = e.target.value;
    renderToday();
  });
  on('btnNext', 'click', () => {
    state.periodKey = 'NEXT';
    if ($('periodSelect')) $('periodSelect').value = 'NEXT';
    renderToday();
  });
  const copyPlans = () => {
    const ctx = getPeriodContext();
    const p = combinedPlan(state.allDraws, ctx.target, getThreePlan(ctx.target));
    const a = combined.includeRandom ? p.a : p.aPure;
    copyText(`方案 A：${a.length ? a.map(pad2).join('、') : '无'}\n方案 B：${p.b.map(pad2).join('、')}`, '双方案已复制');
  };
  on('btnCopyAll', 'click', copyPlans);
  on('btnCopyAllMobile', 'click', copyPlans);
  on('btnPrevPeriod', 'click', () => stepPeriod(1));
  on('btnNextPeriod', 'click', () => stepPeriod(-1));
  on('heroShare', 'click', () => {
    copyText(window.location.href, '链接已复制 · 另一台设备打开就是同一组号码');
  });

  /* 方案开关与回放 */
  const setIncludeRandom = (checked) => {
    combined.includeRandom = checked;
    renderToday();
    renderCombinedReplay();
  };
  on('dualBoard', 'change', (e) => { if (e.target.id === 'includeRandom') setIncludeRandom(e.target.checked); });
  on('historyIncludeRandom', 'change', (e) => setIncludeRandom(e.target.checked));
  on('combinedStrategy', 'change', () => renderCombinedReplay());
  on('combinedBody', 'click', (e) => {
    const row = e.target.closest('[data-replay-row]');
    if (!row) return;
    const button = row.querySelector('[data-replay-index]');
    const index = Number(button.dataset.replayIndex);
    const record = combined.records[index];
    if (!record) return;
    const tr = button.closest('tr');
    if (button.getAttribute('aria-expanded') === 'true') {
      tr.nextElementSibling?.remove();
      button.setAttribute('aria-expanded', 'false');
      button.textContent = '展开 ▾';
      button.setAttribute('aria-label', `展开 ${record.draw.id} 推荐号码`);
      return;
    }
    const key = selectedCombinedKey();
    const nums = record.picks[key];
    const hits = nums.filter(n => n === Number(record.draw.special)).length;
    const hit = hits > 0;
    const label = key === 'b' ? '方案 B · 热冷精选' : key === 'ab' || key === 'abPure' ? '方案 A + 方案 B · 重叠号码各计一注' : '方案 A · 双工具共振';
    const balls = nums.map(n => miniBallHtml(n, { hit: n === Number(record.draw.special) })).join('');
    tr.insertAdjacentHTML('afterend', `<tr class="feat-detail"><td colspan="4"><div class="fd-head">${label} <span class="fd-nums">${balls || '本期无推荐号码'}</span></div><div class="fd-line"><span class="badge ${hit ? 'hit' : 'miss'}">${hit ? '命中' : '未中'}</span> ${hit ? `命中特码 ${pad2(record.draw.special)} · 中 ${hits} 注` : `本期开奖号码 ${pad2(record.draw.special)} 不在推荐中`}</div></td></tr>`);
    button.setAttribute('aria-expanded', 'true');
    button.textContent = '收起 ▴';
    button.setAttribute('aria-label', `收起 ${record.draw.id} 推荐号码`);
  });

  /* 设置与缓存 */
  ['cfgStake', 'cfgOddsSpecial'].forEach((id) => {
    on(id, 'input', () => {
      const stake = Number($('cfgStake').value);
      const oddsSpecial = Number($('cfgOddsSpecial').value);
      if (!Number.isFinite(stake) || stake <= 0) { showToast('⚠ 单注本金必须是大于 0 的数字'); renderHeader(); return; }
      if (!Number.isFinite(oddsSpecial) || oddsSpecial <= 0) { showToast('⚠ 特码赔率必须是大于 0 的数字'); return; }
      state.config = { ...state.config, stake, oddsSpecial, playMode: 'special' };
      saveConfig();
      renderHeader();
      renderToday();
      renderCombinedReplay();
    });
  });
  on('btnResetCfg', 'click', () => {
    state.config = { ...DEFAULT_CONFIG };
    saveConfig();
    renderHeader();
    renderToday();
    renderCombinedReplay();
    showToast('已恢复默认本金与赔率');
  });
  on('btnCheckUpdate', 'click', async () => {
    const status = $('updateStatus');
    status.textContent = '正在检查更新…';
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) { status.textContent = '尚未注册 Service Worker（可能以 file:// 打开或浏览器限制）。'; return; }
      await reg.update();
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        status.textContent = '发现新版本，正在应用…';
      } else {
        status.textContent = `✓ 已是最新版本（构建 ${APP_BUILD}）。`;
      }
    } catch (err) {
      status.textContent = `检查更新失败：${err.message}`;
    }
  });
  on('btnRepairCache', 'click', () => repairCache({ message: '已清理旧缓存，正在重新载入…' }));
  on('btnResetServiceWorker', 'click', () => repairCache({ hard: true, message: '已注销 Service Worker 并清空缓存，正在重新载入…' }));
  if (!window.__BOOT_REPAIR_BOUND__) {
    on('btnBootReload', 'click', () => location.reload());
    on('btnBootRepair', 'click', () => repairCache({ message: '已清理旧缓存，正在重新载入…' }));
  }

  /* 数据同步 */
  on('btnSyncCheck', 'click', () => runSync({ write: false }));
  on('btnSyncNow', 'click', () => runSync({ write: true }));
  on('btnSyncFix', 'click', () => runSync({ write: false, fix: true }));

  /* 快速录入开奖（粘贴自动识别 1–49） */
  on('btnQuickRecognize', 'click', recognizeQuickInput);
  on('btnQuickDemo', 'click', fillQuickDemo);
  on('btnQuickClear', 'click', clearQuickEntry);
  on('btnQuickSave', 'click', saveQuickEntry);
  on('quickPasteInput', 'keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      recognizeQuickInput();
    }
  });
  // 粘贴即自动识别；手动输入时凑满 7 个有效号码也会自动填好
  on('quickPasteInput', 'paste', () => setTimeout(recognizeQuickInput, 0));
  let quickInputTimer = null;
  on('quickPasteInput', 'input', () => {
    clearTimeout(quickInputTimer);
    quickInputTimer = setTimeout(() => {
      const input = $('quickPasteInput');
      const text = input ? input.value : '';
      if (!text.trim()) return;
      const parsed = parseQuickDrawInput(text);
      if (parsed.special != null) {
        fillQuickEntry(parsed.numbers, parsed.special);
        setQuickMsg(`✓ 自动识别 6 正码 + 特码 ${pad2(parsed.special)}`, 'good');
      }
    }, 350);
  });

  on('btnExportDb', 'click', () => {
    const payload = {
      updatedAt: new Date().toISOString(),
      build: APP_BUILD,
      source: DEFAULT_CONFIG.remoteSourceUrl,
      totalCount: state.allDraws.length,
      latestId: state.allDraws[0]?.id || null,
      draws: state.allDraws
    };
    downloadJson(payload, `draws-${state.allDraws[0]?.id || 'export'}.json`);
    showToast(`已导出 ${state.allDraws.length} 期底库 JSON`);
  });

  on('btnPastePreview', 'click', () => {
    const msg = $('pasteMsg');
    const parsed = parseDrawsInput($('pasteBox').value || '');
    if (!parsed.length) {
      msg.textContent = '✕ 没识别出有效记录（需要期号 + 6正码 + 特码，号码必须在 1–49 且不重复）';
      showToast('✕ 粘贴内容没有解析出开奖记录');
      return;
    }
    const r = compareDrawSets(state.allDraws, parsed);
    const head = parsed[0];
    const tail = parsed[parsed.length - 1];
    msg.textContent = `✓ 解析 ${parsed.length} 期（${head.id} ~ ${tail.id}）：${formatSyncSummary(r)}`;
    showToast(`解析到 ${parsed.length} 期`);
  });

  on('btnPasteMerge', 'click', () => {
    const msg = $('pasteMsg');
    const parsed = parseDrawsInput($('pasteBox').value || '');
    if (!parsed.length) {
      msg.textContent = '✕ 没识别出有效记录（需要期号 + 6正码 + 特码，号码必须在 1–49 且不重复）';
      showToast('✕ 粘贴内容没有解析出开奖记录');
      return;
    }
    const r = compareDrawSets(state.allDraws, parsed);
    if (!r.appendable.length) {
      msg.textContent = `没有可追加的期次${r.gapCount ? `（期号缺口：${r.gaps.map((g) => g.expected).join('、')}，已停止追加）` : ''}`;
      showToast('没有可追加的期次');
      return;
    }
    state.localDraws = mergeDraws(state.localDraws, r.appendable).merged;
    saveLocalDraws();
    refreshAfterDataChange();
    msg.textContent = `✓ 已追加 ${r.appendable.length} 期（${r.appendable[0].id} ~ ${r.appendable[r.appendable.length - 1].id}），现在共 ${state.allDraws.length} 期`;
    showToast(`已追加 ${r.appendable.length} 期`);
  });

  on('btnPasteDemo', 'click', () => {
    const next = getNextDrawMeta();
    $('pasteBox').value = `${next.periodNum}期(开奖时间:${next.date})\n08 猪 14 蛇 23 猴 26 蛇 31 鼠 45 狗 12 羊`;
  });

  on('btnPasteClear', 'click', () => {
    $('pasteBox').value = '';
    $('pasteMsg').textContent = '';
  });

  on('btnExportLocal', 'click', () => {
    if (!state.localDraws.length) { showToast('本机没有手动录入的开奖'); return; }
    downloadJson({
      updatedAt: new Date().toISOString(),
      build: APP_BUILD,
      totalCount: state.localDraws.length,
      draws: state.localDraws
    }, `local-draws-${state.localDraws[0]?.id || 'export'}.json`);
    showToast(`已导出 ${state.localDraws.length} 期本机开奖`);
  });

  on('fileInputLocal', 'change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      let incoming = null;
      try {
        const parsed = JSON.parse(text);
        incoming = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.draws) ? parsed.draws : null);
      } catch { /* 走通用文本解析 */ }
      const records = incoming
        ? incoming.map(normalizeDrawRecord).filter(Boolean)
        : parseDrawsInput(text);
      if (!records.length) {
        showToast(`✕ ${file.name} 未解析出开奖记录`);
        $('pasteMsg').textContent = `✕ ${file.name} 未解析出开奖记录`;
        return;
      }
      state.localDraws = mergeDraws(state.localDraws, records).merged;
      saveLocalDraws();
      refreshAfterDataChange();
      $('pasteMsg').textContent = `✓ 从 ${file.name} 导入 ${records.length} 期，现在本机共 ${state.localDraws.length} 期`;
      showToast(`已导入 ${records.length} 期`);
    } catch (err) {
      showToast(`✕ 读取文件失败：${err.message}`);
    } finally {
      e.target.value = '';
    }
  });

  on('btnClearLocalSync', 'click', () => {
    if (!state.localDraws.length) { showToast('本机没有手动录入的开奖'); return; }
    state.localDraws = [];
    saveLocalDraws();
    refreshAfterDataChange();
    $('pasteMsg').textContent = '✓ 已清空本机手动录入的开奖';
    showToast('已清空本机开奖');
  });
}

/* ==================== 数据同步 ==================== */

function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const syncState = {
  remote: null,
  meta: null,
  last: null,
  busy: false,
  revealAudit: false
};

function downloadJson(payload, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function fetchDbJson(url, timeoutMs = 8000) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const draws = (Array.isArray(data.draws) ? data.draws : []).map(normalizeDrawRecord).filter(Boolean);
    if (!draws.length) throw new Error('数据源里没有可用的开奖记录');
    return { data, draws };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchSourceDb() {
  const localUrl = new URL(`./data/draws.json?_r=${Date.now()}`, window.location.href).toString();
  let result = await fetchDbJson(localUrl);
  let via = 'pages';

  const expected = todayIso();
  const localLag = describeSourceLag(result.draws[0], expected);
  if (localLag.ok && localLag.stale) {
    const mirror = rawGithubDbUrl(window.location.href);
    if (mirror) {
      try {
        const fresh = await fetchDbJson(`${mirror}?t=${Date.now()}`, 6000);
        if (describeSourceLag(fresh.draws[0], expected).lagPeriods < localLag.lagPeriods) {
          result = fresh;
          via = 'raw';
        }
      } catch (err) {
        console.info('[sync] 原始文件兜底源不可用，继续用本站静态文件', err.message);
      }
    }
  }

  syncState.remote = result.draws;
  syncState.meta = {
    updatedAt: result.data.updatedAt || '',
    latestId: result.data.latestId || result.draws[0].id,
    totalCount: result.data.totalCount ?? result.draws.length,
    source: result.data.source || '',
    via
  };
  return result.draws;
}

function formatStamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderSyncPanel() {
  const grid = $('syncGrid');
  if (!grid) return;
  const localLatest = state.allDraws[0] || null;
  const r = syncState.last;
  const cell = (label, value, cls) =>
    `<div class="sync-cell${cls ? ' ' + cls : ''}"><span class="sc-label">${label}</span><span class="sc-value">${value}</span></div>`;
  const lag = describeSourceLag(localLatest, todayIso());
  grid.innerHTML = [
    cell('本地最后一期', localLatest ? localLatest.id : '—'),
    cell('数据源最新一期', syncState.meta ? syncState.meta.latestId : '未读取'),
    cell('数据源更新时间', (syncState.meta ? formatStamp(syncState.meta.updatedAt) : '—')
      + (syncState.meta?.via === 'raw' ? '（取自仓库原始文件，Pages 尚在构建）' : '')),
    cell('本机新鲜度', lag.ok ? (lag.stale ? `落后 ${lag.lagPeriods} 期` : '已是最新') : '—',
      lag.ok ? (lag.stale ? 'is-warn' : 'is-good') : ''),
    cell('本次可追加', r ? `${r.missingCount} 期` : '—', r && r.missingCount > 0 ? 'is-good' : ''),
    cell('冲突 / 缺口', r ? `${r.conflictCount} / ${r.gapCount}` : '—', r && (r.conflictCount || r.gapCount) ? 'is-warn' : '')
  ].join('');
  const cnt = $('localCountSync');
  if (cnt) cnt.textContent = String(state.localDraws.length);

  const auditLine = $('auditLine');
  if (auditLine) {
    const report = auditDraws(state.allDraws);
    auditLine.hidden = !syncState.revealAudit;
    if (!syncState.revealAudit) {
      auditLine.innerHTML = '';
    } else {
      auditLine.classList.toggle('is-bad', report.issueCount > 0);
      if (report.issueCount > 0) {
        auditLine.innerHTML = `⚠ ${report.issueCount} 期数据异常，已从统计中排除（不影响其他期）`
          + `<details class="audit-more"><summary>看是哪一期</summary><ul class="audit-list">${report.issues
            .slice(0, 6)
            .map((i) => `<li>${escapeHtml(i.id)}（${escapeHtml(i.date)}）：${escapeHtml(i.message)}</li>`)
            .join('')}</ul></details>`;
      } else {
        auditLine.innerHTML = `<span class="audit-ok">✓ 底库 ${report.usable} 期全部可用于统计</span>`;
      }
    }
  }
}

const REMOTE_CANDIDATES = [
  DEFAULT_CONFIG.remoteSourceUrl,
  `https://api.allorigins.win/raw?url=${encodeURIComponent(DEFAULT_CONFIG.remoteSourceUrl)}`,
  `https://corsproxy.io/?${encodeURIComponent(DEFAULT_CONFIG.remoteSourceUrl)}`,
  // 阅读器代理：返回 Markdown 文本，解析器已兼容 **加粗** 标记
  `https://r.jina.ai/${DEFAULT_CONFIG.remoteSourceUrl}`
];

/** 仓库 Actions 页面：底库落后时引导用户手动触发同步 */
const ACTIONS_URL = 'https://github.com/whitworthbassalips894-crypto/Number-selection-tool/actions';

async function fetchRemoteSourceHtml(timeoutMs = 5000) {
  const attempts = [];
  for (const u of REMOTE_CANDIDATES) {
    const short = u.length > 60 ? `${u.slice(0, 57)}…` : u;
    // 阅读器代理要现场抓取并转换页面，给足 12 秒
    const perTry = u.includes('r.jina.ai') ? Math.max(timeoutMs, 12000) : timeoutMs;
    let timer = null;
    try {
      const ctrl = new AbortController();
      timer = setTimeout(() => ctrl.abort(), perTry);
      const res = await fetch(new URL(u, window.location.href).toString(), { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) {
        attempts.push(`${short} → HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      if (text?.includes('期(开奖时间:')) return { html: text, reason: '', attempts };
      attempts.push(`${short} → 页面里找不到开奖记录（站点结构可能变了）`);
    } catch (err) {
      const msg = err?.name === 'AbortError' ? `超时 ${perTry}ms` : (err?.message || '网络错误');
      attempts.push(`${short} → ${msg}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return {
    html: '',
    reason: attempts.length ? '浏览器直连上游全部失败（上游为非标准端口 + 证书问题，只能由 GitHub Actions 服务器端抓取）' : '未配置远程源',
    attempts
  };
}

async function autoCheckSyncQuietly() {
  if (window.__SKIP_AUTO_SYNC__) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  try {
    await runSync({ write: false, silent: true });
  } catch (err) {
    console.warn('[sync] 自动检查失败（不影响使用）', err);
  }
}

async function runSync({ write = false, fix = false, silent = false } = {}) {
  if (syncState.busy) return;
  syncState.busy = true;
  if (!silent) { syncState.revealAudit = true; renderSyncPanel(); }
  const status = $('syncStatus');
  const btns = ['btnSyncCheck', 'btnSyncNow', 'btnSyncFix'].map((id) => $(id)).filter(Boolean);
  btns.forEach((b) => { b.disabled = true; });
  status.textContent = '正在读取仓库数据源 ./data/draws.json …（如果本站那份还落后，会自动再问一次仓库原始文件）';
  try {
    await fetchSourceDb();
    const r = compareDrawSets(state.allDraws, syncState.remote);
    syncState.last = r;
    renderSyncPanel();

    if (fix) {
      if (!r.conflicts.length) {
        status.textContent = `检查完成：${formatSyncSummary(r)}；没有需要修复的冲突。`;
        showToast('没有冲突需要修复');
        return;
      }
      state.localDraws = mergeDraws(state.localDraws, r.conflicts.map((c) => c.remote)).merged;
      saveLocalDraws();
      refreshAfterDataChange();
      syncState.last = compareDrawSets(state.allDraws, syncState.remote);
      renderSyncPanel();
      status.textContent = `✓ 已按数据源修复 ${r.conflicts.length} 期冲突（${r.conflicts.map((c) => c.id).join('、')}），现在共 ${state.allDraws.length} 期`;
      showToast(`已修复 ${r.conflicts.length} 期冲突`);
      return;
    }

    if (!write) {
      const lagNow = describeSourceLag(state.allDraws[0], todayIso());
      if (r.appendable.length) {
        status.textContent = `仓库里已有 ${r.appendable.length} 期新开奖，点「一键同步」补齐本机。`;
      } else if (silent) {
        const latest = state.allDraws[0];
        status.textContent = `底库最新 ${latest?.id || '—'}${latest?.date ? `（${latest.date}）` : ''}`
          + ` · 今天 ${lagNow.expectedId} ${lagNow.lagPeriods === 0 ? '已入库' : '未开奖（通常 21:40 后公布）'}`;
      } else {
        status.innerHTML = `没有可追加的期次。${escapeHtml(lagNow.message)}`
          + ` <a href="${ACTIONS_URL}" target="_blank" rel="noopener">去 Actions 手动同步底库 →</a>`;
      }
      showToast(r.appendable.length
        ? `可补 ${r.appendable.length} 期，点「一键同步」`
        : (lagNow.stale ? `仓库底库落后 ${lagNow.lagPeriods} 期` : '检查完成'));
      return;
    }

    if (r.appendable.length) {
      state.localDraws = mergeDraws(state.localDraws, r.appendable).merged;
      saveLocalDraws();
      refreshAfterDataChange();
      syncState.last = compareDrawSets(state.allDraws, syncState.remote);
      renderSyncPanel();
      const ids = r.appendable.map((d) => d.id);
      const lagAfter = describeSourceLag(state.allDraws[0], todayIso());
      status.textContent = `✓ 已把 ${r.appendable.length} 期（${ids[0]} ~ ${ids[ids.length - 1]}）追加写入本机，现在共 ${state.allDraws.length} 期；内置底库未改动。${lagAfter.message}`;
      showToast(`已同步 ${r.appendable.length} 期`);
      return;
    }

    const lag = describeSourceLag(state.allDraws[0], todayIso());
    status.textContent = `${lag.base}。仓库文件没有新期次，正在尝试直连上游…`;
    const remote = await fetchRemoteSourceHtml();
    if (!remote.html) {
      status.innerHTML = `仓库文件暂无新期次。${escapeHtml(lag.message)}`
        + `<details class="audit-more"><summary>为什么浏览器抓不到上游</summary>`
        + `<ul class="audit-list"><li>${escapeHtml(remote.reason)}</li>`
        + remote.attempts.map((a) => `<li>${escapeHtml(a)}</li>`).join('')
        + '</ul></details>'
        + ` <a href="${ACTIONS_URL}" target="_blank" rel="noopener">去 Actions 手动同步底库 →</a>`;
      showToast(lag.ok && lag.stale ? `底库落后 ${lag.lagPeriods} 期` : '已是最新，无需同步');
      return;
    }
    const parsed = parseDrawsInput(remote.html);
    const r2 = compareDrawSets(state.allDraws, parsed);
    if (!r2.appendable.length) {
      status.textContent = `同步完成：仓库数据源与上游都没有更新的期次（上游最新 ${r2.remoteLatest?.id || '未知'}）。${lag.message}`;
      showToast('已是最新，无需同步');
      return;
    }
    state.localDraws = mergeDraws(state.localDraws, r2.appendable).merged;
    saveLocalDraws();
    refreshAfterDataChange();
    const ids2 = r2.appendable.map((d) => d.id);
    status.textContent = `✓ 已从远程开奖源补齐 ${r2.appendable.length} 期（${ids2[0]} ~ ${ids2[ids2.length - 1]}），现在共 ${state.allDraws.length} 期；内置底库未改动。`;
    showToast(`已从远程源补齐 ${r2.appendable.length} 期`);
  } catch (err) {
    status.textContent = `读取仓库数据源 ./data/draws.json 失败：${err.message}。`
      + '可能原因：仓库文件未部署 / 网络或离线缓存异常。可先用下方「粘贴导入」临时补期。';
    if (!silent) showToast('读取数据源失败');
    (silent ? console.info : console.warn)('[sync]', err.message);
  } finally {
    syncState.busy = false;
    btns.forEach((b) => { b.disabled = false; });
  }
}

/* ==================== Service Worker / 缓存 ==================== */
async function repairCache(opts = {}) {
  const { hard = false, message = '已清理旧缓存，正在重新载入…' } = opts;
  try {
    if (window.caches?.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      const scopePath = new URL('./', location.href).pathname;
      const mine = regs.filter((r) => {
        try {
          return new URL(r.scope).pathname.startsWith(scopePath);
        } catch {
          return false;
        }
      });
      if (hard) {
        await Promise.all(mine.map((r) => r.unregister()));
      } else {
        await Promise.all(mine.map((r) => r.update().catch(() => {})));
      }
    }
    showToast(message);
    setTimeout(() => {
      const url = new URL(location.href);
      url.searchParams.set('_r', String(Date.now()));
      location.replace(url.toString());
    }, 400);
  } catch (err) {
    showToast(`修复缓存失败：${err.message}，请直接刷新页面重试`);
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.location.protocol.startsWith('http')) return;
  const hadController = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    const key = `mark6_nst_reloaded_${APP_BUILD}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch { /* ignore */ }
    showToast('已更新到最新版本，正在重新载入…');
    setTimeout(() => location.reload(), 400);
  });

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(`./sw.js?v=${APP_BUILD}`, { updateViaCache: 'none' });
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            showToast('发现新版本，正在应用…');
          }
        });
      });
      const status = $('updateStatus');
      if (status) status.textContent = `当前构建：${APP_VERSION_LABEL}（Service Worker 已注册，版本 ${APP_BUILD}）`;
    } catch (err) {
      const status = $('updateStatus');
      if (status) status.textContent = `Service Worker 注册失败：${err.message}（不影响在线使用）`;
    }
  });
}

/* ==================== 初始化 ==================== */

function initApp() {
  loadSavedState();
  applyShareParams();
  renderHeader();
  populatePeriodSelect();
  bindEvents();
  renderToday();
  renderSyncPanel();
  renderQuickEntry();
  scheduleCombinedReplay();
  registerServiceWorker();

  if (state.storageErrors.length) {
    showToast(`⚠ ${state.storageErrors[0]}`);
  }

  autoCheckSyncQuietly();

  window.__APP_BOOTED__ = true;
}

try {
  initApp();
} catch (err) {
  console.error('[boot] 初始化失败', err);
  showBootError(`初始化失败：${err.message}`);
}
