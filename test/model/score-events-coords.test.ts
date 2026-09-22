import { describe, expect, it } from 'vitest';
import { efficiencyRating, endlessScore, ratingBand } from '../../src/model/score';
import { MockRunEventStream, RunEventEmitter, type RunEvent } from '../../src/model/runEvents';
import { PX_PER_M, cameraTransform, screenToWorld, worldToScreen, type Camera } from '../../src/model/coords';
import { MockSnapshotSource, interpolateTransform, lerpAngle } from '../../src/model/snapshot';

describe('score', () => {
  it('matches the original formula at the boundaries', () => {
    expect(efficiencyRating(15, 15)).toBe(100);
    expect(efficiencyRating(0, 15)).toBe(100); // clamp at 100
    expect(efficiencyRating(15, 0)).toBe(0);
    expect(efficiencyRating(115, 15)).toBe(0);
    expect(efficiencyRating(200, 15)).toBe(0); // clamp at 0
    expect(efficiencyRating(45, 15)).toBe(70);
    expect(efficiencyRating(45, 13)).toBe(Math.round((70 * 13) / 15));
    expect(efficiencyRating(15, 99)).toBe(100); // delivered capped
    expect(efficiencyRating(NaN, 5)).toBe(0);
  });

  it('bands: red < 33, yellow 33-66, green > 66', () => {
    expect(ratingBand(32)).toBe('red');
    expect(ratingBand(33)).toBe('yellow');
    expect(ratingBand(66)).toBe('yellow');
    expect(ratingBand(67)).toBe('green');
  });

  it('endless score (provisional) rewards distance and carried pineapples', () => {
    expect(endlessScore(100, 0)).toBe(100);
    expect(endlessScore(100, 15)).toBe(130);
    expect(endlessScore(-5, 3)).toBe(0);
  });
});

describe('run lifecycle events', () => {
  it('emitter delivers to listeners and supports unsubscribe', () => {
    const e = new RunEventEmitter();
    const got: RunEvent[] = [];
    const off = e.on((ev) => got.push(ev));
    e.emit({ type: 'started', simTime: 0 });
    off();
    e.emit({ type: 'released', simTime: 0 });
    expect(got).toEqual([{ type: 'started', simTime: 0 }]);
  });

  it('mock stream plays the scripted run by sim time and ends at goal', () => {
    const m = new MockRunEventStream();
    const got: string[] = [];
    m.on((ev) => got.push(ev.type));
    m.advance(0);
    expect(got).toEqual(['started', 'released']);
    m.advance(10);
    expect(got).toEqual(['started', 'released', 'pineappleLost']);
    m.advance(100);
    expect(got.at(-1)).toBe('goalReached');
    expect(m.isEnded).toBe(true);
    m.giveUp();
    expect(got.at(-1)).toBe('goalReached');
  });

  it('mock stream supports giving up mid-run', () => {
    const m = new MockRunEventStream();
    const got: RunEvent[] = [];
    m.on((ev) => got.push(ev));
    m.advance(3);
    m.giveUp();
    m.advance(100);
    expect(got.at(-1)).toEqual({ type: 'gaveUp', simTime: 3 });
    expect(got.some((e) => e.type === 'goalReached')).toBe(false);
  });
});

describe('coords', () => {
  const cam: Camera = { center: { x: 10, y: 5 }, zoom: 2, viewportWidth: 800, viewportHeight: 600 };

  it('uses 30 px per metre', () => {
    expect(PX_PER_M).toBe(30);
  });

  it('world <-> screen round-trips', () => {
    const p = { x: 12.5, y: 3.25 };
    const s = worldToScreen(p, cam);
    expect(s).toEqual({ x: 400 + 2.5 * 60, y: 300 - 1.75 * 60 });
    const back = screenToWorld(s, cam);
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });

  it('cameraTransform agrees with worldToScreen', () => {
    const t = cameraTransform(cam);
    const p = { x: 7, y: -2 };
    const s = worldToScreen(p, cam);
    expect(p.x * t.scale + t.offsetX).toBeCloseTo(s.x);
    expect(p.y * t.scale + t.offsetY).toBeCloseTo(s.y);
  });
});

describe('snapshot helpers', () => {
  it('lerpAngle takes the shortest arc', () => {
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 1);
    expect(lerpAngle(0, 1, 0.25)).toBeCloseTo(0.25);
  });

  it('interpolateTransform blends position and angle', () => {
    const t = interpolateTransform({ id: 1, x: 0, y: 0, angle: 0 }, { id: 1, x: 2, y: 4, angle: 1 }, 0.5);
    expect(t).toEqual({ id: 1, x: 1, y: 2, angle: 0.5 });
  });

  it('mock snapshot source has a transform for exactly the manifest bodies (static included)', () => {
    const m = new MockSnapshotSource();
    m.advance(1.5);
    const ids = m.manifest().bodies.map((b) => b.id).sort();
    const snap = m.snapshot();
    expect(snap.simTime).toBe(1.5);
    expect(snap.bodies.map((b) => b.id).sort()).toEqual(ids);
    expect(snap.bodies.find((b) => b.id === 2)!.x).toBeCloseTo(4.5);
  });
});
