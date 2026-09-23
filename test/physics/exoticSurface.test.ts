/**
 * S9: the engine surface added by the second opening of src/physics/engine.ts
 * (gravity scale, applyForceToCenter, sensors). Each addition is checked
 * against the binding's real behaviour, including the edge cases the zone
 * field relies on (sleeping visitors stay inside, destroyed visitors drop
 * out, a world without sensorVisitors reports nothing).
 */
import { describe, expect, it } from 'vitest';
import { PhysicsWorld, type BodyHandle } from '../../src/physics/engine';

const BOX = (hw: number, hh: number) => [
  { x: -hw, y: -hh },
  { x: hw, y: -hh },
  { x: hw, y: hh },
  { x: -hw, y: hh },
];

async function world(sensorVisitors = true): Promise<PhysicsWorld> {
  return PhysicsWorld.create({ sensorVisitors });
}

function ball(w: PhysicsWorld, x: number, y: number, opts: { sleep?: boolean; visitor?: boolean } = {}): BodyHandle {
  const h = w.createBody({ type: 'dynamic', position: { x, y }, enableSleep: opts.sleep ?? false });
  w.addCircle(h, { x: 0, y: 0 }, 0.25, { density: 1, ...(opts.visitor !== undefined ? { sensorVisitor: opts.visitor } : {}) });
  return h;
}

function sensor(w: PhysicsWorld, x: number, y: number, hw: number, hh: number): BodyHandle {
  const h = w.createBody({ type: 'static', position: { x, y }, role: 'zone' });
  w.addSensorPolygon(h, BOX(hw, hh), 'zone');
  return h;
}

describe('S9 engine surface: gravity scale', () => {
  it('scales gravity per body, round-trips, rejects non-finite values', async () => {
    const w = await world(false);
    try {
      const a = ball(w, 0, 0);
      const b = ball(w, 5, 0);
      expect(w.getGravityScale(a)).toBe(1);
      w.setGravityScale(b, 0.25);
      expect(w.getGravityScale(b)).toBe(0.25);
      for (let i = 0; i < 30; i++) w.step();
      const va = w.getLinearVelocity(a).y;
      const vb = w.getLinearVelocity(b).y;
      expect(va).toBeGreaterThan(0); // y down: falling
      expect(vb / va).toBeCloseTo(0.25, 3);
      expect(() => w.setGravityScale(a, Number.NaN)).toThrow();
      expect(() => w.setGravityScale(a, Infinity)).toThrow();
    } finally {
      w.destroy();
    }
  });
});

describe('S9 engine surface: applyForceToCenter', () => {
  it('accelerates by F/m for the next step only (Box2D clears forces after each step)', async () => {
    const w = await PhysicsWorld.create({ gravity: { x: 0, y: 0 } });
    try {
      const h = ball(w, 0, 0);
      const m = w.getMass(h);
      w.applyForceToCenter(h, { x: 6 * m, y: -3 * m });
      w.step();
      const v1 = w.getLinearVelocity(h);
      expect(v1.x).toBeCloseTo(6 / 60, 4);
      expect(v1.y).toBeCloseTo(-3 / 60, 4);
      w.step(); // no force this step
      const v2 = w.getLinearVelocity(h);
      expect(v2.x).toBeCloseTo(v1.x, 6);
      expect(v2.y).toBeCloseTo(v1.y, 6);
    } finally {
      w.destroy();
    }
  });
});

