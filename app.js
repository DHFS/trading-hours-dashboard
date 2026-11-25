// ============================================================
// 交易时段看板 - 核心逻辑
// 北京时间基准（Asia/Shanghai），与浏览器/设备时区无关
// ============================================================

// ---------- 全屏单卡模式（URL hash #crypto/#us 等启用，body 加 .mode-fullscreen） ----------
// 固定切换顺序：加密货币 → A股 → 港股 → 日经 → 韩股 → 美股
const MARKET_IDS = ['crypto', 'aShare', 'hk', 'jp', 'kr', 'us', 'gold', 'brent', 'usdcnh', 'vix'];

function readInitialMarket() {
  const h = window.location.hash.replace('#', '');
  if (MARKET_IDS.indexOf(h) >= 0) return h;
  const q = new URLSearchParams(window.location.search).get('market'); // 兼容旧 ?market= 链接
  if (q && MARKET_IDS.indexOf(q) >= 0) return q;
  return null;
}

let currentMarket = readInitialMarket();
const IS_FULLSCREEN = !!currentMarket;
if (IS_FULLSCREEN) {
  document.body.classList.add('mode-fullscreen');
  if (window.location.hash !== '#' + currentMarket) {
    history.replaceState(null, '', '#' + currentMarket);
  }
}

// ---------- 工具函数 ----------
function pad(n) { return n < 10 ? '0' + n : '' + n; }

const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function beijingNow() {
  const nowMs = Date.now();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = {};
  for (const p of fmt.formatToParts(new Date(nowMs))) parts[p.type] = p.value;
  const y = +parts.year, m = +parts.month, d = +parts.day;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const h = +parts.hour % 24, min = +parts.minute, s = +parts.second;
  return {
    nowMs, y, m, d, h, min, s,
    weekday: weekdayMap[parts.weekday],
    key: y + '-' + pad(m) + '-' + pad(d),
    minute: h * 60 + min
  };
}

function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d, weekday: new Date(y, m - 1, d).getDay() };
}

function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
}

function inRanges(key, ranges) {
  return ranges.some(([a, b]) => key >= a && key <= b);
}

// 北京时间某日的 minute 分钟 -> 绝对时间戳（UTC+8）
function bjMinuteToMs(key, minute) {
  const [y, m, d] = key.split('-').map(Number);
  const hh = Math.floor(minute / 60), mm = minute % 60;
  return Date.UTC(y, m - 1, d, hh - 8, mm);
}

function fmtDuration(ms) {
  if (ms <= 0) return '已到';
  const totalMin = Math.round(ms / 60000);
  const hh = Math.floor(totalMin / 60), mm = totalMin % 60;
  if (hh > 0) return hh + ' 小时 ' + mm + ' 分';
  if (mm > 0) return '约 ' + mm + ' 分钟';
  return '不足 1 分钟';
}

// 秒级倒计时 HH:MM:SS（时钟模式用，每秒跳动）
function fmtClockCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  return pad(Math.floor(totalSec / 3600)) + ':' + pad(Math.floor((totalSec % 3600) / 60)) + ':' + pad(totalSec % 60);
}

