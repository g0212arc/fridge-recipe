/**
 * オフラインでも開けるようにするための Service Worker。
 *
 * ビルドのたびにファイル名が変わるので、事前にリストを持つのではなく
 * 「一度取れたものはキャッシュしておき、次からはそれを見せつつ裏で更新する」
 * 方式（stale-while-revalidate）にしてある。リストがずれて真っ白になる事故が起きない。
 */

const CACHE = 'fridge-recipe-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // トップページだけは先に取っておく（初回オフラインでも開けるように）
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add('./').catch(() => undefined)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    }),
  );
});
