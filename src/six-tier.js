/** 六档融合模型：预测和评分逻辑按附件实现。 */
import { isUsableDraw } from './audit.js';
const TIER_DEFS = [
  { size: 3,  icon: '🎯', label: '3码',  desc: '超核胆' },
  { size: 5,  icon: '🔥', label: '5码',  desc: '核心狙击' },
  { size: 8,  icon: '⚡', label: '8码',  desc: '主力精选' },
  { size: 11, icon: '🛡️', label: '11码', desc: '攻守均衡' },
  { size: 14, icon: '🧭', label: '14码', desc: '平推上限' },
  { size: 20, icon: '🌐', label: '20码', desc: '防连黑底' }
];

const ALL_49 = Array.from({ length: 49 }, (_, i) => i + 1);
const SUBZONES = ['z1', 'z2s', 'z2b', 'z3'];
const IDEAL_MODEL = { z1: 4, z2s: 2, z2b: 2, z3: 4 };

const WAVE_MAP = (() => {
  const m = new Array(50).fill('green');
  for (const n of [1,2,7,8,12,13,18,19,23,24,29,30,34,35,40,45,46]) m[n] = 'red';
  for (const n of [3,4,9,10,14,15,20,25,26,31,36,37,41,42,47,48]) m[n] = 'blue';
  return m;
})();
const WAVE_COLOR = { red: '#e54b4b', blue: '#3b82f6', green: '#10a878' };
const ZODIACS = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
const LUNAR_NEW_YEAR_DATES = {
  2020: { date: '2020-01-25', zodiac: '鼠', prevZodiac: '猪' },
  2021: { date: '2021-02-12', zodiac: '牛', prevZodiac: '鼠' },
  2022: { date: '2022-02-01', zodiac: '虎', prevZodiac: '牛' },
  2023: { date: '2023-01-22', zodiac: '兔', prevZodiac: '虎' },
  2024: { date: '2024-02-10', zodiac: '龙', prevZodiac: '兔' },
  2025: { date: '2025-01-29', zodiac: '蛇', prevZodiac: '龙' },
  2026: { date: '2026-02-17', zodiac: '马', prevZodiac: '蛇' },
  2027: { date: '2027-02-06', zodiac: '羊', prevZodiac: '马' },
  2028: { date: '2028-01-26', zodiac: '猴', prevZodiac: '羊' },
  2029: { date: '2029-02-13', zodiac: '鸡', prevZodiac: '猴' },
  2030: { date: '2030-02-03', zodiac: '狗', prevZodiac: '鸡' },
  2031: { date: '2031-01-23', zodiac: '猪', prevZodiac: '狗' },
  2032: { date: '2032-02-11', zodiac: '鼠', prevZodiac: '猪' }
};