function fmtPrice(v) {
  // 收盘时展示最近一次成交价，盘前/盘中/盘后/隔夜展示最新价（均为接口返回的"最新价"）。
  // 无有效价格（null/NaN/0）时显示占位符，避免误导。
  if (v == null || !isFinite(v) || v <= 0) return '--';
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// BTC 价格：仅保留整数、无千分位分隔符（如 59734），供 Float 主题逐位拆分渲染
function fmtBtcPrice(v) {
  if (v == null || !isFinite(v) || v <= 0) return '--';
  return Math.round(v).toString();
}
function fmtPct(v) {
  if (v == null) return '--';
  const s = v > 0 ? '+' : '';
  return s + v.toFixed(2) + '%';
}

// BTC 双拼混色预设（进阶多色模式）：按「深A-亮B-亮A-深B」明暗节奏，D1~D4 循环分配（严格按 ios_standby_float.md 2.2 节）
const BTC_PALETTES = [
  { name: '蓝绿波普', colors: ['#0560BE', '#65DC84', '#549FF8', '#248A5E'] },
  { name: '蓝橙撞色', colors: ['#569DF5', '#FF9E44', '#0A62C4', '#B85A14'] },
  { name: '紫粉霓虹', colors: ['#4928B8', '#E26EC7', '#7C54F6', '#9E3686'] },
  { name: '珊瑚暖阳', colors: ['#D9483B', '#FFDA4E', '#FF7B72', '#C98A18'] },
  { name: '西瓜青柠', colors: ['#B53156', '#49D5DF', '#F4648A', '#1B8B96'] }
];
// 每次刷新网页时随机选择一个配色预设
const btcPalette = BTC_PALETTES[Math.floor(Math.random() * BTC_PALETTES.length)];

// BTC 价格 - iOS StandBy "Float" 主题：拆分为独立数字字符，多色叠印（严格按 ios_standby_float.md）
function btcFloatHtml(str) {
  if (!str || str === '--') return str;
  // 每个数字独立的倾斜角(deg)与垂直错落(em)，按索引循环，营造"错落有致"的浮动感（参照 iOS StandBy Float 主题）
  const TILT = [-2.4, 1.6, -1.2, 2.2, -1.8, 1.4];
  const LIFT = [-0.04, 0.03, 0.045, -0.03, 0.035, -0.045];
  const C = btcPalette.colors;
  let html = '';
  let n = 0;
  for (const ch of str) {
    if (ch >= '0' && ch <= '9') {
      const i = n % TILT.length;
      // 数字：颜色/倾斜/错落绑定「槽位」(.dig)，字符放在独立 .dig-cell 层，便于按位差分滚动（v3 规范 6.2）
      // .dig 外层静态样式固定；.dig-f 内层呼吸浮动（相位错开）；.dig-cell 字符层可替换/滚动
      html += '<span class="dig" style="color:' + C[n % 4] + ';--t:' + TILT[i] + 'deg;--y:' + LIFT[i] + 'em">' +
        '<span class="dig-f" style="animation-delay:-' + (n * 0.9).toFixed(1) + 's">' +
        '<span class="dig-cell">' + ch + '</span></span></span>';
      n++;
    } else {
      // 千分位逗号 / 小数点：浅青蓝，弱化
      html += '<span class="bd-sep">' + ch + '</span>';
    }
  }
  return html;
}

// BTC 价格按位差分滚动（严格按 ios_standby_floatv3.md 第 6 点）
// - 仅变化的数位触发动画，未变化位绝对静止
// - 数值增→向上滚（旧值上移淡出、新值从底部进入）；数值减→向下滚
// - 多位同时变化：从右向左（低位→高位）依次触发，相邻变化位延迟 40ms
// - 颜色/倾斜/错落固定绑定在槽位 .dig 上，新旧字符都在同一槽位样式坐标系内
function updateBtcDigits(valEl, newStr) {
  const digFs = valEl.querySelectorAll('.dig .dig-f');
  let oldStr = '';
  for (let i = 0; i < digFs.length; i++) {
    const c = digFs[i].querySelector('.dig-cell:not(.dig-enter)');
    oldStr += c ? c.textContent : '';
  }
  // 首次渲染 / 占位符 / 位数变化：直接重建（无差分可比），无动画
  if (!oldStr || oldStr === '--' || newStr === '--' || oldStr.length !== newStr.length) {
    valEl.innerHTML = btcFloatHtml(newStr);
    return;
  }
  if (oldStr === newStr) return; // 完全没变，不动 DOM（绝对静止）

  const up = Number(newStr) > Number(oldStr); // 方向语义
  const changed = [];
  for (let i = 0; i < newStr.length; i++) if (oldStr[i] !== newStr[i]) changed.push(i);
  changed.sort(function (a, b) { return b - a; }); // 低位→高位（右→左）

  changed.forEach(function (idx, k) {
    const digF = digFs[idx];
    if (!digF) return;
    const exitCell = digF.querySelector('.dig-cell:not(.dig-enter)');
    if (!exitCell) return;
    const delay = k * 0.04; // 40ms 交错

    // 进入字符：绝对定位覆盖在旧字符上，滚动进入
    const enterCell = document.createElement('span');
    enterCell.className = 'dig-cell dig-enter ' + (up ? 'roll-in-up' : 'roll-in-down');
    enterCell.textContent = newStr[idx];
    enterCell.style.animationDelay = delay + 's';
    // 离开字符：相对定位保持占位（宽度不塌），滚动退出
    exitCell.classList.add('dig-exit', up ? 'roll-out-up' : 'roll-out-down');
    exitCell.style.animationDelay = delay + 's';
    digF.appendChild(enterCell);

    let done = false;
    const cleanup = function (e) {
      if (e && e.target !== enterCell) return; // 忽略冒泡的其它动画
      if (done) return;
      done = true;
      if (exitCell.parentNode) exitCell.parentNode.removeChild(exitCell);
      enterCell.classList.remove('dig-enter', 'roll-in-up', 'roll-in-down');
      enterCell.style.animationDelay = '';
      enterCell.removeEventListener('animationend', cleanup);
    };
    enterCell.addEventListener('animationend', cleanup);
    setTimeout(cleanup, 700 + delay * 1000); // 兜底：动画被中断（如切后台）时仍清理
  });
}

// 分钟数 -> "HH:MM"（用于进度条关键时间刻度标签）
function fmtClock(minute) {
  return pad(Math.floor(minute / 60)) + ':' + pad(minute % 60);
}

// ---------- 交易日判定（A股/港股/日经，按北京日期） ----------
function isTradingDay(id, key) {
  const d = keyToDate(key);
  if (d.weekday === 0 || d.weekday === 6) return false;
  if (id === 'aShare') return !inRanges(key, HOLIDAYS.aShare);
  if (id === 'hk') return !HOLIDAYS.hk.includes(key);
  if (id === 'jp') return !HOLIDAYS.jp.includes(key);
  if (id === 'kr') return !HOLIDAYS.kr.includes(key);
  return true;
}

function getHolidayName(id, key) {
  if (id === 'aShare') {
    const map = [
      [['2026-01-01', '2026-01-03'], '元旦'],
      [['2026-02-15', '2026-02-23'], '春节'],
      [['2026-04-04', '2026-04-06'], '清明节'],
      [['2026-05-01', '2026-05-05'], '劳动节'],
      [['2026-06-19', '2026-06-21'], '端午节'],
      [['2026-09-25', '2026-09-27'], '中秋节'],
      [['2026-10-01', '2026-10-07'], '国庆节']
    ];
    for (const [r, name] of map) if (key >= r[0] && key <= r[1]) return name;
    return '节假日';
  }
  if (id === 'us') return '美股休市日';
  if (id === 'hk') return '港股休市日';
  if (id === 'jp') return '东京休市日';
  if (id === 'kr') return '首尔休市日';
  return '休市';
}

// ---------- 时段配置（北京时间分钟数） ----------
const CFG = {
  aShare: {
    id: 'aShare', openMinute: 570, closeMinute: 900,
    sessions: [
      { start: 570, end: 690, type: 'open', label: '早盘 09:30–11:30' },
      { start: 690, end: 780, type: 'lunch', label: '午间休市 11:30–13:00' },
      { start: 780, end: 900, type: 'open', label: '午盘 13:00–15:00' }
    ]
  },
  hk: {
    id: 'hk', openMinute: 570, closeMinute: 960,
    sessions: [
      { start: 570, end: 720, type: 'open', label: '早盘 09:30–12:00' },
      { start: 720, end: 780, type: 'lunch', label: '午间休市 12:00–13:00' },
      { start: 780, end: 960, type: 'open', label: '午盘 13:00–16:00' }
    ]
  },
  jp: {
    id: 'jp', openMinute: 480, closeMinute: 870,
    sessions: [
      { start: 480, end: 630, type: 'open', label: '早盘 08:00–10:30' },
      { start: 630, end: 690, type: 'lunch', label: '午间休市 10:30–11:30' },
      { start: 690, end: 870, type: 'open', label: '午盘 11:30–14:30' }
    ]
  },
  kr: {
    id: 'kr', openMinute: 480, closeMinute: 870,
    sessions: [
      { start: 480, end: 870, type: 'open', label: '交易 08:00–14:30' }
    ]
  }
};

function segCls(type) {
  return { open: 'tl-open', lunch: 'tl-lunch', pre: 'tl-pre', post: 'tl-post' }[type] || 'tl-closed';
}

function buildSegs(cfg) {
  // 交易日：开盘前/收盘后为「隔夜」（绿），非交易为 tl-overnight
  const segs = [];
  if (cfg.openMinute > 0) segs.push({ start: 0, end: cfg.openMinute, cls: 'tl-overnight' });
  for (const s of cfg.sessions) segs.push({ start: s.start, end: s.end, cls: segCls(s.type) });
  if (cfg.closeMinute < 1440) segs.push({ start: cfg.closeMinute, end: 1440, cls: 'tl-overnight' });
  return segs;
}

function nextOpen(cfg, fromKey) {
  let k = fromKey;
  for (let i = 0; i < 60; i++) {
    k = addDays(k, 1);
    if (isTradingDay(cfg.id, k)) return bjMinuteToMs(k, cfg.openMinute);
  }
  return bjMinuteToMs(addDays(fromKey, 1), cfg.openMinute);
}

// ---------- A股 / 港股 / 日经 状态 ----------
function computeRegularMarket(cfg, now) {
  const isTrading = isTradingDay(cfg.id, now.key);
  const segs = buildSegs(cfg);

  if (!isTrading) {
    // 周末：全天非交易（浅灰轨道）；节假日：淡红提醒，区分于周末
    const weekendSegs = [{ start: 0, end: 1440, cls: 'tl-closed' }];
    const holidaySegs = [{ start: 0, end: 1440, cls: 'tl-holiday' }];
    if (now.weekday === 0 || now.weekday === 6) {
      return { status: 'weekend', detail: '周末休市', countdownLabel: '距开盘', targetMs: nextOpen(cfg, now.key), timelineSegs: weekendSegs, holidayName: null };
    }
    const name = getHolidayName(cfg.id, now.key);
    return { status: 'holiday', detail: name + ' · 休市', countdownLabel: '距开盘', targetMs: nextOpen(cfg, now.key), timelineSegs: holidaySegs, holidayName: name };
  }

  // 港股半日市
  if (cfg.id === 'hk' && HOLIDAYS.hkHalf.includes(now.key)) {
    if (now.minute >= 570 && now.minute < 720) {
      return { status: 'open', detail: '早盘 09:30–12:00（半日市）', countdownLabel: '距收盘', targetMs: bjMinuteToMs(now.key, 720), timelineSegs: segs, holidayName: null };
    }
    if (now.minute < 570) {
      return { status: 'overnight', detail: '开盘前（半日市）', countdownLabel: '距开盘', targetMs: bjMinuteToMs(now.key, 570), timelineSegs: segs, holidayName: null };
    }
    return { status: 'overnight', detail: '半日市 · 已收盘', countdownLabel: '距开盘', targetMs: nextOpen(cfg, now.key), timelineSegs: segs, holidayName: null };
  }

  for (const seg of cfg.sessions) {
    if (now.minute >= seg.start && now.minute < seg.end) {
      if (seg.type === 'open') {
        const label = seg.end === cfg.closeMinute ? '距收盘' : '距午休';
        return { status: 'open', detail: seg.label, countdownLabel: label, targetMs: bjMinuteToMs(now.key, seg.end), timelineSegs: segs, holidayName: null };
      } else {
        const nextOpenSeg = cfg.sessions.find(s => s.type === 'open' && s.start >= seg.end);
        const tgt = nextOpenSeg ? nextOpenSeg.start : seg.end;
        return { status: 'lunch', detail: seg.label, countdownLabel: '距开盘', targetMs: bjMinuteToMs(now.key, tgt), timelineSegs: segs, holidayName: null };
      }
    }
  }

  if (now.minute < cfg.openMinute) {
    return { status: 'overnight', detail: '开盘前', countdownLabel: '距开盘', targetMs: bjMinuteToMs(now.key, cfg.openMinute), timelineSegs: segs, holidayName: null };
  }
  return { status: 'overnight', detail: '已收盘', countdownLabel: '距开盘', targetMs: nextOpen(cfg, now.key), timelineSegs: segs, holidayName: null };
}

// ---------- 美股（需处理夏令时与美东日期） ----------
function nthSundayUtc(y, m0, n) {
  const first = new Date(Date.UTC(y, m0, 1));
  const dow = first.getUTCDay();
  const day = 1 + ((7 - dow) % 7) + (n - 1) * 7;
  return Date.UTC(y, m0, day);
}
function usIsDST(nowMs) {
  const y = new Date(nowMs).getUTCFullYear();
  const start = nthSundayUtc(y, 2, 2) + 7 * 3600e3; // 3月第2周日 02:00 EST = 07:00 UTC
  const end = nthSundayUtc(y, 10, 1) + 6 * 3600e3;  // 11月第1周日 02:00 EDT = 06:00 UTC
  return nowMs >= start && nowMs < end;
}
function usOffsetForEtDate(key) {
  return (key >= '2026-03-08' && key < '2026-11-01') ? 4 : 5;
}
function usOpenMs(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 9, 30) + usOffsetForEtDate(key) * 3600e3;
}
function usPreMs(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 4, 0) + usOffsetForEtDate(key) * 3600e3;
}
function usCloseMs(key, early) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d, early ? 13 : 16, 0) + usOffsetForEtDate(key) * 3600e3;
}
function usIsTradingDay(key) {
  const d = keyToDate(key);
  if (d.weekday === 0 || d.weekday === 6) return false;
  return !HOLIDAYS.us.includes(key);
}
function usNextOpenMs(fromKey) {
  let k = fromKey;
  for (let i = 0; i < 60; i++) {
    k = addDays(k, 1);
    if (usIsTradingDay(k)) return usOpenMs(k);
  }
  return usOpenMs(addDays(fromKey, 1));
}

