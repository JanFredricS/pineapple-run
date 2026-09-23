/**
 * S6T excitement audit: a feature census per level (tools/levels/census.ts),
 * derived from the TERRAIN GEOMETRY (S6T audit-1 #1: authoring labels are
 * only cross-checked, never counted), that FAILS on a boring level — a long
 * dull stretch at the level's typical speed, too few hazards or too little
 * hazard variety, an unrounded sharp crest, a label the geometry does not
 * back up, or (premade) no risk/reward shortcut (audit-1 #4). Run on the
 * three premade courses (typical speed = their pace notes) and on endless
 * terrain at three depths (typical speed 7 m/s).
 */
import { describe, expect, it } from 'vitest';
import type { LevelDef } from '../../src/model/level';
import { plateauRange } from '../../src/game/startArea';
import { blockDifficulty, generateLevel, type FeatureInstance } from '../../src/terrain/generator';
import { auditLevel, census, ENDLESS_RULES, PREMADE_RULES, type Census, type CensusLabel } from '../../tools/levels/census';
import { PREMADE } from '../../tools/levels/premade';
import { Track, type AuthoredLevel } from '../../tools/levels/track';
import { targetSpeed } from '../integration/driver';

const ids = ['beach', 'kitchen', 'workbench'] as const;

const washboards = (fs: readonly CensusLabel[]) => fs.filter((f) => f.kind === 'washboard');

function premadeCensus(a: AuthoredLevel, labels: readonly CensusLabel[] = a.features): Census {
  return census(a.level, { x0: plateauRange(a.level.cartStart).maxX, x1: a.level.goal.lineX }, (x) => targetSpeed(a.pace, x), { labels, keepSharp: washboards(a.features) });
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
    const c = census(level, { x0: 35, x1: 50 }, () => 7);
    expect(auditLevel(c, ENDLESS_RULES).some((f) => f.startsWith('sharp crest'))).toBe(true);
  });

  it('audit-1 #1: fails a mislabeled-but-flat level (labels cannot add hazards or hide a dull stretch)', () => {
    const t = new Track(0, 10);
    // flat road with every hazard kind LABELLED on it, and nothing built
    t.speed(7).flat(16, 'plateau').flat(20);
    for (const kind of ['crest', 'launchLip', 'kicker', 'drop', 'washboard', 'steps', 'gap'] as const) t.flat(20, kind);
    t.flat(20).finish();
    const a = t.build({ id: 'liar', name: 'Liar', theme: 'beach' });
    const c = premadeCensus(a);
    expect(c.hazardCount).toBe(0);
    expect(c.shortcuts).toEqual([]);
    expect(c.longestDullSeconds).toBeGreaterThan(20);
    const fails = auditLevel(c, PREMADE_RULES);
    expect(fails.filter((f) => f.startsWith('unconfirmed label'))).toHaveLength(7);
    expect(fails.some((f) => f.startsWith('dull stretch'))).toBe(true);
    expect(fails.some((f) => f.includes('hazard kinds'))).toBe(true);
    expect(fails.some((f) => f.includes('risk/reward shortcuts'))).toBe(true);
    // the audit-1 case exactly: a flat section labelled 'crest' is not confirmed
    const flatCrest = new Track(0, 10);
    flatCrest.speed(7).flat(16, 'plateau').ease(20, -3.5, 'ramp').flat(5, 'crest').flat(20).finish();
    expect(premadeCensus(flatCrest.build({ id: 'fc', name: 'FC', theme: 'beach' })).unconfirmedLabels).toEqual([expect.stringMatching(/^crest@/)]);
  });

  it('audit-1 #1: labels never change the count; a label of the wrong kind is not confirmed', () => {
    for (const id of ids) {
      const a = PREMADE[id]();
      const withLabels = premadeCensus(a);
      const without = premadeCensus(a, []);
      expect(without.hazards).toEqual(withLabels.hazards);
      expect(without.longestDullSeconds).toBe(withLabels.longestDullSeconds);
      expect(without.shortcuts).toEqual(withLabels.shortcuts);
    }
    // a washboard label on beach's first launch lip (a real hazard of another kind)
    const b = PREMADE.beach();
    const lip = premadeCensus(b).detected.find((h) => h.kind === 'launchLip')!;
    const c = premadeCensus(b, [{ kind: 'washboard', x0: lip.x0, x1: lip.x1 }]);
    expect(c.unconfirmedLabels).toEqual([`washboard@${lip.x0.toFixed(1)}`]);
  });

  it('audit-1 #4: a shortcut needs a continuous detour — the same jump over a GAP is mandatory, not a shortcut', () => {
    const build = (hole: boolean) => {
      const t = new Track(0, 10);
      t.speed(12).flat(16, 'plateau').flat(20);
      if (hole) t.line(3, -1.5, 'launchLip').gap(9, 1.5).ease(10, 2);
      else t.pool({ lipRun: 3, lipRise: 1.5, entryRun: 2.5, depth: 1.5, floor: (u) => u.washboard(6, 0.3, 1), climbRun: 4, rimBelowLip: 1.5, landRun: 10, landDrop: 2 });
      t.flat(20).finish();
      return premadeCensus(t.build({ id: 'sc', name: 'SC', theme: 'beach' }));
    };
    const pool = build(false);
    expect(pool.shortcuts).toHaveLength(1);
    expect(pool.shortcuts[0]!.skips).toBe('washboard');
    expect(pool.shortcuts[0]!.slowLandX).toBeLessThan(pool.shortcuts[0]!.landX);
    expect(build(true).shortcuts).toEqual([]);
  });
});

