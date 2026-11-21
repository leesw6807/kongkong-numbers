/* 숫자 친구 콩콩이 — service worker
   파일을 수정하면 CACHE_VERSION을 반드시 올린다. (CLAUDE.md 작업 방식) */
const CACHE_VERSION = 28;
const CACHE_NAME = `kongkong-v${CACHE_VERSION}`;

// 오프라인 동작에 필요한 모든 파일 (상대경로)
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/main.js',
  './js/audio.js',
  './js/effects.js',
  './js/assets.js',
  './js/lines.js',
  './js/settings.js',
  './js/parent.js',
  './js/play.js',
  './js/progress.js',
  './js/celebrate.js',
  './js/grapes.js',
  './js/buddy.js',
  './js/usage.js',
  './js/games/common.js',
  './js/games/count.js',
  './js/games/choose.js',
  './js/games/basket.js',
  './js/games/compare.js',
  './js/games/stones.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/images/friends/tino.svg',
  './assets/images/friends/bureung.svg',
  './assets/images/friends/elephant.svg',
  './assets/images/friends/train.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('kongkong-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// 캐시 우선: 오프라인에서도 항상 동작. 업데이트는 CACHE_VERSION 변경으로 반영.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // 개발용 화면과 문서(.md)는 캐시하지 않는다 (항상 최신 파일로 확인)
  if (url.pathname.includes('/dev/') || url.pathname.endsWith('.md')) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          if (req.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
    })
  );
});
