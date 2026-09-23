/**
 * Run-screen UI state machine (pure), layered under AppState 'run'.
 *
 *   waiting --started--> ready --releaseRequested--> releasing --released--> running
 *      \______________________released (any pre-run phase)_____________________/
 *   running/any --goalReached | gaveUp--> ended
 *   endless: running --pineappleLost(remaining 0)--> ended
 *   any --allLost--> ended (endless, and level runs with nothing recoverable)
 *
 * The HUD owns NO simulation and NO clock: phase changes come only from S1's
 * run-lifecycle events (model/runEvents) and the player's intents. Intents
 * (release, give up) are requests — the state records that one is pending so
 * the button can't double-fire; the matching event confirms it.
 */

import type { RunEvent } from '../model/runEvents';
import { TOTAL_PINEAPPLES } from '../model/score';

export type RunMode = 'level' | 'endless';
export type HudPhase = 'waiting' | 'ready' | 'releasing' | 'running' | 'ended';

export interface HudState {
  mode: RunMode;
  phase: HudPhase;
  /** Pineapples still in play (from pineappleLost.remaining). */
  remaining: number;
  /** Set by goalReached. */
  delivered: number | null;
  /** Give Up pressed, waiting for S1's gaveUp event. */
  givingUp: boolean;
  /** Level mode: every pineapple is gone, so the run can't score — nudge Give Up. */
  allLost: boolean;
  /** S6T #5: the cart has barely moved for a while (telemetry) — show "Stuck?" + Retry, pulse Give Up. */
  stuck: boolean;
  /** The event that ended the run. */
  outcome: RunEvent | null;
  /** Sim time the run ended at (frozen timer). */
  endTime: number | null;
}

export type HudAction =
  | { type: 'event'; event: RunEvent }
  | { type: 'releaseRequested' }
  | { type: 'giveUpRequested' }
  | { type: 'stuck'; stuck: boolean };

export function initialHud(mode: RunMode): HudState {
  return {
    mode,
    phase: 'waiting',
    remaining: TOTAL_PINEAPPLES,
    delivered: null,
    givingUp: false,
    allLost: false,
    stuck: false,
    outcome: null,
    endTime: null,
  };
}

const clampCount = (n: number) => (Number.isFinite(n) ? Math.min(TOTAL_PINEAPPLES, Math.max(0, Math.floor(n))) : 0);
const safeTime = (t: number) => (Number.isFinite(t) && t > 0 ? t : 0);

function end(s: HudState, event: RunEvent, patch: Partial<HudState> = {}): HudState {
  return { ...s, ...patch, phase: 'ended', givingUp: false, stuck: false, outcome: event, endTime: safeTime(event.simTime) };
}

export function hudReduce(s: HudState, a: HudAction): HudState {
  if (s.phase === 'ended') return s;
  switch (a.type) {
    case 'releaseRequested':
      return s.phase === 'ready' ? { ...s, phase: 'releasing' } : s;
    case 'giveUpRequested':
      return s.phase !== 'waiting' && !s.givingUp ? { ...s, givingUp: true } : s;
    case 'stuck': {
      const stuck = a.stuck && s.phase === 'running';
      return stuck === s.stuck ? s : { ...s, stuck };
    }
    case 'event': {
      const e = a.event;
      switch (e.type) {
        case 'started':
          return s.phase === 'waiting' ? { ...s, phase: 'ready' } : s;
        case 'released':
          return s.phase === 'running' ? s : { ...s, phase: 'running' };
        case 'pineappleLost': {
          const remaining = clampCount(e.remaining);
          if (s.mode === 'endless' && remaining === 0 && s.phase === 'running') {
            return end(s, e, { remaining, allLost: true });
          }
          return { ...s, remaining, allLost: remaining === 0 };
        }
        case 'goalReached':
          return end(s, e, { delivered: clampCount(e.delivered) });
        case 'gaveUp':
          return end(s, e);
        case 'allLost':
          return end(s, e, { remaining: 0, allLost: true });
      }
    }
  }
  return s;
}

/** The timer value to display: 0 before Release, live clock while running, frozen after. */
export function displayTime(s: HudState, clockNow: number): number {
  if (s.phase === 'ended') return s.endTime ?? 0;
  if (s.phase === 'running') return safeTime(clockNow);
  return 0;
}

export interface ButtonView {
  visible: boolean;
  enabled: boolean;
  label: string;
  /** Draw attention (pulse). */
  attention: boolean;
}

/** Release button per the original's flow (Start -> "Release the ..." -> timer). */
export function releaseButton(s: HudState): ButtonView {
  switch (s.phase) {
    case 'waiting':
      return { visible: true, enabled: false, label: 'Getting ready…', attention: false };
    case 'ready':
      return { visible: true, enabled: true, label: 'Release the Pineapples', attention: true };
    case 'releasing':
      return { visible: true, enabled: false, label: 'Releasing…', attention: false };
    default:
      return { visible: false, enabled: false, label: '', attention: false };
  }
}

export function giveUpButton(s: HudState): ButtonView {
  if (s.phase === 'ended') return { visible: false, enabled: false, label: 'Give Up', attention: false };
  if (s.givingUp) return { visible: true, enabled: false, label: 'Giving up…', attention: false };
  return {
    visible: true,
    enabled: s.phase !== 'waiting',
    label: 'Give Up',
    attention: (s.mode === 'level' && s.allLost) || s.stuck,
  };
}

/** S6T #5: the "Stuck?" hint (with a Retry button) — only while running. */
export function stuckHint(s: HudState): string {
  return s.stuck && s.phase === 'running' ? 'Stuck?' : '';
}

/** Drive buttons only make sense once the simulation is live. */
export function driveEnabled(s: HudState): boolean {
  return s.phase !== 'waiting' && s.phase !== 'ended';
}

/** Short end-of-run banner text shown before the results screen. */
export function endBanner(s: HudState): string {
  const e = s.outcome;
  if (!e) return '';
  if (e.type === 'goalReached') return s.delivered === 1 ? '1 pineapple delivered!' : `${s.delivered ?? 0} pineapples delivered!`;
  if (e.type === 'gaveUp') return 'Run abandoned';
  if (e.type === 'pineappleLost' || e.type === 'allLost') return 'All pineapples lost!';
  return '';
}
