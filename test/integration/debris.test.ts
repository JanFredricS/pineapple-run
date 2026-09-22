/**
 * INTEGRATION #13 (kill-plane semantics / debris growth), S6 coverage:
 * a spring-heavy cart sheds parts during an endless run, then keeps driving
 * for thousands of steps. Debris must not accumulate: detached parts are not
 * streaming anchors, so their terrain unloads behind the cart, they fall past
 * killY and the controller removes them; world bodies and the render
 * manifest stay bounded with no per-step growth.
 *
 * The crash is scripted (no src/physics change): the shocks holding the
 * front arm are destroyed (a clean sever, no spring yank on the chassis) and
 * the arm is teleported just below killY through the raw Box2D binding — the
 * "a non-chassis part crossed the kill plane" case. Its tip, held only by the
 * arm, is left behind as genuine debris.
 */
import { describe, expect, it } from 'vitest';
import { exampleCart } from '../../src/builder/exampleCart';
import { courseFor } from '../../src/game/courses';
import { RunSession } from '../../src/game/session';
import type { CartDesign } from '../../src/model/cart';
import type { BodyHandle, PhysicsWorld } from '../../src/physics/engine';

/** Example cart + a spring-held front arm (A) carrying a tip (T) held only by A. */
function sheddingCart(): CartDesign {
  const d = exampleCart();
  d.parts.push(
    { id: 'arm', kind: 'cube', center: { x: 235, y: -70 }, width: 40, height: 20, angle: 0 },
    { id: 'tip', kind: 'cube', center: { x: 290, y: -70 }, width: 30, height: 20, angle: 0 },
    // arm <- frame: two shocks from the right rail (knee and bed end)
    { id: 'arm-s1', kind: 'shock', a: { x: 187, y: -96 }, b: { x: 220, y: -75 } },
    { id: 'arm-s2', kind: 'shock', a: { x: 163, y: -43 }, b: { x: 220, y: -65 } },
    // tip <- arm only
    { id: 'tip-s1', kind: 'shock', a: { x: 250, y: -75 }, b: { x: 280, y: -75 } },
    { id: 'tip-s2', kind: 'shock', a: { x: 250, y: -65 }, b: { x: 280, y: -65 } },
  );
  return d;
}

/** Test-only teleport through the raw binding (PhysicsWorld has no setTransform by design). */
function teleport(world: PhysicsWorld, h: BodyHandle, x: number, y: number): void {
  const raw = world as unknown as {
    b2: { b2Body_SetTransform(id: unknown, p: unknown, q: unknown): void; b2Vec2: new (x: number, y: number) => { delete(): void }; b2MakeRot(a: number): { delete(): void } };
    body(h: BodyHandle): { id: unknown };
  };
  const p = new raw.b2.b2Vec2(x, y);
  const q = raw.b2.b2MakeRot(0);
  raw.b2.b2Body_SetTransform(raw.body(h).id, p, q);
  p.delete();
  q.delete();
  world.setLinearVelocity(h, { x: 0, y: 0 });
}

describe('INTEGRATION #13: debris over a long endless run', () => {
  it('shed parts become bounded debris that is cleared; body counts do not grow', async () => {
    const course = courseFor('endless:ABC123')!;
    const s = await RunSession.create(sheddingCart(), course);
    try {
      const c = s.controller;
      const bodyOf = (part: string) => c.cart.bodies.get(c.spec.partBody.get(part)!)!;
      const arm = bodyOf('arm');
      const tip = bodyOf('tip');
      const chassis = c.cart.bodies.get(c.chassisId)!;
      expect(new Set([arm, tip, chassis]).size).toBe(3);
      const cartTotal = c.spec.bodies.length;

      const cartAlive = () => c.spec.bodies.filter((b) => s.world.hasBody(c.cart.bodies.get(b.id)!)).length;
      const drive = () => {
        if (!s.world.hasBody(chassis)) return s.setDrive(0);
        const v = s.world.getLinearVelocity(chassis).x;
        s.setDrive(v < 5 ? 1 : v > 6.5 ? -1 : 0);
      };

      s.start();
      for (let i = 0; i < 60; i++) s.step();
      s.release();
      for (let i = 0; i < 180; i++) s.step();
      for (let i = 0; i < 60 * 4; i++) {
        drive();
        s.step();
      }
      expect(cartAlive()).toBe(cartTotal);
      expect(c.cartDamaged).toBe(false);

      // ---- scripted crash: sever the arm and drop it past the kill plane
      for (const id of ['arm-s1', 'arm-s2', 'tip-s1', 'tip-s2']) s.world.destroyJoint(c.cart.shockJoints.get(id)!);
      const armX = s.world.getTransform(arm).x;
      teleport(s.world, arm, armX, c.level.killY + 5);
      s.step();

      expect(s.world.hasBody(arm)).toBe(false); // removed by the kill plane
      expect(c.cartDamaged).toBe(true);
      expect(c.cartLost).toBe(false);
      expect(s.world.hasBody(tip)).toBe(true); // debris: alive but detached
      expect(c.cartBodyHandles()).not.toContain(tip);
      expect(c.cartBodyHandles()).toContain(chassis);
      const shedAt = s.world.getTransform(tip).x;

      // ---- keep driving for a long time; nothing may accumulate
      const STEPS = 60 * 120; // 2 minutes of sim time
      const worldCounts: number[] = [];
      let prevCart = cartAlive();
      let tipGoneAt = -1;
      for (let n = 0; n < STEPS && c.phase === 'released'; n++) {
        drive();
        s.step();
        const cart = cartAlive();
        expect(cart).toBeLessThanOrEqual(prevCart); // debris never re-appears / multiplies
        prevCart = cart;
        if (tipGoneAt < 0 && !s.world.hasBody(tip)) tipGoneAt = n;
        if (n % 60 === 0) {
          const bodies = s.world.bodyHandles().length;
          expect(s.world.manifest().bodies.length).toBe(bodies); // render view matches the world
          worldCounts.push(bodies);
        }
      }

      const cartX = s.world.getTransform(chassis).x;
      expect(cartX - shedAt).toBeGreaterThan(80); // the cart really left the debris behind
      expect(tipGoneAt).toBeGreaterThanOrEqual(0); // the debris fell out once its terrain unloaded
      expect(prevCart).toBe(cartTotal - 2); // arm + tip gone, the rest of the cart intact

      // Bounded: the world never holds more than it did around the shed, and
      // the second half of the run is no bigger than the first (no growth).
      const half = Math.floor(worldCounts.length / 2);
      const early = Math.max(...worldCounts.slice(0, half));
      const late = Math.max(...worldCounts.slice(half));
      expect(late).toBeLessThanOrEqual(early);
      console.info(`[#13] shed at x=${shedAt.toFixed(1)}, debris cleared after ${(tipGoneAt / 60).toFixed(1)} s, cart x=${cartX.toFixed(1)}, bodies early max ${early} / late max ${late}, phase ${c.phase}`);
    } finally {
      s.destroy();
    }
  }, 180_000);
});
