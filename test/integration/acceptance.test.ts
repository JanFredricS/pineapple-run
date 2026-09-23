/**
 * S6 acceptance tests: the real run flow, headless. Every run goes through
 * RunSession (the same object the browser run screen drives): real S1
 * RunController + S3 terrain streaming + validated shipped levels.
 */
import { describe, expect, it } from 'vitest';
import { exampleCart } from '../../src/builder/exampleCart';
import { CartStore, type StorageLike as CartStorageLike } from '../../src/builder/storage';
import { courseFor, levelById } from '../../src/game/courses';
import { RunSession } from '../../src/game/session';
import type { CartDesign } from '../../src/model/cart';
import type { RunEvent } from '../../src/model/runEvents';
import { efficiencyRating, TOTAL_PINEAPPLES } from '../../src/model/score';
import { chunkIndexAt, LevelChunkSource, surfaceYAt, type ReadonlyTerrainChunk } from '../../src/terrain/chunks';
import { isUnlocked } from '../../src/ui/catalog';
import { buildResults, type LevelResults } from '../../src/ui/resultsModel';
import { ScoreStore } from '../../src/ui/scoreStore';
import { PREMADE } from '../../tools/levels/premade';
import { GAP_WALL_LEAN } from '../../tools/levels/track';
import { plateauRange } from '../../src/game/startArea';
import { census } from '../../tools/levels/census';
import type { PaceNote } from '../../tools/levels/track';
import { FLOOR_IT, ORIGINAL_EXPERT_LINE, paceDrive, runWithPace, targetSpeed } from './driver';

const LEVELS = ['beach', 'kitchen', 'workbench'] as const;
const pace = (id: (typeof LEVELS)[number]) => PREMADE[id]().pace;

async function session(design: CartDesign, levelId: string): Promise<RunSession> {
  const c = courseFor(levelId);
  if (!c) throw new Error(`no course ${levelId}`);
  return RunSession.create(design, c);
}

/** Two cubes held together only by shocks (test/physics/springCart.test.ts). */
function twoBoxSpringCart(): CartDesign {
  return {
    version: 1,
    parts: [
      { id: 'L', kind: 'cube', center: { x: 90, y: 0 }, width: 180, height: 30, angle: 0 },
      { id: 'w1', kind: 'wheel', center: { x: 20, y: 0 }, radius: 22 },
      { id: 'w2', kind: 'wheel', center: { x: 160, y: 0 }, radius: 22 },
      { id: 'U', kind: 'cube', center: { x: 90, y: -80 }, width: 120, height: 30, angle: 0 },
      { id: 's1', kind: 'shock', a: { x: 70, y: -80 }, b: { x: 70, y: 0 } },
      { id: 's2', kind: 'shock', a: { x: 110, y: -80 }, b: { x: 110, y: 0 } },
    ],
  };
}

/** A cart that catches nothing: a tiny block (wheel pinned inside it) well left of the funnel. */
function noBedCart(): CartDesign {
  return {
    version: 1,
    parts: [
      { id: 'b', kind: 'cube', center: { x: 0, y: -30 }, width: 40, height: 20, angle: 0 },
      { id: 'w', kind: 'wheel', center: { x: 0, y: -30 }, radius: 12 },
    ],
  };
}

