// ============================================================
// 全屏桌面时钟：7 个市场统一的 iOS StandBy Float 纯黑画布
// - 交易活跃态（open/pre/post）：主舞台 = 主指数/价格（Float 差分滚动）
// - 休市等待态（lunch/overnight/weekend/holiday）：主舞台 = 距开盘倒计时 HH:MM:SS
// - 轻触屏幕呼出 HUD（选色/夜间红光/省电/锁定/返回），不再误切市场；左右滑动切换市场
// ============================================================
(function (root) {
  const THD = root.THD;
  const Q = THD.Quotes;
  const F = THD.Float;
  const { MARKETS, MARKET_IDS, STATUS_META, FLOAT_PALETTES, prefs } = THD;

  const view = document.getElementById('clock-view');
  const stageRoot = document.getElementById('clock-stage-root');
  const marketById = {};
  MARKETS.forEach(m => { marketById[m.id] = m; });

  let currentId = null;
  let locked = false;
  let hudTimer = null, dotsTimer = null;
  let battery = null; // { level, charging }，iOS Safari 不支持时保持 null 并隐藏

  const isActive = st => st.status === 'open' || st.status === 'pre' || st.status === 'post';
  const trendCls = v => (v == null || !isFinite(v)) ? 'flat' : (v > 0 ? 'up' : (v < 0 ? 'down' : 'flat'));

  function statusText(st) {
    let t = STATUS_META[st.status].label;
    // 节日名称不含「休市」时补充（如 春节），避免 “休市 · 美股休市日” 这类重复
    if (st.status === 'holiday' && st.holidayName && st.holidayName.indexOf('休市') < 0) t += ' · ' + st.holidayName;
    return t;
  }

  // ---------- 渲染 ----------
  function batteryHtml() {
    return '<span class="clock-battery" hidden aria-label="电量"><svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<circle class="bat-track" cx="12" cy="12" r="9"></circle>' +
      '<circle class="bat-ring" cx="12" cy="12" r="9" transform="rotate(-90 12 12)"></circle></svg>' +
      '<span class="bat-bolt" hidden>⚡</span></span>';
  }

  function cardHtml(m, st, now) {
    const active = isActive(st);
    const code = m.primaryCode;
    let stage;
    if (active) {
      stage = '<div class="stat float-primary" data-market="' + m.id + '" data-code="' + code + '">' +
        '<span class="stat-val float-num" data-fit></span></div>';
    } else {
      const cd = THD.fmtClockCountdown(st.targetMs - now.nowMs);
      stage = '<div class="cd-wrap"><div class="cd-label">' + (st.countdownLabel || '距开盘') + '</div>' +
        '<div class="cd-time float-num" data-fit data-target="' + st.targetMs + '">' + F.floatHtml(cd) + '</div></div>';
    }

    // 休市形态：右上角展示休市前收盘点位（只显示点位，不显示涨跌幅）
    const closeRef = active ? '' :
      '<span class="clock-close" data-market="' + m.id + '" data-code="' + code + '">--</span>';

    // 多指数市场在交易活跃态下，状态右侧轻量展示其余宽基指数
    let extras = '';
    if (active) {
      for (const q of m.quotes) {
        const c = THD.quoteCode(q);
        if (c === code) continue;
        extras += '<span class="clock-extra" data-market="' + m.id + '" data-code="' + c + '">' + q.label +
          ' <b class="flat">--</b></span>';
      }
    }

    return '<article class="float-card" data-id="' + m.id + '" data-mode="' + (active ? 'price' : 'countdown') + '">' +
      '<div class="clock-top-right"><span class="clock-tag">' + m.clockTag + '</span>' + closeRef +
        '<span class="clock-warn"' + (THD.isCalendarCovered(now.key) ? ' hidden' : '') + '>日历需更新</span>' +
        batteryHtml() + '</div>' +
      '<div class="clock-stage">' + stage + '</div>' +
      '<div class="clock-bottom-left">' +
        '<span class="clock-pct flat" data-market="' + m.id + '" data-code="' + code + '">--</span>' +
        '<span class="clock-meta-row"><span class="clock-status st-' + st.status + '">' +
          '<span class="dot dot-' + st.status + '"></span><span class="clock-status-text">' + statusText(st) + '</span></span>' +
          extras + '</span>' +
      '</div></article>';
  }

  function renderCurrent(withFade) {
    const m = marketById[currentId];
    const now = THD.beijingNow();
    const st = THD.getStatus(m.id, now);
    const html = cardHtml(m, st, now);
    const apply = function () {
      stageRoot.innerHTML = html;
      updateQuotes();
      updateBatteryUi();
      F.fitFloatStage();
      markDots();
    };
    if (withFade && !stageRoot.classList.contains('fade-out')) {
      stageRoot.classList.add('fade-out');
      setTimeout(function () {
        apply();
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { stageRoot.classList.remove('fade-out'); });
        });
        revealDots();
      }, 180);
    } else {
      apply();
    }
  }

  // ---------- 行情刷新 ----------
  function updateQuotes() {
    stageRoot.querySelectorAll('.stat[data-market]').forEach(function (el) {
      const m = marketById[el.dataset.market];
      const v = Q.getValue(m.id, el.dataset.code);
      const valEl = el.querySelector('.stat-val');
      const r = F.updateFloat(valEl, THD.fmtFloatValue(v.price, m.floatDecimals));
      if (r === 'rebuilt') F.fitFloatStage(); // 位数变化（如 BTC 5→6 位）需重新测宽
    });
    stageRoot.querySelectorAll('.clock-pct').forEach(function (el) {
      const v = Q.getValue(el.dataset.market, el.dataset.code);
      el.textContent = THD.fmtPct(v.pct);
      el.className = 'clock-pct ' + trendCls(v.pct);
    });
    stageRoot.querySelectorAll('.clock-close').forEach(function (el) {
      el.textContent = THD.fmtPrice(Q.getValue(el.dataset.market, el.dataset.code).price);
    });
    stageRoot.querySelectorAll('.clock-extra').forEach(function (el) {
      const v = Q.getValue(el.dataset.market, el.dataset.code);
      const b = el.querySelector('b');
      b.textContent = THD.fmtPct(v.pct);
      b.className = trendCls(v.pct);
    });
  }

  // ---------- 每秒心跳 ----------
  function tick() {
    if (!currentId || stageRoot.classList.contains('fade-out')) return;
    const el = stageRoot.querySelector('.float-card');
    if (!el) return;
    const m = marketById[currentId];
    const now = THD.beijingNow();
    const st = THD.getStatus(m.id, now);
    const wantMode = isActive(st) ? 'price' : 'countdown';
    // 市场或形态切换（盘中 ↔ 休市）时整体重建并重新测宽
    if (el.dataset.id !== currentId || el.dataset.mode !== wantMode) { renderCurrent(false); return; }

    const stEl = el.querySelector('.clock-status');
    stEl.className = 'clock-status st-' + st.status;
    stEl.querySelector('.dot').className = 'dot dot-' + st.status;
    stEl.querySelector('.clock-status-text').textContent = statusText(st);
    const warn = el.querySelector('.clock-warn');
    if (warn) warn.hidden = THD.isCalendarCovered(now.key);

    const cd = el.querySelector('.cd-time');
    if (cd) {
      cd.dataset.target = st.targetMs;
      const lbl = el.querySelector('.cd-label');
      if (lbl) lbl.textContent = st.countdownLabel || '距开盘';
      // 仅秒位等变化位滚动，其余数字与双圆球冒号绝对静止
      const r = F.updateFloat(cd, THD.fmtClockCountdown(st.targetMs - now.nowMs));
      if (r === 'rebuilt') F.fitFloatStage();
    }
  }

  // ---------- 导航 ----------
  function show(id, withFade) {
    if (!marketById[id]) return;
    currentId = id;
    prefs.set('lastMarket', id);
    renderCurrent(withFade);
  }
  function go(delta) {
    const idx = MARKET_IDS.indexOf(currentId);
    location.hash = MARKET_IDS[(idx + delta + MARKET_IDS.length) % MARKET_IDS.length];
  }

  function markDots() {
    document.querySelectorAll('.clock-dots .dot-item').forEach(function (d) {
      d.classList.toggle('active', d.dataset.id === currentId);
    });
  }
  function revealDots() {
    const dots = document.querySelector('.clock-dots');
    if (!dots) return;
    dots.classList.add('show');
    clearTimeout(dotsTimer);
    dotsTimer = setTimeout(function () { dots.classList.remove('show'); }, 3000);
  }

  // ---------- HUD 控制条 ----------
  function buildChrome() {
    const chrome = document.createElement('div');
    chrome.className = 'clock-chrome';
    let dots = '';
    for (const id of MARKET_IDS) dots += '<span class="dot-item" data-id="' + id + '"></span>';
    let sw = '';
    for (const p of FLOAT_PALETTES) {
      sw += '<button type="button" class="hud-swatch" data-palette="' + p.id + '" aria-label="配色：' + p.name +
        '" title="' + p.name + '" style="background:linear-gradient(135deg,' + p.preview[0] + ' 50%,' + p.preview[1] + ' 50%)"></button>';
    }
    chrome.innerHTML =
      '<div class="clock-dots">' + dots + '</div>' +
      '<div class="clock-hud" role="toolbar" aria-label="时钟设置">' +
        '<div class="hud-group">' + sw +
          '<button type="button" class="hud-btn" data-palette="random" aria-label="随机配色">随机</button></div>' +
        '<div class="hud-group">' +
          '<button type="button" class="hud-btn" data-act="night" aria-pressed="false">夜间红光</button>' +
          '<button type="button" class="hud-btn" data-act="eco" aria-pressed="false">省电静默</button>' +
          '<button type="button" class="hud-btn" data-act="lock" aria-pressed="false">锁定市场</button>' +
          '<button type="button" class="hud-btn hud-back" data-act="back">返回看板</button></div>' +
      '</div>';
    view.appendChild(chrome);

    chrome.querySelector('.clock-dots').addEventListener('click', function (e) {
      const d = e.target.closest('.dot-item');
      if (d && !locked) location.hash = d.dataset.id;
    });
    const hud = chrome.querySelector('.clock-hud');
    hud.addEventListener('pointerdown', scheduleHudHide);
    hud.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      scheduleHudHide();
      if (b.dataset.palette) { F.setPalette(b.dataset.palette); syncHud(); return; }
      const act = b.dataset.act;
      if (act === 'night') setNight(!document.body.classList.contains('night-mode'));
      else if (act === 'eco') setEco(!document.body.classList.contains('eco-mode'));
      else if (act === 'lock') { locked = !locked; syncHud(); }
      else if (act === 'back') { hideHud(); location.hash = ''; }
    });
    syncHud();
  }

  function syncHud() {
    const hud = document.querySelector('.clock-hud');
    if (!hud) return;
    const mode = F.getPaletteMode();
    hud.querySelectorAll('[data-palette]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.palette === mode);
    });
    const flags = {
      night: document.body.classList.contains('night-mode'),
      eco: document.body.classList.contains('eco-mode'),
      lock: locked
    };
    hud.querySelectorAll('[data-act]').forEach(function (b) {
      if (b.dataset.act in flags) {
        b.setAttribute('aria-pressed', flags[b.dataset.act] ? 'true' : 'false');
        b.classList.toggle('active', flags[b.dataset.act]);
      }
    });
  }

  function setNight(on) {
    document.body.classList.toggle('night-mode', on);
    prefs.set('night', on ? '1' : '0');
    syncHud();
  }
  function setEco(on) {
    document.body.classList.toggle('eco-mode', on);
    prefs.set('eco', on ? '1' : '0');
    syncHud();
  }

  function showHud() {
    const hud = document.querySelector('.clock-hud');
    if (!hud) return;
    hud.classList.add('show');
    scheduleHudHide();
  }
  function hideHud() {
    const hud = document.querySelector('.clock-hud');
    if (hud) hud.classList.remove('show');
    clearTimeout(hudTimer);
  }
  function scheduleHudHide() {
    clearTimeout(hudTimer);
    hudTimer = setTimeout(hideHud, 4500);
  }
  function toggleHud() {
    const hud = document.querySelector('.clock-hud');
    if (hud && hud.classList.contains('show')) hideHud(); else showHud();
  }

  // ---------- 手势：滑动切换，轻触呼出 HUD（防误触） ----------
  function attachGestures() {
    let sx = 0, sy = 0, tracking = false;
    view.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.clock-chrome')) return;
      sx = e.clientX; sy = e.clientY; tracking = true;
    });
    view.addEventListener('pointercancel', function () { tracking = false; });
    view.addEventListener('pointerup', function (e) {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
        if (locked) { showHud(); return; } // 已锁定：用 HUD 提示可解锁
        go(dx < 0 ? 1 : -1);
      } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
        toggleHud();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (!document.body.classList.contains('mode-fullscreen')) return;
      if (e.key === 'ArrowRight' && !locked) go(1);
      else if (e.key === 'ArrowLeft' && !locked) go(-1);
      else if (e.key === 'Escape') location.hash = '';
    });
  }

  // ---------- 电量环（iOS Safari 不支持 Battery API，此时保持隐藏不留空白） ----------
  const RING_LEN = 2 * Math.PI * 9;
  function updateBatteryUi() {
    stageRoot.querySelectorAll('.clock-battery').forEach(function (el) {
      if (!battery) { el.hidden = true; return; }
      el.hidden = false;
      const ring = el.querySelector('.bat-ring');
      ring.style.strokeDasharray = (battery.level * RING_LEN).toFixed(2) + ' ' + RING_LEN.toFixed(2);
      el.querySelector('.bat-bolt').hidden = !battery.charging;
    });
  }
  function initBattery() {
    if (!navigator.getBattery) return;
    navigator.getBattery().then(function (b) {
      const sync = function () { battery = { level: b.level, charging: b.charging }; updateBatteryUi(); };
      b.addEventListener('levelchange', sync);
      b.addEventListener('chargingchange', sync);
      sync();
    }).catch(function () { /* 忽略 */ });
  }

  // ---------- 屏幕常亮 ----------
  function requestWakeLock() {
    if (!('wakeLock' in navigator) || !document.body.classList.contains('mode-fullscreen')) return;
    navigator.wakeLock.request('screen').catch(function () { /* 需用户手势或系统设置允许 */ });
  }

  function init() {
    document.body.classList.toggle('night-mode', prefs.get('night', '0') === '1');
    document.body.classList.toggle('eco-mode', prefs.get('eco', '0') === '1');
    buildChrome();
    attachGestures();
    initBattery();
    F.startBurnInShift();
    document.addEventListener('click', requestWakeLock);
    document.addEventListener('touchstart', requestWakeLock, { passive: true });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) requestWakeLock(); });
  }

  THD.Clock = { init, show, tick, updateQuotes, hideHud };
})(self);
