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

/**
 * Flat to x = 40, then a convex corner rounded by a DENSE arc (6 mm x steps,
 * every vertex turning convexly by a small, varying angle) over ~0.9 m, then a
 * straight 45° decline. No vertex in the fallback window is straight or
 * concave, and no segment is splittable: the seam is a convex vertex seam.
 */
export function denseArcCorner(): Vec2[] {
  const span: Vec2[] = [{ x: -5, y: 10 }];
  let slope = 0;
  let y = 10;
  for (let i = 0; i <= 200; i++) {
    const x = 40 + i * 0.006;
    if (i > 0) y += 0.006 * slope;
    span.push({ x, y });
    slope = Math.min(1, slope + 0.004 + (i % 3) * 0.002);
    if (slope >= 1) break;
  }
  const last = span.at(-1)!;
  span.push({ x: last.x + 3, y: last.y + 3 });
  span.push({ x: 120, y: last.y + 3 });
  return span;
}

/** The audit S3-3 #1 comb: x step 5 mm from x0 to x1, y alternating lo/hi (every turn ≈ 179.7°), long flats outside. */
export function zigZagComb(x0: number, x1: number, lo: number, hi: number): Vec2[] {
  const span: Vec2[] = [{ x: x0 - 30, y: lo }];
  for (let i = 0; x0 + i * 0.005 <= x1; i++) span.push({ x: x0 + i * 0.005, y: i % 2 ? hi : lo });
  span.push({ x: x1 + 30, y: lo });
  return span;
}

/**
 * Flat to x = 40, then 1 m of 6 mm segments whose slope alternates 0.3 / 0
 * (going down), i.e. alternating convex and concave kinks of ~17°, then a
 * straight slope. No vertex near x = 40 is straight or splittable.
 */
export function denseKinks(): Vec2[] {
  const span: Vec2[] = [{ x: -5, y: 10 }];
  let y = 10;
  for (let i = 0; i <= 170; i++) {
    span.push({ x: 40 + i * 0.006, y });
    y += 0.006 * (i % 2 ? 0 : 0.3);
  }
  const last = span.at(-1)!;
  span.push({ x: last.x + 3, y: last.y + 1 });
  span.push({ x: 120, y: last.y + 1 });
  return span;
}

/** Round-4 auditor: only the ~176 degree crest has 5 cm of tail clearance. */
export function truncatedWindowProfile(): Vec2[] {
  const pts = [{ x: 38, y: 10.006 }, { x: 39.9998, y: 10.006 }, { x: 40, y: 10 }, { x: 40.0002, y: 10.006 }];
  for (let i = 1; i <= 10; i++) pts.push({ x: 40.0002 + i * 0.00499, y: 10.006 + (i % 2) * 0.004 });
  return pts; // end x=40.0501; all dense segments 6–6.4 mm, preserved by sanitization
}
