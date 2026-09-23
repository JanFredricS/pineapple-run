/**
 * K1: Kitchen Bench's difficulty (TUNING.md "K1: Kitchen difficulty").
 *
 * The owner asked for "a wider hole that requires a special design of the
 * cart to cross". The sink is a 5.5 m hole to a counter 0.5 m higher. The
 * example cart (5 m wheelbase) cannot cross it at any steady speed or
 * holding right; it falls in (the run ends: retry) or it is stopped at the
 * far wall (the stuck hint; Give Up works). The purpose-built Kitchen
 * Bridger (test/integration/kitchenBridger.ts) crosses it and clears the
 * course with margin, across a band of steady speeds rather than on one
 * knife-edge line.
 */
import { describe, expect, it } from 'vitest';
import { exampleCart } from '../../src/builder/exampleCart';
import { BUILD_AREA } from '../../src/builder/constants';
import { maxRadiusInArea } from '../../src/builder/edits';
import { courseFor } from '../../src/game/courses';
import { RunSession } from '../../src/game/session';
import type { CartDesign } from '../../src/model/cart';
import { resolveAttachments } from '../../src/model/attach';
import { efficiencyRating, TOTAL_PINEAPPLES } from '../../src/model/score';
import { validateCartDesign } from '../../src/model/validate';
import { PREMADE } from '../../tools/levels/premade';
import type { PaceNote } from '../../tools/levels/track';
import { FLOOR_IT, paceDrive, runWithPace } from './driver';
import { KITCHEN_BRIDGER_LINE, kitchenBridger } from './kitchenBridger';

const kitchen = PREMADE.kitchen();
/** The sink: the widest gap. Its feature runs from the near edge to the far bevel's top (hole + 0.35 m bevel). */
const sink = kitchen.features.filter((f) => f.kind === 'gap').reduce((a, b) => (b.x1 - b.x0 > a.x1 - a.x0 ? b : a));
const SINK_HOLE = sink.x1 - sink.x0 - 0.35;

const PX = 30;
const wheelsOf = (d: CartDesign) =>
  d.parts.filter((p): p is Extract<CartDesign['parts'][number], { kind: 'wheel' }> => p.kind === 'wheel').sort((a, b) => a.center.x - b.center.x);