describe('excitement audit: premade courses', () => {
  const censuses = Object.fromEntries(ids.map((id) => [id, premadeCensus(PREMADE[id]())])) as Record<(typeof ids)[number], Census>;

  for (const id of ids) {
    it(`${id}: passes (no dull stretch > ${PREMADE_RULES.maxDullSeconds} s at pace speed, >= ${PREMADE_RULES.minHazardKinds} detected hazard kinds, >= ${PREMADE_RULES.minHazardsPer100m} hazards / 100 m, crests rounded, every label confirmed, >= ${PREMADE_RULES.minShortcuts} shortcut)`, () => {
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

  it('beach has its brake-here moment around 175 m (a lip into the dune face, found in the geometry)', () => {
    const b = PREMADE.beach();
    const lip = censuses.beach.detected.find((h) => (h.kind === 'launchLip' || h.kind === 'kicker') && h.at! > 165 && h.at! < 195);
    expect(lip).toBeDefined();
    // the pace line brakes to <= 6 m/s for it and is fast again after it
    expect(targetSpeed(b.pace, lip!.at!)).toBeLessThanOrEqual(6);
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
    const cs = runs.map((g) => census(g.level, w, () => TYPICAL_SPEED, { labels: g.features, keepSharp: washboards(g.features) }));
    const feats: FeatureInstance[] = runs.flatMap((g) => g.features.filter((f) => f.x0 >= w.x0 && f.x0 < w.x1));
    return { w, cs, feats };
  });

  for (const { w, cs } of perDepth) {
    it(`${w.name} (${w.x0}–${w.x1} m): every seed passes the dull and crest rules; on average >= ${ENDLESS_RULES.minHazardKinds} kinds and >= ${ENDLESS_RULES.minHazardsPer100m} hazards / 100 m`, () => {
      for (const c of cs) {
        // generator labels are cross-checked across all depths below (a small tolerance)
        const fails = auditLevel({ ...c, unconfirmedLabels: [] }, { ...ENDLESS_RULES, minHazardKinds: 2, minHazardsPer100m: 0.5 });
        expect(fails, JSON.stringify(c)).toEqual([]);
      }
      const mean = (f: (c: Census) => number) => cs.reduce((s, c) => s + f(c), 0) / cs.length;
      expect(mean((c) => c.hazardKinds)).toBeGreaterThanOrEqual(ENDLESS_RULES.minHazardKinds);
      expect(mean((c) => c.hazardsPer100m)).toBeGreaterThanOrEqual(ENDLESS_RULES.minHazardsPer100m);
    });
  }

  it('the generator labels its hazards honestly: >= 99% of hazard labels are confirmed by the geometry', () => {
    const hazardLabels = perDepth.reduce((n, d) => n + d.feats.length, 0);
    const unconfirmed = perDepth.flatMap((d) => d.cs.flatMap((c) => c.unconfirmedLabels));
    // a generator crest with a wide flat top is a plateau with a drop (not a peak); a tiny kicker is no hazard
    expect(unconfirmed.length / hazardLabels, `${unconfirmed.length} of ${hazardLabels}: ${unconfirmed.join(' ')}`).toBeLessThanOrEqual(0.01); // measured: 2 of 700
  });

  it('it gets harder with depth: more gaps (in the geometry too), taller crests; the opening has short gaps and no launch lips before 120 m', () => {
    const detectedGaps = (i: number) => perDepth[i]!.cs.reduce((s, c) => s + (c.hazards.gap ?? 0), 0);
    expect(detectedGaps(2)).toBeGreaterThan(detectedGaps(0));
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
    const g0 = generateLevel(SEEDS[0]!, 1400);
    const again = census(g0.level, DEPTHS[1], () => TYPICAL_SPEED, { labels: g0.features, keepSharp: washboards(g0.features) });
    expect(again).toEqual(perDepth[1]!.cs[0]);
  });
});
