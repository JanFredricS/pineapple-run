/**
 * K1 audit #5: "more bumpy, more in line with the original map", measured
 * (TUNING.md "K1: Kitchen difficulty", the bumps table). On the driving
 * surface (gap holes and walls excluded) from the end of the start plateau
 * to 1 m before the finish: the goal line, or PIT.lineAfterLip past the pit's
 * lip where the line sits further on, in a long pit (Kitchen since K1 audit
 * #4, the original since M1). One rule on every course (M1 audit #1): the lip
 * is found in the geometry (finishLipX, tools/levels/census.ts). The pit and
 * its landing counter are finish geometry, not terrain roughness; the
 * excitement census covers them to the real goal line.
 *   - travel/m: sum of |dy| per metre driven (0.25 m steps);
 *   - 1 m slope: |y(x+1) - y(x)| every 0.5 m, mean and 90th percentile;
 *   - relief: RMS of the height minus its +-10 m moving average;
 *   - bumps: local tops (highest within +-1 m) with >= 0.25 m prominence
 *     (the lower of the highest points within 8 m on each side), per 100 m.
 * Before K1 Kitchen was travel 0.158, slope mean 0.114 / p90 0.309, relief
 * 0.46, 5.6 bumps / 100 m.
 */
import { describe, expect, it } from 'vitest';
import { levelById } from '../../src/game/courses';
import { plateauRange } from '../../src/game/startArea';
import type { LevelDef } from '../../src/model/level';
import { groundAt, PREMADE } from '../../tools/levels/premade';
import { PIT } from '../../tools/levels/track';
import { finishLipX } from '../../tools/levels/census';

interface Roughness {
  travelPerM: number;
  slopeMean: number;
  slopeP90: number;
  relief: number;
  bumpsPer100m: number;
}

function roughness(level: LevelDef, endX: number): Roughness {
  const x0 = plateauRange(level.cartStart).maxX;
  const x1 = endX - 1;
  // the driving surface: drop the gap walls' feet at killY, so a hole reads as no ground
  const surface: LevelDef = {
    ...level,
    terrain: { ...level.terrain, spans: level.terrain.spans.map((sp) => ({ ...sp, points: sp.points.filter((q) => q.y < level.killY) })) },
  };
  const g = (x: number) => groundAt(surface, x);
  const dx = 0.25;
  let travel = 0;
  let len = 0;
  for (let x = x0; x + dx <= x1; x += dx) {
    const a = g(x);
    const b = g(x + dx);
    if (a === null || b === null) continue;
    travel += Math.abs(b - a);
    len += dx;
  }
  const d1: number[] = [];
  for (let x = x0; x + 1 <= x1; x += 0.5) {
    const a = g(x);
    const b = g(x + 1);
    if (a !== null && b !== null) d1.push(Math.abs(b - a));
  }
  d1.sort((a, b) => a - b);
  const ys: [number, number][] = [];
  for (let x = x0; x <= x1; x += 0.25) {
    const y = g(x);
    if (y !== null) ys.push([x, y]);
  }
  let rms = 0;
  for (const [x, y] of ys) {
    const w = ys.filter(([u]) => Math.abs(u - x) <= 10);
    const m = w.reduce((s, [, v]) => s + v, 0) / w.length;
    rms += (y - m) ** 2;
  }
  let bumps = 0;
  for (let i = 0; i < ys.length; i++) {
    const [x, y] = ys[i]!;
    // y-down: a top is a local minimum of y
    if (ys.some(([u, v]) => Math.abs(u - x) <= 1 && u !== x && v < y - 1e-9)) continue;
    if (i > 0 && Math.abs(ys[i - 1]![1] - y) < 1e-9) continue; // a plateau counts once
    const left = ys.filter(([u]) => u < x && u >= x - 8).map(([, v]) => v);
    const right = ys.filter(([u]) => u > x && u <= x + 8).map(([, v]) => v);
    if (!left.length || !right.length) continue;
    if (Math.min(Math.max(...left), Math.max(...right)) - y >= 0.25) bumps++;
  }
  return {
    travelPerM: travel / len,
    slopeMean: d1.reduce((s, v) => s + v, 0) / d1.length,
    slopeP90: d1[Math.floor(d1.length * 0.9)]!,
    relief: Math.sqrt(rms / ys.length),
    bumpsPer100m: (bumps / len) * 100,
  };
}

