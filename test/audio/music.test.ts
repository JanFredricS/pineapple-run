import { describe, expect, it } from 'vitest';
import { LOOP_STEPS, stepSeconds } from '../../src/audio/dsp';
import { AudioEngine } from '../../src/audio/engine';
import { FIRST_FADE_IN_SECONDS, LAYER_MIX, MusicPlayer, START_DELAY, THEME_FADE_SECONDS } from '../../src/audio/music';
import { FakeAudioContext, FakeTimers, fakeFactory, type FakeGain, type FakeNode, type FakeOscillator } from './fakeAudio';

const LOOP_SECONDS = LOOP_STEPS * stepSeconds();

function setup(seed = 11) {
  const { factory, created } = fakeFactory({ initialState: 'running' });
  const engine = new AudioEngine({ createContext: factory, storage: null, visibility: null });
  const timers = new FakeTimers();
  const music = new MusicPlayer(engine, { timers, seed, lookahead: 0.12, intervalMs: 25 });
  const ctx = () => created[0]!;
  /** Advance audio time in 25 ms wakes. */
  const runTo = (t: number) => {
    const c = ctx();
    while (c.currentTime < t) {
      c.currentTime = Math.min(t, c.currentTime + 0.025);
      timers.fireIntervals();
    }
  };
  return { engine, timers, music, ctx, runTo };
}

const connectedTo = (ctx: FakeAudioContext, node: FakeNode) => ctx.nodes.filter((n) => n.outputs.includes(node));

/** The session bus (connected to the music bus) and its 4 layer gains. */
function sessionNodes(ctx: FakeAudioContext, engine: AudioEngine, which = -1) {
  const buses = connectedTo(ctx, engine.graph!.musicBus as unknown as FakeNode) as FakeGain[];
  const bus = buses.at(which)!;
  const layers = connectedTo(ctx, bus) as FakeGain[];
  return { bus, layers };
}

/** Note-on times of voices feeding a layer (first automation point of each envelope gain). */
function noteTimes(ctx: FakeAudioContext, layer: FakeNode): number[] {
  return (connectedTo(ctx, layer) as FakeGain[]).map((g) => (g.gain.calls[0] as { t: number }).t).sort((a, b) => a - b);
}

