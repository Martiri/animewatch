/**
 * AnimeWatch IT — Service Worker (PWA Offline-Ready & WebAPK Compliant)
 * Version: v3 (POCO F7 / Xiaomi HyperOS & Chrome Android 14/15)
 */

'use strict';

const STATIC_CACHE = 'animewatch-static-v4';
const API_CACHE = 'animewatch-api-v4';
const IMG_CACHE = 'animewatch-img-v4';

const APP_SHELL_ASSETS = [
  './',
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
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    throw err;
  }
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

  // 1) Requisito Tassativo Chrome PWA: Intercettazione Navigazione Offline (start_url 200 OK)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put('./index.html', clone));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(STATIC_CACHE);
          return (
            (await cache.match('./index.html')) ||
            (await cache.match('./')) ||
            (await cache.match('index.html'))
          );
        })
    );
    return;
  }

  const url = new URL(request.url);

  // 2) Google Sheets e TMDB API: Network-First con fallback su cache
  if (
    url.hostname === 'sheets.googleapis.com' ||
    url.hostname === 'docs.google.com' ||
    url.hostname.endsWith('.googleusercontent.com') ||
    url.hostname === 'api.themoviedb.org'
  ) {
    event.respondWith(networkFirstWithCacheFallback(request));
    return;
  }

  // 3) Locandine TMDB: Cache-First
  if (url.hostname === 'image.tmdb.org') {
    event.respondWith(cacheFirstImage(request));
    return;
  }

  // 4) Asset statici dell'App Shell: Cache-First
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstStatic(request));
  }
});
