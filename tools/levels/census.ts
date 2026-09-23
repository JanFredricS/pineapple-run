/**
 * Excitement audit (S6T): a per-level FEATURE CENSUS and the rules a level
 * must meet to not be boring. Pure; used by test/levels/excitement.test.ts
 * on the premade levels (tagged Track features) and on endless terrain at
 * several depths (generator FeatureInstances).
 *
 * What the census measures, over the driving range [x0, x1]:
 *   - hazards: the tagged features that make the player do something
 *     (HAZARD_KINDS), counted per kind, per 100 m, and as distinct kinds;
 *   - the longest DULL stretch: consecutive 0.5 m samples where the next
 *     DULL_WINDOW metres of ground is locally straight (within
 *     DULL_STRAIGHTNESS of its chord), gentle (|chord slope| <
 *     DULL_MAX_SLOPE), has no hole, and no hazard overlaps it. Reported in
 *     metres and in SECONDS at the level's typical speed (a flat 60 m at
 *     12 m/s is 5 s of nothing to do);
 *   - the sharpest crest left (slope jump at a convex vertex), outside the
 *     washboard teeth and the goal pit (S6T #10 rounds the rest).
 *
 * auditLevel() turns a census into a list of human-readable failures.
 */

import type { Vec2 } from '../../src/model/geometry';
import type { LevelDef } from '../../src/model/level';
import { sharpestCrest } from '../../src/terrain/rounding';

export const HAZARD_KINDS = ['crest', 'drop', 'launchLip', 'washboard', 'kicker', 'gap', 'steps'] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];

export const DULL_WINDOW = 4;
export const DULL_STRAIGHTNESS = 0.2;
export const DULL_MAX_SLOPE = 0.25;
const STEP = 0.5;

export interface CensusFeature {
  kind: string;
  x0: number;
  x1: number;
}

export interface Census {
  length: number;
  hazards: Partial<Record<HazardKind, number>>;
  hazardCount: number;
  hazardKinds: number;
  hazardsPer100m: number;
  longestDullMetres: number;
  longestDullAt: number;
  longestDullSeconds: number;
  sharpestCrest: number;
}

export interface AuditRules {
  /** Longest dull stretch allowed, seconds at the typical speed. */
  maxDullSeconds: number;
  minHazardKinds: number;
  minHazardsPer100m: number;
  /** Sharpest crest allowed (slope jump); rounded levels stay <= 0.6. */
  maxCrest: number;
}

/** Brief S6T: a > 20 s flat stretch at typical speed is boring. */
export const ENDLESS_RULES: AuditRules = { maxDullSeconds: 20, minHazardKinds: 3, minHazardsPer100m: 1.2, maxCrest: 0.6 };
/** Handmade courses are held to more: never more than a few seconds of nothing. */
export const PREMADE_RULES: AuditRules = { maxDullSeconds: 6, minHazardKinds: 5, minHazardsPer100m: 3, maxCrest: 0.6 };

/** Topmost ground (min y) at x over all spans, ignoring gap side walls (points at/below killY); null over a hole. */
export function surfaceAt(level: LevelDef, x: number): number | null {
  let best: number | null = null;
  for (const s of level.terrain.spans) {
    const pts = s.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      if (a.y >= level.killY - 1e-9 || b.y >= level.killY - 1e-9) continue;
      if (x < a.x || x > b.x || b.x === a.x) continue;
      const y = a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
      if (best === null || y < best) best = y;
    }
  }
  return best;
}

function windowIsDull(level: LevelDef, x: number): boolean {
  const ys: number[] = [];
  for (let u = 0; u <= DULL_WINDOW + 1e-9; u += STEP) {
    const y = surfaceAt(level, x + u);
    if (y === null) return false;
    ys.push(y);
  }
  const y0 = ys[0]!;
  const y1 = ys[ys.length - 1]!;
  const slope = (y1 - y0) / DULL_WINDOW;
  if (Math.abs(slope) >= DULL_MAX_SLOPE) return false;
  return ys.every((y, i) => Math.abs(y - (y0 + slope * i * STEP)) <= DULL_STRAIGHTNESS);
}

/**
 * Census of `level` over [x0, x1]. `speedAt(x)` = typical speed (m/s) there
 * (the pace notes of a premade course, a constant for endless).
 */
export function census(
  level: LevelDef,
  features: readonly CensusFeature[],
  range: { x0: number; x1: number },
  speedAt: (x: number) => number,
): Census {
  const hz = features.filter((f) => (HAZARD_KINDS as readonly string[]).includes(f.kind) && f.x1 > range.x0 && f.x0 < range.x1);
  const hazards: Partial<Record<HazardKind, number>> = {};
  for (const f of hz) hazards[f.kind as HazardKind] = (hazards[f.kind as HazardKind] ?? 0) + 1;
  const length = range.x1 - range.x0;

  let run = 0;
  let runStart = range.x0;
  let runSeconds = 0;
  let best = { metres: 0, at: range.x0, seconds: 0 };
  for (let x = range.x0; x < range.x1 - DULL_WINDOW; x += STEP) {
    const inHazard = hz.some((f) => f.x0 < x + DULL_WINDOW && f.x1 > x);
    if (!inHazard && windowIsDull(level, x)) {
      if (run === 0) runStart = x;
      run += STEP;
      runSeconds += STEP / Math.max(0.5, speedAt(x));
      if (runSeconds > best.seconds) best = { metres: run, at: runStart, seconds: runSeconds };
    } else {
      run = 0;
      runSeconds = 0;
    }
  }

  const sharpRanges = features.filter((f) => f.kind === 'washboard' || f.kind === 'finish');
  const keep = (p: Vec2) => sharpRanges.some((f) => p.x >= f.x0 - 1e-6 && p.x <= f.x1 + 1e-6) || p.x >= level.goal.lineX - 1;
  let crest = 0;
  for (const s of level.terrain.spans) {
    // driving surface only: gap side walls (down to killY) are not ground
    const pts = s.points.filter((p) => p.x >= range.x0 && p.x <= range.x1 && p.y < level.killY - 1e-9);
    crest = Math.max(crest, sharpestCrest(pts, keep));
  }

  return {
    length,
    hazards,
    hazardCount: hz.length,
    hazardKinds: Object.keys(hazards).length,
    hazardsPer100m: (hz.length * 100) / length,
    longestDullMetres: best.metres,
    longestDullAt: best.at,
    longestDullSeconds: best.seconds,
    sharpestCrest: crest,
  };
}

export function auditLevel(c: Census, rules: AuditRules): string[] {
  const out: string[] = [];
  if (c.longestDullSeconds > rules.maxDullSeconds) {
    out.push(`dull stretch of ${c.longestDullMetres.toFixed(1)} m at x ${c.longestDullAt.toFixed(1)} (${c.longestDullSeconds.toFixed(1)} s > ${rules.maxDullSeconds} s)`);
  }
  if (c.hazardKinds < rules.minHazardKinds) out.push(`only ${c.hazardKinds} hazard kinds (< ${rules.minHazardKinds})`);
  if (c.hazardsPer100m < rules.minHazardsPer100m) out.push(`only ${c.hazardsPer100m.toFixed(2)} hazards / 100 m (< ${rules.minHazardsPer100m})`);
  if (c.sharpestCrest > rules.maxCrest + 1e-9) out.push(`sharp crest: slope jump ${c.sharpestCrest.toFixed(2)} (> ${rules.maxCrest})`);
  return out;
}
