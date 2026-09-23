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
import type { Vec2 } from '../../src/model/geometry';
import type { LevelDef } from '../../src/model/level';
import { plateauRange } from '../../src/game/startArea';
import { blockDifficulty, generateLevel, type FeatureInstance } from '../../src/terrain/generator';
import { auditLevel, census, ENDLESS_RULES, PREMADE_RULES, type Census, type CensusLabel } from '../../tools/levels/census';
import { PREMADE } from '../../tools/levels/premade';
import { PIT, Track, type AuthoredLevel } from '../../tools/levels/track';
import { targetSpeed } from '../integration/driver';

const ids = ['beach', 'kitchen', 'workbench', 'tikibar'] as const;

const washboards = (fs: readonly CensusLabel[]) => fs.filter((f) => f.kind === 'washboard');

/**
 * The census window runs from the start plateau to the finish pit's lip
 * (PIT.lineAfterLip past it: the goal line on every course but Kitchen,
 * whose line sits in its long pit, K1 audit #4), and the pit edges are
 * finish geometry, kept sharp like the washboards.
 */
function premadeCensus(a: AuthoredLevel, labels: readonly CensusLabel[] = a.features): Census {
  const fin = a.features.find((f) => f.kind === 'finish');
  const x1 = fin ? Math.min(a.level.goal.lineX, fin.x0 + PIT.lineAfterLip) : a.level.goal.lineX;
  return census(a.level, { x0: plateauRange(a.level.cartStart).maxX, x1 }, (x) => targetSpeed(a.pace, x), {
    labels,
    keepSharp: [...washboards(a.features), ...(fin ? [fin] : [])],
  });
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

describe('excitement audit: minimum feature scales are measured exactly (S6T audit-2)', () => {
  // Hand-built terrain on beach's LevelDef, censused over 20–80 m. Each case
  // runs at a grid-aligned offset (0: every x a multiple of 0.25 m, the old
  // sampling grid) and at misaligned ones.
  const OFFSETS = [0, 0.1, 0.137, 0.2];
  const Y = 10;
  const levelWith = (spans: Vec2[][]): LevelDef => {
    const level: LevelDef = JSON.parse(JSON.stringify(PREMADE.beach().level));
    level.terrain.spans = spans.map((points, i) => ({ id: `t${i}`, points }));
    return level;
  };
  const censusOf = (level: LevelDef, labels: CensusLabel[] = []) => census(level, { x0: 20, x1: 80 }, () => 7, { labels });

  /** Flat ground with a hole of `w` at 40 + o; each edge has a gap wall down to killY, like Track.gap. */
  const holed = (o: number, w: number) => {
    const kill = PREMADE.beach().level.killY;
    const a = 40 + o;
    const b = a + w;
    return levelWith([
      [{ x: 0, y: Y }, { x: a, y: Y }, { x: a + 0.01, y: kill }],
      [{ x: b - 0.01, y: kill }, { x: b, y: Y }, { x: 100, y: Y }],
    ]);
  };
  for (const o of OFFSETS) {
    it(`a 0.5 m hole IS a gap, a 0.29 m hole is NOT (offset ${o})`, () => {
      const g = censusOf(holed(o, 0.5));
      expect(g.hazards).toEqual({ gap: 1 });
      expect(censusOf(holed(o, 0.29)).hazards).toEqual({});
      expect(censusOf(holed(o, 0.3)).hazards).toEqual({ gap: 1 }); // exactly the threshold counts
    });
  }

  /** A hill: up 1.5 m over 5 m, a flat top `top` wide at 40 + o, down 1.5 m over 8 m (too gentle for a lip). */
  const hill = (o: number, top: number) => {
    const a = 40 + o;
    return {
      level: levelWith([[{ x: 0, y: Y }, { x: a - 5, y: Y }, { x: a, y: Y - 1.5 }, { x: a + top, y: Y - 1.5 }, { x: a + top + 8, y: Y }, { x: 100, y: Y }]]),
      label: { kind: 'crest', x0: a - 5, x1: a + top + 8 },
    };
  };
  for (const o of OFFSETS) {
    it(`a 1.95 m hilltop IS a crest; a 2.05 m one is NOT, and cannot confirm a crest label (offset ${o})`, () => {
      const narrow = hill(o, 1.95);
      const n = censusOf(narrow.level, [narrow.label]);
      expect(n.hazards).toEqual({ crest: 1 });
      expect(n.unconfirmedLabels).toEqual([]);
      const wide = hill(o, 2.05);
      const w = censusOf(wide.level, [wide.label]);
      expect(w.hazards).toEqual({});
      expect(w.unconfirmedLabels).toEqual([`crest@${wide.label.x0.toFixed(1)}`]);
      // and the flat top cannot hide a dull stretch either: nothing detected overlaps it
      expect(w.detected).toEqual([]);
    });
  }

  /** Six teeth of height `h` (1 m pitch, 0.5 m up, 0.5 m down) starting at 40 + o. */
  const teeth = (o: number, h: number) => {
    const pts: Vec2[] = [{ x: 0, y: Y }];
    for (let i = 0; i < 6; i++) pts.push({ x: 40 + o + i, y: Y }, { x: 40.5 + o + i, y: Y - h });
    pts.push({ x: 46 + o, y: Y }, { x: 100, y: Y });
    return levelWith([pts]);
  };
  for (const o of OFFSETS) {
    it(`0.12 m teeth make a washboard, 0.11 m teeth do not (offset ${o})`, () => {
      expect(censusOf(teeth(o, 0.12)).hazards).toEqual({ washboard: 1 });
      expect(censusOf(teeth(o, 0.11)).hazards).toEqual({});
    });
  }
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

  // K1 (TUNING.md "K1: Kitchen difficulty"): pinned counts. Before K1:
  // 12 hazards, 6 kinds (drop 2, gap 3, washboard 2, launchLip 3, steps 1,
  // crest 1), 6.45 / 100 m, worst dull stretch 1.94 s, widest gap 3 m.
  it('K1 kitchen: the census finds the 5.5 m sink and the slab bumps in the geometry; counts pinned; no duller than before', () => {
    const k = censuses.kitchen;
    expect(k.hazards).toEqual({ crest: 2, drop: 1, launchLip: 7, gap: 3, washboard: 2, steps: 1, kicker: 1 });
    expect(k.hazardCount).toBe(17);
    expect(k.hazardKinds).toBe(7);
    expect(k.hazardsPer100m).toBeCloseTo(8.26, 2);
    // the sink: exactly one detected gap at least 5.5 m wide, where the authored sink is
    const sink = PREMADE.kitchen().features.filter((f) => f.kind === 'gap').reduce((a, b) => (b.x1 - b.x0 > a.x1 - a.x0 ? b : a));
    const wide = k.detected.filter((h) => h.kind === 'gap' && h.x1 - h.x0 >= 5.5);
    expect(wide).toHaveLength(1);
    expect(wide[0]!.x0).toBeLessThanOrEqual(sink.x0);
    expect(wide[0]!.x1).toBeGreaterThanOrEqual(sink.x1);
    // K1 audit #6: its detected bounds (measured 82.29-89.79 m: the hole 83.29-88.79 plus the census's edge margins)
    expect(wide[0]!.x0).toBeCloseTo(82.29, 1);
    expect(wide[0]!.x1).toBeCloseTo(89.79, 1);
    // the sharpest crest is at the rounding cap (the rules limit), and the dull stretch pinned (measured 1.08 s)
    expect(k.sharpestCrest).toBeLessThanOrEqual(PREMADE_RULES.maxCrest + 1e-9);
    expect(k.longestDullSeconds).toBeLessThanOrEqual(1.2);
    // the slab fields (16-40 m, 117-123 m, 128-163 m, 201-216 m) show up as bumps: 10 crests / lips / kickers (was 4)
    const bumps = k.detected.filter((h) => h.kind === 'crest' || h.kind === 'launchLip' || h.kind === 'kicker');
    expect(bumps).toHaveLength(10);
    for (const [x0, x1] of [[16, 40], [128, 164]] as const) expect(bumps.filter((h) => h.x0 < x1 && h.x1 > x0).length, `slabs ${x0}-${x1} m`).toBeGreaterThanOrEqual(2);
    // the worst dull stretch stays inside the rule, and below its pre-K1 1.94 s
    expect(k.longestDullSeconds).toBeLessThanOrEqual(PREMADE_RULES.maxDullSeconds);
    expect(k.longestDullSeconds).toBeLessThan(1.94);
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

  it('the generator labels its hazards honestly: every hazard label is confirmed by the geometry', () => {
    const hazardLabels = perDepth.reduce((n, d) => n + d.feats.length, 0);
    const unconfirmed = perDepth.flatMap((d) => d.cs.flatMap((c) => c.unconfirmedLabels));
    // exact-surface census (audit-2): all labels confirm; the total pins the sampled label population
    expect(hazardLabels).toBe(843);
    expect(unconfirmed, `${unconfirmed.length} of ${hazardLabels}`).toEqual([]);
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
