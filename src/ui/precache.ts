/**
 * Build-time precache manifest for the service worker (public/sw.js).
 *
 * `precachePlugin()` (wired in vite.config.ts) emits `precache-manifest.json`
 * next to index.html at the end of generateBundle:
 *
 *  - `assets`: EVERY file the SW must cache at install besides the shell
 *    ("./"): all bundle output under `assets/` (entry + lazy JS chunks, CSS,
 *    box2d's .wasm, ...) AND every public/ file (manifest.json, icons, ...)
 *    except the worker itself. Install is all-or-nothing over this list.
 *  - `version`: a content digest (sha-256) over EVERY emitted file: bundle
 *    output including the HTML pages, plus every public/ file including
 *    sw.js. Any change to any deployed byte changes it. src/ui/pwa.ts
 *    registers `sw.js?v=<version>` and sw.js names its cache
 *    `pineapple-run-<version>`, so every deploy gets a new worker installing
 *    into a new, never-shared cache (atomic: old caches are only deleted on
 *    activate).
 *
 * Node-only (build time); never imported by browser code. The pure parts are
 * unit-tested.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

export const PRECACHE_MANIFEST_FILE = 'precache-manifest.json';
/** Public files that are served but never precached (the worker itself). */
export const PRECACHE_EXCLUDED_PUBLIC = ['sw.js'];

export interface PrecacheManifest {
  /** Content digest of the whole deploy; drives sw.js?v= and the cache name. */
  version: string;
  /** Paths relative to the app base (e.g. "assets/main-AbC123.js", "icons/icon-192.png"). */
  assets: string[];
}

/** Minimal shape of a Rolldown/Rollup output bundle entry. */
export interface BundleEntryLike {
  type: 'chunk' | 'asset';
  fileName: string;
  code?: string;
  source?: string | Uint8Array;
}

export interface PublicFile {
  /** Path relative to the public dir, posix separators. */
  path: string;
  content: string | Uint8Array;
}

const sha = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

/** Every emitted bundle file under assets/ (chunks + assets incl. .wasm). */
export function precacheEntries(bundle: Record<string, BundleEntryLike>): string[] {
  const out = new Set<string>();
  for (const [key, entry] of Object.entries(bundle)) {
    const file = (entry.fileName || key).replace(/^\/+/, '');
    if (!file.startsWith('assets/') || file.endsWith('.map')) continue;
    out.add(file);
  }
  return [...out].sort();
}

/**
 * Pure: the manifest for a bundle + the public files. `assets` = bundle
 * assets/ files + public files (minus the worker); `version` = digest over
 * the path and content of every emitted file (bundle incl. HTML, public incl.
 * the worker).
 */
export function buildPrecacheManifest(bundle: Record<string, BundleEntryLike>, publicFiles: PublicFile[] = []): PrecacheManifest {
  const pub = publicFiles
    .map((f) => ({ ...f, path: f.path.replace(/^\/+/, '') }))
    .filter((f) => f.path !== PRECACHE_MANIFEST_FILE);
  const assets = [
    ...new Set([
      ...precacheEntries(bundle),
      ...pub.map((f) => f.path).filter((p) => !PRECACHE_EXCLUDED_PUBLIC.includes(p) && !p.endsWith('.map')),
    ]),
  ].sort();

  const parts: string[] = [];
  for (const [key, e] of Object.entries(bundle)) {
    const file = (e.fileName || key).replace(/^\/+/, '');
    if (file === PRECACHE_MANIFEST_FILE) continue;
    parts.push(`${file}\0${sha(e.type === 'chunk' ? (e.code ?? '') : (e.source ?? ''))}`);
  }
  for (const f of pub) parts.push(`public:${f.path}\0${sha(f.content)}`);
  parts.sort();
  return { version: sha(parts.join('\n')).slice(0, 16), assets };
}

/** Recursively read a directory (public/) into PublicFile entries. */
export function readPublicDir(dir: string): PublicFile[] {
  const out: PublicFile[] = [];
  const walk = (d: string) => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names.sort()) {
      if (n.startsWith('.')) continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.push({ path: relative(dir, p).split(sep).join('/'), content: readFileSync(p) });
    }
  };
  walk(dir);
  return out;
}

export function precachePlugin(): Plugin {
  let publicDir = '';
  return {
    name: 'pineapple-run:precache-manifest',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const manifest = buildPrecacheManifest(
          bundle as unknown as Record<string, BundleEntryLike>,
          publicDir ? readPublicDir(publicDir) : [],
        );
        this.emitFile({ type: 'asset', fileName: PRECACHE_MANIFEST_FILE, source: JSON.stringify(manifest, null, 1) });
      },
    },
  };
}
