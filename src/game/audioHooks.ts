/**
 * Audio seam for the run screen. S7 (src/audio, built in parallel) plugs in
 * here; S6 deliberately wires NO audio.
 *
 * TODO(S7): implement AudioHooks in src/audio and pass it to mountRunScreen
 * (RunScreenDeps.audio). Every hook is optional and fire-and-forget; the
 * run screen never awaits or depends on audio.
 */

import type { RunEvent } from '../model/runEvents';
import type { DriveDirection } from '../physics/compound';

export interface AudioHooks {
  /** Run screen mounted for this course (theme id for ambience). */
  runStarted?(info: { levelId: string; theme: string }): void;
  /** Every run lifecycle event (started, released, pineappleLost, goalReached, allLost, gaveUp). */
  runEvent?(event: RunEvent): void;
  /** Drive intent changed (motor sound). */
  drive?(direction: DriveDirection): void;
  /** Loop paused/resumed (hidden, blurred, rotate overlay). */
  paused?(paused: boolean): void;
  /** Run screen torn down. */
  runStopped?(): void;
}

/** The no-op default until S7 lands. */
export const NO_AUDIO: AudioHooks = {};
