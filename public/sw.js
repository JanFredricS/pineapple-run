/* Pineapple Run service worker — offline caching.
 *
 * Identity: registered by src/ui/pwa.ts as `sw.js?v=<digest>`, where <digest>
 * is precache-manifest.json's `version` — a content hash over EVERY deployed
 * file (all bundle output, the HTML, every public/ file including this one;
 * see src/ui/precache.ts). Any deploy that changes any byte therefore gets a
 * new worker URL and a new cache named `pineapple-run-<digest>`.
 *
 * Install (atomic, all-or-nothing): fetch precache-manifest.json, check its
 * version equals our ?v= (a deploy landing mid-install rejects; the page
 * registers the newer digest next load), then cache the shell ("./") and
 * every listed file — all hashed assets/ (every JS chunk incl. lazy ones,
 * CSS, the box2d .wasm) and all public files (manifest.json, icons). The
 * install writes ONLY into its own, new digest-named cache; any failure
 * deletes that cache and rejects, leaving the active worker and its cache
 * untouched. Old caches are deleted only on activate.
 *
 * No skipWaiting(): a new worker waits until every tab of the old build is
 * closed, so an open old page never has its caches deleted under it.
 *
 * Fetch strategies:
 *  - navigations: network-first; offline -> this version's precached shell.
 *    The shell is never rewritten at runtime, so it always matches the
 *    assets precached with it.
 *  - content-hashed assets (/assets/name-<hash>.ext): cache-first (a hashed
 *    URL can never be stale); misses are fetched and cached.
 *  - anything else in scope: network-first with cache fallback, no writes
 *    (precached public files stay exactly as installed).
 */

const VERSION = new URL(self.location.href).searchParams.get('v') || '';
const PREFIX = 'pineapple-run-';
const CACHE = PREFIX + VERSION;
const SCOPE = new URL(self.registration.scope);
const HASHED = /\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(?:js|mjs|css|wasm|png|jpe?g|svg|webp|woff2?|json|mp3|ogg|m4a)$/;
const SHELL = SCOPE.href;
const PRECACHE_MANIFEST = new URL('precache-manifest.json', SCOPE).href;

function inScope(url) {
  return url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname);
}

async function putIfOk(cache, request, response) {
  if (response && response.ok && response.type === 'basic') await cache.put(request, response.clone());
  return response;
}

async function cacheStrict(cache, url) {
  // Revalidate un-hashed files so the bytes match this deploy's digest.
  const res = await fetch(url, HASHED.test(new URL(url).pathname) ? undefined : { cache: 'no-cache' });
  if (!res.ok) throw new Error('precache ' + res.status + ' ' + url);
  await cache.put(url, res);
}

/** True when the currently active worker is this same version (shares CACHE). */
function activeIsSameVersion() {
  const a = self.registration.active;
  if (!a) return false;
  try {
    return new URL(a.scriptURL).searchParams.get('v') === VERSION;
  } catch {
    return false;
  }
}

async function precacheAll() {
  if (!/^[0-9a-f]{16}$/.test(VERSION)) throw new Error('sw: bad version ' + VERSION);
  const listRes = await fetch(PRECACHE_MANIFEST, { cache: 'no-cache' });
  if (!listRes.ok) throw new Error('precache manifest ' + listRes.status);
  const list = await listRes.json();
  if (!list || !Array.isArray(list.assets)) throw new Error('precache manifest malformed');
  if (list.version !== VERSION) throw new Error('precache manifest is ' + list.version + ', worker is ' + VERSION);
  const urls = [SHELL];
  for (const p of list.assets) {
    const u = new URL(String(p), SCOPE);
    if (!inScope(u)) throw new Error('precache entry out of scope: ' + p);
    urls.push(u.href);
  }
  const cache = await caches.open(CACHE);
  // allSettled: every write has finished before a failure deletes the cache.
  const results = await Promise.allSettled(urls.map((u) => cacheStrict(cache, u)));
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    precacheAll().catch(async (err) => {
      // Never leave a half-filled cache behind (and never touch a cache an
      // active worker of the same version is serving from).
      if (!activeIsSameVersion()) await caches.delete(CACHE);
      throw err;
    }),
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!inScope(url)) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          const cache = await caches.open(CACHE);
          return (await cache.match(SHELL)) || Response.error();
        }
      })(),
    );
    return;
  }

  if (HASHED.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        return putIfOk(cache, req, await fetch(req));
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      try {
        return await fetch(req);
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match(req, { ignoreSearch: true })) || Response.error();
      }
    })(),
  );
});
