// ============================================================
// 网页 Dashboard：方案 A · 瑞士世界时极简联动矩阵 + 顶部宏观风向标条
// - 零卡片套娃、零无意义图标、3 栏精密纵向对齐指数
// - 桌面端贯穿全部 9 行的垂直激光游标线 + 移动端独立游标
// ============================================================
(function (root) {
  const THD = root.THD;
  const Q = THD.Quotes;
  const { MARKETS, MACRO_ITEMS, STATUS_META, DATA_YEARS, WEEK_CN, pad, prefs } = THD;

  const grid = document.getElementById('grid');
  const macroStrip = document.getElementById('macro-strip');
  let lastOrder = [];

  // ---------- 顶部宏观风向标条 ----------
  function renderMacroStrip() {
    if (!macroStrip || !MACRO_ITEMS) return;
    macroStrip.innerHTML = MACRO_ITEMS.map(function (it) {
      return '<div class="macro-item" data-code="' + it.code + '" data-decimals="' + (it.decimals != null ? it.decimals : 2) + '" data-suffix="' + (it.suffix || '') + '">' +
        '<span class="macro-label">' + it.label + '</span>' +
        '<span class="macro-val">--</span>' +
        '<span class="macro-pct flat">--</span>' +
      '</div>';
    }).join('');
  }

  // ---------- 轨道与游标 ----------
  function renderTrack(segs, nowMinute, showNow) {
    let bar = '';
    for (const s of segs) {
      bar += '<div class="' + s.cls + '" style="flex:0 0 ' + ((s.end - s.start) / 1440 * 100) + '%"></div>';
    }
    const pct = (nowMinute / 1440 * 100).toFixed(3) + '%';
    const veilEl = showNow === false ? '' :
      '<div class="row-past-veil" style="width:' + pct + '"></div>';
    const nowEl = showNow === false ? '' :
      '<div class="row-now" style="left:' + pct + '"></div>';
    return '<div class="timeline-bar">' + bar + '</div>' + veilEl + nowEl;
  }

  function tlKey(segs) { return segs.map(s => s.start + '-' + s.end + '-' + s.cls).join('|'); }

  function updateLaser(now) {
    const pct = ((now.minute + now.s / 60) / 1440 * 100).toFixed(3) + '%';
    const laser = document.getElementById('global-laser');
    const veil = document.getElementById('global-past-veil');
    const tag = document.getElementById('global-laser-tag');
    if (laser) laser.style.left = pct;
    if (veil) veil.style.width = pct;
    if (tag) tag.textContent = pad(now.h) + ':' + pad(now.min);
    grid.querySelectorAll('.row-now').forEach(function (el) { el.style.left = pct; });
    grid.querySelectorAll('.row-past-veil').forEach(function (el) { el.style.width = pct; });
  }

  // ---------- 指数列（主指数排第一行，副指数整齐纵向排布） ----------
  function orderedQuotes(m) {
    const main = [], rest = [];
    for (const q of m.quotes) {
      if (THD.quoteCode(q) === m.primaryCode) main.push(q); else rest.push(q);
    }
    return main.concat(rest);
  }

  function renderQuotesCol(m) {
    const list = orderedQuotes(m);
    let html = '';
    list.forEach(function (q, idx) {
      const code = THD.quoteCode(q);
      const dec = q.decimals != null ? q.decimals : 2;
      html += '<div class="q-line ' + (idx === 0 ? 'q-main' : 'q-sub') + '" data-market="' + m.id + '" data-code="' + code + '" data-decimals="' + dec + '">' +
        '<span class="q-label">' + q.label + '</span>' +
        '<span class="q-val">--</span>' +
        '<span class="q-pct flat">--</span>' +
      '</div>';
    });
    return html;
  }

  const cdPrefix = label => (label || '').replace(/^距/, '');

  function cdHtml(st, now) {
    if (st.countdownLabel && st.targetMs) {
      const p = cdPrefix(st.countdownLabel);
      return '<span class="countdown" data-label="' + p + '" data-target="' + st.targetMs + '">' +
        p + ' ' + THD.fmtCompactDuration(st.targetMs - now.nowMs) + '</span>';
    }
    return '<span class="countdown cd-muted">—</span>';
  }

  function renderRow(m, st, now) {
    const active = st.status === 'open' || st.status === 'pre' || st.status === 'post';
    return '<article class="m-row' + (active ? ' is-active-row' : '') + '" data-id="' + m.id + '" data-status="' + st.status + '" data-tlkey="' + tlKey(st.timelineSegs) + '" tabindex="0" role="link" aria-label="进入' + m.name + '桌面时钟">' +
      '<div class="m-info">' +
        '<div class="m-name-line">' +
          '<span class="m-name">' + m.name + '</span>' +
          '<span class="m-state st-' + st.status + '"><span class="dot dot-' + st.status + '"></span><span class="m-state-text">' + STATUS_META[st.status].label + '</span></span>' +
        '</div>' +
        '<div class="m-detail">' + st.detail + '</div>' +
      '</div>' +
      '<div class="m-quotes">' + renderQuotesCol(m) + '</div>' +
      '<div class="m-track">' + renderTrack(st.timelineSegs, now.minute, m.id !== 'crypto') + '</div>' +
      '<div class="m-cd">' + cdHtml(st, now) + '<span class="m-arrow" aria-hidden="true">→</span></div>' +
    '</article>';
  }

  function patchRow(el, m, st, now) {
    const active = st.status === 'open' || st.status === 'pre' || st.status === 'post';
    el.classList.toggle('is-active-row', active);
    el.dataset.status = st.status;

    const stateEl = el.querySelector('.m-state');
    stateEl.className = 'm-state st-' + st.status;
    stateEl.querySelector('.dot').className = 'dot dot-' + st.status;
    stateEl.querySelector('.m-state-text').textContent = STATUS_META[st.status].label;
    el.querySelector('.m-detail').textContent = st.detail;

    const cd = el.querySelector('.countdown');
    if (st.countdownLabel && st.targetMs) {
      const p = cdPrefix(st.countdownLabel);
      cd.classList.remove('cd-muted');
      cd.dataset.label = p;
      cd.dataset.target = st.targetMs;
      cd.textContent = p + ' ' + THD.fmtCompactDuration(st.targetMs - now.nowMs);
    } else {
      cd.classList.add('cd-muted');
      cd.removeAttribute('data-target');
      cd.removeAttribute('data-label');
      cd.textContent = '—';
    }

    const track = el.querySelector('.m-track');
    const key = tlKey(st.timelineSegs);
    if (el.dataset.tlkey !== key) {
      el.dataset.tlkey = key;
      track.innerHTML = renderTrack(st.timelineSegs, now.minute, m.id !== 'crypto');
    }
  }

  // ---------- 行情 ----------
  const trendCls = v => (v == null || !isFinite(v)) ? 'flat' : (v > 0 ? 'up' : (v < 0 ? 'down' : 'flat'));

  function updateQuotes() {
    grid.querySelectorAll('.q-line[data-market]').forEach(function (el) {
      const v = Q.getValue(el.dataset.market, el.dataset.code);
      const dec = +el.dataset.decimals;
      el.querySelector('.q-val').textContent = THD.fmtPrice(v.price, isFinite(dec) ? dec : 2);
      const pctEl = el.querySelector('.q-pct');
      pctEl.textContent = THD.fmtPct(v.pct);
      pctEl.className = 'q-pct ' + trendCls(v.pct);
    });
    if (macroStrip) {
      macroStrip.querySelectorAll('.macro-item[data-code]').forEach(function (el) {
        const v = Q.getValue('macro', el.dataset.code);
        const dec = +el.dataset.decimals;
        const formatted = THD.fmtPrice(v.price, isFinite(dec) ? dec : 2);
        const suffix = el.dataset.suffix || '';
        el.querySelector('.macro-val').textContent = (formatted !== '--' && suffix) ? formatted + suffix : formatted;
        const pctEl = el.querySelector('.macro-pct');
        pctEl.textContent = THD.fmtPct(v.pct);
        pctEl.className = 'macro-pct ' + trendCls(v.pct);
      });
    }
  }

  // ---------- 刷新与排序 ----------
  function orderedMarkets(now) {
    return [...MARKETS].sort(function (a, b) {
      if (a.id === 'crypto') return -1;
      if (b.id === 'crypto') return 1;
      return THD.nextOpenMsOf(a.id, now) - THD.nextOpenMsOf(b.id, now);
    });
  }

  function buildRows(ordered, now) {
    grid.innerHTML = ordered.map(m => renderRow(m, THD.getStatus(m.id, now), now)).join('');
    lastOrder = ordered.map(m => m.id);
    updateQuotes();
  }

  function refresh() {
    const now = THD.beijingNow();
    updateHeader(now);
    const ordered = orderedMarkets(now);
    const newOrder = ordered.map(m => m.id);
    if (newOrder.join(',') !== lastOrder.join(',')) {
      buildRows(ordered, now);
    } else {
      for (const m of ordered) {
        const el = grid.querySelector('.m-row[data-id="' + m.id + '"]');
        if (el) patchRow(el, m, THD.getStatus(m.id, now), now);
      }
    }
    updateLaser(now);
  }

  // ---------- 头部全局摘要（去复读） ----------
  function updateHeader(now) {
    document.getElementById('date-line').textContent = now.m + '月' + now.d + '日 ' + WEEK_CN[now.weekday];
    document.getElementById('data-warning').hidden = THD.isCalendarCovered(now.key);

    let openCount = 0;
    let euOpen = false, usOpen = false;
    for (const m of MARKETS) {
      const s = THD.getStatus(m.id, now);
      if (s.status === 'open') {
        openCount++;
        if (m.id === 'eu') euOpen = true;
        if (m.id === 'us') usOpen = true;
      }
    }
    let summary = openCount + '/' + MARKETS.length + ' 市场交易中';
    if (euOpen && usOpen) summary += ' · 欧美重叠窗口';
    const sum = document.getElementById('market-summary');
    if (sum) sum.textContent = summary;
  }

  function updateClock() {
    const now = THD.beijingNow();
    document.getElementById('clock').textContent = pad(now.h) + ':' + pad(now.min) + ':' + pad(now.s);
    updateLaser(now);
  }

  function updateConnPill() {
    const pill = document.getElementById('conn-pill');
    if (!pill) return;
    const info = Q.liveInfo();
    let cls = 'conn-off', text = '连接中';
    const t = info.at ? THD.beijingNow(info.at) : null;
    const hhmm = t ? pad(t.h) + ':' + pad(t.min) : '';
    if (info.live) { cls = 'conn-live'; text = '实时'; }
    else if (info.gotLive) { cls = 'conn-poll'; text = '轮询'; }
    else if (info.hasCache) { cls = 'conn-cache'; text = '缓存 · ' + hhmm; }
    pill.className = 'conn-indicator ' + cls;
    pill.querySelector('.conn-text').textContent = text;
  }

  function tickCountdowns() {
    const nowMs = Date.now();
    grid.querySelectorAll('.countdown[data-target]').forEach(function (el) {
      el.textContent = el.dataset.label + ' ' + THD.fmtCompactDuration(+el.dataset.target - nowMs);
    });
  }

  // ---------- 页脚 ----------
  function renderLegend() {
    const items = [
      ['交易中', 'dot-open'], ['午休', 'dot-lunch'], ['竞价/盘前', 'dot-pre'],
      ['盘后', 'dot-post'], ['隔夜', 'dot-overnight'], ['假期', 'dot-holiday']
    ];
    let html = '';
    for (const [t, c] of items) html += '<span><span class="sw ' + c + '"></span>' + t + '</span>';
    document.getElementById('legend').innerHTML = html;
  }

  function renderSrc() {
    document.getElementById('src').innerHTML =
      '数据源：腾讯 · 华尔街见闻 · 东财 · Binance｜' + DATA_YEARS[0] + '–' + DATA_YEARS[DATA_YEARS.length - 1] + ' 日历｜点击行进入桌面时钟';
  }

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
    grid.addEventListener('click', function (e) {
      const row = e.target.closest('.m-row[data-id]');
      if (row) location.hash = row.dataset.id;
    });
    grid.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest('.m-row[data-id]');
      if (row) { e.preventDefault(); location.hash = row.dataset.id; }
    });
    renderMacroStrip();
    renderLegend();
    renderSrc();
    updateClock();
    refresh();
    updateConnPill();
  }

  THD.Dashboard = { init, refresh, updateQuotes, updateClock, tickCountdowns, updateConnPill };
})(self);
