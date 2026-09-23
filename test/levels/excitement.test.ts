/**
 * S6T excitement audit: a feature census per level (tools/levels/census.ts)
 * that FAILS on a boring level — a long dull stretch at the level's typical
 * speed, too few hazards or too little hazard variety, or an unrounded
 * sharp crest. Run on the three premade courses (typical speed = their pace
 * notes) and on endless terrain at three depths (typical speed 7 m/s).
 */
import { describe, expect, it } from 'vitest';
import type { LevelDef } from '../../src/model/level';
import { plateauRange } from '../../src/game/startArea';
import { blockDifficulty, generateLevel, type FeatureInstance } from '../../src/terrain/generator';
import { auditLevel, census, ENDLESS_RULES, PREMADE_RULES, type Census } from '../../tools/levels/census';
import { PREMADE } from '../../tools/levels/premade';
import { Track, type AuthoredLevel } from '../../tools/levels/track';
import { targetSpeed } from '../integration/driver';

const ids = ['beach', 'kitchen', 'workbench'] as const;

function premadeCensus(a: AuthoredLevel): Census {
  return census(a.level, a.features, { x0: plateauRange(a.level.cartStart).maxX, x1: a.level.goal.lineX }, (x) => targetSpeed(a.pace, x));
}

describe('excitement audit: the auditor itself', () => {
  it('fails a boring level: a long gentle road with one bump', () => {
    const t = new Track(0, 10);
    t.speed(7).flat(16, 'plateau').ease(60, 1.5).flat(120).kicker(2, 0.4, 2, 0.4).ease(60, -1).flat(20).finish();
    const c = premadeCensus(t.build({ id: 'boring', name: 'Boring', theme: 'beach' }));
    const fails = auditLevel(c, PREMADE_RULES);
    expect(c.longestDullSeconds).toBeGreaterThan(20); // also boring by the endless (20 s) rule
    expect(fails.some((f) => f.startsWith('dull stretch'))).toBe(true);
    expect(fails.some((f) => f.includes('hazard kinds'))).toBe(true);
    expect(fails.some((f) => f.includes('hazards / 100 m'))).toBe(true);
  });

  it('fails an unrounded sharp crest', () => {
    const level: LevelDef = JSON.parse(JSON.stringify(PREMADE.beach().level));
    level.terrain.spans.push({ id: 'spike', points: [{ x: 40, y: 2 }, { x: 43, y: 0 }, { x: 46, y: 2 }] });
    const c = census(level, [], { x0: 35, x1: 50 }, () => 7);
    expect(auditLevel(c, ENDLESS_RULES).some((f) => f.startsWith('sharp crest'))).toBe(true);
  });
});

