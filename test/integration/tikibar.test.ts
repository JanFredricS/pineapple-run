/**
 * S9 acceptance: Zero-G Tiki Bar through the real run flow (RunSession, the
 * object the browser run screen drives): the pace-note driver clears it with
 * the example cart at every bead tier, pacing beats flooring it, both exotic
 * mechanics are load-bearing (the course cannot be cleared without them),
 * the pool shortcut is real, and retry / save-reload are bit-identical
 * across the zones and the bead ocean.
 */
import { describe, expect, it } from 'vitest';
import { exampleCart } from '../../src/builder/exampleCart';
import { CartStore, type StorageLike } from '../../src/builder/storage';
import { courseFor } from '../../src/game/courses';
import { RunSession, type Course } from '../../src/game/session';
import type { CartDesign } from '../../src/model/cart';
import type { RunEvent } from '../../src/model/runEvents';
import { efficiencyRating } from '../../src/model/score';
import { BEAD_COUNT_MAX, BEAD_COUNT_MIN } from '../../src/run/beads';
import { BEADS_BY_TIER } from '../../src/game/deviceTier';
import { runBeadCount } from '../../src/game/runScreen';
import { PREMADE } from '../../tools/levels/premade';
import type { PaceNote } from '../../tools/levels/track';
import { FLOOR_IT, paceDrive } from './driver';

const PACE = PREMADE.tikibar().pace;

interface Run {
  events: RunEvent[];
  /** Chassis x, y, angle every 30 steps. */
  trace: number[];
  /** Every live bead's pose at the end. */
  beads: number[];
  delivered: number;
  rating: number;
  goal: boolean;
  /** Chassis time from the pool's start to its end (s), -1 if never crossed. */
  poolSeconds: number;
  /** Bead count sampled every 30 steps. */
  beadCounts: number[];
  /** Non-bead body count sampled every 30 steps. */
  otherBodies: number[];
}

function tikiCourse(dropZone?: string): Course {
  const c = courseFor('tikibar')!;
  if (!dropZone) return c;
  return { ...c, level: { ...c.level, zones: c.level.zones.filter((z) => z.id !== dropZone) } };
}

async function drive(line: readonly PaceNote[], opts: { beadCount?: number; design?: CartDesign; dropZone?: string } = {}): Promise<Run> {
  const s = await RunSession.create(opts.design ?? exampleCart(), tikiCourse(opts.dropZone), { beadCount: opts.beadCount ?? BEADS_BY_TIER.mid });
  const pool = PREMADE.tikibar().features.find((f) => f.kind === 'shortcut')!;
  try {
    const events: RunEvent[] = [];
    s.on((e) => events.push(e));
    const trace: number[] = [];
    const beadCounts: number[] = [];
    const otherBodies: number[] = [];
    let tIn = -1;
    let tOut = -1;
    s.start();
    for (let i = 0; i < 60; i++) s.step();
    s.release();
    for (let i = 0; i < 180; i++) s.step();
    const c = s.controller;
    for (let n = 0; c.phase !== 'ended' && n < 120 * 60; n++) {
      s.setDrive(paceDrive(s, line));
      s.step();
      const h = c.cart.bodies.get(c.chassisId);
      const alive = h !== undefined && s.world.hasBody(h);
      if (alive) {
        const x = s.world.getTransform(h).x;
        if (tIn < 0 && x >= pool.x0) tIn = s.simTime();
        if (tOut < 0 && x >= pool.x1) tOut = s.simTime();
      }
      if (n % 30 === 0) {
        if (alive) {
          const t = s.world.getTransform(h);
          trace.push(t.x, t.y, t.angle);
        }
        beadCounts.push(c.beads!.count);
        otherBodies.push(s.world.bodyHandles().length - c.beads!.count);
      }
    }
    const beads = c.beads!.handles().flatMap((b) => {
      const t = s.world.getTransform(b);
      return [t.x, t.y, t.angle];
    });
    const last = events.at(-1);
    const goal = last?.type === 'goalReached';
    const delivered = last?.type === 'goalReached' ? last.delivered : 0;
    const rating = last?.type === 'goalReached' ? efficiencyRating(last.simTime, last.delivered) : 0;
    return { events, trace, beads, delivered, rating, goal, poolSeconds: tIn >= 0 && tOut >= 0 ? tOut - tIn : -1, beadCounts, otherBodies };
  } finally {
    s.destroy();
  }
}

