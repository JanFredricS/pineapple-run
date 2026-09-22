/**
 * Synthesized instrument voices. Every sound in the game is built here from
 * oscillators and one seeded noise buffer — no samples, no external files.
 *
 * A voice schedules one note: it creates its nodes, starts them at `time`,
 * stops them at the envelope's end and returns that end time. Nodes are
 * fire-and-forget (the browser releases stopped, unreferenced nodes).
 */

import { adsrPoints, applyEnvelope, midiToHz, percPoints, type EnvelopePoint } from './dsp';
import { mulberry32 } from './rng';
import type { AudioBufferLike, AudioContextLike, AudioNodeLike, OscillatorNodeLike } from './types';

export type VoiceId =
  | 'pluck' // marimba-ish: sine + quickly decaying 4th partial
  | 'uke' // soft triangle pluck through a closing low-pass
  | 'pad' // two detuned triangles, slow attack, low-passed
  | 'bass' // round triangle bass
  | 'square' // bouncy staccato square, low-passed
  | 'mutedSaw' // palm-muted saw: resonant filter snapping shut
  | 'bell' // sine + inharmonic partial, long decay
  | 'steel' // steel-drum-ish harmonic stack
  | 'shaker' // high-passed noise tick
  | 'kick' // soft sine thump with pitch drop
  | 'block' // woodblock: short high sine + band noise
  | 'hat' // very short bright noise
  | 'clank'; // metallic two-square ping through a band-pass

export const VOICE_IDS: readonly VoiceId[] = [
  'pluck',
  'uke',
  'pad',
  'bass',
  'square',
  'mutedSaw',
  'bell',
  'steel',
  'shaker',
  'kick',
  'block',
  'hat',
  'clank',
];

export interface VoiceKit {
  ctx: AudioContextLike;
  /** 1 s of seeded white noise, shared by every noise voice. */
  noise: AudioBufferLike;
}

/** Deterministic white-noise buffer. */
export function createNoiseBuffer(ctx: AudioContextLike, seconds = 1, seed = 0x5eed): AudioBufferLike {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const rng = mulberry32(seed);
  for (let i = 0; i < data.length; i++) data[i] = rng() * 2 - 1;
  return buffer;
}

export interface NoteSpec {
  time: number;
  midi: number;
  /** Nominal note length in seconds (sustaining voices hold this long). */
  duration: number;
  /** 0..1 */
  velocity: number;
}

function osc(ctx: AudioContextLike, type: OscillatorType, hz: number, time: number): OscillatorNodeLike {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(hz, time);
  return o;
}

function envGain(kit: VoiceKit, points: readonly EnvelopePoint[], dest: AudioNodeLike) {
  const g = kit.ctx.createGain();
  applyEnvelope(g.gain, points);
  g.connect(dest);
  return g;
}

function noiseSource(kit: VoiceKit, time: number, end: number) {
  const src = kit.ctx.createBufferSource();
  src.buffer = kit.noise;
  src.loop = true;
  src.start(time);
  src.stop(end);
  return src;
}

function startStop(sources: readonly OscillatorNodeLike[], time: number, end: number): void {
  for (const s of sources) {
    s.start(time);
    s.stop(end + 0.01);
  }
}

