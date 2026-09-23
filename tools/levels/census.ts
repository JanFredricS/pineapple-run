/**
 * Excitement audit (S6T): a per-level FEATURE CENSUS derived from the
 * TERRAIN GEOMETRY, and the rules a level must meet to not be boring. Pure;
 * used by test/levels/excitement.test.ts on the premade levels and on
 * endless terrain at several depths.
 *
 * S6T audit-1 #1: hazards are DETECTED from the driving surface, never taken
 * from authoring metadata. Authored labels (Track features, generator
 * FeatureInstances) may be passed in only as annotations: every authored
 * hazard label must be confirmed by a detected hazard of a compatible kind
 * (see `confirms`) overlapping it, or the audit fails ("unconfirmed
 * label"). A mislabeled flat stretch can neither add hazards nor hide a
 * dull stretch; the census is identical with or without labels.
 *
 * The driving surface is the topmost terrain at x (gap side walls, which go
 * down to killY, are not ground), sampled every STEP metres; a hole is where
 * there is no ground. Detected hazard kinds (HAZARD_KINDS):
 *
 *   gap       — a hole at least GAP_MIN_WIDTH wide.
 *   washboard — at least WASHBOARD_MIN_TEETH teeth (peaks standing
 *               TOOTH_MIN_HEIGHT above the ground within TOOTH_REACH on both
 *               sides), each within WASHBOARD_MAX_PITCH of the last.
 *   A PEAK is a local top (highest within ±1 m) no wider than
 *   PEAK_MAX_TOP: a wider flat top is a plateau, whose edges can only be
 *   drops (so a ramp, a flat 5 m and a descent is NOT a crest).
 *   launchLip — a peak reached by a rising approach (mean slope over the
 *               last LIP_APPROACH m before its far edge >=
 *               LIP_MIN_APPROACH_SLOPE, rise >= 0.3 m within 3 m) that falls
 *               away abruptly (>= LIP_MIN_FALL within 2 m, or a hole),
 *               landing LOWER than the take-off: the fall within 4 m exceeds
 *               the rise by >= 0.3 m.
 *   kicker    — the same abrupt lip, landing about level (fall < rise + 0.3).
 *   crest     — any other peak with >= CREST_MIN_PROMINENCE of ground below
 *               it within CREST_REACH on both sides (a hill); overlapping
 *               crest peaks count once.
 *   drop      — a steep descent (every STEP falls at slope >= DROP_MIN_SLOPE)
 *               totalling >= DROP_MIN_HEIGHT, not part of a lip or a gap.
 *   steps     — >= 2 risers (0.25–1.2 m of height at slope >= 1 over
 *               <= 0.75 m) in the same direction, separated by 1–6 m treads.
 *
 * SHORTCUT (S6T audit-1 #4, PLAN "risk/reward shortcut"): an OPTIONAL faster
 * route. Detected at a launchLip/kicker: a point projectile leaving the lip
 * along its approach at SHORTCUT_FAST_SPEED lands at least SHORTCUT_MIN_SKIP
 * metres on, over CONTINUOUS ground (no hole, so the slow route exists) that
 * dips at least SHORTCUT_MIN_DEPTH below both the take-off and the landing,
 * and a slow hazard (washboard or steps) lies wholly under the flight: the
 * jump skips it. At SHORTCUT_SLOW_SPEED the projectile lands before the
 * dip's deepest point, so a careful cart rolls through the dip instead. The
 * pace driver proves the jump is really faster and the detour really viable
 * (test/integration/acceptance.test.ts).
 *
 * Also measured over [x0, x1]:
 *   - the longest DULL stretch: consecutive 0.5 m samples where the next
 *     DULL_WINDOW metres of ground is locally straight (within
 *     DULL_STRAIGHTNESS of its chord), gentle (|chord slope| <
 *     DULL_MAX_SLOPE), has no hole, and no DETECTED hazard overlaps it;
 *     in metres and in SECONDS at the level's typical speed;
 *   - the sharpest crest left (slope jump at a convex vertex), outside the
 *     `keepSharp` ranges (washboard teeth) and the goal pit.
 */

