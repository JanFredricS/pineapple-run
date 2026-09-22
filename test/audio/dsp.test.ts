import { describe, expect, it } from 'vitest';
import {
  adsrPoints,
  applyEnvelope,
  applyRamp,
  bounceGain,
  constantRamp,
  degreeToMidi,
  EXP_FLOOR,
  LOOP_STEPS,
  midiToHz,
  motorParams,
  percPoints,
  rampValueAt,
  retarget,
  SCALES,
  stageForProgress,
  stageLayerTargets,
  stepSeconds,
  triadDegrees,
  vary,
} from '../../src/audio/dsp';
import { layerGainsForStage, layerSilentAt, LAYER_MIX } from '../../src/audio/music';
import { hashString, mulberry32 } from '../../src/audio/rng';
import { mulberry32 as runMulberry32 } from '../../src/run/rng';
import { FakeParam } from './fakeAudio';

describe('note tables', () => {
  it('midiToHz is equal-tempered around A4 = 440', () => {
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(81)).toBe(880);
    expect(midiToHz(57)).toBe(220);
    expect(midiToHz(60)).toBeCloseTo(261.6255653005986, 12);
    expect(midiToHz(70) / midiToHz(69)).toBeCloseTo(Math.pow(2, 1 / 12), 14);
  });

  it('degreeToMidi wraps octaves both ways', () => {
    const maj = SCALES.major;
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => degreeToMidi(60, maj, d))).toEqual([60, 62, 64, 65, 67, 69, 71]);
    expect(degreeToMidi(60, maj, 7)).toBe(72);
    expect(degreeToMidi(60, maj, 9)).toBe(76);
    expect(degreeToMidi(60, maj, -1)).toBe(59);
    expect(degreeToMidi(60, maj, -7)).toBe(48);
    expect(degreeToMidi(60, maj, -8)).toBe(47);
    expect(degreeToMidi(55, SCALES.mixolydian, 6)).toBe(65); // bVII in G mixolydian = F
    expect(degreeToMidi(60, SCALES.majorPentatonic, 5)).toBe(72);
  });

  it('triads stack thirds in scale degrees', () => {
    expect(triadDegrees(0)).toEqual([0, 2, 4]);
    expect(triadDegrees(4).map((d) => degreeToMidi(60, SCALES.major, d))).toEqual([67, 71, 74]); // G B D
  });

  it('tempo grid', () => {
    expect(stepSeconds(120)).toBe(0.125);
    expect(stepSeconds(100)).toBeCloseTo(0.15, 15);
    expect(LOOP_STEPS).toBe(128);
  });
});

describe('envelopes', () => {
  it('adsrPoints: exact automation points', () => {
    const { points, end } = adsrPoints({ start: 1, attack: 0.5, decay: 0.25, sustain: 0.5, release: 0.5, hold: 2, peak: 0.8 });
    expect(end).toBe(3.5);
    expect(points).toEqual([
      { kind: 'set', time: 1, value: 0 },
      { kind: 'lin', time: 1.5, value: 0.8 },
      { kind: 'exp', time: 1.75, value: 0.4 },
      { kind: 'set', time: 3, value: 0.4 },
      { kind: 'exp', time: 3.5, value: EXP_FLOOR },
      { kind: 'set', time: 3.5, value: 0 },
    ]);
  });

  it('adsrPoints never releases before the decay ends and never exp-ramps to 0', () => {
    const { points, end } = adsrPoints({ start: 0, attack: 0.25, decay: 0.25, sustain: 0, release: 0.25, hold: 0.1, peak: 0 });
    expect(end).toBe(0.75);
    for (const p of points) if (p.kind === 'exp') expect(p.value).toBeGreaterThan(0);
    expect(points[3]).toEqual({ kind: 'set', time: 0.5, value: EXP_FLOOR });
  });

  it('percPoints', () => {
    expect(percPoints(2, 0.25, 0.5, 0.5)).toEqual({
      points: [
        { kind: 'set', time: 2, value: 0 },
        { kind: 'lin', time: 2.25, value: 0.5 },
        { kind: 'exp', time: 2.75, value: EXP_FLOOR },
        { kind: 'set', time: 2.75, value: 0 },
      ],
      end: 2.75,
    });
  });

  it('applyEnvelope writes the points in order', () => {
    const p = new FakeParam();
    applyEnvelope(p, percPoints(0, 0.5, 0.5, 1).points);
    expect(p.calls).toEqual([
      { m: 'set', v: 0, t: 0 },
      { m: 'lin', v: 1, t: 0.5 },
      { m: 'exp', v: EXP_FLOOR, t: 1 },
      { m: 'set', v: 0, t: 1 },
    ]);
  });
});

