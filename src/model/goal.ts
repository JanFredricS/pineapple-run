/**
 * The standard goal blender, shared by every course (the premade Track DSL
 * courses, the recovered original, generated finite levels) and the
 * renderer, so the solid collider and the drawn blender always agree.
 *
 * UX1 (Jan: "The blender is way too small, it looks like an ordinary size
 * blender"): the goal is a landmark you drive into — the 2008 original ended
 * in a giant container — so the blender is BLENDER_SCALE times its S6 size
 * (1.5 × 3.6 m -> 3.75 × 9 m). The pit floor grows with it: the free floor in
 * FRONT of the blender (where the cart and its load drop in) and the gap
 * behind it keep their S6 lengths, so the approach, the lip and the goal
 * sensor's first metres are unchanged.
 */

import type { Vec2 } from './geometry';

/** The S6 blender body (m), before UX1. */
export const BLENDER_S6_SIZE: Readonly<Vec2> = { x: 1.5, y: 3.6 };
/** UX1: linear scale of the goal blender over its S6 size. */
export const BLENDER_SCALE = 2.5;
/** Solid body of the standard goal blender (m): width × height; the drawn blender is exactly this tall. */
export const BLENDER_SIZE: Readonly<Vec2> = { x: BLENDER_S6_SIZE.x * BLENDER_SCALE, y: BLENDER_S6_SIZE.y * BLENDER_SCALE };
/** Pit floor behind the blender, up to the pit's back wall (m; the S6 gap). */
export const BLENDER_BACK_GAP = 1.75;

/**
 * Pit floor length for a pit with `frontGap` metres of free floor before the
 * blender's front face: front gap + blender + back gap.
 */
export function blenderPitFloor(frontGap: number): number {
  return frontGap + BLENDER_SIZE.x + BLENDER_BACK_GAP;
}
