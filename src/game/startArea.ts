/**
 * The start area every course shares (INTEGRATION.md #3 and #6), in one
 * place so the builder, the premade levels, the endless course and the
 * tests agree:
 *
 *  - Design frame (S2): design px, y-down, design y = 0 is the ground line,
 *    parts may be drawn in BUILD_AREA (x −20..340, y −210..0 px = 12 × 7 m).
 *  - `LevelDef.cartStart` is the WORLD position of design (0, 0): the ground
 *    at the left of the start plateau. The plateau must be flat (y =
 *    cartStart.y) across the whole build area plus a margin either side.
 *  - `LevelDef.funnel` (S1: the funnel OUTLET centre) sits at
 *    cartStart + FUNNEL_OFFSET_PX / 30, i.e. centred over the example cart's
 *    bed and just above the top of the build area, so no drawable part can
 *    ever overlap the funnel walls or its plug.
 */

import type { CartDesign } from '../model/cart';
import { STRAW_THICKNESS_PX } from '../model/cart';
import type { Vec2 } from '../model/geometry';
import { PX_PER_M } from '../model/coords';
import { BUILD_AREA } from '../builder/constants';

/** Funnel outlet centre relative to cartStart, design px (x = the example cart's bed centre). */
export const FUNNEL_OFFSET_PX: Readonly<Vec2> = { x: 115, y: BUILD_AREA.minY - 15 };

/** Flat plateau required either side of the build area (metres). */
export const PLATEAU_MARGIN_M = 1;

/** World funnel outlet for a cart start. */
export function funnelFor(cartStart: Vec2): Vec2 {
  return { x: cartStart.x + FUNNEL_OFFSET_PX.x / PX_PER_M, y: cartStart.y + FUNNEL_OFFSET_PX.y / PX_PER_M };
}

/** World x-range the start plateau must cover flat (build area + margins). */
export function plateauRange(cartStart: Vec2): { minX: number; maxX: number } {
  return {
    minX: cartStart.x + BUILD_AREA.minX / PX_PER_M - PLATEAU_MARGIN_M,
    maxX: cartStart.x + BUILD_AREA.maxX / PX_PER_M + PLATEAU_MARGIN_M,
  };
}

/** Lowest point (largest design y, px) any solid part of the design reaches; −Infinity when empty. */
export function designBottomPx(design: CartDesign): number {
  let bottom = -Infinity;
  for (const p of design.parts) {
    switch (p.kind) {
      case 'straw':
        bottom = Math.max(bottom, p.a.y + STRAW_THICKNESS_PX / 2, p.b.y + STRAW_THICKNESS_PX / 2);
        break;
      case 'cube': {
        const c = Math.abs(Math.cos(p.angle));
        const s = Math.abs(Math.sin(p.angle));
        bottom = Math.max(bottom, p.center.y + (p.width * s + p.height * c) / 2);
        break;
      }
      case 'lime':
      case 'wheel':
        bottom = Math.max(bottom, p.center.y + p.radius);
        break;
      case 'shock':
        break;
    }
  }
  return bottom;
}

/** Design-px position of a world point for a course starting at cartStart (builder backdrop). */
export function worldToDesignPx(p: Vec2, cartStart: Vec2): Vec2 {
  return { x: (p.x - cartStart.x) * PX_PER_M, y: (p.y - cartStart.y) * PX_PER_M };
}
