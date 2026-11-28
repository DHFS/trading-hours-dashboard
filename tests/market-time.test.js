// 交易时段引擎单元测试：node tests/market-time.test.js
// 所有时刻均以 UTC 毫秒时间戳显式给出，避免依赖运行机器的本地时区
const assert = require('assert');
const T = require('../js/market-time.js');
const D = require('../js/data.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    console.error('  ✗ ' + name + '\n    ' + e.message);
    process.exitCode = 1;
  }
}
const utc = (y, m, d, hh = 0, mm = 0) => Date.UTC(y, m - 1, d, hh, mm);
const st = (id, ms) => T.getStatus(id, T.beijingNow(ms));

const STATUS_TO_CLS = {
  open: 'tl-open', lunch: 'tl-lunch', pre: 'tl-pre', post: 'tl-post',
  overnight: 'tl-overnight', weekend: 'tl-closed', holiday: 'tl-holiday'
};
function assertTimelineMatchesStatus(id, ms) {
  const now = T.beijingNow(ms);
  const s = T.getStatus(id, now);
  const segs = s.timelineSegs;
  assert.ok(segs.length > 0 && segs[0].start === 0 && segs[segs.length - 1].end === 1440, id + ' 时间轴需覆盖 [0, 1440]');
  for (let i = 1; i < segs.length; i++) {
    assert.strictEqual(segs[i].start, segs[i - 1].end, id + ' 时间轴不能有缝隙');
  }
  const hit = segs.find(x => now.minute >= x.start && now.minute < x.end);
  assert.ok(hit, id + ' 指针位置找不到对应分段');
  assert.strictEqual(hit.cls, STATUS_TO_CLS[s.status], id + ' @ ' + now.key + ' ' + now.h + ':' + now.min + ' 状态=' + s.status + ' 指针所在分段=' + hit.cls);
}

console.log('美股夏令时（B1：跨年）');
test('2026 夏令时起止', () => {
  assert.strictEqual(T.usOffsetForEtDate('2026-03-07'), 5);
  assert.strictEqual(T.usOffsetForEtDate('2026-03-09'), 4);
  assert.strictEqual(T.usOffsetForEtDate('2026-10-30'), 4);
  assert.strictEqual(T.usOffsetForEtDate('2026-11-02'), 5);
});
test('2027 夏令时起止（不再硬编码 2026）', () => {
  assert.deepStrictEqual(T.usDstBoundsForYear(2027), { startKey: '2027-03-14', endKey: '2027-11-07' });
  assert.strictEqual(T.usOffsetForEtDate('2027-03-13'), 5);
  assert.strictEqual(T.usOffsetForEtDate('2027-03-15'), 4);
  assert.strictEqual(T.usOffsetForEtDate('2027-11-05'), 4);
  assert.strictEqual(T.usOffsetForEtDate('2027-11-08'), 5);
});
test('usIsDST 切换时刻', () => {
  assert.strictEqual(T.usIsDST(utc(2027, 3, 14, 6, 59)), false);
  assert.strictEqual(T.usIsDST(utc(2027, 3, 14, 7, 0)), true);
  assert.strictEqual(T.usIsDST(utc(2027, 11, 7, 5, 59)), true);
  assert.strictEqual(T.usIsDST(utc(2027, 11, 7, 6, 0)), false);
});
test('2027 夏令时期间美股 09:30 ET = 13:30 UTC 开盘', () => {
  assert.strictEqual(st('us', utc(2027, 6, 15, 13, 29)).status, 'pre');
  assert.strictEqual(st('us', utc(2027, 6, 15, 13, 30)).status, 'open');
  assert.strictEqual(st('us', utc(2027, 6, 15, 19, 59)).status, 'open');
  assert.strictEqual(st('us', utc(2027, 6, 15, 20, 0)).status, 'post');
});