function buildUsTimeline(offset) {
  if (offset === 4) { // 夏令时
    return [
      { start: 0, end: 240, cls: 'tl-open' },
      { start: 240, end: 480, cls: 'tl-post' },
      { start: 480, end: 960, cls: 'tl-overnight' },
      { start: 960, end: 1290, cls: 'tl-pre' },
      { start: 1290, end: 1440, cls: 'tl-open' }
    ];
  }
  return [ // 冬令时
    { start: 0, end: 300, cls: 'tl-open' },
    { start: 300, end: 540, cls: 'tl-post' },
    { start: 540, end: 1020, cls: 'tl-overnight' },
    { start: 1020, end: 1350, cls: 'tl-pre' },
    { start: 1350, end: 1440, cls: 'tl-open' }
  ];
}

function usStatus(now) {
  const offset = usIsDST(now.nowMs) ? 4 : 5;
  const etMs = now.nowMs - offset * 3600e3;
  const et = new Date(etMs);
  const etKey = et.getUTCFullYear() + '-' + pad(et.getUTCMonth() + 1) + '-' + pad(et.getUTCDate());
  const etMin = et.getUTCHours() * 60 + et.getUTCMinutes();
  const etDow = et.getUTCDay();
  const isEarly = HOLIDAYS.usEarly.includes(etKey);
  const segs = buildUsTimeline(offset);

  if (HOLIDAYS.us.includes(etKey)) {
    return { status: 'holiday', detail: '美股休市日', countdownLabel: '距开盘', targetMs: usNextOpenMs(etKey), timelineSegs: [{ start: 0, end: 1440, cls: 'tl-holiday' }], holidayName: '美股休市日' };
  }
  if (etDow === 0 || etDow === 6) {
    return { status: 'weekend', detail: '周末休市', countdownLabel: '距开盘', targetMs: usNextOpenMs(etKey), timelineSegs: [{ start: 0, end: 1440, cls: 'tl-closed' }], holidayName: null };
  }

  const OPEN_E = isEarly ? 780 : 960;
  const bj = offset === 4
    ? { pre: '16:00–21:30', open: '21:30–04:00', post: '04:00–08:00' }
    : { pre: '17:00–22:30', open: '22:30–05:00', post: '05:00–09:00' };

  if (etMin >= 240 && etMin < 570) {
    return { status: 'pre', detail: '盘前 ' + bj.pre + '（北京）', countdownLabel: '距开盘', targetMs: usOpenMs(etKey), timelineSegs: segs, holidayName: null };
  }
  if (etMin >= 570 && etMin < OPEN_E) {
    const detail = isEarly ? '常规交易 09:30–13:00（美东·提前收盘）' : '常规交易 ' + bj.open + '（北京）';
    return { status: 'open', detail: detail, countdownLabel: '距收盘', targetMs: usCloseMs(etKey, isEarly), timelineSegs: segs, holidayName: null };
  }
  if (etMin >= OPEN_E && etMin < 1200) {
    return { status: 'post', detail: '盘后 ' + bj.post + '（北京）', countdownLabel: '距开盘', targetMs: usNextOpenMs(etKey), timelineSegs: segs, holidayName: null };
  }
  if (etMin < 240) {
    return { status: 'overnight', detail: '隔夜', countdownLabel: '距盘前', targetMs: usPreMs(etKey), timelineSegs: segs, holidayName: null };
  }
  return { status: 'overnight', detail: '隔夜', countdownLabel: '距开盘', targetMs: usNextOpenMs(etKey), timelineSegs: segs, holidayName: null };
}