import type { Vec2 } from '../../src/model/geometry';
import type { LevelDef } from '../../src/model/level';
import { sharpestCrest } from '../../src/terrain/rounding';

export const HAZARD_KINDS = ['crest', 'drop', 'launchLip', 'washboard', 'kicker', 'gap', 'steps'] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];

export const STEP = 0.25;
export const GAP_MIN_WIDTH = 0.3;
export const TOOTH_REACH = 0.75;
export const TOOTH_MIN_HEIGHT = 0.12;
export const WASHBOARD_MIN_TEETH = 4;
export const WASHBOARD_MAX_PITCH = 2;
export const LIP_APPROACH = 1.5;
export const LIP_MIN_APPROACH_SLOPE = 0.15;
export const LIP_MIN_FALL = 0.5;
export const CREST_REACH = 8;
/** A lip or crest top wider than this is a plateau (a flat ledge), not a peak the cart goes OVER. */
export const PEAK_MAX_TOP = 2;
export const CREST_MIN_PROMINENCE = 0.8;
export const DROP_MIN_SLOPE = 0.5;
export const DROP_MIN_HEIGHT = 0.8;
export const SHORTCUT_FAST_SPEED = 13;
export const SHORTCUT_SLOW_SPEED = 6;
export const SHORTCUT_MIN_SKIP = 8;
export const SHORTCUT_MIN_DEPTH = 1;
/** World gravity (physics/engine.ts default), m/s². */
const GRAVITY = 10;

export const DULL_WINDOW = 4;
export const DULL_STRAIGHTNESS = 0.2;
export const DULL_MAX_SLOPE = 0.25;

export interface Hazard {
  kind: HazardKind;
  x0: number;
  x1: number;
  /** The peak x for lips, kickers and crests. */
  at?: number;
}

export interface Shortcut {
  /** Take-off (lip) x. */
  lipX: number;
  /** Where the fast projectile lands. */
  landX: number;
  /** Where the slow projectile lands. */
  slowLandX: number;
  /** Ground below the flight, under the lower of take-off / landing (m). */
  depth: number;
  /** The slow hazard the jump skips. */
  skips: HazardKind;
}

/** An authored label (Track Feature / generator FeatureInstance): an annotation only. */
export interface CensusLabel {
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
  detected: Hazard[];
  shortcuts: Shortcut[];
  /** Authored hazard labels that no detected hazard confirms ("kind@x0"). */
  unconfirmedLabels: string[];
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
  /** Risk/reward shortcuts required. */
  minShortcuts: number;
}

/** Brief S6T: a > 20 s flat stretch at typical speed is boring. Endless has no authored shortcuts. */
export const ENDLESS_RULES: AuditRules = { maxDullSeconds: 20, minHazardKinds: 3, minHazardsPer100m: 1.2, maxCrest: 0.6, minShortcuts: 0 };
/** Handmade courses are held to more: never more than a few seconds of nothing, and a shortcut (PLAN S6). */
export const PREMADE_RULES: AuditRules = { maxDullSeconds: 6, minHazardKinds: 5, minHazardsPer100m: 3, maxCrest: 0.6, minShortcuts: 1 };

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

/** The sampled driving surface. */
class Profile {
  readonly xs: number[] = [];
  readonly ys: (number | null)[] = [];
  constructor(
    readonly level: LevelDef,
    readonly x0: number,
    readonly x1: number,
  ) {
    const n = Math.floor((x1 - x0) / STEP + 1e-9);
    for (let i = 0; i <= n; i++) {
      const x = x0 + i * STEP;
      this.xs.push(x);
      this.ys.push(surfaceAt(level, x));
    }
  }
  get n(): number {
    return this.xs.length;
  }
  y(i: number): number | null {
    return i >= 0 && i < this.n ? this.ys[i]! : null;
  }
  x(i: number): number {
    return this.xs[Math.max(0, Math.min(this.n - 1, i))]!;
  }
  /** Lowest ground (max y) over sample indices [a, b]; Infinity if any is a hole. */
  lowest(a: number, b: number): number {
    let m = -Infinity;
    for (let j = Math.max(0, a); j <= Math.min(this.n - 1, b); j++) {
      const y = this.ys[j]!;
      if (y === null) return Infinity;
      m = Math.max(m, y);
    }
    return m;
  }
  /** Same, ignoring holes (for the ground BEFORE a peak). */
  lowestSolid(a: number, b: number): number {
    let m = -Infinity;
    for (let j = Math.max(0, a); j <= Math.min(this.n - 1, b); j++) {
      const y = this.ys[j]!;
      if (y !== null) m = Math.max(m, y);
    }
    return m;
  }
  idx(x: number): number {
    return Math.round((x - this.x0) / STEP);
  }
}

