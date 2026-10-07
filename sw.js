/*
 * 한민고 학생 시간표 — 서비스 워커.
 *
 * 앱 껍데기(index·app.js·app.css·아이콘)는 기기에 두고 누르자마자 띄운다.
 * 자료(data/*.json)는 늘 새로 받고, 망이 안 되면 기기에 둔 마지막 것을 쓴다 —
 * 수업 변경은 몇 분 단위로 바뀌므로 오래된 것을 먼저 보여 주면 안 된다.
 *
 * VERSION 은 index.html 의 ?v= 와 app.js 의 VERSION 과 같은 값이다. 올리면 새 워커가
 * 설치되고, 앱은 «새 버전이 있어요»를 띄운 뒤 학생이 누를 때 갈아 끼운다.
 */
const VERSION = '20261007-v6';
const CACHE = `tt-${VERSION}`;
const SHELL = [
  './',
  `app.js?v=${VERSION}`,
  `app.css?v=${VERSION}`,
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];
/* 자료를 기다리는 한도 — 넘으면 기기에 둔 것을 먼저 쓴다. */
const DATA_TIMEOUT = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('tt-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

/* 앱이 «새로 고침»을 누르면 기다리던 워커가 바로 자리를 잡는다. */
self.addEventListener('message', (event) => {
  if (event.data === 'skip') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;     // 구글 로그인·창구는 건드리지 않는다
  if (url.pathname.includes('/data/')) { event.respondWith(fresh(req)); return; }
  if (req.mode === 'navigate') { event.respondWith(shellFirst(req, './')); return; }
  event.respondWith(shellFirst(req));
});

/* 자료 — 새로 받고, 늦거나 끊기면 기기에 둔 것. */
async function fresh(req) {
  const cache = await caches.open(CACHE);
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  const fallback = new Promise((resolve) => {
    setTimeout(async () => resolve(await cache.match(req, { ignoreSearch: true })), DATA_TIMEOUT);
  });
  try {
    const res = await Promise.race([network, fallback.then((hit) => hit || network)]);
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    return hit || Response.error();
  }
}

/* 껍데기 — 기기에 둔 것을 먼저, 없으면 받아서 둔다. */
async function shellFirst(req, key) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(key || req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && !key) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match('./')) || Response.error();
  }
}
