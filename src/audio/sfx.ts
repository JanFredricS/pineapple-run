/**
 * Synthesized sound effects.
 *
 * One-shots (strawClatter, pineappleBounce, springBoing, uiClick, goalSting,
 * loseSting) get small seeded pitch/level variation and per-sound throttling:
 * at most `maxPerFrame` triggers per 1/60 s of audio time and at most
 * `maxVoices` sounding at once — physics contact storms can call these every
 * step without stacking hundreds of voices. Each returns whether it played.
 *
 * One-shots are dropped (return false) while the context is not 'running'
 * (before unlock / while hidden), so nothing piles up and bursts on resume.
 *
 * Looped sounds (wheelMotor, blenderWhir) are start/stop/param objects;
 * start is idempotent, stop fades out and releases the nodes.
 */

import type { AudioEngine, AudioGraph } from './engine';
import { applyEnvelope, applyRamp, bounceGain, clamp01, constantRamp, lerp, midiToHz, motorParams, percPoints, retarget, vary, type Ramp } from './dsp';
import { mulberry32 } from './rng';
import { globalTimers, type AudioTimers, type AudioNodeLike, type GainNodeLike, type ScheduledSourceLike } from './types';
import { createNoiseBuffer, playVoice, type VoiceKit } from './voices';

export type OneShotSfx = 'strawClatter' | 'pineappleBounce' | 'springBoing' | 'uiClick' | 'goalSting' | 'loseSting';

export interface ThrottleRule {
  maxPerFrame: number;
  maxVoices: number;
}

export const SFX_THROTTLE: Readonly<Record<OneShotSfx, ThrottleRule>> = {
  strawClatter: { maxPerFrame: 2, maxVoices: 4 },
  pineappleBounce: { maxPerFrame: 3, maxVoices: 6 },
  springBoing: { maxPerFrame: 1, maxVoices: 3 },
  uiClick: { maxPerFrame: 1, maxVoices: 3 },
  goalSting: { maxPerFrame: 1, maxVoices: 1 },
  loseSting: { maxPerFrame: 1, maxVoices: 1 },
};

export const FRAME_SECONDS = 1 / 60;

/** Per-sound trigger limiter (pure; time is passed in). */
export class Throttle<K extends string> {
  private readonly state = new Map<K, { frame: number; count: number; ends: number[] }>();

  constructor(
    private readonly rules: Readonly<Record<K, ThrottleRule>>,
    private readonly frameSeconds: number = FRAME_SECONDS,
  ) {}

  /** Voices of `name` still sounding at `now`. */
  active(name: K, now: number): number {
    const s = this.state.get(name);
    if (!s) return 0;
    s.ends = s.ends.filter((e) => e > now);
    return s.ends.length;
  }

  /** Claims a slot for a voice lasting `duration` s; false = throttled. */
  tryAcquire(name: K, now: number, duration: number): boolean {
    const rule = this.rules[name];
    const frame = Math.floor(now / this.frameSeconds + 1e-9);
    let s = this.state.get(name);
    if (!s) {
      s = { frame, count: 0, ends: [] };
      this.state.set(name, s);
    }
    if (s.frame !== frame) {
      s.frame = frame;
      s.count = 0;
    }
    s.ends = s.ends.filter((e) => e > now);
    if (s.count >= rule.maxPerFrame || s.ends.length >= rule.maxVoices) return false;
    s.count++;
    s.ends.push(now + duration);
    return true;
  }

  reset(): void {
    this.state.clear();
  }
}

/** Voice lengths used for throttling (≈ the sound's audible length). */
export const SFX_DURATION: Readonly<Record<OneShotSfx, number>> = {
  strawClatter: 0.12,
  pineappleBounce: 0.16,
  springBoing: 0.5,
  uiClick: 0.06,
  goalSting: 1.6,
  loseSting: 1.8,
};

