/**
 * Solid LevelDef props -> static physics bodies (S1 world construction).
 *
 * PropDef contract: props are visual-only unless `solid` is set, in which
 * case they are a static box of `size`. S1 interprets `position` as the box
 * CENTRE and `angle` as its rotation about that centre (radians, y-down), the
 * usual Box2D box convention. A solid prop without a usable size (missing, or
 * a non-positive dimension) is skipped — the validator does not require it.
 *
 * The blender is expected to be one of these, so cart parts bounce off it as
 * in the original.
 */

import type { Vec2 } from '../model/geometry';
import type { PropDef } from '../model/level';
import type { BodyHandle, PhysicsWorld } from '../physics/engine';
import { boxPolygon } from './shapes';

/** Solid props share the terrain's feel: grippy, a little bouncy. */
export const SOLID_PROP_MATERIAL = { friction: 0.6, restitution: 0.3 } as const;

export interface SolidProp {
  id: string;
  handle: BodyHandle;
  /** World polygon (for geometric support queries). */
  polygon: Vec2[];
}

export function isSolidProp(p: PropDef): p is PropDef & { solid: true; size: Vec2 } {
  return p.solid === true && !!p.size && p.size.x > 0 && p.size.y > 0;
}

export function buildSolidProps(world: PhysicsWorld, props: readonly PropDef[]): SolidProp[] {
  const out: SolidProp[] = [];
  for (const p of props) {
    if (!isSolidProp(p)) continue;
    const polygon = boxPolygon(p.position, p.size, p.angle ?? 0);
    const handle = world.createBody({ type: 'static', position: { x: 0, y: 0 }, role: 'prop', partIds: [p.id] });
    world.addPolygon(handle, polygon, SOLID_PROP_MATERIAL, p.id);
    out.push({ id: p.id, handle, polygon });
  }
  return out;
}
