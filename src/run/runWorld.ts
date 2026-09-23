/**
 * The one place a run's physics world is configured from its level (S9
 * audit-1 #2). A level with gravity / force zones needs a world whose dynamic
 * shapes are sensor visitors (else ZoneField refuses it: no body could ever
 * enter a zone); every other level gets the default world, created exactly
 * as before S9. RunSession (the game) and the run harness page both build
 * their worlds through here, so an arbitrary loaded level behaves the same in
 * both.
 */

import type { CartDesign } from '../model/cart';
import type { LevelDef } from '../model/level';
import { isFieldZone } from '../model/zones';
import { PhysicsWorld, type WorldOptions } from '../physics/engine';
import { RunController, type RunControllerOptions } from './controller';

/** World options for running `level`: sensor visitors only when it has field zones. */
export function worldOptionsForLevel(level: Pick<LevelDef, 'zones'>): WorldOptions {
  return level.zones.some(isFieldZone) ? { sensorVisitors: true } : {};
}

/** A fresh world for `level` plus its RunController. Throws (and frees the world) if the run cannot be built. */
export async function createRun(design: CartDesign, level: LevelDef, options: RunControllerOptions = {}): Promise<{ world: PhysicsWorld; run: RunController }> {
  const world = await PhysicsWorld.create(worldOptionsForLevel(level));
  try {
    return { world, run: new RunController(world, design, level, options) };
  } catch (err) {
    world.destroy();
    throw err;
  }
}