const samples = (m: number) => Math.round(m / STEP);

interface Peak {
  ia: number;
  ib: number;
  y: number;
}

/** Local highest points (min y within ±1 m); plateaus collapse into one region [ia, ib]. */
function peaks(p: Profile): Peak[] {
  const out: Peak[] = [];
  const r = samples(1);
  let cur: Peak | null = null;
  for (let i = 0; i < p.n; i++) {
    const y = p.y(i);
    if (y === null) continue;
    let isPeak = true;
    for (let j = i - r; j <= i + r && isPeak; j++) {
      const q = p.y(j);
      if (q !== null && q < y - 1e-6) isPeak = false;
    }
    if (!isPeak) continue;
    if (cur && i - cur.ib <= 2) {
      cur.ib = i;
      cur.y = Math.min(cur.y, y);
    } else {
      if (cur) out.push(cur);
      cur = { ia: i, ib: i, y };
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Maximal runs of consecutive steps whose drop per step satisfies `ok(dy / STEP)`. */
function runs(p: Profile, ok: (slope: number, first: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < p.n; i++) {
    const a = p.y(i);
    const b = p.y(i + 1);
    if (a === null || b === null) continue;
    const first = (b - a) / STEP;
    if (!ok(first, first)) continue;
    let j = i + 1;
    for (;;) {
      const c = p.y(j);
      const d = p.y(j + 1);
      if (c === null || d === null || !ok((d - c) / STEP, first)) break;
      j++;
    }
    out.push([i, j]);
    i = j;
  }
  return out;
}

function detect(p: Profile): Hazard[] {
  const out: Hazard[] = [];

  // gaps
  for (let i = 0; i < p.n; i++) {
    if (p.y(i) !== null) continue;
    let j = i;
    while (j + 1 < p.n && p.y(j + 1) === null) j++;
    if ((j - i + 1) * STEP >= GAP_MIN_WIDTH) out.push({ kind: 'gap', x0: p.x(i) - 1, x1: p.x(j) + 1 });
    i = j;
  }

  // washboards: runs of teeth
  const pk = peaks(p);
  const isTooth = (q: Peak) =>
    (q.ib - q.ia) * STEP <= 0.5 &&
    p.lowestSolid(q.ia - samples(TOOTH_REACH), q.ia) - q.y >= TOOTH_MIN_HEIGHT &&
    p.lowest(q.ib, q.ib + samples(TOOTH_REACH)) - q.y >= TOOTH_MIN_HEIGHT;
  const teeth = pk.filter(isTooth);
  const inBoard = new Set<Peak>();
  for (let i = 0; i < teeth.length; ) {
    let j = i;
    while (j + 1 < teeth.length && (teeth[j + 1]!.ia - teeth[j]!.ib) * STEP <= WASHBOARD_MAX_PITCH) j++;
    if (j - i + 1 >= WASHBOARD_MIN_TEETH) {
      for (let t = i; t <= j; t++) inBoard.add(teeth[t]!);
      out.push({ kind: 'washboard', x0: p.x(teeth[i]!.ia) - 0.75, x1: p.x(teeth[j]!.ib) + 0.75 });
    }
    i = j + 1;
  }

  // lips, kickers, crests
  const lipRanges: [number, number][] = [];
  for (const q of pk) {
    if (inBoard.has(q)) continue;
    if ((q.ib - q.ia) * STEP > PEAK_MAX_TOP) continue; // a plateau: its edges are drops
    // the approach is measured where the cart leaves the top (its far edge)
    const approach = p.y(q.ib - samples(LIP_APPROACH));
    const approachSlope = approach === null ? 0 : (approach - q.y) / LIP_APPROACH;
    const rise3 = p.lowestSolid(q.ib - samples(3), q.ib) - q.y;
    const fallQuick = p.lowest(q.ib, q.ib + samples(2)) - q.y;
    const fall4 = p.lowest(q.ib, q.ib + samples(4)) - q.y;
    const at = (p.x(q.ia) + p.x(q.ib)) / 2;
    if (approachSlope >= LIP_MIN_APPROACH_SLOPE && rise3 >= 0.3 && fallQuick >= LIP_MIN_FALL) {
      const kind: HazardKind = fall4 >= rise3 + 0.3 ? 'launchLip' : 'kicker';
      out.push({ kind, x0: p.x(q.ia) - 3, x1: p.x(q.ib) + 3, at });
      lipRanges.push([p.x(q.ia) - 3, p.x(q.ib) + 3]);
      continue;
    }
    const riseBefore = p.lowestSolid(q.ia - samples(CREST_REACH), q.ia) - q.y;
    const fallAfter = p.lowestSolid(q.ib, q.ib + samples(CREST_REACH)) - q.y;
    const prev = out[out.length - 1];
    if (prev?.kind === 'crest' && prev.x1 > p.x(q.ia)) continue; // the same hill
    if (riseBefore >= CREST_MIN_PROMINENCE && fallAfter >= CREST_MIN_PROMINENCE) out.push({ kind: 'crest', x0: p.x(q.ia) - 4, x1: p.x(q.ib) + 4, at });
  }

  // drops: steep descending runs, not a lip's fall and not into a gap
  const gapRanges = out.filter((h) => h.kind === 'gap').map((h) => [h.x0, h.x1] as [number, number]);
  const overlaps = (a: number, b: number, rs: readonly [number, number][]) => rs.some(([c, d]) => c < b && d > a);
  for (const [i, j] of runs(p, (s) => s >= DROP_MIN_SLOPE)) {
    const h = p.y(j)! - p.y(i)!;
    if (h >= DROP_MIN_HEIGHT && !overlaps(p.x(i), p.x(j), lipRanges) && !overlaps(p.x(i), p.x(j), gapRanges)) out.push({ kind: 'drop', x0: p.x(i) - 1, x1: p.x(j) + 1 });
  }

  // steps: >= 2 same-direction risers
  const risers: { x: number; end: number; dir: number }[] = [];
  for (const [i, j] of runs(p, (s, first) => Math.abs(s) >= 1 && Math.sign(s) === Math.sign(first))) {
    const h = Math.abs(p.y(j)! - p.y(i)!);
    if (h >= 0.25 && h <= 1.2 && (j - i) * STEP <= 0.75) risers.push({ x: p.x(i), end: p.x(j), dir: Math.sign(p.y(j)! - p.y(i)!) });
  }
  // consecutive risers separated by a tread (>= 1 m), not one steep face split in two
  const next = (a: { end: number; dir: number }, b: { x: number; dir: number }) => b.dir === a.dir && b.x - a.end >= 1 && b.x - a.end <= 6;
  for (let i = 0; i < risers.length; ) {
    let j = i;
    while (j + 1 < risers.length && next(risers[j]!, risers[j + 1]!)) j++;
    if (j > i) out.push({ kind: 'steps', x0: risers[i]!.x - 0.5, x1: risers[j]!.x + 1 });
    i = j + 1;
  }

  return out.sort((a, b) => a.x0 - b.x0);
}

/** First x past the lip where a point launched from (lipX, lipY) at `v` along slope `rise` (per m, up) meets the ground. */
function landing(p: Profile, lipX: number, lipY: number, rise: number, v: number): number {
  const n = Math.hypot(1, rise);
  let px = lipX;
  let py = lipY - 0.02;
  const vx = v / n;
  let vy = (-v * rise) / n;
  const dt = 0.005;
  for (let t = 0; t < 5; t += dt) {
    vy += GRAVITY * dt;
    px += vx * dt;
    py += vy * dt;
    if (px > p.x1) return Infinity;
    const g = surfaceAt(p.level, px);
    if (g !== null && py >= g && px > lipX + 0.1) return px;
  }
  return Infinity;
}

function findShortcuts(p: Profile, hz: readonly Hazard[]): Shortcut[] {
  const out: Shortcut[] = [];
  for (const lip of hz) {
    if ((lip.kind !== 'launchLip' && lip.kind !== 'kicker') || lip.at === undefined) continue;
    const lipX = lip.at;
    const i = p.idx(lipX);
    const y = p.y(i);
    const before = p.y(i - samples(LIP_APPROACH));
    if (y === null || before === null) continue;
    const rise = (before - y) / LIP_APPROACH;
    const landX = landing(p, lipX, y, rise, SHORTCUT_FAST_SPEED);
    if (!Number.isFinite(landX) || landX - lipX < SHORTCUT_MIN_SKIP) continue;
    const a = i + 1;
    const b = p.idx(landX);
    const below = p.lowest(a, b);
    if (!Number.isFinite(below)) continue; // a hole under the flight: the jump is mandatory, not a shortcut
    const landY = surfaceAt(p.level, landX)!;
    const depth = below - Math.max(y, landY);
    if (depth < SHORTCUT_MIN_DEPTH) continue;
    const skipped = hz.find((h) => (h.kind === 'washboard' || h.kind === 'steps') && h.x0 >= lipX && h.x1 <= landX);
    if (!skipped) continue;
    let deepX = lipX;
    for (let j = a; j <= b; j++) if (p.y(j)! >= below - 1e-9) deepX = p.x(j);
    const slowLandX = landing(p, lipX, y, rise, SHORTCUT_SLOW_SPEED);
    if (!(slowLandX < deepX)) continue;
    out.push({ lipX, landX, slowLandX, depth, skips: skipped.kind });
  }
  return out;
}

/**
 * Census of `level` over [x0, x1]. `speedAt(x)` = typical speed (m/s) there
 * (the pace notes of a premade course, a constant for endless). `labels`
 * are authored annotations, only cross-checked. `keepSharp` ranges are left
 * out of the sharp-crest check (washboard teeth).
 */
export function census(
  level: LevelDef,
  range: { x0: number; x1: number },
  speedAt: (x: number) => number,
  opts: { labels?: readonly CensusLabel[]; keepSharp?: readonly { x0: number; x1: number }[] } = {},
): Census {
  // detect with context around the range; count hazards whose centre is inside it
  const p = new Profile(level, range.x0 - 12, range.x1 + 12);
  const all = detect(p);
  const centre = (h: Hazard) => h.at ?? (h.x0 + h.x1) / 2;
  const counted = all.filter((h) => centre(h) >= range.x0 && centre(h) < range.x1);
  const hazards: Partial<Record<HazardKind, number>> = {};
  for (const h of counted) hazards[h.kind] = (hazards[h.kind] ?? 0) + 1;
  const length = range.x1 - range.x0;

  const unconfirmedLabels = (opts.labels ?? [])
    .filter((l) => (HAZARD_KINDS as readonly string[]).includes(l.kind) && l.x1 > range.x0 && l.x0 < range.x1)
    .filter((l) => !all.some((h) => confirms(h.kind, l.kind) && h.x0 < l.x1 + 1 && h.x1 > l.x0 - 1))
    .map((l) => `${l.kind}@${l.x0.toFixed(1)}`);

  let run = 0;
  let runStart = range.x0;
  let runSeconds = 0;
  let best = { metres: 0, at: range.x0, seconds: 0 };
  for (let x = range.x0; x < range.x1 - DULL_WINDOW; x += 0.5) {
    const inHazard = all.some((h) => h.x0 < x + DULL_WINDOW && h.x1 > x);
    if (!inHazard && windowIsDull(level, x)) {
      if (run === 0) runStart = x;
      run += 0.5;
      runSeconds += 0.5 / Math.max(0.5, speedAt(x));
      if (runSeconds > best.seconds) best = { metres: run, at: runStart, seconds: runSeconds };
    } else {
      run = 0;
      runSeconds = 0;
    }
  }

  const sharp = opts.keepSharp ?? [];
  const keep = (q: Vec2) => sharp.some((f) => q.x >= f.x0 - 1e-6 && q.x <= f.x1 + 1e-6) || q.x >= level.goal.lineX - 1;
  let crest = 0;
  for (const s of level.terrain.spans) {
    // driving surface only: gap side walls (down to killY) are not ground
    const pts = s.points.filter((q) => q.x >= range.x0 && q.x <= range.x1 && q.y < level.killY - 1e-9);
    crest = Math.max(crest, sharpestCrest(pts, keep));
  }

  return {
    length,
    hazards,
    hazardCount: counted.length,
    hazardKinds: Object.keys(hazards).length,
    hazardsPer100m: (counted.length * 100) / length,
    detected: counted,
    shortcuts: findShortcuts(p, all).filter((s) => s.lipX >= range.x0 && s.lipX < range.x1),
    unconfirmedLabels,
    longestDullMetres: best.metres,
    longestDullAt: best.at,
    longestDullSeconds: best.seconds,
    sharpestCrest: crest,
  };
}

/**
 * Which detected kind confirms an authored label: the same kind, except that
 *   - launch lips and kickers are both lips (the detector splits them by the
 *     landing height, authors by intent);
 *   - a crest label is confirmed by a lip too: a lip IS a peak, one whose far
 *     side falls away abruptly (the generator's crest is "climb + steep drop");
 *   - a drop label is confirmed by a launch lip (its far side is the drop).
 * Never by a gap, washboard or steps, and never by nothing.
 */
function confirms(detected: HazardKind, label: string): boolean {
  if (detected === label) return true;
  const lip = detected === 'launchLip' || detected === 'kicker';
  if ((label === 'launchLip' || label === 'kicker' || label === 'crest') && lip) return true;
  return label === 'drop' && detected === 'launchLip';
}

function windowIsDull(level: LevelDef, x: number): boolean {
  const ys: number[] = [];
  for (let u = 0; u <= DULL_WINDOW + 1e-9; u += 0.5) {
    const y = surfaceAt(level, x + u);
    if (y === null) return false;
    ys.push(y);
  }
  const y0 = ys[0]!;
  const y1 = ys[ys.length - 1]!;
  const slope = (y1 - y0) / DULL_WINDOW;
  if (Math.abs(slope) >= DULL_MAX_SLOPE) return false;
  return ys.every((y, i) => Math.abs(y - (y0 + slope * i * 0.5)) <= DULL_STRAIGHTNESS);
}

export function auditLevel(c: Census, rules: AuditRules): string[] {
  const out: string[] = [];
  if (c.longestDullSeconds > rules.maxDullSeconds) {
    out.push(`dull stretch of ${c.longestDullMetres.toFixed(1)} m at x ${c.longestDullAt.toFixed(1)} (${c.longestDullSeconds.toFixed(1)} s > ${rules.maxDullSeconds} s)`);
  }
  if (c.hazardKinds < rules.minHazardKinds) out.push(`only ${c.hazardKinds} hazard kinds (< ${rules.minHazardKinds})`);
  if (c.hazardsPer100m < rules.minHazardsPer100m) out.push(`only ${c.hazardsPer100m.toFixed(2)} hazards / 100 m (< ${rules.minHazardsPer100m})`);
  if (c.sharpestCrest > rules.maxCrest + 1e-9) out.push(`sharp crest: slope jump ${c.sharpestCrest.toFixed(2)} (> ${rules.maxCrest})`);
  if (c.shortcuts.length < rules.minShortcuts) out.push(`only ${c.shortcuts.length} risk/reward shortcuts (< ${rules.minShortcuts})`);
  for (const l of c.unconfirmedLabels) out.push(`unconfirmed label: ${l} (no hazard there in the geometry)`);
  return out;
}