describe('MusicPlayer', () => {
  it('play builds bus + 4 layers and schedules only the base layer at stage 0', () => {
    const { music, engine, ctx, runTo, timers } = setup();
    music.play('beach', 0);
    expect(music.theme).toBe('beach');
    expect(timers.intervals.size).toBe(1);
    runTo(4);
    const { layers } = sessionNodes(ctx(), engine);
    expect(layers).toHaveLength(4);
    expect(noteTimes(ctx(), layers[0]!).length).toBeGreaterThan(10);
    for (const l of layers.slice(1)) expect(noteTimes(ctx(), l)).toEqual([]);
    expect(layers.map((l) => l.gain.value)).toEqual([LAYER_MIX[0], 0, 0, 0]);
    // Every note starts on the grid.
    const start = START_DELAY;
    for (const t of noteTimes(ctx(), layers[0]!)) {
      const steps = (t - start) / stepSeconds();
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
    }
  });

  it('setStage cross-fades with linear ramps from the in-flight value', () => {
    const { music, engine, ctx, runTo } = setup();
    music.play('kitchen', 0);
    runTo(1);
    music.setStage(3, 2);
    const { layers } = sessionNodes(ctx(), engine);
    expect(music.layerRamps).toEqual([
      { from: LAYER_MIX[0], to: LAYER_MIX[0], t0: expect.any(Number), t1: expect.any(Number) },
      { from: 0, to: LAYER_MIX[1], t0: 1, t1: 3 },
      { from: 0, to: LAYER_MIX[2], t0: 1, t1: 3 },
      { from: 0, to: LAYER_MIX[3], t0: 1, t1: 3 },
    ]);
    expect(layers[3]!.gain.calls.slice(-3)).toEqual([
      { m: 'cancel', t: 1 },
      { m: 'set', v: 0, t: 1 },
      { m: 'lin', v: LAYER_MIX[3], t: 3 },
    ]);
    // Base layer untouched (no restart).
    expect(layers[0]!.gain.calls.filter((c) => c.m === 'cancel')).toHaveLength(1);
    runTo(2);
    // Interrupt half-way: fade back down starts from the current value.
    music.setStage(1, 2);
    expect(music.layerRamps[3]).toEqual({ from: LAYER_MIX[3] / 2, to: 0, t0: 2, t1: 4 });
    expect(music.layerRamps[1]!.to).toBe(LAYER_MIX[1]); // still heading up, not restarted
    expect(music.layerRamps[1]!.t0).toBe(1);
    runTo(8);
    // Layer 3 received notes only while audible (from the fade start to the fade-out end).
    const l3 = noteTimes(ctx(), layers[3]!);
    expect(l3.length).toBeGreaterThan(0);
    for (const t of l3) {
      expect(t).toBeGreaterThanOrEqual(1);
      expect(t).toBeLessThan(4);
    }
    // Layer 1 keeps playing.
    expect(noteTimes(ctx(), layers[1]!).some((t) => t > 5)).toBe(true);
    expect(music.stage).toBe(1);
  });

  it('instant stage change (fade 0) jumps', () => {
    const { music, ctx, runTo } = setup();
    music.play('beach', 0);
    runTo(0.5);
    music.setStage(2, 0);
    expect(music.layerRamps[2]).toEqual({ from: 0, to: LAYER_MIX[2], t0: 0.5, t1: 0.5 });
    expect(ctx().currentTime).toBe(0.5);
  });

  it('loops seamlessly: loop 2 repeats loop 1 exactly one loop-length later', () => {
    const { music, engine, ctx, runTo } = setup();
    music.play('workbench', 3);
    runTo(START_DELAY + 2 * LOOP_SECONDS + 0.5);
    const { layers } = sessionNodes(ctx(), engine);
    for (const layer of layers) {
      const times = noteTimes(ctx(), layer);
      const a = times.filter((t) => t < START_DELAY + LOOP_SECONDS - 1e-9);
      const b = times.filter((t) => t >= START_DELAY + LOOP_SECONDS - 1e-9 && t < START_DELAY + 2 * LOOP_SECONDS - 1e-9);
      expect(a.length).toBeGreaterThan(0);
      expect(b).toHaveLength(a.length);
      b.forEach((t, i) => expect(t - a[i]!).toBeCloseTo(LOOP_SECONDS, 9));
    }
    // Same pitches too (the loop is the same loop).
    const freqs = (lo: number, hi: number) =>
      ctx()
        .ofKind<FakeOscillator>('oscillator')
        .filter((o) => o.startedAt! >= lo && o.startedAt! < hi)
        .map((o) => (o.frequency.calls[0] as { v: number }).v)
        .sort((x, y) => x - y);
    expect(freqs(START_DELAY + LOOP_SECONDS - 1e-9, START_DELAY + 2 * LOOP_SECONDS - 1e-9)).toEqual(freqs(0, START_DELAY + LOOP_SECONDS - 1e-9));
  });

  it('is deterministic for a seed', () => {
    const trace = (seed: number) => {
      const s = setup(seed);
      s.music.play('endless', 3);
      s.runTo(6);
      return s
        .ctx()
        .ofKind<FakeOscillator>('oscillator')
        .map((o) => `${o.type}@${o.startedAt}:${(o.frequency.calls[0] as { v: number } | undefined)?.v}`);
    };
    expect(trace(5)).toEqual(trace(5));
    expect(trace(5)).not.toEqual(trace(6));
  });

  it('theme change retires the old session (fade, then disconnect) and re-play is a no-op', () => {
    const { music, engine, ctx, runTo, timers } = setup();
    music.play('beach');
    runTo(1);
    const old = sessionNodes(ctx(), engine).bus;
    const before = ctx().nodes.length;
    music.play('beach');
    expect(ctx().nodes.length).toBe(before);
    music.play('kitchen');
    expect(music.theme).toBe('kitchen');
    expect(timers.intervals.size).toBe(1);
    expect(old.gain.lastTarget()).toBe(0);
    expect(music.retiringCount).toBe(1);
    const oldNotes = connectedTo(ctx(), old).flatMap((l) => noteTimes(ctx(), l));
    runTo(3);
    // Old session stopped scheduling at the switch.
    expect(connectedTo(ctx(), old).flatMap((l) => noteTimes(ctx(), l))).toEqual(oldNotes);
    timers.advance((THEME_FADE_SECONDS + 0.3) * 1000);
    expect(old.disconnectCount).toBe(1);
    expect(music.retiringCount).toBe(0);
    // New session fades in over the theme fade.
    const fresh = sessionNodes(ctx(), engine).bus;
    expect(fresh).not.toBe(old);
    expect(fresh.gain.calls.slice(0, 3)).toEqual([
      { m: 'cancel', t: 1 },
      { m: 'set', v: 0, t: 1 },
      { m: 'lin', v: 1, t: 1 + THEME_FADE_SECONDS },
    ]);
  });

  it('stop / theme switch during the fade-in pins the interpolated bus gain (no jump to 0)', () => {
    const { music, engine, ctx, runTo } = setup();
    music.play('beach');
    runTo(0.15); // half-way through the 0.3 s first fade-in
    const bus = sessionNodes(ctx(), engine).bus;
    music.stop(0.8);
    const tail = bus.gain.calls.slice(-3);
    expect(tail).toEqual([
      { m: 'cancel', t: 0.15 },
      { m: 'set', v: 0.15 / FIRST_FADE_IN_SECONDS, t: 0.15 },
      { m: 'lin', v: 0, t: 0.15 + 0.8 },
    ]);
    expect((tail[1] as { v: number }).v).toBeGreaterThan(0);

    // Switching theme mid cross-fade: the incoming bus is pinned too.
    music.play('kitchen');
    runTo(0.55); // kitchen bus: 0 → 1 over THEME_FADE_SECONDS from 0.15
    const kitchenBus = sessionNodes(ctx(), engine).bus;
    music.play('workbench');
    const expected = (0.55 - 0.15) / THEME_FADE_SECONDS;
    const k = kitchenBus.gain.calls.slice(-3);
    expect(k[0]).toEqual({ m: 'cancel', t: 0.55 });
    expect(k[1]!.m).toBe('set');
    expect((k[1] as { v: number }).v).toBeCloseTo(expected, 12);
    expect(k[2]).toEqual({ m: 'lin', v: 0, t: 0.55 + THEME_FADE_SECONDS });
  });

  it('before unlock (frozen clock) it only schedules the first lookahead window', () => {
    const { factory, created } = fakeFactory(); // suspended, currentTime frozen at 0
    const engine = new AudioEngine({ createContext: factory, storage: null, visibility: null });
    const timers = new FakeTimers();
    const music = new MusicPlayer(engine, { timers, lookahead: 0.12 });
    music.play('title', 3);
    const n = created[0]!.nodes.length;
    for (let i = 0; i < 50; i++) timers.fireIntervals();
    expect(created[0]!.nodes.length).toBe(n);
  });

  it('stop and destroy leave no timers and disconnect every bus', () => {
    const { music, engine, ctx, runTo, timers } = setup();
    music.play('beach');
    runTo(0.5);
    music.stop();
    expect(music.theme).toBeNull();
    expect(timers.intervals.size).toBe(0);
    expect(timers.timeouts.size).toBe(1);
    music.play('kitchen');
    runTo(0.7);
    const buses = connectedTo(ctx(), engine.graph!.musicBus as unknown as FakeNode);
    music.destroy();
    expect(timers.pending).toBe(0);
    for (const b of buses) expect(b.disconnectCount).toBeGreaterThan(0);
    music.play('beach');
    expect(music.theme).toBeNull();
  });

  it('with no Web Audio, play/setStage/stop are silent no-ops', () => {
    const engine = new AudioEngine({ createContext: () => null, storage: null, visibility: null });
    const timers = new FakeTimers();
    const music = new MusicPlayer(engine, { timers });
    music.play('beach');
    music.setStage(3);
    music.stop();
    expect(music.theme).toBeNull();
    expect(music.stage).toBe(3);
    expect(timers.pending).toBe(0);
  });
});
