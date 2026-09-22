import type { Vec2 } from '../../src/model/geometry';

/**
 * The S3 audit round 2 seam profile: flat to exactly x = 40 (a chunk
 * boundary), then a 45° incline sampled every 5 mm for 1 m (no segment long
 * enough for an interpolated cut within MAX_CUT_SHIFT). The incline then
 * continues straight (one long segment) up to x = 46 before levelling off, so
 * a body climbs, stops and rolls BACK across the seam instead of launching off
 * a crest right after it (a launch amplifies harmless solver-order noise
 * between one chain and several chains; see the diagnosis in the S3 fix-2 report).
 */
export function auditorProfile(): Vec2[] {
  const span: Vec2[] = [{ x: -5, y: 10 }];
  for (let i = 0; i <= 200; i++) span.push({ x: 40 + i * 0.005, y: 10 - i * 0.005 });
  span.push({ x: 46, y: 4 });
  span.push({ x: 120, y: 4 });
  return span;
}

/**
 * The convex mirror of auditorProfile: flat to exactly x = 40, then a 45°
 * DECLINE sampled every 5 mm for 1 m, continuing straight to x = 43. A wrong
 * ghost direction matters physically at convex transitions like this one (at
 * a concave one the neighbouring chain's surface masks it).
 */
export function auditorProfileConvex(): Vec2[] {
  const span: Vec2[] = [{ x: -5, y: 10 }];
  for (let i = 0; i <= 200; i++) span.push({ x: 40 + i * 0.005, y: 10 + i * 0.005 });
  span.push({ x: 43, y: 13 });
  span.push({ x: 120, y: 13 });
  return span;
}
