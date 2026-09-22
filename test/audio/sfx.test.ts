import { describe, expect, it } from 'vitest';
import { bounceGain, motorParams } from '../../src/audio/dsp';
import { AudioEngine } from '../../src/audio/engine';
import { mulberry32 } from '../../src/audio/rng';
import { FRAME_SECONDS, Sfx, SFX_THROTTLE, Throttle } from '../../src/audio/sfx';
import { FakeTimers, fakeFactory, type FakeGain, type FakeNode, type FakeOscillator } from './fakeAudio';

function setup(state = 'running', seed = 1) {
  const { factory, created } = fakeFactory({ initialState: state });
  const engine = new AudioEngine({ createContext: factory, storage: null, visibility: null });
  const timers = new FakeTimers();
  const sfx = new Sfx(engine, { timers, random: mulberry32(seed) });
  const ctx = () => {
    engine.ensureGraph();
    return created[0]!;
  };
  return { engine, sfx, timers, ctx };
}

describe('Throttle', () => {
  const rules = { a: { maxPerFrame: 2, maxVoices: 3 } };

  it('caps triggers per frame and resets on the next frame', () => {
    const t = new Throttle(rules);
    expect([t.tryAcquire('a', 0, 0.001), t.tryAcquire('a', 0, 0.001), t.tryAcquire('a', 0, 0.001)]).toEqual([true, true, false]);
    expect(t.tryAcquire('a', 0.5 * FRAME_SECONDS, 0.001)).toBe(false); // same frame
    expect(t.tryAcquire('a', FRAME_SECONDS, 0.001)).toBe(true); // next frame
  });

  it('caps concurrent voices across frames until they end', () => {
    const t = new Throttle(rules);
    expect(t.tryAcquire('a', 0, 1)).toBe(true);
    expect(t.tryAcquire('a', 0, 1)).toBe(true);
    expect(t.tryAcquire('a', 0.1, 1)).toBe(true);
    expect(t.active('a', 0.2)).toBe(3);
    expect(t.tryAcquire('a', 0.2, 1)).toBe(false);
    expect(t.tryAcquire('a', 1.0, 1)).toBe(true); // first two ended at 1.0
    expect(t.active('a', 1.0)).toBe(2);
    t.reset();
    expect(t.active('a', 1.0)).toBe(0);
  });

  it('a contact storm yields at most maxPerFrame bounces per frame', () => {
    const { sfx, ctx } = setup();
    const c = ctx();
    let played = 0;
    for (let i = 0; i < 100; i++) if (sfx.pineappleBounce(5)) played++;
    expect(played).toBe(SFX_THROTTLE.pineappleBounce.maxPerFrame);
    c.currentTime += FRAME_SECONDS;
    for (let i = 0; i < 100; i++) if (sfx.pineappleBounce(5)) played++;
    expect(played).toBe(Math.min(2 * SFX_THROTTLE.pineappleBounce.maxPerFrame, SFX_THROTTLE.pineappleBounce.maxVoices));
  });
});

describe('one-shots', () => {
  it('every one-shot plays on a running context and uses only valid automation', () => {
    const { sfx, ctx } = setup();
    const c = ctx();
    expect(sfx.strawClatter(1)).toBe(true);
    expect(sfx.pineappleBounce(4)).toBe(true);
    expect(sfx.springBoing(0.8)).toBe(true);
    expect(sfx.uiClick()).toBe(true);
    expect(sfx.goalSting()).toBe(true);
    expect(sfx.loseSting()).toBe(true);
    // Every source is started and stopped (no leaks), and routed to the sfx bus eventually.
    const sources = c.nodes.filter((n) => n.kind === 'oscillator' || n.kind === 'bufferSource') as FakeOscillator[];
    expect(sources.length).toBeGreaterThan(10);
    for (const s of sources) {
      expect(s.startedAt).not.toBeNull();
      expect(s.stoppedAt).not.toBeNull();
      expect(s.stoppedAt!).toBeGreaterThan(s.startedAt!);
      expect(s.stoppedAt! - s.startedAt!).toBeLessThan(3);
    }
  });

  it('are dropped while the context is not running (no burst on resume)', () => {
    const { sfx, ctx } = setup('suspended');
    ctx();
    expect(sfx.pineappleBounce(5)).toBe(false);
    expect(sfx.goalSting()).toBe(false);
    expect(sfx.uiClick()).toBe(false);
  });

  it('bounce is velocity-scaled and silent below the threshold', () => {
    const peakFor = (speed: number) => {
      const { sfx, ctx, engine } = setup('running', 3);
      const c = ctx();
      expect(sfx.pineappleBounce(speed)).toBe(true);
      const sfxBus = engine.graph!.sfxBus as unknown as FakeNode;
      const envs = c.nodes.filter((n) => n.kind === 'gain' && n.outputs.includes(sfxBus)) as FakeGain[];
      return (envs[0]!.gain.calls[1] as { v: number }).v; // linear attack target = peak
    };
    const { sfx } = setup();
    expect(sfx.pineappleBounce(0.3)).toBe(false);
    expect(sfx.pineappleBounce(Number.NaN)).toBe(false);
    // Same seed → same random level factor, so the ratio is the gain-curve ratio.
    expect(peakFor(2) / peakFor(8)).toBeCloseTo(bounceGain(2) / bounceGain(8), 9);
    expect(peakFor(8)).toBeGreaterThan(peakFor(1.5));
  });

  it('small random variation, reproducible with a seeded rng', () => {
    const freqs = (seed: number) => {
      const { sfx, ctx } = setup('running', seed);
      const c = ctx();
      const out: number[] = [];
      for (let i = 0; i < 5; i++) {
        c.currentTime += 1;
        sfx.pineappleBounce(5);
        const o = c.ofKind<FakeOscillator>('oscillator').at(-1)!;
        out.push((o.frequency.calls[0] as { v: number }).v);
      }
      return out;
    };
    const a = freqs(9);
    expect(freqs(9)).toEqual(a);
    expect(new Set(a).size).toBeGreaterThan(1);
    for (const f of a) expect(Math.abs(f / 165 - 1)).toBeLessThanOrEqual(0.08 + 1e-12);
  });

  it('non-positive intensities are no-ops', () => {
    const { sfx, ctx } = setup();
    ctx();
    expect(sfx.strawClatter(0)).toBe(false);
    expect(sfx.springBoing(-1)).toBe(false);
    expect(sfx.springBoing(Number.NaN)).toBe(false);
  });
});

