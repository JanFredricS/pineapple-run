/**
 * Audio seam for the run screen (S6V: wired to S7's GameAudio).
 *
 * The run screen calls these fire-and-forget hooks; it never awaits or
 * depends on audio. `gameAudioHooks(audio)` adapts S7's `GameAudio` facade
 * (src/audio) to them — see its doc for the exact mapping. `NO_AUDIO` is the
 * silent default (tests, harnesses).
 */

import { musicThemeForCourse, type MusicStage, type MusicTheme } from '../audio';
import type { RunEvent } from '../model/runEvents';
import type { DriveDirection } from '../physics/compound';

export type RunAudioMode = 'level' | 'endless';

/** Periodic run reading (the run screen sends one every AUDIO_TICK_STEPS fixed steps). */
export interface RunAudioTick {
  /** Level runs: furthest fraction of the course covered, 0..1 (start → goal line). */
  courseProgress: number;
  /** Endless runs: furthest distance carried (m). */
  endlessMetres: number;
  /** Cart speed (m/s, ≥ 0; 0 without a cart). */
  speed: number;
}

export interface AudioHooks {
  /** Run screen mounted for this course (before the `started` event). */
  runStarted?(info: { levelId: string; mode: RunAudioMode }): void;
  /** Every run lifecycle event (started, released, pineappleLost, goalReached, allLost, gaveUp). */
  runEvent?(event: RunEvent): void;
  /** Drive intent changed (motor sound). */
  drive?(direction: DriveDirection): void;
  /** Periodic progress / speed (music stage, motor pitch). */
  tick?(t: RunAudioTick): void;
  /** Loop paused/resumed (hidden, blurred, rotate overlay). */
  paused?(paused: boolean): void;
  /** Run screen torn down (retry, back to builder, results, app teardown). */
  runStopped?(): void;
}

/** The silent default. */
export const NO_AUDIO: AudioHooks = {};

/** Fixed steps between `tick` hooks (6 = 10 Hz at 1/60 s steps). */
export const AUDIO_TICK_STEPS = 6;

/** Cart speed (m/s) that maps to full motor pitch. */
export const MOTOR_FULL_SPEED = 10;
/** Motor floor while a drive button/key is held (the motor audibly revs even when stuck). */
export const MOTOR_DRIVE_FLOOR = 0.35;

/**
 * Course progress for the music stage: the fraction of the start → goal-line
 * span reached, clamped to 0..1. Non-finite input or a degenerate span → 0.
 */
export function courseProgress(startX: number, goalLineX: number, x: number): number {
  const span = goalLineX - startX;
  if (!Number.isFinite(span) || span <= 0 || !Number.isFinite(x)) return 0;
  const f = (x - startX) / span;
  return f <= 0 ? 0 : f >= 1 ? 1 : f;
}

/** Motor loop parameter (0..1) for a drive intent and cart speed. */
export function motorLevel(direction: DriveDirection, speed: number): number {
  const s = Number.isFinite(speed) ? Math.min(1, Math.max(0, speed / MOTOR_FULL_SPEED)) : 0;
  return direction === 0 ? s : Math.max(MOTOR_DRIVE_FLOOR, s);
}

/**
 * The slice of S7's `GameAudio` the adapter uses (structural, so tests can
 * pass a fake; the real class satisfies it).
 */
export interface GameAudioLike {
  readonly music: { play(theme: MusicTheme, stage?: MusicStage): void };
  readonly sfx: { readonly wheelMotor: { readonly running: boolean; start(value?: number): void; set(value: number): void; stop(): void } };
  onRunEvent(event: RunEvent): void;
  setCourseProgress(progress: number): void;
  setEndlessDistance(metres: number): void;
  stopRunSounds(): void;
}

/**
 * Adapt GameAudio to the run-screen hooks:
 *
 *  - runStarted   → music.play(theme for the course, stage 0) (instant stage reset)
 *  - runEvent     → audio.onRunEvent(e) (started: motor idle + stage 0;
 *                   released: clatter; goalReached: sting + blender whir;
 *                   gaveUp/allLost: lose sting; motor stops on every terminal)
 *  - drive / tick → wheelMotor.set(motorLevel(drive, speed)) while the run is live
 *  - tick         → level: setCourseProgress(courseProgress) — floor(p × 4)
 *                   quarters; the screen sends the FURTHEST progress, so the
 *                   stems never flap at a boundary; endless:
 *                   setEndlessDistance(metres) (150 m steps)
 *  - paused(true) → the motor loop stops (a paused run makes no engine noise;
 *                   music keeps playing — the engine itself suspends the
 *                   whole context when the page is hidden)
 *    paused(false)→ the motor restarts at the current level if the run is
 *                   still live (started/released, not ended)
 *  - runStopped   → stopRunSounds() — except right after a goal, where only
 *                   the motor stops and the blender whir finishes on its own
 *                   timer (the results screen mounts ~1.4 s after the goal;
 *                   cutting the whir there would clip the payoff).
 */
