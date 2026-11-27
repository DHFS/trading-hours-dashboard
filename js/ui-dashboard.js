// ============================================================
// 网页 Dashboard：多市场 Bento 看板（克制、专业、一屏尽览）
// 样式严格限定在 #dashboard-view 内，不使用任何 Float 数字样式
// ============================================================
(function (root) {
  const THD = root.THD;
  const Q = THD.Quotes;
  const { MARKETS, STATUS_META, DATA_YEARS, WEEK_CN, pad, prefs } = THD;

  const grid = document.getElementById('grid');
  let lastOrder = [];

  // 各市场图标：国旗 emoji（加密货币用比特币符号，橙色）；均为静态可信内容
  const ICONS = {
    aShare: '🇨🇳', hk: '🇭🇰', jp: '🇯🇵', kr: '🇰🇷', us: '🇺🇸',
    crypto: '<span class="btc">₿</span>', brent: '🛢️'
  };

  // ---------- 时间轴 ----------
  function renderTimeline(segs, nowMinute, showNow) {
    let bar = '';
    for (const s of segs) {
      bar += '<div class="' + s.cls + '" style="flex:0 0 ' + ((s.end - s.start) / 1440 * 100) + '%"></div>';
    }
    // 关键时间刻度：各分段边界（去掉 0:00 与 24:00 两端点）
    const marks = new Set();
    for (const s of segs) {
      if (s.start > 0 && s.start < 1440) marks.add(s.start);
      if (s.end > 0 && s.end < 1440) marks.add(s.end);
    }
    let marksHtml = '';
    for (const mm of [...marks].sort((a, b) => a - b)) {
      marksHtml += '<span class="mark" style="left:' + (mm / 1440 * 100).toFixed(3) + '%">' +
        '<i class="tick"></i><span class="lbl">' + THD.fmtClock(mm) + '</span></span>';
    }
    const nowEl = showNow === false ? '' :
      '<div class="timeline-now" style="left:' + (nowMinute / 1440 * 100).toFixed(2) + '%"></div>';
    return '<div class="timeline-bar">' + bar + '</div>' + nowEl + '<div class="timeline-marks">' + marksHtml + '</div>';
  }

  function tlKey(segs) { return segs.map(s => s.start + '-' + s.end + '-' + s.cls).join('|'); }

  // ---------- 卡片 ----------
  function renderStats(m) {
    let html = '';
    for (const q of m.quotes) {
      html += '<div class="stat" data-market="' + m.id + '" data-code="' + THD.quoteCode(q) + '">' +
        '<span class="stat-label">' + q.label + '</span>' +
        '<span class="stat-val">--</span>' +
        '<span class="stat-pct flat">--</span></div>';
    }
    return html;
  }

  function badgeHtml(st) {
    return '<span class="badge st-' + st.status + '"><span class="dot dot-' + st.status + '"></span>' +
      '<span class="badge-text">' + STATUS_META[st.status].label + '</span></span>';
  }

  function renderCard(m, st, now) {
    let cd;
    if (st.countdownLabel && st.targetMs) {
      cd = '<span class="countdown" data-label="' + st.countdownLabel + '" data-target="' + st.targetMs + '">' +
        st.countdownLabel + ' ' + THD.fmtDuration(st.targetMs - now.nowMs) + '</span>';
    } else {
      cd = '<span class="countdown" hidden></span>';
    }
    return '<article class="card" data-id="' + m.id + '" data-tlkey="' + tlKey(st.timelineSegs) + '" tabindex="0" role="link" aria-label="进入' + m.name + '桌面时钟">' +
      '<header class="card-head">' +
        '<div class="card-title-wrap">' + (m.sub ? '<div class="card-kicker">' + m.sub + '</div>' : '') +
          '<h2 class="card-title">' + m.name + '</h2></div>' +
        '<div class="card-head-right">' + badgeHtml(st) +
          '<span class="card-icon">' + (ICONS[m.id] || '') + '</span>' +
          '<span class="card-go" aria-hidden="true" title="进入桌面时钟">⛶</span></div>' +
      '</header>' +
      '<div class="stats' + (m.quotes.length >= 3 ? ' stats-multi' : '') + '">' + renderStats(m) + '</div>' +
      '<div class="card-foot"><div class="detail-line"><span class="detail">' + st.detail + '</span>' + cd + '</div></div>' +
      '<div class="timeline">' + renderTimeline(st.timelineSegs, now.minute, m.id !== 'crypto') + '</div>' +
      '</article>';
  }

  // 增量更新单张卡片，不重建 DOM
  function patchCard(el, m, st, now) {
    el.classList.toggle('is-open', st.status === 'open');
    const badge = el.querySelector('.badge');
    badge.className = 'badge st-' + st.status;
    badge.querySelector('.dot').className = 'dot dot-' + st.status;
    badge.querySelector('.badge-text').textContent = STATUS_META[st.status].label;
    el.querySelector('.detail').textContent = st.detail;

    const cd = el.querySelector('.countdown');
    if (st.countdownLabel && st.targetMs) {
      cd.dataset.label = st.countdownLabel;
      cd.dataset.target = st.targetMs;
      cd.textContent = st.countdownLabel + ' ' + THD.fmtDuration(st.targetMs - now.nowMs);
      cd.hidden = false;
    } else {
      cd.hidden = true;
      cd.removeAttribute('data-target');
    }

    // 时间轴：仅当时段结构变化时才重绘，否则只移动当前时间游标
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

  // ---------- 行情 ----------
  const trendCls = v => (v == null || !isFinite(v)) ? 'flat' : (v > 0 ? 'up' : (v < 0 ? 'down' : 'flat'));

  function updateQuotes() {
    grid.querySelectorAll('.stat[data-market]').forEach(function (el) {
      const v = Q.getValue(el.dataset.market, el.dataset.code);
      el.querySelector('.stat-val').textContent = THD.fmtPrice(v.price);
      const pctEl = el.querySelector('.stat-pct');
      pctEl.textContent = THD.fmtPct(v.pct);
      pctEl.className = 'stat-pct ' + trendCls(v.pct);
    });
  }

  // ---------- 刷新与排序 ----------
  function orderedMarkets(now) {
    return [...MARKETS].sort(function (a, b) {
      if (a.id === 'crypto') return -1;
      if (b.id === 'crypto') return 1;
      return THD.nextOpenMsOf(a.id, now) - THD.nextOpenMsOf(b.id, now);
    });
  }

  function buildCards(ordered, now) {
    grid.innerHTML = ordered.map(m => renderCard(m, THD.getStatus(m.id, now), now)).join('');
    lastOrder = ordered.map(m => m.id);
    updateQuotes();
  }

  function refresh() {
    const now = THD.beijingNow();
    updateHeader(now);
    const ordered = orderedMarkets(now);
    const newOrder = ordered.map(m => m.id);
    if (newOrder.join(',') !== lastOrder.join(',')) { buildCards(ordered, now); return; }
    for (const m of ordered) {
      const el = grid.querySelector('.card[data-id="' + m.id + '"]');
      if (el) patchCard(el, m, THD.getStatus(m.id, now), now);
    }
  }

  // ---------- 头部 ----------
  function updateHeader(now) {
    document.getElementById('date-line').textContent =
      now.y + '年' + now.m + '月' + now.d + '日 ' + WEEK_CN[now.weekday].replace('周', '星期');
    document.getElementById('data-warning').hidden = THD.isCalendarCovered(now.key);

    const st = THD.statusFns.aShare(now);
    const dot = document.querySelector('#day-tip .dot');
    const txt = document.getElementById('day-tip-text');
    if (st.status === 'holiday') {
      dot.className = 'dot dot-holiday'; txt.textContent = '今日 A股休市（' + st.holidayName + '）';
    } else if (st.status === 'weekend') {
      dot.className = 'dot dot-weekend'; txt.textContent = '今日 A股休市（周末）';
    } else {
      dot.className = 'dot dot-open'; txt.textContent = '今日 A股交易日';
    }
  }

  function updateClock() {
    const now = THD.beijingNow();
    document.getElementById('clock').textContent = pad(now.h) + ':' + pad(now.min) + ':' + pad(now.s);
  }

  // 行情数据状态胶囊：让用户一眼分辨「实时流 / 轮询 / 本地缓存」
  function updateConnPill() {
    const pill = document.getElementById('conn-pill');
    if (!pill) return;
    const info = Q.liveInfo();
    let cls = 'conn-off', text = '行情连接中…';
    const t = info.at ? THD.beijingNow(info.at) : null;
    const hhmm = t ? pad(t.h) + ':' + pad(t.min) : '';
    if (info.live) { cls = 'conn-live'; text = '实时流已连接 · ' + hhmm + ' 更新'; }
    else if (info.gotLive) { cls = 'conn-poll'; text = '轮询刷新 · ' + hhmm + ' 更新'; }
    else if (info.hasCache) { cls = 'conn-cache'; text = '本地缓存数据 · ' + hhmm; }
    pill.className = 'conn-pill ' + cls;
    pill.querySelector('.conn-text').textContent = text;
  }

  function tickCountdowns() {
    const nowMs = Date.now();
    grid.querySelectorAll('.countdown[data-target]').forEach(function (el) {
      el.textContent = el.dataset.label + ' ' + THD.fmtDuration(+el.dataset.target - nowMs);
    });
  }

  // ---------- 页脚 ----------
  function renderLegend() {
    const items = [
      ['交易中', 'dot-open'], ['午间休市', 'dot-lunch'], ['盘前', 'dot-pre'], ['盘后', 'dot-post'],
      ['隔夜休市', 'dot-overnight'], ['周末休市', 'dot-weekend'], ['休市', 'dot-holiday']
    ];
    let html = '';
    for (const [t, c] of items) html += '<span><span class="sw ' + c + '"></span>' + t + '</span>';
    html += '<span class="legend-up"><span class="sw"></span>涨</span><span class="legend-down"><span class="sw"></span>跌</span>';
    document.getElementById('legend').innerHTML = html;
  }

  function renderSrc() {
    document.getElementById('src').innerHTML =
      '行情数据来源：腾讯财经（股指与 ICE 布伦特原油，30秒刷新）/ 东方财富（日经、韩股及兜底）、Binance 现货镜像（BTC 实时流），可能存在延迟，仅供参考。<br>' +
      '交易时段与节假日来源：上交所 / 港交所 / JPX / KRX / NYSE / ICE Futures Europe 官方日历，覆盖 ' +
      DATA_YEARS[0] + '–' + DATA_YEARS[DATA_YEARS.length - 1] + ' 年（A股 2027 年待上交所年底公告复核）。' +
      '本页面不构成任何投资建议。';
  }

  // ---------- 涨跌色：默认绿涨红跌，可切换 ----------
  function applyTrend(mode) {
    document.body.dataset.trend = mode;
    const btn = document.getElementById('btn-trend');
    if (btn) {
      btn.textContent = mode === 'green-up' ? '涨绿跌红' : '涨红跌绿';
      btn.setAttribute('aria-pressed', mode === 'red-up' ? 'true' : 'false');
    }
    prefs.set('trend', mode);
  }

  function init() {
    applyTrend(prefs.get('trend', 'green-up') === 'red-up' ? 'red-up' : 'green-up');
    document.getElementById('btn-trend').addEventListener('click', function () {
      applyTrend(document.body.dataset.trend === 'green-up' ? 'red-up' : 'green-up');
    });
    document.getElementById('btn-clock').addEventListener('click', function () {
      location.hash = prefs.get('lastMarket', 'crypto');
    });
    // 整张卡片点击 / 回车直达该市场的全屏 Float 时钟
    grid.addEventListener('click', function (e) {
      const card = e.target.closest('.card[data-id]');
      if (card) location.hash = card.dataset.id;
    });
    grid.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.card[data-id]');
      if (card) { e.preventDefault(); location.hash = card.dataset.id; }
    });
    renderLegend();
    renderSrc();
    updateClock();
    refresh();
    updateConnPill();
  }

  THD.Dashboard = { init, refresh, updateQuotes, updateClock, tickCountdowns, updateConnPill };
})(self);
