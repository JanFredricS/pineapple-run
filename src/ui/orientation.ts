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

/** Idempotent. */
export function installRotateOverlay(): HTMLElement {
  if (overlay && overlay.isConnected) return overlay;
  overlay = el('div', { class: 'pr-rotate', role: 'alertdialog', 'aria-label': 'Rotate your device' }, [
    icon(ROTATE_SVG),
    el('div', { text: 'Rotate your device' }),
    el('div', { text: 'Pineapple Run plays in landscape.', style: 'font-weight:500;font-size:15px' }),
  ]);
  document.body.appendChild(overlay);
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  window.matchMedia?.('(orientation: portrait)').addEventListener?.('change', update);
  update();
  return overlay;
}

/** Harness/dev: force the overlay on or off, or back to automatic. */
export function forceRotateOverlay(mode: 'on' | 'off' | 'auto'): void {
  const o = installRotateOverlay();
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
