/**
 * UX1 #5 — builder touch loupe (Jan: "There should be a magnifier circle or
 * something next to your finger when building the cart. Difficult to see where
 * you click due to the finger being in the way").
 *
 * Pure half (no DOM, no Pixi): which touch the loupe follows (`LoupeTracker`)
 * and where the circle goes (`loupeLayout`). The Pixi half is `BuilderLoupe`
 * in render.ts; builder.ts wires both with their OWN canvas listeners, so the
 * loupe is purely visual — it never feeds the InputRouter / GestureMachine and
 * cannot change hit-testing, snapping or edit semantics.
 *
 * Rules:
 *  - TOUCH pointers only (`pointerType === 'touch'`); mouse and pen never show it.
 *  - It follows the first finger from press to release. Pinch/pan (the
 *    gesture machine's two-finger navigation) hides it — navigation, not drawing.
 *  - pointerup / lostpointercapture of the followed finger hides it;
 *    pointercancel and every builder `resetInput` (blur, Escape, Clear, ...) reset it.
 */

import type { Vec2 } from '../model/geometry';

export const LOUPE = {
  /** Circle radius in screen px (judged in the dev harness at phone size: big enough to read a snap ring, small enough to leave the drawing visible). */
  radius: 64,
  /** Magnification over the current builder view. */
  zoom: 2,
  /** Gap between the fingertip and the circle's near edge (a fingertip pad is ~40-50 px wide). */
  gap: 44,
  /** Horizontal lean toward the free area's centre when placed above the finger (fraction of the radius). */
  lean: 0.35,
  /** Minimum distance kept from the free area's edges. */
  margin: 8,
} as const;

export interface LoupeBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type LoupeSide = 'above' | 'left' | 'right';

export interface LoupePlacement {
  center: Vec2;
  side: LoupeSide;
}

const clamp = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));

/**
 * Where the loupe circle goes for a finger at `p` (screen px) inside the free
 * canvas area `b` (the canvas minus the palette).
 *
 * Default: ABOVE the finger (the hand is below it), leaning a little toward
 * the area's horizontal centre. When there is no room above (finger near the
 * top edge) it flips BESIDE the finger at finger height, on the side facing
 * the area's centre. The result is always clamped inside the area, so the
 * circle never leaves the viewport.
 */
export function loupeLayout(p: Vec2, b: LoupeBounds, cfg: { radius: number; gap: number; lean: number; margin: number } = LOUPE): LoupePlacement {
  const r = cfg.radius;
  const lo = { x: b.left + cfg.margin + r, y: b.top + cfg.margin + r };
  const hi = { x: b.right - cfg.margin - r, y: b.bottom - cfg.margin - r };
  const midX = (b.left + b.right) / 2;
  const toward = p.x <= midX ? 1 : -1;
  const aboveY = p.y - cfg.gap - r;
  if (aboveY >= lo.y) {
    return { side: 'above', center: { x: clamp(p.x + toward * cfg.lean * r, lo.x, hi.x), y: aboveY } };
  }
  const side: LoupeSide = toward > 0 ? 'right' : 'left';
  return { side, center: { x: clamp(p.x + toward * (cfg.gap + r), lo.x, hi.x), y: clamp(p.y, lo.y, hi.y) } };
}

/**
 * Which touch (if any) the loupe follows. Pure pointer bookkeeping: the FIRST
 * finger of a touch sequence (the one the gesture machine draws with) is
 * followed; once it lifts, no other finger takes over until every finger is up.
 */
export class LoupeTracker {
  private readonly touches = new Map<number, Vec2>();
  private primary: number | null = null;
  /** The followed finger lifted while others stayed down: wait for all up. */
  private spent = false;

  down(pointerId: number, pointerType: string, pos: Vec2): void {
    if (pointerType !== 'touch') return;
    if (this.touches.size === 0 && !this.spent) this.primary = pointerId;
    this.touches.set(pointerId, pos);
  }

  move(pointerId: number, pos: Vec2): void {
    if (this.touches.has(pointerId)) this.touches.set(pointerId, pos);
  }

  /** pointerup / lostpointercapture of one finger. */
  up(pointerId: number): void {
    if (!this.touches.delete(pointerId)) return;
    if (pointerId === this.primary) {
      this.primary = null;
      this.spent = this.touches.size > 0;
    }
    if (this.touches.size === 0) this.spent = false;
  }

  /** pointercancel / input reset: forget every finger. */
  reset(): void {
    this.touches.clear();
    this.primary = null;
    this.spent = false;
  }

  /** Fingertip (screen px) the loupe magnifies, or null = hidden. */
  get position(): Vec2 | null {
    return this.primary === null ? null : (this.touches.get(this.primary) ?? null);
  }
}

/**
 * Read-only gate on the gesture machine's state: two-finger navigation
 * (pinch, pan, and the "ignoring" tail after a pinch) hides the loupe; a
 * stroke (draw or delete pick) shows it. A second finger landing after the
 * grace window is ignored by the machine, so the stroke — and the loupe — go on.
 */
export function loupeAllowed(gesture: string): boolean {
  return gesture !== 'pinch' && gesture !== 'pan' && gesture !== 'ignoring';
}
