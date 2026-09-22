/**
 * Gesture arbitration state machine (pure; no DOM). PLAN.md S2:
 *
 *  - one pointer draws (a "stroke": start -> updates -> commit on release);
 *  - a second pointer landing within GESTURE_GRACE_MS of the first cancels the
 *    in-progress stroke (never commits it) and the two pointers become
 *    pinch-zoom/pan;
 *  - a second pointer landing AFTER the grace window is ignored (the stroke
 *    continues; lifting that extra pointer does nothing);
 *  - after a pinch, remaining pointers are ignored until every pointer is up,
 *    so lifting one finger of a pinch never starts an accidental stroke;
 *  - secondary mouse buttons (middle/right) pan;
 *  - `cancel` of ANY pointer the machine is tracking (drawing, pinching,
 *    panning or ignored) and `reset` clear ALL state and cancel any stroke
 *    without committing. The DOM layer sends `reset` for every canvas
 *    `pointercancel`, blur, visibilitychange and phase transition, and
 *    `cancel` for `lostpointercapture` (which also fires, harmlessly, for
 *    pointers already released — those are no longer tracked).
 *
 * The machine is a reducer: `step(state, event) -> { state, effects }`.
 * Positions are screen px; `time` is the event timestamp in ms.
 */

import type { Vec2 } from '../model/geometry';
import { GESTURE_GRACE_MS } from './constants';

export type GestureEvent =
  | { type: 'down'; pointerId: number; pos: Vec2; time: number; /** mouse button; 0 (primary) for touch/pen */ button: number }
  | { type: 'move'; pointerId: number; pos: Vec2; time: number }
  | { type: 'up'; pointerId: number; pos: Vec2; time: number }
  | { type: 'cancel'; pointerId: number }
  | { type: 'reset' };

export type GestureEffect =
  | { type: 'strokeStart'; pos: Vec2 }
  | { type: 'strokeUpdate'; start: Vec2; pos: Vec2 }
  | { type: 'strokeCommit'; start: Vec2; pos: Vec2 }
  | { type: 'strokeCancel' }
  /** Incremental view change: scale by `factor` about `from`, moving it to `to`. */
  | { type: 'view'; factor: number; from: Vec2; to: Vec2 };

export type GestureState =
  | { name: 'idle' }
  | { name: 'stroke'; pointerId: number; start: Vec2; pos: Vec2; startTime: number; ignored: number[] }
  | { name: 'pinch'; a: number; b: number; posA: Vec2; posB: Vec2; ignored: number[] }
  | { name: 'pan'; pointerId: number; pos: Vec2; ignored: number[] }
  | { name: 'ignoring'; pointers: number[] };

export interface GestureStep {
  state: GestureState;
  effects: GestureEffect[];
}

export const initialGestureState: GestureState = { name: 'idle' };

const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const without = (list: number[], id: number) => list.filter((p) => p !== id);
const settle = (pointers: number[]): GestureState => (pointers.length ? { name: 'ignoring', pointers } : { name: 'idle' });
const same = (state: GestureState): GestureStep => ({ state, effects: [] });

