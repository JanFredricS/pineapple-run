/**
 * Ready-phase framing (S6T backlog #13). Before Release the camera shows the
 * whole funnel AND the cart waiting under it, instead of following the cart
 * with the funnel top off-screen. After Release it blends into the normal
 * follow camera over READY_BLEND_SECONDS. Pure (unit-tested); the run screen
 * feeds it world boxes and the viewport.
 */

import { PX_PER_M, type Camera } from '../model/coords';
import type { Vec2 } from '../model/geometry';

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Screen space reserved for the HUD (CSS px): chips/timer on top, Release at the bottom. */
export const READY_PAD = { top: 76, bottom: 100, side: 24 } as const;
/** World margin around the framed box, metres. */
export const READY_MARGIN_M = 0.6;
/** Blend from the ready frame to the follow camera after Release. */
export const READY_BLEND_SECONDS = 0.9;
/** Never zoom out further than this (the scene stays legible on a phone). */
export const READY_MIN_ZOOM = 0.35;

export function boxOf(points: readonly Vec2[]): Box {
  const b: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of points) {
    b.minX = Math.min(b.minX, p.x);
    b.minY = Math.min(b.minY, p.y);
    b.maxX = Math.max(b.maxX, p.x);
    b.maxY = Math.max(b.maxY, p.y);
  }
  return b;
}

/**
 * Centre + zoom that fit `box` (plus margin) inside the viewport minus the
 * HUD pads, at most `maxZoom` (the normal follow zoom — framing only ever
 * zooms OUT).
 */
export function frameBox(box: Box, viewportWidth: number, viewportHeight: number, maxZoom: number): { center: Vec2; zoom: number } {
  const m = READY_MARGIN_M;
  const w = box.maxX - box.minX + 2 * m;
  const h = box.maxY - box.minY + 2 * m;
  const availW = Math.max(1, viewportWidth - 2 * READY_PAD.side);
  const availH = Math.max(1, viewportHeight - READY_PAD.top - READY_PAD.bottom);
  const zoom = Math.max(READY_MIN_ZOOM, Math.min(maxZoom, availW / (w * PX_PER_M), availH / (h * PX_PER_M)));
  // centre the box in the padded area: shift by half the pad difference
  const k = PX_PER_M * zoom;
  const cy = (box.minY + box.maxY) / 2 - (READY_PAD.top - READY_PAD.bottom) / 2 / k;
  return { center: { x: (box.minX + box.maxX) / 2, y: cy }, zoom };
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * The camera to render. `ready` = the ready frame (null once it no longer
 * applies); `sinceRelease` = sim seconds since Release (null before it).
 */
export function blendCamera(follow: Camera, ready: { center: Vec2; zoom: number } | null, sinceRelease: number | null): Camera {
  if (!ready) return follow;
  const t = sinceRelease === null ? 0 : Math.min(1, Math.max(0, sinceRelease / READY_BLEND_SECONDS));
  if (t >= 1) return follow;
  const e = smooth(t);
  return {
    ...follow,
    center: { x: ready.center.x + (follow.center.x - ready.center.x) * e, y: ready.center.y + (follow.center.y - ready.center.y) * e },
    zoom: ready.zoom + (follow.zoom - ready.zoom) * e,
  };
}
