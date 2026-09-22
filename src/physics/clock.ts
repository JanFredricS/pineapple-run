/**
 * Fixed-step clock & frame loop (PLAN.md "Clock & pause policy").
 *
 * - Physics always steps exactly FIXED_DT (1/60 s) with SUB_STEPS sub-steps.
 * - Real frame time feeds an accumulator; catch-up is capped at 250 ms per
 *   frame — excess real time is DROPPED (slow devices run in slight
 *   slow-motion instead of losing score).
 * - Simulation time = steps × FIXED_DT, never wall clock.
 * - visibilitychange/blur pauses the whole loop and fires onPauseChange so
 *   the host can clear all input state.
 *
 * FixedStepClock is pure (unit-tested). FrameLoop wires it to rAF + DOM.
 */

export const FIXED_DT = 1 / 60;
export const SUB_STEPS = 4;
export const MAX_CATCH_UP_SECONDS = 0.25;
const EPS = 1e-9;

export class FixedStepClock {
  private accumulator = 0;
  private _steps = 0;
  private _paused = false;

  get steps(): number {
    return this._steps;
  }

  /** Simulation seconds elapsed (steps × 1/60). */
  get simTime(): number {
    return this._steps * FIXED_DT;
  }

  get paused(): boolean {
    return this._paused;
  }

  /** Interpolation factor between the previous and current physics state. */
  get alpha(): number {
    return Math.min(1, Math.max(0, this.accumulator / FIXED_DT));
  }

  /**
   * Feed real elapsed seconds; returns how many fixed steps to run now.
   * Caller runs exactly that many physics steps.
   */
  advance(realDtSeconds: number): number {
    if (this._paused) return 0;
    const dt = Math.min(MAX_CATCH_UP_SECONDS, Math.max(0, Number.isFinite(realDtSeconds) ? realDtSeconds : 0));
    this.accumulator += dt;
    const n = Math.floor((this.accumulator + EPS) / FIXED_DT);
    this.accumulator = Math.max(0, this.accumulator - n * FIXED_DT);
    this._steps += n;
    return n;
  }

  pause(): void {
    this._paused = true;
  }

  resume(): void {
    this._paused = false;
    this.accumulator = 0;
  }

  reset(): void {
    this.accumulator = 0;
    this._steps = 0;
  }
}

export interface FrameLoopCallbacks {
  /** Run ONE fixed physics step. */
  step(): void;
  /** Render with interpolation factor alpha. Called every animation frame. */
  render(alpha: number): void;
  /** Paused (tab hidden / window blurred) or resumed. Clear input on pause. */
  onPauseChange?(paused: boolean): void;
}

/** Browser frame loop: rAF -> FixedStepClock -> step()/render(). */
export class FrameLoop {
  readonly clock = new FixedStepClock();
  private rafId = 0;
  private lastMs: number | null = null;
  private running = false;
  private unbind: (() => void) | null = null;

  constructor(private readonly cb: FrameLoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastMs = null;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.unbind?.();
    this.unbind = null;
  }

  setPaused(paused: boolean): void {
    if (paused === this.clock.paused) return;
    if (paused) this.clock.pause();
    else {
      this.clock.resume();
      this.lastMs = null; // do not count the time spent hidden
    }
    this.cb.onPauseChange?.(paused);
  }

  /** Pause on visibilitychange (hidden) and window blur; resume on return. */
  bindVisibility(doc: Document = document, win: Window = window): void {
    const onVis = () => this.setPaused(doc.visibilityState === 'hidden');
    const onBlur = () => this.setPaused(true);
    const onFocus = () => {
      if (doc.visibilityState !== 'hidden') this.setPaused(false);
    };
    doc.addEventListener('visibilitychange', onVis);
    win.addEventListener('blur', onBlur);
    win.addEventListener('focus', onFocus);
    this.unbind = () => {
      doc.removeEventListener('visibilitychange', onVis);
      win.removeEventListener('blur', onBlur);
      win.removeEventListener('focus', onFocus);
    };
  }

  private tick = (nowMs: number): void => {
    if (!this.running) return;
    const dt = this.lastMs === null ? 0 : (nowMs - this.lastMs) / 1000;
    this.lastMs = nowMs;
    const n = this.clock.advance(dt);
    for (let i = 0; i < n; i++) this.cb.step();
    this.cb.render(this.clock.alpha);
    this.rafId = requestAnimationFrame(this.tick);
  };
}
