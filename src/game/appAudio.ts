/**
 * App-level audio (S6V): ONE S7 `GameAudio` for the page, owned by the App.
 *
 *  - construction is lazy (no AudioContext); `init(unlockTarget)` arms the
 *    engine's unlock-on-first-gesture listeners (pointerdown / touchend /
 *    keydown — Web Audio only starts inside a user gesture) and its
 *    suspend-while-hidden handling;
 *  - `enterState` picks the music per app screen (title/select: the title
 *    theme; build: the course theme from stage 0; results: the course theme,
 *    keeping the stage the run reached; run: the run hooks reset it);
 *  - `hooks` is the run-screen adapter (gameAudioHooks);
 *  - `sound` is the mute toggle for the title screen and HUD (GameAudio
 *    persists it to localStorage);
 *  - `destroy` releases everything (App.destroy).
 */

import { GameAudio, musicThemeForCourse, type MusicStage, type MusicTheme } from '../audio';
import type { EventTargetLike } from '../audio';
import type { AppState } from '../app';
import type { SoundControl } from '../ui/sound';
import { gameAudioHooks, type AudioHooks, type GameAudioLike } from './audioHooks';

/** What the App needs from its audio (AppOptions.audio). */
export interface AppAudioPort {
  enterState(state: AppState): void;
  readonly hooks: AudioHooks;
  readonly sound: SoundControl;
  destroy(): void;
}

/** The GameAudio surface used here (the real class satisfies it; tests pass a fake). */
export interface AppGameAudio extends GameAudioLike {
  init(unlockElement: EventTargetLike): void;
  readonly muted: boolean;
  setMuted(muted: boolean): boolean;
  destroy(): Promise<void>;
}

/** Music for an app screen: theme + optional stage (undefined = keep the current stage). */
export function musicForState(state: AppState): { theme: MusicTheme; stage?: MusicStage } | null {
  switch (state.name) {
    case 'title':
    case 'select':
      return { theme: 'title' };
    case 'build':
      return { theme: musicThemeForCourse(state.levelId), stage: 0 };
    case 'results':
      return { theme: musicThemeForCourse(state.levelId) };
    case 'run':
      return null; // the run hooks start the course theme at stage 0
  }
}

export class AppAudio implements AppAudioPort {
  readonly hooks: AudioHooks;
  readonly sound: SoundControl;
  private destroyed = false;

  constructor(
    readonly audio: AppGameAudio,
    unlockTarget: EventTargetLike | null,
  ) {
    if (unlockTarget) audio.init(unlockTarget);
    this.hooks = gameAudioHooks(audio);
    this.sound = {
      muted: () => audio.muted,
      setMuted: (m) => {
        audio.setMuted(m);
      },
    };
  }

  enterState(state: AppState): void {
    if (this.destroyed) return;
    const m = musicForState(state);
    if (!m) return;
    try {
      if (m.stage === undefined) this.audio.music.play(m.theme);
      else this.audio.music.play(m.theme, m.stage);
    } catch (err) {
      console.error('[audio]', err); // audio must never break a screen
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.audio.destroy().catch((err: unknown) => console.error('[audio] destroy failed', err));
  }
}

/** The page's audio: a real GameAudio, unlocked by the first gesture anywhere on `doc`. */
export function createAppAudio(doc: EventTargetLike | null = typeof document === 'undefined' ? null : document): AppAudio {
  return new AppAudio(new GameAudio(), doc);
}