describe('looped sounds', () => {
  it('wheel motor: idempotent start, speed drives pitch/filter/level, stop fades and releases', () => {
    const { sfx, ctx, timers, engine } = setup();
    const c = ctx();
    sfx.wheelMotor.start(0);
    const oscCount = c.ofKind('oscillator').length;
    sfx.wheelMotor.start(0.2);
    expect(c.ofKind('oscillator').length).toBe(oscCount); // idempotent
    expect(sfx.wheelMotor.running).toBe(true);
    const [saw, sub, lfo] = c.ofKind<FakeOscillator>('oscillator');
    expect(saw!.startedAt).toBe(0);
    c.currentTime = 1;
    sfx.wheelMotor.set(1);
    expect(saw!.frequency.lastTarget()).toBe(motorParams(1).freq);
    expect(sub!.frequency.lastTarget()).toBe(motorParams(1).freq / 2);
    expect(lfo!.frequency.lastTarget()).toBeGreaterThan(20);
    sfx.wheelMotor.set(7); // clamped
    expect(sfx.wheelMotor.param).toBe(1);
    const sfxBus = engine.graph!.sfxBus as unknown as FakeNode;
    const out = c.nodes.find((n) => n.outputs.includes(sfxBus)) as FakeGain;
    sfx.wheelMotor.stop();
    expect(sfx.wheelMotor.running).toBe(false);
    for (const o of [saw!, sub!, lfo!]) expect(o.stoppedAt).toBeGreaterThan(1);
    expect(out.gain.lastTarget()).toBe(0); // fades, no click
    expect(out.disconnectCount).toBe(0);
    timers.advance(1000);
    expect(out.disconnectCount).toBe(1);
    for (const o of [saw!, sub!, lfo!]) expect(o.disconnectCount).toBeGreaterThan(0);
    expect(timers.pending).toBe(0);
    sfx.wheelMotor.stop(); // double stop safe
  });

  it('set before start is remembered; blender loops its noise', () => {
    const { sfx, ctx } = setup();
    const c = ctx();
    sfx.blenderWhir.set(0.5);
    expect(sfx.blenderWhir.running).toBe(false);
    sfx.blenderWhir.start();
    expect(sfx.blenderWhir.param).toBe(0.5);
    const noise = c.ofKind<import('./fakeAudio').FakeBufferSource>('bufferSource').at(-1)!;
    expect(noise.loop).toBe(true);
    expect(noise.startedAt).toBe(0);
  });

  it('destroy kills loops immediately and cancels pending releases', () => {
    const { sfx, ctx, timers } = setup();
    const c = ctx();
    sfx.wheelMotor.start(0.5);
    sfx.blenderWhir.start(0.5);
    sfx.blenderWhir.stop(); // pending release timeout
    expect(timers.timeouts.size).toBe(1);
    sfx.destroy();
    expect(timers.pending).toBe(0);
    expect(sfx.wheelMotor.running).toBe(false);
    for (const o of c.ofKind<FakeOscillator>('oscillator')) expect(o.disconnectCount).toBeGreaterThan(0);
    expect(sfx.uiClick()).toBe(false);
    sfx.wheelMotor.start(1);
    expect(sfx.wheelMotor.running).toBe(false);
  });
});
