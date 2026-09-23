/**
 * Ready-phase framing (S6T backlog #13). Before Release the camera shows the
 * whole funnel AND the cart waiting under it, instead of following the cart
 * with the funnel top off-screen. After Release it blends into the normal
 * follow camera over READY_BLEND_SECONDS. Pure (unit-tested); the run screen
 * feeds it world boxes and the viewport.
 *
 * The cart box is the union of every cart body's real shape AABB
 * (bodyAabb: polygon vertices and circle extents at the body's pose), not
 * the body origins: a long straw or a big wheel reaches metres past its
 * body's origin.
 *
 * Far from the funnel (S6T audit-1 #3): a cart may be driven before
 * Release. While funnel + cart fit at READY_MIN_ZOOM or closer, both are
 * framed. Beyond that the CART wins: the frame drops the funnel and shows
 * the cart alone (it is what the player is steering; the funnel is fixed and
 * comes back into frame as soon as the cart returns). The cart itself is
 * always fitted, even below READY_MIN_ZOOM if a huge cart needs it.
 *
 * UX1 look-ahead (Jan: "70% free air camera [..x.....]"): after the ready
 * blend the run camera places the cart LOOK_AHEAD_FRACTION (30%) from the
 * LEFT edge of the screen, so ~70% of the view shows the course ahead.
 * Horizontal only: the vertical follow is still the run controller's camera
 * (right-most body y, smoothing 0.1). The placement is fixed to the forward
 * (+x) direction, also while reversing — see LookAheadFollow.
 *
 * UX1 finish framing (audit-1 #2): the 9 m goal blender is taller than half
 * a short landscape phone's view, so as the blender comes into view the
 * follow camera eases (over FINISH_RAMP_M of travel) into a frame that holds
 * the WHOLE blender and the cart: it raises/lowers the look point within
 * the room it has, and zooms out only if blender + cart cannot fit at the
 * follow zoom. The cart stays at LOOK_AHEAD_FRACTION throughout. `runCamera`
 * composes follow -> finish -> ready blend; the run screen renders it.
 */

import { PX_PER_M, type Camera } from '../model/coords';
import type { Vec2 } from '../model/geometry';
import { BLENDER_SIZE } from '../model/goal';
import { hasSolidBody, type LevelDef } from '../model/level';
import type { RenderBodyInfo, RenderShape } from '../model/snapshot';

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

const rotate = (t: { x: number; y: number; angle: number }, p: Vec2): Vec2 => {
  const c = Math.cos(t.angle);
  const s = Math.sin(t.angle);
  return { x: t.x + c * p.x - s * p.y, y: t.y + s * p.x + c * p.y };
};

/**
 * World AABB of a body's shapes (metres, local to the body origin) at pose
 * `t` — the same transform as physics/engine applyTransform. Null when the
 * body has no boundable shapes.
 */
export function bodyAabb(shapes: readonly RenderShape[], t: { x: number; y: number; angle: number }): Box | null {
  const pts: Vec2[] = [];
  for (const sh of shapes) {
    if (sh.type === 'circle') {
      const c = rotate(t, sh.center);
      pts.push({ x: c.x - sh.radius, y: c.y - sh.radius }, { x: c.x + sh.radius, y: c.y + sh.radius });
    } else if (sh.type === 'polygon') {
      for (const v of sh.vertices) pts.push(rotate(t, v));
    } else {
      for (const v of sh.points) pts.push(rotate(t, v));
    }
  }
  return pts.length ? boxOf(pts) : null;
}

/** Union of the shape AABBs of the bodies in `ids` (manifest entries), at their current poses; null if none. */
export function bodiesBox(
  bodies: readonly RenderBodyInfo[],
  ids: Iterable<number>,
  poseOf: (id: number) => { x: number; y: number; angle: number },
): Box | null {
  const want = new Set(ids);
  let b: Box | null = null;
  for (const info of bodies) {
    if (!want.has(info.id)) continue;
    const a = bodyAabb(info.shapes, poseOf(info.id));
    if (a) b = b ? unionBox(b, a) : a;
  }
  return b;
}