/** A running looped sound's nodes. */
interface LoopNodes {
  out: GainNodeLike;
  /** Tracked output fade, pinned before every replace (set by LoopedSound). */
  outRamp?: Ramp;
  sources: ScheduledSourceLike[];
  params: (speed: number, time: number) => void;
}

/** Start/stop/param handle for a looped sound. */
export class LoopedSound {
  private nodes: LoopNodes | null = null;
  private value = 0;
  /** Fading-out node sets awaiting release, by timeout handle. */
  private readonly stopping = new Map<unknown, LoopNodes>();

  constructor(
    private readonly sfx: Sfx,
    private readonly build: (graph: AudioGraph, kit: VoiceKit, value: number) => LoopNodes,
    private readonly level: number,
    private readonly fadeIn: number,
    private readonly fadeOut: number,
  ) {}

  get running(): boolean {
    return this.nodes !== null;
  }

  /** Last param value (0..1). */
  get param(): number {
    return this.value;
  }

  start(value: number = this.value): void {
    this.value = clamp01(Number.isFinite(value) ? value : 0);
    if (this.nodes) {
      this.set(this.value);
      return;
    }
    const env = this.sfx.env();
    if (!env) return;
    const { graph, kit } = env;
    const t = graph.ctx.currentTime;
    const nodes = this.build(graph, kit, this.value);
    nodes.outRamp = { from: 0, to: this.level, t0: t, t1: t + this.fadeIn };
    applyRamp(nodes.out.gain, nodes.outRamp);
    nodes.out.connect(graph.sfxBus);
    for (const s of nodes.sources) s.start(t);
    this.nodes = nodes;
  }

  /** Updates the driving parameter (speed / intensity 0..1). */
  set(value: number): void {
    this.value = clamp01(Number.isFinite(value) ? value : 0);
    const graph = this.sfx.graph();
    if (this.nodes && graph) this.nodes.params(this.value, graph.ctx.currentTime);
  }

  stop(): void {
    const nodes = this.nodes;
    if (!nodes) return;
    this.nodes = null;
    const graph = this.sfx.graph();
    if (!graph) {
      this.release(nodes);
      return;
    }
    const t = graph.ctx.currentTime;
    // Pin the in-flight value (start-then-immediate-stop is mid fade-in) and
    // ramp down from there: no jump to 0, no click.
    nodes.outRamp = retarget(nodes.outRamp ?? constantRamp(this.level, t), t, 0, this.fadeOut);
    applyRamp(nodes.out.gain, nodes.outRamp);
    for (const s of nodes.sources) s.stop(t + this.fadeOut + 0.05);
    const handle = this.sfx.timers.setTimeout(() => {
      this.stopping.delete(handle);
      this.release(nodes);
    }, (this.fadeOut + 0.1) * 1000);
    this.stopping.set(handle, nodes);
  }

  private release(nodes: LoopNodes): void {
    for (const s of nodes.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      s.disconnect();
    }
    nodes.out.disconnect();
  }

  /** Immediate teardown (destroy). */
  kill(): void {
    for (const [h, fading] of this.stopping) {
      this.sfx.timers.clearTimeout(h);
      this.release(fading);
    }
    this.stopping.clear();
    const nodes = this.nodes;
    this.nodes = null;
    if (nodes) this.release(nodes);
  }
}

export interface SfxOptions {
  timers?: AudioTimers;
  /** Variation RNG; default seeded mulberry32 (reproducible sessions). */
  random?: () => number;
}

export class Sfx {
  readonly timers: AudioTimers;
  private readonly rng: () => number;
  readonly throttle = new Throttle<OneShotSfx>(SFX_THROTTLE);
  private kitState: { graph: AudioGraph; kit: VoiceKit } | null = null;
  private destroyed = false;

  /** Looped wheel motor; `set(speed 0..1)` drives pitch, filter and level. */
  readonly wheelMotor: LoopedSound;
  /** Looped blender whir; `set(intensity 0..1)`. */
  readonly blenderWhir: LoopedSound;

