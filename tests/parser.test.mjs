import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidISODate,
  mergeDraws,
  normalizeDateString,
  normalizeDrawRecord,
  parseAmHtml,
  parseDrawsInput,
  parsePlainTextDraws,
  parseQuickDrawInput
} from '../src/parser.js';

test('normalizeDateString pads single-digit month and day', () => {
  assert.equal(normalizeDateString('2025-8-31'), '2025-08-31');
  assert.equal(normalizeDateString('2025-8-9'), '2025-08-09');
  assert.equal(normalizeDateString('2026-10-23'), '2026-10-23');
});

test('parseAmHtml parses official am.html markup including single-digit month', () => {
  const sampleHtml = `
    <ul id="msg">
      <li>
        <dt><b>296</b>期(开奖时间:2026-10-23)</dt>
        <dl>
          <div class="ball" data-name="蛇" data-index="0"><p><span class="blue">14</span><b>蛇</b></p></div>
          <div class="ball" data-name="鼠" data-index="1"><p><span class="green">43</span><b>鼠</b></p></div>
          <div class="ball" data-name="蛇" data-index="2"><p><span class="blue">26</span><b>蛇</b></p></div>
          <div class="ball" data-name="狗" data-index="3"><p><span class="red">45</span><b>狗</b></p></div>
          <div class="ball" data-name="龙" data-index="4"><p><span class="blue">03</span><b>龙</b></p></div>
          <div class="ball" data-name="鼠" data-index="5"><p><span class="blue">31</span><b>鼠</b></p></div>
          <div class="ball" data-name="猴" data-index="6"><p><span class="red">23</span><b>猴</b></p></div>
        </dl>
      </li>
      <li>
        <dt><b>243</b>期(开奖时间:2025-8-31)</dt>
        <dl>
          <div class="ball" data-name="蛇" data-index="0"><p><span class="red">01</span><b>蛇</b></p></div>
          <div class="ball" data-name="龙" data-index="1"><p><span class="red">02</span><b>龙</b></p></div>
          <div class="ball" data-name="兔" data-index="2"><p><span class="blue">03</span><b>兔</b></p></div>
          <div class="ball" data-name="虎" data-index="3"><p><span class="blue">04</span><b>虎</b></p></div>
          <div class="ball" data-name="牛" data-index="4"><p><span class="green">05</span><b>牛</b></p></div>
          <div class="ball" data-name="鼠" data-index="5"><p><span class="green">06</span><b>鼠</b></p></div>
          <div class="ball" data-name="猪" data-index="6"><p><span class="red">07</span><b>猪</b></p></div>
        </dl>
      </li>
    </ul>
  `;

  const parsed = parseAmHtml(sampleHtml);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].id, '2026-296');
  assert.deepEqual(parsed[0].numbers, [14, 43, 26, 45, 3, 31]);
  assert.equal(parsed[0].special, 23);
  assert.equal(parsed[1].id, '2025-243');
  assert.equal(parsed[1].date, '2025-08-31');
});

test('parsePlainTextDraws supports copied webpage text and manual shorthand lines', () => {
  const copiedPageText = `
    296期(开奖时间:2026-10-23)
    14
    蛇
    43
    鼠
    26
    蛇
    45
    狗
    03
    龙
    31
    鼠
    23
    猴
  `;
  const res1 = parsePlainTextDraws(copiedPageText);
  assert.equal(res1.length, 1);
  assert.equal(res1[0].id, '2026-296');
  assert.deepEqual(res1[0].numbers, [14, 43, 26, 45, 3, 31]);
  assert.equal(res1[0].special, 23);

  const manualLines = `
    297期 2026-10-24 08 15 22 31 39 45 + 12
    2026-298期 2026-10-25: 02, 11, 19, 27, 35, 44, 09
  `;
  const res2 = parseDrawsInput(manualLines);
  assert.equal(res2.length, 2);
  assert.equal(res2[0].id, '2026-297');
  assert.deepEqual(res2[0].numbers, [8, 15, 22, 31, 39, 45]);
  assert.equal(res2[0].special, 12);
  assert.equal(res2[1].id, '2026-298');
});

test('mergeDraws is idempotent and sorts descending by year and periodNum', () => {
  const d1 = parseDrawsInput('295期 2026-10-22 22 28 33 17 13 47 + 25');
  const d2 = parseDrawsInput('296期 2026-10-23 14 43 26 45 03 31 + 23');
  const { merged, addedCount } = mergeDraws(d1, d2);
  assert.equal(merged.length, 2);
  assert.equal(addedCount, 1);
  assert.equal(merged[0].id, '2026-296');
  assert.equal(merged[1].id, '2026-295');

  // 重复合并同一条记录，addedCount 应为 0
  const { merged: mergedAgain, addedCount: addedAgain } = mergeDraws(merged, d2);
  assert.equal(mergedAgain.length, 2);
  assert.equal(addedAgain, 0);
});

test('isValidISODate 拒绝不存在的日期与注入载荷', () => {
  assert.equal(isValidISODate('2026-10-24'), true);
  assert.equal(isValidISODate('2026-02-28'), true);
  assert.equal(isValidISODate('2024-02-29'), true); // 闰年
  assert.equal(isValidISODate('2026-02-30'), false);
  assert.equal(isValidISODate('2026-13-45'), false);
  assert.equal(isValidISODate('2026-00-10'), false);
  assert.equal(isValidISODate('2026-10-32'), false);
  assert.equal(isValidISODate('26-10-24'), false);
  assert.equal(isValidISODate('2026/10/24'), false);
  assert.equal(isValidISODate('<img src=x onerror=alert(1)>'), false);
  assert.equal(isValidISODate(''), false);
  assert.equal(isValidISODate(null), false);
});

