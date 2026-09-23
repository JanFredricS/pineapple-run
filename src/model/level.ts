/**
 * LevelDef schema (S0 contract 1). Versioned JSON authored in the map builder
 * (tools/mapbuilder, S3), shipped in levels/*.json, and validated by
 * model/validate.ts before anything touches physics.
 *
 * Units: METRES, y-down (gravity is +y), world frame.
 *
 * Terrain is a list of polyline SPANS, not one height profile, so gaps are
 * first-class: the space between two spans is a real hole in physics and in
 * visuals. Each span's points run strictly left -> right (increasing x); the
 * solid side is below the line (+y). Adjacent spans may share an endpoint
 * (no gap) or leave a horizontal gap.
 */

import type { Vec2 } from './geometry';

export const LEVEL_DEF_VERSION = 1 as const;

export type ThemeId = 'beach' | 'kitchen' | 'workbench' | 'test';
export const THEME_IDS: readonly ThemeId[] = ['beach', 'kitchen', 'workbench', 'test'];

export interface TerrainSpan {
  id: string;
  /** >= 2 points, strictly increasing x, metres, y-down. */
  points: Vec2[];
}

export interface TerrainDef {
  spans: TerrainSpan[];
  /** Surface material; defaults are the original's (0.9 / 0.3). */
  friction: number;
  restitution: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ZoneKind = 'gravity' | 'force';

/**
 * Zone regions (used by the S9 gravity-zones stretch level). A gravity zone
 * scales gravity for bodies inside it; a force zone applies a constant force
 * (N per kg, i.e. an acceleration) in `force`.
 */
export interface ZoneDef {
  id: string;
  kind: ZoneKind;
  rect: Rect;
  /** gravity zones: multiplier on world gravity (0 = weightless). */
  gravityScale?: number;
  /** force zones: acceleration vector, m/s^2. */
  force?: Vec2;
}

/** Decorative/interactive props placed by the map builder (theme art ids). */
export interface PropDef {
  id: string;
  /** Art id resolved by the renderer (S4), e.g. "palm", "blender". */
  art: string;
  position: Vec2;
  angle?: number;
  scale?: number;
  /** Props are visual-only unless `solid` is set (then a static box of `size`). */
  solid?: boolean;
  size?: Vec2;
}

/**
 * The ONE rule for "this prop is a physics body" (S6V): `solid` AND a size
 * with strictly positive, finite components. Shared by the validator (which
 * rejects a solid prop failing it), the physics builder (src/run/props.ts,
 * which builds exactly these) and the renderer (which draws a solid prop only
 * when it is one of these), so the three can never disagree.
 */
export function hasSolidBody(p: Pick<PropDef, 'solid' | 'size'>): p is { solid: true; size: Vec2 } {
  return p.solid === true && !!p.size && Number.isFinite(p.size.x) && Number.isFinite(p.size.y) && p.size.x > 0 && p.size.y > 0;
}

export interface LevelDef {
  version: typeof LEVEL_DEF_VERSION;
  id: string;
  name: string;
  theme: ThemeId;
  terrain: TerrainDef;
  /** World position (metres) of the cart design's origin (design px 0,0). */
  cartStart: Vec2;
  /** Where the funnel releases the 15 pineapples (metres). */
  funnel: Vec2;
  /** Goal: the blender. `sensor` is the base sensor; `lineX` the counting line. */
  goal: { sensor: Rect; lineX: number };
  props: PropDef[];
  zones: ZoneDef[];
  /** Bodies with y greater than this (metres) are considered lost. */
  killY: number;
}

export const DEFAULT_TERRAIN_FRICTION = 0.9;
export const DEFAULT_TERRAIN_RESTITUTION = 0.3;
