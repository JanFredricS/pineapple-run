/**
 * S7 audio — the one surface S6 wires in.
 *
 * src/audio depends on nothing in src/run, src/ui or src/render (only a
 * type-only import of the run-event contract from src/model). All music and
 * SFX are synthesized in code; nothing is loaded.
 *
 * ## Wiring guide for S6
 *
 * ```ts
 * const audio = new GameAudio();          // lazy: no AudioContext yet
 * audio.init(document.body);              // unlock on first tap/key; suspend when hidden
 * audio.music.play('title');              // title / level-select screens
 * // entering a run:
 * audio.music.play(musicThemeForCourse(levelId), 0);
 * runEvents.on((e) => audio.onRunEvent(e));
 * // every frame (or ~4 Hz) during a LEVEL run:
 * audio.setCourseProgress(cartX / courseLength);   // quarter → stage 0..3
 * // ENDLESS: audio.setEndlessDistance(metres) (stage steps every 150 m)
 * // drive input / wheel spin (|ω| / 20 rad/s cap) → motor pitch:
 * audio.sfx.wheelMotor.set(Math.abs(avgWheelSpin) / 20);
 * // physics contacts (from S1 contact events, if/when exposed):
 * audio.sfx.pineappleBounce(impactSpeedMetresPerSecond);
 * audio.sfx.strawClatter(clamp01(impactSpeed / 4));     // part-vs-ground/part hits
 * audio.sfx.springBoing(compressionFraction);           // shock compressed hard
 * audio.sfx.uiClick();                                  // buttons
 * // leaving the run screen / retry: audio.stopRunSounds()
 * // app teardown: await audio.destroy()
 * ```
 *
 * Run event → sound (`onRunEvent`):
 *  - started        → wheel motor loop starts (idle); stage 0
 *  - released       → strawClatter(0.5) (funnel plug pulled)
 *  - pineappleLost  → nothing (the bounce SFX already covers it)
 *  - goalReached    → goalSting + blender whir for BLENDER_WHIR_SECONDS; motor stops
 *  - gaveUp/allLost → loseSting; motor stops
 *
 * Course progress → stage: `stageForProgress` = floor(progress × 4), clamped
 * to 0..3 — the original's four loops cross-faded by course quarter, here as
 * four stems (base, +groove, +melody, +sparkle).
 */

import type { RunEvent } from '../model/runEvents';
import { clamp01, stageForProgress, type MusicStage } from './dsp';
import { AudioEngine, type AudioEngineOptions, type AudioSettings } from './engine';
import { MusicPlayer } from './music';
import { Sfx } from './sfx';
import type { MusicTheme } from './song';
import { globalTimers, type AudioTimers, type EventTargetLike } from './types';

export { stageForProgress, bounceGain, type MusicStage } from './dsp';
export { AUDIO_STORAGE_KEY, type AudioSettings } from './engine';
export { MUSIC_THEMES, type MusicTheme } from './song';
export { LoopedSound, type OneShotSfx } from './sfx';
export type { AudioContextFactory, AudioContextLike, EventTargetLike, StorageLike, VisibilitySourceLike, AudioTimers } from './types';

/** How long the blender whirs after a goal (s). */
export const BLENDER_WHIR_SECONDS = 2.5;
/** Endless mode: metres per stage step (0, 150, 300, 450+). */
export const ENDLESS_STAGE_METRES = 150;

/**
 * Course id (S5's ids: beach, kitchen, workbench, original, endless:<SEED>;
 * S9: tikibar) → music theme. The original course is the workbench-reskinned
 * bonus level. Zero-G Tiki Bar plays the beach song: marimba plucks, shaker
 * and a lazy reggae bass are the island-bar sound, and it is the calmest bed
 * for a floaty course that rewards slow driving (endless's steel drum is
 * tropical too, but drives and escalates by stage). Unknown ids fall back
 * to beach.
 */
export function musicThemeForCourse(levelId: string): MusicTheme {
  if (levelId === 'endless' || levelId.startsWith('endless:')) return 'endless';
  if (levelId === 'kitchen') return 'kitchen';
  if (levelId === 'workbench' || levelId === 'original') return 'workbench';
  if (levelId === 'tikibar') return 'beach';
  return 'beach';
}

