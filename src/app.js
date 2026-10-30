/**
 * 六合彩「特码 · 三组 7 码」前端主控制器
 *
 * 一页流结构：① 数据同步（置顶） → ② 今日号码 → ③ 历史回放 → ④ 设置
 *
 * 规则与形态：
 *  - 仅保留特码模块（已去掉三中三 / 四中四）；
 *  - 特码是「1 中 1」：1 个号 = 1 注（默认 10 元/注、赔率 48 倍）；
 *  - 每期由 3 套特码策略（#1 热态顺势 / #2 遗漏回补 / #3 周期均衡）各自独立推荐 7 码，
 *    每组 7 注，3 组独立累计共 21 注，组与组之间允许号码重叠（重叠号命中则多组叠加返奖）；
 *  - 命中口径：只核对当期开奖的最后一个号码（特码），6 个正码不计入命中；
 *  - 历史回放严格「无未来函数」：第 T 期推荐只用严格早于 T 期的数据。
 */

import {
  APP_BUILD,
  APP_VERSION_LABEL,
  CACHE_PREFIX,
  DEFAULT_CONFIG,
  SPECIAL_GROUP_COUNT,
  SPECIAL_GROUP_SIZE,
  SPECIAL_TOTAL_BETS,
  betsPerTicket,
  getColorForNumber,
  getPlayMode,
  getZodiacForNumber,
  pad2
} from './constants.js';
import { evaluateTickets } from './combinatorics.js';
import { mergeDraws, normalizeDrawRecord, parseDrawsInput } from './parser.js';
import { compareDrawSets, describeSourceLag, formatSyncSummary, rawGithubDbUrl } from './sync.js';
import { formatFiveTickets, formatSingleTicket } from './copy.js';
import {
  buildDailyFiveRecords,
  expandEntryTickets,
  generateDailyFive
} from './dailyfive.js';
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

const PERIOD_SELECT_LIMIT = 120;
const REPLAY_PAGE = 40;
const REPLAY_CHUNK = 25;

const state = {
  config: { ...DEFAULT_CONFIG },
  baseDraws: Array.isArray(INITIAL_DB?.draws) ? INITIAL_DB.draws : [],
  localDraws: [],
  allDraws: [],
  periodKey: 'NEXT',
  storageErrors: []
};

const replay = {
  token: 0,
  records: [],
  filtered: [],
  running: false,
  visible: REPLAY_PAGE,
  expanded: new Set(),
  cursor: -1,
  filters: {
    range: '100',
    hit: 'all' // all = 全部期次 / hit = 只看中奖(≥1注) / multi = 只看重叠多中(≥2注)
  }
};

/** 一条回放记录是否中奖（任意一组命中特码） */
const isWinRecord = (rec) => (rec?.five || []).some((e) => (e.hitCount || 0) > 0);

/** 一条回放记录是否重叠多中（≥2 组同时命中特码） */
const isMultiWinRecord = (rec) => {
  const wins = (rec?.five || []).reduce((acc, e) => acc + (e.hitCount || 0), 0);
  return wins >= 2;
};

/** 按当前筛选条件过滤回放记录 */
function applyReplayFilter(records = replay.records) {
  const hit = replay.filters.hit || 'all';
  if (hit === 'hit') return records.filter(isWinRecord);
  if (hit === 'multi' || hit === 'partial') return records.filter(isMultiWinRecord);
  return records.slice();
}

const planCache = new Map();

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

const betConfig = () => ({
  stake: currentStake(),
  oddsSpecial: currentOdds()
});

