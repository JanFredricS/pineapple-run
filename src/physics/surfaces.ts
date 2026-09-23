/**
 * Surface ids and pairwise friction overrides (S8a, backlog #9).
 *
 * Box2D mixes contact friction as sqrt(fA · fB). Pineapples and wheels are
 * both 0.9, so a pineapple pressed against a wheel gripped it at ~0.9 and a
 * pile of them braked the wheel to a stop. Only that pair is overridden to
 * PINEAPPLE_WHEEL_FRICTION; every other pair keeps the default mix:
 *   pineapple–terrain  sqrt(0.9 · 0.9) = 0.9
 *   wheel–terrain      sqrt(0.9 · 0.9) = 0.9
 *   pineapple–part     sqrt(0.9 · 0.6) ≈ 0.735
 *   pineapple–wheel    0.9 → 0.3 (override)
 * (Terrain chains in the game are created with friction 0.9.)
 */
import type { PhysicsWorld } from './engine';

export const SURFACE = {
  pineapple: 1,
  wheel: 2,
} as const;

/** Pineapple–wheel contact friction (was the default mix 0.9). */
export const PINEAPPLE_WHEEL_FRICTION = 0.3;

/** Register the game's pair overrides on a world. Idempotent; cheap. */
export function installSurfacePairs(world: PhysicsWorld): void {
  world.setPairFriction(SURFACE.pineapple, SURFACE.wheel, PINEAPPLE_WHEEL_FRICTION);
}