describe('K1: the sink is the widest gap, wider than the example cart can bridge', () => {
  it('the sink is a 5.5 m hole, and the example cart wheelbase (5 m) is shorter', () => {
    expect(SINK_HOLE).toBeCloseTo(5.5, 6);
    const [rear, front] = wheelsOf(exampleCart());
    expect((front!.center.x - rear!.center.x) / PX).toBeCloseTo(5, 6);
    expect((front!.center.x - rear!.center.x) / PX).toBeLessThan(SINK_HOLE);
  });

  it('the Kitchen Bridger validates, resolves clean, and fits the 17.67 x 7 m build area resting on the ground line', () => {
    const d = kitchenBridger();
    const v = validateCartDesign(JSON.parse(JSON.stringify(d)));
    if (!v.ok) throw new Error(v.error.message);
    expect(v.value).toEqual(d);
    const spec = resolveAttachments(d);
    expect(spec.errors).toEqual([]);
    expect(spec.valid).toBe(true);
    for (const p of d.parts) {
      if (p.kind === 'wheel') {
        expect(p.radius, p.id).toBeLessThanOrEqual(maxRadiusInArea(p.center));
        expect(p.center.y + p.radius, `${p.id} rests on the ground line`).toBeCloseTo(0, 9);
        expect(spec.wheelPins.get(p.id), `${p.id} is pinned to the frame`).not.toBeNull();
        continue;
      }
      if (p.kind !== 'straw') throw new Error(`unexpected part ${p.kind}`);
      for (const q of [p.a, p.b]) {
        expect(q.x).toBeGreaterThanOrEqual(BUILD_AREA.minX);
        expect(q.x).toBeLessThanOrEqual(BUILD_AREA.maxX);
        expect(q.y).toBeGreaterThanOrEqual(BUILD_AREA.minY);
        expect(q.y).toBeLessThanOrEqual(BUILD_AREA.maxY);
      }
    }
    // one rigid frame: every straw welds into a single body
    expect(spec.bodies.filter((b) => b.kind === 'rigid')).toHaveLength(1);
  });

  it('the Kitchen Bridger always has a wheel on each side of the sink: both reaches exceed the hole', () => {
    const [r, m1, m2, f] = wheelsOf(kitchenBridger());
    // front reach: F lands on the far counter before M2 leaves the near one
    expect((f!.center.x - m2!.center.x) / PX).toBeGreaterThan(SINK_HOLE);
    // rear reach: R is still on the near counter while M1 and M2 are over the hole
    expect((m1!.center.x - r!.center.x) / PX).toBeGreaterThan(SINK_HOLE);
  });

  it('K1 audit #6: the loaded centre of mass lies between the middle wheels (so the cart never rests on one side of the hole alone)', async () => {
    const d = kitchenBridger();
    const spec = resolveAttachments(d);
    const s = await RunSession.create(d, courseFor('kitchen')!);
    try {
      // load, release, let the load settle on the start plateau
      s.start();
      for (let i = 0; i < 60; i++) s.step();
      s.release();
      for (let i = 0; i < 240; i++) s.step();
      const c = s.controller;
      // design frame (m) -> world: from the rigid frame's body pose (level on the plateau)
      const frame = spec.bodies.find((b) => b.kind === 'rigid')!;
      const frameWorld = s.world.getTransform(c.cart.bodies.get(frame.id)!);
      expect(Math.abs(frameWorld.angle), 'level on the plateau').toBeLessThan(0.01);
      const dx = frameWorld.x - frame.origin.x;
      let m = 0;
      let mx = 0;
      for (const b of spec.bodies) {
        const mass = s.world.getMass(c.cart.bodies.get(b.id)!);
        // uniform density: the body's centre of mass is the area-weighted centroid of its shapes
        let area = 0;
        let ax = 0;
        for (const sh of b.shapes) {
          if (sh.type === 'circle') {
            const a = Math.PI * sh.radius ** 2;
            area += a;
            ax += a * sh.center.x;
          } else {
            const v = sh.vertices;
            let a2 = 0;
            let cx = 0;
            for (let i = 0; i < v.length; i++) {
              const p = v[i]!, q = v[(i + 1) % v.length]!;
              const cr = p.x * q.y - q.x * p.y;
              a2 += cr;
              cx += (p.x + q.x) * cr;
            }
            area += Math.abs(a2) / 2;
            ax += Math.abs(a2) / 2 * (cx / (3 * a2));
          }
        }
        m += mass;
        mx += mass * (b.origin.x + ax / area);
      }
      const aboard = c.pineappleStates().filter((p) => p.alive && !p.lost);
      expect(aboard, 'the whole load is aboard').toHaveLength(TOTAL_PINEAPPLES);
      expect(c.aboard, 'the whole load is aboard').toBe(TOTAL_PINEAPPLES);
      for (const p of aboard) {
        const mass = s.world.getMass(p.handle);
        m += mass;
        mx += mass * (s.world.getTransform(p.handle).x - dx);
      }
      const comPx = (mx / m) * PX;
      const [, m1, m2] = wheelsOf(d);
      // measured 92.8 px, between M1 (65) and M2 (130)
      expect(comPx).toBeGreaterThan(m1!.center.x);
      expect(comPx).toBeLessThan(m2!.center.x);
    } finally {
      s.destroy();
    }
  }, 60_000);
});

/** Drive `line` for up to `seconds`; report the outcome and whether the cart ever got wholly past the sink. */
async function attempt(cart: CartDesign, line: readonly PaceNote[], seconds = 60) {
  const s = await RunSession.create(cart, courseFor('kitchen')!);
  try {
    s.start();
    for (let i = 0; i < 60; i++) s.step();
    s.release();
    for (let i = 0; i < 180; i++) s.step();
    let rearMax = -Infinity;
    let frontMax = -Infinity;
    for (let n = 0; s.controller.phase !== 'ended' && n < seconds * 60; n++) {
      s.setDrive(paceDrive(s, line));
      s.step();
      const b = s.controller.cartBounds();
      if (b) {
        rearMax = Math.max(rearMax, b.minX);
        frontMax = Math.max(frontMax, b.maxX);
      }
    }
    const last = s.events.at(-1)!;
    const stuck = s.stuck;
    const gaveUp = s.controller.phase !== 'ended' ? s.giveUp() && s.events.at(-1)!.type === 'gaveUp' : false;
    return { last, stuck, gaveUp, cartLost: s.controller.cartLost, rearMax, frontMax };
  } finally {
    s.destroy();
  }
}

