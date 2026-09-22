/**
 * Landscape enforcement: a rotate-your-device overlay on portrait phones.
 * CSS does the primary work (`@media (orientation: portrait) and
 * (max-width: 820px)` in ui.css); this JS fallback toggles `html.pr-portrait`
 * from the actual viewport size for browsers where the media query misfires
 * (e.g. some in-app webviews), and exposes the state so the run screen can
 * pause while the overlay covers the game (S6 wiring).
 */

import { el, icon } from './dom';
import { ROTATE_SVG } from './icons';

export const PORTRAIT_MAX_WIDTH = 820;

/** Pure rule shared with the CSS media query. */
export function shouldShowRotate(width: number, height: number): boolean {
  return height > width && width <= PORTRAIT_MAX_WIDTH;
}

type Listener = (portrait: boolean) => void;
const listeners = new Set<Listener>();
let overlay: HTMLElement | null = null;
let portrait = false;

export function isPortraitBlocked(): boolean {
  return portrait;
}

/** Subscribe to overlay visibility changes (S6: pause the run while shown). */
export function onPortraitChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function update(): void {
  const next = shouldShowRotate(window.innerWidth, window.innerHeight);
  document.documentElement.classList.toggle('pr-portrait', next);
  if (next !== portrait) {
    portrait = next;
    for (const l of [...listeners]) l(portrait);
  }
}

let installs = 0;
let portraitQuery: MediaQueryList | null = null;

function createOverlay(): HTMLElement {
  const o = el('div', { class: 'pr-rotate', role: 'alertdialog', 'aria-label': 'Rotate your device' }, [
    icon(ROTATE_SVG),
    el('div', { text: 'Rotate your device' }),
    el('div', { text: 'Pineapple Run plays in landscape.', style: 'font-weight:500;font-size:15px' }),
  ]);
  document.body.appendChild(o);
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  portraitQuery = window.matchMedia?.('(orientation: portrait)') ?? null;
  portraitQuery?.addEventListener?.('change', update);
  return o;
}

function teardownOverlay(): void {
  window.removeEventListener('resize', update);
  window.removeEventListener('orientationchange', update);
  portraitQuery?.removeEventListener?.('change', update);
  portraitQuery = null;
  overlay?.remove();
  overlay = null;
  document.documentElement.classList.remove('pr-portrait');
  if (portrait) {
    portrait = false;
    for (const l of [...listeners]) l(false);
  }
}

/**
 * Show the rotate overlay and start tracking orientation. Reference-counted:
 * every call returns its own idempotent uninstall; the overlay, the
 * `pr-portrait` class and the window/matchMedia listeners are removed when
 * the last holder uninstalls (App.destroy()).
 */
export function installRotateOverlay(): () => void {
  installs++;
  if (!overlay || !overlay.isConnected) {
    if (overlay) teardownOverlay();
    overlay = createOverlay();
  }
  update();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    installs = Math.max(0, installs - 1);
    if (installs === 0) teardownOverlay();
  };
}

/** Current overlay element, if installed (tests/harness). */
export function rotateOverlayElement(): HTMLElement | null {
  return overlay;
}

/**
 * Harness/dev: force the overlay on or off, or back to automatic. Needs an
 * installed overlay (the App installs one on start); no-op otherwise.
 */
export function forceRotateOverlay(mode: 'on' | 'off' | 'auto'): void {
  const o = overlay;
  if (!o) return;
  if (mode === 'auto') o.removeAttribute('data-force');
  else o.setAttribute('data-force', mode);
}

/**
 * Best-effort orientation lock (only honoured in fullscreen / installed PWA;
 * silently ignored elsewhere). Call from a user gesture.
 */
export function tryLockLandscape(): void {
  const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  o?.lock?.('landscape').catch(() => {});
}
