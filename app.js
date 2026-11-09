// ============================================================
// 交易时段看板 - 核心逻辑
// 北京时间基准（Asia/Shanghai），与浏览器/设备时区无关
// ============================================================

// ---------- 工具函数 ----------
function pad(n) { return n < 10 ? '0' + n : '' + n; }

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

function fmtPrice(v) {
  // 收盘时展示最近一次成交价，盘前/盘中/盘后/隔夜展示最新价（均为接口返回的"最新价"）。
  // 无有效价格（null/NaN/0）时显示占位符，避免误导。
  if (v == null || !isFinite(v) || v <= 0) return '--';
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(v) {
  if (v == null) return '--';
  const s = v > 0 ? '+' : '';
  return s + v.toFixed(2) + '%';
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
  const segs = [];
  if (cfg.openMinute > 0) segs.push({ start: 0, end: cfg.openMinute, cls: 'tl-closed' });
  for (const s of cfg.sessions) segs.push({ start: s.start, end: s.end, cls: segCls(s.type) });
  if (cfg.closeMinute < 1440) segs.push({ start: cfg.closeMinute, end: 1440, cls: 'tl-closed' });
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
    if (now.weekday === 0 || now.weekday === 6) {
      return { status: 'weekend', detail: '周末休市', countdownLabel: '距开盘', targetMs: nextOpen(cfg, now.key), timelineSegs: segs, holidayName: null };
    }
    const name = getHolidayName(cfg.id, now.key);
    return { status: 'holiday', detail: name + ' · 休市', countdownLabel: '距开盘', targetMs: nextOpen(cfg, now.key), timelineSegs: segs, holidayName: name };
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
      { start: 480, end: 960, cls: 'tl-closed' },
      { start: 960, end: 1290, cls: 'tl-pre' },
      { start: 1290, end: 1440, cls: 'tl-open' }
    ];
  }
  return [ // 冬令时
    { start: 0, end: 300, cls: 'tl-open' },
    { start: 300, end: 540, cls: 'tl-post' },
    { start: 540, end: 1020, cls: 'tl-closed' },
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
    return { status: 'holiday', detail: '美股休市日', countdownLabel: '距开盘', targetMs: usNextOpenMs(etKey), timelineSegs: segs, holidayName: '美股休市日' };
  }
  if (etDow === 0 || etDow === 6) {
    return { status: 'weekend', detail: '周末休市', countdownLabel: '距开盘', targetMs: usNextOpenMs(etKey), timelineSegs: segs, holidayName: null };
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

// 每个市场的"下一次开盘"时间戳（用于排序：距离开盘越近越靠前）。
// 已开盘的市场返回 now.nowMs（距离视为 0，排在最前）。
function nextOpenMs(m, now) {
  if (m.id === 'crypto') return now.nowMs;

  if (m.id === 'us') {
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
  crypto: () => cryptoStatus()
};

// ---------- 行情 ----------
// quotes: 最新价/涨跌幅（key=东财短代码，如 000001/HSI）
// closes: 昨收价（key=短代码），用于最新价缺失时的回退
// crypto: 加密货币（key=BTC/ETH）
let quotes = {};
let closes = {};
let crypto = {};

async function fetchQuotes() {
  // 1) 指数行情：东财批量接口。f2=最新价 f3=涨跌幅 f18=昨收 f12=短代码（均需 ÷100）
  const secids = [];
  for (const m of MARKETS) {
    for (const q of m.quotes) if (q.secid) secids.push(q.secid);
  }
  try {
    const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get?secids=' + secids.join(',') + '&fields=f2,f3,f18,f12,f14';
    const r = await fetch(url);
    const j = await r.json();
    if (j && j.data && j.data.diff) {
      for (const it of j.data.diff) {
        quotes[it.f12] = { price: it.f2 / 100, pct: it.f3 / 100 };
        closes[it.f12] = it.f18 / 100;
      }
    }
  } catch (e) {
    console.warn('指数行情获取失败（东方财富）', e);
  }
  // 2) 加密货币：Binance 官方数据镜像（api.binance.com 被墙，改用镜像域名）
  try {
    const r = await fetch('https://data-api.binance.vision/api/v3/ticker/24hr?symbols=%5B%22BTCUSDT%22,%22ETHUSDT%22%5D');
    const arr = await r.json();
    for (const it of arr) {
      crypto[it.symbol.replace('USDT', '')] = { price: +it.lastPrice, pct: +it.priceChangePercent };
    }
  } catch (e) {
    console.warn('加密行情获取失败（Binance）', e);
  }
}

// ---------- 渲染 ----------
function renderTimeline(segs, nowMinute) {
  let bar = '';
  for (const s of segs) {
    const w = (s.end - s.start) / 1440 * 100;
    bar += '<div class="' + s.cls + '" style="flex:0 0 ' + w + '%"></div>';
  }
  const pct = (nowMinute / 1440 * 100).toFixed(2);
  return '<div class="timeline"><div class="timeline-bar">' + bar + '</div>' +
    '<div class="timeline-now" style="left:' + pct + '%"></div></div>';
}

function renderStats(m) {
  let html = '';
  for (const q of m.quotes) {
    let price = null, pct = null;
    if (m.id === 'crypto') {
      const d = crypto[q.label];
      if (d && isFinite(d.price) && d.price > 0) { price = d.price; pct = d.pct; }
    } else {
      // 东财返回短代码（f12），secid 形如 "1.000001"/"100.HSI" → 短代码取点号后部分
      const code = q.secid.split('.')[1];
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
    const cls = pct == null ? 'flat' : (pct > 0 ? 'up' : (pct < 0 ? 'down' : 'flat'));
    html += '<div class="stat">' +
      '<span class="stat-label">' + q.label + '</span>' +
      '<span class="stat-val">' + fmtPrice(price) + '</span>' +
      '<span class="stat-pct ' + cls + '">' + fmtPct(pct) + '</span>' +
      '</div>';
  }
  return html;
}

function renderCard(m, st, now) {
  const meta = STATUS_META[st.status];
  const badge = '<span class="badge st-' + st.status + '"><span class="dot dot-' + st.status + '"></span>' + meta.label + '</span>';
  const statsHtml = renderStats(m);
  let cd = '';
  if (st.countdownLabel && st.targetMs) {
    const text = st.countdownLabel + ' ' + fmtDuration(st.targetMs - now.nowMs);
    cd = '<span class="countdown" data-label="' + st.countdownLabel + '" data-target="' + st.targetMs + '">' + text + '</span>';
  }
  const timeline = renderTimeline(st.timelineSegs, now.minute);

  return '<article class="card">' +
    '<header class="card-head">' +
      '<div class="card-title-wrap">' +
        '<div class="card-kicker">' + m.sub + '</div>' +
        '<h2 class="card-title">' + m.name + '</h2>' +
      '</div>' +
      badge +
    '</header>' +
    '<div class="stats">' + statsHtml + '</div>' +
    '<div class="card-foot">' +
      '<div class="detail-line"><span class="detail">' + st.detail + '</span>' + cd + '</div>' +
      timeline +
    '</div>' +
    '</article>';
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

function renderAll() {
  const now = beijingNow();
  const weekNames = ['日', '一', '二', '三', '四', '五', '六'];
  document.getElementById('date-line').textContent =
    now.y + '年' + now.m + '月' + now.d + '日 星期' + weekNames[now.weekday];

  const warn = document.getElementById('data-warning');
  warn.hidden = !(now.key < DATA_YEAR + '-01-01' || now.key > DATA_YEAR + '-12-31');

  renderDayTip(now);

  // 排序：加密货币永远置顶；其余按"距离开盘"升序（越近越靠前）
  const ordered = [...MARKETS].sort((a, b) => {
    if (a.id === 'crypto') return -1;
    if (b.id === 'crypto') return 1;
    return nextOpenMs(a, now) - nextOpenMs(b, now);
  });

  let html = '';
  for (const m of ordered) {
    html += renderCard(m, statusFns[m.id](now), now);
  }
  document.getElementById('grid').innerHTML = html;

  renderLegend();
  renderSrc();
}

function updateClock() {
  const now = beijingNow();
  document.getElementById('clock').textContent = pad(now.h) + ':' + pad(now.min) + ':' + pad(now.s);
}

function updateCountdowns() {
  const nowMs = Date.now();
  document.querySelectorAll('.countdown[data-target]').forEach((el) => {
    const t = +el.dataset.target;
    el.textContent = el.dataset.label + ' ' + fmtDuration(t - nowMs);
  });
}

// ---------- 启动 ----------
updateClock();
renderAll();
setInterval(updateClock, 1000);
setInterval(updateCountdowns, 1000);
setInterval(renderAll, 60000);
fetchQuotes().then(renderAll);
setInterval(() => fetchQuotes().then(renderAll), 60000);
