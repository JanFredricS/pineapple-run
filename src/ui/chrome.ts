/** App-wide S5 chrome: rotate overlay + service worker. Idempotent. */

import { installRotateOverlay } from './orientation';
import { registerServiceWorker } from './pwa';

let installed = false;

export function installChrome(opts: { pwa: boolean }): void {
  installRotateOverlay();
  if (installed) return;
  installed = true;
  if (opts.pwa) registerServiceWorker();
}