function cryptoStatus() {
  return {
    status: 'open', detail: '24/7 · 全年无休', countdownLabel: null, targetMs: null,
    timelineSegs: [{ start: 0, end: 1440, cls: 'tl-open' }], holidayName: null
  };
}

// ---------- 商品/货币（黄金、原油、外汇）：工作日 24h 连续交易，周末休市 ----------
function commodityNextOpen(now, openMinute) {
  let k = now.key;
  for (let i = 0; i < 7; i++) {
    k = addDays(k, 1);
    const wd = keyToDate(k).weekday;
    if (wd >= 1 && wd <= 5) return bjMinuteToMs(k, openMinute);
  }
  return bjMinuteToMs(addDays(now.key, 1), openMinute);
}
function commodityStatus(openMinute) {
  return function (now) {
    const isTrading = now.weekday >= 1 && now.weekday <= 5;
    if (isTrading) {
      return { status: 'open', detail: '24小时连续交易', countdownLabel: null, targetMs: null, timelineSegs: [{ start: 0, end: 1440, cls: 'tl-open' }], holidayName: null };
    }
    return { status: 'weekend', detail: '周末休市', countdownLabel: '距开盘', targetMs: commodityNextOpen(now, openMinute), timelineSegs: [{ start: 0, end: 1440, cls: 'tl-closed' }], holidayName: null };
  };
}

// 每个市场的"下一次开盘"时间戳（用于排序：距离开盘越近越靠前）。
// 已开盘的市场返回 now.nowMs（距离视为 0，排在最前）。
function nextOpenMs(m, now) {
  if (m.id === 'crypto') return now.nowMs;

  if (m.id === 'gold' || m.id === 'brent' || m.id === 'usdcnh') {
    if (now.weekday >= 1 && now.weekday <= 5) return now.nowMs;
    return commodityNextOpen(now, m.id === 'usdcnh' ? 300 : 360);
  }

  if (m.id === 'us' || m.id === 'vix') {
    const offset = usIsDST(now.nowMs) ? 4 : 5;
    const etMs = now.nowMs - offset * 3600e3;
    const et = new Date(etMs);
    const etKey = et.getUTCFullYear() + '-' + pad(et.getUTCMonth() + 1) + '-' + pad(et.getUTCDate());
    const etMin = et.getUTCHours() * 60 + et.getUTCMinutes();
    const isEarly = HOLIDAYS.usEarly.includes(etKey);
    const OPEN_E = isEarly ? 780 : 960; // 常规交易区间上界（美东 16:00 / 提前收盘 13:00）
    if (usIsTradingDay(etKey) && etMin >= 570 && etMin < OPEN_E) return now.nowMs; // 盘中
    if (usIsTradingDay(etKey) && etMin < 570) return usOpenMs(etKey);               // 盘前/隔夜→今日开盘
    return usNextOpenMs(etKey);                                                     // 盘后/周末/休市
  }

  const cfg = CFG[m.id];
  if (!isTradingDay(m.id, now.key)) return nextOpen(cfg, now.key);
  if (m.id === 'hk' && HOLIDAYS.hkHalf.includes(now.key) && now.minute >= 720) return nextOpen(cfg, now.key);
  for (const seg of cfg.sessions) {
    if (seg.type === 'open' && now.minute >= seg.start && now.minute < seg.end) return now.nowMs; // 盘中
  }
  if (now.minute < cfg.openMinute) return bjMinuteToMs(now.key, cfg.openMinute);   // 开盘前
  for (const seg of cfg.sessions) {
    if (seg.type === 'open' && seg.start >= now.minute) return bjMinuteToMs(now.key, seg.start); // 午休→午盘开盘
  }
  return nextOpen(cfg, now.key); // 已收盘
}

const statusFns = {
  aShare: (now) => computeRegularMarket(CFG.aShare, now),
  hk: (now) => computeRegularMarket(CFG.hk, now),
  jp: (now) => computeRegularMarket(CFG.jp, now),
  kr: (now) => computeRegularMarket(CFG.kr, now),
  us: (now) => usStatus(now),
  crypto: () => cryptoStatus(),
  gold: commodityStatus(360),
  brent: commodityStatus(360),
  usdcnh: commodityStatus(300),
  vix: (now) => {
    const st = usStatus(now);
    if (st.detail === '美股休市日') { st.detail = 'VIX 休市日'; st.holidayName = 'VIX 休市日'; }
    return st;
  }
};

// ---------- 行情 ----------
// quotes: 最新价/涨跌幅（key=东财短代码，如 000001/HSI）
// closes: 昨收价（key=短代码），用于最新价缺失时的回退
// crypto: 加密货币（key=BTC/ETH）
let quotes = {};
let closes = {};
let crypto = {};

// ---------- 行情本地缓存（接口失败时兜底显示最近一次成功数据） ----------
const CACHE_KEY = 'thd_quotes_cache_v1';
function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const c = JSON.parse(raw);
    if (c && c.quotes) quotes = c.quotes;
    if (c && c.closes) closes = c.closes;
    if (c && c.crypto) crypto = c.crypto;
  } catch (e) { /* 忽略缓存解析错误 */ }
}
function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ quotes: quotes, closes: closes, crypto: crypto, ts: Date.now() }));
  } catch (e) { /* 忽略写入错误 */ }
}

