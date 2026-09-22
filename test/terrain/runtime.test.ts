/**
 * Streaming runtime against the real physics wrapper (box2d3-wasm, headless).
 */
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../src/model/geometry';
import type { TerrainDef } from '../../src/model/level';
import { PhysicsWorld } from '../../src/physics/engine';
import { LevelChunkSource, type ChunkLifecycleListener, type ReadonlyTerrainChunk } from '../../src/terrain/chunks';
import { ProceduralChunkSource } from '../../src/terrain/generator';
import { TerrainStreamer } from '../../src/terrain/runtime';

const terrainOf = (...spans: Vec2[][]): TerrainDef => ({
  spans: spans.map((points, i) => ({ id: `s${i}`, points })),
  friction: 0.9,
  restitution: 0,
});

function ball(w: PhysicsWorld, x: number, y: number, vx = 0) {
  const b = w.createBody({ type: 'dynamic', position: { x, y }, linearVelocity: { x: vx, y: 0 }, bullet: true });
  w.addCircle(b, { x: 0, y: 0 }, 0.4, { friction: 0.9, restitution: 0 });
  return b;
}

class Recorder implements ChunkLifecycleListener {
  events: string[] = [];
  live = new Map<number, ReadonlyTerrainChunk>();
  chunkCreated(chunk: ReadonlyTerrainChunk, body: number) {
    this.events.push(`+${chunk.index}`);
    expect(this.live.has(chunk.index)).toBe(false);
    this.live.set(chunk.index, chunk);
    expect(body).toBeGreaterThan(0);
  }
  chunkDestroyed(index: number) {
    this.events.push(`-${index}`);
    expect(this.live.delete(index)).toBe(true);
  }
}

