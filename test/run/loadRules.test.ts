/** Harness load checks, solid-prop parsing, swept/polygon geometry and the allLost mock stream (pure, no physics). */
import { describe, expect, it } from 'vitest';
import { MockRunEventStream, defaultMockRunScript, endlessAllLostMockRunScript, isTerminalRunEvent, type RunEvent } from '../../src/model/runEvents';
import { loadFixtureCart, loadFlatGoalLevel } from '../../src/run/fixtures';
import { checkCartJson, checkLevelJson } from '../../src/run/loadCheck';
import { isSolidProp } from '../../src/run/props';
import { boxPolygon, circleTouchesPolygon, segmentIntersectsRect, sweptCircleTouchesRect } from '../../src/run/shapes';

describe('harness load checks (reject before the current run is touched)', () => {
  it('accepts the fixture cart and level', () => {
    const cart = checkCartJson(JSON.stringify(loadFixtureCart()));
    expect(cart.ok).toBe(true);
    expect(checkLevelJson(JSON.stringify(loadFlatGoalLevel())).ok).toBe(true);
  });

  it('rejects broken JSON and schema errors', () => {
    expect(checkCartJson('{nope').ok).toBe(false);
    const r = checkCartJson('{"version":1,"parts":[{"id":"x","kind":"wheel"}]}');
    expect(r.ok).toBe(false);
    expect(checkLevelJson('{"version":1}').ok).toBe(false);
  });

  it('rejects a schema-valid cart that cannot start (attachment errors), with the codes', () => {
    // one straw, no wheels: passes the schema, fails resolveAttachments
    const text = JSON.stringify({ version: 1, parts: [{ id: 's', kind: 'straw', a: { x: 0, y: 0 }, b: { x: 90, y: 0 } }] });
    const r = checkCartJson(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/cannot be started \(.+\)/);
  });
});

describe('solid props', () => {
  it('only props with solid: true and a positive size are built', () => {
    const base = { id: 'p', art: 'palm', position: { x: 0, y: 0 } };
    expect(isSolidProp(base)).toBe(false);
    expect(isSolidProp({ ...base, solid: true })).toBe(false);
    expect(isSolidProp({ ...base, solid: true, size: { x: 0, y: 2 } })).toBe(false);
    expect(isSolidProp({ ...base, solid: false, size: { x: 1, y: 2 } })).toBe(false);
    expect(isSolidProp({ ...base, solid: true, size: { x: 1, y: 2 } })).toBe(true);
  });

  it('boxPolygon is centred on the position and rotates about it', () => {
    expect(boxPolygon({ x: 10, y: 5 }, { x: 2, y: 4 })).toEqual([
      { x: 9, y: 3 },
      { x: 11, y: 3 },
      { x: 11, y: 7 },
      { x: 9, y: 7 },
    ]);
    const r = boxPolygon({ x: 0, y: 0 }, { x: 2, y: 4 }, Math.PI / 2);
    expect(r[0]!.x).toBeCloseTo(2, 9);
    expect(r[0]!.y).toBeCloseTo(-1, 9);
  });
});