test('normalizeDrawRecord 丢弃非法日期，但保留记录本身（不丢开奖数据）', () => {
  const rec = normalizeDrawRecord({
    year: 2026,
    periodNum: 298,
    date: '2026-13-45',
    numbers: [1, 2, 3, 4, 5, 6],
    special: 7
  });
  assert.ok(rec);
  assert.equal(rec.id, '2026-298');
  assert.equal(rec.date, '2026-01-01'); // 非法日期回落到安全默认值
  assert.deepEqual(rec.numbers, [1, 2, 3, 4, 5, 6]);
});

test('normalizeDrawRecord 拒绝带注入载荷的日期（不会进 innerHTML）', () => {
  const rec = normalizeDrawRecord({
    year: 2026,
    periodNum: 299,
    date: '<img src=x onerror="window.__XSS__=true">',
    numbers: [1, 2, 3, 4, 5, 6],
    special: 7
  });
  assert.ok(rec);
  assert.ok(!rec.date.includes('img'));
  assert.ok(!rec.date.includes('onerror'));
  assert.equal(rec.date, '2026-01-01');
});

test('parseDrawsInput 解析出的记录日期都必须是合法日期', () => {
  const parsed = parseDrawsInput('298期 2026-13-45 01 02 03 04 05 06 + 07');
  for (const rec of parsed) {
    assert.ok(isValidISODate(rec.date), `日期必须合法：${rec.date}`);
  }
});

test('parseQuickDrawInput 自动识别 1–49 号码（忽略日期 / 期号 / 生肖 / 标签）', () => {
  const cases = [
    {
      text: '05 14 23 31 38 45 + 08',
      numbers: [5, 14, 23, 31, 38, 45],
      special: 8
    },
    {
      text: '第303期 2026-10-30 05 14 23 31 38 45 08',
      numbers: [5, 14, 23, 31, 38, 45],
      special: 8
    },
    {
      text: '2026-304期 2026-10-31: 02, 11, 19, 27, 35, 44, 09',
      numbers: [2, 11, 19, 27, 35, 44],
      special: 9
    },
    {
      text: '303期(开奖时间:2026-10-30)\n08\n猪\n14\n蛇\n23\n猴\n26\n蛇\n31\n鼠\n45\n狗\n12\n羊',
      numbers: [8, 14, 23, 26, 31, 45],
      special: 12
    },
    {
      text: '开奖号码：０５ １４ ２３ ３１ ３８ ４５ ＋ ０８',
      numbers: [5, 14, 23, 31, 38, 45],
      special: 8
    }
  ];

  for (const c of cases) {
    const parsed = parseQuickDrawInput(c.text);
    assert.deepEqual(parsed.numbers, c.numbers, `正码解析错误：${c.text}`);
    assert.equal(parsed.special, c.special, `特码解析错误：${c.text}`);
  }
});

test('parseQuickDrawInput 去重、过滤 1–49 之外的数字，并忽略多余号码', () => {
  const parsed = parseQuickDrawInput('2026-10-30 第305期 05 14 23 31 38 45 08 05 49 50 00');
  assert.deepEqual(parsed.numbers, [5, 14, 23, 31, 38, 45]);
  assert.equal(parsed.special, 8);
  assert.ok(parsed.ignored > 0, '多余号码应被计入 ignored');

  const noPlus = parseQuickDrawInput('01 02 03 04 05 06 07');
  assert.deepEqual(noPlus.numbers, [1, 2, 3, 4, 5, 6]);
  assert.equal(noPlus.special, 7);

  const tooFew = parseQuickDrawInput('05 14 23 31 38 45');
  assert.deepEqual(tooFew.numbers, [5, 14, 23, 31, 38, 45]);
  assert.equal(tooFew.special, null);
});

test('parseQuickDrawInput 特码与正码重复时不会凑出重复号码', () => {
  const parsed = parseQuickDrawInput('05 14 23 31 38 45 + 45');
  assert.equal(parsed.special, null, '特码与正码重复时应判定为无效');
  const fallback = parseQuickDrawInput('05 14 23 31 38 45 + 45 12');
  assert.equal(fallback.special, 12, '应顺延取 + 后面不重复的号码');
  assert.ok(!fallback.numbers.includes(fallback.special), '特码不能出现在正码里');
});

test('parseQuickDrawInput 忽略占位说明里的号码范围（1-49 / 1-80）', () => {
  const parsed = parseQuickDrawInput('输入或粘贴当期 7 个开奖号码（1-49，空格/逗号/顿号分隔，自动升序排列），如：02、08、09、13、14、31、45');
  assert.deepEqual(parsed.numbers, [2, 8, 9, 13, 14, 31]);
  assert.equal(parsed.special, 45);
  const other = parseQuickDrawInput('输入或粘贴当期 20 个开奖号码（1-80，空格/逗号/顿号分隔），如：02 08 09 13 14 31 45');
  assert.deepEqual(other.numbers, [2, 8, 9, 13, 14, 31]);
  assert.equal(other.special, 45);
});

test('parsePlainTextDraws 兼容阅读器/代理返回的 Markdown 加粗格式', () => {
  const text = `**305** 期(开奖时间:2026-11-01)

31 **鼠**

49 **马**

29 **虎**

44 **猪**

18 **牛**

40 **兔**

26 **蛇**`;
  const parsed = parseDrawsInput(text);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, '2026-305');
  assert.deepEqual(parsed[0].numbers, [31, 49, 29, 44, 18, 40]);
  assert.equal(parsed[0].special, 26);
});