class MemStorage implements CartStorageLike {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

/** Scripted run: settle, release, then a fixed drive script; returns every event + the chassis trace. */
function scripted(s: RunSession, drive: (step: number) => -1 | 0 | 1, steps: number): { events: RunEvent[]; trace: number[] } {
  const events: RunEvent[] = [];
  s.on((e) => events.push(e));
  const trace: number[] = [];
  s.start();
  for (let i = 0; i < 30; i++) s.step();
  s.release();
  for (let i = 0; i < steps; i++) {
    s.setDrive(drive(i));
    s.step();
    if (i % 30 === 0) {
      const h = s.controller.cart.bodies.get(s.controller.chassisId);
      if (h !== undefined && s.world.hasBody(h)) {
        const t = s.world.getTransform(h);
        trace.push(t.x, t.y, t.angle);
      }
    }
  }
  return { events, trace };
}

describe('example cart completes every premade level (pace-note scripted driver)', () => {
  for (const id of LEVELS) {
    it(`${id}: goalReached with pineapples delivered and a non-zero rating`, async () => {
      const s = await session(exampleCart(), id);
      try {
        runWithPace(s, pace(id));
        const last = s.events.at(-1)!;
        expect(last.type).toBe('goalReached');
        if (last.type !== 'goalReached') return;
        expect(last.delivered).toBeGreaterThan(0);
        expect(efficiencyRating(last.simTime, last.delivered)).toBeGreaterThan(0);
        expect(s.controller.cartLost).toBe(false);
      } finally {
        s.destroy();
      }
    }, 60_000);
  }
});

describe('S6T: pacing beats flooring it (every premade level)', () => {
  // The pace notes are a skilled line: fast, braking for the level's
  // hazards (beach: the dune jump; kitchen: the gaps/stairs; workbench: the
  // saw-horse jump). Holding → the whole way must score clearly less.
  const rated = (s: RunSession) => {
    const last = s.events.at(-1)!;
    return last.type === 'goalReached' ? { rating: efficiencyRating(last.simTime, last.delivered), delivered: last.delivered } : { rating: 0, delivered: 0 };
  };
  for (const id of LEVELS) {
    it(`${id}: the pace-note line out-scores holding → by >= 5 points`, async () => {
      const a = await session(exampleCart(), id);
      const b = await session(exampleCart(), id);
      try {
        runWithPace(a, pace(id));
        runWithPace(b, FLOOR_IT);
        const paced = rated(a);
        const floored = rated(b);
        expect(paced.delivered).toBe(TOTAL_PINEAPPLES);
        expect(floored.delivered).toBeLessThan(TOTAL_PINEAPPLES);
        expect(paced.rating - floored.rating, `paced ${paced.rating} vs floored ${floored.rating}`).toBeGreaterThanOrEqual(5);
      } finally {
        a.destroy();
        b.destroy();
      }
    }, 60_000);
  }
});

describe('S6T audit-1 #4: every premade level has a risk/reward shortcut (PLAN S6)', () => {
  // The shortcut is the pool (tools/levels/premade.ts `pool`): the census
  // finds it in the geometry (tools/levels/census.ts SHORTCUT); here the pace
  // driver proves it. The skilled line (the pace notes) jumps it; the
  // careful line brakes to SAFE_SPEED 20 m before it and stays careful to
  // the goal. Measured (example cart), jump vs careful: beach 2.05 s vs
  // 4.62 s through the pool, rating 89 vs 85; kitchen 2.17 vs 5.13 s, 92 vs
  // 87; workbench 2.02 vs 4.92 s, 88 vs 82 — all 15/15.
  const SAFE_SPEED = 5;
  interface Line {
    delivered: number;
    rating: number;
    /** Chassis time from the pool's start to its end (s). */
    section: number;
    /** Lowest wheel centre over the pool floor, relative to the floor (m; 0 = floor level, negative = above). */
    deepest: number;
  }
  const drive = async (id: (typeof LEVELS)[number], line: readonly PaceNote[]): Promise<Line> => {
    const a = PREMADE[id]();
    const pool = a.features.find((f) => f.kind === 'shortcut')!;
    const floor = a.features.find((f) => f.kind === 'washboard' && f.x0 >= pool.x0 && f.x1 <= pool.x1)!;
    const floorY = Math.max(...a.level.terrain.spans.flatMap((sp) => sp.points.filter((q) => q.x >= floor.x0 && q.x <= floor.x1).map((q) => q.y)));
    const s = await session(exampleCart(), id);
    try {
      s.start();
      for (let i = 0; i < 60; i++) s.step();
      s.release();
      for (let i = 0; i < 180; i++) s.step();
      const c = s.controller;
      let tIn = -1;
      let tOut = -1;
      let deepest = -Infinity;
      for (let n = 0; c.phase !== 'ended' && n < 150 * 60; n++) {
        s.setDrive(paceDrive(s, line));
        s.step();
        const h = c.cart.bodies.get(c.chassisId);
        if (h === undefined || !s.world.hasBody(h)) continue;
        const x = s.world.getTransform(h).x;
        if (tIn < 0 && x >= pool.x0) tIn = s.simTime();
        if (tOut < 0 && x >= pool.x1) tOut = s.simTime();
        for (const w of c.cart.wheelBodies) {
          if (!s.world.hasBody(w)) continue;
          const p = s.world.getTransform(w);
          if (p.x >= floor.x0 && p.x <= floor.x1) deepest = Math.max(deepest, p.y - floorY);
        }
      }
      const last = s.events.at(-1)!;
      expect(last.type).toBe('goalReached');
      if (last.type !== 'goalReached') throw new Error('no goal');
      return { delivered: last.delivered, rating: efficiencyRating(last.simTime, last.delivered), section: tOut - tIn, deepest };
    } finally {
      s.destroy();
    }
  };

  for (const id of LEVELS) {
    it(`${id}: the jump is taken by the skilled line and is faster; the careful detour through the pool is viable`, async () => {
      const a = PREMADE[id]();
      const pool = a.features.find((f) => f.kind === 'shortcut')!;
      // the census finds exactly this shortcut in the geometry
      const c = census(a.level, { x0: plateauRange(a.level.cartStart).maxX, x1: a.level.goal.lineX }, (x) => targetSpeed(a.pace, x));
      expect(c.shortcuts).toHaveLength(1);
      expect(c.shortcuts[0]!.lipX).toBeGreaterThan(pool.x0);
      expect(c.shortcuts[0]!.landX).toBeLessThan(pool.x1);

      const brake = pool.x0 - 20;
      const careful: PaceNote[] = [...a.pace.filter((n) => n.x < brake), { x: brake, speed: SAFE_SPEED }];
      const jump = await drive(id, a.pace);
      const safe = await drive(id, careful);
      // the skilled line flies over the floor (its wheels never get within 2 m of it)
      expect(jump.deepest).toBeLessThan(-2);
      expect(jump.delivered).toBe(TOTAL_PINEAPPLES);
      // the careful line rolls down onto the floor (wheel centres ~1 wheel radius above it) and out, keeping every pineapple
      expect(safe.deepest).toBeGreaterThan(-1.5);
      expect(safe.delivered).toBe(TOTAL_PINEAPPLES);
      // and the jump is genuinely faster: >= 2 s through the pool, a better rating
      expect(safe.section - jump.section, `jump ${jump.section.toFixed(2)} s vs careful ${safe.section.toFixed(2)} s`).toBeGreaterThanOrEqual(2);
      expect(jump.rating - safe.rating, `jump ${jump.rating} vs careful ${safe.rating}`).toBeGreaterThanOrEqual(3);
    }, 60_000);
  }
});

describe('S6T #6: the original course (bonus, expert) is clearable', () => {
  // The reference line delivers 10/15 (deterministic). Nearby lines (the
  // 6 m/s switch anywhere in 185–215 m, 6.5 m/s from 200–215 m) deliver 10,
  // so the bar is 9. The cruise speed is the knife edge: 9.3, 10.0 and 10.1
  // m/s finish; 9.0–9.25, 9.9 and 10.05 get stuck (measured; see driver.ts).
  // S8a moved the cruise from 9 to 9.3 m/s (real shock limits + 0.3
  // pineapple–wheel friction; 9 m/s now sticks at ~94 m).
  const variants = [
    ORIGINAL_EXPERT_LINE,
    [{ x: 0, speed: 9.3 }, { x: 185, speed: 6 }],
    [{ x: 0, speed: 9.3 }, { x: 215, speed: 6.5 }],
    [{ x: 0, speed: 9.3 }, { x: 200, speed: 6.5 }],
  ];
  for (const line of variants) {
    it(`the expert line ${line.map((n) => `${n.x}:${n.speed}`).join(' ')} reaches the goal with the example cart and >= 9 delivered`, async () => {
      const s = await session(exampleCart(), 'original');
      try {
        runWithPace(s, line);
        const last = s.events.at(-1)!;
        expect(last.type).toBe('goalReached');
        if (last.type !== 'goalReached') return;
        expect(last.delivered).toBeGreaterThanOrEqual(9);
        if (line === ORIGINAL_EXPERT_LINE) expect(last.delivered).toBe(10);
      } finally {
        s.destroy();
      }
    }, 60_000);
  }
});

describe('scoring boundaries through the real results model', () => {
  const store = () => new ScoreStore(null);
  const results = (st: ScoreStore, levelId: string, outcome: RunEvent | null) => buildResults({ levelId, outcome }, st) as LevelResults;

  it('0 delivered scores 0 and does not clear the course', () => {
    const st = store();
    const r = results(st, 'beach', { type: 'goalReached', simTime: 20, delivered: 0 });
    expect(r.rating.rating).toBe(0);
    expect(r.nextUnlocked).toBe(false);
    expect(isUnlocked(st.load(), 'kitchen')).toBe(false);
  });

  it('15/15 within par scores 100 and unlocks the next course', () => {
    const st = store();
    const r = results(st, 'beach', { type: 'goalReached', simTime: 15, delivered: TOTAL_PINEAPPLES });
    expect(r.rating.rating).toBe(100);
    expect(r.nextUnlocked).toBe(true);
  });

  it('over 115 s scores 0 even with 15/15 delivered', () => {
    const st = store();
    expect(results(st, 'beach', { type: 'goalReached', simTime: 115, delivered: 15 }).rating.rating).toBe(0);
    expect(results(st, 'beach', { type: 'goalReached', simTime: 115.5, delivered: 15 }).rating.rating).toBe(0);
    expect(results(st, 'beach', { type: 'goalReached', simTime: 114, delivered: 15 }).rating.rating).toBe(1);
  });

  it('give up scores 0 and records nothing', () => {
    const st = store();
    const r = results(st, 'beach', { type: 'gaveUp', simTime: 5 });
    expect(r.gaveUp).toBe(true);
    expect(r.rating.rating).toBe(0);
    expect(st.levelBest('beach')).toBeUndefined();
  });

  it('a real beach run records a best and unlocks kitchen; clearing all four campaign courses unlocks the original', async () => {
    // S9: Zero-G Tiki Bar joined the campaign after workbench (was: "clearing all three")
    const st = store();
    for (const id of [...LEVELS, 'tikibar'] as const) {
      if (id === 'tikibar') expect(isUnlocked(st.load(), 'original')).toBe(false);
      const s = await session(exampleCart(), id);
      runWithPace(s, PREMADE[id]().pace);
      const r = results(st, id, s.events.at(-1)!);
      s.destroy();
      expect(r.rating.rating).toBeGreaterThan(0);
      expect(r.saved).toBe(false); // memory-only store
      if (id !== 'tikibar') expect(r.nextUnlocked).toBe(true);
    }
    expect(isUnlocked(st.load(), 'original')).toBe(true);
  }, 120_000);
});

describe('retry and save/reload determinism', () => {
  const drive = (i: number): -1 | 0 | 1 => (i < 240 ? 1 : i < 300 ? 0 : i < 330 ? -1 : 1);

  it('retry fully resets: two runs with identical inputs give identical event streams and poses', async () => {
    const a = await session(exampleCart(), 'kitchen');
    const ra = scripted(a, drive, 900);
    a.destroy();
    const b = await session(exampleCart(), 'kitchen');
    const rb = scripted(b, drive, 900);
    b.destroy();
    expect(ra.events.length).toBeGreaterThan(2);
    expect(rb.events).toEqual(ra.events);
    expect(rb.trace).toEqual(ra.trace);
  }, 60_000);

  it('save -> reload -> rerun gives an identical run', async () => {
    const store = new CartStore(new MemStorage());
    const saved = store.save('My Cart', exampleCart());
    expect(saved.ok).toBe(true);
    const loaded = store.load('My Cart');
    if (!loaded.ok) throw new Error(loaded.error.message);
    const a = await session(exampleCart(), 'beach');
    const ra = scripted(a, drive, 900);
    a.destroy();
    const b = await session(loaded.value, 'beach');
    const rb = scripted(b, drive, 900);
    b.destroy();
    expect(rb.events).toEqual(ra.events);
    expect(rb.trace).toEqual(ra.trace);
  }, 60_000);
});

describe('gap levels have no invisible bridges', () => {
  for (const id of ['kitchen', 'workbench'] as const) {
    it(`${id}: nothing solid anywhere inside each gap`, async () => {
      const a = PREMADE[id]();
      const gaps = a.features.filter((f) => f.kind === 'gap');
      expect(gaps.length).toBeGreaterThan(0);
      const level = levelById(id)!;
      const src = new LevelChunkSource(level.terrain);
      const s = await session(exampleCart(), id);
      try {
        for (const g of gaps) {
          // the side walls (S6T #1) lean GAP_WALL_LEAN into the hole; the landing bevel starts at x1 - 0.35
          const x0 = g.x0 + GAP_WALL_LEAN + 0.05;
          const x1 = g.x1 - 0.35 - GAP_WALL_LEAN - 0.05;
          expect(x1 - x0).toBeGreaterThan(1);
          // 1. source data: no surface at any x in the gap
          for (let x = x0; x <= x1; x += 0.05) expect(surfaceYAt(src.chunk(chunkIndexAt(x)), x), `${id} gap @${x.toFixed(2)}`).toBeNull();
          // 2. streamed physics terrain: load the gap, probe from sky to kill plane
          s.terrain.update([(x0 + x1) / 2]);
          for (let x = x0 + 0.15; x <= x1 - 0.15; x += 0.1) {
            for (let y = level.cartStart.y - 20; y < level.killY; y += 0.1) {
              expect(s.query.circleTouches({ x, y }, 0.1), `${id} gap probe (${x.toFixed(2)}, ${y.toFixed(2)})`).toBe(false);
            }
          }
          // 3. a real body dropped into the gap falls to the kill plane
          const ball = s.world.createBody({ type: 'dynamic', position: { x: (x0 + x1) / 2, y: level.cartStart.y - 10 }, role: 'debug' });
          s.world.addCircle(ball, { x: 0, y: 0 }, 0.2, { density: 1 });
          for (let i = 0; i < 600 && s.world.getTransform(ball).y < level.killY; i++) s.world.step();
          expect(s.world.getTransform(ball).y).toBeGreaterThanOrEqual(level.killY);
          s.world.destroyBody(ball);
        }
      } finally {
        s.destroy();
      }
    }, 60_000);
  }
});

describe('endless streaming', () => {
  it('reverse-then-forward driving is seamless: recreated chunks are identical and the cart never falls through', async () => {
    const s = await session(exampleCart(), 'endless:ABC123');
    const seen = new Map<number, string>();
    let created = 0;
    let recreated = 0;
    s.terrain.addListener({
      chunkCreated(chunk: ReadonlyTerrainChunk) {
        created++;
        const sig = JSON.stringify(chunk.pieces);
        const prev = seen.get(chunk.index);
        if (prev !== undefined) {
          recreated++;
          expect(sig, `chunk ${chunk.index} recreated differently`).toBe(prev);
        } else seen.set(chunk.index, sig);
      },
      chunkDestroyed() {},
    });
    try {
      s.start();
      for (let i = 0; i < 60; i++) s.step();
      s.release();
      for (let i = 0; i < 180; i++) s.step();
      const h = s.controller.cart.bodies.get(s.controller.chassisId)!;
      const targets = [160, 25, 170];
      let from = 0;
      let n = 0;
      for (const t of targets) {
        const dir = t > from ? 1 : -1;
        while (n++ < 60 * 120) {
          const tr = s.world.getTransform(h);
          if ((dir > 0 && tr.x >= t) || (dir < 0 && tr.x <= t)) break;
          const v = s.world.getLinearVelocity(h).x * dir;
          s.setDrive(v < 5 ? dir : v > 6.5 ? (-dir as -1 | 1) : 0);
          s.step();
          // never below the surface under the chassis (no seam to fall through)
          const k = chunkIndexAt(tr.x);
          const sy = surfaceYAt(s.course.source.chunk(k), tr.x);
          if (sy !== null) expect(tr.y).toBeLessThan(sy + 0.3);
          expect(s.query.minX).toBeLessThan(tr.x);
          expect(s.query.maxX).toBeGreaterThan(tr.x);
        }
        from = t;
        expect(s.controller.phase).toBe('released');
      }
      expect(s.world.getTransform(h).x).toBeGreaterThanOrEqual(170);
      expect(s.controller.cartLost).toBe(false);
      expect(recreated).toBeGreaterThan(0); // chunks really were unloaded and rebuilt
      expect(created).toBeGreaterThan(seen.size);
      expect(s.furthestMetres()).toBeGreaterThan(160);
    } finally {
      s.destroy();
    }
  }, 120_000);
});

describe('custom carts and all-lost paths in the real flow', () => {
  it('the two-box spring cart builds and runs on beach', async () => {
    const s = await session(twoBoxSpringCart(), 'beach');
    try {
      expect(s.spawn.y).toBeCloseTo(levelById('beach')!.cartStart.y - 22 / 30, 9); // lifted by the wheel radius
      runWithPace(s, pace('beach'), 60);
      expect(s.controller.cartLost).toBe(false);
      expect(s.furthestMetres()).toBeGreaterThan(10);
      const L = s.controller.cart.bodies.get(s.controller.spec.partBody.get('L')!)!;
      const U = s.controller.cart.bodies.get(s.controller.spec.partBody.get('U')!)!;
      expect(L).not.toBe(U);
    } finally {
      s.destroy();
    }
  }, 60_000);

  it('level run: losing every pineapple does NOT end the run (Give Up remains)', async () => {
    const s = await session(noBedCart(), 'beach');
    try {
      s.start();
      s.release();
      for (let i = 0; i < 60 * 12; i++) s.step();
      expect(s.controller.remaining).toBe(0);
      expect(s.controller.phase).toBe('released');
      expect(s.events.some((e) => e.type === 'allLost')).toBe(false);
      expect(s.giveUp()).toBe(true);
      expect(s.events.at(-1)!.type).toBe('gaveUp');
    } finally {
      s.destroy();
    }
  }, 60_000);

  it('endless run: the last loss ends the run with allLost', async () => {
    const s = await session(noBedCart(), 'endless:ALLLOST');
    try {
      s.start();
      s.release();
      for (let i = 0; i < 60 * 12 && s.controller.phase !== 'ended'; i++) s.step();
      expect(s.events.at(-1)!.type).toBe('allLost');
      expect(s.aboard()).toBe(0);
      expect(s.simTime()).toBeGreaterThan(0);
    } finally {
      s.destroy();
    }
  }, 60_000);

});
