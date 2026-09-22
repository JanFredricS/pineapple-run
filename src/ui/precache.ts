/**
 * Build-time precache manifest for the service worker (public/sw.js).
 *
 * `precachePlugin()` (wired in vite.config.ts) emits `precache-manifest.json`
 * next to index.html at the end of generateBundle, listing EVERY file the
 * bundle wrote under `assets/` — entry and lazy JS chunks, CSS, and emitted
 * assets such as box2d's .wasm — so the SW can cache the complete asset graph
 * at install and the game works offline after the first visit, even for code
 * the first session never loaded (e.g. the run screen or the WASM).
 *
 * Pure apart from the Vite hook; `precacheEntries` is unit-tested.
 */

import type { Plugin } from 'vite';

export const PRECACHE_MANIFEST_FILE = 'precache-manifest.json';

export interface PrecacheManifest {
  /** Stable digest of the asset list (changes whenever any hashed file does). */
  version: string;
  /** Paths relative to the app base (e.g. "assets/main-AbC123.js"). */
  assets: string[];
}

/** Minimal shape of a Rolldown/Rollup output bundle entry. */
export interface BundleEntryLike {
  type: 'chunk' | 'asset';
  fileName: string;
}

/** Every emitted file under assets/ (chunks + assets incl. .wasm), sorted, deduped. */
export function precacheEntries(bundle: Record<string, BundleEntryLike>): string[] {
  const out = new Set<string>();
  for (const [key, entry] of Object.entries(bundle)) {
    const file = (entry.fileName || key).replace(/^\/+/, '');
    if (!file.startsWith('assets/')) continue;
    if (file.endsWith('.map')) continue;
    out.add(file);
  }
  return [...out].sort();
}

/** FNV-1a over the sorted list: deterministic, dependency-free. */
function digest(list: string[]): string {
  let h = 0x811c9dc5;
  for (const ch of list.join('\n')) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function buildPrecacheManifest(bundle: Record<string, BundleEntryLike>): PrecacheManifest {
  const assets = precacheEntries(bundle);
  return { version: digest(assets), assets };
}

export function precachePlugin(): Plugin {
  return {
    name: 'pineapple-run:precache-manifest',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const manifest = buildPrecacheManifest(bundle as unknown as Record<string, BundleEntryLike>);
        this.emitFile({ type: 'asset', fileName: PRECACHE_MANIFEST_FILE, source: JSON.stringify(manifest, null, 1) });
      },
    },
  };
}
