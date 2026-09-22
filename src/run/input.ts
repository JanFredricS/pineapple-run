/**
 * Drive input state (keyboard ←/→ and A/D, plus touch-button hooks).
 *
 * Every physical source (a key code, a touch pointer) is tracked separately,
 * so releasing ArrowRight while D is still held keeps driving right, and two
 * fingers on the same button need both lifted. `direction` is +1 / −1 when
 * exactly one side is held, else 0 (both or neither = coast).
 *
 * `clear()` drops ALL held state. Hosts call it on pause (the S0 FrameLoop's
 * onPauseChange fires for hidden / blurred / manual pause causes), on pointer
 * cancel, and on run phase changes — so no key or finger that went up while
 * we weren't listening can leave the cart driving.
 *
 * Uses only EventTarget / Event at runtime (Node-testable).
 */

import type { DriveDirection } from '../physics/compound';

export type DriveSide = 'left' | 'right';

export const LEFT_KEYS: readonly string[] = ['ArrowLeft', 'KeyA'];
export const RIGHT_KEYS: readonly string[] = ['ArrowRight', 'KeyD'];

/** Where keyboard events come from (window in the browser; any EventTarget in tests). */
export type ListenerTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export class DriveInput {
  private readonly held: Record<DriveSide, Set<string>> = { left: new Set(), right: new Set() };

  get direction(): DriveDirection {
    const l = this.held.left.size > 0;
    const r = this.held.right.size > 0;
    return l === r ? 0 : r ? 1 : -1;
  }

  isHeld(side: DriveSide): boolean {
    return this.held[side].size > 0;
  }

  /** Is this source (`key:<code>` / `pointer:<id>`) currently held? */
  hasSource(source: string): boolean {
    return this.held.left.has(source) || this.held.right.has(source);
  }

  /** Mark a source (key code or `pointer:<id>`) as pressing `side`. */
  press(side: DriveSide, source: string): void {
    this.held[side === 'left' ? 'right' : 'left'].delete(source);
    this.held[side].add(source);
  }

  /** Release a source from whichever side it held. */
  release(source: string): void {
    this.held.left.delete(source);
    this.held.right.delete(source);
  }

  /** Drop every held source (blur, visibility, cancel, phase change). */
  clear(): void {
    this.held.left.clear();
    this.held.right.clear();
  }

  /** Returns true when the key is a drive key (caller may preventDefault). */
  keyDown(code: string): boolean {
    const side = sideForKey(code);
    if (!side) return false;
    this.press(side, `key:${code}`);
    return true;
  }

  keyUp(code: string): boolean {
    if (!sideForKey(code)) return false;
    this.release(`key:${code}`);
    return true;
  }

  // ---------------------------------------------------------- touch hooks

  touchStart(side: DriveSide, pointerId: number): void {
    this.press(side, `pointer:${pointerId}`);
  }

  /** A finger lifted normally (pointerup): releases just that pointer. */
  touchEnd(pointerId: number): void {
    this.release(`pointer:${pointerId}`);
  }

  /**
   * A touch was CANCELLED (pointercancel, or capture lost while the pointer
   * was still held — a system gesture / interruption): full input clear, as
   * for blur, so no other stale key or finger can keep the cart driving.
   */
  touchCancel(): void {
    this.clear();
  }

  /** Listen for drive keys on `target` (usually window). Returns an unbind function. */
  bindKeyboard(target: ListenerTarget): () => void {
    const down = (e: Event) => {
      if (this.keyDown((e as KeyboardEvent).code)) e.preventDefault();
    };
    const up = (e: Event) => {
      if (this.keyUp((e as KeyboardEvent).code)) e.preventDefault();
    };
    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    return () => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
    };
  }
}

/** Minimal element surface the touch-button binding needs (a button in the browser). */
export interface TouchButtonTarget extends ListenerTarget {
  setPointerCapture?(pointerId: number): void;
}

/**
 * Hold-to-drive wiring for an on-screen button:
 *   pointerdown        -> touchStart(side, id) (+ pointer capture)
 *   pointerup          -> touchEnd(id)          (only that finger)
 *   pointercancel      -> touchCancel()         (FULL clear)
 *   lostpointercapture -> touchCancel() if that pointer was still held (a
 *                         capture lost without pointerup is a cancellation;
 *                         after a normal pointerup it is already released and
 *                         this is a no-op, so other fingers/keys survive).
 * Returns an unbind function.
 */
export function bindTouchButton(el: TouchButtonTarget, side: DriveSide, input: DriveInput): () => void {
  const id = (e: Event) => (e as PointerEvent).pointerId;
  const down = (e: Event) => {
    e.preventDefault();
    try {
      el.setPointerCapture?.(id(e));
    } catch {
      // capture can fail for a pointer that is already gone; input still works
    }
    input.touchStart(side, id(e));
  };
  const up = (e: Event) => input.touchEnd(id(e));
  const cancel = () => input.touchCancel();
  const lost = (e: Event) => {
    if (input.hasSource(`pointer:${id(e)}`)) input.touchCancel();
  };
  const menu = (e: Event) => e.preventDefault();
  const pairs: Array<[string, (e: Event) => void]> = [
    ['pointerdown', down],
    ['pointerup', up],
    ['pointercancel', cancel],
    ['lostpointercapture', lost],
    ['contextmenu', menu],
  ];
  for (const [t, f] of pairs) el.addEventListener(t, f);
  return () => {
    for (const [t, f] of pairs) el.removeEventListener(t, f);
  };
}

export function sideForKey(code: string): DriveSide | null {
  if (LEFT_KEYS.includes(code)) return 'left';
  if (RIGHT_KEYS.includes(code)) return 'right';
  return null;
}
