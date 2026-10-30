/**
 * Service Worker · 离线缓存与版本升级
 *
 * 设计要点：
 *  1. 缓存名带构建版本号（mark6-nst-<BUILD_ID>），与同域其它工具（Pick-3-out-of-3、lottery-tool）完全隔离。
 *  2. 应用外壳（HTML / JS / CSS / manifest）走「网络优先 + 缓存兜底」，追加 sw=<BUILD_ID> 绕开 HTTP 缓存。
 *  3. 开奖底库（data/draws.js|json）走「缓存优先 + 后台更新」，带 `_r=` 参数时强制走网络。
 *  4. BUILD_ID 必须与 src/constants.js 的 APP_BUILD、index.html 的 ?v= 参数一致，由单测自动校验。
 */

const BUILD_ID = '2026.10.30-r1';
const CACHE_PREFIX = 'mark6-nst-';
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;

/** 需要离线可用的应用外壳文件（相对路径，兼容 GitHub Pages 子目录部署） */
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/styles.css',
  './assets/icon.svg',
  './src/constants.js',
  './src/combinatorics.js',
  './src/parser.js',
  './src/strategy.js',
  './src/dailyfive.js',
  './src/statistics.js',
  './src/storage.js',
  './src/sync.js',
  './src/copy.js',
  './src/audit.js',
  './src/periods.js',
  './src/app.js',
  './data/draws.js',
  './data/draws.json'
];

const DATA_FILES = ['./data/draws.js', './data/draws.json'];

function normalizePath(pathname) {
  if (pathname.endsWith('/index.html')) return pathname.slice(0, -'index.html'.length);
  return pathname;
}

function resolvePath(relative) {
  const url = new URL(relative, self.location.href);
  return normalizePath(url.pathname);
}

const SHELL_PATHS = new Set([
  ...SHELL_FILES.map(resolvePath),
  ...DATA_FILES.map(resolvePath)
]);

const DATA_PATH_SET = new Set(DATA_FILES.map(resolvePath));

function cacheKeyFor(url) {
  return `${url.origin}${normalizePath(url.pathname)}`;
}

function bustedUrl(url) {
  const u = new URL(url.toString());
  u.searchParams.set('sw', BUILD_ID);
  return u.toString();
}

const NETWORK_OPTS = { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } };

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(
        SHELL_FILES.map(async (file) => {
          try {
            const url = new URL(file, self.location.href);
            const res = await fetch(bustedUrl(url), NETWORK_OPTS);
            if (!res || !res.ok) return;
            await cache.put(cacheKeyFor(url), res.clone());
          } catch {
            /* 单个资源失败忽略，运行时仍有网络兜底 */
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k.startsWith(CACHE_PREFIX))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'GET_VERSION') {
    const reply = { type: 'VERSION', build: BUILD_ID, cache: CACHE_NAME };
    if (event.source) event.source.postMessage(reply);
    else if (event.ports && event.ports[0]) event.ports[0].postMessage(reply);
    return;
  }
  if (data.type === 'CLEAR_CACHES') {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k)));
        const reply = { type: 'CACHES_CLEARED' };
        if (event.source) event.source.postMessage(reply);
      })()
    );
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const path = normalizePath(url.pathname);
  const key = cacheKeyFor(url);

  if (DATA_PATH_SET.has(path)) {
    const forceNetwork = url.searchParams.has('_r');
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(key);
        const network = fetch(bustedUrl(url), NETWORK_OPTS)
          .then((res) => {
            if (res && res.ok) cache.put(key, res.clone());
            return res;
          })
          .catch(() => null);
        if (forceNetwork) {
          const fresh = await network;
          if (fresh) return fresh;
          if (cached) return cached;
          return new Response('离线且无本地缓存', { status: 503, statusText: 'offline' });
        }
        if (cached) {
          network.catch(() => {});
          return cached;
        }
        const fresh = await network;
        return fresh || new Response('离线且无本地缓存', { status: 503, statusText: 'offline' });
      })()
    );
    return;
  }

  if (SHELL_PATHS.has(path)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const res = await fetch(bustedUrl(url), NETWORK_OPTS);
          if (res && res.ok) {
            cache.put(key, res.clone());
          }
          return res;
        } catch {
          const cached = await cache.match(key);
          if (cached) return cached;
          return new Response(
            `离线且没有缓存副本（构建 ${BUILD_ID}）。请联网后刷新，或点击页面上的「修复缓存」。`,
            { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } }
          );
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        network.catch(() => {});
        return cached;
      }
      const fresh = await network;
      return fresh || new Response('', { status: 504, statusText: 'offline' });
    })()
  );
});