function entryTickets(e) {
  return expandEntryTickets(e.numbers, getPlayMode());
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

function money(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${Math.round(v).toLocaleString('zh-CN')} 元`;
}

function amount(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return '—';
  return `${Math.round(v).toLocaleString('zh-CN')} 元`;
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

function ballHtml(num, opts = {}) {
  const n = Number(num);
  const color = getColorForNumber(n);
  const size = opts.size ? ` ${opts.size}` : '';
  const hit = opts.hitSet?.has(n) ? ' ball-hit' : '';
  const dim = opts.dim ? ' ball-special-dim' : '';
  const cons = opts.consensus ? ' ball-consensus' : '';
  const zodiac = opts.zodiac === false ? '' : getZodiacForNumber(n, opts.date || '2026-10-30');
  const attrs = opts.attrs || '';
  const mark = opts.mark ? `<span class="ball-tag" title="${escapeHtml(opts.markLabel || '')}">${escapeHtml(opts.mark)}</span>` : '';
  return `<div class="lotto-ball-wrap" ${attrs}><div class="lotto-ball ${color}${size}${hit}${dim}${cons}">${pad2(n)}${mark}</div>${zodiac ? `<span class="ball-meta">${zodiac}</span>` : ''}</div>`;
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

/**
 * 渲染当期开奖号码行（特码模块：正码不高亮，只有特码命中时高亮特码球）
 */
function drawBallsHtml(draw, opts = {}) {
  if (!draw) return '';
  const coveredSet = opts.hitSet;
  const normals = draw.numbers.map((n) => ballHtml(n, { ...opts, hitSet: null, date: draw.date })).join('');
  const specialHitSet = draw.special != null && coveredSet?.has(draw.special) ? new Set([draw.special]) : null;
  const special = draw.special != null
    ? `<span class="ball-plus">+</span>${ballHtml(draw.special, { ...opts, hitSet: specialHitSet, dim: true, date: draw.date })}`
    : '';
  return normals + special;
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
  const stake = currentStake();
  const odds = currentOdds();
  const base = specialBaseline();
  const ev = expectedReturnRate(odds);
  const fair = base.fairOdds;
  const flag = ev > 1 + 1e-6
    ? ' ⚠ 高于公平赔率（49 倍），期望回报率超过 100%，真实盘口有抽水，请核对赔率'
    : ev > 1 - 1e-6 ? '（理论公平值）' : '';
  const summary = `特码（1 中 1：每组 ${SPECIAL_GROUP_SIZE} 码 = ${SPECIAL_GROUP_SIZE} 注，${SPECIAL_GROUP_COUNT} 组独立累计共 ${SPECIAL_TOTAL_BETS} 注，每期投入 ${SPECIAL_TOTAL_BETS * stake} 元）：`
    + `当前 ${odds} 倍 → 单注命中 P = ${formatPercent(base.hitProb, 4)}，单组 ${SPECIAL_GROUP_SIZE} 码命中 P = ${formatPercent(base.hitProbPerTicket, 4)}，`
    + `理论公平赔率 ${fair} 倍，期望回报率约 ${formatPercent(ev, 2)}${flag}（市面常见 48 倍）。`;
  el.innerHTML = `期望回报率 = 赔率 × 单注命中概率（100% = 公平）。<br>${escapeHtml(summary)}`;
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

function groupCardHtml(e, ctx, cfg, overlapCounts = {}, index = 1) {
  const t = ctx.target;
  const bets = e.numbers.length; // 7 注
  const hitSet = ctx.draw && ctx.draw.special != null && e.numbers.includes(ctx.draw.special)
    ? new Set([ctx.draw.special])
    : null;

  const balls = e.numbers.map((n) => {
    const count = Number(overlapCounts[n] || 1);
    const isShared = count >= 2;
    return ballHtml(n, {
      size: 'lg',
      date: t.date,
      hitSet,
      consensus: isShared,
      mark: isShared ? `×${count}` : '',
      markLabel: isShared ? `跨组重叠号（共 ${count} 组同时推荐）` : ''
    });
  }).join('');

  const shape = e.shape || { odd: 0, even: 0, big: 0, small: 0, zone1: 0, zone2: 0, zone3: 0, red: 0, blue: 0, green: 0, sum: 0 };
  const sharedCount = (e.sharedNumbers || []).length;

  let hitHtml = '';
  if (ctx.draw) {
    const tickets = entryTickets(e);
    const ev = evaluateTickets(tickets, ctx.draw, {
      ...cfg,
      playMode: 'special',
      targetSize: 1
    });
    const winners = ev.winningTickets || [];
    const specialStr = ctx.draw.special != null ? pad2(ctx.draw.special) : '—';
    const label = winners.length
      ? `命中特码 ${specialStr} ✓ 中 ${winners.length} 注 · 返奖 ${amount(ev.payout)}`
      : `未中 · 本期特码是 ${specialStr}（本组投入 ${amount(bets * cfg.stake)}）`;
    hitHtml = `
      <div class="fc-hit">
        <span class="tag ${winners.length ? 'tag-win' : 'tag-muted'}">${label}</span>
      </div>`;
  }

  return `
    <article class="five-card" data-five="${escapeHtml(e.id)}">
      <header class="fc-head">
        <span class="fc-idx">第 ${index} 组</span>
        <span class="fc-icon">${e.icon}</span>
        <span class="fc-name">${escapeHtml(e.name)}</span>
        <span class="tag tag-gold">${bets} 码 · ${bets} 注</span>
        ${sharedCount > 0 ? `<span class="tag tag-muted">含重叠 ${sharedCount} 码</span>` : ''}
        <span class="fc-actions">
          <button type="button" class="btn btn-sm" data-copy-five="${escapeHtml(e.id)}">复制本组</button>
        </span>
        <span class="fc-rationale">${escapeHtml(e.rationale || '')}</span>
      </header>
      <div class="fc-body">
        <div class="fc-balls">${balls}</div>
        <div class="fc-shape">
          <span>奇偶 ${shape.odd}:${shape.even}</span>
          <span>大小 ${shape.big}:${shape.small}</span>
          <span>三区 ${shape.zone1}-${shape.zone2}-${shape.zone3}</span>
          <span>三波 ${shape.red}-${shape.blue}-${shape.green}</span>
          <span>和值 ${shape.sum}</span>
        </div>
      </div>
      <div class="fc-foot">${hitHtml}</div>
    </article>`;
}

function renderToday() {
  const ctx = getPeriodContext();
  const plan = getThreePlan(ctx.target);
  const t = ctx.target;
  const cfg = betConfig();
  const odds = currentOdds();
  const baseline = specialBaseline();
  const cov = plan.coverage;
  const betsTotal = cov.totalBets; // 21 注
  const overlapCounts = plan.overlapCounts || {};

  const heroPeriod = $('heroPeriod');
  if (heroPeriod) {
    heroPeriod.textContent = ctx.isUpcoming
      ? `${t.year}年第${t.period}期 · 待开奖`
      : `${t.year}年第${t.period}期 · 已开奖`;
  }
  renderShareTag();
  writeShareParams();

  const heroMeta = $('heroMeta');
  if (heroMeta) {
    const overlapNote = cov.consensusCount > 0
      ? `（跨组重叠 ${cov.consensusCount} 个号）`
      : '（本期三组完全不重叠）';
    heroMeta.textContent = `${plan.five.length} 组 × ${SPECIAL_GROUP_SIZE} 码 = ${betsTotal} 注 · 覆盖 ${cov.distinct} 个不同号${overlapNote}`;
  }

  // 跨组重叠号提示条
  const consensusEl = $('consensusStrip');
  if (consensusEl) {
    if (plan.consensus && plan.consensus.length > 0) {
      const items = plan.consensus.map((n) => `${pad2(n)}（${overlapCounts[n] || 2}组）`).join('、');
      consensusEl.innerHTML = `<div class="consensus-strip"><b>跨组重叠重点号：</b><span>${escapeHtml(items)}</span><span>· 金圈角标球代表被多组同时选中，若开出特码则多组叠加返奖</span></div>`;
    } else {
      consensusEl.innerHTML = '';
    }
  }

  const grid = $('fiveGrid');
  if (grid) {
    grid.innerHTML = plan.five.map((e, i) => groupCardHtml(e, ctx, cfg, overlapCounts, i + 1)).join('');
  }

  const box = $('heroResult');
  if (box) {
    if (!ctx.draw) {
      box.innerHTML = '';
    } else {
      const perGroup = plan.five.map((e) => {
        const tickets = entryTickets(e);
        const ev = evaluateTickets(tickets, ctx.draw, {
          ...cfg,
          playMode: 'special',
          targetSize: 1
        });
        return { e, d: { winCount: ev.winCount || 0, payout: ev.payout || 0, bets: tickets.length } };
      });
      const wins = perGroup.reduce((a, p) => a + p.d.winCount, 0);
      const cost = betsTotal * cfg.stake;
      const totalPayout = perGroup.reduce((a, p) => a + p.d.payout, 0);
      const net = totalPayout - cost;
      const coveredAll = new Set(plan.five.flatMap((e) => e.numbers));
      box.innerHTML = `
        <div class="result-strip${wins ? ' win' : ''}">
          <div class="result-label">本期开奖 · 特码 ${betsTotal} 注中 ${wins} 注${wins >= 2 ? `（重叠号命中，${wins} 组同时中奖！）` : ''}</div>
          <div class="ball-row">${drawBallsHtml(ctx.draw, { size: 'sm', hitSet: coveredAll })}</div>
          <div class="kpi-inline">
            <div class="kpi-chip"><div class="k-label">命中注数</div><div class="k-value ${wins ? 'positive' : ''}">${wins} / ${betsTotal}</div></div>
            <div class="kpi-chip"><div class="k-label">本期净收益</div><div class="k-value ${net >= 0 ? 'positive' : 'negative'}">${money(net)}</div></div>
            <div class="kpi-chip"><div class="k-label">逐组命中</div><div class="k-value gold">${perGroup.map((p) => `${p.e.code} ${p.d.winCount ? '✓' : '—'}`).join(' · ')}</div></div>
          </div>
        </div>`;
    }
  }

  const ev = expectedReturnRate(odds);
  const fair = baseline.fairOdds.toFixed(1);
  const costLine = $('featuredCostLine');
  if (costLine) {
    costLine.innerHTML = [
      `单注 ${cfg.stake} 元 × ${betsTotal} 注（${SPECIAL_GROUP_COUNT} 组 × ${SPECIAL_GROUP_SIZE} 码）= ${amount(betsTotal * cfg.stake)}`,
      `单注命中 ${formatPercent(cov.perBet, 4)} · 单组 ${SPECIAL_GROUP_SIZE} 码命中 ${formatPercent(cov.perTicket, 4)}（公平赔率 ${fair} 倍）`,
      `当前赔率 ${odds} 倍 → 回报率 <b>${formatPercent(ev, 1)}</b>`,
      `本期覆盖 ${cov.distinct} 个号，至少中 1 注 <b>${formatPercent(cov.anyHit, 3)}</b>`
    ].join(' · ');
  }
}

/* ==================== 渲染：③ 历史回放 ==================== */

function syncHistRangeLabel() {
  const host = $('histRangeTabs');
  if (host) {
    const total = state.allDraws.length;
    const all = host.querySelector('.tab[data-range="all"]');
    if (all) all.textContent = `全部 · ${total}`;
    const byYear = new Map();
    for (const d of state.allDraws) byYear.set(Number(d.year), (byYear.get(Number(d.year)) || 0) + 1);
    host.querySelectorAll('.tab[data-range^="year:"]').forEach((btn) => {
      const year = Number(btn.dataset.range.slice(5));
      const n = byYear.get(year) || 0;
      btn.textContent = n ? `${year} 年 · ${n}` : `${year} 年`;
      btn.hidden = n === 0;
      if (!n && String(replay.filters.range) === btn.dataset.range) replay.filters.range = '100';
    });
  }
  markRangeTab();
}

function replayTargets() {
  const f = replay.filters;
  let list = state.allDraws;
  if (String(f.range).startsWith('year:')) {
    const year = Number(String(f.range).slice(5));
    list = list.filter((d) => Number(d.year) === year);
  } else if (f.range !== 'all') {
    const n = Math.max(1, Number(f.range) || 0);
    list = list.slice(0, n);
  }
  return list;
}

function markRangeTab() {
  const host = $('histRangeTabs');
  if (!host) return;
  host.querySelectorAll('.tab[data-range]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.range === String(replay.filters.range));
  });
}

async function runReplay() {
  const status = $('replayStatus');
  const token = ++replay.token;

  const targets = replayTargets();
  if (targets.length === 0) {
    replay.running = false;
    replay.records = [];
    replay.filtered = [];
    if (status) status.textContent = '当前范围没有可回放的期次。';
    renderReplayTable();
    return;
  }

  replay.running = true;
  replay.expanded.clear();
  const started = Date.now();
  if (status) status.textContent = `正在逐期回放 ${targets.length} 期（每期只用该期之前的数据）…`;

  const cfg = betConfig();
  const records = [];
  const chunk = Math.max(1, REPLAY_CHUNK);

  for (let i = 0; i < targets.length; i += chunk) {
    if (token !== replay.token) return;
    const part = buildDailyFiveRecords(state.allDraws, targets.slice(i, i + chunk), cfg);
    records.push(...part);
    if (status) status.textContent = `正在逐期回放… ${records.length}/${targets.length} 期`;
    await new Promise((r) => setTimeout(r, 0));
  }

  if (token !== replay.token) return;

  replay.records = records;
  replay.filtered = applyReplayFilter(records);
  replay.visible = REPLAY_PAGE;
  replay.cursor = -1;
  replay.running = false;
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const winCount = records.filter(isWinRecord).length;
  const multiCount = records.filter(isMultiWinRecord).length;
  const filterText = replay.filters.hit === 'hit'
    ? `，其中中奖 ${winCount} 期`
    : replay.filters.hit === 'multi'
      ? `，其中重叠多中 ${multiCount} 期`
      : '';
  if (status) status.textContent = `✓ 已回放 ${records.length} 期（耗时 ${elapsed}s，无未来函数${filterText}）。`;
  renderReplayTable();
}

/**
 * 动态按当前本金/赔率计算单期汇总（修改本金/赔率时无需重跑选号即可即时刷新金额）
 */
function periodMoney(rec) {
  const stake = currentStake();
  const odds = currentOdds();
  let wins = 0;
  let cost = 0;
  for (const e of rec.five) {
    const hits = Number(e.hitCount) || 0;
    const betsThis = Number.isFinite(e.bets) && e.bets > 0 ? e.bets : e.numbers.length;
    wins += hits;
    cost += stake * betsThis;
  }
  const payout = wins * stake * odds;
  return {
    wins,
    cost,
    payout,
    net: payout - cost,
    odds
  };
}

function prizeCellHtml(payout, idx) {
  const v = Math.round(Number(payout) || 0);
  const cls = v > 0 ? 'prize-tot win' : 'prize-tot';
  return `<span class="${cls}">${v > 0 ? `¥${v.toLocaleString('zh-CN')}` : '¥0'}</span>
    <button type="button" class="tk-pill fold" data-feat-toggle="${idx}" title="展开当期三组明细">▾</button>`;
}

function replayRowHtml(rec, idx) {
  const d = rec.draw;
  const anyHit = new Set(rec.five.flatMap((e) => e.hitNums || []));
  const normalBalls = d.numbers
    .map((n) => miniBallHtml(n, { hit: false, normalBall: true }))
    .join('');
  const specialBall = d.special != null
    ? `<span class="d-sep"></span>${miniBallHtml(d.special, {
      special: true,
      hit: anyHit.has(d.special)
    })}`
    : '';

  const pills = rec.five.map((e) => {
    const betsThis = Number.isFinite(e.bets) && e.bets > 0 ? e.bets : e.numbers.length;
    const wins = Number(e.hitCount) || 0;
    const text = `${e.code} ${wins}/${betsThis}`;
    const cls = wins > 0 ? 'tk-pill win' : 'tk-pill';
    const title = wins > 0
      ? `${e.name} 命中特码（中 ${wins} 注）`
      : `${e.name} 未命中当期特码`;
    return `<span class="${cls}" title="${escapeHtml(title)}">${escapeHtml(text)}</span>`;
  }).join('');

  const m = periodMoney(rec);

  return `
    <tr class="main-row ${m.wins ? 'row-win' : ''}" data-row-idx="${idx}" data-draw-id="${escapeHtml(d.id)}">
      <td class="col-period">${d.year}-${d.period}<small>${escapeHtml(d.date)}</small></td>
      <td class="col-draw"><div class="draw-balls">${normalBalls}${specialBall}</div></td>
      <td class="col-hits"><div class="tk-pills">${pills}</div></td>
      <td class="col-prize">${prizeCellHtml(m.payout, idx)}</td>
    </tr>`;
}

function featureDetailHtml(rec) {
  const stake = currentStake();
  const odds = currentOdds();
  const overlapCounts = rec.overlapCounts || {};
  const specialNum = rec.draw?.special != null ? pad2(rec.draw.special) : '—';

  const block = (e) => {
    const hitSet = new Set(e.hitNums || []);
    const balls = e.numbers.map((n) => miniBallHtml(n, {
      hit: hitSet.has(n),
      shared: (overlapCounts[n] || 0) >= 2,
      sharedCount: overlapCounts[n] || 1
    })).join('');
    const betsThis = Number.isFinite(e.bets) && e.bets > 0 ? e.bets : e.numbers.length;
    const hits = Number(e.hitCount) || 0;
    const payout = hits * stake * odds;
    const badge = hits > 0 ? '<span class="badge hit">命中</span>' : '<span class="badge miss">未中</span>';
    const hitText = hits > 0
      ? `命中特码 ${numsText(e.hitNums)}（中 ${hits} 注，本组成本 ${amount(stake * betsThis)}，返奖 ${amount(payout)}）`
      : `0 注 · 本期特码 ${specialNum} 不在本组 ${betsThis} 码内（本组成本 ${amount(stake * betsThis)}，每中 1 注返 ${amount(stake * odds)}）`;
    return `
      <div class="fd-five">
        <div class="fd-head">${e.icon} ${escapeHtml(e.code)} ${escapeHtml(e.name)} <span class="fd-nums">${balls}</span></div>
        <div class="fd-line">${badge} ${hitText}</div>
      </div>`;
  };
  return `
    <tr class="feat-detail"><td colspan="4">
      ${rec.five.map(block).join('')}
    </td></tr>`;
}

function renderReplayTable() {
  const body = $('histBody');
  const list = replay.filtered;
  const visible = list.slice(0, replay.visible);

  if (!list.length) {
    const emptyText = replay.running
      ? '正在计算…'
      : replay.filters.hit === 'hit'
        ? '这个范围里一期都没中奖 —— 换「全部期次」或调整范围再看看。'
        : replay.filters.hit === 'multi'
          ? '这个范围里没有重叠多中（≥2 组同中）的期次 —— 可切回「只看中奖」或「全部期次」。'
          : '这个范围还没有回放结果，点「▶ 重新计算」试试。';
    body.innerHTML = `<tr class="empty-row"><td colspan="4">${emptyText}</td></tr>`;
  } else {
    body.innerHTML = visible.map(replayRowHtml).join('');
    if (replay.expanded.size) {
      const rows = [...body.querySelectorAll('tr[data-draw-id]')];
      for (const drawId of replay.expanded) {
        const idx = list.findIndex((r) => r.draw.id === drawId);
        if (idx < 0 || idx >= visible.length) continue;
        const tr = rows.find((row) => row.dataset.drawId === drawId);
        if (!tr) continue;
        tr.insertAdjacentHTML('afterend', featureDetailHtml(list[idx]));
      }
    }
  }

  const totalRecords = replay.records.length;
  const filteredNote = list.length !== totalRecords && totalRecords
    ? `（已筛选，占全部 ${totalRecords} 期）`
    : '';
  $('histCount').textContent = list.length
    ? `共 ${list.length} 期${filteredNote}，显示 ${visible.length} 期`
    : '没有匹配的期次';
  $('btnMoreHist').style.display = list.length > visible.length ? '' : 'none';

  renderReplayMetrics();
}

function renderReplayMetrics() {
  const stake = currentStake();
  const odds = currentOdds();
  const baseline = specialBaseline();
  const records = replay.filtered;
  const host = $('histMetrics');
  if (!host) return;

  let winPeriods = 0;
  let multiWinPeriods = 0;
  let totalHitBets = 0;
  let payoutSum = 0;
  let costSum = 0;
  let maxPayout = 0;

  for (const rec of records) {
    const m = periodMoney(rec);
    if (m.wins > 0) winPeriods++;
    if (m.wins >= 2) multiWinPeriods++;
    totalHitBets += m.wins;
    payoutSum += m.payout;
    costSum += m.cost;
    if (m.payout > maxPayout) maxPayout = m.payout;
  }
  const periods = records.length;
  const winRate = periods ? (winPeriods / periods) * 100 : 0;
  const backRate = costSum > 0 ? (payoutSum / costSum) * 100 : 0;

  // 逐组汇总（每组独立 7 注）
  const agg = new Map();
  for (const rec of records) {
    for (const e of rec.five) {
      let a = agg.get(e.id);
      if (!a) {
        a = { id: e.id, code: e.code, name: e.name, icon: e.icon, periods: 0, hits: 0, wins: 0, cost: 0, payout: 0 };
        agg.set(e.id, a);
      }
      const hitsThis = Number(e.hitCount) || 0;
      const betsThis = Number.isFinite(e.bets) && e.bets > 0 ? e.bets : e.numbers.length;
      a.periods++;
      a.hits += hitsThis;
      if (hitsThis > 0) a.wins++;
      a.cost += stake * betsThis;
      a.payout += hitsThis * stake * odds;
    }
  }

  const aggList = [...agg.values()];
  const maxGroupWins = aggList.length ? Math.max(...aggList.map((x) => x.wins)) : 0;

  const cards = aggList.map((a) => {
    const groupWinRate = a.periods ? (a.wins / a.periods) * 100 : 0;
    const groupBackRate = a.cost > 0 ? (a.payout / a.cost) * 100 : 0;
    const cls = ['sc-box'];
    if (maxGroupWins > 0 && a.wins === maxGroupWins) cls.push('is-lead');
    return `
      <div class="${cls.join(' ')}">
        <span class="sc-name">${a.icon} ${escapeHtml(a.code)} ${escapeHtml(a.name)}</span>
        <span class="sc-hit">${groupWinRate.toFixed(1)}%</span>
        <small>中奖 ${a.wins} / ${a.periods} 期 · 每组 ${SPECIAL_GROUP_SIZE} 注</small>
        <span class="sc-sum">返奖 ¥${Math.round(a.payout).toLocaleString('zh-CN')}（${groupBackRate.toFixed(1)}%）</span>
      </div>`;
  }).join('');

  host.innerHTML = `
    <div class="metric-card v-prize">
      <div class="mc-head">特码三组 7 码 · 有奖期占比</div>
      <div>
        <span class="mc-val">${winRate.toFixed(1)}%</span>
        <span class="mc-label">${winPeriods} / ${periods} 期有奖${multiWinPeriods ? `（重叠多中 ${multiWinPeriods} 期）` : ''}</span>
      </div>
      <div class="mc-bar"><div class="mc-fill" style="width:${Math.min(100, winRate).toFixed(1)}%"></div></div>
      <div class="mc-kv">
        <div><span class="mc-sm">累计返奖（${totalHitBets} 注）</span><b>¥${Math.round(payoutSum).toLocaleString('zh-CN')}</b></div>
        <div><span class="mc-sm">总投入</span><b>¥${Math.round(costSum).toLocaleString('zh-CN')}</b></div>
        <div><span class="mc-sm">返奖比</span><b>${backRate.toFixed(1)}%</b></div>
        <div><span class="mc-sm">单期最高</span><b>¥${Math.round(maxPayout).toLocaleString('zh-CN')}</b></div>
      </div>
      <div class="mc-sub">单注 ${stake} 元 · 每组 ${betsPerTicket()} 注（3 组共 ${SPECIAL_TOTAL_BETS} 注） · 赔率 ${odds} 倍</div>
    </div>
    <div class="strat-compare">${cards || '<div class="sc-box">暂无数据</div>'}</div>`;

  const ev = expectedReturnRate(odds);
  const fair = baseline.fairOdds.toFixed(1);
  const plan = getThreePlan(getPeriodContext().target);
  const cov = plan.coverage;
  const base = $('histBaseline');
  if (base) {
    base.innerHTML = `随机理论期望：单组 7 码命中率 <b>${formatPercent(baseline.hitProbPerTicket, 2)}</b>（场均 ${baseline.expectedHitsPerGroup.toFixed(2)} 注），`
      + `3 组合计 21 注场均 <b>${baseline.expectedHits.toFixed(2)} 注</b> · `
      + `公平赔率 <b>${fair}</b> 倍，当前 ${odds} 倍 → 期望回报率 <b>${formatPercent(ev, 1)}</b> · `
      + `当前期覆盖 ${cov.distinct} 个不同号（${cov.totalBets} 注），至少中 1 注 <b>${formatPercent(cov.anyHit, 3)}</b>。`
      + `回放只做无未来信息历史统计，各组差异在随机波动内，不构成投注建议。`;
  }
}

/* ==================== 数据变更后统一刷新 ==================== */

function refreshAfterDataChange() {
  rebuildMergedDraws();
  renderHeader();
  populatePeriodSelect();
  syncHistRangeLabel();
  renderToday();
  renderSyncPanel();
  scheduleReplay();
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
  on('btnCopyAll', 'click', () => {
    const ctx = getPeriodContext();
    copyText(formatFiveTickets(getThreePlan(ctx.target).five), '三组 7 码已复制');
  });
  on('btnCopyAllMobile', 'click', () => {
    const ctx = getPeriodContext();
    copyText(formatFiveTickets(getThreePlan(ctx.target).five), '三组 7 码已复制');
  });
  on('btnPrevPeriod', 'click', () => stepPeriod(1));
  on('btnNextPeriod', 'click', () => stepPeriod(-1));
  on('fiveGrid', 'click', (e) => {
    const copyBtn = e.target.closest('[data-copy-five]');
    if (copyBtn) {
      const plan = getThreePlan(getPeriodContext().target);
      const entry = plan.five.find((x) => x.id === copyBtn.dataset.copyFive);
      if (entry) copyText(formatSingleTicket(entry.numbers), `${entry.code} ${entry.name} 已复制`);
    }
  });
  on('heroShare', 'click', () => {
    copyText(window.location.href, '链接已复制 · 另一台设备打开就是同一组号码');
  });

  /* 历史回放 */
  on('btnMoreHist', 'click', () => {
    replay.visible += REPLAY_PAGE;
    renderReplayTable();
  });
  on('histRangeTabs', 'click', (e) => {
    const btn = e.target.closest('.tab[data-range]');
    if (!btn) return;
    replay.filters.range = btn.dataset.range || 'all';
    markRangeTab();
    runReplay();
  });
  on('btnReplayRun', 'click', () => runReplay());
  on('histFilter', 'change', (e) => {
    replay.filters.hit = e.target.value || 'all';
    replay.cursor = -1;
    replay.visible = REPLAY_PAGE;
    replay.filtered = applyReplayFilter();
    renderReplayTable();
  });

  const jumpHit = (dir) => {
    const list = replay.filtered;
    if (!list.length) { showToast(replay.records.length ? '当前筛选下没有期次' : '请先点「▶ 重新计算」'); return; }
    let idx = replay.cursor;
    if (idx < 0 || idx >= list.length) idx = dir > 0 ? -1 : list.length;
    for (let i = idx + dir; i >= 0 && i < list.length; i += dir) {
      if (isWinRecord(list[i])) {
        replay.cursor = i;
        if (i >= replay.visible) replay.visible = Math.min(list.length, i + REPLAY_PAGE);
        replay.expanded.add(list[i].draw.id);
        renderReplayTable();
        const tr = [...$('histBody').querySelectorAll('tr[data-draw-id]')].find((row) => row.dataset.drawId === list[i].draw.id);
        if (tr) {
          if (typeof tr.scrollIntoView === 'function') tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
          tr.classList.add('row-flash');
          setTimeout(() => tr.classList.remove('row-flash'), 1600);
        }
        return;
      }
    }
    for (let i = dir > 0 ? list.length - 1 : 0; i >= 0 && i < list.length; i -= dir) {
      if (isWinRecord(list[i])) {
        replay.cursor = i;
        if (i >= replay.visible) replay.visible = Math.min(list.length, i + REPLAY_PAGE);
        replay.expanded.add(list[i].draw.id);
        renderReplayTable();
        showToast(dir > 0 ? '这已经是最新的一个命中了，已跳到最早的一个' : '这已经是最早的一个命中了，已跳到最新的一个');
        return;
      }
    }
    showToast('这个范围里没有中奖期');
  };
  on('btnPrevHit', 'click', () => jumpHit(-1));
  on('btnNextHit', 'click', () => jumpHit(1));
  on('histBody', 'click', (e) => {
    const tr = e.target.closest('tr[data-draw-id]');
    const id = tr?.dataset.drawId;
    if (!id) return;
    if (replay.expanded.has(id)) {
      replay.expanded.delete(id);
    } else {
      replay.expanded.add(id);
    }
    renderReplayTable();
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
      if (replay.records.length) renderReplayTable();
    });
  });
  on('btnResetCfg', 'click', () => {
    state.config = { ...DEFAULT_CONFIG };
    saveConfig();
    renderHeader();
    renderToday();
    if (replay.records.length) renderReplayTable();
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
  `https://corsproxy.io/?${encodeURIComponent(DEFAULT_CONFIG.remoteSourceUrl)}`
];

async function fetchRemoteSourceHtml(timeoutMs = 5000) {
  const attempts = [];
  for (const u of REMOTE_CANDIDATES) {
    const short = u.length > 60 ? `${u.slice(0, 57)}…` : u;
    let timer = null;
    try {
      const ctrl = new AbortController();
      timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(new URL(u, window.location.href).toString(), { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) {
        attempts.push(`${short} → HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      if (text?.includes('期(开奖时间:')) return { html: text, reason: '', attempts };
      attempts.push(`${short} → 页面里找不到开奖记录（站点结构可能变了）`);
    } catch (err) {
      const msg = err?.name === 'AbortError' ? `超时 ${timeoutMs}ms` : (err?.message || '网络错误');
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
        status.textContent = `没有可追加的期次。${lagNow.message}`;
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
        + '</ul></details>';
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
let replayTimer = null;
function scheduleReplay() {
  clearTimeout(replayTimer);
  replayTimer = setTimeout(() => {
    runReplay().catch((err) => {
      console.error('[replay]', err);
      const el = $('replayStatus');
      if (el) el.textContent = `⚠ 回放计算失败：${err.message}`;
    });
  }, 120);
}

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
  syncHistRangeLabel();
  bindEvents();
  renderToday();
  renderSyncPanel();
  renderReplayTable();
  registerServiceWorker();

  if (state.storageErrors.length) {
    showToast(`⚠ ${state.storageErrors[0]}`);
  }

  scheduleReplay();
  autoCheckSyncQuietly();

  window.__APP_BOOTED__ = true;
}

try {
  initApp();
} catch (err) {
  console.error('[boot] 初始化失败', err);
  showBootError(`初始化失败：${err.message}`);
}
