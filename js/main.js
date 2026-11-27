// ============================================================
// 启动与路由：Dashboard ↔ 全屏 Float 时钟 无刷新互切
// location.hash 为市场 id 时进入全屏时钟，为空则回到看板
// ============================================================
(function (root) {
  const THD = root.THD;
  const { MARKET_IDS } = THD;
  const body = document.body;
  let wasFullscreen = false;

  function readRoute() {
    const h = location.hash.replace('#', '');
    if (MARKET_IDS.indexOf(h) >= 0) return h;
    const q = new URLSearchParams(location.search).get('market'); // 兼容旧 ?market= 链接
    if (q && MARKET_IDS.indexOf(q) >= 0) return q;
    return null;
  }

  function applyRoute() {
    const id = readRoute();
    if (id) {
      body.classList.add('mode-fullscreen');
      if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
      THD.Clock.show(id, wasFullscreen); // 仅在时钟内部切换市场时淡入淡出
      wasFullscreen = true;
    } else {
      body.classList.remove('mode-fullscreen');
      THD.Clock.hideHud();
      wasFullscreen = false;
      THD.Dashboard.refresh();
      THD.Dashboard.updateQuotes();
    }
  }

  function boot() {
    THD.Dashboard.init();
    THD.Clock.init();
    THD.Quotes.onUpdate(function () {
      THD.Dashboard.updateQuotes();
      THD.Clock.updateQuotes();
    });
    applyRoute();
    window.addEventListener('hashchange', applyRoute);

    setInterval(function () {
      THD.Dashboard.updateClock();
      THD.Dashboard.tickCountdowns();
      THD.Dashboard.updateConnPill();
      if (body.classList.contains('mode-fullscreen')) THD.Clock.tick();
    }, 1000);
    setInterval(function () {
      if (!body.classList.contains('mode-fullscreen')) THD.Dashboard.refresh();
    }, 15000);

    THD.Quotes.start();
  }

  boot();
})(self);
