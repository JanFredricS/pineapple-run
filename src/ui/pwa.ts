/**
 * Service-worker registration (production builds only).
 *
 * Worker identity is the deploy's content digest: `precache-manifest.json`
 * (generated at build time by src/ui/precache.ts) carries a `version` hashed
 * over every deployed file. We register `sw.js?v=<version>`; sw.js uses the
 * same value for its cache name. Any change to any deployed byte (JS, CSS,
 * WASM, HTML, icons, the worker) => new worker URL => fresh install into a
 * new cache, old caches deleted on activate. See public/sw.js.
 *
 * The manifest is fetched with `cache: 'no-cache'`; offline (or through an
 * active worker's fallback) it yields the installed version, so registration
 * is a no-op and the installed worker keeps serving.
 */

export const PRECACHE_MANIFEST_PATH = 'precache-manifest.json';

/** Pure: the manifest's version if well-formed (16 lowercase hex chars). */
export function manifestVersion(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const v = (json as { version?: unknown }).version;
  return typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? v : null;
}

/** Pure: worker script URL for a base path and manifest version. */
export function workerUrl(base: string, version: string): string {
  return `${base}sw.js?v=${encodeURIComponent(version)}`;
}

/** Pure: the cache name sw.js derives from the same version (kept in sync with public/sw.js). */
export function cacheNameFor(version: string): string {
  return `pineapple-run-${version}`;
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL;
  const register = async () => {
    try {
      const res = await fetch(`${base}${PRECACHE_MANIFEST_PATH}`, { cache: 'no-cache' });
      const version = res.ok ? manifestVersion(await res.json()) : null;
      if (!version) return;
      await navigator.serviceWorker.register(workerUrl(base, version), { scope: base });
    } catch (err) {
      console.warn('Service worker registration skipped', err);
    }
  };
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register(), { once: true });
}
