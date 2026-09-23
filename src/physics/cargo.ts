/**
 * Pineapple cargo bodies. Collision is a circle (sprite may be oval — PLAN.md
 * deliberate deviation 3). S1 owns the funnel/spawner; S0 only needs the
 * body recipe.
 */

import type { Vec2 } from '../model/geometry';
import type { BodyHandle, PhysicsWorld } from './engine';
import { installSurfacePairs, SURFACE } from './surfaces';

/** ~20 px coconut in the original => radius 10 px = 1/3 m. */
export const PINEAPPLE_RADIUS = 1 / 3;
export const PINEAPPLE_MATERIAL = {
  density: 1,
  friction: 0.9,
  restitution: 0.3,
  /**
   * Box2D v3 rolling resistance (deliberate deviation 2). Tuned in the S0
   * spike: pineapples stop rolling on flats but an open flat bed still spills
   * on the washboard (see test/physics/scenarios.test.ts).
   */
  rollingResistance: 0.1,
  /** S8a: pineapple–wheel contacts use PINEAPPLE_WHEEL_FRICTION (surfaces.ts). */
  surface: SURFACE.pineapple,
} as const;

export function spawnPineapple(world: PhysicsWorld, position: Vec2, angle = 0, velocity?: Vec2): BodyHandle {
  installSurfacePairs(world);
  const h = world.createBody({
    type: 'dynamic',
    position,
    angle,
    bullet: true, // CCD on (original: isBullet)
    role: 'pineapple',
    ...(velocity ? { linearVelocity: velocity } : {}),
  });
  world.addCircle(h, { x: 0, y: 0 }, PINEAPPLE_RADIUS, PINEAPPLE_MATERIAL, 'pineapple');
  return h;
}
