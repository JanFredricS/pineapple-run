import { describe, expect, it } from 'vitest';
import { FIXED_DT, FixedStepClock, FrameLoop, MAX_CATCH_UP_SECONDS } from '../../src/physics/clock';

describe('FixedStepClock', () => {
  it('steps once per 1/60 s of real time', () => {
    const c = new FixedStepClock();
    expect(c.advance(FIXED_DT)).toBe(1);
    expect(c.advance(FIXED_DT / 2)).toBe(0);
    expect(c.alpha).toBeCloseTo(0.5);
    expect(c.advance(FIXED_DT / 2)).toBe(1);
    expect(c.steps).toBe(2);
  });

  it('is exact over many 60 Hz frames (no float drift)', () => {
    const c = new FixedStepClock();
    let n = 0;
    for (let i = 0; i < 6000; i++) n += c.advance(1 / 60);
    expect(n).toBe(6000);
    expect(c.simTime).toBeCloseTo(100);
  });

  it('handles 144 Hz and 30 Hz displays', () => {
    const fast = new FixedStepClock();
    for (let i = 0; i < 144; i++) fast.advance(1 / 144);
    expect(fast.steps).toBeGreaterThanOrEqual(59);
    expect(fast.steps).toBeLessThanOrEqual(60);
    const slow = new FixedStepClock();
    for (let i = 0; i < 30; i++) expect(slow.advance(1 / 30)).toBe(2);
  });

  it('caps catch-up at 250 ms and drops the excess (sim time, not wall time)', () => {
    const c = new FixedStepClock();
    const n = c.advance(5); // 5 s hitch
    expect(n).toBe(Math.floor(MAX_CATCH_UP_SECONDS / FIXED_DT + 1e-9));
    expect(c.simTime).toBeCloseTo(0.25, 5);
    expect(c.advance(0)).toBe(0); // the excess is gone, not queued
  });

  it('pausing stops the clock; resume does not replay paused time', () => {
    const c = new FixedStepClock();
    c.advance(0.1);
    const before = c.steps;
    c.pause();
    expect(c.advance(10)).toBe(0);
    c.resume();
    expect(c.steps).toBe(before);
    expect(c.alpha).toBe(0);
    expect(c.advance(FIXED_DT)).toBe(1);
  });

  it('ignores negative / non-finite dt', () => {
    const c = new FixedStepClock();
    expect(c.advance(-1)).toBe(0);
    expect(c.advance(Number.NaN)).toBe(0);
    expect(c.advance(Infinity)).toBe(0);
  });
});

describe('FrameLoop pause causes', () => {
  function setup() {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    const win = new EventTarget();
    const changes: boolean[] = [];
    const loop = new FrameLoop({ step() {}, render() {}, onPauseChange: (p) => changes.push(p) });
    loop.bindVisibility(doc as unknown as Document, win as unknown as Window);
    const setVis = (v: DocumentVisibilityState) => {
      doc.visibilityState = v;
      doc.dispatchEvent(new Event('visibilitychange'));
    };
    return { loop, win, setVis, changes };
  }

  it('blur and hidden compose: visible again while still blurred stays paused', () => {
    const { loop, win, setVis, changes } = setup();
    expect(loop.clock.paused).toBe(false);
    win.dispatchEvent(new Event('blur'));
    setVis('hidden');
    setVis('visible');
    expect(loop.clock.paused).toBe(true); // still blurred
    win.dispatchEvent(new Event('focus'));
    expect(loop.clock.paused).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('focus while hidden stays paused; manual pause composes too', () => {
    const { loop, win, setVis } = setup();
    setVis('hidden');
    win.dispatchEvent(new Event('focus'));
    expect(loop.clock.paused).toBe(true);
    setVis('visible');
    expect(loop.clock.paused).toBe(false);
    loop.setPaused(true);
    win.dispatchEvent(new Event('blur'));
    win.dispatchEvent(new Event('focus'));
    expect(loop.clock.paused).toBe(true);
    loop.setPaused(false);
    expect(loop.clock.paused).toBe(false);
    loop.stop();
  });
});
