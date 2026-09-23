/**
 * public/sw.js lifecycle under a fake CacheStorage / fetch: install is atomic
 * and isolated in a new digest-named cache; failures leave the active
 * worker's cache untouched; activate deletes old caches.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { cacheNameFor } from '../../src/ui/pwa';

const SW_SOURCE = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8');
const ORIGIN = 'https://x.io';
const SCOPE = `${ORIGIN}/pineapple-run/`;
const V_OLD = 'aaaaaaaaaaaaaaaa';
const V_NEW = 'bbbbbbbbbbbbbbbb';

class FakeCaches {
  stores = new Map<string, Map<string, string>>();
  async open(name: string) {
    let m = this.stores.get(name);
    if (!m) this.stores.set(name, (m = new Map()));
    const store = m;
    return {
      put: async (req: string | { url: string }, res: Response) => {
        store.set(typeof req === 'string' ? req : req.url, await res.text());
      },
      match: async (req: string | { url: string }, opts?: { ignoreSearch?: boolean }) => {
        let key = typeof req === 'string' ? req : req.url;
        if (opts?.ignoreSearch) {
          const u = new URL(key);
          u.search = '';
          key = u.href;
        }
        const body = store.get(key);
        return body === undefined ? undefined : new Response(body);
      },
    };
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  async keys() {
    return [...this.stores.keys()];
  }
  snapshot() {
    return JSON.stringify([...this.stores].map(([k, v]) => [k, [...v]]));
  }
}

type Server = Record<string, { status: number; body: string }>;

function deploy(version: string, opts: { missing?: string; manifestVersion?: string } = {}): Server {
  const assets = [
    'assets/main-AAAAAA.js',
    'assets/page-BBBBBB.js',
    'assets/Box2D.compat-CCCCCC.wasm',
    'assets/ui-DDDDDD.css',
    'index.html',
    'mapbuilder.html',
    'audio-harness.html',
    'manifest.json',
    'icons/icon-192.png',
  ];
  const server: Server = {
    [SCOPE]: { status: 200, body: `<html>${version}</html>` },
    [`${SCOPE}precache-manifest.json`]: { status: 200, body: JSON.stringify({ version: opts.manifestVersion ?? version, assets }) },
  };
  for (const a of assets) server[SCOPE + a] = { status: a === opts.missing ? 404 : 200, body: `${a}@${version}` };
  return server;
}

function loadWorker(version: string, caches: FakeCaches, server: Server, active: string | null = null) {
  const handlers = new Map<string, (e: unknown) => void>();
  const self = {
    location: { href: `${SCOPE}sw.js?v=${version}` },
    registration: { scope: SCOPE, active: active ? { scriptURL: `${SCOPE}sw.js?v=${active}` } : null },
    clients: { claim: async () => {} },
    addEventListener: (t: string, fn: (e: unknown) => void) => handlers.set(t, fn),
  };
  const fetch = async (input: string | { url: string }) => {
    const url = typeof input === 'string' ? input : input.url;
    const r = server[url];
    if (!r) throw new TypeError('network error ' + url);
    return new Response(r.body, { status: r.status });
  };
  runInNewContext(SW_SOURCE, { self, caches, fetch, URL, Response, console });
  const lifecycle = async (type: 'install' | 'activate') => {
    let p: Promise<unknown> = Promise.resolve();
    handlers.get(type)!({ waitUntil: (x: Promise<unknown>) => (p = x) });
    return p;
  };
  /** Dispatch a fetch event; resolves to the response body the worker answered with (null = not handled). */
  const request = async (url: string, mode: 'navigate' | 'no-cors' = 'navigate') => {
    let answer: Promise<Response> | null = null;
    handlers.get('fetch')!({ request: { url, method: 'GET', mode }, respondWith: (r: Promise<Response>) => (answer = r) });
    if (!answer) return null;
    const res = await (answer as Promise<Response>);
    return res.type === 'error' ? 'ERROR' : res.text();
  };
  return { install: () => lifecycle('install'), activate: () => lifecycle('activate'), request };
}

