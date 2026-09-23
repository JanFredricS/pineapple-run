/**
 * Stuck detector (S6T backlog #5). Pure: fed one sample per fixed step.
 *
 * "Stuck" = the cart has not moved more than STUCK_DISPLACEMENT metres (2-D,
 * from an anchor) for STUCK_SECONDS of sim time while the run is live. Any
 * larger move re-anchors and clears it. A missing cart (null sample: it fell
 * out of the world) never moves, so it becomes stuck after the same delay.
 * The HUD turns this into a "Stuck?" hint with Retry and a pulsing Give Up;
 * it never ends a run by itself.
 */

import type { Vec2 } from '../model/geometry';

export const STUCK_SECONDS = 5;
export const STUCK_DISPLACEMENT = 0.3;

export class StuckDetector {
  private anchor: Vec2 | null = null;
  private still = 0;

  constructor(
    private readonly seconds = STUCK_SECONDS,
    private readonly displacement = STUCK_DISPLACEMENT,
  ) {}

  /** True once the cart has been still for `seconds`. */
  get stuck(): boolean {
    return this.still >= this.seconds - 1e-9;
  }

  /** Seconds the cart has been still (for tests / debugging). */
  get stillSeconds(): number {
    return this.still;
  }

  /**
   * One sample. `pos` = a cart reference point (null: no cart left);
   * `live` = the run is in play (released, not ended, not settling at the
   * goal) — outside it the detector resets.
   */
  sample(pos: Vec2 | null, dt: number, live: boolean): boolean {
    if (!live) {
      this.reset();
      return false;
    }
    if (pos !== null && (this.anchor === null || Math.hypot(pos.x - this.anchor.x, pos.y - this.anchor.y) > this.displacement)) {
      this.anchor = { x: pos.x, y: pos.y };
      this.still = 0;
      return false;
    }
    this.still += dt;
    return this.stuck;
  }

  reset(): void {
    this.anchor = null;
    this.still = 0;
  }
}