  constructor(
    private readonly engine: AudioEngine,
    opts: SfxOptions = {},
  ) {
    this.timers = opts.timers ?? globalTimers;
    this.rng = opts.random ?? mulberry32(0xc0c0);
    this.wheelMotor = new LoopedSound(this, buildMotor, 0.3, 0.08, 0.15);
    this.blenderWhir = new LoopedSound(this, buildBlender, 0.45, 0.3, 0.4);
  }

  /** The graph if it exists (never creates). */
  graph(): AudioGraph | null {
    return this.destroyed ? null : this.engine.graph;
  }

  /** Graph + voice kit, creating the context lazily. */
  env(): { graph: AudioGraph; kit: VoiceKit } | null {
    if (this.destroyed) return null;
    const graph = this.engine.ensureGraph();
    if (!graph) return null;
    if (this.kitState?.graph !== graph) this.kitState = { graph, kit: { ctx: graph.ctx, noise: createNoiseBuffer(graph.ctx, 1, 0xb00) } };
    return this.kitState;
  }

  /** Common gate for one-shots: running context + throttle slot. */
  private claim(name: OneShotSfx): { graph: AudioGraph; kit: VoiceKit; t: number } | null {
    const env = this.env();
    if (!env || env.graph.ctx.state !== 'running') return null;
    const t = env.graph.ctx.currentTime;
    if (!this.throttle.tryAcquire(name, t, SFX_DURATION[name])) return null;
    return { ...env, t };
  }

  private noiseBurst(kit: VoiceKit, dest: AudioNodeLike, t: number, end: number): void {
    const src = kit.ctx.createBufferSource();
    src.buffer = kit.noise;
    src.loop = true;
    src.connect(dest);
    src.start(t, this.rng() * 0.9);
    src.stop(end + 0.01);
  }

  /** Straws knocking together; intensity 0..1. */
  strawClatter(intensity = 1): boolean {
    const level = clamp01(Number.isFinite(intensity) ? intensity : 0);
    if (level <= 0) return false;
    const c = this.claim('strawClatter');
    if (!c) return false;
    const { kit, t, graph } = c;
    const clicks = 2 + Math.floor(this.rng() * 3);
    let at = t;
    for (let i = 0; i < clicks; i++) {
      const env = percPoints(at, 0.001, vary(0.028, 0.3, this.rng), vary(0.32, 0.2, this.rng) * level * (i === 0 ? 1 : 0.7));
      const g = kit.ctx.createGain();
      applyEnvelope(g.gain, env.points);
      g.connect(graph.sfxBus);
      const f = kit.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(vary(3000, 0.25, this.rng), at);
      f.Q.setValueAtTime(5, at);
      f.connect(g);
      this.noiseBurst(kit, f, at, env.end);
      const o = kit.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(vary(1700, 0.15, this.rng), at);
      o.connect(g);
      o.start(at);
      o.stop(env.end + 0.01);
      at += vary(0.024, 0.4, this.rng);
    }
    return true;
  }

