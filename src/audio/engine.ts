/**
 * Web Audio context management.
 *
 *  - Lazy: no AudioContext exists until something needs one (a play call or
 *    the first unlock gesture). Creation failures / missing Web Audio leave the
 *    engine in a silent no-op state; nothing throws to the game.
 *  - Mobile unlock: `attach(unlockTarget)` listens (capture, passive) for the
 *    first pointerdown / touchend / keydown; the handler resumes the context
 *    inside the gesture and plays a 1-sample silent buffer (iOS). Listeners are
 *    removed once the context actually reports 'running'; a failed resume keeps
 *    them for the next gesture.
 *  - Graph: musicBus → musicTone (low-pass) → master; sfxBus → master;
 *    master → compressor (soft limiter) → destination.
 *  - Settings (mute + per-bus volume) persist in localStorage under
 *    AUDIO_STORAGE_KEY. Every setter applies in memory and returns whether the
 *    write actually persisted (quota / disabled storage → false, never throws).
 *  - Suspends the context while the document is hidden; resumes on visible.
 *  - destroy(): removes every listener, closes the context, drops all nodes.
 */

import { clamp01 } from './dsp';
import type {
  AudioContextFactory,
  AudioContextLike,
  BiquadFilterNodeLike,
  DynamicsCompressorNodeLike,
  EventTargetLike,
  GainNodeLike,
  ListenerLike,
  StorageLike,
  VisibilitySourceLike,
} from './types';

export const AUDIO_STORAGE_KEY = 'pineapple-run.audio';

export interface AudioSettings {
  muted: boolean;
  /** Music volume 0..1 (user-facing; scaled by MUSIC_BUS_LEVEL). */
  music: number;
  /** SFX volume 0..1 (user-facing; scaled by SFX_BUS_LEVEL). */
  sfx: number;
}

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = { muted: false, music: 0.7, sfx: 0.8 };

/** Music sits well under the SFX — "quiet by default". */
export const MUSIC_BUS_LEVEL = 0.32;
export const SFX_BUS_LEVEL = 0.75;
/** Low-pass on the whole music bus: keeps square/saw voices soft. */
export const MUSIC_TONE_HZ = 3200;
/** Seconds for volume / mute changes (setTargetAtTime time constant). */
export const VOLUME_SMOOTHING = 0.03;

export const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'keydown'] as const;
const UNLOCK_OPTIONS: AddEventListenerOptions = { capture: true, passive: true };

/** Tolerant parse: anything malformed falls back field-by-field to defaults. */
export function parseAudioSettings(raw: string | null): AudioSettings {
  const out: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  if (raw === null) return out;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof data !== 'object' || data === null) return out;
  const rec = data as Record<string, unknown>;
  if (typeof rec.muted === 'boolean') out.muted = rec.muted;
  if (typeof rec.music === 'number' && Number.isFinite(rec.music)) out.music = clamp01(rec.music);
  if (typeof rec.sfx === 'number' && Number.isFinite(rec.sfx)) out.sfx = clamp01(rec.sfx);
  return out;
}