// 构建数据源代码 -> 内部短代码（key）的映射
function buildSourceMaps() {
  const tencentMap = {};
  const etfMap = {};   // 腾讯ETF代码 -> { code: 内部短代码, base: 指数昨收基准点位 }
  const emSecid = {};  // 日经/KOSPI 的 secid -> 内部短代码（用于东财 stock/get 精准请求）
  const emPrec = {};   // 东财短代码 -> 小数位（价格需 ÷10^prec；外汇 4 位，其余 2 位）
  for (const m of MARKETS) {
    for (const q of m.quotes) {
      const code = q.secid ? q.secid.split('.')[1] : q.label;
      if (q.tencent) tencentMap[q.tencent] = code;
      if (q.etf) etfMap[q.etf] = { code: code, base: q.base };
      if (q.secid) emPrec[code] = q.prec || 2;
      if (q.secid && (q.secid === '100.N225' || q.secid === '100.KS11')) emSecid[q.secid] = code;
    }
  }
  return { tencentMap, etfMap, emSecid, emPrec };
}

async function fetchQuotes() {
  const { tencentMap, etfMap, emSecid, emPrec } = buildSourceMaps();
  const etfPct = {}; // 内部短代码 -> 腾讯ETF当日涨跌幅(%)，用于日经/KOSPI 兜底估算

  // 1) A股/港股/美股 + 日经/KOSPI的ETF：腾讯 qt.gtimg.cn（支持 CORS、稳定）。返回 GBK，字段以 ~ 分隔：[3]=最新价 [4]=昨收
  const tcodes = Object.keys(tencentMap).concat(Object.keys(etfMap));
  if (tcodes.length) {
    try {
      const r = await fetch('https://qt.gtimg.cn/q=' + tcodes.join(','));
      const buf = await r.arrayBuffer();
      let text;
      try { text = new TextDecoder('gbk').decode(buf); }
      catch (e) { text = new TextDecoder('utf-8').decode(buf); }
      const re = /v_(\w+)="([^"]*)"/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const code = tencentMap[m[1]];
        const etf = etfMap[m[1]];
        const p = m[2].split('~');
        const price = parseFloat(p[3]);
        const prev = parseFloat(p[4]);
        if (code) {
          if (isFinite(price) && price > 0) quotes[code] = { price: price };
          if (isFinite(prev) && prev > 0) closes[code] = prev;
        } else if (etf) {
          // ETF：记录当日涨跌幅，用于日经/KOSPI 无精准数据时的兜底估算
          if (isFinite(price) && isFinite(prev) && prev > 0) {
            etfPct[etf.code] = (price - prev) / prev * 100;
          }
        }
      }
    } catch (e) {
      console.warn('指数行情获取失败（腾讯）', e);
    }
  }

  // 2) 日经/韩股：东方财富（仅补充上面未取到的 code；f2=最新价 f3=涨跌幅 f18=昨收 f12=短代码，均需 ÷100）
  try {
    const secids = [];
    for (const m of MARKETS) {
      for (const q of m.quotes) if (q.secid) secids.push(q.secid);
    }
    const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get?secids=' + secids.join(',') + '&fields=f2,f3,f18,f12,f14';
    const r = await fetch(url);
    const j = await r.json();
    if (j && j.data && j.data.diff) {
      for (const it of j.data.diff) {
        if (quotes[it.f12] && isFinite(quotes[it.f12].price) && quotes[it.f12].price > 0) continue; // 已有数据不覆盖
        const prec = emPrec[it.f12] || 2;
        quotes[it.f12] = { price: it.f2 / Math.pow(10, prec), pct: it.f3 / 100 };
        closes[it.f12] = it.f18 / Math.pow(10, prec);
      }
    }
  } catch (e) {
    console.warn('指数行情获取失败（东方财富兜底）', e);
  }

  // 3) 日经/KOSPI 精准源：东财 stock/get（f43=最新价 f60=昨收 f170=涨跌幅 f152=小数位）。多域名轮换提高成功率
  const emHosts = ['https://push2delay.eastmoney.com', 'https://push2his.eastmoney.com', 'https://push2.eastmoney.com'];
  for (const secid of Object.keys(emSecid)) {
    const code = emSecid[secid];
    if (quotes[code] && isFinite(quotes[code].price) && quotes[code].price > 0) continue; // 已有精准数据
    for (const host of emHosts) {
      try {
        const r = await fetch(host + '/api/qt/stock/get?secid=' + secid + '&fields=f43,f57,f58,f60,f169,f170,f152');
        const j = await r.json();
        const d = j && j.data;
        if (d && isFinite(d.f43) && d.f43 > 0) {
          const prec = Math.pow(10, d.f152 || 2);
          quotes[code] = { price: d.f43 / prec, pct: isFinite(d.f170) ? d.f170 / 100 : null };
          if (isFinite(d.f60) && d.f60 > 0) closes[code] = d.f60 / prec;
          break;
        }
      } catch (e) { /* 换下一个域名重试 */ }
    }
  }

  // 4) 日经/KOSPI 兜底估算：东财失败时，用腾讯ETF当日涨跌幅 × 昨收基准 估算指数点位
  for (const m of MARKETS) {
    for (const q of m.quotes) {
      if (!q.etf) continue;
      const code = q.secid ? q.secid.split('.')[1] : q.label;
      if (quotes[code] && isFinite(quotes[code].price) && quotes[code].price > 0) continue; // 已有精准数据
      if (etfPct[code] === undefined) continue;
      const prev = (isFinite(closes[code]) && closes[code] > 0) ? closes[code] : (q.base || 0);
      if (prev > 0) {
        quotes[code] = { price: prev * (1 + etfPct[code] / 100), pct: etfPct[code] };
      }
    }
  }

  // 5) 加密货币：Binance 官方数据镜像（api.binance.com 被墙，改用镜像域名）
  try {
    const r = await fetch('https://data-api.binance.vision/api/v3/ticker/24hr?symbols=%5B%22BTCUSDT%22%5D');
    const arr = await r.json();
    for (const it of arr) {
      crypto[it.symbol.replace('USDT', '')] = { price: +it.lastPrice, pct: +it.priceChangePercent };
    }
  } catch (e) {
    console.warn('加密行情获取失败（Binance）', e);
  }
}

