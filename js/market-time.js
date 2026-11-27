// ============================================================
// 交易时段看板 - 时间与交易时段引擎（纯函数，无 DOM 依赖）
// 全站时间基准：北京时间 Asia/Shanghai，与设备时区无关
// 同时支持浏览器（window.THD）与 Node（module.exports，供 tests/ 使用）
// ============================================================
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const data = isNode ? require('./data.js') : root.THD;
  const api = factory(data);
  if (isNode) {
    module.exports = api;
  } else {
    root.THD = Object.assign(root.THD || {}, api);
  }
})(typeof self !== 'undefined' ? self : this, function (data) {
  const { HOLIDAYS, A_SHARE_HOLIDAY_NAMES, DATA_YEARS } = data;

  // ---------- 基础工具 ----------
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const WEEKDAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  const bjFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });

  /**
   * 获取指定时刻（默认当前）对应的北京时间各字段
   * @param nowMs 毫秒时间戳，测试时可注入
   */
  function beijingNow(nowMs) {
    if (nowMs === undefined) nowMs = Date.now();
    const parts = {};
    for (const p of bjFormatter.formatToParts(new Date(nowMs))) parts[p.type] = p.value;
    const y = +parts.year, m = +parts.month, d = +parts.day;
    // NOTE: 部分引擎在 00:xx 会返回 "24"，统一取模归零
    const h = +parts.hour % 24, min = +parts.minute, s = +parts.second;
    return {
      nowMs, y, m, d, h, min, s,
      weekday: WEEKDAY_MAP[parts.weekday],
      key: y + '-' + pad(m) + '-' + pad(d),
      minute: h * 60 + min
    };
  }

  function keyToDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
  }

  function addDays(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  }

  function inRanges(key, ranges) {
    return ranges.some(([a, b]) => key >= a && key <= b);
  }

  // 北京时间某日的 minute 分钟 -> 绝对时间戳（UTC+8）
  function bjMinuteToMs(key, minute) {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d, Math.floor(minute / 60) - 8, minute % 60);
  }

  // ---------- 格式化 ----------
  function fmtDuration(ms) {
    if (ms <= 0) return '已到';
    const totalMin = Math.round(ms / 60000);
    const hh = Math.floor(totalMin / 60), mm = totalMin % 60;
    if (hh > 0) return hh + ' 小时 ' + mm + ' 分';
    if (mm > 0) return '约 ' + mm + ' 分钟';
    return '不足 1 分钟';
  }

  // 秒级倒计时 HH:MM:SS（小时数超过 99 时自然扩展为 3 位）
  function fmtClockCountdown(ms) {
    if (ms <= 0) return '00:00:00';
    const totalSec = Math.floor(ms / 1000);
    return pad(Math.floor(totalSec / 3600)) + ':' + pad(Math.floor((totalSec % 3600) / 60)) + ':' + pad(totalSec % 60);
  }

  // 无有效价格（null/NaN/<=0）时显示占位符，避免误导
  function fmtPrice(v) {
    if (v == null || !isFinite(v) || v <= 0) return '--';
    return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Float 主数字：无千分位；decimals=0 取整，decimals>0 固定小数位
  function fmtFloatValue(v, decimals) {
    if (v == null || !isFinite(v) || v <= 0) return '--';
    return decimals > 0 ? v.toFixed(decimals) : Math.round(v).toString();
  }

  function fmtPct(v) {
    if (v == null || !isFinite(v)) return '--';
    return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  }

  function fmtClock(minute) {
    return pad(Math.floor(minute / 60)) + ':' + pad(minute % 60);
  }

  // ---------- 日历 ----------
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
      for (const [r, name] of A_SHARE_HOLIDAY_NAMES) if (key >= r[0] && key <= r[1]) return name;
      return '节假日';
    }
    if (id === 'us') return '美股休市日';
    if (id === 'hk') return '港股休市日';
    if (id === 'jp') return '东京休市日';
    if (id === 'kr') return '首尔休市日';
    if (id === 'brent') return 'ICE 休市日';
    return '休市';
  }

  // 日期是否在日历覆盖范围内（超出时页面提示更新）
  function isCalendarCovered(key) {
    const y = +key.slice(0, 4);
    return DATA_YEARS.indexOf(y) >= 0;
  }

  // ---------- 亚太常规市场（A股/港股/日经/韩股） ----------
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
      sessions: [{ start: 480, end: 870, type: 'open', label: '交易 08:00–14:30' }]
    }
  };

  function segCls(type) {
    return { open: 'tl-open', lunch: 'tl-lunch', pre: 'tl-pre', post: 'tl-post' }[type] || 'tl-closed';
  }

  function buildSegs(cfg) {
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

  function result(status, detail, countdownLabel, targetMs, timelineSegs, holidayName, openMs) {
    return { status, detail, countdownLabel, targetMs, timelineSegs, holidayName: holidayName || null, openMs };
  }

  function computeRegularMarket(cfg, now) {
    const segs = buildSegs(cfg);

    if (!isTradingDay(cfg.id, now.key)) {
      const t = nextOpen(cfg, now.key);
      if (now.weekday === 0 || now.weekday === 6) {
        return result('weekend', '周末休市', '距开盘', t, [{ start: 0, end: 1440, cls: 'tl-closed' }], null, t);
      }
      const name = getHolidayName(cfg.id, now.key);
      return result('holiday', name + ' · 休市', '距开盘', t, [{ start: 0, end: 1440, cls: 'tl-holiday' }], name, t);
    }

    // 港股半日市：仅上午交易
    if (cfg.id === 'hk' && HOLIDAYS.hkHalf.includes(now.key)) {
      const halfSegs = [
        { start: 0, end: 570, cls: 'tl-overnight' },
        { start: 570, end: 720, cls: 'tl-open' },
        { start: 720, end: 1440, cls: 'tl-overnight' }
      ];
      if (now.minute >= 570 && now.minute < 720) {
        return result('open', '早盘 09:30–12:00（半日市）', '距收盘', bjMinuteToMs(now.key, 720), halfSegs, null, now.nowMs);
      }
      if (now.minute < 570) {
        const t = bjMinuteToMs(now.key, 570);
        return result('overnight', '开盘前（半日市）', '距开盘', t, halfSegs, null, t);
      }
      const t = nextOpen(cfg, now.key);
      return result('overnight', '半日市 · 已收盘', '距开盘', t, halfSegs, null, t);
    }

    for (const seg of cfg.sessions) {
      if (now.minute >= seg.start && now.minute < seg.end) {
        if (seg.type === 'open') {
          const label = seg.end === cfg.closeMinute ? '距收盘' : '距午休';
          return result('open', seg.label, label, bjMinuteToMs(now.key, seg.end), segs, null, now.nowMs);
        }
        const nextSeg = cfg.sessions.find(s => s.type === 'open' && s.start >= seg.end);
        const tgt = nextSeg ? nextSeg.start : seg.end;
        const t = bjMinuteToMs(now.key, tgt);
        return result('lunch', seg.label, '距午盘', t, segs, null, t);
      }
    }

    if (now.minute < cfg.openMinute) {
      const t = bjMinuteToMs(now.key, cfg.openMinute);
      return result('overnight', '开盘前', '距开盘', t, segs, null, t);
    }
    const t = nextOpen(cfg, now.key);
    return result('overnight', '已收盘', '距开盘', t, segs, null, t);
  }

  // ---------- 美股（夏令时 + 美东日期） ----------
  // 某年某月第 n 个周日（UTC 零点时间戳）
  function nthSundayUtc(y, m0, n) {
    const dow = new Date(Date.UTC(y, m0, 1)).getUTCDay();
    return Date.UTC(y, m0, 1 + ((7 - dow) % 7) + (n - 1) * 7);
  }

  function lastSundayUtc(y, m0) {
    const last = new Date(Date.UTC(y, m0 + 1, 0));
    return Date.UTC(y, m0, last.getUTCDate() - last.getUTCDay());
  }

  function msToKey(ms) {
    const dt = new Date(ms);
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  }

  /** 某年美国夏令时起止日期（3 月第 2 个周日 ~ 11 月第 1 个周日），返回 YYYY-MM-DD */
  function usDstBoundsForYear(y) {
    return { startKey: msToKey(nthSundayUtc(y, 2, 2)), endKey: msToKey(nthSundayUtc(y, 10, 1)) };
  }

  function usIsDST(nowMs) {
    const y = new Date(nowMs).getUTCFullYear();
    const start = nthSundayUtc(y, 2, 2) + 7 * 3600e3; // 3 月第 2 周日 02:00 EST = 07:00 UTC
    const end = nthSundayUtc(y, 10, 1) + 6 * 3600e3;  // 11 月第 1 周日 02:00 EDT = 06:00 UTC
    return nowMs >= start && nowMs < end;
  }

  // 美东某日期相对 UTC 的偏移小时数（夏令 4 / 冬令 5），任意年份通用
  function usOffsetForEtDate(key) {
    const b = usDstBoundsForYear(+key.slice(0, 4));
    return (key >= b.startKey && key < b.endKey) ? 4 : 5;
  }

  function usEtMs(key, hour, minute) {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d, hour, minute) + usOffsetForEtDate(key) * 3600e3;
  }
  const usOpenMs = key => usEtMs(key, 9, 30);
  const usPreMs = key => usEtMs(key, 4, 0);
  const usCloseMs = (key, early) => usEtMs(key, early ? 13 : 16, 0);

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

  // 状态 -> 时间轴样式类映射（保证进度条与实时状态单一数据源、绝不冲突）
  const STATUS_TL_CLS = {
    open: 'tl-open', lunch: 'tl-lunch', pre: 'tl-pre', post: 'tl-post',
    overnight: 'tl-overnight', weekend: 'tl-closed', holiday: 'tl-holiday'
  };

  /**
   * 逐分钟采样生成北京时间当日 0..1439 的时间轴分段
   * @param bjKey 北京日期 YYYY-MM-DD
   * @param statusAtMs (ms) => 状态码字符串
   */
  function buildTimelineBySampling(bjKey, statusAtMs) {
    const segs = [];
    let curCls = null, start = 0;
    for (let m = 0; m < 1440; m++) {
      const cls = STATUS_TL_CLS[statusAtMs(bjMinuteToMs(bjKey, m))] || 'tl-closed';
      if (cls !== curCls) {
        if (curCls !== null) segs.push({ start, end: m, cls: curCls });
        curCls = cls;
        start = m;
      }
    }
    if (curCls !== null) segs.push({ start, end: 1440, cls: curCls });
    return segs;
  }

  function usPhaseInfo(nowMs) {
    const offset = usIsDST(nowMs) ? 4 : 5;
    const et = new Date(nowMs - offset * 3600e3);
    const etKey = et.getUTCFullYear() + '-' + pad(et.getUTCMonth() + 1) + '-' + pad(et.getUTCDate());
    const etMin = et.getUTCHours() * 60 + et.getUTCMinutes();
    const etDow = et.getUTCDay();
    const isEarly = HOLIDAYS.usEarly.includes(etKey);
    const closeMin = isEarly ? 780 : 960;      // 提前收盘 13:00 ET，常规 16:00 ET
    const postEndMin = isEarly ? 1020 : 1200;  // 提前收盘盘后至 17:00 ET，常规至 20:00 ET

    let status;
    if (HOLIDAYS.us.includes(etKey)) status = 'holiday';
    else if (etDow === 0 || etDow === 6) status = 'weekend';
    else if (etMin >= 240 && etMin < 570) status = 'pre';
    else if (etMin >= 570 && etMin < closeMin) status = 'open';
    else if (etMin >= closeMin && etMin < postEndMin) status = 'post';
    else status = 'overnight';

    return { status, offset, etKey, etMin, isEarly };
  }

  function usPhaseAt(nowMs) { return usPhaseInfo(nowMs).status; }

  function buildUsTimeline(bjKey) {
    return buildTimelineBySampling(bjKey, usPhaseAt);
  }

  function usStatus(now) {
    const info = usPhaseInfo(now.nowMs);
    const { status, offset, etKey, etMin, isEarly } = info;
    const segs = buildUsTimeline(now.key);

    if (status === 'holiday') {
      const t = usNextOpenMs(etKey);
      return result('holiday', '美股休市日', '距开盘', t, segs, '美股休市日', t);
    }
    if (status === 'weekend') {
      const t = usNextOpenMs(etKey);
      return result('weekend', '周末休市', '距开盘', t, segs, null, t);
    }

    const bj = offset === 4
      ? {
          pre: '16:00–21:30',
          open: isEarly ? '21:30–01:00' : '21:30–04:00',
          post: isEarly ? '01:00–05:00' : '04:00–08:00'
        }
      : {
          pre: '17:00–22:30',
          open: isEarly ? '22:30–02:00' : '22:30–05:00',
          post: isEarly ? '02:00–06:00' : '05:00–09:00'
        };

    if (status === 'pre') {
      const t = usOpenMs(etKey);
      return result('pre', '盘前 ' + bj.pre + '（北京）', '距开盘', t, segs, null, t);
    }
    if (status === 'open') {
      const detail = isEarly ? '常规交易 ' + bj.open + '（北京·提前收盘）' : '常规交易 ' + bj.open + '（北京）';
      return result('open', detail, '距收盘', usCloseMs(etKey, isEarly), segs, null, now.nowMs);
    }
    if (status === 'post') {
      const t = usNextOpenMs(etKey);
      const detail = isEarly ? '盘后 ' + bj.post + '（北京·提前收盘）' : '盘后 ' + bj.post + '（北京）';
      return result('post', detail, '距开盘', t, segs, null, t);
    }
    if (etMin < 240) {
      return result('overnight', '隔夜', '距盘前', usPreMs(etKey), segs, null, usOpenMs(etKey));
    }
    const t = usNextOpenMs(etKey);
    return result('overnight', '隔夜', '距开盘', t, segs, null, t);
  }

  // ---------- 加密货币：24/7 ----------
  function cryptoStatus(now) {
    return result('open', '24/7 · 全年无休', null, null, [{ start: 0, end: 1440, cls: 'tl-open' }], null, now ? now.nowMs : 0);
  }

  // ---------- ICE 布伦特原油（伦敦时间 01:00–23:00，周一至周五；换算为北京时间展示） ----------
  // 英国夏令时：3 月最后一个周日 01:00 UTC ~ 10 月最后一个周日 01:00 UTC
  function ukIsDST(nowMs) {
    const y = new Date(nowMs).getUTCFullYear();
    const start = lastSundayUtc(y, 2) + 3600e3;
    const end = lastSundayUtc(y, 9) + 3600e3;
    return nowMs >= start && nowMs < end;
  }

  function ukOffsetMinForDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return ukIsDST(Date.UTC(y, m - 1, d, 12)) ? 60 : 0;
  }

  // 伦敦某日 minute 分钟 -> 绝对时间戳
  function ukMinuteToMs(key, minute) {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d, 0, minute) - ukOffsetMinForDateKey(key) * 60000;
  }

  function brentLocal(nowMs) {
    const isBst = ukIsDST(nowMs);
    const t = new Date(nowMs + (isBst ? 3600e3 : 0));
    return {
      isBst,
      key: t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()),
      min: t.getUTCHours() * 60 + t.getUTCMinutes(),
      dow: t.getUTCDay()
    };
  }

  function brentIsTradingDay(key) {
    const dow = keyToDate(key).weekday;
    return dow >= 1 && dow <= 5 && !HOLIDAYS.brent.includes(key);
  }

  // 下一次开盘（伦敦 01:00）的绝对时间戳
  function brentNextOpenMs(key, min) {
    if (brentIsTradingDay(key) && min < 60) return ukMinuteToMs(key, 60);
    let k = key;
    for (let i = 0; i < 14; i++) {
      k = addDays(k, 1);
      if (brentIsTradingDay(k)) return ukMinuteToMs(k, 60);
    }
    return ukMinuteToMs(addDays(key, 1), 60);
  }

  function brentPhaseInfo(nowMs) {
    const L = brentLocal(nowMs);
    const weekday = L.dow >= 1 && L.dow <= 5;
    let status;
    if (weekday && HOLIDAYS.brent.includes(L.key)) status = 'holiday';
    else if (L.dow === 0 || L.dow === 6 || (L.dow === 5 && L.min >= 1380) || (L.dow === 1 && L.min < 60)) status = 'weekend';
    else if (L.min >= 60 && L.min < 1380) status = 'open';
    else status = 'overnight';
    return { status, L };
  }

  function brentPhaseAt(nowMs) { return brentPhaseInfo(nowMs).status; }

  function buildBrentTimeline(bjKey) {
    return buildTimelineBySampling(bjKey, brentPhaseAt);
  }

  function brentStatus(now) {
    const { status, L } = brentPhaseInfo(now.nowMs);
    const segs = buildBrentTimeline(now.key);

    if (status === 'holiday') {
      const t = brentNextOpenMs(L.key, L.min);
      return result('holiday', 'ICE 休市日 · 休市', '距开盘', t, segs, 'ICE 休市日', t);
    }
    if (status === 'weekend') {
      const t = brentNextOpenMs(L.key, L.min);
      return result('weekend', '周末休市', '距开盘', t, segs, null, t);
    }
    if (status === 'open') {
      const detail = L.isBst ? '连续交易 08:00–次日06:00（北京·夏令时）' : '连续交易 09:00–次日07:00（北京·冬令时）';
      return result('open', detail, '距休市', ukMinuteToMs(L.key, 1380), segs, null, now.nowMs);
    }
    const t = brentNextOpenMs(L.key, L.min);
    const detail = L.isBst ? '每日维护休市 06:00–08:00（北京）' : '每日维护休市 07:00–09:00（北京）';
    return result('overnight', detail, '距开盘', t, segs, null, t);
  }

  // ---------- 统一入口 ----------
  const statusFns = {
    aShare: now => computeRegularMarket(CFG.aShare, now),
    hk: now => computeRegularMarket(CFG.hk, now),
    jp: now => computeRegularMarket(CFG.jp, now),
    kr: now => computeRegularMarket(CFG.kr, now),
    us: usStatus,
    crypto: cryptoStatus,
    brent: brentStatus
  };

  function getStatus(id, now) { return statusFns[id](now); }

  // 下一次开盘时间戳（已开盘返回当前时刻），用于看板排序
  function nextOpenMsOf(id, now) {
    const st = statusFns[id](now);
    return st.status === 'open' ? now.nowMs : st.openMs;
  }

  return {
    WEEK_CN, pad, beijingNow, keyToDate, addDays, inRanges, bjMinuteToMs,
    fmtDuration, fmtClockCountdown, fmtPrice, fmtFloatValue, fmtPct, fmtClock,
    isTradingDay, getHolidayName, isCalendarCovered,
    CFG, computeRegularMarket,
    usDstBoundsForYear, usIsDST, usOffsetForEtDate, usStatus, usOpenMs,
    ukIsDST, brentStatus, brentLocal,
    statusFns, getStatus, nextOpenMsOf
  };
});
