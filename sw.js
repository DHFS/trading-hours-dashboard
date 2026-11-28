/* 交易时段看板 Service Worker
 * 策略：同源静态资源「网络优先」，保证每次打开都拿到最新版本；
 * 网络失败时回退缓存，保证弱网/离线仍可用。
 * 目的：破解 iOS 主屏 PWA 把旧 index.html/CSS/JS 锁死在缓存里、改版不生效的问题。
 */
const CACHE_NAME = 'thd-v0.12.1';
const CORE = [
  './', './index.html', './manifest.json',
  './css/tokens.css', './css/dashboard.css', './css/float-clock.css',
  './js/data.js', './js/market-time.js', './js/quotes.js', './js/float-engine.js',
  './js/ui-dashboard.js', './js/ui-clock.js', './js/main.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (c) { return c.addAll(CORE); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  // 只接管同源静态资源；行情 API / 字体等跨域请求直接放行
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(function (c) { c.put(req, clone); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