export function gameAudioHooks(audio: GameAudioLike): AudioHooks {
  let mode: RunAudioMode = 'level';
  let live = false;
  let endedByGoal = false;
  let direction: DriveDirection = 0;
  let speed = 0;
  let paused = false;
  const level = () => motorLevel(direction, speed);
  const updateMotor = () => {
    if (live && !paused) audio.sfx.wheelMotor.set(level());
  };
  return {
    runStarted(info) {
      mode = info.mode;
      live = false;
      endedByGoal = false;
      direction = 0;
      speed = 0;
      audio.music.play(musicThemeForCourse(info.levelId), 0);
    },
    runEvent(e) {
      audio.onRunEvent(e);
      if (e.type === 'started') {
        live = true;
        if (paused) audio.sfx.wheelMotor.stop();
        else updateMotor();
      } else if (e.type === 'goalReached' || e.type === 'gaveUp' || e.type === 'allLost') {
        live = false;
        endedByGoal = e.type === 'goalReached';
      }
    },
    drive(dir) {
      direction = dir;
      updateMotor();
    },
    tick(t) {
      speed = t.speed;
      updateMotor();
      if (mode === 'endless') audio.setEndlessDistance(t.endlessMetres);
      else audio.setCourseProgress(t.courseProgress);
    },
    paused(p) {
      if (p === paused) return;
      paused = p;
      if (p) audio.sfx.wheelMotor.stop();
      else if (live) audio.sfx.wheelMotor.start(level());
    },
    runStopped() {
      if (endedByGoal) audio.sfx.wheelMotor.stop();
      else audio.stopRunSounds();
      live = false;
      paused = false;
      direction = 0;
      speed = 0;
    },
  };
}

/**
 * Wrap hooks so an audio failure can never break the run (a throwing hook is
 * logged once per hook name and otherwise ignored).
 */
export function safeHooks(hooks: AudioHooks): AudioHooks {
  const reported = new Set<string>();
  const out: AudioHooks = {};
  for (const [name, fn] of Object.entries(hooks) as [keyof AudioHooks, ((...a: unknown[]) => void) | undefined][]) {
    if (typeof fn !== 'function') continue;
    (out as Record<string, (...a: unknown[]) => void>)[name] = (...args: unknown[]) => {
      try {
        fn.apply(hooks, args);
      } catch (err) {
        if (!reported.has(name)) {
          reported.add(name);
          console.error(`[audio] ${name} failed`, err);
        }
      }
    };
  }
  return out;
}

/**
 * Per-run feed for `hooks.tick`: call `step()` once per fixed step; every
 * AUDIO_TICK_STEPS steps it sends the FURTHEST course progress (level music
 * quarters; monotonic so the stems never flap at a boundary), the endless
 * furthest metres, and the cart speed from the cart's x travel since the
 * last tick (0 without a cart).
 */
export class RunAudioFeed {
  private steps = 0;
  private furthestX: number;
  private lastCartX: number | null = null;

  constructor(
    private readonly hooks: AudioHooks,
    private readonly startX: number,
    private readonly goalLineX: number,
  ) {
    this.furthestX = startX;
  }

  step(cartX: number | null, endlessMetres: number): void {
    if (++this.steps % AUDIO_TICK_STEPS !== 0) return;
    let speed = 0;
    if (cartX !== null && Number.isFinite(cartX)) {
      if (this.lastCartX !== null) speed = Math.abs(cartX - this.lastCartX) / (AUDIO_TICK_STEPS / 60);
      this.lastCartX = cartX;
      if (cartX > this.furthestX) this.furthestX = cartX;
    } else this.lastCartX = null;
    this.hooks.tick?.({
      courseProgress: courseProgress(this.startX, this.goalLineX, this.furthestX),
      endlessMetres,
      speed,
    });
  }
}
