import { describe, expect, it } from 'vitest';
import { MockRunEventStream, type RunEvent } from '../../src/model/runEvents';
import {
  displayTime,
  driveEnabled,
  endBanner,
  giveUpButton,
  hudReduce,
  initialHud,
  releaseButton,
  type HudAction,
  type HudState,
} from '../../src/ui/hud';

const ev = (event: RunEvent): HudAction => ({ type: 'event', event });
const run = (s: HudState, ...as: HudAction[]) => as.reduce(hudReduce, s);

describe('HUD run-phase machine', () => {
  it('waiting -> ready -> releasing -> running -> ended (level, goal)', () => {
    let s = initialHud('level');
    expect(s.phase).toBe('waiting');
    expect(releaseButton(s)).toMatchObject({ visible: true, enabled: false });
    expect(giveUpButton(s).enabled).toBe(false);
    expect(driveEnabled(s)).toBe(false);

    s = hudReduce(s, ev({ type: 'started', simTime: 0 }));
    expect(s.phase).toBe('ready');
    expect(releaseButton(s)).toMatchObject({ visible: true, enabled: true, label: 'Release the Pineapples', attention: true });
    expect(driveEnabled(s)).toBe(true);

    s = hudReduce(s, { type: 'releaseRequested' });
    expect(s.phase).toBe('releasing');
    expect(releaseButton(s)).toMatchObject({ visible: true, enabled: false });

    s = hudReduce(s, ev({ type: 'released', simTime: 0 }));
    expect(s.phase).toBe('running');
    expect(releaseButton(s).visible).toBe(false);

    s = hudReduce(s, ev({ type: 'pineappleLost', simTime: 5, pineappleId: 1, remaining: 14 }));
    expect(s.remaining).toBe(14);

    s = hudReduce(s, ev({ type: 'goalReached', simTime: 25, delivered: 11 }));
    expect(s).toMatchObject({ phase: 'ended', delivered: 11, endTime: 25 });
    expect(s.outcome?.type).toBe('goalReached');
    expect(giveUpButton(s).visible).toBe(false);
    expect(driveEnabled(s)).toBe(false);
    expect(endBanner(s)).toBe('11 pineapples delivered!');
  });

  it('release request is only accepted when ready (no double fire)', () => {
    const w = initialHud('level');
    expect(hudReduce(w, { type: 'releaseRequested' })).toBe(w);
    const releasing = run(w, ev({ type: 'started', simTime: 0 }), { type: 'releaseRequested' });
    expect(hudReduce(releasing, { type: 'releaseRequested' })).toBe(releasing);
  });

  it('released without a click (or before started) still starts the run', () => {
    expect(hudReduce(initialHud('level'), ev({ type: 'released', simTime: 0 })).phase).toBe('running');
    expect(run(initialHud('level'), ev({ type: 'started', simTime: 0 }), ev({ type: 'released', simTime: 0 })).phase).toBe('running');
  });

  it('give up: pending until gaveUp arrives; not allowed before started', () => {
    const w = initialHud('level');
    expect(hudReduce(w, { type: 'giveUpRequested' })).toBe(w);
    let s = run(w, ev({ type: 'started', simTime: 0 }), ev({ type: 'released', simTime: 0 }), { type: 'giveUpRequested' });
    expect(s.givingUp).toBe(true);
    expect(giveUpButton(s)).toMatchObject({ enabled: false, label: 'Giving up…' });
    expect(hudReduce(s, { type: 'giveUpRequested' })).toBe(s);
    s = hudReduce(s, ev({ type: 'gaveUp', simTime: 12.5 }));
    expect(s).toMatchObject({ phase: 'ended', endTime: 12.5, givingUp: false });
    expect(endBanner(s)).toBe('Run abandoned');
  });

  it('level mode: losing every pineapple does not end the run, it nudges Give Up', () => {
    let s = run(initialHud('level'), ev({ type: 'released', simTime: 0 }));
    s = hudReduce(s, ev({ type: 'pineappleLost', simTime: 30, pineappleId: 9, remaining: 0 }));
    expect(s.phase).toBe('running');
    expect(s.allLost).toBe(true);
    expect(giveUpButton(s).attention).toBe(true);
  });

  it('endless mode: losing the last pineapple ends the run', () => {
    let s = run(initialHud('endless'), ev({ type: 'released', simTime: 0 }));
    s = hudReduce(s, ev({ type: 'pineappleLost', simTime: 40, pineappleId: 1, remaining: 3 }));
    expect(s.phase).toBe('running');
    s = hudReduce(s, ev({ type: 'pineappleLost', simTime: 90, pineappleId: 2, remaining: 0 }));
    expect(s).toMatchObject({ phase: 'ended', endTime: 90, remaining: 0 });
    expect(s.outcome?.type).toBe('pineappleLost');
    expect(giveUpButton(s).attention).toBe(false);
    expect(endBanner(s)).toBe('All pineapples lost!');
  });

  it('allLost ends the run in either mode (S6T #16: level runs with nothing recoverable)', () => {
    for (const mode of ['level', 'endless'] as const) {
      let s = run(initialHud(mode), ev({ type: 'released', simTime: 0 }));
      s = hudReduce(s, ev({ type: 'allLost', simTime: 42 }));
      expect(s).toMatchObject({ phase: 'ended', endTime: 42, remaining: 0, allLost: true });
      expect(endBanner(s)).toBe('All pineapples lost!');
      expect(giveUpButton(s).visible).toBe(false);
    }
  });

  it('stuck (S6T #5): only while running; pulses Give Up; cleared by the end', async () => {
    const { stuckHint } = await import('../../src/ui/hud');
    let s = initialHud('endless');
    s = hudReduce(s, { type: 'stuck', stuck: true });
    expect(s.stuck).toBe(false);
    s = run(s, ev({ type: 'released', simTime: 0 }), { type: 'stuck', stuck: true });
    expect(s.stuck).toBe(true);
    expect(stuckHint(s)).toBe('Stuck?');
    expect(giveUpButton(s).attention).toBe(true);
    expect(hudReduce(s, { type: 'stuck', stuck: true })).toBe(s);
    const moved = hudReduce(s, { type: 'stuck', stuck: false });
    expect(giveUpButton(moved).attention).toBe(false);
    const ended = hudReduce(s, ev({ type: 'gaveUp', simTime: 9 }));
    expect(ended.stuck).toBe(false);
    expect(stuckHint(ended)).toBe('');
  });

  it('ended is terminal: later events are ignored', () => {
    const s = run(initialHud('level'), ev({ type: 'released', simTime: 0 }), ev({ type: 'gaveUp', simTime: 3 }));
    expect(hudReduce(s, ev({ type: 'goalReached', simTime: 4, delivered: 15 }))).toBe(s);
    expect(hudReduce(s, ev({ type: 'started', simTime: 0 }))).toBe(s);
  });

  it('clamps odd counts and times from events', () => {
    let s = run(initialHud('level'), ev({ type: 'released', simTime: 0 }));
    s = hudReduce(s, ev({ type: 'pineappleLost', simTime: 1, pineappleId: 1, remaining: 99 }));
    expect(s.remaining).toBe(15);
    s = hudReduce(s, ev({ type: 'goalReached', simTime: NaN, delivered: -3 }));
    expect(s).toMatchObject({ delivered: 0, endTime: 0 });
  });

  it('timer display: 0 before Release, live while running, frozen after', () => {
    let s = initialHud('level');
    expect(displayTime(s, 99)).toBe(0);
    s = hudReduce(s, ev({ type: 'started', simTime: 0 }));
    expect(displayTime(s, 99)).toBe(0);
    s = hudReduce(s, ev({ type: 'released', simTime: 0 }));
    expect(displayTime(s, 7.5)).toBe(7.5);
    s = hudReduce(s, ev({ type: 'goalReached', simTime: 40, delivered: 13 }));
    expect(displayTime(s, 55)).toBe(40);
  });

  it('consumes the S0 mock event stream end to end', () => {
    const stream = new MockRunEventStream();
    let s = initialHud('level');
    stream.on((event) => (s = hudReduce(s, { type: 'event', event })));
    stream.advance(0);
    expect(s.phase).toBe('running');
    stream.advance(10);
    expect(s.remaining).toBe(14);
    stream.advance(30);
    expect(s).toMatchObject({ phase: 'ended', delivered: 13, endTime: 40, remaining: 13 });
  });
});