/** Endless distance (m) → stage. */
export function stageForEndlessDistance(metres: number): MusicStage {
  if (!Number.isFinite(metres) || metres <= 0) return 0;
  const s = Math.floor(metres / ENDLESS_STAGE_METRES);
  return (s >= 3 ? 3 : s) as MusicStage;
}

export interface GameAudioOptions extends AudioEngineOptions {
  timers?: AudioTimers;
  /** Music composition seed (same seed → same loops). */
  musicSeed?: number;
  /** SFX variation RNG. */
  random?: () => number;
}

export class GameAudio {
  readonly engine: AudioEngine;
  readonly music: MusicPlayer;
  readonly sfx: Sfx;
  private readonly timers: AudioTimers;
  private blenderTimer: unknown = null;
  private destroyed = false;

  constructor(opts: GameAudioOptions = {}) {
    this.timers = opts.timers ?? globalTimers;
    this.engine = new AudioEngine(opts);
    this.music = new MusicPlayer(this.engine, { timers: this.timers, seed: opts.musicSeed });
    this.sfx = new Sfx(this.engine, { timers: this.timers, random: opts.random });
  }

  /** Arms unlock-on-first-gesture on `unlockElement` + suspend-when-hidden. */
  init(unlockElement: EventTargetLike): void {
    if (this.destroyed) return;
    this.engine.attach(unlockElement);
  }

  get unlocked(): boolean {
    return this.engine.unlocked;
  }

  get settings(): Readonly<AudioSettings> {
    return this.engine.settings;
  }

  get muted(): boolean {
    return this.engine.settings.muted;
  }

  /** Returns whether the setting persisted (false: quota / storage off — still applied). */
  setMuted(muted: boolean): boolean {
    return this.engine.setMuted(muted);
  }

  setMusicVolume(volume: number): boolean {
    return this.engine.setMusicVolume(volume);
  }

  setSfxVolume(volume: number): boolean {
    return this.engine.setSfxVolume(volume);
  }

  /** Level runs: fraction of the course covered (0..1) → music stage. */
  setCourseProgress(progress: number): void {
    const stage = stageForProgress(progress);
    if (stage !== this.music.stage) this.music.setStage(stage);
  }

  /** Endless runs: furthest distance (m) → music stage. */
  setEndlessDistance(metres: number): void {
    const stage = stageForEndlessDistance(metres);
    if (stage !== this.music.stage) this.music.setStage(stage);
  }

  /** Maps S1 lifecycle events to sounds (see header). */
  onRunEvent(event: RunEvent): void {
    if (this.destroyed) return;
    switch (event.type) {
      case 'started':
        this.clearBlenderTimer();
        this.sfx.blenderWhir.stop();
        this.music.setStage(0);
        this.sfx.wheelMotor.start(0);
        break;
      case 'released':
        this.sfx.strawClatter(0.5);
        break;
      case 'pineappleLost':
        break;
      case 'goalReached':
        this.sfx.wheelMotor.stop();
        this.sfx.goalSting();
        this.sfx.blenderWhir.start(clamp01(event.delivered / 15));
        this.clearBlenderTimer();
        this.blenderTimer = this.timers.setTimeout(() => {
          this.blenderTimer = null;
          this.sfx.blenderWhir.stop();
        }, BLENDER_WHIR_SECONDS * 1000);
        break;
      case 'gaveUp':
      case 'allLost':
        this.sfx.wheelMotor.stop();
        this.sfx.loseSting();
        break;
    }
  }

  /** Stops the looped run sounds (retry / leaving the run screen). */
  stopRunSounds(): void {
    this.clearBlenderTimer();
    this.sfx.stopLoops();
  }

  private clearBlenderTimer(): void {
    if (this.blenderTimer !== null) this.timers.clearTimeout(this.blenderTimer);
    this.blenderTimer = null;
  }

  /** Full teardown: listeners removed, timers cleared, nodes released, context closed. */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearBlenderTimer();
    this.music.destroy();
    this.sfx.destroy();
    await this.engine.destroy();
  }
}