describe('service worker lifecycle (fake CacheStorage)', () => {
  it('install caches the shell + every manifest entry into a cache named by the digest', async () => {
    const caches = new FakeCaches();
    await loadWorker(V_NEW, caches, deploy(V_NEW)).install();
    expect([...caches.stores.keys()]).toEqual([cacheNameFor(V_NEW)]);
    const store = caches.stores.get(cacheNameFor(V_NEW))!;
    expect([...store.keys()].sort()).toEqual(
      [
        SCOPE,
        ...[
          'assets/main-AAAAAA.js',
          'assets/page-BBBBBB.js',
          'assets/Box2D.compat-CCCCCC.wasm',
          'assets/ui-DDDDDD.css',
          'index.html',
          'mapbuilder.html',
          'audio-harness.html',
          'manifest.json',
          'icons/icon-192.png',
        ].map((a) => SCOPE + a),
      ].sort(),
    );
    expect(store.get(SCOPE + 'assets/Box2D.compat-CCCCCC.wasm')).toBe(`assets/Box2D.compat-CCCCCC.wasm@${V_NEW}`);
  });

  it('a failed install (one 404, even a public icon) rejects, removes its own cache, and leaves the active cache untouched', async () => {
    const caches = new FakeCaches();
    await loadWorker(V_OLD, caches, deploy(V_OLD)).install();
    await loadWorker(V_OLD, caches, deploy(V_OLD)).activate();
    const before = caches.snapshot();
    for (const missing of ['icons/icon-192.png', 'assets/Box2D.compat-CCCCCC.wasm', 'mapbuilder.html']) {
      await expect(loadWorker(V_NEW, caches, deploy(V_NEW, { missing }), V_OLD).install()).rejects.toThrow(/404/);
      expect(caches.snapshot()).toBe(before);
      expect(caches.stores.has(cacheNameFor(V_NEW))).toBe(false);
    }
  });

  it('rejects when the fetched manifest is a different deploy than the worker version', async () => {
    const caches = new FakeCaches();
    await expect(loadWorker(V_NEW, caches, deploy(V_NEW, { manifestVersion: 'cccccccccccccccc' })).install()).rejects.toThrow(/precache manifest is/);
    expect(caches.stores.size).toBe(0);
  });

  it('rejects a non-digest version (e.g. an old entry-hash URL)', async () => {
    const caches = new FakeCaches();
    await expect(loadWorker('main-0xaiCj1A', caches, deploy('main-0xaiCj1A')).install()).rejects.toThrow(/bad version/);
    expect(caches.stores.size).toBe(0);
  });

  it('a successful new deploy installs beside the old cache; activate then removes the old one', async () => {
    const caches = new FakeCaches();
    await loadWorker(V_OLD, caches, deploy(V_OLD)).install();
    const nw = loadWorker(V_NEW, caches, deploy(V_NEW), V_OLD);
    await nw.install();
    expect([...caches.stores.keys()].sort()).toEqual([cacheNameFor(V_OLD), cacheNameFor(V_NEW)].sort());
    expect(caches.stores.get(cacheNameFor(V_OLD))!.get(SCOPE + 'assets/main-AAAAAA.js')).toBe(`assets/main-AAAAAA.js@${V_OLD}`);
    caches.stores.set('other-app', new Map());
    await nw.activate();
    expect([...caches.stores.keys()].sort()).toEqual([cacheNameFor(V_NEW), 'other-app'].sort());
  });
});

describe('offline navigation (S6V finding 3)', () => {
  it('serves the precached copy of the requested HTML page, not the game shell', async () => {
    const caches = new FakeCaches();
    const server = deploy(V_NEW);
    const w = loadWorker(V_NEW, caches, server);
    await w.install();
    const stored = caches.stores.get(cacheNameFor(V_NEW))!;
    for (const page of ['index.html', 'mapbuilder.html', 'audio-harness.html']) expect(stored.has(SCOPE + page), page).toBe(true);
    // online: network-first
    expect(await w.request(`${SCOPE}mapbuilder.html`)).toBe(`mapbuilder.html@${V_NEW}`);
    // offline
    for (const k of Object.keys(server)) delete server[k];
    expect(await w.request(`${SCOPE}mapbuilder.html`)).toBe(`mapbuilder.html@${V_NEW}`);
    expect(await w.request(`${SCOPE}audio-harness.html?seed=3`)).toBe(`audio-harness.html@${V_NEW}`);
    expect(await w.request(SCOPE)).toBe(`<html>${V_NEW}</html>`);
    // an in-scope page that was never deployed still gets the shell
    expect(await w.request(`${SCOPE}unknown.html`)).toBe(`<html>${V_NEW}</html>`);
  });
});
