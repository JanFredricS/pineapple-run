import { describe, expect, it } from 'vitest';
import { LookaheadScheduler, type StepInfo } from '../../src/audio/scheduler';
import { FakeTimers } from './fakeAudio';

function setup(opts: { step?: number; loop?: number; lookahead?: number } = {}) {
  let now = 0;
  const timers = new FakeTimers();
  const steps: Array<StepInfo & { scheduledAt: number }> = [];
  const s = new LookaheadScheduler({
    now: () => now,
    stepDuration: opts.step ?? 0.125,
    loopSteps: opts.loop ?? 8,
    lookahead: opts.lookahead ?? 0.1,
    intervalMs: 25,
    timers,
    onStep: (info) => steps.push({ ...info, scheduledAt: now }),
  });
  return {
    s,
    timers,
    steps,
    setNow: (t: number) => {
      now = t;
    },
  };
}

describe('LookaheadScheduler', () => {
  it('schedules each step ahead of time, at the exact grid time, never late', () => {
    const { s, timers, steps, setNow } = setup();
    s.start(1);
    expect(timers.intervals.size).toBe(1);
    // Irregular wake-ups (jittery timers) every ~20-30 ms for 5 s.
    let t = 0;
    let k = 0;
    while (t < 6) {
      t += 0.02 + (k++ % 3) * 0.005;
      setNow(t);
      timers.fireIntervals();
    }
    expect(steps.length).toBeGreaterThan(30);
    steps.forEach((st, i) => {
      expect(st.count).toBe(i); // no gaps, no duplicates
      expect(st.time).toBe(1 + i * 0.125); // exact (dyadic step)
      expect(st.time).toBeGreaterThanOrEqual(st.scheduledAt); // never in the past
      expect(st.time - st.scheduledAt).toBeLessThan(0.1 + 1e-12); // within lookahead
    });
  });

  it('loops seamlessly: index wraps to 0, loop increments, spacing is constant', () => {
    const { s, timers, steps, setNow } = setup({ loop: 8 });
    s.start(0);
    for (let t = 0; t < 3.1; t += 0.025) {
      setNow(t);
      timers.fireIntervals();
    }
    const idx = steps.map((x) => x.step);
    expect(idx.slice(0, 18)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7, 0, 1]);
    const boundary = steps.findIndex((x) => x.loop === 1);
    expect(boundary).toBe(8);
    expect(steps[boundary]!.step).toBe(0);
    expect(steps[boundary]!.time - steps[boundary - 1]!.time).toBe(0.125);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!.time - steps[i - 1]!.time).toBe(0.125);
    // Loop n starts exactly n loop-lengths after the origin (no drift).
    for (const st of steps.filter((x) => x.step === 0)) expect(st.time).toBe(st.loop * 8 * 0.125);
  });

  it('non-dyadic tempo does not drift over many loops', () => {
    const { s, timers, steps, setNow } = setup({ step: 0.15, loop: 128 });
    s.start(0.06);
    for (let t = 0; t < 120; t += 0.025) {
      setNow(t);
      timers.fireIntervals();
    }
    const last = steps[steps.length - 1]!;
    expect(last.time).toBe(0.06 + last.count * 0.15);
    const loopStarts = steps.filter((x) => x.step === 0);
    expect(loopStarts.length).toBeGreaterThanOrEqual(6);
    loopStarts.forEach((x, i) => expect(x.time).toBeCloseTo(0.06 + i * 128 * 0.15, 9));
  });

  it('skips steps missed during a stall, keeping grid phase', () => {
    const { s, timers, steps, setNow } = setup();
    s.start(0);
    setNow(0.05);
    timers.fireIntervals();
    const before = steps.length;
    setNow(2.05); // 2 s stall
    timers.fireIntervals();
    const after = steps.slice(before);
    expect(after.length).toBeGreaterThan(0);
    for (const st of after) {
      expect(st.time).toBeGreaterThanOrEqual(2.05);
      expect((st.time / 0.125) % 1).toBe(0); // still on the grid
    }
    expect(after[0]!.time).toBe(2.125);
  });

  it('stop clears the interval and stops scheduling; restart re-origins', () => {
    const { s, timers, steps, setNow } = setup();
    s.start(0);
    const n = steps.length;
    s.stop();
    expect(timers.intervals.size).toBe(0);
    expect(s.running).toBe(false);
    setNow(1);
    s.tick();
    expect(steps.length).toBe(n);
    setNow(4.95);
    s.start(5);
    expect(timers.intervals.size).toBe(1);
    expect(steps[n]).toMatchObject({ count: 0, time: 5, step: 0, loop: 0 });
    s.stop();
  });

  it('rejects a bad grid', () => {
    const timers = new FakeTimers();
    expect(() => new LookaheadScheduler({ now: () => 0, stepDuration: 0, loopSteps: 8, timers, onStep: () => {} })).toThrow(RangeError);
    expect(() => new LookaheadScheduler({ now: () => 0, stepDuration: 0.1, loopSteps: 2.5, timers, onStep: () => {} })).toThrow(RangeError);
  });
});
