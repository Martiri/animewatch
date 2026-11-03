/**
 * AnimeWatch IT — Service Worker (PWA Offline-Ready & WebAPK Compliant)
 * Strategie:
 * 1) Cache-First per gli asset statici dell'App Shell
 * 2) Network-First con fallback su Cache per Google Sheets API e TMDB API
 * 3) Cache-First con aggiornamento per le locandine TMDB
 */

'use strict';

const STATIC_CACHE = 'animewatch-static-v2';
const API_CACHE = 'animewatch-api-v2';
const IMG_CACHE = 'animewatch-img-v2';

const APP_SHELL_ASSETS = [
  './index.html',
  './style.css',
  './config.js',
  './app.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      // Pre-caching sicuro (se una singola risorsa fallisce, le altre vengono comunque salvate)
      await Promise.allSettled(
        APP_SHELL_ASSETS.map((asset) => cache.add(asset).catch(() => null))
      );
      try {
        await cache.add('./');
      } catch (_) {}
    })
  );
});

self.addEventListener('activate', (event) => {
  const allowedCaches = new Set([STATIC_CACHE, API_CACHE, IMG_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (!allowedCaches.has(key)) {
              return caches.delete(key);
            }
            return null;
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

/**
 * Rimuove token/api_key volatili dalla chiave di cache per Google Sheets in modo che
 * lo snapshot rimanga recuperabile anche quando il token OAuth cambia.
 */
function buildCanonicalApiCacheRequest(request) {
  const url = new URL(request.url);
  if (url.hostname === 'sheets.googleapis.com' || url.hostname === 'docs.google.com') {
    url.searchParams.delete('key');
    url.searchParams.delete('access_token');
    return new Request(url.toString(), { method: 'GET' });
  }
  return request;
}

async function networkFirstWithCacheFallback(request) {
  const cache = await caches.open(API_CACHE);
  const cacheKeyReq = buildCanonicalApiCacheRequest(request);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      cache.put(cacheKeyReq, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cachedResponse = await cache.match(cacheKeyReq);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw err;
  }
}

async function cacheFirstStatic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function cacheFirstImage(request) {
  const cache = await caches.open(IMG_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    return new Response('', { status: 404 });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 1) Network-First con fallback su Cache per Google Sheets e TMDB API
  if (
    url.hostname === 'sheets.googleapis.com' ||
    url.hostname === 'docs.google.com' ||
    url.hostname.endsWith('.googleusercontent.com') ||
    url.hostname === 'api.themoviedb.org'
  ) {
    event.respondWith(networkFirstWithCacheFallback(request));
    return;
  }

  // 2) Locandine TMDB: Cache-First con fallback
  if (url.hostname === 'image.tmdb.org') {
    event.respondWith(cacheFirstImage(request));
    return;
  }

  // 3) Asset statici dello stesso origin: Cache-First
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstStatic(request));
  }
});