  /** Pineapple impact; speed in m/s (see dsp.bounceGain). */
  pineappleBounce(speed: number): boolean {
    const gain = bounceGain(speed);
    if (gain <= 0) return false;
    const c = this.claim('pineappleBounce');
    if (!c) return false;
    const { kit, t, graph } = c;
    const base = vary(165, 0.08, this.rng);
    const body = percPoints(t, 0.002, 0.14, vary(0.85, 0.1, this.rng) * gain);
    const g = kit.ctx.createGain();
    applyEnvelope(g.gain, body.points);
    g.connect(graph.sfxBus);
    const o = kit.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * 0.45, t + 0.1);
    o.connect(g);
    o.start(t);
    o.stop(body.end + 0.01);
    // Fibrous thunk.
    const thunk = percPoints(t, 0.001, 0.045, 0.25 * gain);
    const tg = kit.ctx.createGain();
    applyEnvelope(tg.gain, thunk.points);
    tg.connect(graph.sfxBus);
    const f = kit.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(vary(900, 0.2, this.rng), t);
    f.Q.setValueAtTime(0.8, t);
    f.connect(tg);
    this.noiseBurst(kit, f, t, thunk.end);
    return true;
  }

  /** Shock/spring compression 'boing'; compression 0..1. */
  springBoing(compression = 1): boolean {
    const amount = clamp01(Number.isFinite(compression) ? compression : 0);
    if (amount <= 0) return false;
    const c = this.claim('springBoing');
    if (!c) return false;
    const { kit, t, graph } = c;
    const base = vary(lerp(300, 200, amount), 0.08, this.rng);
    const env = percPoints(t, 0.004, 0.46, lerp(0.2, 0.5, amount));
    const g = kit.ctx.createGain();
    applyEnvelope(g.gain, env.points);
    g.connect(graph.sfxBus);
    const o = kit.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(base * 0.6, t);
    o.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(base, t + 0.45);
    // Decaying vibrato: the wobble of a coil.
    const lfo = kit.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(vary(15, 0.1, this.rng), t);
    const depth = kit.ctx.createGain();
    depth.gain.setValueAtTime(base * 0.14, t);
    depth.gain.exponentialRampToValueAtTime(base * 0.01, t + 0.45);
    lfo.connect(depth);
    depth.connect(o.frequency);
    o.connect(g);
    for (const s of [o, lfo]) {
      s.start(t);
      s.stop(env.end + 0.01);
    }
    return true;
  }

  /** Short UI tick. */
  uiClick(): boolean {
    const c = this.claim('uiClick');
    if (!c) return false;
    const { kit, t, graph } = c;
    const env = percPoints(t, 0.001, 0.05, 0.4);
    const g = kit.ctx.createGain();
    applyEnvelope(g.gain, env.points);
    g.connect(graph.sfxBus);
    const o = kit.ctx.createOscillator();
    o.type = 'sine';
    const f = vary(1500, 0.03, this.rng);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.04);
    o.connect(g);
    o.start(t);
    o.stop(env.end + 0.01);
    return true;
  }

  /** Delivered! Rising marimba arpeggio + bell. */
  goalSting(): boolean {
    const c = this.claim('goalSting');
    if (!c) return false;
    const { kit, t, graph } = c;
    const notes = [72, 76, 79, 84];
    notes.forEach((midi, i) => {
      playVoice(kit, 'pluck', graph.sfxBus, { time: t + i * 0.09, midi, duration: 0.2, velocity: 0.8 });
    });
    for (const midi of [84, 88, 91]) {
      playVoice(kit, 'bell', graph.sfxBus, { time: t + 0.38, midi, duration: 1, velocity: 0.8 });
    }
    return true;
  }

  /** Run over: gentle descending "wah-wah". */
  loseSting(): boolean {
    const c = this.claim('loseSting');
    if (!c) return false;
    const { kit, t, graph } = c;
    const notes: Array<[number, number]> = [
      [67, 0.3],
      [66, 0.3],
      [65, 0.3],
      [64, 0.85],
    ];
    let at = t;
    for (const [midi, dur] of notes) {
      const env = percPoints(at, 0.02, dur, 0.16);
      const g = kit.ctx.createGain();
      applyEnvelope(g.gain, env.points);
      g.connect(graph.sfxBus);
      const f = kit.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.setValueAtTime(4, at);
      f.frequency.setValueAtTime(350, at);
      f.frequency.exponentialRampToValueAtTime(1300, at + dur * 0.35);
      f.frequency.exponentialRampToValueAtTime(380, at + dur);
      f.connect(g);
      const o = kit.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(midiToHz(midi), at);
      if (dur > 0.5) {
        const lfo = kit.ctx.createOscillator();
        lfo.frequency.setValueAtTime(5.5, at);
        const depth = kit.ctx.createGain();
        depth.gain.setValueAtTime(midiToHz(midi) * 0.02, at);
        lfo.connect(depth);
        depth.connect(o.frequency);
        lfo.start(at);
        lfo.stop(env.end + 0.01);
      }
      o.connect(f);
      o.start(at);
      o.stop(env.end + 0.01);
      at += dur;
    }
    return true;
  }

  /** Stops every looped sound (fade). */
  stopLoops(): void {
    this.wheelMotor.stop();
    this.blenderWhir.stop();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.wheelMotor.kill();
    this.blenderWhir.kill();
    this.destroyed = true;
    this.kitState = null;
    this.throttle.reset();
  }
}