describe('TerrainStreamer', () => {
  it('creates/destroys chunk bodies following live bodies and mirrors every change to listeners', async () => {
    const w = await PhysicsWorld.create();
    const src = new ProceduralChunkSource(7);
    const t = new TerrainStreamer(w, src);
    const rec = new Recorder();
    t.addListener(rec);

    const p1 = t.update([10]);
    expect(p1.create).toEqual([0, 1, 2]);
    expect(t.loadedChunks()).toEqual([0, 1, 2]);
    expect(rec.events).toEqual(['+0', '+1', '+2']);
    const terrainBodies = w.manifest().bodies.filter((b) => b.role === 'terrain');
    expect(terrainBodies).toHaveLength(3);
    const firstManifest = JSON.stringify(terrainBodies.find((b) => b.id === t.bodyOf(1))!.shapes);

    rec.events = [];
    t.update([400]); // cart drove on, nothing live behind
    expect(rec.events.filter((e) => e.startsWith('-'))).toEqual(['-0', '-1', '-2']);
    expect(rec.events.indexOf('-2')).toBeLessThan(rec.events.indexOf('+9')); // destroys first
    expect([...rec.live.keys()].sort((a, b) => a - b)).toEqual(t.loadedChunks());
    expect(w.manifest().bodies.filter((b) => b.role === 'terrain')).toHaveLength(t.loadedChunks().length);

    t.update([10]); // reverse all the way back
    const again = w.manifest().bodies.find((b) => b.id === t.bodyOf(1))!;
    expect(JSON.stringify(again.shapes)).toBe(firstManifest); // identical regeneration
    expect([...rec.live.keys()].sort((a, b) => a - b)).toEqual(t.loadedChunks());

    t.destroyAll();
    expect(rec.live.size).toBe(0);
    expect(w.manifest().bodies.filter((b) => b.role === 'terrain')).toHaveLength(0);
    w.destroy();
  });

  it('loadAll loads a finite level and refuses an endless one', async () => {
    const w = await PhysicsWorld.create();
    const src = new LevelChunkSource(terrainOf([{ x: -50, y: 10 }, { x: 130, y: 10 }]));
    const t = new TerrainStreamer(w, src);
    t.loadAll();
    expect(t.loadedChunks()).toEqual([-2, -1, 0, 1, 2, 3]);
    expect(() => new TerrainStreamer(w, new ProceduralChunkSource(1)).loadAll()).toThrow(/unbounded/);
    w.destroy();
  });

  it('audit S3-1 #3: loadAll on far-apart spans creates bodies only for occupied chunks; empty chunks get none', async () => {
    const w = await PhysicsWorld.create();
    const src = new LevelChunkSource(
      terrainOf(
        [{ x: -1_000_000, y: 10 }, { x: -999_990, y: 10 }],
        [{ x: 1_000_000, y: 10 }, { x: 1_000_010, y: 10 }],
      ),
    );
    expect(src.lastChunk - src.firstChunk).toBeGreaterThan(49_000);
    expect(src.occupiedChunks()).toEqual([-25_000, 25_000]);
    const t = new TerrainStreamer(w, src);
    const rec = new Recorder();
    t.addListener(rec);
    t.loadAll();
    expect(t.loadedChunks()).toEqual([-25_000, 25_000]);
    expect(w.manifest().bodies.filter((b) => b.role === 'terrain')).toHaveLength(2);
    // streaming through empty chunks: loaded (not re-requested) but no body, never announced
    rec.events = [];
    t.update([0]);
    expect(t.isLoaded(0)).toBe(true);
    expect(t.bodyOf(0)).toBeUndefined();
    expect(rec.events.filter((e) => e.startsWith('+'))).toEqual([]);
    expect(t.update([0]).create).toEqual([]);
    expect(w.manifest().bodies.filter((b) => b.role === 'terrain')).toHaveLength(0); // far chunks released
    expect(t.loadedChunkData()).toEqual([]);
    t.destroyAll();
    expect(t.loadedChunks()).toEqual([]);
    w.destroy();
  });

  it('audit S3-1 #4: listeners get one deep-frozen chunk; mutation throws and cannot desync physics', async () => {
    const w = await PhysicsWorld.create();
    const t = new TerrainStreamer(w, new ProceduralChunkSource(3));
    const seen: ReadonlyTerrainChunk[] = [];
    t.addListener({ chunkCreated: (c) => seen.push(c), chunkDestroyed: () => {} });
    t.update([10]);
    const c = seen[0]!;
    expect(Object.isFrozen(c) && Object.isFrozen(c.pieces) && Object.isFrozen(c.pieces[0]) && Object.isFrozen(c.pieces[0]![0])).toBe(true);
    expect(Object.isFrozen(c.extent)).toBe(true);
    const y0 = c.pieces[0]![0]!.y;
    expect(() => {
      (c.pieces[0]![0] as { y: number }).y = 999;
    }).toThrow(TypeError);
    expect(() => {
      (c as { index: number }).index = 42;
    }).toThrow(TypeError);
    expect(c.pieces[0]![0]!.y).toBe(y0);
    // late subscribers see the same (unmodified) object
    expect(t.loadedChunkData()[0]!.chunk).toBe(c);
    w.destroy();
  });

  it('chunk seams are invisible to physics: bodies cross bends that sit exactly on chunk boundaries as on one chain', async () => {
    // Bends exactly at x = 40 and x = 80 (the chunk boundaries): concave, convex, and a near-flat kink.
    // (A naive cut AT those vertices lets the engine's extrapolated ghost disagree with the real
    // neighbour; on the convex case that measurably changes a sliding box's path.)
    const profiles: Vec2[][] = [
      [{ x: -5, y: 10 }, { x: 40, y: 10 }, { x: 80, y: 6 }, { x: 150, y: 6 }],
      [{ x: -5, y: 10 }, { x: 40, y: 10 }, { x: 80, y: 12 }, { x: 150, y: 12 }],
      [{ x: -5, y: 8 }, { x: 40, y: 10.25 }, { x: 80, y: 10.25 }, { x: 150, y: 13 }],
    ];
    const run = async (pts: Vec2[], chunked: boolean, body: 'box' | 'ball') => {
      const w = await PhysicsWorld.create();
      const mat = { friction: 0.2, restitution: 0 };
      if (chunked) new TerrainStreamer(w, new LevelChunkSource({ spans: [{ id: 'a', points: pts }], ...mat })).loadAll();
      else w.addChain(w.createBody({ type: 'static', position: { x: 0, y: 0 }, role: 'terrain' }), pts, mat);
      let b: number;
      if (body === 'ball') b = ball(w, 34, pts[1]!.y - 1, 8);
      else {
        b = w.createBody({ type: 'dynamic', position: { x: 34, y: pts[1]!.y - 0.8 }, linearVelocity: { x: 12, y: 0 } });
        w.addPolygon(b, [{ x: -1, y: -0.5 }, { x: 1, y: -0.5 }, { x: 1, y: 0.5 }, { x: -1, y: 0.5 }], mat);
      }
      const trace: { x: number; y: number; angle: number }[] = [];
      for (let i = 0; i < 400; i++) {
        w.step();
        trace.push(w.getTransform(b));
      }
      w.destroy();
      return trace;
    };
    for (const pts of profiles) {
      for (const body of ['box', 'ball'] as const) {
        const one = await run(pts, false, body);
        const many = await run(pts, true, body);
        expect(one.at(-1)!.x).toBeGreaterThan(45); // crossed the first seam at least
        let worst = 0;
        for (let i = 0; i < one.length; i++) {
          worst = Math.max(worst, Math.hypot(one[i]!.x - many[i]!.x, one[i]!.y - many[i]!.y), Math.abs(one[i]!.angle - many[i]!.angle));
        }
        expect(worst).toBeLessThan(0.005);
      }
    }
  });

  it('gaps are real holes: a ball over the gap falls through, one beside it does not', async () => {
    const w = await PhysicsWorld.create();
    const t = new TerrainStreamer(
      w,
      new LevelChunkSource(
        terrainOf(
          [
            { x: 0, y: 10 },
            { x: 38, y: 10 },
          ],
          [
            { x: 41, y: 10 },
            { x: 90, y: 10 },
          ],
        ),
      ),
    );
    t.loadAll();
    const over = ball(w, 39.5, 8);
    const beside = ball(w, 36, 8);
    for (let i = 0; i < 120; i++) w.step();
    expect(w.getTransform(over).y).toBeGreaterThan(14);
    expect(w.getTransform(beside).y).toBeCloseTo(9.6, 1);
    w.destroy();
  });
});
