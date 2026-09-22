/**
 * Minimal LevelDef terrain -> physics (S0). One static body, one one-sided
 * chain per span, so gaps between spans are real holes. S3 replaces this with
 * chunked streaming terrain built from the same spans.
 */

import type { TerrainDef } from '../model/level';
import type { BodyHandle, PhysicsWorld } from './engine';

export function buildTerrain(world: PhysicsWorld, terrain: TerrainDef): BodyHandle {
  const ground = world.createBody({ type: 'static', position: { x: 0, y: 0 }, role: 'terrain' });
  for (const span of terrain.spans) {
    world.addChain(ground, span.points, { friction: terrain.friction, restitution: terrain.restitution });
  }
  return ground;
}
