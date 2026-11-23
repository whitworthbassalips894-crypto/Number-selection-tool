/**
 * 页面测试的公共装载器。
 *
 * 背景：选号求解器现在只有一份实现（src/seven-picker.js），页面用动态
 * import 加载它。jsdom 不支持动态 import（会抛
 * "A dynamic import callback was not specified"），因此测试里无法让页面
 * 自己完成模块加载。
 *
 * 这里的做法是：Node 侧先 import 同一份 src/seven-picker.js，配置好与页面
 * 一致的依赖（分区 / 波色 / 49 码），然后在页面脚本跑完之后把它注入到
 * window.sevenPickerMod —— 这正是页面在「模块已就绪」时的内部状态。
 * 于是测试走的仍是 src/seven-picker.js 的真实实现，无需任何测试替身。
 */
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import * as sevenPicker from '../../src/seven-picker.js';

export const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

/** 波色表，与 index.html 的 WAVE_MAP 同源。 */
const WAVE_MAP = (() => {
  const out = {};
  for (const n of [1, 2, 7, 8, 12, 13, 18, 19, 23, 24, 29, 30, 34, 35, 40, 45, 46]) out[n] = 'red';
  for (const n of [3, 4, 9, 10, 14, 15, 20, 25, 26, 31, 36, 37, 41, 42, 47, 48]) out[n] = 'blue';
  for (let n = 1; n <= 49; n++) if (!out[n]) out[n] = 'green';
  return out;
})();

sevenPicker.configureSevenPicker({
  zoneOf: (n) => (n <= 16 ? 1 : n <= 33 ? 2 : 3),
  colorOf: (n) => WAVE_MAP[n],
  allNumbers: Array.from({ length: 49 }, (_, i) => i + 1),
  defaultSize: 7,
});

/** 与页面配置一致的求解器模块。 */
export const picker = sevenPicker;

/**
 * 构造页面 JSDOM 并把求解器接到已就绪状态。
 * @param {object} [options] 透传给 JSDOM 的额外选项
 */
export async function createPage(options = {}) {
  const dom = new JSDOM(html, {
    url: 'https://example.com/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    // 必须在页面脚本执行「之前」把求解器挂好：脚本里末尾会立刻 refreshAll()，
    // 等到构造完成后再注入就晚了（首屏会先因为求解器不可用而失败）。
    beforeParse(window) {
      // 页面以此作为「模块已就绪」的预载口
      window.__sevenPickerModule = sevenPicker;
    },
    ...options,
  });
  // 首屏渲染是异步的（refreshAll 返回 Promise），这里等它跑完，
  // 之后再补一次重渲染，确保断言看到的是稳定状态。
  if (typeof dom.window.refreshAll === 'function') await dom.window.refreshAll();
  return dom;
}
