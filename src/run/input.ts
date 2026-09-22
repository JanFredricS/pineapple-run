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

  /** pointerup / pointercancel / lostpointercapture all end a touch. */
  touchEnd(pointerId: number): void {
    this.release(`pointer:${pointerId}`);
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

export function sideForKey(code: string): DriveSide | null {
  if (LEFT_KEYS.includes(code)) return 'left';
  if (RIGHT_KEYS.includes(code)) return 'right';
  return null;
}
