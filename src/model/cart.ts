/**
 * CartDesign schema (S0 contract 1). Versioned JSON produced by the builder
 * (S2), stored in localStorage, and turned into physics by
 * `resolveAttachments` (model/attach.ts) + physics/compound.ts.
 *
 * Units: DESIGN PIXELS, y-down, in the builder's start-area frame
 * (30 design px = 1 m, see model/coords.ts). Pixels are used here because all
 * of the original's drawing rules (5 px straws, 10 px shock snap, minimum
 * part sizes) are expressed in pixels. Conversion to metres happens once, in
 * resolveAttachments.
 *
 * Draw order matters: `parts` is ordered oldest -> newest. "Topmost" means the
 * part with the highest index (most recently drawn).
 */

import type { Vec2 } from './geometry';

export const CART_DESIGN_VERSION = 1 as const;

/** Straw thickness in design px (the original's 5 px line). */
export const STRAW_THICKNESS_PX = 5;
/** Minimum straw length / circle radius, in design px (original: 5 px). */
export const MIN_PART_SIZE_PX = 5;
/** Minimum sugar-cube side, in design px (original: 7 px boxes). */
export const MIN_CUBE_SIZE_PX = 7;
/** A shock end within this distance of a wheel/lime centre snaps to it. */
export const SHOCK_SNAP_PX = 10;
/** Hard cap on part count; validate.ts rejects larger designs. */
export const MAX_PARTS = 400;

export type PartKind = 'straw' | 'cube' | 'lime' | 'wheel' | 'shock';

interface PartBase {
  /** Unique within the design. Stable across edits (builder assigns it). */
  id: string;
}

/** Thin rigid bar between two points (welds with overlapping parts). */
export interface StrawPart extends PartBase {
  kind: 'straw';
  a: Vec2;
  b: Vec2;
}

/** Sugar cube: rectangle, any size and angle (welds with overlapping parts). */
export interface CubePart extends PartBase {
  kind: 'cube';
  center: Vec2;
  width: number;
  height: number;
  /** Radians, clockwise-positive on screen (y-down). */
  angle: number;
}

/** Lime slice: unpowered circle (welds with overlapping straws/cubes/limes). */
export interface LimePart extends PartBase {
  kind: 'lime';
  center: Vec2;
  radius: number;
}

/**
 * Bottle-cap wheel: powered circle. Never welds; if its centre lies over
 * another part it is pinned (revolute joint) to the topmost such part.
 */
export interface WheelPart extends PartBase {
  kind: 'wheel';
  center: Vec2;
  radius: number;
}

/** Shock (coil spring, drawn as a Hawthorne-strainer coil): spring (distance joint) between two attachment points. */
export interface ShockPart extends PartBase {
  kind: 'shock';
  a: Vec2;
  b: Vec2;
}

export type CartPart = StrawPart | CubePart | LimePart | WheelPart | ShockPart;

export interface CartDesign {
  version: typeof CART_DESIGN_VERSION;
  /** Optional human name (saved carts). */
  name?: string;
  parts: CartPart[];
}

/** Remove a part; callers must re-run resolveAttachments on the result. */
export function deletePart(design: CartDesign, partId: string): CartDesign {
  return { ...design, parts: design.parts.filter((p) => p.id !== partId) };
}