console.log('2027 节假日与半日市');
test('2027-01-01 亚太市场休市', () => {
  const ms = utc(2027, 1, 1, 4, 0); // 北京 12:00
  for (const id of ['aShare', 'hk', 'jp', 'kr']) assert.strictEqual(st(id, ms).status, 'holiday', id);
  assert.strictEqual(st('aShare', ms).holidayName, '元旦');
});
test('2027-01-01 美股休市（美东日期）', () => {
  assert.strictEqual(st('us', utc(2027, 1, 1, 15, 0)).status, 'holiday');
});
test('2027-02-05 港股半日市，A股春节休市', () => {
  assert.strictEqual(st('hk', utc(2027, 2, 5, 2, 0)).status, 'open');  // 北京 10:00
  assert.ok(st('hk', utc(2027, 2, 5, 2, 0)).detail.includes('半日市'));
  assert.strictEqual(st('hk', utc(2027, 2, 5, 6, 0)).status, 'overnight'); // 北京 14:00 已收盘
  assert.strictEqual(st('aShare', utc(2027, 2, 5, 2, 0)).status, 'holiday');
  assert.strictEqual(st('aShare', utc(2027, 2, 5, 2, 0)).holidayName, '春节');
});
test('2027-02-14 周日调休上班日 A 股仍休市', () => {
  assert.strictEqual(st('aShare', utc(2027, 2, 14, 2, 0)).status, 'weekend');
  assert.strictEqual(st('aShare', utc(2027, 2, 12, 2, 0)).status, 'holiday');
});
test('2027-11-26 美股提前收盘 13:00 ET', () => {
  assert.strictEqual(st('us', utc(2027, 11, 26, 17, 30)).status, 'open'); // ET 12:30
  assert.strictEqual(st('us', utc(2027, 11, 26, 18, 30)).status, 'post'); // ET 13:30
});
test('日历覆盖判断', () => {
  assert.strictEqual(T.isCalendarCovered('2027-12-31'), true);
  assert.strictEqual(T.isCalendarCovered('2028-01-01'), false);
});

console.log('常规市场时段');
test('A股 早盘/午休/午盘/收盘', () => {
  assert.strictEqual(st('aShare', utc(2026, 12, 1, 2, 0)).status, 'open');
  const lunch = st('aShare', utc(2026, 12, 1, 4, 0));
  assert.strictEqual(lunch.status, 'lunch');
  assert.strictEqual(lunch.countdownLabel, '距午盘');
  assert.strictEqual(lunch.targetMs, utc(2026, 12, 1, 5, 0));
  const closed = st('aShare', utc(2026, 12, 1, 8, 0));
  assert.strictEqual(closed.status, 'overnight');
  assert.strictEqual(closed.targetMs, utc(2026, 12, 2, 1, 30));
});

console.log('ICE 布伦特原油');
test('夏令/冬令时判定边界', () => {
  assert.strictEqual(T.ukIsDST(utc(2026, 3, 29, 0, 59)), false);
  assert.strictEqual(T.ukIsDST(utc(2026, 3, 29, 1, 0)), true);
  assert.strictEqual(T.ukIsDST(utc(2026, 10, 25, 0, 59)), true);
  assert.strictEqual(T.ukIsDST(utc(2026, 10, 25, 1, 0)), false);
});
test('冬令时：周五 19:58 交易中，倒计时到伦敦 23:00', () => {
  const s = st('brent', utc(2026, 11, 27, 19, 58));
  assert.strictEqual(s.status, 'open');
  assert.strictEqual(s.targetMs, utc(2026, 11, 27, 23, 0));
  assert.ok(s.detail.includes('冬令时'));
});
test('冬令时：周五 23:05 周末休市，下周一北京 09:00 开盘', () => {
  const s = st('brent', utc(2026, 11, 27, 23, 5));
  assert.strictEqual(s.status, 'weekend');
  assert.strictEqual(s.targetMs, utc(2026, 11, 30, 1, 0));
  assert.strictEqual(T.beijingNow(s.targetMs).h, 9);
});
test('冬令时：周一伦敦 00:30 仍为周末休市', () => {
  const s = st('brent', utc(2026, 11, 30, 0, 30));
  assert.strictEqual(s.status, 'weekend');
  assert.strictEqual(s.targetMs, utc(2026, 11, 30, 1, 0));
});
test('冬令时：周二维护窗口（伦敦 23:00–01:00）', () => {
  const a = st('brent', utc(2026, 12, 1, 0, 30));
  assert.strictEqual(a.status, 'overnight');
  assert.strictEqual(a.targetMs, utc(2026, 12, 1, 1, 0));
  const b = st('brent', utc(2026, 12, 1, 23, 30));
  assert.strictEqual(b.status, 'overnight');
  assert.strictEqual(b.targetMs, utc(2026, 12, 2, 1, 0));
  assert.ok(b.detail.includes('07:00–09:00'));
});
test('夏令时：维护窗口北京 06:00–08:00，08:00 开盘', () => {
  const a = st('brent', utc(2026, 7, 7, 22, 30)); // 伦敦 23:30 BST
  assert.strictEqual(a.status, 'overnight');
  assert.strictEqual(a.targetMs, utc(2026, 7, 8, 0, 0));
  assert.strictEqual(T.beijingNow(a.targetMs).h, 8);
  assert.ok(a.detail.includes('06:00–08:00'));
  assert.strictEqual(st('brent', utc(2026, 7, 8, 0, 30)).status, 'open');
});
test('ICE 休市日', () => {
  assert.strictEqual(st('brent', utc(2026, 12, 25, 10, 0)).status, 'holiday');
  const g = st('brent', utc(2027, 3, 26, 10, 0));
  assert.strictEqual(g.status, 'holiday');
  assert.strictEqual(g.targetMs, utc(2027, 3, 29, 0, 0)); // 周一伦敦 01:00 BST
});
test('周四收盘后跨休市周五，下一次开盘为周一', () => {
  const s = st('brent', utc(2026, 12, 24, 23, 30)); // 周四伦敦 23:30，次日圣诞休市
  assert.strictEqual(s.status, 'overnight');
  assert.strictEqual(s.targetMs, utc(2026, 12, 28, 1, 0));
});

