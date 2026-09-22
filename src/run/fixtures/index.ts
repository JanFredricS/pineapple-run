/**
 * S1 harness / scenario fixtures, loaded through the production validation
 * path (model/validate). Pure — no physics imports.
 *
 * spike-cart.json / open-bed-cart.json are copies of the S0 spike carts so
 * S1 does not depend on src/spike, which is throwaway.
 */

import type { CartDesign } from '../../model/cart';
import type { LevelDef } from '../../model/level';
import { validateCartDesign, validateLevelDef, type ValidationResult } from '../../model/validate';
import flatGoalLevelJson from './flat-goal-level.json';
import openBedCartJson from './open-bed-cart.json';
import spikeCartJson from './spike-cart.json';

function mustValidate<T>(r: ValidationResult<T>, what: string): T {
  if (!r.ok) throw new Error(`${what} failed validation: ${r.error.message}`);
  return r.value;
}

/** The S0 spike cart: 12-straw chassis with end rails, 4 powered wheels. */
export function loadFixtureCart(): CartDesign {
  return mustValidate(validateCartDesign(spikeCartJson), 'fixture cart');
}

/** Same chassis without the end rails: a flat open bed that spills its load. */
export function loadOpenBedCart(): CartDesign {
  return mustValidate(validateCartDesign(openBedCartJson), 'open-bed cart');
}

/**
 * Flat run (y 10, x −10..44) ending in the blender pit: an 8 m deep hole
 * (floor y 18) whose far side is the solid blender prop (static box x 52..54,
 * y 7..18 — cart parts bounce off it) plus a solid 0.5 × 3 m blade standing
 * on the floor at x 49.5 (a cart landing in the pit tips on it and spills,
 * so any arrival speed ends the run — measured over cruise 2..10 m/s, full
 * throttle and coasting profiles). Goal line x 44; the base sensor is a
 * 0.25 m strip lying on the pit floor (x 44.1..52), so only a pineapple that
 * reaches the base ends the run. killY 40.
 */
export function loadFlatGoalLevel(): LevelDef {
  return mustValidate(validateLevelDef(flatGoalLevelJson), 'flat-goal level');
}
