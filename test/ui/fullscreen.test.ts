/** FS1: iPhone swipe-to-fullscreen detection rules. */
import { describe, expect, it } from 'vitest';
import { isIphoneBrowser, toolbarShowingInLandscape } from '../../src/ui/fullscreen';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

describe('isIphoneBrowser', () => {
  it('matches iPhone Safari tabs only', () => {
    expect(isIphoneBrowser(IPHONE_UA, false)).toBe(true);
    expect(isIphoneBrowser(IPHONE_UA, undefined)).toBe(true);
    expect(isIphoneBrowser(IPHONE_UA, true)).toBe(false); // installed home-screen app is already fullscreen
    expect(isIphoneBrowser(IPAD_UA, false)).toBe(false);
    expect(isIphoneBrowser(ANDROID_UA, undefined)).toBe(false);
  });
});

describe('toolbarShowingInLandscape', () => {
  // iPhone 14: screen reports portrait 390x844 regardless of rotation
  const screen = { screenWidth: 390, screenHeight: 844 };
  it('landscape with the tab bar showing', () => {
    expect(toolbarShowingInLandscape({ innerWidth: 750, innerHeight: 340, ...screen })).toBe(true);
  });
  it('landscape with the bars collapsed', () => {
    expect(toolbarShowingInLandscape({ innerWidth: 844, innerHeight: 390, ...screen })).toBe(false);
  });
  it('never in portrait (the rotate overlay owns that)', () => {
    expect(toolbarShowingInLandscape({ innerWidth: 390, innerHeight: 660, ...screen })).toBe(false);
  });
});