describe('excitement audit: premade courses', () => {
  const censuses = Object.fromEntries(ids.map((id) => [id, premadeCensus(PREMADE[id]())])) as Record<(typeof ids)[number], Census>;

  for (const id of ids) {
    it(`${id}: passes (no dull stretch > ${PREMADE_RULES.maxDullSeconds} s at pace speed, >= ${PREMADE_RULES.minHazardKinds} hazard kinds, >= ${PREMADE_RULES.minHazardsPer100m} hazards / 100 m, crests rounded)`, () => {
      expect(auditLevel(censuses[id], PREMADE_RULES), JSON.stringify(censuses[id])).toEqual([]);
    });
  }

  it('beach stays the easiest: no gaps, the fewest hazards per 100 m, the softest washboard', () => {
    expect(censuses.beach.hazards.gap ?? 0).toBe(0);
    expect(censuses.beach.hazardsPer100m).toBeLessThan(censuses.kitchen.hazardsPer100m);
    expect(censuses.beach.hazardsPer100m).toBeLessThan(censuses.workbench.hazardsPer100m);
    // washboard tooth height: beach 0.3 m (was 0.5) vs workbench's 0.5 m rasp
    const tooth = (a: AuthoredLevel) => {
      const wb = a.features.find((f) => f.kind === 'washboard')!;
      const ys = a.level.terrain.spans.flatMap((s) => s.points.filter((p) => p.x >= wb.x0 && p.x <= wb.x1).map((p) => p.y));
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(tooth(PREMADE.beach())).toBeCloseTo(0.3, 6);
    expect(tooth(PREMADE.beach())).toBeLessThan(tooth(PREMADE.workbench()));
  });

  it('beach has its brake-here moment around 180 m (a launch lip into the dune face)', () => {
    const b = PREMADE.beach();
    const lip = b.features.find((f) => f.kind === 'launchLip' && f.x0 > 165 && f.x0 < 195);
    expect(lip).toBeDefined();
    // the pace line brakes to <= 6 m/s for it and is fast again after it
    expect(targetSpeed(b.pace, lip!.x0)).toBeLessThanOrEqual(6);
    expect(targetSpeed(b.pace, lip!.x1 + 12)).toBeGreaterThan(10);
  });
});

describe('excitement audit: endless at three depths', () => {
  // Windows of 8 blocks; d ≈ 0.04–0.38, 0.375–0.71, and 1 (full difficulty).
  const DEPTHS = [
    { name: 'opening', x0: 80, x1: 400 },
    { name: 'middle', x0: 400, x1: 720 },
    { name: 'deep', x0: 1000, x1: 1320 },
  ] as const;
  const SEEDS = Array.from({ length: 40 }, (_, i) => `audit-${i}`);
  const TYPICAL_SPEED = 7;
  const runs = SEEDS.map((seed) => generateLevel(seed, 1400));

  const perDepth = DEPTHS.map((w) => {
    const cs = runs.map((g) => census(g.level, g.features, w, () => TYPICAL_SPEED));
    const feats: FeatureInstance[] = runs.flatMap((g) => g.features.filter((f) => f.x0 >= w.x0 && f.x0 < w.x1));
    return { w, cs, feats };
  });

  for (const { w, cs } of perDepth) {
    it(`${w.name} (${w.x0}–${w.x1} m): every seed passes the dull and crest rules; on average >= ${ENDLESS_RULES.minHazardKinds} kinds and >= ${ENDLESS_RULES.minHazardsPer100m} hazards / 100 m`, () => {
      for (const c of cs) {
        const fails = auditLevel(c, { ...ENDLESS_RULES, minHazardKinds: 2, minHazardsPer100m: 0.5 });
        expect(fails, JSON.stringify(c)).toEqual([]);
      }
      const mean = (f: (c: Census) => number) => cs.reduce((s, c) => s + f(c), 0) / cs.length;
      expect(mean((c) => c.hazardKinds)).toBeGreaterThanOrEqual(ENDLESS_RULES.minHazardKinds);
      expect(mean((c) => c.hazardsPer100m)).toBeGreaterThanOrEqual(ENDLESS_RULES.minHazardsPer100m);
    });
  }

  it('it gets harder with depth: more gaps, taller crests; the opening has short gaps and no launch lips before 120 m', () => {
    const rate = (i: number, kind: string) => perDepth[i]!.feats.filter((f) => f.kind === kind).length / perDepth[i]!.feats.length;
    const crest = (i: number) => {
      const c = perDepth[i]!.feats.filter((f) => f.kind === 'crest');
      return c.reduce((s, f) => s + f.params.height!, 0) / c.length;
    };
    expect(rate(2, 'gap')).toBeGreaterThan(rate(0, 'gap'));
    expect(crest(2)).toBeGreaterThan(crest(1));
    expect(crest(1)).toBeGreaterThan(crest(0));
    const opening = perDepth[0]!.feats;
    expect(opening.some((f) => f.kind === 'gap')).toBe(true);
    expect(opening.filter((f) => f.kind === 'launchLip').every((f) => f.x0 >= 120)).toBe(true);
    for (const f of opening.filter((g) => g.kind === 'gap' && blockDifficulty(g.block) < 0.3)) expect(f.gapX1! - f.gapX0!).toBeLessThanOrEqual(1.5 + 1e-9);
    // deterministic: the same seed audits identically
    const again = census(generateLevel(SEEDS[0]!, 1400).level, runs[0]!.features, DEPTHS[1], () => TYPICAL_SPEED);
    expect(again).toEqual(perDepth[1]!.cs[0]);
  });
});