describe('K1: the example cart cannot cross the sink', () => {
  // K1 audit #2: each speed's player-facing mode is pinned (measured, deterministic).
  // Falls in: the cart is lost and the run ends (allLost -> Retry).
  // Jams: the cart wedges against the far wall, the stuck hint shows, Give Up ends the run.
  const lines: [string, readonly PaceNote[], 'falls in' | 'jams'][] = [
    ...[5, 6, 7, 9].map((v): [string, readonly PaceNote[], 'falls in'] => [`steady ${v} m/s`, [{ x: 0, speed: v }], 'falls in']),
    ...[8, 10, 11, 12, 13, 14, 15].map((v): [string, readonly PaceNote[], 'jams'] => [`steady ${v} m/s`, [{ x: 0, speed: v }], 'jams']),
    ['hold right', FLOOR_IT, 'jams'],
  ];
  for (const [name, line, mode] of lines) {
    it(`${name}: it ${mode === 'falls in' ? 'falls in and the run ends (allLost, Retry)' : 'jams at the far wall: stuck hint, Give Up works'}; never past the sink`, async () => {
      const r = await attempt(exampleCart(), line);
      expect(r.last.type).not.toBe('goalReached');
      // the cart's rear never gets past the far edge of the hole
      expect(r.rearMax).toBeLessThan(sink.x1);
      // and it got there: this is the sink stopping it, not something earlier
      expect(r.frontMax).toBeGreaterThan(sink.x0);
      if (mode === 'falls in') {
        expect(r.cartLost, 'the cart fell in').toBe(true);
        expect(r.last.type, 'a lost cart ends the level run (S6T #16), Retry').toBe('allLost');
      } else {
        // no soft-lock: the side walls keep it in the open, the stuck hint shows, Give Up ends the run
        expect(r.cartLost, 'the cart is wedged, not lost').toBe(false);
        expect(r.stuck, 'the stuck hint is up').toBe(true);
        expect(r.gaveUp).toBe(true);
      }
    }, 120_000);
  }

  it("the sink's run-up is level for 12 m (no lip to launch from: kitchenSinkPitch.test.ts), and the far counter is 0.5 m higher", () => {
    const pts = kitchen.level.terrain.spans.flatMap((sp) => sp.points);
    const yAt = (x: number) => {
      const i = pts.findIndex((p, k) => k > 0 && pts[k - 1]!.x <= x && p.x >= x);
      const a = pts[i - 1]!, b = pts[i]!;
      return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    };
    const edgeY = yAt(sink.x0 - 0.01);
    for (const p of pts.filter((q) => q.x >= sink.x0 - 12 && q.x <= sink.x0)) expect(p.y, `run-up point at ${p.x}`).toBeCloseTo(edgeY, 6);
    // the last bump before it (the washboard) ends >= 12 m before the hole
    const before = kitchen.features.filter((f) => f.x1 <= sink.x0 && f.kind !== 'gap');
    expect(sink.x0 - Math.max(...before.map((f) => f.x1))).toBeGreaterThanOrEqual(12 - 1e-6);
    expect(edgeY - yAt(sink.x1 + 0.5)).toBeCloseTo(0.5, 6);
  });
});

describe('K1: the Kitchen Bridger clears Kitchen', () => {
  it('the bridger line (the kitchen pace notes) delivers >= 14/15 with rating >= 65 (target 12 and 60; measured 15/15, 75)', async () => {
    expect(KITCHEN_BRIDGER_LINE).toEqual(kitchen.pace);
    const s = await RunSession.create(kitchenBridger(), courseFor('kitchen')!);
    try {
      runWithPace(s, KITCHEN_BRIDGER_LINE);
      const last = s.events.at(-1)!;
      expect(last.type).toBe('goalReached');
      if (last.type !== 'goalReached') return;
      expect(last.delivered).toBeGreaterThanOrEqual(TOTAL_PINEAPPLES - 1);
      expect(efficiencyRating(last.simTime, last.delivered)).toBeGreaterThanOrEqual(65);
      expect(s.controller.cartLost).toBe(false);
    } finally {
      s.destroy();
    }
  }, 120_000);

  // Measured (deterministic): 4 -> 15/15 57, 5 -> 15/15 58, 6 -> 15/15 70, 7 -> 14/15 70,
  // 8 -> 13/15 66, 9 -> 13/15 68 (the slow ones pay in time, not pineapples).
  // Above ~9 m/s the crossing turns chaotic (9.5 stalls at the sink, 12 -> 9/15).
  for (const v of [4, 5, 6, 7, 8, 9]) {
    it(`a steady ${v} m/s also clears it (>= 13/15${v >= 6 ? ', rating >= 60' : ''}): a band, not a knife edge`, async () => {
      const r = await attempt(kitchenBridger(), [{ x: 0, speed: v }], 150);
      expect(r.last.type).toBe('goalReached');
      if (r.last.type !== 'goalReached') return;
      expect(r.last.delivered).toBeGreaterThanOrEqual(13);
      if (v >= 6) expect(efficiencyRating(r.last.simTime, r.last.delivered)).toBeGreaterThanOrEqual(60);
    }, 120_000);
  }

  // K1 audit #7: "forgiving once built": the player who just holds right with the bridger
  // still finishes. Measured 9/15, rating 50, 30.9 s (the line: 15/15, 75).
  it('holding right with the bridger reaches the goal with >= 8/15, rating >= 45', async () => {
    const r = await attempt(kitchenBridger(), FLOOR_IT, 150);
    expect(r.last.type).toBe('goalReached');
    if (r.last.type !== 'goalReached') return;
    expect(r.last.delivered).toBeGreaterThanOrEqual(8);
    expect(efficiencyRating(r.last.simTime, r.last.delivered)).toBeGreaterThanOrEqual(45);
    expect(r.cartLost).toBe(false);
  }, 120_000);
});