// ---------- 渲染 ----------
function renderTimeline(segs, nowMinute, showNow) {
  let bar = '';
  for (const s of segs) {
    const w = (s.end - s.start) / 1440 * 100;
    bar += '<div class="' + s.cls + '" style="flex:0 0 ' + w + '%"></div>';
  }
  // 关键时间刻度：提取各交易时段分段的边界（去掉 0:00 与 24:00 两端点）
  const marks = new Set();
  for (const s of segs) {
    if (s.start > 0 && s.start < 1440) marks.add(s.start);
    if (s.end > 0 && s.end < 1440) marks.add(s.end);
  }
  let marksHtml = '';
  for (const mm of [...marks].sort((a, b) => a - b)) {
    const pct = (mm / 1440 * 100).toFixed(3);
    marksHtml += '<span class="mark" style="left:' + pct + '%">' +
      '<i class="tick"></i><span class="lbl">' + fmtClock(mm) + '</span></span>';
  }
  const pct = (nowMinute / 1440 * 100).toFixed(2);
  const nowEl = showNow === false ? '' : '<div class="timeline-now" style="left:' + pct + '%"></div>';
  return '<div class="timeline-bar">' + bar + '</div>' +
    nowEl +
    '<div class="timeline-marks">' + marksHtml + '</div>';
}

// 行情取值（返回 {price, pct}，首次渲染与增量更新共用）
function quoteValue(marketId, code) {
  let price = null, pct = null;
  if (marketId === 'crypto') {
    const d = crypto[code];
    if (d && isFinite(d.price) && d.price > 0) { price = d.price; pct = d.pct; }
  } else {
    const d = quotes[code];
    const prev = closes[code];
    const hasLive = d && isFinite(d.price) && d.price > 0;
    const hasPrev = isFinite(prev) && prev > 0;
    if (hasLive) {
      // 显示数据：盘中=最新价，已收盘=当日收盘价
      price = d.price;
      pct = isFinite(d.pct) ? d.pct : (hasPrev ? (d.price - prev) / prev * 100 : null);
    } else if (hasPrev) {
      // 回退：无最新价 → 用昨收（历史最近一天有价格的收盘价）
      price = prev;
      pct = null;
    }
  }
  return { price, pct };
}

function renderStats(m) {
  let html = '';
  for (const q of m.quotes) {
    const code = m.id === 'crypto' ? q.label : q.secid.split('.')[1];
    html += '<div class="stat" data-market="' + m.id + '" data-code="' + code + '">' +
      '<span class="stat-label">' + q.label + '</span>' +
      '<span class="stat-val">--</span>' +
      '<span class="stat-pct flat">--</span>' +
      '</div>';
  }
  return html;
}

function tlKey(segs) {
  return segs.map(s => s.start + '-' + s.end + '-' + s.cls).join('|');
}

// 各市场图标：国旗 emoji（加密货币用比特币符号，橙色）
const ICONS = {
  aShare: '🇨🇳',
  hk: '🇭🇰',
  jp: '🇯🇵',
  kr: '🇰🇷',
  us: '🇺🇸',
  crypto: '<span class="btc">₿</span>',
  gold: '🥇',
  brent: '🛢️',
  usdcnh: '💱',
  vix: '📉'
};

function renderCard(m, st, now) {
  const meta = STATUS_META[st.status];
  const badge = '<span class="badge st-' + st.status + '"><span class="dot dot-' + st.status + '"></span><span class="badge-text">' + meta.label + '</span></span>';
  const statsHtml = renderStats(m);
  let cd = '';
  if (st.countdownLabel && st.targetMs) {
    const text = st.countdownLabel + ' ' + fmtDuration(st.targetMs - now.nowMs);
    cd = '<span class="countdown" data-label="' + st.countdownLabel + '" data-target="' + st.targetMs + '">' + text + '</span>';
  } else {
    cd = '<span class="countdown" hidden></span>';
  }
  const timeline = renderTimeline(st.timelineSegs, now.minute, m.id !== 'crypto');

  return '<article class="card" data-id="' + m.id + '" data-tlkey="' + tlKey(st.timelineSegs) + '">' +
    '<header class="card-head">' +
      '<div class="card-title-wrap">' +
        (m.sub ? '<div class="card-kicker">' + m.sub + '</div>' : '') +
        '<h2 class="card-title">' + m.name + '</h2>' +
      '</div>' +
      '<div class="card-head-right">' +
        badge +
        '<span class="card-icon">' + (ICONS[m.id] || '') + '</span>' +
      '</div>' +
    '</header>' +
    '<div class="stats">' + statsHtml + '</div>' +
    '<div class="card-foot">' +
      '<div class="detail-line"><span class="detail">' + st.detail + '</span>' + cd + '</div>' +
    '</div>' +
    '<div class="timeline">' + timeline + '</div>' +
    '</article>';
}

// ---------- 全屏时钟模式渲染（hash 路由 + 单击/滑动切换） ----------
function renderDots(activeId) {
  let html = '';
  for (const id of MARKET_IDS) {
    html += '<span class="dot-item' + (id === activeId ? ' active' : '') + '" data-id="' + id + '"></span>';
  }
  return '<div class="clock-dots">' + html + '</div>';
}

// 导航圆点：切换市场时短暂显示 3 秒后自动隐藏（避免常驻占用底部空间）
let dotsTimer = null;
function revealDots() {
  const dots = document.querySelector('.clock-dots');
  if (!dots) return;
  dots.classList.add('show');
  clearTimeout(dotsTimer);
  dotsTimer = setTimeout(function () { dots.classList.remove('show'); }, 3000);
}

function renderClockCard(m, st, now) {
  // 加密货币：极简桌面时钟——价格是绝对主体。右上角 BTC 角标，左下角涨跌+状态，无导航栏、无时间轴。
  if (m.id === 'crypto') {
    return '<article class="card is-crypto-clock" data-id="crypto">' +
      '<span class="crypto-tag">BTC</span>' +
      '<div class="crypto-stage">' +
        '<div class="stat" data-market="crypto" data-code="BTC">' +
          '<span class="stat-val">--</span>' +
        '</div>' +
      '</div>' +
      '<div class="crypto-meta">' +
        '<span class="crypto-pct flat" data-market="crypto" data-code="BTC">--</span>' +
        '<span class="crypto-meta-sub">' +
          '<span class="crypto-status"><span class="dot dot-open"></span>交易中</span>' +
        '</span>' +
      '</div>' +
      renderDots('crypto') +
    '</article>';
  }

  const meta = STATUS_META[st.status];
  const badge = '<span class="badge st-' + st.status + '"><span class="dot dot-' + st.status + '"></span><span class="badge-text">' + meta.label + '</span></span>';

  let statsHtml = '';
  for (const q of m.quotes) {
    const code = m.id === 'crypto' ? q.label : q.secid.split('.')[1];
    statsHtml += '<div class="stat" data-market="' + m.id + '" data-code="' + code + '">' +
      '<span class="stat-label">' + q.label + '</span>' +
      '<span class="stat-val">--</span>' +
      '<span class="stat-pct flat">--</span>' +
      '</div>';
  }

  let cd = '';
  if (st.countdownLabel && st.targetMs) {
    cd = '<div class="clock-cd-label">' + st.countdownLabel + '</div>' +
      '<div class="countdown clock-cd-time" data-label="' + st.countdownLabel + '" data-target="' + st.targetMs + '" data-mode="clock">' + fmtClockCountdown(st.targetMs - now.nowMs) + '</div>';
  } else {
    cd = '<div class="clock-cd-label">' + (st.detail || '24/7 全年无休') + '</div>' +
      (m.id === 'crypto' ? '<div class="clock-cd-time">∞</div>' : '');
  }

  const timeline = renderTimeline(st.timelineSegs, now.minute, m.id !== 'crypto');
  const dots = renderDots(m.id);

  return '<article class="card' + (st.status === 'open' ? ' is-open' : '') + '" data-id="' + m.id + '" data-tlkey="' + tlKey(st.timelineSegs) + '">' +
    '<header class="clock-head">' +
      '<div class="clock-market">' +
        '<span class="card-icon">' + (ICONS[m.id] || '') + '</span>' +
        '<div class="clock-market-txt">' +
          (m.sub ? '<div class="card-kicker">' + m.sub + '</div>' : '') +
          '<h2 class="card-title">' + m.name + '</h2>' +
        '</div>' +
      '</div>' +
      '<div class="clock-head-mid">' +
        badge +
      '</div>' +
      '<div class="clock-bj">' +
        '<div class="clock-bj-time" id="clock-bj">' + pad(now.h) + ':' + pad(now.min) + ':' + pad(now.s) + '</div>' +
        '<div class="clock-bj-label" id="clock-bj-date">' + now.m + '月' + now.d + '日 ' + WEEK_CN[now.weekday] + ' · 北京时间</div>' +
      '</div>' +
    '</header>' +
    '<div class="clock-countdown">' + cd + '</div>' +
    '<div class="clock-stats">' + statsHtml + '</div>' +
    '<div class="timeline">' + timeline + '</div>' +
    dots +
    '</article>';
}

