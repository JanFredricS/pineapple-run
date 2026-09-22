/**
 * Pure DSP / music-theory helpers. No Web Audio objects here: everything
 * returns plain numbers or point lists, so it is tested exactly.
 */

import type { AudioParamLike } from './types';

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Equal-tempered pitch: MIDI 69 = A4 = 440 Hz. */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Semitone offsets of the scales the themes use. */
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
} as const satisfies Record<string, readonly number[]>;

export type ScaleName = keyof typeof SCALES;

/**
 * Scale degree (0-based, may be negative or past the octave) → MIDI note.
 * degreeToMidi(60, major, 0) = 60, (…, 7) = 72, (…, -1) = 59.
 */
export function degreeToMidi(root: number, scale: readonly number[], degree: number): number {
  const n = scale.length;
  const octave = Math.floor(degree / n);
  const idx = degree - octave * n;
  return root + octave * 12 + scale[idx]!;
}

/** Triad on a scale degree, as scale degrees (root, third, fifth). */
export function triadDegrees(degree: number): [number, number, number] {
  return [degree, degree + 2, degree + 4];
}

/** Floor for exponential ramps (they cannot reach 0). */
export const EXP_FLOOR = 1e-4;

export type EnvelopePoint =
  | { kind: 'set'; time: number; value: number }
  | { kind: 'lin'; time: number; value: number }
  | { kind: 'exp'; time: number; value: number };

export interface EnvelopeSpec {
  /** Note-on time (s). */
  start: number;
  /** Seconds from start to peak. */
  attack: number;
  /** Seconds from peak down to sustain. */
  decay: number;
  /** Sustain level as a fraction of peak (0..1). */
  sustain: number;
  /** Seconds after note-off to silence. */
  release: number;
  /** Note length (s) — note-off at start + hold (never before the decay ends). */
  hold: number;
  /** Peak gain. */
  peak: number;
}

/**
 * ADSR as explicit automation points. Attack is linear from silence (clickless
 * from 0), decay/release are exponential toward EXP_FLOOR, then a hard 0.
 * Returns the points and the time at which the voice is silent (stop time).
 */
export function adsrPoints(spec: EnvelopeSpec): { points: EnvelopePoint[]; end: number } {
  const { start, attack, decay, release, peak } = spec;
  const sustainLevel = Math.max(EXP_FLOOR, peak * clamp01(spec.sustain));
  const peakT = start + attack;
  const decayEnd = peakT + decay;
  const off = Math.max(decayEnd, start + spec.hold);
  const end = off + release;
  const points: EnvelopePoint[] = [
    { kind: 'set', time: start, value: 0 },
    { kind: 'lin', time: peakT, value: Math.max(EXP_FLOOR, peak) },
    { kind: 'exp', time: decayEnd, value: sustainLevel },
    { kind: 'set', time: off, value: sustainLevel },
    { kind: 'exp', time: end, value: EXP_FLOOR },
    { kind: 'set', time: end, value: 0 },
  ];
  return { points, end };
}

/** Percussive envelope: linear attack, exponential decay to silence. */
export function percPoints(start: number, attack: number, decay: number, peak: number): { points: EnvelopePoint[]; end: number } {
  const end = start + attack + decay;
  return {
    points: [
      { kind: 'set', time: start, value: 0 },
      { kind: 'lin', time: start + attack, value: Math.max(EXP_FLOOR, peak) },
      { kind: 'exp', time: end, value: EXP_FLOOR },
      { kind: 'set', time: end, value: 0 },
    ],
    end,
  };
}

/** Writes envelope points onto an AudioParam. */
export function applyEnvelope(param: AudioParamLike, points: readonly EnvelopePoint[]): void {
  for (const p of points) {
    if (p.kind === 'set') param.setValueAtTime(p.value, p.time);
    else if (p.kind === 'lin') param.linearRampToValueAtTime(p.value, p.time);
    else param.exponentialRampToValueAtTime(Math.max(EXP_FLOOR, p.value), p.time);
  }
}