console.log('其他');
test('加密货币恒为交易中且排序距离为 0', () => {
  const now = T.beijingNow(utc(2026, 11, 28, 0, 0));
  assert.strictEqual(T.getStatus('crypto', now).status, 'open');
  assert.strictEqual(T.nextOpenMsOf('crypto', now), now.nowMs);
});
test('格式化与紧凑倒计时', () => {
  assert.strictEqual(T.fmtClockCountdown(216 * 3600e3 + 5000), '216:00:05');
  assert.strictEqual(T.fmtCompactDuration(45 * 3600e3 + 22 * 60e3), '45h 22m');
  assert.strictEqual(T.fmtCompactDuration(9 * 60e3), '9m');
  assert.strictEqual(T.fmtCompactDuration(10 * 1000), '<1m');
  assert.strictEqual(T.fmtPrice(6.65512, 4), '6.6551');
  assert.strictEqual(T.fmtPrice(3681.1, 1), '3,681.1');
  assert.strictEqual(T.fmtFloatValue(72.456, 2), '72.46');
  assert.strictEqual(T.fmtFloatValue(108542.4, 0), '108542');
  assert.strictEqual(T.fmtFloatValue(null, 0), '--');
  assert.strictEqual(T.fmtPct(1.234), '+1.23%');
});
test('去复读校验：非交易态 detail 不重复输出状态词或（北京）', () => {
  const wk = T.beijingNow(utc(2026, 11, 28, 12, 0)); // 周六休市
  for (const id of D.MARKET_IDS) {
    if (id === 'crypto') continue;
    const s = T.getStatus(id, wk);
    assert.ok(!s.detail.includes('休市'), id + ' 周末 detail 不应重复“休市”: ' + s.detail);
    assert.ok(!s.detail.includes('（北京）'), id + ' detail 不应重复“（北京）”: ' + s.detail);
  }
  const night = T.beijingNow(utc(2026, 12, 1, 12, 0)); // 周二晚间美股盘前、亚太隔夜
  assert.ok(!T.getStatus('aShare', night).detail.includes('已收盘'));
  assert.ok(!T.getStatus('eu', night).detail.includes('（北京）'));
});
test('时间完整性：2026/2027 条目均为合法日期且升序无重复', () => {
  for (const id of ['hk', 'hkHalf', 'jp', 'kr', 'eu', 'us', 'usEarly', 'gold', 'brent']) {
    const arr = D.HOLIDAYS[id];
    for (const k of arr) assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(k) && !isNaN(Date.parse(k)), id + ' ' + k);
    assert.deepStrictEqual(arr, Array.from(new Set(arr)).sort(), id + ' 应升序且无重复');
  }
});