describe('Zero-G Tiki Bar (S9): the pace-note driver clears it with the example cart', () => {
  // audit-1 #3: pinned to the measured results (TUNING.md S9: 14/76, 12/66, 13/72),
  // not just the >= 10 acceptance floor. Runs are deterministic, so the floor
  // is the worst measured tier (12/15) and the rating keeps a 6-point margin.
  for (const n of [BEAD_COUNT_MIN, BEADS_BY_TIER.mid, BEAD_COUNT_MAX]) {
    it(`${n} beads: goalReached with >= 12/15 delivered (acceptance: >= 10), rating >= 60`, async () => {
      const r = await drive(PACE, { beadCount: n });
      expect(r.goal).toBe(true);
      expect(r.delivered).toBeGreaterThanOrEqual(12);
      expect(r.rating).toBeGreaterThanOrEqual(60);
      console.info(`[S9] tikibar pace, ${n} beads: ${r.delivered}/15, rating ${r.rating}`);
    }, 60_000);
  }

  it('pacing beats flooring it by >= 25 rating points (measured 37; acceptance: >= 5), floored delivers <= 7', async () => {
    const paced = await drive(PACE);
    const floored = await drive(FLOOR_IT);
    expect(floored.delivered).toBeLessThanOrEqual(7); // measured 5/15
    expect(floored.delivered).toBeLessThan(paced.delivered);
    expect(paced.rating - floored.rating, `paced ${paced.rating} vs floored ${floored.rating}`).toBeGreaterThanOrEqual(25);
    console.info(`[S9] tikibar paced ${paced.delivered}/15 rating ${paced.rating}; floored ${floored.delivered}/15 rating ${floored.rating}`);
  }, 60_000);

  it('both mechanics are load-bearing: without the moon-hop pocket or the shooter the pace line does not finish', async () => {
    expect((await drive(PACE, { dropZone: 'moon-hop' })).goal).toBe(false); // the gap is too wide at 1 g
    expect((await drive(PACE, { dropZone: 'shooter' })).goal).toBe(false); // the bar-stool cliff is unclimbable
  }, 60_000);

  it('the pool shortcut: the pace line jumps it, a careful line rolls through and is >= 2 s slower there', async () => {
    const pool = PREMADE.tikibar().features.find((f) => f.kind === 'shortcut')!;
    const brake = pool.x0 - 20;
    const careful: PaceNote[] = [...PACE.filter((p) => p.x < brake), { x: brake, speed: 5 }];
    const jump = await drive(PACE);
    const safe = await drive(careful);
    expect(safe.goal).toBe(true);
    expect(safe.delivered).toBeGreaterThanOrEqual(10);
    expect(safe.poolSeconds - jump.poolSeconds, `jump ${jump.poolSeconds.toFixed(2)} s vs careful ${safe.poolSeconds.toFixed(2)} s`).toBeGreaterThanOrEqual(2);
    console.info(`[S9] tikibar pool: jump ${jump.poolSeconds.toFixed(2)} s (${jump.delivered}/15, rating ${jump.rating}); careful ${safe.poolSeconds.toFixed(2)} s (${safe.delivered}/15, rating ${safe.rating})`);
  }, 60_000);

  it('beads never grow in number and the rest of the world stays bounded', async () => {
    const r = await drive(PACE);
    for (let i = 1; i < r.beadCounts.length; i++) expect(r.beadCounts[i]!).toBeLessThanOrEqual(r.beadCounts[i - 1]!);
    const half = Math.floor(r.otherBodies.length / 2);
    const early = Math.max(...r.otherBodies.slice(0, half));
    const late = Math.max(...r.otherBodies.slice(half));
    expect(late).toBeLessThanOrEqual(early);
  }, 60_000);
});

class MemStorage implements StorageLike {
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

describe('Zero-G Tiki Bar (S9): retry and save/reload determinism', () => {
  it('retry: two full runs with identical inputs give identical events, chassis poses and bead poses', async () => {
    const a = await drive(PACE);
    const b = await drive(PACE);
    expect(a.goal).toBe(true);
    expect(b.events).toEqual(a.events);
    expect(b.trace).toEqual(a.trace);
    expect(b.beads.length).toBeGreaterThan(0);
    expect(b.beads).toEqual(a.beads);
  }, 60_000);

  it('save -> reload -> rerun gives an identical run (zones, shooter and beads included)', async () => {
    const store = new CartStore(new MemStorage());
    expect(store.save('Tiki Cart', exampleCart()).ok).toBe(true);
    const loaded = store.load('Tiki Cart');
    if (!loaded.ok) throw new Error(loaded.error.message);
    const a = await drive(PACE);
    const b = await drive(PACE, { design: loaded.value });
    expect(b.events).toEqual(a.events);
    expect(b.trace).toEqual(a.trace);
    expect(b.beads).toEqual(a.beads);
  }, 60_000);

  it('audit-1 #1: a run on a 600-bead device, reloaded after the device reports the 300-bead tier, replays identically (pinned count)', async () => {
    const pin = new MemStorage();
    const store = new CartStore(new MemStorage());
    expect(store.save('Tiki Cart', exampleCart()).ok).toBe(true);
    const high = runBeadCount({ deviceInfo: { hardwareConcurrency: 16, deviceMemory: 8 }, beadStorage: pin });
    expect(high).toBe(BEAD_COUNT_MAX);
    const a = await drive(PACE, { beadCount: high });
    // reload: the cart comes back from its save, the device now looks low-tier
    const loaded = store.load('Tiki Cart');
    if (!loaded.ok) throw new Error(loaded.error.message);
    const low = { hardwareConcurrency: 2, deviceMemory: 1 };
    const again = runBeadCount({ deviceInfo: low, beadStorage: pin });
    expect(again).toBe(BEAD_COUNT_MAX);
    const b = await drive(PACE, { beadCount: again, design: loaded.value });
    expect(b.beads.length).toBeGreaterThan(0);
    expect(b.events).toEqual(a.events);
    expect(b.trace).toEqual(a.trace);
    expect(b.beads).toEqual(a.beads);
    // control: without the pin the low tier would have re-guessed 300 and built a different ocean
    expect(runBeadCount({ deviceInfo: low, beadStorage: null })).toBe(BEAD_COUNT_MIN);
  }, 60_000);
});
