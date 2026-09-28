/**
 * FS1: get rid of the browser toolbar on landscape phones.
 *
 * - Where the Fullscreen API works (Android, iPad, desktop) the Play button
 *   calls `enterFullscreen()` from its user gesture.
 * - iPhone Safari has no element fullscreen. Its landscape toolbar only
 *   collapses when the user scrolls the page, and the game page never
 *   scrolls (html/body are touch-action:none, overflow:hidden). So on iPhone
 *   (outside an installed home-screen app) `html.pr-ios-scroll` makes the
 *   document a little taller than the viewport and lets it pan vertically;
 *   #app stays position:fixed over it. While the toolbar is showing in
 *   landscape, a "Swipe up for fullscreen" overlay (touch-action:pan-y)
 *   covers the game so the swipe scrolls the page and Safari hides its bars.
 *   Game surfaces keep touch-action:none, so play never scrolls the page.
 */

import { el } from './dom';

/** Landscape toolbar is "showing" when the viewport is this much shorter than the screen. */
export const TOOLBAR_SLACK_PX = 24;

export interface ViewportInfo {
  innerWidth: number;
  innerHeight: number;
  screenWidth: number;
  screenHeight: number;
}

/** iPhone / iPod browser tab (not the installed home-screen app). */
export function isIphoneBrowser(userAgent: string, standalone: boolean | undefined): boolean {
  return /iPhone|iPod/.test(userAgent) && standalone !== true;
}

/** Pure rule: landscape, and the viewport is noticeably shorter than the screen's short side. */
export function toolbarShowingInLandscape(v: ViewportInfo): boolean {
  if (v.innerWidth <= v.innerHeight) return false;
  const shortSide = Math.min(v.screenWidth, v.screenHeight);
  return v.innerHeight < shortSide - TOOLBAR_SLACK_PX;
}

type FsDoc = Document & { webkitFullscreenElement?: Element | null };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

/** Best-effort fullscreen from a user gesture; silently ignored where unsupported (iPhone). */
export function enterFullscreen(): void {
  const doc = document as FsDoc;
  if (doc.fullscreenElement || doc.webkitFullscreenElement) return;
  const root = document.documentElement as FsEl;
  try {
    if (typeof root.requestFullscreen === 'function') {
      root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    } else if (typeof root.webkitRequestFullscreen === 'function') {
      void Promise.resolve(root.webkitRequestFullscreen()).catch(() => {});
    }
  } catch {
    /* unsupported: nothing to do */
  }
}

let dismissed = false;

/**
 * Install the iPhone swipe-up helper (no-op elsewhere). Returns an idempotent
 * uninstall that removes the overlay, listeners and the html class.
 */
export function installSwipeToFullscreen(): () => void {
  const nav = navigator as Navigator & { standalone?: boolean };
  if (!isIphoneBrowser(nav.userAgent ?? '', nav.standalone)) return () => {};

  const html = document.documentElement;
  html.classList.add('pr-ios-scroll');
  const overlay = el('div', { class: 'pr-swipe-fs', role: 'dialog', 'aria-label': 'Swipe up for fullscreen', hidden: true }, [
    el('div', { class: 'pr-swipe-fs__arrow', 'aria-hidden': 'true', text: '↑' }),
    el('div', { text: 'Swipe up for fullscreen' }),
    el('div', { class: 'pr-swipe-fs__hint', text: 'Or Share → Add to Home Screen to always play fullscreen.' }),
  ]);
  const notNow = el('button', { type: 'button', class: 'pr-btn pr-swipe-fs__skip', text: 'Not now' });
  notNow.addEventListener('click', () => {
    dismissed = true;
    update();
  });
  overlay.appendChild(notNow);
  document.body.appendChild(overlay);

  function update(): void {
    const show =
      !dismissed &&
      toolbarShowingInLandscape({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        screenWidth: screen.width,
        screenHeight: screen.height,
      });
    overlay.hidden = !show;
  }
  // iOS reports the new size a beat after rotating / the bars animating
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settle = (): void => {
    update();
    clearTimeout(timer);
    timer = setTimeout(update, 350);
  };
  window.addEventListener('resize', settle);
  window.addEventListener('orientationchange', settle);
  window.addEventListener('scroll', update, { passive: true });
  window.visualViewport?.addEventListener('resize', settle);
  update();

  let done = false;
  return () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    window.removeEventListener('resize', settle);
    window.removeEventListener('orientationchange', settle);
    window.removeEventListener('scroll', update);
    window.visualViewport?.removeEventListener('resize', settle);
    overlay.remove();
    html.classList.remove('pr-ios-scroll');
  };
}
