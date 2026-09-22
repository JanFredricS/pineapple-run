import { describe, expect, it } from 'vitest';
import { LevelChunkSource, type TerrainChunk } from '../../src/terrain/chunks';
import { ProceduralChunkSource } from '../../src/terrain/generator';
import {
  chunkRangeForWindow,
  DEFAULT_STREAMING,
  planStreaming,
  retentionWindow,
  type StreamingConfig,
} from '../../src/terrain/streaming';

import { zigZagComb } from './profiles';

const cfg: StreamingConfig = { chunkWidth: 40, behind: 30, ahead: 90, hysteresis: 20, maxChunks: 256 };
const endless = { firstChunk: 0, lastChunk: Infinity };

describe('retention window', () => {
  it('spans min live body - behind .. max live body + ahead, ignoring non-finite x', () => {
    expect(retentionWindow([100, 20, 60, NaN, Infinity], cfg)).toEqual({ min: -10, max: 190 });
    expect(retentionWindow([], cfg)).toBeNull();
    expect(retentionWindow([NaN], cfg)).toBeNull();
  });

  it('maps to chunk indices clipped to the source bounds', () => {
    expect(chunkRangeForWindow({ min: -10, max: 190 }, 40, endless)).toEqual({ from: 0, to: 4 });
    expect(chunkRangeForWindow({ min: 85, max: 190 }, 40, { firstChunk: 0, lastChunk: 3 })).toEqual({ from: 2, to: 3 });
  });
});

