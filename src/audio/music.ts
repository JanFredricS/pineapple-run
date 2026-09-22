/**
 * Music player: procedurally composed per-theme loops (song.ts), rendered by
 * synthesized voices (voices.ts), clocked by the lookahead scheduler.
 *
 * Graph per playing theme ("session"):
 *   voice → layerGain[0..3] → sessionBus → engine.musicBus
 *
 * Stage cross-fade = layered stems: all four layers share one grid, so they
 * are always phase-locked; `setStage` only ramps layer gains (tracked Ramps,
 * so an interrupted fade continues from where it is — no jumps). Notes for a
 * layer that is fully faded out are not scheduled at all (saves CPU on
 * phones); a layer fading in gets notes from the first step after the ramp
 * starts, on the shared grid.
 *
 * Theme changes fade the old session's bus out (it stops scheduling at once)
 * and fade the new one in; the old bus is disconnected after its fade.
 */

import type { AudioEngine, AudioGraph } from './engine';
import {
  applyRamp,
  constantRamp,
  LAYER_COUNT,
  rampValueAt,
  retarget,
  stageLayerTargets,
  stepSeconds,
  type MusicStage,
  type Ramp,
} from './dsp';
import { LookaheadScheduler, type StepInfo } from './scheduler';
import { composeSong, type MusicTheme, type Song } from './song';
import { globalTimers, type AudioTimers, type GainNodeLike } from './types';
import { createNoiseBuffer, playVoice, type VoiceKit } from './voices';

/** Relative mix level of each layer when on. */
export const LAYER_MIX: readonly [number, number, number, number] = [1, 0.8, 0.85, 0.6];
/** Default stage cross-fade (s). */
export const STAGE_FADE_SECONDS = 2;
/** Theme change / stop fade (s). */
export const THEME_FADE_SECONDS = 0.8;
/** Delay between play() and the first downbeat (s). */
export const START_DELAY = 0.06;

/** Layer target gains (mix level × on/off) for a stage. */
export function layerGainsForStage(stage: MusicStage): [number, number, number, number] {
  const on = stageLayerTargets(stage);
  return [on[0] * LAYER_MIX[0], on[1] * LAYER_MIX[1], on[2] * LAYER_MIX[2], on[3] * LAYER_MIX[3]];
}

/** True when a layer is (and stays) silent at time t — its notes may be skipped. */
export function layerSilentAt(r: Ramp, t: number): boolean {
  return r.to <= 0 && rampValueAt(r, t) <= 0;
}

interface Session {
  theme: MusicTheme;
  song: Song;
  bus: GainNodeLike;
  layers: GainNodeLike[];
  ramps: Ramp[];
  scheduler: LookaheadScheduler;
  kit: VoiceKit;
}

export interface MusicPlayerOptions {
  timers?: AudioTimers;
  /** Composition seed (same seed → same loops). */
  seed?: number;
  lookahead?: number;
  intervalMs?: number;
}

export class MusicPlayer {
  private readonly timers: AudioTimers;
  private readonly seed: number;
  private readonly lookahead: number | undefined;
  private readonly intervalMs: number | undefined;
  private session: Session | null = null;
  private stageValue: MusicStage = 0;
  private readonly retiring = new Map<GainNodeLike, unknown>();
  private noise: { graph: AudioGraph; kit: VoiceKit } | null = null;
  private readonly songs = new Map<MusicTheme, Song>();
  private destroyed = false;

  constructor(
    private readonly engine: AudioEngine,
    opts: MusicPlayerOptions = {},
  ) {
    this.timers = opts.timers ?? globalTimers;
    this.seed = (opts.seed ?? 20080101) >>> 0;
    this.lookahead = opts.lookahead;
    this.intervalMs = opts.intervalMs;
  }

  get theme(): MusicTheme | null {
    return this.session?.theme ?? null;
  }

  get stage(): MusicStage {
    return this.stageValue;
  }

  /** Current layer ramps (read-only view, for tests / the harness). */
  get layerRamps(): readonly Ramp[] {
    return this.session ? this.session.ramps : [];
  }

  /** The composed loop for a theme (cached; deterministic per seed). */
  song(theme: MusicTheme): Song {
    let s = this.songs.get(theme);
    if (!s) {
      s = composeSong(theme, this.seed);
      this.songs.set(theme, s);
    }
    return s;
  }

  private kitFor(graph: AudioGraph): VoiceKit {
    if (this.noise?.graph !== graph) this.noise = { graph, kit: { ctx: graph.ctx, noise: createNoiseBuffer(graph.ctx, 1, this.seed) } };
    return this.noise.kit;
  }