function renderFullscreen(withFade) {
  const now = beijingNow();
  const m = MARKETS.find(function (x) { return x.id === currentMarket; });
  if (!m) return;
  const grid = document.getElementById('grid');
  const html = renderClockCard(m, statusFns[m.id](now), now);

  if (withFade && !grid.classList.contains('fade-out')) {
    grid.classList.add('fade-out');
    setTimeout(function () {
      grid.innerHTML = html;
      updateQuotes();
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { grid.classList.remove('fade-out'); });
      });
      revealDots(); // 切换市场时短暂显示导航圆点
    }, 180);
  } else {
    grid.innerHTML = html;
    updateQuotes();
  }
}

function renderDayTip(now) {
  const st = statusFns.aShare(now);
  const el = document.getElementById('day-tip');
  const dot = el.querySelector('.dot');
  const txt = document.getElementById('day-tip-text');
  if (st.status === 'holiday') {
    dot.className = 'dot dot-holiday';
    txt.textContent = '今日 A股休市（' + st.holidayName + '）';
  } else if (st.status === 'weekend') {
    dot.className = 'dot dot-weekend';
    txt.textContent = '今日 A股休市（周末）';
  } else {
    dot.className = 'dot dot-open';
    txt.textContent = '今日 A股交易日';
  }
}

function renderLegend() {
  const items = [
    ['交易中', 'dot-open'], ['午间休市', 'dot-lunch'], ['盘前', 'dot-pre'], ['盘后', 'dot-post'],
    ['隔夜休市', 'dot-overnight'], ['周末休市', 'dot-weekend'], ['休市', 'dot-holiday']
  ];
  let html = '';
  for (const [t, c] of items) html += '<span><span class="sw ' + c + '"></span>' + t + '</span>';
  html += '<span class="legend-up"><span class="sw"></span>涨</span>';
  html += '<span class="legend-down"><span class="sw"></span>跌</span>';
  document.getElementById('legend').innerHTML = html;
}

function renderSrc() {
  document.getElementById('src').innerHTML =
    '行情数据来源：东方财富（指数）、Binance 官方镜像（加密货币），可能存在延迟，仅供参考。<br>' +
    '节假日数据来源：上交所 / 港交所 / JPX / KRX / NYSE 官方日历，核实于 2026-11-09，覆盖 ' + DATA_YEAR + ' 年。' +
    '本页面不构成任何投资建议。';
}

// 更新顶部 header（日期/警告/日提示，均为文本或 hidden，不重建 DOM）
function updateHeader(now) {
  const weekNames = ['日', '一', '二', '三', '四', '五', '六'];
  document.getElementById('date-line').textContent =
    now.y + '年' + now.m + '月' + now.d + '日 星期' + weekNames[now.weekday];
  const warn = document.getElementById('data-warning');
  warn.hidden = !(now.key < DATA_YEAR + '-01-01' || now.key > DATA_YEAR + '-12-31');
  renderDayTip(now);
}

// 增量更新单张卡片的状态（不重建 DOM）
function patchCard(el, m, st, now) {
  if (m.id === 'crypto') return; // 加密货币极简时钟：状态恒定交易中，无徽章/倒计时/时间轴，跳过增量更新
  const meta = STATUS_META[st.status];
  el.classList.toggle('is-open', st.status === 'open');
  const badge = el.querySelector('.badge');
  badge.className = 'badge st-' + st.status;
  badge.querySelector('.dot').className = 'dot dot-' + st.status;
  badge.querySelector('.badge-text').textContent = meta.label;

  const detailEl = el.querySelector('.detail');
  if (detailEl) detailEl.textContent = st.detail;

  const cd = el.querySelector('.countdown');
  if (st.countdownLabel && st.targetMs) {
    cd.dataset.label = st.countdownLabel;
    cd.dataset.target = st.targetMs;
    cd.textContent = cd.dataset.mode === 'clock'
      ? fmtClockCountdown(st.targetMs - now.nowMs)
      : st.countdownLabel + ' ' + fmtDuration(st.targetMs - now.nowMs);
    cd.hidden = false;
    const cdLabel = el.querySelector('.clock-cd-label');
    if (cdLabel) cdLabel.textContent = st.countdownLabel;
  } else {
    cd.hidden = true;
    cd.removeAttribute('data-target');
    cd.removeAttribute('data-label');
  }

  // 时间轴：仅当交易时段结构变化时才重绘色块+刻度，否则只移动当前时间虚线
  const tl = el.querySelector('.timeline');
  const key = tlKey(st.timelineSegs);
  if (el.dataset.tlkey !== key) {
    el.dataset.tlkey = key;
    tl.innerHTML = renderTimeline(st.timelineSegs, now.minute, m.id !== 'crypto');
  } else {
    const nowEl = tl.querySelector('.timeline-now');
    if (nowEl) nowEl.style.left = (now.minute / 1440 * 100).toFixed(2) + '%';
  }
}