/** Schedules one note of `voice` into `dest`; returns the time it falls silent. */
export function playVoice(kit: VoiceKit, voice: VoiceId, dest: AudioNodeLike, note: NoteSpec): number {
  const { ctx } = kit;
  const t = note.time;
  const v = Math.max(0, Math.min(1, note.velocity));
  const hz = midiToHz(note.midi);
  switch (voice) {
    case 'pluck': {
      const body = percPoints(t, 0.004, 0.55, 0.42 * v);
      const g = envGain(kit, body.points, dest);
      const o1 = osc(ctx, 'sine', hz, t);
      o1.connect(g);
      const tick = percPoints(t, 0.002, 0.06, 0.12 * v);
      const g2 = envGain(kit, tick.points, dest);
      const o2 = osc(ctx, 'sine', hz * 3.93, t);
      o2.connect(g2);
      startStop([o1, o2], t, body.end);
      return body.end;
    }
    case 'uke': {
      const env = percPoints(t, 0.005, 0.6, 0.3 * v);
      const g = envGain(kit, env.points, dest);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.setValueAtTime(0.7, t);
      f.frequency.setValueAtTime(2600, t);
      f.frequency.exponentialRampToValueAtTime(700, t + 0.25);
      f.connect(g);
      const o = osc(ctx, 'triangle', hz, t);
      o.connect(f);
      startStop([o], t, env.end);
      return env.end;
    }
    case 'pad': {
      const env = adsrPoints({ start: t, attack: 0.3, decay: 0.4, sustain: 0.7, release: 0.6, hold: note.duration, peak: 0.16 * v });
      const g = envGain(kit, env.points, dest);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(1100, t);
      f.Q.setValueAtTime(0.5, t);
      f.connect(g);
      const a = osc(ctx, 'triangle', hz, t);
      const b = osc(ctx, 'triangle', hz, t);
      a.detune.setValueAtTime(-7, t);
      b.detune.setValueAtTime(7, t);
      a.connect(f);
      b.connect(f);
      startStop([a, b], t, env.end);
      return env.end;
    }
    case 'bass': {
      const env = adsrPoints({ start: t, attack: 0.008, decay: 0.12, sustain: 0.55, release: 0.08, hold: note.duration * 0.9, peak: 0.5 * v });
      const g = envGain(kit, env.points, dest);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(700, t);
      f.Q.setValueAtTime(0.6, t);
      f.connect(g);
      const o = osc(ctx, 'triangle', hz, t);
      o.connect(f);
      startStop([o], t, env.end);
      return env.end;
    }
    case 'square': {
      const env = percPoints(t, 0.004, Math.min(0.28, 0.1 + note.duration * 0.5), 0.11 * v);
      const g = envGain(kit, env.points, dest);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(1900, t);
      f.Q.setValueAtTime(0.8, t);
      f.connect(g);
      const o = osc(ctx, 'square', hz, t);
      o.connect(f);
      startStop([o], t, env.end);
      return env.end;
    }
    case 'mutedSaw': {
      const env = percPoints(t, 0.003, 0.17, 0.13 * v);
      const g = envGain(kit, env.points, dest);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.setValueAtTime(3.5, t);
      f.frequency.setValueAtTime(1500, t);
      f.frequency.exponentialRampToValueAtTime(320, t + 0.11);
      f.connect(g);
      const o = osc(ctx, 'sawtooth', hz, t);
      o.connect(f);
      startStop([o], t, env.end);
      return env.end;
    }
    case 'bell': {
      const env = percPoints(t, 0.003, 0.9, 0.14 * v);
      const g = envGain(kit, env.points, dest);
      const o1 = osc(ctx, 'sine', hz, t);
      o1.connect(g);
      const part = percPoints(t, 0.002, 0.25, 0.05 * v);
      const g2 = envGain(kit, part.points, dest);
      const o2 = osc(ctx, 'sine', hz * 2.76, t);
      o2.connect(g2);
      startStop([o1, o2], t, env.end);
      return env.end;
    }
    case 'steel': {
      const env = percPoints(t, 0.004, 0.7, 0.3 * v);
      const g = envGain(kit, env.points, dest);
      const partials: Array<[number, number]> = [
        [1, 1],
        [2, 0.45],
        [3.01, 0.18],
      ];
      const oscs: OscillatorNodeLike[] = [];
      for (const [mult, level] of partials) {
        const pg = ctx.createGain();
        pg.gain.setValueAtTime(level, t);
        pg.connect(g);
        const o = osc(ctx, 'sine', hz * mult, t);
        o.connect(pg);
        oscs.push(o);
      }
      startStop(oscs, t, env.end);
      return env.end;
    }
    case 'shaker': {
      const env = percPoints(t, 0.006, 0.07, 0.2 * v);
      const g = envGain(kit, env.points, dest);
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.setValueAtTime(6500, t);
      f.Q.setValueAtTime(0.7, t);
      f.connect(g);
      noiseSource(kit, t, env.end + 0.01).connect(f);
      return env.end;
    }
    case 'kick': {
      const env = percPoints(t, 0.003, 0.2, 0.55 * v);
      const g = envGain(kit, env.points, dest);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(115, t);
      o.frequency.exponentialRampToValueAtTime(44, t + 0.13);
      o.connect(g);
      startStop([o], t, env.end);
      return env.end;
    }
    case 'block': {
      const env = percPoints(t, 0.002, 0.06, 0.28 * v);
      const g = envGain(kit, env.points, dest);
      const o = osc(ctx, 'sine', hz, t);
      o.connect(g);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(hz * 1.5, t);
      f.Q.setValueAtTime(8, t);
      const ng = envGain(kit, percPoints(t, 0.001, 0.02, 0.12 * v).points, dest);
      f.connect(ng);
      noiseSource(kit, t, env.end + 0.01).connect(f);
      startStop([o], t, env.end);
      return env.end;
    }
    case 'hat': {
      const env = percPoints(t, 0.002, 0.035, 0.1 * v);
      const g = envGain(kit, env.points, dest);
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.setValueAtTime(8000, t);
      f.Q.setValueAtTime(0.7, t);
      f.connect(g);
      noiseSource(kit, t, env.end + 0.01).connect(f);
      return env.end;
    }
    case 'clank': {
      const env = percPoints(t, 0.002, 0.12, 0.06 * v);
      const g = envGain(kit, env.points, dest);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(2400, t);
      f.Q.setValueAtTime(3, t);
      f.connect(g);
      const a = osc(ctx, 'square', hz, t);
      const b = osc(ctx, 'square', hz * 1.414, t);
      a.connect(f);
      b.connect(f);
      startStop([a, b], t, env.end);
      return env.end;
    }
  }
}