export function stepGesture(state: GestureState, ev: GestureEvent, graceMs = GESTURE_GRACE_MS): GestureStep {
  if (ev.type === 'reset') {
    return { state: { name: 'idle' }, effects: state.name === 'stroke' ? [{ type: 'strokeCancel' }] : [] };
  }

  switch (state.name) {
    case 'idle': {
      if (ev.type !== 'down') return same(state);
      if (ev.button === 0) {
        return {
          state: { name: 'stroke', pointerId: ev.pointerId, start: ev.pos, pos: ev.pos, startTime: ev.time, ignored: [] },
          effects: [{ type: 'strokeStart', pos: ev.pos }],
        };
      }
      return same({ name: 'pan', pointerId: ev.pointerId, pos: ev.pos, ignored: [] });
    }

    case 'stroke': {
      const own = 'pointerId' in ev && ev.pointerId === state.pointerId;
      switch (ev.type) {
        case 'down': {
          if (own || state.ignored.includes(ev.pointerId)) return same(state);
          if (ev.time - state.startTime <= graceMs && state.ignored.length === 0) {
            return {
              state: { name: 'pinch', a: state.pointerId, b: ev.pointerId, posA: state.pos, posB: ev.pos, ignored: [] },
              effects: [{ type: 'strokeCancel' }],
            };
          }
          return same({ ...state, ignored: [...state.ignored, ev.pointerId] });
        }
        case 'move':
          if (!own) return same(state);
          return { state: { ...state, pos: ev.pos }, effects: [{ type: 'strokeUpdate', start: state.start, pos: ev.pos }] };
        case 'up':
          if (!own) return same({ ...state, ignored: without(state.ignored, ev.pointerId) });
          return { state: settle(state.ignored), effects: [{ type: 'strokeCommit', start: state.start, pos: ev.pos }] };
        case 'cancel':
          if (!own && !state.ignored.includes(ev.pointerId)) return same(state);
          return { state: { name: 'idle' }, effects: [{ type: 'strokeCancel' }] };
      }
      return same(state);
    }

    case 'pinch': {
      const isA = 'pointerId' in ev && ev.pointerId === state.a;
      const isB = 'pointerId' in ev && ev.pointerId === state.b;
      switch (ev.type) {
        case 'down':
          if (isA || isB || state.ignored.includes(ev.pointerId)) return same(state);
          return same({ ...state, ignored: [...state.ignored, ev.pointerId] });
        case 'move': {
          if (!isA && !isB) return same(state);
          const posA = isA ? ev.pos : state.posA;
          const posB = isB ? ev.pos : state.posB;
          const d0 = dist(state.posA, state.posB);
          const d1 = dist(posA, posB);
          const factor = d0 > 1 && d1 > 1 ? d1 / d0 : 1;
          return {
            state: { ...state, posA, posB },
            effects: [{ type: 'view', factor, from: mid(state.posA, state.posB), to: mid(posA, posB) }],
          };
        }
        case 'up': {
          if (!isA && !isB) return same({ ...state, ignored: without(state.ignored, ev.pointerId) });
          const remaining = [isA ? state.b : state.a, ...state.ignored];
          return same(settle(remaining));
        }
        case 'cancel':
          if (!isA && !isB && !state.ignored.includes(ev.pointerId)) return same(state);
          return same({ name: 'idle' });
      }
      return same(state);
    }

    case 'pan': {
      const own = 'pointerId' in ev && ev.pointerId === state.pointerId;
      switch (ev.type) {
        case 'down':
          if (own || state.ignored.includes(ev.pointerId)) return same(state);
          return same({ ...state, ignored: [...state.ignored, ev.pointerId] });
        case 'move':
          if (!own) return same(state);
          return { state: { ...state, pos: ev.pos }, effects: [{ type: 'view', factor: 1, from: state.pos, to: ev.pos }] };
        case 'up':
          if (!own) return same({ ...state, ignored: without(state.ignored, ev.pointerId) });
          return same(settle(state.ignored));
        case 'cancel':
          if (!own && !state.ignored.includes(ev.pointerId)) return same(state);
          return same({ name: 'idle' });
      }
      return same(state);
    }

    case 'ignoring': {
      if (ev.type === 'down' && !state.pointers.includes(ev.pointerId)) {
        return same({ name: 'ignoring', pointers: [...state.pointers, ev.pointerId] });
      }
      if (ev.type === 'up') return same(settle(without(state.pointers, ev.pointerId)));
      if (ev.type === 'cancel') return same(state.pointers.includes(ev.pointerId) ? { name: 'idle' } : state);
      return same(state);
    }
  }
}

/** Convenience wrapper holding the current state (used by the DOM layer). */
export class GestureMachine {
  private s: GestureState = initialGestureState;
  constructor(private readonly graceMs = GESTURE_GRACE_MS) {}
  get state(): GestureState {
    return this.s;
  }
  send(ev: GestureEvent): GestureEffect[] {
    const r = stepGesture(this.s, ev, this.graceMs);
    this.s = r.state;
    return r.effects;
  }
}
