// ============================================================
// 行情引擎：多源拉取（腾讯 30s 快轮询 / 东财期货与股指兜底 / ETF 估算）+ Binance 现货 WebSocket + 本地缓存
// 依赖：THD.MARKETS（data.js）
// ============================================================
(function (root) {
  const THD = root.THD;
  const MARKETS = THD.MARKETS;

  // quotes: 指数/原油最新价与涨跌幅（key=内部代码）；closes: 昨收/昨结；crypto: BTC
  const state = { quotes: {}, closes: {}, crypto: {} };
  // 数据时效信息，供看板顶部「数据状态」展示：区分实时流、轮询、本地缓存
  const meta = { lastFetchAt: 0, lastPushAt: 0, hasCache: false, gotLive: false };
  const listeners = [];
  const CACHE_KEY = 'thd_quotes_cache_v3';
  const TENCENT_POLL_MS = 30000; // 腾讯源（股指 + ICE 布伦特原油）无严苛 IP 封控，支持 30 秒快轮询
  const REST_POLL_MS = 300000;   // NOTE: 东财对高频请求有 IP 级风控，全量兜底轮询保持 5 分钟

  function onUpdate(fn) { listeners.push(fn); }
  function emit() {
    for (const fn of listeners) {
      try { fn(); } catch (e) { console.error('行情回调异常', e); }
    }
  }

  // 行情内部代码：显式 code 优先，其次东财 secid 后段，最后回退 label
  function quoteCode(q) {
    return q.code || (q.secid ? q.secid.split('.')[1] : q.label);
  }

  const isValid = v => isFinite(v) && v > 0;

  // ---------- 本地缓存（接口失败时兜底显示最近一次成功数据） ----------
  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const c = JSON.parse(raw);
      if (c && c.quotes) state.quotes = c.quotes;
      if (c && c.closes) state.closes = c.closes;
      if (c && c.crypto) state.crypto = c.crypto;
      meta.hasCache = true;
      meta.lastFetchAt = +c.ts || 0;
    } catch (e) { /* 忽略缓存解析错误 */ }
  }
  function saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ quotes: state.quotes, closes: state.closes, crypto: state.crypto, ts: Date.now() }));
    } catch (e) { /* 忽略写入错误（隐私模式/容量） */ }
  }

  async function fetchWithTimeout(url, ms) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms || 8000) : null;
    try {
      return await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // 构建数据源代码 -> 内部代码映射
  function buildSourceMaps() {
    const tencentMap = {}, tencentHfMap = {}, etfMap = {}, emFutMap = {}, emSecid = {}, emPrec = {};
    for (const m of MARKETS) {
      for (const q of m.quotes) {
        const code = quoteCode(q);
        if (q.tencent) tencentMap[q.tencent] = code;
        if (q.tencentHf) tencentHfMap[q.tencentHf] = code;
        if (q.etf) etfMap[q.etf] = { code: code, base: q.base };
        if (q.emFut) emFutMap[code] = q.emFut;
        if (q.secid) emPrec[code] = q.prec || 2;
        if (q.secid === '100.N225' || q.secid === '100.KS11' || q.secid === '112.B00Y') emSecid[q.secid] = code;
      }
    }
    return { tencentMap, tencentHfMap, etfMap, emFutMap, emSecid, emPrec };
  }

  /**
   * 腾讯接口批量拉取（A股/港股/美股股指 + 外盘原油 hf_OIL + 日经/韩股 ETF）
   * @returns {Promise<{gotAny: boolean, etfPct: Object}>}
   */
  async function fetchTencent(maps) {
    const { tencentMap, tencentHfMap, etfMap } = maps;
    const etfPct = {};
    let gotAny = false;
    const q = state.quotes, c = state.closes;
    const tcodes = Object.keys(tencentMap).concat(Object.keys(tencentHfMap), Object.keys(etfMap));
    if (!tcodes.length) return { gotAny, etfPct };

    try {
      const r = await fetchWithTimeout('https://qt.gtimg.cn/q=' + tcodes.join(','));
      const buf = await r.arrayBuffer();
      let text;
      try { text = new TextDecoder('gbk').decode(buf); } catch (e) { text = new TextDecoder('utf-8').decode(buf); }
      const re = /v_(\w+)="([^"]*)"/g;
      let mt;
      while ((mt = re.exec(text)) !== null) {
        const key = mt[1];
        const code = tencentMap[key];
        const hfCode = tencentHfMap[key];
        const etf = etfMap[key];

        if (hfCode) {
          // 腾讯外盘期货（如 hf_OIL）：逗号分隔，[0]=最新价 [1]=涨跌幅(%) [7]=昨结算价
          const p = mt[2].split(',');
          const price = parseFloat(p[0]), pct = parseFloat(p[1]), prev = parseFloat(p[7]);
          if (isValid(price)) {
            q[hfCode] = { price: price, pct: isFinite(pct) ? pct : null };
            gotAny = true;
          }
          if (isValid(prev)) c[hfCode] = prev;
        } else {
          // 股票/指数/ETF：~ 分隔，[3]=最新价 [4]=昨收
          const p = mt[2].split('~');
          const price = parseFloat(p[3]), prev = parseFloat(p[4]);
          if (code) {
            if (isValid(price)) { q[code] = { price: price }; gotAny = true; }
            if (isValid(prev)) c[code] = prev;
          } else if (etf && isValid(price) && isValid(prev)) {
            etfPct[etf.code] = (price - prev) / prev * 100;
          }
        }
      }
    } catch (e) {
      console.warn('行情获取失败（腾讯）', e);
    }
    return { gotAny, etfPct };
  }

  // 腾讯独立 30 秒快轮询：不触发东财接口，兼顾实时性与防风控
  async function pollTencentFast() {
    const res = await fetchTencent(buildSourceMaps());
    if (res.gotAny) {
      meta.lastFetchAt = Date.now();
      meta.gotLive = true;
      saveCache();
      emit();
    }
  }

  async function fetchQuotes() {
    const maps = buildSourceMaps();
    const { emFutMap, emSecid, emPrec } = maps;
    const q = state.quotes, c = state.closes;

    // 1) 主源：腾讯（A股/港股/美股 + ICE 布伦特原油 hf_OIL + 日经/KOSPI 的 ETF）
    const tRes = await fetchTencent(maps);
    let gotAny = tRes.gotAny;
    const etfPct = tRes.etfPct;

    // 2) 东财期货独立静态接口：布伦特原油备源 1（不占用 push2 限流池）
    for (const code of Object.keys(emFutMap)) {
      if (q[code] && isValid(q[code].price)) continue;
      try {
        const r = await fetchWithTimeout('https://futsseapi.eastmoney.com/static/' + emFutMap[code]);
        const j = await r.json();
        const qt = j && j.qt;
        if (qt && isValid(+qt.p)) {
          q[code] = { price: +qt.p, pct: isFinite(+qt.zdf) ? +qt.zdf : null };
          if (isValid(+qt.zjsj)) c[code] = +qt.zjsj;
          gotAny = true;
        }
      } catch (e) {
        console.warn('期货行情获取失败（东财静态兜底）', e);
      }
    }

    // 3) 东方财富批量接口：补充上述未取到的代码（f2=最新价 f3=涨跌幅 f18=昨收 f12=代码，均需 ÷10^prec）
    try {
      const secids = [];
      for (const m of MARKETS) for (const qq of m.quotes) if (qq.secid) secids.push(qq.secid);
      const r = await fetchWithTimeout('https://push2.eastmoney.com/api/qt/ulist.np/get?secids=' + secids.join(',') + '&fields=f2,f3,f18,f12,f14');
      const j = await r.json();
      if (j && j.data && j.data.diff) {
        for (const it of j.data.diff) {
          if (q[it.f12] && isValid(q[it.f12].price)) continue; // 已有数据不覆盖
          const prec = emPrec[it.f12] || 2;
          const scale = Math.pow(10, prec);
          if (!isValid(it.f2 / scale)) continue;
          q[it.f12] = { price: it.f2 / scale, pct: it.f3 / 100 };
          if (isValid(it.f18 / scale)) c[it.f12] = it.f18 / scale;
          gotAny = true;
        }
      }
    } catch (e) {
      console.warn('指数行情获取失败（东方财富兜底）', e);
    }

    // 4) 日经/KOSPI/原油 第三级精准源：东财 stock/get，多域名轮换提高成功率
    const emHosts = ['https://push2delay.eastmoney.com', 'https://push2his.eastmoney.com', 'https://push2.eastmoney.com'];
    for (const secid of Object.keys(emSecid)) {
      const code = emSecid[secid];
      if (q[code] && isValid(q[code].price)) continue;
      for (const host of emHosts) {
        try {
          const r = await fetchWithTimeout(host + '/api/qt/stock/get?secid=' + secid + '&fields=f43,f57,f58,f60,f169,f170,f152');
          const j = await r.json();
          const d = j && j.data;
          if (d && isValid(d.f43)) {
            const prec = Math.pow(10, d.f152 || 2);
            q[code] = { price: d.f43 / prec, pct: isFinite(d.f170) ? d.f170 / 100 : null };
            if (isValid(d.f60)) c[code] = d.f60 / prec;
            gotAny = true;
            break;
          }
        } catch (e) { /* 换下一个域名重试 */ }
      }
    }

    // 5) 日经/KOSPI 兜底估算：东财失败时，用 ETF 当日涨跌幅 × 昨收基准估算点位
    for (const m of MARKETS) {
      for (const qq of m.quotes) {
        if (!qq.etf) continue;
        const code = quoteCode(qq);
        if (q[code] && isValid(q[code].price)) continue;
        if (etfPct[code] === undefined) continue;
        const prev = isValid(c[code]) ? c[code] : (qq.base || 0);
        if (prev > 0) {
          q[code] = { price: prev * (1 + etfPct[code] / 100), pct: etfPct[code] };
          gotAny = true;
        }
      }
    }

    // 6) Binance 现货 REST 兜底：WebSocket 已连接时跳过，避免轮询旧值覆盖实时价造成回跳
    if (!btcStream.isLive()) {
      try {
        const r = await fetchWithTimeout('https://data-api.binance.vision/api/v3/ticker/24hr?symbols=%5B%22BTCUSDT%22%5D');
        const arr = await r.json();
        for (const it of arr) {
          if (isValid(+it.lastPrice)) {
            state.crypto[it.symbol.replace('USDT', '')] = { price: +it.lastPrice, pct: +it.priceChangePercent };
            gotAny = true;
          }
        }
      } catch (e) {
        console.warn('加密行情获取失败（Binance REST）', e);
      }
    }

    if (gotAny) {
      meta.lastFetchAt = Date.now();
      meta.gotLive = true;
      saveCache();
    }
    emit();
  }

  // ---------- Binance 现货实时推送（公共镜像域名，大陆可直连） ----------
  // BTC: wss://data-stream.binance.vision:443/ws/btcusdt@ticker
  function createPriceStream(cfg) {
    const s = { ws: null, retry: 0, timer: null, stopped: false, lastPushAt: 0 };

    function connect() {
      if (s.stopped || typeof WebSocket === 'undefined') return;
      if (s.ws && (s.ws.readyState === 0 || s.ws.readyState === 1)) return;
      let ws;
      try { ws = new WebSocket(cfg.url); } catch (e) { schedule(); return; }
      s.ws = ws; // 回调用局部 ws 判定归属，避免旧连接误清新引用
      ws.onopen = function () { s.retry = 0; };
      ws.onmessage = function (evt) {
        if (ws !== s.ws) return;
        let d;
        try { d = JSON.parse(evt.data); } catch (e) { return; }
        const price = +d.c, pct = +d.P;
        if (!isValid(price)) return;
        const now = Date.now();
        if (now - s.lastPushAt < 800) return; // 节流，避免极端行情下 DOM 刷新过密
        s.lastPushAt = now;
        cfg.apply({ price: price, pct: isFinite(pct) ? pct : null });
        meta.lastPushAt = now;
        meta.gotLive = true;
        emit();
      };
      ws.onerror = function () { /* 交给 onclose 统一重连 */ };
      ws.onclose = function () {
        if (ws !== s.ws) return;
        s.ws = null;
        if (!s.stopped) schedule();
      };
    }
    function schedule() {
      if (s.stopped || s.timer) return;
      const delay = Math.min(30000, 1000 * Math.pow(2, s.retry++)); // 1s→2s→4s…上限 30s
      s.timer = setTimeout(function () { s.timer = null; connect(); }, delay);
    }
    function stop() {
      s.stopped = true;
      if (s.timer) { clearTimeout(s.timer); s.timer = null; }
      if (s.ws) { try { s.ws.close(); } catch (e) { /* ignore */ } s.ws = null; }
      s.retry = 0;
    }
    function resume() { s.stopped = false; connect(); }
    return { connect, stop, resume, isLive: () => !!s.ws && s.ws.readyState === 1 };
  }

  const btcStream = createPriceStream({
    url: 'wss://data-stream.binance.vision:443/ws/btcusdt@ticker',
    apply: v => { state.crypto.BTC = v; }
  });

  /** 取行情值：返回 {price, pct}；无有效最新价时回退昨收（pct 置空） */
  function getValue(marketId, code) {
    let price = null, pct = null;
    if (marketId === 'crypto') {
      const d = state.crypto[code];
      if (d && isValid(d.price)) { price = d.price; pct = d.pct; }
    } else {
      const d = state.quotes[code];
      const prev = state.closes[code];
      if (d && isValid(d.price)) {
        price = d.price;
        pct = isFinite(d.pct) ? d.pct : (isValid(prev) ? (d.price - prev) / prev * 100 : null);
      } else if (isValid(prev)) {
        price = prev;
      }
    }
    return { price, pct };
  }

  function liveInfo() {
    return {
      live: btcStream.isLive(),
      at: Math.max(meta.lastFetchAt, meta.lastPushAt),
      gotLive: meta.gotLive,
      hasCache: meta.hasCache
    };
  }

  function start() {
    loadCache();
    emit();
    fetchQuotes();
    btcStream.connect();
    setInterval(pollTencentFast, TENCENT_POLL_MS);
    setInterval(fetchQuotes, REST_POLL_MS);
    // iOS 切后台会挂起 WebSocket，回前台主动补连并立即补拉 REST
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        btcStream.stop();
      } else {
        btcStream.resume();
        fetchQuotes();
      }
    });
  }

  THD.quoteCode = quoteCode;
  THD.Quotes = { state, meta, onUpdate, getValue, liveInfo, start, fetchQuotes };
})(self);
