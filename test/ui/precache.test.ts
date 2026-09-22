import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import {
  buildPrecacheManifest,
  PRECACHE_MANIFEST_FILE,
  precacheEntries,
  readPublicDir,
  type BundleEntryLike,
  type PrecacheManifest,
} from '../../src/ui/precache';

const bundle = (): Record<string, BundleEntryLike> => ({
  'index.html': { type: 'asset', fileName: 'index.html', source: '<html>v1</html>' },
  'assets/main-AAAAAA.js': { type: 'chunk', fileName: 'assets/main-AAAAAA.js', code: 'main()' },
  'assets/page-BBBBBB.js': { type: 'chunk', fileName: 'assets/page-BBBBBB.js', code: 'page()' },
  'assets/page-BBBBBB.js.map': { type: 'asset', fileName: 'assets/page-BBBBBB.js.map', source: '{}' },
  'assets/ui-CCCCCC.css': { type: 'asset', fileName: 'assets/ui-CCCCCC.css', source: 'a{}' },
  'assets/Box2D.compat-DDDDDD.wasm': { type: 'asset', fileName: 'assets/Box2D.compat-DDDDDD.wasm', source: new Uint8Array([0, 97, 115, 109]) },
});
const pub = () => [
  { path: 'manifest.json', content: '{"name":"x"}' },
  { path: 'icons/icon-192.png', content: new Uint8Array([1, 2, 3]) },
  { path: 'sw.js', content: '/* sw v1 */' },
];

describe('precache manifest (pure)', () => {
  it('assets/: every chunk and asset incl. .wasm; skips html and maps', () => {
    expect(precacheEntries(bundle())).toEqual([
      'assets/Box2D.compat-DDDDDD.wasm',
      'assets/main-AAAAAA.js',
      'assets/page-BBBBBB.js',
      'assets/ui-CCCCCC.css',
    ]);
  });

  it('public files ARE included (manifest.json, icons); the worker itself is not', () => {
    const m = buildPrecacheManifest(bundle(), pub());
    expect(m.assets).toContain('manifest.json');
    expect(m.assets).toContain('icons/icon-192.png');
    expect(m.assets).not.toContain('sw.js');
    expect(m.assets).toContain('assets/Box2D.compat-DDDDDD.wasm');
    expect(m.version).toMatch(/^[0-9a-f]{16}$/);
  });

  it('version is a content digest over every deployed file', () => {
    const base = buildPrecacheManifest(bundle(), pub()).version;
    expect(buildPrecacheManifest(bundle(), pub()).version).toBe(base); // deterministic
    const variants: [string, Record<string, BundleEntryLike>, ReturnType<typeof pub>][] = [];
    // CSS-only deploy: same file name, new bytes (main entry chunk unchanged)
    const css = bundle();
    css['assets/ui-CCCCCC.css'] = { ...css['assets/ui-CCCCCC.css']!, source: 'a{color:red}' };
    variants.push(['css bytes', css, pub()]);
    const html = bundle();
    html['index.html'] = { ...html['index.html']!, source: '<html>v2</html>' };
    variants.push(['html', html, pub()]);
    variants.push(['icon bytes (public only)', bundle(), pub().map((f) => (f.path.startsWith('icons/') ? { ...f, content: new Uint8Array([9]) } : f))]);
    variants.push(['sw.js only', bundle(), pub().map((f) => (f.path === 'sw.js' ? { ...f, content: '/* sw v2 */' } : f))]);
    variants.push(['new public file', bundle(), [...pub(), { path: 'icons/new.png', content: 'n' }]]);
    const wasm = bundle();
    wasm['assets/Box2D.compat-DDDDDD.wasm'] = { ...wasm['assets/Box2D.compat-DDDDDD.wasm']!, source: new Uint8Array([0, 97, 115, 110]) };
    variants.push(['wasm bytes', wasm, pub()]);
    for (const [name, b, p] of variants) expect(buildPrecacheManifest(b, p).version, name).not.toBe(base);
  });
});

function walk(root: string, dir = root): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(root, p) : [relative(root, p).split(sep).join('/')];
  });
}

describe('production build emits a complete precache manifest', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'pr-precache-'));
  afterAll(() => rmSync(outDir, { recursive: true, force: true }));

  it('lists every dist asset + public file (not sw.js), and the digest covers every emitted file', async () => {
    await build({ logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    const manifest = JSON.parse(readFileSync(join(outDir, PRECACHE_MANIFEST_FILE), 'utf8')) as PrecacheManifest;
    const all = walk(outDir);
    const publicFiles = readPublicDir(join(process.cwd(), 'public'));
    const publicPaths = new Set(publicFiles.map((f) => f.path));

    const expected = all
      .filter((f) => (f.startsWith('assets/') || publicPaths.has(f)) && f !== 'sw.js' && !f.endsWith('.map'))
      .sort();
    expect(manifest.assets).toEqual(expected);
    expect(manifest.assets.some((f) => /\.wasm$/.test(f))).toBe(true);
    expect(manifest.assets).toEqual(expect.arrayContaining(['manifest.json', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png']));
    expect(manifest.assets).not.toContain('sw.js');
    const chunks = all.filter((f) => f.startsWith('assets/') && f.endsWith('.js'));
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(manifest.assets).toContain(c);
    expect(manifest.assets.some((f) => /\/page-[\w-]+\.js$/.test(f))).toBe(true); // lazy chunk

    // Recompute the digest from what actually landed on disk: proves it covers
    // every emitted file (HTML pages included) plus every public file.
    const onDiskBundle: Record<string, BundleEntryLike> = {};
    for (const f of all) {
      if (publicPaths.has(f) || f === PRECACHE_MANIFEST_FILE) continue;
      const bytes = readFileSync(join(outDir, f));
      onDiskBundle[f] = f.endsWith('.js') ? { type: 'chunk', fileName: f, code: bytes.toString('utf8') } : { type: 'asset', fileName: f, source: bytes };
    }
    expect(Object.keys(onDiskBundle)).toEqual(expect.arrayContaining(['index.html', 'ui-harness.html']));
    // String vs Buffer of the same text hash identically.
    expect(buildPrecacheManifest(onDiskBundle, publicFiles).version).toBe(manifest.version);
  });
});
