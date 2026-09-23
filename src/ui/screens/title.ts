import { button, disposer, el, icon } from '../dom';
import { PINEAPPLE_SVG } from '../icons';
import { tryLockLandscape } from '../orientation';
import { soundToggle, type SoundControl } from '../sound';

export interface TitleScreenOptions {
  onPlay(): void;
  /** Mute toggle (S6V); omitted = no button. */
  sound?: SoundControl;
}

export function mountTitleScreen(host: HTMLElement, opts: TitleScreenOptions): { destroy(): void } {
  const d = disposer();
  const play = button('Play', () => {
    tryLockLandscape();
    opts.onPlay();
  }, { cls: 'pr-btn--primary pr-btn--big pr-attention' });
  const root = el('section', { class: 'pr-screen pr-title', 'aria-label': 'Pineapple Run' }, [
    el('div', { class: 'pr-title__logo' }, [icon(PINEAPPLE_SVG), el('h1', { text: 'Pineapple Run' })]),
    el('p', { class: 'pr-title__tag', text: 'Build a cart. Haul 15 pineapples. Feed the blender.' }),
    play,
    el('p', { class: 'pr-title__credit', text: 'A tribute to Coconut Run (2008), the Flash-era cart-building classic.' }),
    opts.sound ? soundToggle(opts.sound) : null,
  ]);
  host.appendChild(root);
  d.listen(window, 'keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if ((k === 'Enter' || k === ' ') && document.activeElement !== play) {
      e.preventDefault();
      play.click();
    }
  });
  queueMicrotask(() => play.focus({ preventScroll: true }));
  return {
    destroy() {
      d.dispose();
      root.remove();
    },
  };
}