console.log('CME / COMEX 黄金');
test('冬令时：周六北京 05:30 交易中，06:15 周末休市且周一 07:00 开盘', () => {
  const bj = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh - 8, mm);
  const sOpen = st('gold', bj(2026, 11, 28, 5, 30)); // 周五 16:30 EST
  assert.strictEqual(sOpen.status, 'open');
  assert.ok(sOpen.detail.includes('07:00–次日06:00'));
  assert.strictEqual(sOpen.targetMs, bj(2026, 11, 28, 6, 0));

  const sEnd = st('gold', bj(2026, 11, 28, 6, 15)); // 周五 17:15 EST
  assert.strictEqual(sEnd.status, 'weekend');
  assert.strictEqual(sEnd.targetMs, bj(2026, 11, 30, 7, 0)); // 周日 18:00 EST = 北京周一 07:00
});
test('冬令时与夏令时：每日 1 小时维护休市窗口', () => {
  const bj = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh - 8, mm);
  // 冬令时：周二北京 06:30（周一 17:30 EST）维护休市，07:00 恢复
  const wBreak = st('gold', bj(2026, 12, 1, 6, 30));
  assert.strictEqual(wBreak.status, 'overnight');
  assert.ok(wBreak.detail.includes('06:00–07:00'));
  assert.strictEqual(wBreak.targetMs, bj(2026, 12, 1, 7, 0));
  assert.strictEqual(st('gold', bj(2026, 12, 1, 7, 0)).status, 'open');

  // 夏令时：周三北京 05:30（周二 17:30 EDT）维护休市，06:00 恢复
  const sBreak = st('gold', bj(2026, 7, 8, 5, 30));
  assert.strictEqual(sBreak.status, 'overnight');
  assert.ok(sBreak.detail.includes('05:00–06:00'));
  assert.strictEqual(sBreak.targetMs, bj(2026, 7, 8, 6, 0));
  assert.strictEqual(st('gold', bj(2026, 7, 8, 6, 0)).status, 'open');
});
test('COMEX 黄金节假日（元旦、耶稣受难日、圣诞节）', () => {
  const bj = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh - 8, mm);
  // 2026-12-25 圣诞节（平安夜 18:30 EST = 北京周五 07:30）全天 holiday，下次开盘为周一北京 07:00
  const xmas = st('gold', bj(2026, 12, 25, 7, 30));
  assert.strictEqual(xmas.status, 'holiday');
  assert.strictEqual(xmas.targetMs, bj(2026, 12, 28, 7, 0));
  // 2027-03-26 耶稣受难日（周四 18:30 EDT = 北京周五 06:30）holiday，下次开盘为周一夏令时 06:00
  const gf = st('gold', bj(2027, 3, 26, 10, 0));
  assert.strictEqual(gf.status, 'holiday');
  assert.strictEqual(gf.targetMs, bj(2027, 3, 29, 6, 0));
  // 2026-01-01 元旦白天为 holiday，当晚 18:30 EST（北京周五 07:30）恢复交易
  assert.strictEqual(st('gold', bj(2026, 1, 1, 14, 0)).status, 'holiday');
  assert.strictEqual(st('gold', bj(2026, 1, 2, 7, 30)).status, 'open');
});

console.log('欧股 XETRA 与集合竞价');
test('欧股夏令时（北京 15:00–23:30）与冬令时（北京 16:00–00:30）', () => {
  const bj = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh - 8, mm);
  // 2026-07-08 夏令时：14:59 隔夜、15:00 开盘、23:30 收盘
  assert.strictEqual(st('eu', bj(2026, 7, 8, 14, 59)).status, 'overnight');
  const euSummer = st('eu', bj(2026, 7, 8, 15, 0));
  assert.strictEqual(euSummer.status, 'open');
  assert.ok(euSummer.detail.includes('15:00–23:30'));
  assert.strictEqual(st('eu', bj(2026, 7, 8, 23, 30)).status, 'overnight');

  // 2026-11-30 周一冬令时 16:00 开盘；2026-12-01 周二凌晨 00:15 仍在交易中，00:35 隔夜
  assert.strictEqual(st('eu', bj(2026, 11, 30, 15, 59)).status, 'overnight');
  assert.strictEqual(st('eu', bj(2026, 11, 30, 16, 0)).status, 'open');
  assert.strictEqual(st('eu', bj(2026, 12, 1, 0, 15)).status, 'open');
  assert.strictEqual(st('eu', bj(2026, 12, 1, 0, 35)).status, 'overnight');
  assertTimelineMatchesStatus('eu', bj(2026, 12, 1, 0, 15));
  assertTimelineMatchesStatus('eu', bj(2026, 12, 1, 0, 35));
});
test('欧股假期休市（圣诞平安夜/除夕）', () => {
  const bj = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh - 8, mm);
  assert.strictEqual(st('eu', bj(2026, 12, 24, 18, 0)).status, 'holiday');
  assert.strictEqual(st('eu', bj(2027, 12, 31, 18, 0)).status, 'holiday');
});
test('A股 09:15–09:25 与港股 09:00–09:20 集合竞价微状态', () => {
  const bj = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh - 8, mm);
  const aPre = st('aShare', bj(2026, 12, 1, 9, 20));
  assert.strictEqual(aPre.status, 'pre');
  assert.ok(aPre.detail.includes('集合竞价'));
  assertTimelineMatchesStatus('aShare', bj(2026, 12, 1, 9, 20));
  assert.strictEqual(st('aShare', bj(2026, 12, 1, 9, 26)).status, 'overnight');

  const hPre = st('hk', bj(2026, 12, 1, 9, 10));
  assert.strictEqual(hPre.status, 'pre');
  assertTimelineMatchesStatus('hk', bj(2026, 12, 1, 9, 10));
  // 2027-02-05 半日市也包含开市前竞价
  assert.strictEqual(st('hk', bj(2027, 2, 5, 9, 10)).status, 'pre');
});