/** A linear gain ramp we track ourselves (portable "cancel and hold"). */
export interface Ramp {
  from: number;
  to: number;
  t0: number;
  t1: number;
}

export const constantRamp = (value: number, time = 0): Ramp => ({ from: value, to: value, t0: time, t1: time });

/** Value of a linear ramp at time t (held before t0 and after t1). */
export function rampValueAt(r: Ramp, t: number): number {
  if (t <= r.t0) return r.from;
  if (t >= r.t1 || r.t1 <= r.t0) return r.to;
  return r.from + ((r.to - r.from) * (t - r.t0)) / (r.t1 - r.t0);
}

/**
 * Re-targets a ramp mid-flight: the new ramp starts from the value the old one
 * has at `now`, so interrupting a fade never jumps (glitch-free cross-fades).
 */
export function retarget(r: Ramp, now: number, to: number, duration: number): Ramp {
  return { from: rampValueAt(r, now), to, t0: now, t1: now + Math.max(0, duration) };
}

/** Writes a tracked ramp onto an AudioParam (cancel, pin start, ramp). */
export function applyRamp(param: AudioParamLike, r: Ramp): void {
  param.cancelScheduledValues(r.t0);
  param.setValueAtTime(r.from, r.t0);
  if (r.t1 > r.t0) param.linearRampToValueAtTime(r.to, r.t1);
  else param.setValueAtTime(r.to, r.t0);
}

/** Music stage 0..3: base layer always on, +1 layer per stage. */
export type MusicStage = 0 | 1 | 2 | 3;
export const LAYER_COUNT = 4;

/** Target gain (0/1) of each of the 4 layers at a stage. */
export function stageLayerTargets(stage: MusicStage): [number, number, number, number] {
  return [1, stage >= 1 ? 1 : 0, stage >= 2 ? 1 : 0, stage >= 3 ? 1 : 0];
}

/**
 * Course progress (0..1 of the course length) → stage, one per quarter like
 * the original's four cross-faded loops. Non-finite → 0.
 */
export function stageForProgress(progress: number): MusicStage {
  if (!Number.isFinite(progress)) return 0;
  const q = Math.floor(clamp01(progress) * 4);
  return (q >= 3 ? 3 : q) as MusicStage;
}

/**
 * Pineapple impact speed (m/s) → bounce gain 0..1. Below 0.6 m/s the bounce
 * is inaudible (resting contacts must not buzz); saturates at 8 m/s with a
 * square-root curve so medium bumps are still audible.
 */
export const BOUNCE_MIN_SPEED = 0.6;
export const BOUNCE_MAX_SPEED = 8;
export function bounceGain(speed: number): number {
  if (!Number.isFinite(speed) || speed <= BOUNCE_MIN_SPEED) return 0;
  return Math.sqrt(clamp01((speed - BOUNCE_MIN_SPEED) / (BOUNCE_MAX_SPEED - BOUNCE_MIN_SPEED)));
}

/** Wheel motor parameters for a 0..1 speed input. */
export function motorParams(speed: number): { freq: number; cutoff: number; gain: number } {
  const s = clamp01(Number.isFinite(speed) ? speed : 0);
  return { freq: lerp(38, 110, s), cutoff: lerp(260, 1400, s), gain: lerp(0.18, 0.5, s) };
}

/** Applies ±`spread` relative random variation (rng in [0,1)). */
export function vary(base: number, spread: number, rng: () => number): number {
  return base * (1 + (rng() * 2 - 1) * spread);
}

/** Tempo shared by every loop. */
export const BPM = 100;
export const STEPS_PER_BEAT = 4;
export const STEPS_PER_BAR = 16;
export const BARS_PER_LOOP = 8;
export const LOOP_STEPS = STEPS_PER_BAR * BARS_PER_LOOP;
/** Seconds per 16th-note step at BPM. */
export const stepSeconds = (bpm: number = BPM): number => 60 / bpm / STEPS_PER_BEAT;