/** Wheel motor: saw + sub square, amplitude "chug" LFO, low-pass tracking speed. */
function buildMotor(graph: AudioGraph, _kit: VoiceKit, speed: number): LoopNodes {
  const { ctx } = graph;
  const t = ctx.currentTime;
  const p = motorParams(speed);
  const out = ctx.createGain();
  const level = ctx.createGain();
  level.gain.setValueAtTime(p.gain, t);
  level.connect(out);
  const chug = ctx.createGain();
  chug.gain.setValueAtTime(0.75, t);
  chug.connect(level);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(p.cutoff, t);
  filter.Q.setValueAtTime(1.5, t);
  filter.connect(chug);
  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.setValueAtTime(p.freq, t);
  saw.connect(filter);
  const sub = ctx.createOscillator();
  sub.type = 'square';
  sub.frequency.setValueAtTime(p.freq / 2, t);
  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0.35, t);
  sub.connect(subGain);
  subGain.connect(filter);
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(lerp(7, 24, speed), t);
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.setValueAtTime(0.25, t);
  lfo.connect(lfoDepth);
  lfoDepth.connect(chug.gain);
  return {
    out,
    sources: [saw, sub, lfo],
    params: (s, time) => {
      const q = motorParams(s);
      const tc = 0.05;
      saw.frequency.setTargetAtTime(q.freq, time, tc);
      sub.frequency.setTargetAtTime(q.freq / 2, time, tc);
      filter.frequency.setTargetAtTime(q.cutoff, time, tc);
      level.gain.setTargetAtTime(q.gain, time, tc);
      lfo.frequency.setTargetAtTime(lerp(7, 24, s), time, tc);
    },
  };
}

/** Blender: band-passed looping noise + wobbling saw hum. */
function buildBlender(graph: AudioGraph, kit: VoiceKit, intensity: number): LoopNodes {
  const { ctx } = graph;
  const t = ctx.currentTime;
  const out = ctx.createGain();
  const noise = ctx.createBufferSource();
  noise.buffer = kit.noise;
  noise.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(lerp(700, 1500, intensity), t);
  band.Q.setValueAtTime(1.2, t);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.5, t);
  noise.connect(band);
  band.connect(noiseGain);
  noiseGain.connect(out);
  const hum = ctx.createOscillator();
  hum.type = 'sawtooth';
  hum.frequency.setValueAtTime(lerp(110, 180, intensity), t);
  const humFilter = ctx.createBiquadFilter();
  humFilter.type = 'lowpass';
  humFilter.frequency.setValueAtTime(1600, t);
  humFilter.Q.setValueAtTime(0.7, t);
  const humGain = ctx.createGain();
  humGain.gain.setValueAtTime(0.25, t);
  hum.connect(humFilter);
  humFilter.connect(humGain);
  humGain.connect(out);
  const wobble = ctx.createOscillator();
  wobble.type = 'sine';
  wobble.frequency.setValueAtTime(6, t);
  const wobbleDepth = ctx.createGain();
  wobbleDepth.gain.setValueAtTime(6, t);
  wobble.connect(wobbleDepth);
  wobbleDepth.connect(hum.frequency);
  return {
    out,
    sources: [noise, hum, wobble],
    params: (s, time) => {
      band.frequency.setTargetAtTime(lerp(700, 1500, s), time, 0.1);
      hum.frequency.setTargetAtTime(lerp(110, 180, s), time, 0.1);
    },
  };
}
