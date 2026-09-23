/**
 * Run HUD overlay: sim-time timer, pineapple count, Release / Give Up buttons,
 * touch drive buttons. Display + intents only — it owns no simulation and no
 * clock. Phase comes from S1's run-lifecycle events via the pure hud.ts
 * machine; the timer shows `clock()` (S1's sim time since Release).
 */

import type { RunEvent, RunEventSource } from '../../model/runEvents';
import { TOTAL_PINEAPPLES } from '../../model/score';
import { button, disposer, el, icon } from '../dom';
import { formatClock, formatDistance } from '../format';
import {
  displayTime,
  driveEnabled,
  endBanner,
  giveUpButton,
  hudReduce,
  initialHud,
  releaseButton,
  stuckHint,
  type HudAction,
  type HudState,
  type RunMode,
} from '../hud';
import { soundToggle, type SoundControl } from '../sound';
import { ARROW_LEFT_SVG, ARROW_RIGHT_SVG, CLOCK_SVG, DISTANCE_SVG, PINEAPPLE_SVG, STOP_SVG } from '../icons';

export type DriveIntent = -1 | 0 | 1;

/** Player intents. S6 wires these to S1's run controller. */
export interface RunControls {
  release(): void;
  giveUp(): void;
  setDrive(direction: DriveIntent): void;
  /**
   * A drive touch was CANCELLED (pointercancel, or pointer capture lost while
   * the finger was still held — a system gesture / interruption). The HUD has
   * already released every touch it tracks; the host clears every other held
   * input source too (keyboard: DriveInput.touchCancel()), so nothing stale
   * keeps the cart driving. Same contract as src/run/input bindTouchButton.
   */
  cancelInput?(): void;
  /** S6T #5: restart the run from scratch (R key, the "Stuck?" hint's Retry). */
  retry?(): void;
}

/**
 * Live run readings the lifecycle events don't carry. Supplied by S1's run
 * controller, wired by S6 (INTEGRATION.md).
 */
export interface RunTelemetry {
  /** Furthest distance carried so far (endless), metres. */
  furthestMetres(): number;
  /**
   * Pineapples physically aboard the cart right now. Drives the endless HUD
   * count and the display-only carry bonus at the end — NOT `remaining`
   * (which counts pineapples not yet declared lost).
   */
  aboard(): number;
  /** S6T #5: the cart has barely moved for a while (RunSession.stuck). Polled per frame. */
  stuck?(): boolean;
}

export interface RunEndInfo {
  outcome: RunEvent;
  /** Pineapples aboard at the end, from telemetry.aboard() (falls back to `remaining` without telemetry). Display-only bonus. */
  aboard: number;
  /** Furthest distance carried (endless), sampled the moment the run ended. */
  furthestMetres: number;
}

export interface RunHudOptions {
  mode: RunMode;
  source: RunEventSource;
  /**
   * Sim seconds since Release. Default: `source.simTime()` (RunEventSource
   * contract amendment, S6). Override only for harnesses. Display only.
   */
  clock?: () => number;
  controls: RunControls;
  telemetry?: RunTelemetry;
  /** Called once, `endDelayMs` after the run-ending event (banner shows meanwhile). */
  onEnded(info: RunEndInfo): void;
  endDelayMs?: number;
  /** Touch drive buttons: 'auto' = coarse pointers only. */
  touchControls?: 'auto' | 'always' | 'never';
  courseName?: string;
  /** Mute toggle (S6V), shown in the top-right cluster; omitted = no button. */
  sound?: SoundControl;
}

export interface RunHud {
  readonly state: HudState;
  destroy(): void;
}