describe('swept / polygon geometry', () => {
  const strip = { x: 10, y: 0, width: 0.02, height: 2 };

  it('segmentIntersectsRect: crossing, parallel miss, touching an edge', () => {
    expect(segmentIntersectsRect({ x: 9, y: 1 }, { x: 11, y: 1 }, strip)).toBe(true);
    expect(segmentIntersectsRect({ x: 9, y: 3 }, { x: 11, y: 3 }, strip)).toBe(false);
    expect(segmentIntersectsRect({ x: 9, y: 2 }, { x: 11, y: 2 }, strip)).toBe(true);
    expect(segmentIntersectsRect({ x: 9, y: 1 }, { x: 9.5, y: 1 }, strip)).toBe(false);
    // a single point
    expect(segmentIntersectsRect({ x: 10.01, y: 1 }, { x: 10.01, y: 1 }, strip)).toBe(true);
  });

  it('sweptCircleTouchesRect catches a step that jumps over a thin strip; corner distance is exact', () => {
    expect(sweptCircleTouchesRect({ x: 9, y: 1 }, { x: 11, y: 1 }, 0.33, strip)).toBe(true);
    // passing above the strip's top-left corner (10, 0): closest approach 0.4
    expect(sweptCircleTouchesRect({ x: 9, y: -0.4 }, { x: 11, y: -0.4 }, 0.33, strip)).toBe(false);
    expect(sweptCircleTouchesRect({ x: 9, y: -0.3 }, { x: 11, y: -0.3 }, 0.33, strip)).toBe(true);
    // diagonal past the corner (10, 0) of a 1×1 box: both endpoints are far,
    // the closest approach (0.354 m, mid-segment) decides
    const box = { x: 10, y: 0, width: 1, height: 1 };
    expect(sweptCircleTouchesRect({ x: 9, y: 0.5 }, { x: 10.5, y: -1 }, 0.33, box)).toBe(false);
    expect(sweptCircleTouchesRect({ x: 9, y: 0.5 }, { x: 10.5, y: -1 }, 0.36, box)).toBe(true);
  });

  it('circleTouchesPolygon: inside, near an edge (with slop), away', () => {
    const sq = boxPolygon({ x: 0, y: 0 }, { x: 2, y: 2 });
    expect(circleTouchesPolygon({ x: 0, y: 0 }, 0.1, sq)).toBe(true);
    expect(circleTouchesPolygon({ x: 1.29, y: 0 }, 0.3, sq)).toBe(true);
    expect(circleTouchesPolygon({ x: 1.34, y: 0 }, 0.3, sq)).toBe(false);
    expect(circleTouchesPolygon({ x: 1.34, y: 0 }, 0.3, sq, 0.05)).toBe(true);
    expect(circleTouchesPolygon({ x: 5, y: 5 }, 0.3, sq)).toBe(false);
  });
});

describe('allLost (additive contract 3 amendment)', () => {
  it('is terminal alongside goalReached and gaveUp', () => {
    expect(isTerminalRunEvent({ type: 'allLost', simTime: 3 })).toBe(true);
    expect(isTerminalRunEvent({ type: 'goalReached', simTime: 3, delivered: 1 })).toBe(true);
    expect(isTerminalRunEvent({ type: 'gaveUp', simTime: 3 })).toBe(true);
    expect(isTerminalRunEvent({ type: 'pineappleLost', simTime: 3, pineappleId: 0, remaining: 1 })).toBe(false);
  });

  it('the mock stream supports an endless all-lost run and ends on allLost', () => {
    const mock = new MockRunEventStream(endlessAllLostMockRunScript(3, 2));
    const got: RunEvent[] = [];
    mock.on((e) => got.push(e));
    mock.advance(100);
    expect(got.map((e) => e.type)).toEqual(['started', 'released', 'pineappleLost', 'pineappleLost', 'pineappleLost', 'allLost']);
    expect(got.at(-2)).toEqual({ type: 'pineappleLost', simTime: 6, pineappleId: 2, remaining: 0 });
    expect(got.at(-1)).toEqual({ type: 'allLost', simTime: 6 });
    expect(mock.isEnded).toBe(true);
    mock.giveUp();
    expect(got).toHaveLength(6);
  });

  it('re-entrant: giveUp() called inside a scripted terminal event listener emits nothing more', () => {
    for (const script of [endlessAllLostMockRunScript(2, 1), defaultMockRunScript()]) {
      const mock = new MockRunEventStream(script);
      const got: RunEvent[] = [];
      mock.on((e) => {
        got.push(e);
        if (isTerminalRunEvent(e)) mock.giveUp();
      });
      mock.advance(1000);
      expect(got.filter(isTerminalRunEvent)).toHaveLength(1);
      expect(isTerminalRunEvent(got.at(-1)!)).toBe(true);
      expect(got.at(-1)!.type).not.toBe('gaveUp');
      expect(mock.isEnded).toBe(true);
    }
  });
});