describe('ramps and stage cross-fade math', () => {
  it('rampValueAt interpolates linearly and holds outside', () => {
    const r = { from: 0, to: 1, t0: 2, t1: 4 };
    expect(rampValueAt(r, 0)).toBe(0);
    expect(rampValueAt(r, 2)).toBe(0);
    expect(rampValueAt(r, 3)).toBe(0.5);
    expect(rampValueAt(r, 3.5)).toBe(0.75);
    expect(rampValueAt(r, 4)).toBe(1);
    expect(rampValueAt(r, 9)).toBe(1);
    expect(rampValueAt(constantRamp(0.3, 1), 5)).toBe(0.3);
  });

  it('retarget starts from the in-flight value (no jump)', () => {
    const r = { from: 0, to: 1, t0: 0, t1: 2 };
    const back = retarget(r, 1.5, 0, 1);
    expect(back).toEqual({ from: 0.75, to: 0, t0: 1.5, t1: 2.5 });
    expect(rampValueAt(back, 1.5)).toBe(rampValueAt(r, 1.5));
    expect(rampValueAt(back, 2)).toBe(0.375);
  });

  it('applyRamp cancels, pins the start and ramps; zero-length sets', () => {
    const p = new FakeParam();
    applyRamp(p, { from: 0.25, to: 1, t0: 1, t1: 3 });
    expect(p.calls).toEqual([
      { m: 'cancel', t: 1 },
      { m: 'set', v: 0.25, t: 1 },
      { m: 'lin', v: 1, t: 3 },
    ]);
    const q = new FakeParam();
    applyRamp(q, { from: 0.25, to: 1, t0: 1, t1: 1 });
    expect(q.calls).toEqual([
      { m: 'cancel', t: 1 },
      { m: 'set', v: 0.25, t: 1 },
      { m: 'set', v: 1, t: 1 },
    ]);
  });

  it('stages add one layer each; base always on', () => {
    expect(stageLayerTargets(0)).toEqual([1, 0, 0, 0]);
    expect(stageLayerTargets(1)).toEqual([1, 1, 0, 0]);
    expect(stageLayerTargets(2)).toEqual([1, 1, 1, 0]);
    expect(stageLayerTargets(3)).toEqual([1, 1, 1, 1]);
    expect(layerGainsForStage(3)).toEqual([...LAYER_MIX]);
    expect(layerGainsForStage(1)).toEqual([LAYER_MIX[0], LAYER_MIX[1], 0, 0]);
  });

  it('course quarter → stage', () => {
    expect(stageForProgress(0)).toBe(0);
    expect(stageForProgress(0.2499)).toBe(0);
    expect(stageForProgress(0.25)).toBe(1);
    expect(stageForProgress(0.5)).toBe(2);
    expect(stageForProgress(0.75)).toBe(3);
    expect(stageForProgress(1)).toBe(3);
    expect(stageForProgress(7)).toBe(3);
    expect(stageForProgress(-1)).toBe(0);
    expect(stageForProgress(Number.NaN)).toBe(0);
  });

  it('layerSilentAt: only a layer headed to 0 and already there is skipped', () => {
    expect(layerSilentAt(constantRamp(0), 5)).toBe(true);
    expect(layerSilentAt(constantRamp(1), 5)).toBe(false);
    const fadeOut = { from: 1, to: 0, t0: 0, t1: 2 };
    expect(layerSilentAt(fadeOut, 1)).toBe(false);
    expect(layerSilentAt(fadeOut, 2)).toBe(true);
    const fadeIn = { from: 0, to: 1, t0: 1, t1: 3 };
    expect(layerSilentAt(fadeIn, 0.5)).toBe(false); // heading up: schedule
  });
});

describe('sfx curves', () => {
  it('bounceGain: silent below threshold, sqrt curve, saturates', () => {
    expect(bounceGain(0)).toBe(0);
    expect(bounceGain(0.6)).toBe(0);
    expect(bounceGain(-5)).toBe(0);
    expect(bounceGain(Number.NaN)).toBe(0);
    expect(bounceGain(8)).toBe(1);
    expect(bounceGain(100)).toBe(1);
    expect(bounceGain(0.6 + 7.4 / 4)).toBeCloseTo(0.5, 12);
    expect(bounceGain(3)).toBeLessThan(bounceGain(5));
  });

  it('motorParams spans idle..full', () => {
    expect(motorParams(0)).toEqual({ freq: 38, cutoff: 260, gain: 0.18 });
    expect(motorParams(1)).toEqual({ freq: 110, cutoff: 1400, gain: 0.5 });
    expect(motorParams(0.5).freq).toBe(74);
    expect(motorParams(5)).toEqual(motorParams(1));
    expect(motorParams(Number.NaN)).toEqual(motorParams(0));
  });

  it('vary stays within ±spread', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 200; i++) {
      const v = vary(100, 0.1, rng);
      expect(v).toBeGreaterThanOrEqual(90);
      expect(v).toBeLessThanOrEqual(110);
    }
    expect(vary(100, 0.1, () => 0.5)).toBe(100);
  });
});

describe('rng', () => {
  it('mulberry32 matches the src/run idiom and is deterministic', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 5 }, () => a());
    expect(xs).toEqual(Array.from({ length: 5 }, () => b()));
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
    const r = runMulberry32(42);
    expect(xs).toEqual(Array.from({ length: 5 }, () => r()));
  });

  it('hashString is FNV-1a', () => {
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('a')).toBe(0xe40c292c);
  });
});