console.log('时间轴指针与状态一致性回归');
test('2026-11-28 04:27 北京时间（美股提前收盘日盘后）：指针落在 tl-post 且详情正确', () => {
  const bj = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh - 8, mm);
  const s0130 = st('us', bj(2026, 11, 28, 1, 30));
  assert.strictEqual(s0130.status, 'open');
  assert.ok(s0130.detail.includes('21:30–01:00') || s0130.detail.includes('22:30–02:00'));
  assert.ok(s0130.detail.includes('提前收盘'));
  assertTimelineMatchesStatus('us', bj(2026, 11, 28, 1, 30));

  const s0427 = st('us', bj(2026, 11, 28, 4, 27));
  assert.strictEqual(s0427.status, 'post');
  assert.ok(s0427.detail.includes('02:00–06:00'));
  assert.ok(s0427.detail.includes('提前收盘'));
  const hit = s0427.timelineSegs.find(x => 267 >= x.start && 267 < x.end);
  assert.strictEqual(hit.cls, 'tl-post');
  assert.strictEqual(hit.start, 120);
  assert.strictEqual(hit.end, 360);
  assertTimelineMatchesStatus('us', bj(2026, 11, 28, 4, 27));

  assert.strictEqual(st('us', bj(2026, 11, 28, 6, 30)).status, 'overnight');
  assertTimelineMatchesStatus('us', bj(2026, 11, 28, 6, 30));
});
test('2027-11-26 提前收盘日（北京 2027-11-27 04:00）：post 且落在 tl-post', () => {
  const ms = Date.UTC(2027, 10, 26, 20, 0); // 北京 2027-11-27 04:00
  assert.strictEqual(st('us', ms).status, 'post');
  assertTimelineMatchesStatus('us', ms);
});
test('跨周末边界及全部 9 大市场多时刻：指针所在分段与状态 100% 一致', () => {
  const samples = [
    utc(2026, 11, 27, 20, 27), // 北京周六 04:27（美股提前收盘盘后 / 原油交易中）
    utc(2026, 11, 28, 12, 0),  // 北京周六 20:00（均周末）
    utc(2026, 11, 30, 1, 20),  // 北京周一 09:20（A股/港股竞价）
    utc(2026, 11, 30, 2, 0),   // 北京周一 10:00（亚太交易中 / 欧美隔夜 / 原油交易中）
    utc(2026, 11, 30, 15, 0),  // 北京周一 23:00（欧美重叠交易中）
    utc(2026, 7, 8, 0, 30),    // 夏令时周三北京 08:30（原油刚开盘）
    utc(2026, 12, 25, 10, 0),  // 圣诞节休市
    utc(2027, 2, 5, 2, 0)      // 港股半日市 / A股春节
  ];
  for (const ms of samples) {
    for (const id of D.MARKET_IDS) assertTimelineMatchesStatus(id, ms);
  }
});

console.log('\n通过 ' + passed + ' 项' + (process.exitCode ? '，存在失败' : ''));