describe('S9 engine surface: sensors', () => {
  it('reports begin/end as body handles; a multi-shape visitor begins once per shape', async () => {
    const w = await world();
    try {
      const s = sensor(w, 0, 5, 2, 1);
      const h = w.createBody({ type: 'dynamic', position: { x: 0, y: 0 } });
      w.addCircle(h, { x: -0.3, y: 0 }, 0.2, { density: 1 });
      w.addPolygon(h, BOX(0.2, 0.2).map((p) => ({ x: p.x + 0.3, y: p.y })), { density: 1 });
      const begins: number[] = [];
      const ends: number[] = [];
      for (let i = 0; i < 180; i++) {
        w.step();
        const ev = w.sensorEvents();
        for (const e of ev.begin) {
          expect(e).toEqual({ sensor: s, visitor: h });
          begins.push(i);
        }
        for (const e of ev.end) {
          expect(e).toEqual({ sensor: s, visitor: h });
          ends.push(i);
        }
      }
      expect(begins).toHaveLength(2); // two visitor shapes
      expect(ends).toHaveLength(2); // it fell through the sensor (sensors never collide)
      expect(Math.min(...ends)).toBeGreaterThan(Math.max(...begins));
      expect(w.getTransform(h).y).toBeGreaterThan(7);
    } finally {
      w.destroy();
    }
  });

  it('a sleeping visitor stays inside (no end event); destroying it ends nothing it can report', async () => {
    const w = await world();
    try {
      const s = sensor(w, 0, 0, 3, 3);
      const floor = w.createBody({ type: 'static', position: { x: 0, y: 1 } });
      w.addPolygon(floor, BOX(3, 0.2), {});
      const h = ball(w, 0, 0.5, { sleep: true });
      let inside = 0;
      for (let i = 0; i < 400; i++) {
        w.step();
        const ev = w.sensorEvents();
        inside += ev.begin.filter((e) => e.sensor === s && e.visitor === h).length;
        inside -= ev.end.filter((e) => e.sensor === s && e.visitor === h).length;
      }
      expect(w.isAwake(h)).toBe(false);
      expect(inside).toBe(1);
      w.destroyBody(h);
      w.step();
      const ev = w.sensorEvents();
      // the end event carries dead shape ids and is dropped (callers prune destroyed bodies themselves)
      expect(ev.end.filter((e) => e.visitor === h)).toEqual([]);
    } finally {
      w.destroy();
    }
  });

  it('without sensorVisitors (every pre-S9 world) and for opted-out shapes, nothing is reported', async () => {
    for (const [visitors, optOut] of [
      [false, undefined],
      [true, false],
    ] as const) {
      const w = await world(visitors);
      try {
        sensor(w, 0, 3, 2, 2);
        ball(w, 0, 0, optOut === undefined ? {} : { visitor: optOut });
        let n = 0;
        for (let i = 0; i < 120; i++) {
          w.step();
          const ev = w.sensorEvents();
          n += ev.begin.length + ev.end.length;
        }
        expect(n).toBe(0);
      } finally {
        w.destroy();
      }
    }
  });

  it('a visitor can opt in on a world without sensorVisitors', async () => {
    const w = await world(false);
    try {
      const s = sensor(w, 0, 3, 2, 2);
      const h = ball(w, 0, 0, { visitor: true });
      let begins = 0;
      for (let i = 0; i < 60; i++) {
        w.step();
        begins += w.sensorEvents().begin.filter((e) => e.sensor === s && e.visitor === h).length;
      }
      expect(begins).toBe(1);
    } finally {
      w.destroy();
    }
  });

  it('sensors carry their polygon into the manifest and do not collide', async () => {
    const w = await world();
    try {
      const s = sensor(w, 0, 3, 2, 0.5);
      const info = w.manifest().bodies.find((b) => b.id === s)!;
      expect(info.role).toBe('zone');
      expect(info.shapes).toEqual([{ type: 'polygon', partId: 'zone', vertices: BOX(2, 0.5) }]);
      const h = ball(w, 0, 0);
      for (let i = 0; i < 120; i++) w.step();
      expect(w.getTransform(h).y).toBeGreaterThan(5); // fell straight through
      expect(() => w.addSensorPolygon(s, [{ x: 0, y: 0 }, { x: 1, y: 0 }], 'bad')).toThrow();
    } finally {
      w.destroy();
    }
  });
});
