/**
 * Camera follow (original: follows the right-most cart body, smoothing 0.1,
 * offset −100 px — research/coconut-run-mechanics.md §5).
 *
 * Interpretation: each fixed step the camera centre moves 10% of the way to
 * (right-most body x − 100 px, that body's y), in world metres. So at rest the
 * right-most body sits 100 px (zoom-1 pixels) right of screen centre and the
 * rest of the cart, trailing to the left, is centred. Stepping at the fixed
 * 60 Hz (not per rendered frame) keeps the smoothing frame-rate independent
 * and deterministic; the renderer interpolates prev -> curr with alpha.
 */

import { pxToM } from '../model/coords';
import type { Vec2 } from '../model/geometry';

export const CAMERA_SMOOTHING = 0.1;
export const CAMERA_OFFSET_PX = -100;

export class CameraFollow {
  private prev: Vec2;
  private curr: Vec2;

  constructor(
    start: Vec2,
    readonly smoothing = CAMERA_SMOOTHING,
    readonly offsetX = pxToM(CAMERA_OFFSET_PX),
  ) {
    this.curr = { ...start };
    this.prev = { ...start };
  }

  /** Where the camera heads for a given right-most body position. */
  targetFor(rightmost: Vec2): Vec2 {
    return { x: rightmost.x + this.offsetX, y: rightmost.y };
  }

  /** Jump straight to the target (run start / reset). */
  snap(rightmost: Vec2): void {
    this.curr = this.targetFor(rightmost);
    this.prev = { ...this.curr };
  }

  /** One fixed step. `rightmost` null (no cart) holds the camera still. */
  step(rightmost: Vec2 | null): void {
    this.prev = { ...this.curr };
    if (!rightmost) return;
    const t = this.targetFor(rightmost);
    this.curr = {
      x: this.curr.x + (t.x - this.curr.x) * this.smoothing,
      y: this.curr.y + (t.y - this.curr.y) * this.smoothing,
    };
  }

  get position(): Vec2 {
    return { ...this.curr };
  }

  /** Render-time position interpolated between the last two steps. */
  interpolated(alpha: number): Vec2 {
    const a = Math.min(1, Math.max(0, alpha));
    return { x: this.prev.x + (this.curr.x - this.prev.x) * a, y: this.prev.y + (this.curr.y - this.prev.y) * a };
  }
}
