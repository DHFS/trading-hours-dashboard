// ============================================================
// 行情引擎：多源拉取（腾讯 30s 快轮询 / 华尔街见闻 VIX·美债·现货金 / 东财期货与指数兜底 / ETF 估算）+ Binance 现货双币流 + 本地缓存
// 同时采集 MARKETS（9 大市场）与 MACRO_ITEMS（顶部 4 项宏观风向标）
// 依赖：THD.MARKETS、THD.MACRO_ITEMS（data.js）
// ============================================================
(function (root) {
  const THD = root.THD;
  const MARKETS = THD.MARKETS;
  const MACRO_ITEMS = THD.MACRO_ITEMS || [];

  // quotes: 指数/黄金/原油/宏观最新价与涨跌幅（key=内部代码）；closes: 昨收/昨结；crypto: BTC/ETH
  const state = { quotes: {}, closes: {}, crypto: {} };
  const meta = { lastFetchAt: 0, lastPushAt: 0, hasCache: false, gotLive: false };
  const listeners = [];
  const CACHE_KEY = 'thd_quotes_cache_v6';
  const TENCENT_POLL_MS = 30000;
  const REST_POLL_MS = 300000; // NOTE: 东财对高频请求有 IP 级风控，全量兜底轮询保持 5 分钟

  function onUpdate(fn) { listeners.push(fn); }
  function emit() {
    for (const fn of listeners) {
      try { fn(); } catch (e) { console.error('行情回调异常', e); }
    }
  }

  function quoteCode(q) {
    return q.code || (q.secid ? q.secid.split('.')[1] : q.label);
  }

  const isValid = v => isFinite(v) && v > 0;

  // ---------- 本地缓存 ----------
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
    } catch (e) { /* 忽略写入错误 */ }
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

  // 构建全站所有市场 + 宏观指标的数据源映射
  function buildSourceMaps() {
    const tencentMap = {}, tencentHfMap = {}, etfMap = {}, emFutMap = {}, wscnMap = {}, emSecid = {}, emPrec = {}, secids = [];
    const allItems = [];
    for (const m of MARKETS) for (const q of m.quotes) allItems.push(q);
    for (const q of MACRO_ITEMS) allItems.push(q);

    for (const q of allItems) {
      const code = quoteCode(q);
      if (q.tencent) tencentMap[q.tencent] = code;
      if (q.tencentHf) tencentHfMap[q.tencentHf] = code;
      if (q.etf) etfMap[q.etf] = { code: code, base: q.base };
      if (q.emFut) emFutMap[code] = q.emFut;
      if (q.wscn) wscnMap[q.wscn] = code;
      if (q.secid) {
        secids.push(q.secid);
        emPrec[code] = q.prec != null ? q.prec : 2;
      }
      if (q.secid && ['100.N225', '100.KS11', '100.GDAXI', '100.FTSE', '100.UDI', '133.USDCNH', '112.B00Y', '102.CL00Y', '122.XAU', '171.US10Y'].indexOf(q.secid) >= 0) {
        emSecid[q.secid] = code;
      }
    }
    return { tencentMap, tencentHfMap, etfMap, emFutMap, wscnMap, emSecid, emPrec, secids };
  }

  // 1) 腾讯接口批量拉取（A股/港股/恒科/美股 + 外盘原油黄金 + ETF）
  async function fetchTencent(maps, fresh) {
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
          // 腾讯外盘期货/贵金属（hf_OIL/hf_CL/hf_GC/hf_XAU）：逗号分隔，[0]=最新价 [1]=涨跌幅(%) [7]=昨结算价
          const p = mt[2].split(',');
          const price = parseFloat(p[0]), pct = parseFloat(p[1]), prev = parseFloat(p[7]);
          if (isValid(price)) {
            q[hfCode] = { price: price, pct: isFinite(pct) ? pct : null };
            if (fresh) fresh.add(hfCode);
            gotAny = true;
          }
          if (isValid(prev)) c[hfCode] = prev;
        } else {
          // 股票/指数/ETF：~ 分隔，[3]=最新价 [4]=昨收
          const p = mt[2].split('~');
          const price = parseFloat(p[3]), prev = parseFloat(p[4]);
          if (code) {
            if (isValid(price)) {
              q[code] = { price: price };
              if (fresh) fresh.add(code);
              gotAny = true;
            }
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

  // 2) 华尔街见闻 CORS 接口（VIX 恐慌指数主源 + 美债10Y / 伦敦金备源，30 秒同频刷新）
  async function fetchWscn(maps, fresh) {
    const { wscnMap } = maps;
    const keys = Object.keys(wscnMap);
    if (!keys.length) return false;
    let gotAny = false;
    const q = state.quotes, c = state.closes;
    try {
      const r = await fetchWithTimeout('https://api-ddc-wscn.awtmt.com/market/real?prod_code=' + keys.join(',') + '&fields=prod_name,last_px,px_change_rate,preclose_px');
      const j = await r.json();
      const snap = j && j.data && j.data.snapshot;
      if (!snap) return false;
      for (const prod of keys) {
        const code = wscnMap[prod];
        if (fresh && fresh.has(code)) continue;
        const row = snap[prod];
        if (!Array.isArray(row)) continue;
        const price = +row[1];
        const pct = row[2] != null && isFinite(+row[2]) ? +row[2] : null;
        const prev = +row[3];
        if (isValid(price)) {
          q[code] = { price: price, pct: pct };
          if (fresh) fresh.add(code);
          gotAny = true;
        }
        if (isValid(prev)) c[code] = prev;
      }
    } catch (e) {
      console.warn('行情获取失败（华尔街见闻）', e);
    }
    return gotAny;
  }

  async function pollTencentFast() {
    const maps = buildSourceMaps();
    const fresh = new Set();
    const tRes = await fetchTencent(maps, fresh);
    const wGot = await fetchWscn(maps, fresh);
    if (tRes.gotAny || wGot) {
      meta.lastFetchAt = Date.now();
      meta.gotLive = true;
      saveCache();
      emit();
    }
  }

  async function fetchQuotes() {
    const maps = buildSourceMaps();
    const { emFutMap, emSecid, emPrec, secids } = maps;
    const q = state.quotes, c = state.closes;
    const fresh = new Set();

    // 1) 主源：腾讯
    const tRes = await fetchTencent(maps, fresh);
    let gotAny = tRes.gotAny;
    const etfPct = tRes.etfPct;

    // 2) 华尔街见闻：VIX 恐慌指数主源 + 伦敦金/美债10Y 补充
    if (await fetchWscn(maps, fresh)) gotAny = true;

    // 3) 东财期货独立静态接口：补充 A50 / 纳指期货 / 黄金 / 原油
    for (const code of Object.keys(emFutMap)) {
      if (fresh.has(code)) continue;
      try {
        const r = await fetchWithTimeout('https://futsseapi.eastmoney.com/static/' + emFutMap[code]);
        const j = await r.json();
        const qt = j && j.qt;
        if (qt && isValid(+qt.p)) {
          q[code] = { price: +qt.p, pct: typeof qt.zdf === 'number' || (qt.zdf != null && isFinite(+qt.zdf)) ? +qt.zdf : null };
          if (isValid(+qt.zjsj)) c[code] = +qt.zjsj;
          fresh.add(code);
          gotAny = true;
        }
      } catch (e) {
        console.warn('期货行情获取失败（东财静态）', code, e);
      }
    }

    // 4) 东方财富批量接口：欧股 DAX/富时100、美元指数、离岸人民币、美债10Y，以及各指数兜底
    // NOTE: 优先使用配置中的 emPrec（如 US10Y=4, USDCNH=4, GC00Y=1, CN00Y=1），规避接口 f152 偏差
    const ulistHosts = ['https://push2delay.eastmoney.com', 'https://push2.eastmoney.com'];
    for (const host of ulistHosts) {
      try {
        const r = await fetchWithTimeout(host + '/api/qt/ulist.np/get?secids=' + secids.join(',') + '&fields=f2,f3,f18,f12,f14,f152');
        const j = await r.json();
        if (j && j.data && j.data.diff) {
          for (const it of j.data.diff) {
            if (fresh.has(it.f12)) continue;
            const prec = emPrec[it.f12] != null ? emPrec[it.f12] : (it.f152 || 2);
            const scale = Math.pow(10, prec);
            if (!isValid(it.f2 / scale)) continue;
            q[it.f12] = { price: it.f2 / scale, pct: typeof it.f3 === 'number' && isFinite(it.f3) ? it.f3 / 100 : null };
            if (isValid(it.f18 / scale)) c[it.f12] = it.f18 / scale;
            fresh.add(it.f12);
            gotAny = true;
          }
          break;
        }
      } catch (e) {
        console.warn('东财批量行情重试下一节点', host, e);
      }
    }

    // 5) 单标精准接口兜底：stock/get 多域名轮换
    const emHosts = ['https://push2delay.eastmoney.com', 'https://push2his.eastmoney.com', 'https://push2.eastmoney.com'];
    for (const secid of Object.keys(emSecid)) {
      const code = emSecid[secid];
      if (fresh.has(code)) continue;
      for (const host of emHosts) {
        try {
          const r = await fetchWithTimeout(host + '/api/qt/stock/get?secid=' + secid + '&fields=f43,f57,f58,f60,f169,f170,f152');
          const j = await r.json();
          const d = j && j.data;
          if (d && isValid(d.f43)) {
            const prec = Math.pow(10, emPrec[code] != null ? emPrec[code] : (d.f152 || 2));
            q[code] = { price: d.f43 / prec, pct: typeof d.f170 === 'number' && isFinite(d.f170) ? d.f170 / 100 : null };
            if (isValid(d.f60)) c[code] = d.f60 / prec;
            fresh.add(code);
            gotAny = true;
            break;
          }
        } catch (e) { /* 换下一个域名重试 */ }
      }
    }

    // 6) 日经/KOSPI 兜底估算：用 ETF 当日涨跌幅 × 昨收基准估算点位
    for (const m of MARKETS) {
      for (const qq of m.quotes) {
        if (!qq.etf) continue;
        const code = quoteCode(qq);
        if (fresh.has(code)) continue;
        if (etfPct[code] === undefined) continue;
        const prev = isValid(c[code]) ? c[code] : (qq.base || 0);
        if (prev > 0) {
          q[code] = { price: prev * (1 + etfPct[code] / 100), pct: etfPct[code] };
          fresh.add(code);
          gotAny = true;
        }
      }
    }

    // 6) Binance 现货 REST 兜底（BTC + ETH）
    if (!btcStream.isLive()) {
      try {
        const r = await fetchWithTimeout('https://data-api.binance.vision/api/v3/ticker/24hr?symbols=%5B%22BTCUSDT%22%2C%22ETHUSDT%22%5D');
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

  // ---------- Binance 现货双币 WebSocket（公共镜像，大陆可直连） ----------
  function createCryptoStream() {
    const url = 'wss://data-stream.binance.vision:443/stream?streams=btcusdt@ticker/ethusdt@ticker';
    const s = { ws: null, retry: 0, timer: null, stopped: false, lastPushBySym: {} };

    function connect() {
      if (s.stopped || typeof WebSocket === 'undefined') return;
      if (s.ws && (s.ws.readyState === 0 || s.ws.readyState === 1)) return;
      let ws;
      try { ws = new WebSocket(url); } catch (e) { schedule(); return; }
      s.ws = ws;
      ws.onopen = function () { s.retry = 0; };
      ws.onmessage = function (evt) {
        if (ws !== s.ws) return;
        let raw;
        try { raw = JSON.parse(evt.data); } catch (e) { return; }
        const d = raw.data || raw;
        const sym = (d.s || '').replace('USDT', '');
        const price = +d.c, pct = +d.P;
        if (!sym || !isValid(price)) return;
        const now = Date.now();
        if (now - (s.lastPushBySym[sym] || 0) < 800) return;
        s.lastPushBySym[sym] = now;
        state.crypto[sym] = { price: price, pct: isFinite(pct) ? pct : null };
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
      const delay = Math.min(30000, 1000 * Math.pow(2, s.retry++));
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

  const btcStream = createCryptoStream();

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
        pct = typeof d.pct === 'number' && isFinite(d.pct) ? d.pct : (isValid(prev) ? (d.price - prev) / prev * 100 : null);
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
