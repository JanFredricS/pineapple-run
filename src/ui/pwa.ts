/**
 * Service-worker registration (production builds only).
 *
 * Cache versioning is keyed to the build: the version is the hashed file
 * name of the entry module (`assets/index-<hash>.js`). Any change anywhere in
 * the build changes some chunk hash, which changes the entry's import graph
 * and so its hash; the SW URL (`sw.js?v=<version>`) then differs, the browser
 * installs a fresh worker with a fresh cache, and old caches are deleted on
 * activation. See public/sw.js for the fetch strategies (and why hashed WASM
 * can't go stale).
 */

/** Pure: derive the cache version from the entry script URL. */
export function buildVersionFrom(entryUrl: string | null | undefined): string {
  if (!entryUrl) return 'dev';
  const file = entryUrl.split(/[?#]/)[0]!.split('/').pop() ?? '';
  const m = /-([A-Za-z0-9_-]{6,})\.js$/.exec(file);
  return m ? m[1]! : 'dev';
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const entry = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
  const version = buildVersionFrom(entry);
  if (version === 'dev') return;
  const base = import.meta.env.BASE_URL;
  const register = () => {
    navigator.serviceWorker
      .register(`${base}sw.js?v=${encodeURIComponent(version)}`, { scope: base })
      .then(async () => {
        // Cache what this page already loaded (lazy chunks, WASM) so the
        // first visit is enough to play offline next time.
        const reg = await navigator.serviceWorker.ready;
        const urls = performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((u) => u.startsWith(location.origin + base));
        reg.active?.postMessage({ type: 'cache-urls', urls });
      })
      .catch((err: unknown) => console.warn('Service worker registration failed', err));
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
