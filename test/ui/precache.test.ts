import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import { buildPrecacheManifest, PRECACHE_MANIFEST_FILE, precacheEntries, type PrecacheManifest } from '../../src/ui/precache';

describe('precacheEntries (pure)', () => {
  it('lists every chunk and asset under assets/, incl. .wasm; skips html, maps, public files', () => {
    const bundle = {
      'index.html': { type: 'asset' as const, fileName: 'index.html' },
      'assets/main-AAAAAA.js': { type: 'chunk' as const, fileName: 'assets/main-AAAAAA.js' },
      'assets/page-BBBBBB.js': { type: 'chunk' as const, fileName: 'assets/page-BBBBBB.js' },
      'assets/page-BBBBBB.js.map': { type: 'asset' as const, fileName: 'assets/page-BBBBBB.js.map' },
      'assets/ui-CCCCCC.css': { type: 'asset' as const, fileName: 'assets/ui-CCCCCC.css' },
      'assets/Box2D.compat-DDDDDD.wasm': { type: 'asset' as const, fileName: 'assets/Box2D.compat-DDDDDD.wasm' },
    };
    expect(precacheEntries(bundle)).toEqual([
      'assets/Box2D.compat-DDDDDD.wasm',
      'assets/main-AAAAAA.js',
      'assets/page-BBBBBB.js',
      'assets/ui-CCCCCC.css',
    ]);
    const a = buildPrecacheManifest(bundle);
    expect(buildPrecacheManifest(bundle).version).toBe(a.version);
    expect(buildPrecacheManifest({ ...bundle, 'assets/x-EEEEEE.js': { type: 'chunk', fileName: 'assets/x-EEEEEE.js' } }).version).not.toBe(a.version);
  });
});

describe('production build emits a complete precache manifest', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'pr-precache-'));
  afterAll(() => rmSync(outDir, { recursive: true, force: true }));

  it('lists the .wasm and every emitted chunk/asset in dist/assets', async () => {
    await build({ logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    const manifest = JSON.parse(readFileSync(join(outDir, PRECACHE_MANIFEST_FILE), 'utf8')) as PrecacheManifest;
    const onDisk = readdirSync(join(outDir, 'assets'))
      .filter((f) => !f.endsWith('.map'))
      .map((f) => `assets/${f}`)
      .sort();
    expect(manifest.assets).toEqual(onDisk);
    expect(manifest.assets.some((f) => /\.wasm$/.test(f))).toBe(true);
    const chunks = onDisk.filter((f) => f.endsWith('.js'));
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(manifest.assets).toContain(c);
    // lazy chunks the first page load never fetches are included
    expect(manifest.assets.some((f) => /\/page-[\w-]+\.js$/.test(f))).toBe(true);
    expect(manifest.assets.some((f) => /\/appScreens-[\w-]+\.js$/.test(f))).toBe(true);
  });
});
