/**
 * Lookahead step scheduler (the "tale of two clocks" pattern).
 *
 * A coarse JS timer wakes every `intervalMs`; each wake schedules every grid
 * step whose audio time falls before `now + lookahead`, handing the exact
 * audio-clock time to `onStep`, which schedules Web Audio nodes sample-
 * accurately. Step times are computed from the step COUNT
 * (`origin + n × stepDuration`), never accumulated, so there is no drift and
 * the loop boundary is seamless: step `loopSteps` lands exactly one step
 * after step `loopSteps − 1`, with index 0 and loop index + 1.
 *
 * Stalls (throttled background tab, suspended context, slow device): steps
 * whose time is already in the past are skipped rather than dumped all at
 * once, keeping the grid phase.
 */

import type { AudioTimers } from './types';

export interface StepInfo {
  /** Step within the loop, 0..loopSteps-1. */
  step: number;
  /** Absolute audio-clock time of the step (s). */
  time: number;
  /** How many whole loops preceded this step. */
  loop: number;
  /** Global step count since start. */
  count: number;
}

export interface SchedulerOptions {
  /** Audio clock (AudioContext.currentTime). */
  now: () => number;
  stepDuration: number;
  loopSteps: number;
  /** Seconds ahead of `now` to schedule (default 0.12). */
  lookahead?: number;
  /** Timer period in ms (default 25). */
  intervalMs?: number;
  timers: AudioTimers;
  onStep: (info: StepInfo) => void;
}

export class LookaheadScheduler {
  readonly stepDuration: number;
  readonly loopSteps: number;
  readonly lookahead: number;
  readonly intervalMs: number;
  private origin = 0;
  private count = 0;
  private handle: unknown = null;
  private active = false;

  constructor(private readonly opts: SchedulerOptions) {
    if (!(opts.stepDuration > 0) || !Number.isInteger(opts.loopSteps) || opts.loopSteps <= 0) {
      throw new RangeError('LookaheadScheduler: stepDuration must be > 0 and loopSteps a positive integer');
    }
    this.stepDuration = opts.stepDuration;
    this.loopSteps = opts.loopSteps;
    this.lookahead = opts.lookahead ?? 0.12;
    this.intervalMs = opts.intervalMs ?? 25;
  }

  get running(): boolean {
    return this.active;
  }

  /** Audio time of global step n. */
  timeOf(n: number): number {
    return this.origin + n * this.stepDuration;
  }

  /** Audio time of the first step (the grid origin). */
  get startTime(): number {
    return this.origin;
  }

  /** Starts the grid at `startTime` (audio clock) and schedules immediately. */
  start(startTime: number): void {
    this.stop();
    this.origin = startTime;
    this.count = 0;
    this.active = true;
    this.handle = this.opts.timers.setInterval(() => this.tick(), this.intervalMs);
    this.tick();
  }

  stop(): void {
    if (this.handle !== null) this.opts.timers.clearInterval(this.handle);
    this.handle = null;
    this.active = false;
  }

  /** One scheduler wake. Public so tests (and a manual pump) can drive it. */
  tick(): void {
    if (!this.active) return;
    const now = this.opts.now();
    // Skip steps already in the past (stall recovery), keeping grid phase.
    if (this.timeOf(this.count) < now) {
      this.count = Math.max(this.count, Math.ceil((now - this.origin) / this.stepDuration - 1e-9));
    }
    const horizon = now + this.lookahead;
    while (this.active && this.timeOf(this.count) < horizon) {
      const n = this.count++;
      this.opts.onStep({ step: n % this.loopSteps, time: this.timeOf(n), loop: Math.floor(n / this.loopSteps), count: n });
    }
  }
}
