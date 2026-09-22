/* Pineapple Run service worker — offline shell caching.
 *
 * Registered by src/ui/pwa.ts as `sw.js?v=<entry-chunk-hash>`; a new build
 * means a new SW URL, a new install and a new cache (CACHE below).
 *
 * Strategies:
 *  - navigations (HTML): network-first, cached shell as offline fallback, so
 *    an online player always gets the newest index.html (and thus the newest
 *    hashed asset URLs).
 *  - content-hashed build assets (/assets/name-<hash>.ext, incl. .wasm):
 *    cache-first. The hash is in the URL, so a cached copy can never be a
 *    stale version of that URL — a new WASM build has a new URL.
 *  - anything else same-origin (manifest, icons, un-hashed files): network-
 *    first with cache fallback, so un-hashed files are never served stale
 *    while online.
 *
 * No skipWaiting(): a new worker waits until every tab of the old build is
 * closed, so an open old page never has its caches deleted under it (its
 * lazy chunks / WASM would otherwise 404 after a redeploy).
 */

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const PREFIX = 'pineapple-run-';
const CACHE = PREFIX + VERSION;
const SCOPE = new URL(self.registration.scope);
const HASHED = /\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(?:js|mjs|css|wasm|png|jpe?g|svg|webp|woff2?|json|mp3|ogg|m4a)$/;

const SHELL = ['./', 'manifest.json', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'].map(
  (p) => new URL(p, SCOPE).href,
);

function inScope(url) {
  return url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname);
}

async function putIfOk(cache, request, response) {
  if (response && response.ok && response.type === 'basic') await cache.put(request, response.clone());
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        SHELL.map((u) =>
          fetch(u, { cache: 'no-cache' })
            .then((r) => putIfOk(cache, u, r))
            .catch(() => {}),
        ),
      );
      // Precache the hashed assets the shell references (entry JS/CSS).
      try {
        const html = await (await fetch(SCOPE.href, { cache: 'no-cache' })).text();
        const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
          .map((m) => new URL(m[1], SCOPE))
          .filter((u) => inScope(u) && HASHED.test(u.pathname));
        await Promise.all(refs.map((u) => fetch(u).then((r) => putIfOk(cache, u.href, r)).catch(() => {})));
      } catch {
        /* offline during install: runtime caching fills in later */
      }
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'cache-urls' || !Array.isArray(data.urls)) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const raw of data.urls.slice(0, 500)) {
        let u;
        try {
          u = new URL(String(raw));
        } catch {
          continue;
        }
        if (!inScope(u) || !HASHED.test(u.pathname)) continue;
        if (await cache.match(u.href)) continue;
        await fetch(u.href)
          .then((r) => putIfOk(cache, u.href, r))
          .catch(() => {});
      }
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!inScope(url)) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await fetch(req);
          // Only the game shell is cached; other pages (harness, tools) pass through.
          if (url.pathname === SCOPE.pathname || url.pathname === SCOPE.pathname + 'index.html') {
            await putIfOk(cache, SCOPE.href, res);
          }
          return res;
        } catch {
          return (await cache.match(SCOPE.href)) || Response.error();
        }
      })(),
    );
    return;
  }

  if (HASHED.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(req, { ignoreSearch: false });
        if (hit) return hit;
        const cache = await caches.open(CACHE);
        return putIfOk(cache, req, await fetch(req));
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        return await putIfOk(cache, req, await fetch(req));
      } catch {
        return (await cache.match(req)) || Response.error();
      }
    })(),
  );
});