/** Where the roughness window ends (1 m before this): the same lip rule on every course. */
const finishEnd = (l: LevelDef) => Math.min(l.goal.lineX, finishLipX(l) + PIT.lineAfterLip);
const premade = (id: 'beach' | 'kitchen' | 'workbench' | 'tikibar') => roughness(PREMADE[id]().level, finishEnd(PREMADE[id]().level));
const original = () => roughness(levelById('original')!, finishEnd(levelById('original')!));

describe('K1 audit #5: Kitchen is bumpy, in line with the original', () => {
  const k = premade('kitchen');
  const o = original();

  it('M1 audit #1: one window rule on every course; the lip found in the geometry is the authored lip on the premades and the 2008 lip on the original', () => {
    for (const id of ['beach', 'kitchen', 'workbench', 'tikibar'] as const) {
      const a = PREMADE[id]();
      expect(finishLipX(a.level), id).toBeCloseTo(a.features.find((f) => f.kind === 'finish')!.x0, 9);
    }
    const l = levelById('original')!;
    expect(finishLipX(l) * 30).toBeCloseTo(7662.25, 6); // the 2008 shredder lip (7670 px, the 2008 goal line, is 0.26 m past it)
    // the original's window ends at the lip, not at its M1 goal line 10.3 m further into the pit
    expect(finishEnd(l)).toBeCloseTo(finishLipX(l) + PIT.lineAfterLip, 9);
    expect(l.goal.lineX - finishEnd(l)).toBeGreaterThan(10);
  });

  it("the original course's roughness (the reference; measured 0.385 travel/m, slope 0.356 / p90 0.859, relief 1.10, 6.6 bumps / 100 m)", () => {
    expect(o.travelPerM).toBeCloseTo(0.385, 2);
    expect(o.slopeMean).toBeCloseTo(0.356, 2);
    expect(o.slopeP90).toBeCloseTo(0.859, 2);
    expect(o.relief).toBeCloseTo(1.1, 1);
    expect(o.bumpsPer100m).toBeCloseTo(6.6, 0);
  });

  it('Kitchen: travel >= 0.25 /m, slope mean >= 0.2 and p90 >= 0.43, relief >= 0.55, >= 14 bumps / 100 m (measured 0.266, 0.216, 0.457, 0.584, 14.9)', () => {
    expect(k.travelPerM).toBeGreaterThanOrEqual(0.25);
    expect(k.slopeMean).toBeGreaterThanOrEqual(0.2);
    expect(k.slopeP90).toBeGreaterThanOrEqual(0.43);
    expect(k.relief).toBeGreaterThanOrEqual(0.55);
    expect(k.bumpsPer100m).toBeGreaterThanOrEqual(14);
  });

  it("Kitchen has >= 65% of the original's travel per metre and >= 55% of its mean 1 m slope (measured 69%, 61%; before K1 41%, 32%)", () => {
    expect(k.travelPerM / o.travelPerM).toBeGreaterThanOrEqual(0.65);
    expect(k.slopeMean / o.slopeMean).toBeGreaterThanOrEqual(0.55);
  });

  // Not relief: Kitchen's 0.58 is above beach (0.51) but below workbench (0.61) and tikibar (0.64).
  it('Kitchen is the roughest premade course by travel/m, mean 1 m slope and bumps/100 m (not by relief)', () => {
    for (const id of ['beach', 'workbench', 'tikibar'] as const) {
      const r = premade(id);
      expect(k.travelPerM, id).toBeGreaterThan(r.travelPerM);
      expect(k.slopeMean, id).toBeGreaterThan(r.slopeMean);
      expect(k.bumpsPer100m, id).toBeGreaterThan(r.bumpsPer100m);
    }
  });
});