// 增量更新所有行情数字（不重建 DOM）
function updateQuotes() {
  const cls = (v) => v == null ? 'flat' : (v > 0 ? 'up' : (v < 0 ? 'down' : 'flat'));
  document.querySelectorAll('.stat[data-market]').forEach((el) => {
    const v = quoteValue(el.dataset.market, el.dataset.code);
    const valEl = el.querySelector('.stat-val');
    if (el.dataset.market === 'crypto') {
      // 加密货币：按位差分滚动（仅变化数位跳动，遵循 v3 规范第 6 点）
      updateBtcDigits(valEl, fmtBtcPrice(v.price));
    } else {
      valEl.textContent = fmtPrice(v.price);
    }
    const pctEl = el.querySelector('.stat-pct');
    if (pctEl) {
      pctEl.textContent = fmtPct(v.pct);
      pctEl.className = 'stat-pct ' + cls(v.pct);
    }
  });
  // 加密货币：涨跌幅独立展示在左下角（.crypto-pct）
  document.querySelectorAll('.crypto-pct[data-market="crypto"]').forEach((el) => {
    const v = quoteValue(el.dataset.market, el.dataset.code);
    el.textContent = fmtPct(v.pct);
    el.className = 'crypto-pct ' + cls(v.pct);
  });
}

let lastOrder = [];

// 首次构建全部卡片
function buildCards(ordered, now) {
  let html = '';
  for (const m of ordered) html += renderCard(m, statusFns[m.id](now), now);
  document.getElementById('grid').innerHTML = html;
  lastOrder = ordered.map(m => m.id);
  updateQuotes();
}

// 每分钟刷新：仅当排序变化时才重建，否则增量更新
function orderedMarkets(now) {
  if (IS_FULLSCREEN) return MARKETS.filter(m => m.id === currentMarket);
  return [...MARKETS].sort((a, b) => {
    if (a.id === 'crypto') return -1;
    if (b.id === 'crypto') return 1;
    return nextOpenMs(a, now) - nextOpenMs(b, now);
  });
}

function refresh() {
  const now = beijingNow();
  if (IS_FULLSCREEN) {
    const m = MARKETS.find(function (x) { return x.id === currentMarket; });
    const el = document.getElementById('grid').querySelector('.card[data-id="' + currentMarket + '"]');
    if (el) patchCard(el, m, statusFns[m.id](now), now);
    return;
  }
  updateHeader(now);

  const ordered = orderedMarkets(now);
  const newOrder = ordered.map(m => m.id);

  if (newOrder.join(',') !== lastOrder.join(',')) {
    buildCards(ordered, now); // 排序变化（开盘/收盘瞬间），重建一次
    return;
  }

  const grid = document.getElementById('grid');
  for (const m of ordered) {
    const el = grid.querySelector('.card[data-id="' + m.id + '"]');
    if (el) patchCard(el, m, statusFns[m.id](now), now);
  }
}

function updateClock() {
  const now = beijingNow();
  const main = document.getElementById('clock');
  if (main) main.textContent = pad(now.h) + ':' + pad(now.min) + ':' + pad(now.s);
  const fs = document.getElementById('clock-bj');
  if (fs) fs.textContent = pad(now.h) + ':' + pad(now.min) + ':' + pad(now.s);
  const fd = document.getElementById('clock-bj-date');
  if (fd) fd.textContent = now.m + '月' + now.d + '日 ' + WEEK_CN[now.weekday] + ' · 北京时间';
}

function updateCountdowns() {
  const nowMs = Date.now();
  document.querySelectorAll('.countdown[data-target]').forEach((el) => {
    const t = +el.dataset.target;
    el.textContent = el.dataset.mode === 'clock'
      ? fmtClockCountdown(t - nowMs)
      : el.dataset.label + ' ' + fmtDuration(t - nowMs);
  });
}

// ---------- 全屏切换：手势 + hash 路由 ----------
function nextMarket() {
  const idx = MARKET_IDS.indexOf(currentMarket);
  switchMarket(MARKET_IDS[(idx + 1) % MARKET_IDS.length]);
}
function prevMarket() {
  const idx = MARKET_IDS.indexOf(currentMarket);
  switchMarket(MARKET_IDS[(idx - 1 + MARKET_IDS.length) % MARKET_IDS.length]);
}
function switchMarket(id) {
  if (id === currentMarket) return;
  window.location.hash = id; // 触发 hashchange → renderFullscreen(true)
}
window.addEventListener('hashchange', function () {
  if (!IS_FULLSCREEN) return;
  const id = window.location.hash.replace('#', '');
  if (MARKET_IDS.indexOf(id) >= 0 && id !== currentMarket) {
    currentMarket = id;
    renderFullscreen(true);
  }
});

function attachFullscreenGestures() {
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

  function handleDot(e) {
    const dot = e.target.closest && e.target.closest('.dot-item');
    if (dot) { switchMarket(dot.dataset.id); return true; }
    return false;
  }

  if (isTouch) {
    let sx = 0, sy = 0, moved = false;
    document.body.addEventListener('touchstart', function (e) {
      const t = e.touches[0]; sx = t.clientX; sy = t.clientY; moved = false;
    }, { passive: true });
    document.body.addEventListener('touchmove', function (e) {
      const t = e.touches[0];
      if (Math.abs(t.clientX - sx) > 8 || Math.abs(t.clientY - sy) > 8) moved = true;
    }, { passive: true });
    document.body.addEventListener('touchend', function (e) {
      if (handleDot(e)) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (!moved) { nextMarket(); }
      else if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) nextMarket(); else prevMarket(); }
    }, { passive: true });
  } else {
    document.body.addEventListener('click', function (e) {
      if (handleDot(e)) return;
      if (e.target.closest && e.target.closest('.clock-dots')) return;
      nextMarket();
    });
  }
}

function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  navigator.wakeLock.request('screen').then(function () {
    console.log('屏幕常亮已启用');
  }).catch(function () {
    console.log('屏幕常亮请求被拒绝（需用户手势或系统设置）');
  });
}

// ---------- 启动 ----------
loadCache(); // 先读缓存，渲染时立即显示最近一次成功数据（接口未恢复也不空白）
if (IS_FULLSCREEN) {
  renderFullscreen(false);
  attachFullscreenGestures();
  document.addEventListener('click', requestWakeLock, { once: true });
  document.addEventListener('touchstart', requestWakeLock, { once: true });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) requestWakeLock();
  });
} else {
  renderLegend();
  renderSrc();
  refresh();
}
updateClock();
setInterval(updateClock, 1000);
setInterval(updateCountdowns, 1000);
setInterval(refresh, 60000);
fetchQuotes().then(function () { saveCache(); updateQuotes(); });
// 行情轮询：5 分钟一次。东财对高频请求有 IP 级风控（空响应），1 分钟会触发封禁，故拉长间隔。
setInterval(function () { fetchQuotes().then(function () { saveCache(); updateQuotes(); }); }, 300000);