export function mountRunHud(host: HTMLElement, opts: RunHudOptions): RunHud {
  const d = disposer();
  let state = initialHud(opts.mode);
  const clock = opts.clock ?? (() => opts.source.simTime());
  let endTimer: ReturnType<typeof setTimeout> | null = null;
  let endInfo: RunEndInfo | null = null;
  let destroyed = false;

  // ------------------------------------------------------------- elements
  const timerText = el('span', { text: formatClock(0) });
  const timer = el('div', { class: 'pr-chip pr-timer', role: 'timer', 'aria-label': 'Time' }, [icon(CLOCK_SVG), timerText]);
  const countText = el('span');
  const countChip = el('div', { class: 'pr-chip', 'aria-label': 'Pineapples' }, [icon(PINEAPPLE_SVG), countText]);
  const distText = el('span');
  const distChip = el('div', { class: 'pr-chip', 'aria-label': 'Distance' }, [icon(DISTANCE_SVG), distText]);
  const hint = el('div', { class: 'pr-hud__hint' });
  const release = button('', () => dispatch({ type: 'releaseRequested' }), { cls: 'pr-btn--primary pr-release', attrs: { 'data-testid': 'release' } });
  const giveUp = button('Give Up', () => dispatch({ type: 'giveUpRequested' }), { cls: 'pr-giveup', icon: STOP_SVG, attrs: { 'data-testid': 'give-up' } });
  const stuckText = el('span', { text: 'Stuck?' });
  const stuckRetry = opts.controls.retry
    ? button('Retry (R)', () => opts.controls.retry?.(), { cls: 'pr-btn--primary pr-stuck__retry', attrs: { 'data-testid': 'stuck-retry' } })
    : null;
  const stuckBox = el('div', { class: 'pr-hud__hint pr-stuck', role: 'status', 'data-testid': 'stuck-hint' }, [stuckText, stuckRetry]);
  stuckBox.hidden = true;
  const banner = el('div', { class: 'pr-hud__banner', role: 'status' });
  banner.hidden = true;

  const tl = el('div', { class: 'pr-hud__tl' }, [countChip, opts.mode === 'endless' ? distChip : null, hint, stuckBox]);
  // S6T #13: Release sits at the bottom centre, clear of the funnel (framed above it)
  const tc = el('div', { class: 'pr-hud__bc' }, [release]);
  const tr = el('div', { class: 'pr-hud__tr' }, [timer, giveUp, opts.sound ? soundToggle(opts.sound) : null]);

  // ------------------------------------------------------ drive buttons
  const pressed = { left: new Set<number>(), right: new Set<number>() };
  let lastDrive: DriveIntent = 0;
  const emitDrive = () => {
    const dir = (driveEnabled(state) ? (pressed.right.size > 0 ? 1 : 0) - (pressed.left.size > 0 ? 1 : 0) : 0) as DriveIntent;
    left.dataset.active = String(pressed.left.size > 0);
    right.dataset.active = String(pressed.right.size > 0);
    if (dir !== lastDrive) {
      lastDrive = dir;
      opts.controls.setDrive(dir);
    }
  };
  const clearDrive = () => {
    pressed.left.clear();
    pressed.right.clear();
    emitDrive();
  };
  const driveButton = (side: 'left' | 'right') => {
    const b = el('button', { type: 'button', class: `pr-drive pr-drive--${side}`, 'aria-label': side === 'left' ? 'Drive left' : 'Drive right' }, [
      icon(side === 'left' ? ARROW_LEFT_SVG : ARROW_RIGHT_SVG),
    ]);
    const set = pressed[side];
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!driveEnabled(state)) return;
      try {
        b.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
      set.add(e.pointerId);
      emitDrive();
    });
    // pointerup: only that finger. pointercancel: FULL clear (every finger on
    // both buttons + the host's other inputs). lostpointercapture while the
    // finger is still held is a cancellation too; after a normal pointerup
    // the finger is already gone and it is a no-op (other fingers survive).
    const up = (e: PointerEvent) => {
      if (set.delete(e.pointerId)) emitDrive();
    };
    const cancel = () => {
      clearDrive();
      opts.controls.cancelInput?.();
    };
    const lost = (e: PointerEvent) => {
      if (set.has(e.pointerId)) cancel();
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', cancel);
    b.addEventListener('lostpointercapture', lost);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  };
  const left = driveButton('left');
  const right = driveButton('right');
  const keys = el('div', { class: 'pr-hud__hint pr-keys', text: 'Hold ← / → to drive' });

  const root = el('div', { class: 'pr-hud', 'data-touch': opts.touchControls ?? 'auto', 'aria-label': opts.courseName ? `Run: ${opts.courseName}` : 'Run' }, [
    tl,
    tc,
    tr,
    banner,
    left,
    right,
    keys,
  ]);
  host.appendChild(root);

  // Clear held input whenever the page loses focus/visibility (PLAN clock policy).
  d.listen(window, 'blur', clearDrive);
  d.listen(document, 'visibilitychange', () => {
    if (document.hidden) clearDrive();
  });
  d.listen(window, 'keydown', (e) => {
    const k = e as KeyboardEvent;
    if (k.code === 'Space' && state.phase === 'ready' && !k.repeat) {
      k.preventDefault();
      dispatch({ type: 'releaseRequested' });
    }
    // S6T #5: R restarts the run (any phase; not while typing in a field)
    if (k.code === 'KeyR' && !k.repeat && !k.ctrlKey && !k.metaKey && !k.altKey && opts.controls.retry && (k.target as { tagName?: string } | null)?.tagName !== 'INPUT') {
      k.preventDefault();
      opts.controls.retry();
    }
  });

  // --------------------------------------------------------------- render
  const render = () => {
    const rb = releaseButton(state);
    release.hidden = !rb.visible;
    release.disabled = !rb.enabled;
    release.textContent = rb.label;
    release.classList.toggle('pr-attention', rb.attention);

    const gb = giveUpButton(state);
    giveUp.hidden = !gb.visible;
    giveUp.disabled = !gb.enabled;
    giveUp.lastElementChild!.textContent = gb.label;
    giveUp.classList.toggle('pr-attention', gb.attention);

    if (opts.mode === 'endless') {
      renderAboard();
    } else {
      countText.textContent = `${state.delivered ?? state.remaining}/${TOTAL_PINEAPPLES}`;
      countChip.dataset.warn = String(state.remaining === 0);
    }
    hint.textContent = state.mode === 'level' && state.allLost && state.phase !== 'ended' ? 'All pineapples lost' : '';
    hint.hidden = hint.textContent === '';

    const drive = driveEnabled(state);
    left.disabled = !drive;
    right.disabled = !drive;
    keys.hidden = !drive;

    const st = stuckHint(state);
    stuckBox.hidden = st === '';
    stuckText.textContent = st;

    const b = endBanner(state);
    banner.hidden = b === '';
    banner.textContent = b;
  };

  // Endless count: live telemetry.aboard() (frozen at the end), else `remaining`.
  let lastAboard = -1;
  function renderAboard(): void {
    const n = endInfo ? endInfo.aboard : opts.telemetry ? opts.telemetry.aboard() : state.remaining;
    const a = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    if (a === lastAboard) return;
    lastAboard = a;
    countText.textContent = `${a} aboard`;
    countChip.dataset.warn = String(a === 0);
  }

  let lastTimer = '';
  let lastDist = '';
  let raf = 0;
  const tick = () => {
    if (destroyed) return;
    const t = formatClock(displayTime(state, clock()));
    if (t !== lastTimer) timerText.textContent = lastTimer = t;
    if (opts.mode === 'endless') {
      const m = formatDistance(endInfo ? endInfo.furthestMetres : (opts.telemetry?.furthestMetres() ?? 0));
      if (m !== lastDist) distText.textContent = lastDist = m;
      renderAboard();
    }
    if (opts.telemetry?.stuck) {
      const stuck = opts.telemetry.stuck();
      if (stuck !== state.stuck) dispatch({ type: 'stuck', stuck });
    }
    raf = requestAnimationFrame(tick);
  };

  function dispatch(a: HudAction): void {
    if (destroyed) return;
    const prev = state;
    state = hudReduce(state, a);
    if (state === prev) return;
    // Intents fire exactly once, on the transition that accepts them.
    if (a.type === 'releaseRequested') opts.controls.release();
    if (a.type === 'giveUpRequested') opts.controls.giveUp();
    if (state.phase === 'ended' && prev.phase !== 'ended') {
      clearDrive();
      endInfo = {
        outcome: state.outcome!,
        aboard: opts.telemetry ? opts.telemetry.aboard() : state.remaining,
        furthestMetres: opts.telemetry?.furthestMetres() ?? 0,
      };
      const info = endInfo;
      endTimer = setTimeout(() => {
        endTimer = null;
        if (!destroyed) opts.onEnded(info);
      }, opts.endDelayMs ?? 1400);
    }
    if (!driveEnabled(state)) clearDrive();
    render();
  }

  const unsubscribe = opts.source.on((event) => dispatch({ type: 'event', event }));
  render();
  tick();

  return {
    get state() {
      return state;
    },
    destroy() {
      if (destroyed) return;
      clearDrive();
      destroyed = true;
      unsubscribe();
      if (endTimer) clearTimeout(endTimer);
      cancelAnimationFrame(raf);
      d.dispose();
      root.remove();
    },
  };
}