  /**
   * Starts `theme` (cross-fading from whatever plays). Re-playing the current
   * theme is a no-op, so S6 can call it on every screen entry.
   * `stage` (default: the current stage) applies instantly, without a fade.
   */
  play(theme: MusicTheme, stage?: MusicStage): void {
    if (this.destroyed) return;
    if (stage !== undefined) this.stageValue = stage;
    if (this.session?.theme === theme) {
      if (stage !== undefined) this.setStage(stage, 0);
      return;
    }
    const graph = this.engine.ensureGraph();
    if (!graph) return;
    this.retireSession(THEME_FADE_SECONDS);
    const { ctx } = graph;
    const now = ctx.currentTime;
    const song = this.song(theme);
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0, now);
    bus.gain.linearRampToValueAtTime(1, now + (this.retiring.size > 0 ? THEME_FADE_SECONDS : 0.3));
    bus.connect(graph.musicBus);
    const targets = layerGainsForStage(this.stageValue);
    const layers: GainNodeLike[] = [];
    const ramps: Ramp[] = [];
    for (let i = 0; i < LAYER_COUNT; i++) {
      const g = ctx.createGain();
      const r = constantRamp(targets[i]!, now);
      applyRamp(g.gain, r);
      g.connect(bus);
      layers.push(g);
      ramps.push(r);
    }
    const kit = this.kitFor(graph);
    const session: Session = {
      theme,
      song,
      bus,
      layers,
      ramps,
      kit,
      scheduler: new LookaheadScheduler({
        now: () => ctx.currentTime,
        stepDuration: stepSeconds(),
        loopSteps: song.loopSteps,
        lookahead: this.lookahead,
        intervalMs: this.intervalMs,
        timers: this.timers,
        onStep: (info) => this.onStep(session, info),
      }),
    };
    this.session = session;
    session.scheduler.start(now + START_DELAY);
  }

  private onStep(session: Session, info: StepInfo): void {
    if (this.session !== session) return;
    const events = session.song.byStep[info.step];
    if (!events) return;
    const stepDur = session.scheduler.stepDuration;
    for (const e of events) {
      const ramp = session.ramps[e.layer]!;
      if (layerSilentAt(ramp, info.time)) continue;
      playVoice(session.kit, e.voice, session.layers[e.layer]!, {
        time: info.time,
        midi: e.midi,
        duration: e.length * stepDur,
        velocity: e.velocity,
      });
    }
  }

  /** Cross-fades to `stage` over `fade` seconds (0 = instant). */
  setStage(stage: MusicStage, fade: number = STAGE_FADE_SECONDS): void {
    if (this.destroyed) return;
    this.stageValue = stage;
    const s = this.session;
    const graph = this.engine.graph;
    if (!s || !graph) return;
    const now = graph.ctx.currentTime;
    const targets = layerGainsForStage(stage);
    for (let i = 0; i < LAYER_COUNT; i++) {
      const current = s.ramps[i]!;
      const target = targets[i]!;
      // Already there, or already fading there: don't restart the fade.
      if (current.to === target && (fade > 0 || rampValueAt(current, now) === target)) continue;
      const r = retarget(current, now, target, fade);
      s.ramps[i] = r;
      applyRamp(s.layers[i]!.gain, r);
    }
  }

  /** Fades out and stops the music. */
  stop(fade: number = THEME_FADE_SECONDS): void {
    this.retireSession(fade);
  }

  private retireSession(fade: number): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    s.scheduler.stop();
    const graph = this.engine.graph;
    if (!graph) {
      s.bus.disconnect();
      return;
    }
    const now = graph.ctx.currentTime;
    s.bus.gain.cancelScheduledValues(now);
    s.bus.gain.setTargetAtTime(0, now, Math.max(0.01, fade / 4));
    const bus = s.bus;
    const handle = this.timers.setTimeout(() => {
      this.retiring.delete(bus);
      bus.disconnect();
    }, (fade + 0.25) * 1000);
    this.retiring.set(bus, handle);
  }

  /** Number of sessions still fading out (tests / harness). */
  get retiringCount(): number {
    return this.retiring.size;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const s = this.session;
    this.session = null;
    if (s) {
      s.scheduler.stop();
      s.bus.disconnect();
    }
    for (const [bus, handle] of this.retiring) {
      this.timers.clearTimeout(handle);
      bus.disconnect();
    }
    this.retiring.clear();
    this.noise = null;
  }
}