export function unionBox(a: Box, b: Box): Box {
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

/** Zoom that fits `box` (plus margin) inside the padded viewport, before any clamping. */
export function fitZoom(box: Box, viewportWidth: number, viewportHeight: number): number {
  const m = READY_MARGIN_M;
  const w = box.maxX - box.minX + 2 * m;
  const h = box.maxY - box.minY + 2 * m;
  const availW = Math.max(1, viewportWidth - 2 * READY_PAD.side);
  const availH = Math.max(1, viewportHeight - READY_PAD.top - READY_PAD.bottom);
  return Math.min(availW / (w * PX_PER_M), availH / (h * PX_PER_M));
}

/**
 * The ready frame: funnel + cart when they fit at READY_MIN_ZOOM or closer,
 * otherwise the cart alone (see the module doc). `cart` null (no cart body
 * left) frames the funnel.
 */
export function readyFrame(
  funnel: Box,
  cart: Box | null,
  viewportWidth: number,
  viewportHeight: number,
  maxZoom: number,
): { center: Vec2; zoom: number; framed: 'both' | 'cart' | 'funnel' } {
  if (!cart) return { ...frameBox(funnel, viewportWidth, viewportHeight, maxZoom), framed: 'funnel' };
  const both = unionBox(funnel, cart);
  if (fitZoom(both, viewportWidth, viewportHeight) >= READY_MIN_ZOOM) return { ...frameBox(both, viewportWidth, viewportHeight, maxZoom), framed: 'both' };
  return { ...frameBox(cart, viewportWidth, viewportHeight, maxZoom, 0), framed: 'cart' };
}

/**
 * Centre + zoom that fit `box` (plus margin) inside the viewport minus the
 * HUD pads, at most `maxZoom` (the normal follow zoom — framing only ever
 * zooms OUT) and at least `minZoom` (a box too big for that is clipped;
 * readyFrame avoids that for the cart).
 */
export function frameBox(
  box: Box,
  viewportWidth: number,
  viewportHeight: number,
  maxZoom: number,
  minZoom: number = READY_MIN_ZOOM,
): { center: Vec2; zoom: number } {
  const zoom = Math.max(minZoom, Math.min(maxZoom, fitZoom(box, viewportWidth, viewportHeight)));
  // centre the box in the padded area: shift by half the pad difference
  const k = PX_PER_M * zoom;
  const cy = (box.minY + box.maxY) / 2 - (READY_PAD.top - READY_PAD.bottom) / 2 / k;
  return { center: { x: (box.minX + box.maxX) / 2, y: cy }, zoom };
}

/** Course width shown across the screen (m) on narrow screens; the follow zoom is clamped to 0.5–1.5. */
export const VIEW_WIDTH_M = 24;

/** The run's follow zoom for a viewport width. */
export function followZoom(viewportWidth: number): number {
  return Math.min(1.5, Math.max(0.5, viewportWidth / (VIEW_WIDTH_M * PX_PER_M)));
}

/** UX1: the cart's screen-x as a fraction of the viewport width, from the left edge. */
export const LOOK_AHEAD_FRACTION = 0.3;
/** UX1: horizontal follow smoothing per fixed step (the original camera's 0.1). */
export const LOOK_SMOOTHING = 0.1;

/** Horizontal cart anchor: the centre of the cart's shape AABB (null = no cart). */
export function cartAnchorX(box: Box | null): number | null {
  return box ? (box.minX + box.maxX) / 2 : null;
}

/**
 * Camera centre x that puts world x `anchorX` at LOOK_AHEAD_FRACTION of the
 * viewport width from the left edge.
 */
export function lookAheadCenterX(anchorX: number, viewportWidth: number, zoom: number): number {
  return anchorX + ((0.5 - LOOK_AHEAD_FRACTION) * viewportWidth) / (PX_PER_M * zoom);
}

/**
 * UX1: smoothed horizontal follow of the cart anchor, stepped at the fixed
 * 60 Hz (deterministic, frame-rate independent; the renderer interpolates
 * prev -> curr). Plain exponential smoothing lags a moving cart by
 * v·(1 − s)/s per step (≈1.8 m at 12 m/s), which would push the cart well
 * right of the 30% mark exactly when the player needs to see ahead, so the
 * target leads by the smoothed per-step velocity × (1 − s)/s: zero steady-state lag
 * at constant speed, the same 0.1 easing on crashes and stops.
 *
 * Reversing keeps the same forward placement (no mirror): every course runs
 * left to right with the goal on the right, and reverse is mostly used to
 * BRAKE (the pace driver — like a skilled player — taps ← whenever it is
 * 1.5 m/s over its target), so a mirrored camera would whip 40% of the
 * screen width across on every brake tap.
 */
export class LookAheadFollow {
  private prev: number;
  private curr: number;
  private last: number;
  private vel = 0;

  constructor(
    anchorX: number,
    readonly smoothing = LOOK_SMOOTHING,
  ) {
    this.prev = this.curr = this.last = anchorX;
  }

  /** One fixed step. `anchorX` null (no cart) holds the camera still. */
  step(anchorX: number | null): void {
    this.prev = this.curr;
    if (anchorX === null) return;
    const s = this.smoothing;
    this.vel += (anchorX - this.last - this.vel) * s;
    this.last = anchorX;
    const target = anchorX + (this.vel * (1 - s)) / s;
    this.curr += (target - this.curr) * s;
  }

  get x(): number {
    return this.curr;
  }

  /** Render-time anchor interpolated between the last two steps. */
  interpolated(alpha: number): number {
    const a = Math.min(1, Math.max(0, alpha));
    return this.prev + (this.curr - this.prev) * a;
  }
}

/**
 * The run's follow camera: horizontal look-ahead around `anchorX` (the
 * LookAheadFollow output), vertical from the controller's follow `y`, at the
 * follow `zoom`.
 */
export function followCamera(anchorX: number, y: number, zoom: number, viewportWidth: number, viewportHeight: number): Camera {
  return { center: { x: lookAheadCenterX(anchorX, viewportWidth, zoom), y }, zoom, viewportWidth, viewportHeight };
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

/** HUD room (CSS px) kept clear at the finish: chips/timer on top, a little at the bottom. */
export const FINISH_PAD = { top: 56, bottom: 16 } as const;
/** World margin (m) above the blender top / below the lowest of blender and cart. */
export const FINISH_MARGIN_M = 0.3;
/** The finish frame starts blending in when the blender's front is this far (m) past the follow view's right edge... */
export const FINISH_LEAD_M = 4;
/** ...and is fully in after this much more travel (m). */
export const FINISH_RAMP_M = 6;

/**
 * World box of the goal blender as the scene draws it (render/scene.ts): the
 * level's `blender` prop (solid: its collider box, rotated; decor: standing on
 * its position at the shared BLENDER_SIZE), or the shared size standing on
 * the goal sensor's bottom centre when the level has no blender prop.
 */
export function goalBlenderBox(level: LevelDef): Box {
  const prop = level.props.find((p) => p.art === 'blender');
  if (prop && hasSolidBody(prop)) {
    const a = prop.angle ?? 0;
    const c = { x: prop.position.x, y: prop.position.y, angle: a };
    const hx = prop.size.x / 2;
    const hy = prop.size.y / 2;
    return boxOf([rotate(c, { x: -hx, y: -hy }), rotate(c, { x: hx, y: -hy }), rotate(c, { x: hx, y: hy }), rotate(c, { x: -hx, y: hy })]);
  }
  const g = level.goal.sensor;
  const foot = prop ? prop.position : { x: g.x + g.width / 2, y: g.y + g.height };
  return { minX: foot.x - BLENDER_SIZE.x / 2, maxX: foot.x + BLENDER_SIZE.x / 2, minY: foot.y - BLENDER_SIZE.y, maxY: foot.y };
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** 0..1: how far the follow camera has eased into the finish frame (by the blender's position vs the follow view). */
export function finishWeight(follow: Camera, blender: Box): number {
  const right = follow.center.x + follow.viewportWidth / 2 / (PX_PER_M * follow.zoom);
  return smooth(clamp01((right + FINISH_LEAD_M - blender.minX) / FINISH_RAMP_M));
}

/**
 * The finish frame for a follow camera: the smallest change that shows the
 * whole blender (and the cart) between the HUD pads — the look point moves
 * vertically only as far as needed, and the zoom drops below the follow zoom
 * only when blender + cart are taller than the view (never below
 * READY_MIN_ZOOM). The cart anchor stays at LOOK_AHEAD_FRACTION.
 */
export function finishFrame(follow: Camera, anchorX: number, blender: Box, cart: Box | null): Camera {
  const top = Math.min(blender.minY, cart?.minY ?? Infinity) - FINISH_MARGIN_M;
  const bottom = Math.max(blender.maxY, cart?.maxY ?? -Infinity) + FINISH_MARGIN_M;
  const h = follow.viewportHeight;
  const avail = Math.max(1, h - FINISH_PAD.top - FINISH_PAD.bottom);
  const zoom = Math.max(READY_MIN_ZOOM, Math.min(follow.zoom, avail / ((bottom - top) * PX_PER_M)));
  const k = PX_PER_M * zoom;
  // visible y: [cy - h/2k + top pad, cy + h/2k - bottom pad] must contain [top, bottom]
  const lo = bottom - h / 2 / k + FINISH_PAD.bottom / k;
  const hi = top + h / 2 / k - FINISH_PAD.top / k;
  const cy = lo <= hi ? Math.min(hi, Math.max(lo, follow.center.y)) : (lo + hi) / 2;
  return { ...follow, zoom, center: { x: lookAheadCenterX(anchorX, follow.viewportWidth, zoom), y: cy } };
}

/** Follow camera eased into the finish frame by finishWeight (the cart stays at LOOK_AHEAD_FRACTION). */
export function withFinish(follow: Camera, anchorX: number, blender: Box | null, cart: Box | null): Camera {
  if (!blender) return follow;
  const e = finishWeight(follow, blender);
  if (e <= 0) return follow;
  const f = finishFrame(follow, anchorX, blender, cart);
  const zoom = follow.zoom + (f.zoom - follow.zoom) * e;
  return { ...follow, zoom, center: { x: lookAheadCenterX(anchorX, follow.viewportWidth, zoom), y: follow.center.y + (f.center.y - follow.center.y) * e } };
}

export interface RunCameraInput {
  /** LookAheadFollow output (render-interpolated). */
  anchorX: number;
  /** The controller's follow y (render-interpolated). */
  followY: number;
  viewportWidth: number;
  viewportHeight: number;
  /** goalBlenderBox(level). */
  blender: Box | null;
  /** The cart's shape AABB at the rendered pose (null = none). */
  cart: Box | null;
  ready: { center: Vec2; zoom: number } | null;
  sinceRelease: number | null;
}

/** The camera the run screen renders: look-ahead follow -> finish framing -> ready blend. */
export function runCamera(i: RunCameraInput): Camera {
  const follow = followCamera(i.anchorX, i.followY, followZoom(i.viewportWidth), i.viewportWidth, i.viewportHeight);
  return blendCamera(withFinish(follow, i.anchorX, i.blender, i.cart), i.ready, i.sinceRelease);
}
