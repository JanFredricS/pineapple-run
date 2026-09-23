/**
 * S9 exotic physics, run side: the zone field (src/run/zones.ts) turning
 * sensor membership into gravity scale / force, and the bead ocean
 * (src/run/beads.ts): deterministic layout, adaptive count at constant
 * extent and mass, sweeping, and "beads are not cargo".
 */
import { describe, expect, it } from 'vitest';
import { exampleCart } from '../../src/builder/exampleCart';
import { courseFor } from '../../src/game/courses';
import { RunSession } from '../../src/game/session';
import type { LevelDef, ZoneDef } from '../../src/model/level';
import { PhysicsWorld, type BodyHandle } from '../../src/physics/engine';
import { BEAD_COUNT_DEFAULT, BEAD_COUNT_MAX, BEAD_COUNT_MIN, BEAD_DENSITY, BEAD_FILL, BeadOcean, beadLayout, clampBeadCount } from '../../src/run/beads';
import { ZoneField } from '../../src/run/zones';
import { groundAt, PREMADE } from '../../tools/levels/premade';

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

function ball(w: PhysicsWorld, x: number, y: number): BodyHandle {
  const h = w.createBody({ type: 'dynamic', position: { x, y } });
  w.addCircle(h, { x: 0, y: 0 }, 0.2, { density: 1 });
  return h;
}

describe('ZoneField', () => {
  it('refuses a world whose bodies cannot enter zones', async () => {
    const w = await PhysicsWorld.create();
    try {
      expect(() => new ZoneField(w, [{ id: 'g', kind: 'gravity', rect: box(0, 0, 1, 1), gravityScale: 0.5 }])).toThrow(/sensorVisitors/);
      expect(() => new ZoneField(w, [{ id: 'b', kind: 'beads', rect: box(0, 0, 1, 1) }])).not.toThrow(); // no field zones: nothing to sense
    } finally {
      w.destroy();
    }
  });

  it('a gravity pocket scales gravity while a body is inside and restores it after', async () => {
    const w = await PhysicsWorld.create({ sensorVisitors: true });
    try {
      const zones: ZoneDef[] = [{ id: 'moon', kind: 'gravity', rect: box(-2, 2, 4, 3), gravityScale: 0.3 }];
      const f = new ZoneField(w, zones);
      expect(w.manifest().bodies.filter((b) => b.role === 'zone')).toHaveLength(1);
      const h = ball(w, 0, 0);
      const scales: number[] = [];
      for (let i = 0; i < 150; i++) {
        f.preStep();
        w.step();
        f.postStep();
        scales.push(w.getGravityScale(h));
      }
      const firstLow = scales.indexOf(Math.fround(0.3)); // Box2D stores floats
      const back = scales.indexOf(1, firstLow);
      expect(firstLow).toBeGreaterThan(0);
      expect(back).toBeGreaterThan(firstLow);
      expect(scales.slice(back).every((s) => s === 1)).toBe(true);
      expect(f.zonesOf(h)).toEqual([]);
      expect(w.getTransform(h).y).toBeGreaterThan(5);
    } finally {
      w.destroy();
    }
  });

  it('a shooter applies mass x acceleration every step; members are tracked and destroyed bodies pruned', async () => {
    const w = await PhysicsWorld.create({ sensorVisitors: true });
    try {
      const f = new ZoneField(w, [{ id: 'up', kind: 'force', rect: box(-3, -3, 6, 6), force: { x: 0, y: -20 } }]);
      const h = ball(w, 0, 0);
      f.preStep();
      w.step();
      f.postStep(); // entered during this step
      expect(f.zonesOf(h)).toEqual(['up']);
      expect(f.membersOf('up')).toEqual([h]);
      const v0 = w.getLinearVelocity(h).y;
      for (let i = 0; i < 10; i++) {
        f.preStep();
        w.step();
        f.postStep();
      }
      // net -10 m/s² (20 up, gravity 10 down) for 10 steps
      expect(w.getLinearVelocity(h).y - v0).toBeCloseTo(-10 * (10 / 60), 3);
      w.destroyBody(h);
      f.preStep();
      w.step();
      f.postStep();
      expect(f.membersOf('up')).toEqual([]);
    } finally {
      w.destroy();
    }
  });

  it('overlapping pockets use the lowest scale; forces add (level order)', async () => {
    const w = await PhysicsWorld.create({ sensorVisitors: true, gravity: { x: 0, y: 0 } });
    try {
      const f = new ZoneField(w, [
        { id: 'a', kind: 'gravity', rect: box(-3, -3, 6, 6), gravityScale: 0.5 },
        { id: 'b', kind: 'gravity', rect: box(-3, -3, 6, 6), gravityScale: 0.2 },
        { id: 'p', kind: 'force', rect: box(-3, -3, 6, 6), force: { x: 3, y: 0 } },
        { id: 'q', kind: 'force', rect: box(-3, -3, 6, 6), force: { x: 1, y: 0 } },
      ]);
      const h = ball(w, 0, 0);
      for (let i = 0; i < 3; i++) {
        f.preStep();
        w.step();
        f.postStep();
      }
      expect(f.zonesOf(h)).toEqual(['a', 'b', 'p', 'q']);
      expect(w.getGravityScale(h)).toBe(Math.fround(0.2));
      const v = w.getLinearVelocity(h).x;
      f.preStep();
      w.step();
      expect(w.getLinearVelocity(h).x - v).toBeCloseTo(4 / 60, 5);
    } finally {
      w.destroy();
    }
  });
});

