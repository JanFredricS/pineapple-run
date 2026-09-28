/**
 * App-wide S5 chrome: rotate overlay, iPhone swipe-to-fullscreen (FS1) + service worker.
 * `installChrome` returns an uninstall for the overlay (and its listeners);
 * the service worker registration is once per page and has no teardown.
 */

import { installSwipeToFullscreen } from './fullscreen';
import { installRotateOverlay } from './orientation';
import { registerServiceWorker } from './pwa';

let swRegistered = false;

export function installChrome(opts: { pwa: boolean }): () => void {
  const uninstallOverlay = installRotateOverlay();
  const uninstallSwipe = installSwipeToFullscreen();
  if (opts.pwa && !swRegistered) {
    swRegistered = true;
    registerServiceWorker();
  }
  return () => {
    uninstallSwipe();
    uninstallOverlay();
  };
}