describe('planStreaming', () => {
  it('retains overhanging owners in capped per-body windows and applies extent hysteresis', () => {
    const source = new LevelChunkSource({ spans: [
      { id: 'uncut', points: zigZagComb(38, 165, 10, 10.004) }, // owner 0, ends at 195
      { id: 'far', points: [{ x: 10000, y: 10 }, { x: 10030, y: 10 }] },
    ], friction: 0.9, restitution: 0 });
    const capped = { ...cfg, maxChunks: 1 };
    const first = planStreaming([], [150, 10010], source, capped);
    expect(first.keep).toContain(0);
    expect(first.keep).toContain(250);
    expect(first.keep).not.toContain(100); // no fill between the bodies
    expect(first.keep.length).toBeLessThan(12);
    const held = planStreaming(first.keep, [230, 10010], source, capped);
    expect(held.keep).toContain(0); // 230-30-20 < 195: inside hysteresis only
    expect(planStreaming([], [230, 10010], source, capped).keep).not.toContain(0);
    const released = planStreaming(held.keep, [246, 10010], source, capped);
    expect(released.destroy).toContain(0); // 246-30-20 > 195
    expect(released.keep).not.toContain(0);
    expect(planStreaming([], [150, 10010], source, capped).create).toContain(0);
  });

  it('loads the window around ALL live bodies, including a trailing pineapple', () => {
    const cartOnly = planStreaming([], [500], endless, cfg);
    expect(cartOnly.create).toEqual([11, 12, 13, 14]); // [470, 590]
    const withStraggler = planStreaming([], [500, 300], endless, cfg);
    expect(withStraggler.create[0]).toBe(6); // 300 - 30 = 270 -> chunk 6
    expect(withStraggler.create.at(-1)).toBe(14);
    expect(withStraggler.create).toHaveLength(9);
  });

  it('keeps a straggler’s chunks while the cart drives on; drops them once it is gone', () => {
    let loaded = planStreaming([], [500, 300], endless, cfg).keep;
    const moved = planStreaming(loaded, [900, 300], endless, cfg);
    expect(moved.destroy).toEqual([]);
    expect(moved.keep).toContain(6);
    loaded = moved.keep;
    const lost = planStreaming(loaded, [900], endless, cfg); // pineapple reported lost
    expect(lost.destroy[0]).toBe(6);
    expect(lost.keep[0]).toBe(21); // 900 - 30 - 20 hysteresis = 850 -> chunk 21
  });

  it('applies hysteresis so a body jittering on a boundary does not thrash', () => {
    let loaded = planStreaming([], [100], endless, cfg).keep; // [70, 190] -> 1..4
    expect(loaded).toEqual([1, 2, 3, 4]);
    for (const x of [111, 109, 111, 109, 112]) {
      const p = planStreaming(loaded, [x], endless, cfg);
      expect(p.destroy).toEqual([]);
      loaded = p.keep;
    }
  });

  it('is a no-op with no live bodies', () => {
    expect(planStreaming([3, 1, 2], [], endless, cfg)).toEqual({ keep: [1, 2, 3], create: [], destroy: [] });
  });

  it('audit S3-1 #2: past maxChunks the empty middle is dropped, never a live body’s terrain', () => {
    const capped = { ...cfg, maxChunks: 10 };
    const p = planStreaming([], [0, 1e9], endless, capped);
    // pineapple at 0: [-30, 90] -> chunks 0..2 (clipped at firstChunk 0); cart at 1e9: its own window
    const cartFrom = Math.floor((1e9 - 30) / 40);
    const cartTo = Math.floor((1e9 + 90) / 40);
    const expected = [0, 1, 2];
    for (let k = cartFrom; k <= cartTo; k++) expected.push(k);
    expect(p.create).toEqual(expected);
    // a straggler behind the cart, cart drives on far past the cap: straggler keeps its chunks
    let loaded = planStreaming([], [5000, 4000], endless, capped).keep;
    for (let x = 5000; x <= 20000; x += 13) {
      const q = planStreaming(loaded, [x, 4000], endless, capped);
      for (const k of q.destroy) expect(k === 99 || k === 100 || k === 101 || k === 102).toBe(false);
      loaded = q.keep;
      for (const k of [99, 100, 101, 102]) expect(loaded).toContain(k); // [3970, 4090] -> 99..102
      expect(loaded.length).toBeLessThan(10 + 12); // bounded, not proportional to distance
    }
    // straggler reported lost -> its chunks go
    const gone = planStreaming(loaded, [20000], endless, capped);
    expect(gone.destroy).toEqual(expect.arrayContaining([99, 100, 101, 102]));
  });

  it('keeps every live body’s neighbourhood loaded for many bodies, spreads and caps (random)', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const maxChunks of [1, 3, 10, 256]) {
      let loaded: number[] = [];
      for (let i = 0; i < 400; i++) {
        const n = 1 + Math.floor(rand() * 5);
        const xs = Array.from({ length: n }, () => rand() * 30000 * rand());
        const c = { ...cfg, maxChunks };
        const p = planStreaming(loaded, xs, endless, c);
        loaded = p.keep;
        for (const x of xs) {
          const r = chunkRangeForWindow({ min: x - c.behind, max: x + c.ahead }, 40, endless);
          for (let k = r.from; k <= r.to; k++) expect(loaded).toContain(k);
        }
        const win = retentionWindow(xs, c)!;
        const full = chunkRangeForWindow(win, 40, endless);
        if (full.to - full.from + 1 <= maxChunks) for (let k = full.from; k <= full.to; k++) expect(loaded).toContain(k);
      }
    }
  });

  it('never creates a chunk twice or destroys an unloaded one (random walk)', () => {
    let loaded: number[] = [];
    let x = 50;
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 2000; i++) {
      x = Math.max(0, x + (rand() - 0.45) * 30);
      const bodies = [x, x - rand() * 80];
      const p = planStreaming(loaded, bodies, endless, DEFAULT_STREAMING);
      for (const k of p.create) expect(loaded).not.toContain(k);
      for (const k of p.destroy) expect(loaded).toContain(k);
      loaded = p.keep;
      const win = retentionWindow(bodies, DEFAULT_STREAMING)!;
      const need = chunkRangeForWindow(win, 40, endless);
      for (let k = need.from; k <= need.to; k++) expect(loaded).toContain(k);
    }
  });
});

describe('reverse-then-forward regeneration', () => {
  it('drive out 2 km, back to the start, and out again: every chunk is recreated identically', () => {
    const src = new ProceduralChunkSource('reverse-test');
    const firstSeen = new Map<number, string>();
    let recreated = 0;
    let loaded: number[] = [];
    const visit = (x: number) => {
      const p = planStreaming(loaded, [x], src, DEFAULT_STREAMING);
      for (const k of p.create) {
        const json = JSON.stringify(src.chunk(k) satisfies TerrainChunk);
        const prev = firstSeen.get(k);
        if (prev === undefined) firstSeen.set(k, json);
        else {
          expect(json).toBe(prev);
          recreated++;
        }
      }
      loaded = p.keep;
    };
    for (let x = 0; x <= 2000; x += 7) visit(x);
    for (let x = 2000; x >= 0; x -= 7) visit(x);
    for (let x = 0; x <= 2000; x += 7) visit(x);
    expect(recreated).toBeGreaterThan(90);
    // and a brand-new source for the same seed agrees too
    const fresh = new ProceduralChunkSource('reverse-test');
    for (const [k, json] of firstSeen) expect(JSON.stringify(fresh.chunk(k))).toBe(json);
  });
});