describe('bead layout', () => {
  const t = PREMADE.tikibar().level;
  const zone = t.zones.find((z) => z.kind === 'beads')!;

  it('clamps the count to 300..600', () => {
    expect(clampBeadCount(10)).toBe(BEAD_COUNT_MIN);
    expect(clampBeadCount(9999)).toBe(BEAD_COUNT_MAX);
    expect(clampBeadCount(451.4)).toBe(451);
    expect(clampBeadCount(Number.NaN)).toBe(BEAD_COUNT_DEFAULT);
  });

  for (const n of [BEAD_COUNT_MIN, BEAD_COUNT_DEFAULT, BEAD_COUNT_MAX]) {
    it(`${n} beads: exact count, inside the zone, above the ground, not overlapping, deterministic`, () => {
      const a = beadLayout(t, zone, n);
      expect(a).toEqual(beadLayout(t, zone, n));
      expect(a.centres).toHaveLength(n);
      const r = a.radius;
      for (const c of a.centres) {
        expect(c.x - r).toBeGreaterThanOrEqual(zone.rect.x - 1e-9);
        expect(c.x + r).toBeLessThanOrEqual(zone.rect.x + zone.rect.width + 1e-9);
        expect(c.y - r).toBeGreaterThanOrEqual(zone.rect.y - 1e-9);
        expect(c.y + r).toBeLessThanOrEqual(groundAt(t, c.x)! + 1e-9);
      }
      const sorted = [...a.centres].sort((p, q) => p.x - q.x);
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length && sorted[j]!.x - sorted[i]!.x < 2 * r; j++) {
          expect(Math.hypot(sorted[j]!.x - sorted[i]!.x, sorted[j]!.y - sorted[i]!.y)).toBeGreaterThanOrEqual(2 * r - 1e-9);
        }
      }
    });
  }

  it('fewer beads are bigger: the pile keeps its mass (within the lattice fallback) at every tier', () => {
    const mass = (n: number) => {
      const l = beadLayout(t, zone, n);
      return n * Math.PI * l.radius * l.radius * BEAD_DENSITY;
    };
    const target = mass(BEAD_COUNT_DEFAULT);
    for (const n of [BEAD_COUNT_MIN, BEAD_COUNT_MAX]) expect(Math.abs(mass(n) / target - 1)).toBeLessThan(0.1);
    expect(beadLayout(t, zone, BEAD_COUNT_MIN).radius).toBeGreaterThan(beadLayout(t, zone, BEAD_COUNT_MAX).radius);
    expect(BEAD_FILL).toBeLessThan(0.907); // below hex packing: the lattice has spare sites
  });
});

describe('BeadOcean', () => {
  it('sweeps beads that fell below killY every BEAD_SWEEP_STEPS; the count only goes down', async () => {
    // the tikibar layout with NO terrain in the world: every bead falls away
    const level: LevelDef = PREMADE.tikibar().level;
    const w = await PhysicsWorld.create();
    try {
      const o = new BeadOcean(w, level, 300);
      expect(o.count).toBe(300);
      expect(o.created).toBe(300);
      let last = o.count;
      for (let step = 1; step <= 240; step++) {
        w.step();
        o.sweep(step);
        expect(o.count).toBeLessThanOrEqual(last);
        if (step % 30 !== 0) expect(o.count).toBe(last);
        last = o.count;
      }
      expect(o.count).toBe(0);
      expect(w.bodyHandles()).toEqual([]);
    } finally {
      w.destroy();
    }
  });

  it('in a real session: beads are role "bead", not cargo, not streaming anchors; the basin is pinned by the zone ends', async () => {
    const course = courseFor('tikibar')!;
    const s = await RunSession.create(exampleCart(), course, { beadCount: 300 });
    try {
      const c = s.controller;
      expect(c.beads!.count).toBe(300);
      const manifest = s.world.manifest();
      expect(manifest.bodies.filter((b) => b.role === 'bead')).toHaveLength(300);
      expect(manifest.bodies.filter((b) => b.role === 'zone')).toHaveLength(2); // gravity + force (beads are not a sensor)
      expect(c.pineappleStates()).toHaveLength(15);
      const zone = course.level.zones.find((z) => z.kind === 'beads')!;
      expect(s.furnitureXs).toEqual([zone.rect.x, zone.rect.x + zone.rect.width]);
      s.start();
      for (let i = 0; i < 60; i++) s.step();
      s.release();
      for (let i = 0; i < 120; i++) s.step();
      // anchors: exactly the cart bodies and the pineapples
      expect(s.liveXs()).toHaveLength(c.cartBodyHandles().length + 15);
      // beads never became zone members (they opt out of sensor events)
      for (const zid of ['moon-hop', 'shooter']) for (const h of c.zones!.membersOf(zid)) expect(c.beads!.handles()).not.toContain(h);
    } finally {
      s.destroy();
    }
  });

  it('a level without zones builds no zone field and no beads, in a world without sensor visitors', async () => {
    const s = await RunSession.create(exampleCart(), courseFor('beach')!);
    try {
      expect(s.controller.zones).toBeNull();
      expect(s.controller.beads).toBeNull();
      expect(s.world.sensorVisitors).toBe(false);
    } finally {
      s.destroy();
    }
  });
});
