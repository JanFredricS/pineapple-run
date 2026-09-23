/**
 * K1 audit #1: synthetic "sink" courses for the example-cart sweep
 * (test/integration/kitchenSink.test.ts). Each is the shared start plateau,
 * a run-up (optionally with a bump that pitches the cart nose-up), one hole
 * `width` m wide to a far counter `rise` m higher, a 20 m far counter ending
 * at a 4 m wall (a pineapple thrown over the hole cannot roll on into the
 * finish and end the run early: the cart gets the whole time to cross), and
 * a standard finish on top. Built with the same Track DSL as Kitchen (tools/levels),
 * so the hole has Kitchen's gap walls and far bevel.
 */
import { expect } from 'vitest';
import { exampleCart } from '../../src/builder/exampleCart';
import { RunSession, type Course } from '../../src/game/session';
import type { CartDesign } from '../../src/model/cart';
import { LevelChunkSource } from '../../src/terrain/chunks';
import { Track, type PaceNote } from '../../tools/levels/track';
import { FLOOR_IT, paceDrive } from './driver';

export interface SinkSpec {
  /** Flat run-up between the plateau (and the bump, if any) and the hole (m). */
  runUp: number;
  /** Hole width (m), wall to wall; the far side adds Track.gap's 0.35 m bevel. */
  width: number;
  /** How much higher the far counter is (m). */
  rise: number;
  /**
   * A bump before the run-up's last `bumpToEdge` m, to pitch the cart:
   * 'hump' (smooth, 3 m), 'kicker' (3 m straight ramp up, 1 m drop back) or
   * 'washboard' (Kitchen's grout: 10 teeth `h` tall, 4/3 m pitch).
   */
  bump?: { kind: 'hump' | 'kicker' | 'washboard'; h: number; bumpToEdge: number };
}

export function sinkCourse(spec: SinkSpec): { course: Course; holeX0: number; farEdgeX: number } {
  const t = new Track(0, 10);
  t.speed(6).flat(16, 'plateau');
  if (spec.bump) {
    t.flat(Math.max(1, spec.runUp - spec.bump.bumpToEdge));
    if (spec.bump.kind === 'hump') t.hump(3, spec.bump.h);
    else if (spec.bump.kind === 'kicker') t.kicker(3, spec.bump.h, 1, spec.bump.h);
    else t.washboard(10, spec.bump.h, 4 / 3);
    if (spec.bump.bumpToEdge > 0) t.flat(spec.bump.bumpToEdge);
  } else {
    t.flat(spec.runUp);
  }
  t.gap(spec.width, -spec.rise).flat(20).line(0.3, -4).flat(10).finish();
  const a = t.build({ id: 'sink', name: 'Sink sweep', theme: 'kitchen' });
  const gap = a.features.find((f) => f.kind === 'gap')!;
  return { course: { levelId: 'sink', mode: 'level', level: a.level, source: new LevelChunkSource(a.level.terrain) }, holeX0: gap.x0, farEdgeX: gap.x1 };
}

export interface SinkAttempt {
  outcome: 'goal' | 'allLost' | 'stuck' | 'running';
  cartLost: boolean;
  /** The stuck hint showed at some point. */
  stuck: boolean;
  /** The cart got wholly past the hole: its rear passed the far edge (the far bevel's top). */
  crossed: boolean;
  /** Furthest the cart's REAR (world AABB minX) got. */
  rearMax: number;
  /** Furthest the cart's front got. */
  frontMax: number;
  /** Chassis speed as the front reached the hole's near edge (m/s). */
  vEdge: number;
  /** Chassis pitch (rad, positive = nose up) at the same moment. */
  pitchEdge: number;
}

/** Load, release, then drive `line` until the run ends or `seconds` pass (a player can keep pushing after the stuck hint, so this does too). */
export async function attemptSink(spec: SinkSpec, line: readonly PaceNote[], cart: CartDesign = exampleCart(), seconds = 30): Promise<SinkAttempt> {
  const { course, holeX0, farEdgeX } = sinkCourse(spec);
  const s = await RunSession.create(cart, course);
  try {
    s.start();
    for (let i = 0; i < 60; i++) s.step();
    s.release();
    for (let i = 0; i < 180; i++) s.step();
    const c = s.controller;
    let rearMax = -Infinity;
    let frontMax = -Infinity;
    let vEdge = NaN;
    let pitchEdge = NaN;
    let stuck = false;
    for (let n = 0; c.phase !== 'ended' && n < seconds * 60; n++) {
      s.setDrive(paceDrive(s, line));
      s.step();
      stuck ||= s.stuck;
      const b = c.cartBounds();
      if (!b) continue;
      rearMax = Math.max(rearMax, b.minX);
      frontMax = Math.max(frontMax, b.maxX);
      const h = c.cart.bodies.get(c.chassisId);
      if (Number.isNaN(vEdge) && b.maxX >= holeX0 && h !== undefined && s.world.hasBody(h)) {
        vEdge = s.world.getLinearVelocity(h).x;
        pitchEdge = -s.world.getTransform(h).angle;
      }
    }
    const last = s.events.at(-1);
    const outcome = last?.type === 'goalReached' ? 'goal' : last?.type === 'allLost' ? 'allLost' : stuck ? 'stuck' : 'running';
    return { outcome, cartLost: c.cartLost, stuck, crossed: rearMax >= farEdgeX, rearMax, frontMax, vEdge, pitchEdge };
  } finally {
    s.destroy();
  }
}

export const SWEEP_SPEEDS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, Infinity] as const;
export const sweepLine = (v: number): readonly PaceNote[] => (v === Infinity ? FLOOR_IT : [{ x: 0, speed: v }]);

/** One sweep case: never crosses, never soft-locks, and (`checkSpeed`, steady speeds) arrives at the speed it names. */
export async function expectNoCrossing(spec: SinkSpec, v: number, checkSpeed = false): Promise<void> {
  const r = await attemptSink(spec, sweepLine(v));
  expect(r.crossed, `rear got ${r.rearMax.toFixed(2)} m, past the far edge`).toBe(false);
  expect(r.outcome, 'the run ends (allLost) or the stuck hint shows').toMatch(/^(allLost|stuck)$/);
  if (!checkSpeed) return;
  if (v !== Infinity) expect(r.vEdge, 'approach speed at the hole').toBeGreaterThan(v - 0.6);
  else expect(r.vEdge, 'holding right arrives near top speed').toBeGreaterThan(15);
}