function pad2(n) { return String(n).padStart(2, '0'); }
function isLeapYear(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
function maxPeriodOfYear(y) { return isLeapYear(y) ? 366 : 365; }
function periodToDate(year, periodNum) {
  const dt = new Date(Date.UTC(year, 0, periodNum));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}
function parseLabel(raw) {
  const m = /^(\d{4})-(\d{3})$/.exec(String(raw || '').trim());
  if (!m) return null;
  const year = Number(m[1]), periodNum = Number(m[2]);
  if (year < 2020 || year > 2100 || periodNum < 1 || periodNum > maxPeriodOfYear(year)) return null;
  return { year, periodNum, label: `${year}-${String(periodNum).padStart(3, '0')}` };
}
function nextLabelOf(label) {
  const p = parseLabel(label);
  if (!p) return '';
  if (p.periodNum < maxPeriodOfYear(p.year)) return `${p.year}-${String(p.periodNum + 1).padStart(3, '0')}`;
  return `${p.year + 1}-001`;
}
function yearZodiacBaseIdx(dateStr) {
  const yr = Number(String(dateStr || '2026-01-01').slice(0, 4));
  const info = LUNAR_NEW_YEAR_DATES[yr];
  if (info) {
    const z = dateStr < info.date ? info.prevZodiac : info.zodiac;
    return ZODIACS.indexOf(z);
  }
  return ((yr - 2020) % 12 + 12) % 12;
}
function zodiacByBase(num, baseIdx) {
  return ZODIACS[((baseIdx - (num - 1)) % 12 + 12) % 12];
}
function validSevenNums(arr) {
  if (!Array.isArray(arr) || arr.length !== 7) return false;
  const seen = new Set();
  for (const x of arr) {
    if (!Number.isInteger(x) || x < 1 || x > 49 || seen.has(x)) return false;
    seen.add(x);
  }
  return true;
}
function zoneOf(n) { return n <= 16 ? 1 : n <= 33 ? 2 : 3; }
function subzoneOf(n) { return n <= 16 ? 'z1' : n <= 24 ? 'z2s' : n <= 33 ? 'z2b' : 'z3'; }

function detJitter(year, periodNum, num, salt) {
  let x = ((year * 1009 + periodNum * 9176 + num * 379 + salt * 131071) >>> 0) || 1;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  return ((x >>> 0) % 10000) / 10000;
}
function seedFor(year, periodNum) {
  let h = (year * 2654435761) ^ (periodNum * 2246822519) ^ 3266489917;
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normArr(arr) {
  let lo = Infinity, hi = -Infinity;
  for (let n = 1; n <= 49; n++) {
    if (arr[n] < lo) lo = arr[n];
    if (arr[n] > hi) hi = arr[n];
  }
  const span = hi - lo, out = new Float64Array(50);
  for (let n = 1; n <= 49; n++) out[n] = span > 1e-12 ? (arr[n] - lo) / span : 0.5;
  return out;
}

function selectBalancedSeven(scoreMap, opts) {
  const minZ = opts.minPerZone, maxZ = opts.maxPerZone;
  const minC = opts.minPerColor, maxC = opts.maxPerColor;
  const oddLo = opts.oddRange[0], oddHi = opts.oddRange[1];
  const bigLo = opts.bigRange[0], bigHi = opts.bigRange[1];
  const maxTail = opts.maxTailRepeat;
  const norm = normArr(scoreMap);
  const candidates = ALL_49.slice().sort((a, b) => norm[b] - norm[a] || a - b);

  const chosen = [];
  const chosenMask = new Uint8Array(50);
  const zCnt = [0, 0, 0, 0];
  const cCnt = { red: 0, blue: 0, green: 0 };
  const tCnt = new Uint8Array(10);
  let oddCnt = 0, bigCnt = 0;

  while (chosen.length < 7) {
    let bestNum = 0, bestVal = -Infinity;
    const remAfter = 7 - (chosen.length + 1);
    for (const strict of [true, false]) {
      for (let idx = 0; idx < 49; idx++) {
        const n = candidates[idx];
        if (chosenMask[n]) continue;
        const z = zoneOf(n), c = WAVE_MAP[n], tl = n % 10;
        const isOdd = n & 1, isBig = n >= 25 ? 1 : 0;
        if (strict) {
          if (zCnt[z] + 1 > maxZ || cCnt[c] + 1 > maxC || tCnt[tl] + 1 > maxTail) continue;
          const zDef = Math.max(0, minZ - (zCnt[1] + (z === 1 ? 1 : 0)))
                     + Math.max(0, minZ - (zCnt[2] + (z === 2 ? 1 : 0)))
                     + Math.max(0, minZ - (zCnt[3] + (z === 3 ? 1 : 0)));
          if (zDef > remAfter) continue;
          const cDef = Math.max(0, minC - (cCnt.red + (c === 'red' ? 1 : 0)))
                     + Math.max(0, minC - (cCnt.blue + (c === 'blue' ? 1 : 0)))
                     + Math.max(0, minC - (cCnt.green + (c === 'green' ? 1 : 0)));
          if (cDef > remAfter) continue;
          const nextOdd = oddCnt + isOdd;
          if (nextOdd > oddHi || nextOdd + remAfter < oddLo) continue;
          const nextBig = bigCnt + isBig;
          if (nextBig > bigHi || nextBig + remAfter < bigLo) continue;
        }
        let val = norm[n];
        if (zCnt[z] < minZ) val += 0.18; else if (zCnt[z] >= maxZ - 1) val -= 0.06;
        if (cCnt[c] < minC) val += 0.14; else if (cCnt[c] >= maxC - 1) val -= 0.05;
        if (tCnt[tl] > 0) val -= 0.12 * tCnt[tl];
        val -= 0.05 * Math.abs(oddCnt + isOdd - 3.5) - 0.05 * Math.abs(bigCnt + isBig - 3.5);
        if (val > bestVal) { bestVal = val; bestNum = n; }
      }
      if (bestNum) break;
    }
    if (!bestNum) break;
    chosen.push(bestNum);
    chosenMask[bestNum] = 1;
    zCnt[zoneOf(bestNum)]++;
    cCnt[WAVE_MAP[bestNum]]++;
    tCnt[bestNum % 10]++;
    if (bestNum & 1) oddCnt++;
    if (bestNum >= 25) bigCnt++;
  }
  return chosen.sort((a, b) => a - b);
}

function selectPoolSeven(pool, scoreMap) {
  const sorted = [...pool].sort((a, b) => scoreMap[b] - scoreMap[a] || a - b);
  const chosen = [];
  const zCnt = [0, 0, 0, 0];
  const cCnt = { red: 0, blue: 0, green: 0 };
  const tCnt = new Uint8Array(10);
  const used = new Set();
  for (const strict of [true, false]) {
    for (const n of sorted) {
      if (chosen.length >= 7) break;
      if (used.has(n)) continue;
      const z = zoneOf(n), c = WAVE_MAP[n], tl = n % 10;
      if (strict && (zCnt[z] >= 3 || cCnt[c] >= 3 || tCnt[tl] >= 2)) continue;
      chosen.push(n); used.add(n); zCnt[z]++; cCnt[c]++; tCnt[tl]++;
    }
  }
  return chosen.sort((a, b) => a - b);
}

function calcZoneModel(uAsc, P, year, periodNum, sF30, sF60, sLastSeen, sGaps) {
  const w400 = Math.max(1, Math.min(400, P));
  const lastSp = P > 0 ? uAsc[P - 1].special : -1;
  const mean30 = 30 / 49;
  const hot = new Float64Array(50), cold = new Float64Array(50), bal = new Float64Array(50);

  for (let n = 1; n <= 49; n++) {
    const cur = sLastSeen[n] >= 0 && sLastSeen[n] < 400 ? sLastSeen[n] : w400;
    const g = sGaps[n];
    let le = 0, gCnt = 0;
    for (let k = 0; k < g.length; k++) {
      if (g[k].endIdx >= 400) break;
      gCnt++;
      if (g[k].gap <= cur) le++;
    }
    const pct = gCnt === 0 ? 1 : le / gCnt;
    const isNb = lastSp > 0 && Math.abs(n - lastSp) === 1;
    hot[n] = 2.6 * ((sF30[n] * 49) / 30) + 1.6 * ((sF60[n] * 49) / 60) + (isNb ? 0.7 : 0) + detJitter(year, periodNum, n, 11) * 0.9;
    cold[n] = 3.0 * pct + 0.03 * Math.min(cur, 60) + detJitter(year, periodNum, n, 23) * 0.4;
    bal[n] = 1.6 / (1 + Math.abs(sF30[n] - mean30)) + 0.25 * (1 - Math.abs(pct - 0.5)) + detJitter(year, periodNum, n, 37) * 0.8;
  }

  const hotN = normArr(hot), coldN = normArr(cold), balN = normArr(bal);
  const valOf = n => 0.45 * hotN[n] + 0.30 * coldN[n] + 0.25 * balN[n] + detJitter(year, periodNum, n, 71) * 0.06;

  const rng = mulberry32(seedFor(year, periodNum));
  const pool = ALL_49.slice();
  for (let i = 48; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const randoms = pool.slice(0, 3).sort((a, b) => a - b);
  const taken = new Set(randoms);

  const randZ = { z1: 0, z2s: 0, z2b: 0, z3: 0 };
  for (const n of randoms) randZ[subzoneOf(n)]++;
  const resid = { z1: Math.max(0, 4 - randZ.z1), z2s: Math.max(0, 2 - randZ.z2s), z2b: Math.max(0, 2 - randZ.z2b), z3: Math.max(0, 4 - randZ.z3) };
  const totResid = () => resid.z1 + resid.z2s + resid.z2b + resid.z3;
  let guard = 0;
  while (totResid() < 9 && guard++ < 60) {
    let pick = null, bestGap = -Infinity;
    for (const z of SUBZONES) { const gap = IDEAL_MODEL[z] - (randZ[z] + resid[z]); if (gap > bestGap) { bestGap = gap; pick = z; } }
    if (!pick) break; resid[pick]++;
  }
  guard = 0;
  while (totResid() > 9 && guard++ < 60) {
    let pick = null, worst = Infinity;
    for (const z of SUBZONES) { const gap = IDEAL_MODEL[z] - (randZ[z] + resid[z]); if (resid[z] > 0 && gap < worst) { worst = gap; pick = z; } }
    if (!pick) break; resid[pick]--;
  }

  const randOdd = randoms.filter(n => n % 2 === 1).length;
  let oddLeft = Math.max(0, Math.min(9, 6 - randOdd));
  const oddQuota = { z1: 0, z2s: 0, z2b: 0, z3: 0 };
  const order = SUBZONES.slice().sort((a, b) => resid[b] - resid[a] || (a < b ? -1 : 1));
  let round = 0;
  while (oddLeft > 0 && round < 8) {
    let prog = false;
    for (const z of order) {
      if (oddLeft <= 0) break;
      if (oddQuota[z] >= resid[z]) continue;
      const avail = ALL_49.filter(n => subzoneOf(n) === z && n % 2 === 1 && !taken.has(n)).length;
      if (oddQuota[z] >= avail) continue;
      oddQuota[z]++; oddLeft--; prog = true;
    }
    if (!prog) break; round++;
  }

  const tailCount = new Int8Array(10);
  for (const n of randoms) tailCount[n % 10]++;
  const curated = [];
  for (const z of SUBZONES) {
    if (resid[z] <= 0) continue;
    const zPool = ALL_49.filter(n => subzoneOf(n) === z && !taken.has(n)).sort((a, b) => valOf(b) - valOf(a) || a - b);
    for (const [par, cnt] of [[1, oddQuota[z]], [0, resid[z] - oddQuota[z]]]) {
      let filled = 0;
      for (const relax of [false, true]) {
        for (const n of zPool) {
          if (filled >= cnt) break;
          if (taken.has(n) || (n % 2 === 1 ? 1 : 0) !== par) continue;
          if (!relax && tailCount[n % 10] >= 2) continue;
          taken.add(n); curated.push(n); tailCount[n % 10]++; filled++;
        }
      }
    }
  }
  for (let t = 0; t < 10; t++) {
    let g2 = 0;
    while (tailCount[t] > 2 && g2++ < 6) {
      const idx = curated.findIndex(n => n % 10 === t);
      if (idx < 0) break;
      const out = curated[idx];
      const inn = ALL_49.find(n => !taken.has(n) && subzoneOf(n) === subzoneOf(out) && (n % 2 === 1) === (out % 2 === 1) && tailCount[n % 10] < 2);
      if (inn == null) break;
      taken.delete(out); taken.add(inn); curated[idx] = inn; tailCount[out % 10]--; tailCount[inn % 10]++;
    }
  }
  const byHot = curated.slice().sort((a, b) => hotN[b] - hotN[a] || a - b);
  const hotSet = new Set(byHot.slice(0, Math.min(3, curated.length)));
  const rest = curated.filter(n => !hotSet.has(n)).sort((a, b) => coldN[b] - coldN[a] || a - b);
  const coldSet = new Set(rest.slice(0, Math.min(2, rest.length)));
  return { curated9: curated.slice().sort((a, b) => a - b), hotCold5: [...hotSet, ...coldSet].sort((a, b) => a - b) };
}

function predictAt(usableAsc, P, year, periodNum, dateStr) {
  const effDate = dateStr || (P > 0 ? usableAsc[P - 1].date : `${year}-01-01`);
  const baseZ = yearZodiacBaseIdx(effDate);

  const sWin = Math.min(420, P);
  const sF15 = new Int16Array(50), sF30 = new Int16Array(50), sF60 = new Int16Array(50), sF120 = new Int16Array(50);
  const sLastSeen = new Int16Array(50).fill(-1);
  const sPrevSeen = new Int16Array(50).fill(-1);
  const sGaps = Array.from({ length: 50 }, () => []);

  for (let i = 0; i < sWin; i++) {
    const s = usableAsc[P - 1 - i].special;
    if (i < 120) {
      sF120[s]++;
      if (i < 60) {
        sF60[s]++;
        if (i < 30) {
          sF30[s]++;
          if (i < 15) sF15[s]++;
        }
      }
    }
    if (sLastSeen[s] < 0) sLastSeen[s] = i;
    if (sPrevSeen[s] >= 0) sGaps[s].push({ gap: i - sPrevSeen[s] - 1, endIdx: i });
    sPrevSeen[s] = i;
  }
  const sOmitDefault = sWin || 1;

    const t1 = calcZoneModel(usableAsc, P, year, periodNum, sF30, sF60, sLastSeen, sGaps);

    const nF15 = new Int16Array(50), nF3 = new Int16Array(50), nF10 = new Int16Array(50), aF30 = new Int16Array(50);
  const allOmit = new Int16Array(50).fill(60);
  const spOmit90 = new Int16Array(50).fill(100);
  const zSp25 = new Int16Array(12), tSp25 = new Int16Array(10);

  for (let k = 1; k <= 90 && P - k >= 0; k++) {
    const rec = usableAsc[P - k];
    if (spOmit90[rec.special] === 100) spOmit90[rec.special] = k - 1;
    for (let j = 0; j < 7; j++) {
      const x = rec.raw7[j];
      if (allOmit[x] === 60) allOmit[x] = k - 1;
      if (k <= 30) aF30[x]++;
    }
    if (k <= 15) {
      for (let j = 0; j < 6; j++) {
        const x = rec.numbers[j];
        nF15[x]++;
        if (k <= 10) { nF10[x]++; if (k <= 3) nF3[x]++; }
      }
    }
    if (k <= 25) {
      zSp25[((baseZ - (rec.special - 1)) % 12 + 12) % 12]++;
      tSp25[rec.special % 10]++;
    }
  }

  const lastNormMask = new Uint8Array(50);
  const lastRawSet = new Set();
  if (P > 0) {
    for (const n of usableAsc[P - 1].numbers) lastNormMask[n] = 1;
    for (const n of usableAsc[P - 1].raw7) lastRawSet.add(n);
  }

  const computeEma = span => {
    const alpha = 2 / (span + 1), keep = 1 - alpha;
    const len = Math.min(span * 3, sWin);
    const base = (1 / 49) * Math.pow(keep, len);
    const out = new Float64Array(50).fill(base);
    let w = alpha;
    for (let k = 1; k <= len; k++) {
      out[usableAsc[P - k].special] += w;
      w *= keep;
    }
    return out;
  };
  const ema20 = computeEma(20);
  const ema45 = computeEma(45);

  const sTail60 = new Int16Array(10), sZod60 = new Int16Array(12);
  for (let i = 0; i < Math.min(60, sWin); i++) {
    const s = usableAsc[P - 1 - i].special;
    sTail60[s % 10]++;
    sZod60[((baseZ - (s - 1)) % 12 + 12) % 12]++;
  }
  const maxSTail = Math.max(1, ...sTail60), minSTail = Math.min(...sTail60);
  let maxSZod = 1;
  for (let z = 0; z < 12; z++) if (sZod60[z] > maxSZod) maxSZod = sZod60[z];

  const lastSpecial = sWin > 0 ? usableAsc[P - 1].special : null;
  const lastSpTail = lastSpecial != null ? lastSpecial % 10 : -1;

  const normToSpecHits = new Int16Array(50), normApp = new Int16Array(50);
  const convLim = Math.min(240, Math.max(0, sWin - 1));
  const seenPrev = new Int32Array(50);
  let stamp = 1;
  for (let i = 0; i < convLim; i++) {
    stamp++;
    const curSpec = usableAsc[P - 1 - i].special;
    const d1 = usableAsc[P - 2 - i];
    if (d1) {
      for (let j = 0; j < 6; j++) {
        const pn = d1.numbers[j];
        if (seenPrev[pn] !== stamp) { seenPrev[pn] = stamp; normApp[pn]++; if (pn === curSpec) normToSpecHits[pn]++; }
      }
    }
    if (i + 2 < sWin) {
      const d2 = usableAsc[P - 3 - i];
      if (d2) {
        for (let j = 0; j < 6; j++) {
          const pn = d2.numbers[j];
          if (seenPrev[pn] !== stamp) { seenPrev[pn] = stamp; normApp[pn]++; if (pn === curSpec) normToSpecHits[pn]++; }
        }
      }
    }
  }

  const colorTrans = { red: 1 / 3, blue: 1 / 3, green: 1 / 3 };
  const zoneTrans = [0, 1 / 3, 1 / 3, 1 / 3];
  const parityTrans = [0.5, 0.5];
  if (lastSpecial != null && sWin >= 10) {
    const lastColor = WAVE_MAP[lastSpecial], lastZone = zoneOf(lastSpecial), lastOdd = lastSpecial & 1;
    const cCnt = { red: 1, blue: 1, green: 1 }; let cTot = 3;
    const zCnt = [0, 1, 1, 1]; let zTot = 3;
    const pCnt = [1, 1]; let pTot = 2;
    const transLen = Math.min(240, sWin - 1);
    for (let i = 0; i < transLen; i++) {
      const cur = usableAsc[P - 1 - i].special, prev = usableAsc[P - 2 - i].special;
      if (WAVE_MAP[prev] === lastColor) { cCnt[WAVE_MAP[cur]]++; cTot++; }
      if (zoneOf(prev) === lastZone) { zCnt[zoneOf(cur)]++; zTot++; }
      if ((prev & 1) === lastOdd) { pCnt[cur & 1]++; pTot++; }
    }
    colorTrans.red = cCnt.red / cTot; colorTrans.blue = cCnt.blue / cTot; colorTrans.green = cCnt.green / cTot;
    zoneTrans[1] = zCnt[1] / zTot; zoneTrans[2] = zCnt[2] / zTot; zoneTrans[3] = zCnt[3] / zTot;
    parityTrans[0] = pCnt[0] / pTot; parityTrans[1] = pCnt[1] / pTot;
  }

  const hotMap = new Float64Array(50), coldMap = new Float64Array(50), cycleMap = new Float64Array(50);
  const lastSpZone = lastSpecial != null ? zoneOf(lastSpecial) : -1;
  const tailSpan = Math.max(1, maxSTail - minSTail);

  for (let n = 1; n <= 49; n++) {
    const color = WAVE_MAP[n], zIdx = ((baseZ - (n - 1)) % 12 + 12) % 12, zone = zoneOf(n), isOdd = n & 1;
    const sCur = sLastSeen[n] >= 0 ? sLastSeen[n] : sOmitDefault;
    const gArr = sGaps[n];
    let sPct = 1, medianGap = 34;
    if (gArr.length > 0) {
      let le = 0;
      const vals = new Int16Array(gArr.length);
      for (let k = 0; k < gArr.length; k++) { vals[k] = gArr[k].gap; if (vals[k] <= sCur) le++; }
      sPct = le / gArr.length;
      vals.sort();
      medianGap = vals[vals.length >> 1];
    }
    const convRate = normApp[n] >= 3 ? normToSpecHits[n] / normApp[n] : 1 / 49;
    const isLastSp = lastSpecial === n;
    const diffSp = lastSpecial != null ? Math.abs(n - lastSpecial) : 99;
    const tailNorm = sTail60[n % 10] / maxSTail;
    const tailColdNorm = (maxSTail - sTail60[n % 10]) / tailSpan;
    const zodiacNorm = sZod60[zIdx] / maxSZod;
    const transScore = 0.45 * (colorTrans[color] * 3) + 0.35 * (zoneTrans[zone] * 3) + 0.20 * (parityTrans[isOdd] * 2);

    hotMap[n] =
      1.35 * ((sF15[n] * 49) / 15) + 1.65 * ((sF30[n] * 49) / 30) + 1.05 * ((sF60[n] * 49) / 60) + 1.20 * (ema20[n] * 49) +
      (diffSp === 1 ? 0.95 : diffSp === 2 ? 0.45 : 0) +
      (lastSpTail >= 0 && (n % 10) === lastSpTail && !isLastSp ? 0.40 : 0) +
      (nF3[n] > 0 ? 0.45 + Math.min(0.6, convRate * 12) : 0) +
      0.55 * tailNorm + 0.35 * zodiacNorm - (isLastSp ? 0.65 : 0) + detJitter(year, periodNum, n, 17) * 0.42;

    const omDepth = Math.min(sCur, 100) / 50;
    const normalWarmup = (lastNormMask[n] ? 0.65 : nF3[n] > 0 ? 0.35 : 0) + (nF15[n] >= 2 && nF15[n] <= 4 ? 0.35 : 0);
    const zoneShift = lastSpecial != null && zone !== lastSpZone ? 0.30 : 0;

    coldMap[n] =
      2.35 * sPct + 0.95 * omDepth + 0.55 * tailColdNorm + normalWarmup + zoneShift +
      (sCur > medianGap ? 0.45 : 0) - (sCur <= 6 ? 1.80 : 0) + detJitter(year, periodNum, n, 43) * 0.85;

    const gapRatio = medianGap > 0 ? sCur / medianGap : 1;
    const cycleWindow = Math.exp(-Math.pow(gapRatio - 0.95, 2) / 0.55);
    const steadyFreq = 1 / (1 + Math.abs(sF120[n] - 120 / 49));
    cycleMap[n] =
      1.75 * cycleWindow + 1.45 * transScore + 1.10 * steadyFreq + 0.60 * (ema45[n] * 49) +
      (lastNormMask[n] ? 0.35 : 0) - (isLastSp ? 0.80 : 0) + detJitter(year, periodNum, n, 89) * 0.45;
  }

  const hot = selectBalancedSeven(hotMap, { minPerZone: 1, maxPerZone: 3, minPerColor: 1, maxPerColor: 3, oddRange: [3, 4], bigRange: [3, 4], maxTailRepeat: 2 });
  const cold = selectBalancedSeven(coldMap, { minPerZone: 1, maxPerZone: 3, minPerColor: 1, maxPerColor: 3, oddRange: [3, 4], bigRange: [3, 4], maxTailRepeat: 2 });
  const cycle = selectBalancedSeven(cycleMap, { minPerZone: 2, maxPerZone: 3, minPerColor: 2, maxPerColor: 3, oddRange: [3, 4], bigRange: [3, 4], maxTailRepeat: 1 });

  const t2UnionSet = new Set([...hot, ...cold, ...cycle]);
  const cycSet = new Set(cycle);

  const cool4 = [];
  for (let k = 1; k <= 4 && P - k >= 0; k++) {
    const s = usableAsc[P - k].special;
    if (!cool4.includes(s)) cool4.push(s);
  }
  const cool4Set = new Set(cool4);
  const cool5Set = new Set(cool4);
  if (P - 5 >= 0) cool5Set.add(usableAsc[P - 5].special);

  const t2OptSet = new Set([...hot, ...cold].filter(n => !cycSet.has(n) && !cool4Set.has(n)));
  const t2CoreSet = new Set(hot.filter(n => cold.includes(n) && !cycSet.has(n) && !cool4Set.has(n)));

    const pool3 = [];
  for (let n = 1; n <= 49; n++) if (!t2UnionSet.has(n)) pool3.push(n);

  const relayMap = new Float64Array(50), midMap = new Float64Array(50), drainMap = new Float64Array(50);
  const lastSpNum = P > 0 ? usableAsc[P - 1].special : -1;

  for (let i = 0; i < pool3.length; i++) {
    const n = pool3[i];
    const zIdx = ((baseZ - (n - 1)) % 12 + 12) % 12, tl = n % 10;
    const clamp = (n > 1 && n < 49 && lastRawSet.has(n - 1) && lastRawSet.has(n + 1)) ? 0.45 : 0;
    const mirror = (lastSpNum > 0 && n + lastSpNum === 50) ? 0.50 : 0;

    relayMap[n] = (lastNormMask[n] ? 1.35 : 0) + 1.10 * nF3[n] + 0.45 * nF10[n] + 0.25 * aF30[n] + clamp + mirror + 0.20 * tSp25[tl];
    const midPeak = Math.exp(-Math.pow((spOmit90[n] - 23) / 7.5, 2));
    midMap[n] = 2.40 * midPeak + (spOmit90[n] >= 16 && spOmit90[n] <= 30 ? 0.85 : 0) + 0.25 * tSp25[tl] + (zSp25[zIdx] <= 1 ? 0.45 : 0) + (nF3[n] >= 1 ? 0.40 : 0);
    drainMap[n] = (zSp25[zIdx] >= 4 ? 1.80 : zSp25[zIdx] === 3 ? 0.85 : 0) + (spOmit90[n] >= 7 && spOmit90[n] <= 15 ? 1.15 : 0) + (allOmit[n] >= 10 ? 0.75 : 0) + (tSp25[tl] <= 1 ? 0.40 : 0);
  }

  const relay = selectPoolSeven(pool3, relayMap);
  const mid = selectPoolSeven(pool3, midMap);
  const drain = selectPoolSeven(pool3, drainMap);
  const drainSet = new Set(drain);
  const t3OptSet = new Set([...relay, ...mid].filter(n => !drainSet.has(n) && !cool5Set.has(n)));
  const t3GoldSet = new Set(relay.filter(n => mid.includes(n) && !drainSet.has(n) && !cool5Set.has(n)));

    const curated9Set = new Set(t1.curated9);
  const planASet = new Set(t1.curated9.filter(n => t2UnionSet.has(n)));
  const planBSet = new Set(t1.hotCold5);
  const onlineOptSet = new Set([...planASet, ...planBSet].filter(n => !cool4Set.has(n)));
  const onlineABCoreSet = new Set([...planASet].filter(n => planBSet.has(n) && !cool4Set.has(n)));

  const n2Hot = normArr(hotMap), n2Cold = normArr(coldMap), n2Kill = normArr(cycleMap);
  const n3Relay = normArr(relayMap), n3Mid = normArr(midMap), n3Kill = normArr(drainMap);

  const master = new Float64Array(50);
  

  for (let n = 1; n <= 49; n++) {
    if (cool4Set.has(n)) {
      master[n] = -100 + 0.1 * n;
      
      continue;
    }
    let sc = 0;
    const inOnline = onlineOptSet.has(n);
    const inT2 = t2OptSet.has(n);
    const inT3 = t3OptSet.has(n);
    const isGold = t3GoldSet.has(n);

    const votes = (inOnline ? 1 : 0) + (inT2 ? 1 : 0) + (inT3 ? 1 : 0)
                + (onlineABCoreSet.has(n) ? 1 : 0) + (t2CoreSet.has(n) ? 1 : 0) + (isGold ? 1 : 0);
    const kills = (cycSet.has(n) ? 1 : 0) + (drainSet.has(n) ? 1 : 0);
    const contAvg = (Math.max(n2Hot[n], n2Cold[n]) + Math.max(n3Relay[n], n3Mid[n]) + (curated9Set.has(n) ? 1 : 0)) / 3
                  - (n2Kill[n] + n3Kill[n]) / 4;
    master[n] = votes - kills + contAvg;
  }

  const ranked = ALL_49.slice().sort((a, b) => master[b] - master[a] || a - b);
  const rankOf = new Uint8Array(50);
  for (let i = 0; i < 49; i++) rankOf[ranked[i]] = i + 1;

  return {
    ranked,
    rankOf,
        cool4,
    killPools: [...new Set([...cycle, ...drain])].filter(n => !cool4Set.has(n)).sort((a, b) => a - b)
  };
}




/** Only valid records strictly before the target are visible to every dimension. */
export function sixTierPlan(draws, target) {
  const usable = draws.filter(d => isUsableDraw(d) &&
    (d.year < target.year || (d.year === target.year && d.periodNum < target.periodNum)))
    .sort((a, b) => a.year - b.year || a.periodNum - b.periodNum)
    .map(d => ({ ...d, raw7: [...d.numbers, Number(d.special)] }));
  return predictAt(usable, usable.length, target.year, target.periodNum, target.date || periodToDate(target.year, target.periodNum));
}
export { ALL_49, TIER_DEFS, WAVE_MAP, WAVE_COLOR, pad2, parseLabel, periodToDate, nextLabelOf, validSevenNums, yearZodiacBaseIdx, zodiacByBase };
