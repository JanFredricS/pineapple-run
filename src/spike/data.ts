/**
 * S0 spike data: hand-written CartDesign / LevelDef JSON, loaded through the
 * production validation path (model/validate). Pure — no physics imports.
 */

import type { CartDesign } from '../model/cart';
import type { LevelDef } from '../model/level';
import { validateCartDesign, validateLevelDef, type ValidationResult } from '../model/validate';
import spikeCartJson from './spike-cart.json';
import openBedCartJson from './open-bed-cart.json';
import spikeLevelJson from './spike-level.json';

function mustValidate<T>(r: ValidationResult<T>, what: string): T {
  if (!r.ok) throw new Error(`${what} failed validation: ${r.error.message}`);
  return r.value;
}

/** 12-straw chassis (bed, end rails, truss), 4 powered wheels. */
export function loadSpikeCart(): CartDesign {
  return mustValidate(validateCartDesign(spikeCartJson), 'spike cart');
}

/** Same chassis without the end rails: a flat open bed (washboard spill test). */
export function loadOpenBedCart(): CartDesign {
  return mustValidate(validateCartDesign(openBedCartJson), 'open-bed cart');
}

/** Flat run-up, washboard (9 bumps, 0.5 m tall, 1.33 m apart), bump, flat. */
export function loadSpikeLevel(): LevelDef {
  return mustValidate(validateLevelDef(spikeLevelJson), 'spike level');
}