export function loadAudioSettings(storage: StorageLike | null): AudioSettings {
  if (!storage) return { ...DEFAULT_AUDIO_SETTINGS };
  try {
    return parseAudioSettings(storage.getItem(AUDIO_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

/** True only if the write went through. */
export function saveAudioSettings(storage: StorageLike | null, s: AudioSettings): boolean {
  if (!storage) return false;
  try {
    storage.setItem(AUDIO_STORAGE_KEY, JSON.stringify({ v: 1, muted: s.muted, music: s.music, sfx: s.sfx }));
    return true;
  } catch {
    return false;
  }
}

/** The browser's AudioContext (webkit-prefixed on old Safari), or null. */
export const browserAudioContextFactory: AudioContextFactory = () => {
  const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) return null;
  try {
    // Assigning the real context to AudioContextLike is the compile-time
    // proof that the structural types in ./types match the DOM.
    const ctx: AudioContextLike = new Ctor({ latencyHint: 'interactive' });
    return ctx;
  } catch {
    return null;
  }
};

export function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export interface AudioEngineOptions {
  createContext?: AudioContextFactory;
  /** null = no persistence. Default: window.localStorage when reachable. */
  storage?: StorageLike | null;
  /** null = no suspend-on-hidden. Default: `document` when present. */
  visibility?: VisibilitySourceLike | null;
}

export interface AudioGraph {
  ctx: AudioContextLike;
  master: GainNodeLike;
  musicBus: GainNodeLike;
  musicTone: BiquadFilterNodeLike;
  sfxBus: GainNodeLike;
  limiter: DynamicsCompressorNodeLike;
}

export class AudioEngine {
  private readonly factory: AudioContextFactory;
  private readonly storage: StorageLike | null;
  private readonly visibility: VisibilitySourceLike | null;
  private settingsState: AudioSettings;
  private graphState: AudioGraph | null = null;
  private creationFailed = false;
  private unlockTarget: EventTargetLike | null = null;
  private visibilityAttached = false;
  private unlockedFlag = false;
  private suspendedForHidden = false;
  private destroyedFlag = false;
  private readonly contextListeners = new Set<(graph: AudioGraph) => void>();

  constructor(opts: AudioEngineOptions = {}) {
    this.factory = opts.createContext ?? browserAudioContextFactory;
    this.storage = opts.storage === undefined ? browserStorage() : opts.storage;
    this.visibility =
      opts.visibility === undefined ? (typeof document === 'undefined' ? null : (document as VisibilitySourceLike)) : opts.visibility;
    this.settingsState = loadAudioSettings(this.storage);
  }

  get settings(): Readonly<AudioSettings> {
    return this.settingsState;
  }

  get destroyed(): boolean {
    return this.destroyedFlag;
  }

  /** True once a gesture has resumed the context to 'running'. */
  get unlocked(): boolean {
    return this.unlockedFlag;
  }

  /** Whether unlock listeners are currently attached. */
  get awaitingUnlock(): boolean {
    return this.unlockTarget !== null;
  }

  /** 'none' before the context exists, else the context state. */
  get state(): string {
    return this.graphState ? this.graphState.ctx.state : 'none';
  }

  /** The graph if it already exists (never creates one). */
  get graph(): AudioGraph | null {
    return this.graphState;
  }

  /** Called with the graph right after lazy creation. */
  onContext(listener: (graph: AudioGraph) => void): () => void {
    this.contextListeners.add(listener);
    return () => this.contextListeners.delete(listener);
  }

  /** Creates the context + bus graph on first call; null if unavailable. */
  ensureGraph(): AudioGraph | null {
    if (this.graphState) return this.graphState;
    if (this.destroyedFlag || this.creationFailed) return null;
    let ctx: AudioContextLike | null = null;
    try {
      ctx = this.factory();
    } catch {
      ctx = null;
    }
    if (!ctx) {
      this.creationFailed = true;
      return null;
    }
    const master = ctx.createGain();
    const musicBus = ctx.createGain();
    const musicTone = ctx.createBiquadFilter();
    const sfxBus = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    const t = ctx.currentTime;
    master.gain.setValueAtTime(this.settingsState.muted ? 0 : 1, t);
    musicBus.gain.setValueAtTime(this.settingsState.music * MUSIC_BUS_LEVEL, t);
    sfxBus.gain.setValueAtTime(this.settingsState.sfx * SFX_BUS_LEVEL, t);
    musicTone.type = 'lowpass';
    musicTone.frequency.setValueAtTime(MUSIC_TONE_HZ, t);
    musicTone.Q.setValueAtTime(0.5, t);
    limiter.threshold.setValueAtTime(-10, t);
    limiter.knee.setValueAtTime(8, t);
    limiter.ratio.setValueAtTime(8, t);
    limiter.attack.setValueAtTime(0.004, t);
    limiter.release.setValueAtTime(0.2, t);
    musicBus.connect(musicTone);
    musicTone.connect(master);
    sfxBus.connect(master);
    master.connect(limiter);
    limiter.connect(ctx.destination);
    this.graphState = { ctx, master, musicBus, musicTone, sfxBus, limiter };
    for (const l of [...this.contextListeners]) l(this.graphState);
    return this.graphState;
  }

  /** Attaches unlock-on-gesture to `target` and suspend-on-hidden. Idempotent. */
  attach(unlockTarget: EventTargetLike): void {
    if (this.destroyedFlag) return;
    if (!this.unlockedFlag && this.unlockTarget !== unlockTarget) {
      this.detachUnlock();
      this.unlockTarget = unlockTarget;
      for (const type of UNLOCK_EVENTS) unlockTarget.addEventListener(type, this.onGesture, UNLOCK_OPTIONS);
    }
    if (this.visibility && !this.visibilityAttached) {
      this.visibility.addEventListener('visibilitychange', this.onVisibility);
      this.visibilityAttached = true;
    }
  }

  private detachUnlock(): void {
    const target = this.unlockTarget;
    if (!target) return;
    for (const type of UNLOCK_EVENTS) target.removeEventListener(type, this.onGesture, UNLOCK_OPTIONS);
    this.unlockTarget = null;
  }

  private readonly onGesture: ListenerLike = () => {
    if (this.destroyedFlag) return;
    const graph = this.ensureGraph();
    if (!graph) {
      // No Web Audio at all: stop listening, nothing will ever unlock.
      this.detachUnlock();
      return;
    }
    const { ctx } = graph;
    try {
      // iOS: starting any source inside the gesture unlocks output.
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* best effort */
    }
    let p: Promise<void>;
    try {
      p = ctx.resume();
    } catch {
      return;
    }
    p.then(
      () => {
        if (this.destroyedFlag || this.graphState?.ctx !== ctx) return;
        if (ctx.state === 'running') {
          this.unlockedFlag = true;
          this.detachUnlock();
        }
      },
      () => {
        /* keep listening for the next gesture */
      },
    );
  };

  /**
   * Suspend/resume are async and a hide→show can arrive before a pending
   * suspend() settles (the context still reports 'running'). So transitions
   * are driven by INTENT, not by a snapshot of the state: every
   * visibilitychange appends a reconcile step to one promise chain (each
   * step awaits the previous transition), and each step loops — after every
   * settled suspend/resume it re-reads the CURRENT visibility and acts again
   * until context state and visibility agree.
   */
  private readonly onVisibility: ListenerLike = () => {
    if (!this.graphState || this.destroyedFlag || !this.visibility) return;
    this.visibilityChain = this.visibilityChain.then(() => this.reconcileVisibility());
  };

  private visibilityChain: Promise<void> = Promise.resolve();

  /** Settles once every queued visibility transition has completed (tests / harness). */
  get visibilitySettled(): Promise<void> {
    return this.visibilityChain;
  }

  private async reconcileVisibility(): Promise<void> {
    // Bounded: each iteration performs one transition toward the current intent.
    for (let i = 0; i < 4; i++) {
      if (!(await this.visibilityStep())) return;
    }
  }

  /** One transition toward the current visibility; false when nothing was needed. */
  private async visibilityStep(): Promise<boolean> {
    const graph = this.graphState;
    if (!graph || this.destroyedFlag || !this.visibility) return false;
    const { ctx } = graph;
    const hidden = this.visibility.visibilityState === 'hidden';
    try {
      if (hidden) {
        if (ctx.state !== 'running') return false;
        this.suspendedForHidden = true;
        await ctx.suspend();
        return true;
      }
      if ((this.suspendedForHidden || this.unlockedFlag) && ctx.state !== 'running' && ctx.state !== 'closed') {
        this.suspendedForHidden = false;
        await ctx.resume();
        return true;
      }
      if (ctx.state === 'running') this.suspendedForHidden = false;
      return false;
    } catch {
      return false;
    }
  }

  private smooth(node: GainNodeLike, value: number): void {
    const graph = this.graphState;
    if (!graph) return;
    const t = graph.ctx.currentTime;
    node.gain.cancelScheduledValues(t);
    node.gain.setTargetAtTime(value, t, VOLUME_SMOOTHING);
  }

  /** Applies mute; returns whether it persisted. */
  setMuted(muted: boolean): boolean {
    this.settingsState = { ...this.settingsState, muted };
    if (this.graphState) this.smooth(this.graphState.master, muted ? 0 : 1);
    return saveAudioSettings(this.storage, this.settingsState);
  }

  /** Music volume 0..1; returns whether it persisted. */
  setMusicVolume(volume: number): boolean {
    const music = clamp01(Number.isFinite(volume) ? volume : 0);
    this.settingsState = { ...this.settingsState, music };
    if (this.graphState) this.smooth(this.graphState.musicBus, music * MUSIC_BUS_LEVEL);
    return saveAudioSettings(this.storage, this.settingsState);
  }

  /** SFX volume 0..1; returns whether it persisted. */
  setSfxVolume(volume: number): boolean {
    const sfx = clamp01(Number.isFinite(volume) ? volume : 0);
    this.settingsState = { ...this.settingsState, sfx };
    if (this.graphState) this.smooth(this.graphState.sfxBus, sfx * SFX_BUS_LEVEL);
    return saveAudioSettings(this.storage, this.settingsState);
  }

  /** Full teardown. Safe to call twice. */
  async destroy(): Promise<void> {
    if (this.destroyedFlag) return;
    this.destroyedFlag = true;
    this.detachUnlock();
    if (this.visibility && this.visibilityAttached) {
      this.visibility.removeEventListener('visibilitychange', this.onVisibility);
      this.visibilityAttached = false;
    }
    this.contextListeners.clear();
    const graph = this.graphState;
    this.graphState = null;
    if (!graph) return;
    for (const node of [graph.musicBus, graph.musicTone, graph.sfxBus, graph.master, graph.limiter]) {
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    if (graph.ctx.state !== 'closed') {
      try {
        await graph.ctx.close();
      } catch {
        /* closing twice / unsupported: nothing left to do */
      }
    }
  }
}
