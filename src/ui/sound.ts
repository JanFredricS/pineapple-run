/**
 * Sound (mute) toggle button, shared by the title screen and the run HUD.
 * The UI owns no audio: it talks to a `SoundControl` (S6V wires S7's
 * GameAudio mute, which persists itself to localStorage).
 */

import { el, icon } from './dom';
import { SOUND_OFF_SVG, SOUND_ON_SVG } from './icons';

export interface SoundControl {
  muted(): boolean;
  setMuted(muted: boolean): void;
}

/** A toggle button reflecting / flipping `ctrl.muted()` (aria-pressed = muted). */
export function soundToggle(ctrl: SoundControl): HTMLButtonElement {
  const b = el('button', { type: 'button', class: 'pr-btn pr-sound', 'data-testid': 'sound-toggle' });
  const render = () => {
    const muted = ctrl.muted();
    b.setAttribute('aria-pressed', String(muted));
    b.setAttribute('aria-label', muted ? 'Sound off (tap to unmute)' : 'Sound on (tap to mute)');
    b.replaceChildren(icon(muted ? SOUND_OFF_SVG : SOUND_ON_SVG));
  };
  b.addEventListener('click', () => {
    ctrl.setMuted(!ctrl.muted());
    render();
  });
  render();
  return b;
}
