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
 * Flat run (x −10..44) ending in a 10 m wide, 3 m deep blender pit. Goal line
 * x 44; the base sensor fills the pit below 0.5 m under the lip.
 */
export function loadFlatGoalLevel(): LevelDef {
  return mustValidate(validateLevelDef(flatGoalLevelJson), 'flat-goal level');
}

export const fixtureJson = { cart: spikeCartJson, level: flatGoalLevelJson } as const;
