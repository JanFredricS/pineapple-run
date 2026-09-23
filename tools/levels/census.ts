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
 * down to killY, are not ground); a hole is where there is no ground.
 *
 * S6T audit-2: every quantity with a threshold is measured EXACTLY on that
 * surface, never on a sample grid. `Surface` rebuilds it as an exact
 * piecewise-linear function: its breakpoints are every segment end point
 * plus every crossing of two overlapping segments, so between breakpoints
 * one straight piece is on top, and a hole is exactly the interval where no
 * segment is. Then:
 *   - a gap's width is its hole's exact end points;
 *   - range extremes (tooth height, rise, fall, prominence, depth) are taken
 *     over the piece end points in the range, where a piecewise-linear
 *     function has its extremes, plus the clipped range ends;
 *   - a peak's top width is where the surface leaves PEAK_FLAT_TOL of the
 *     top height, interpolated exactly inside the crossing piece;
 *   - drop and riser runs are runs of whole pieces by slope.
 * Comparisons are made in the conservative direction: a measure that must
 * reach a minimum (gap width, tooth height, drop height, fall) passes at
 * the threshold minus EPS; the peak-width maximum is exact (the tolerance
 * can only WIDEN a top, so a plateau is never measured narrow enough to
 * become a peak). The only grid left is the dull-stretch scan (see below).
 *
 * Detected hazard kinds (HAZARD_KINDS):
 *
 *   gap       — a hole at least GAP_MIN_WIDTH wide.
 *   washboard — at least WASHBOARD_MIN_TEETH teeth (peaks no wider than
 *               TOOTH_MAX_TOP standing TOOTH_MIN_HEIGHT above the lowest
 *               ground within TOOTH_REACH on both sides), each within
 *               WASHBOARD_MAX_PITCH of the last.
 *   A PEAK is a local top (no ground higher within ±PEAK_REACH) whose top —
 *   the connected ground within PEAK_FLAT_TOL of its height — is no wider
 *   than PEAK_MAX_TOP: a wider flat top is a plateau, whose edges can only
 *   be drops (so a ramp, a flat 5 m and a descent is NOT a crest).
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
 *   drop      — a steep descent (consecutive pieces each falling at slope
 *               >= DROP_MIN_SLOPE) totalling >= DROP_MIN_HEIGHT, not part of
 *               a lip or a gap.
 *   steps     — >= 2 risers (0.25–1.2 m of height at slope >= 1 over
 *               <= 0.75 m) in the same direction, separated by 1–6 m treads.
 *
 * ZONE HAZARDS (S9 exotic physics): gravity zones, force fields and bead
 * oceans change how the cart drives without any terrain shape, so they are
 * detected from `level.zones` — simulation data the physics acts on (like the
 * terrain itself), NOT authoring labels (Track features stay annotations
 * only, cross-checked as before). A zone is a hazard only where it can touch
 * the cart and is strong enough to matter:
 *   - in the DRIVING CORRIDOR: somewhere in its x-range its rect overlaps
 *     the band from the driving surface up to ZONE_CORRIDOR_HEIGHT above it
 *     (tested exactly per surface piece, which is linear);
 *   lowGravity — a 'gravity' zone with gravityScale <= ZONE_MAX_GRAVITY_SCALE;
 *   shooter    — a 'force' zone with |force| >= ZONE_MIN_FORCE (m/s²);
 *   beads      — a 'beads' zone at least ZONE_MIN_BEADS_WIDTH wide and
 *                ZONE_MIN_BEADS_DEPTH deep (the pile the cart ploughs).
 * Its extent is the rect's x-range (clipped to the census window). Zone
 * hazards count like terrain hazards (kinds, per 100 m) and break dull
 * stretches: driving through a zone is never "nothing happening". A weak or
 * out-of-reach zone counts for nothing. Levels without zones (every level
 * before S9, all endless terrain) census exactly as before.
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
 *   - the longest DULL stretch: consecutive DULL_SCAN starts where the next
 *     DULL_WINDOW metres of ground is locally straight (within
 *     DULL_STRAIGHTNESS of its chord, checked exactly at every vertex),
 *     gentle (|chord slope| < DULL_MAX_SLOPE), has no hole (exact), and no
 *     DETECTED hazard overlaps it; in metres and in SECONDS at the level's
 *     typical speed. Grid invariant: only the stretch's LENGTH is scanned,
 *     and its error is under one DULL_SCAN step (0.5 m) at each end, which
 *     is under 1/10 s at pace speed; the smallest dull threshold is 6 s;
 *   - the sharpest crest left (slope jump at a convex vertex), outside the
 *     `keepSharp` ranges (washboard teeth) and the goal pit.
 */

import type { Vec2 } from '../../src/model/geometry';
import type { LevelDef, ZoneDef } from '../../src/model/level';
import { sharpestCrest } from '../../src/terrain/rounding';

export const HAZARD_KINDS = ['crest', 'drop', 'launchLip', 'washboard', 'kicker', 'gap', 'steps', 'lowGravity', 'shooter', 'beads'] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];

/** Slack for float round-off in threshold comparisons (always in the hazard's favour for minimums). */
const EPS = 1e-9;
export const GAP_MIN_WIDTH = 0.3;
export const TOOTH_REACH = 0.75;
export const TOOTH_MIN_HEIGHT = 0.12;
export const TOOTH_MAX_TOP = 0.5;
/** A peak has no ground higher than it within this reach (m). */
export const PEAK_REACH = 1;
/**
 * A peak's top is the connected ground within this height of it (m): 1 mm,
 * i.e. its flat extent. The tolerance can only WIDEN a top (a plateau is
 * never measured narrower than it is); it widens a top between slopes >= s
 * by at most 2 mm / s, under 0.05 m for any side steeper than 0.04.
 */
export const PEAK_FLAT_TOL = 0.001;
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
/** Zone hazards (S9, see the header). */
export const ZONE_CORRIDOR_HEIGHT = 3;
export const ZONE_MAX_GRAVITY_SCALE = 0.6;
export const ZONE_MIN_FORCE = 3;
export const ZONE_MIN_BEADS_WIDTH = 2;
export const ZONE_MIN_BEADS_DEPTH = 0.3;
/** World gravity (physics/engine.ts default), m/s². */
const GRAVITY = 10;

export const DULL_WINDOW = 4;
/** Dull-window start spacing (m): the only sampled quantity, see the header. */
export const DULL_SCAN = 0.5;
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

interface Piece {
  xa: number;
  xb: number;
  ya: number;
  yb: number;
}

const lerp = (p: Piece, x: number) => (p.xb === p.xa ? p.ya : p.ya + ((p.yb - p.ya) * (x - p.xa)) / (p.xb - p.xa));

/**
 * The EXACT driving surface over [x0, x1] as sorted, non-overlapping straight
 * pieces plus the exact holes between them (see the header). y is down, so
 * "lowest ground" is the MAX y and "highest" the MIN y.
 */
export class Surface {
  readonly pieces: Piece[] = [];
  readonly holes: [number, number][] = [];
  constructor(
    readonly level: LevelDef,
    readonly x0: number,
    readonly x1: number,
  ) {
    // ground segments per span (a span is a chain: its segments never overlap in x)
    const spans: Piece[][] = [];
    for (const sp of level.terrain.spans) {
      const segs: Piece[] = [];
      for (let i = 1; i < sp.points.length; i++) {
        const a = sp.points[i - 1]!;
        const b = sp.points[i]!;
        if (a.y >= level.killY - 1e-9 || b.y >= level.killY - 1e-9) continue; // a gap wall
        if (b.x <= a.x || b.x < x0 || a.x > x1) continue;
        segs.push({ xa: a.x, xb: b.x, ya: a.y, yb: b.y });
      }
      if (segs.length) spans.push(segs);
    }
    const xs = new Set<number>([x0, x1]);
    for (const segs of spans) for (const g of segs) for (const x of [g.xa, g.xb]) if (x > x0 && x < x1) xs.add(x);
    // crossings of segments from different spans (overlapping spans are rare: only the pieces in the overlap are compared)
    for (let i = 0; i < spans.length; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        const A = spans[i]!;
        const B = spans[j]!;
        const lo = Math.max(A[0]!.xa, B[0]!.xa);
        const hi = Math.min(A[A.length - 1]!.xb, B[B.length - 1]!.xb);
        if (hi <= lo) continue;
        for (const g of A) {
          if (g.xb <= lo || g.xa >= hi) continue;
          for (const h of B) {
            const l = Math.max(g.xa, h.xa);
            const r = Math.min(g.xb, h.xb);
            if (r <= l) continue;
            const dl = lerp(g, l) - lerp(h, l);
            const dr = lerp(g, r) - lerp(h, r);
            if (dl * dr < 0) xs.add(l + ((r - l) * dl) / (dl - dr));
          }
        }
      }
    }
    const sorted = [...xs].filter((x) => x >= x0 && x <= x1).sort((p, q) => p - q);
    /** The topmost segment over the open interval around m (binary search per span). */
    const top = (m: number): Piece | null => {
      let best: Piece | null = null;
      let bestY = Infinity;
      for (const segs of spans) {
        let lo = 0;
        let hi = segs.length - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const g = segs[mid]!;
          if (m < g.xa) hi = mid - 1;
          else if (m > g.xb) lo = mid + 1;
          else {
            const y = lerp(g, m);
            if (y < bestY) {
              bestY = y;
              best = g;
            }
            break;
          }
        }
      }
      return best;
    };
    for (let i = 1; i < sorted.length; i++) {
      const xa = sorted[i - 1]!;
      const xb = sorted[i]!;
      if (xb - xa <= 1e-12) continue;
      const g = top((xa + xb) / 2);
      if (g) {
        this.pieces.push({ xa, xb, ya: lerp(g, xa), yb: lerp(g, xb) });
      } else {
        const last = this.holes[this.holes.length - 1];
        if (last && Math.abs(last[1] - xa) <= 1e-12) last[1] = xb;
        else this.holes.push([xa, xb]);
      }
    }
  }

  /** Index of the first piece with xb > x (binary search). */
  private first(x: number): number {
    let lo = 0;
    let hi = this.pieces.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.pieces[mid]!.xb <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Ground height at x (the topmost where two pieces meet); null over a hole. */
  y(x: number): number | null {
    let best: number | null = null;
    for (let i = Math.max(0, this.first(x) - 1); i < this.pieces.length; i++) {
      const p = this.pieces[i]!;
      if (p.xa > x) break;
      if (x >= p.xa && x <= p.xb) {
        const y = lerp(p, x);
        if (best === null || y < best) best = y;
      }
    }
    return best;
  }

  /** Does a hole overlap (a, b) by more than a point? */
  hasHole(a: number, b: number): boolean {
    return this.holes.some(([h0, h1]) => h0 < b - 1e-12 && h1 > a + 1e-12);
  }

  /** Exact extremes of the ground over [a, b] (holes skipped): at piece end points and the clipped range ends. */
  extremes(a: number, b: number): { minY: number; maxY: number; maxX: number } {
    let minY = Infinity;
    let maxY = -Infinity;
    let maxX = a;
    for (let i = Math.max(0, this.first(a) - 1); i < this.pieces.length; i++) {
      const p = this.pieces[i]!;
      if (p.xa > b) break;
      if (p.xb < a) continue;
      for (const x of [Math.max(a, p.xa), Math.min(b, p.xb)]) {
        const y = lerp(p, x);
        minY = Math.min(minY, y);
        if (y >= maxY) {
          maxY = y;
          maxX = x;
        }
      }
    }
    return { minY, maxY, maxX };
  }

  /** Lowest ground (max y) over [a, b]; Infinity if a hole is in it (ground falls away without bound). */
  lowest(a: number, b: number): number {
    return this.hasHole(a, b) ? Infinity : this.extremes(a, b).maxY;
  }

  /** Lowest ground over [a, b], ignoring holes (for the ground BEFORE a peak). */
  lowestSolid(a: number, b: number): number {
    return this.extremes(a, b).maxY;
  }

  /** Every vertex (piece end point) in [a, b] with its topmost height. */
  vertices(a: number, b: number): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let i = Math.max(0, this.first(a) - 1); i < this.pieces.length; i++) {
      const p = this.pieces[i]!;
      if (p.xa > b) break;
      for (const [x, y] of [
        [p.xa, p.ya],
        [p.xb, p.yb],
      ] as const) {
        if (x < a || x > b) continue;
        const last = out[out.length - 1];
        if (last && Math.abs(last.x - x) <= 1e-12) last.y = Math.min(last.y, y);
        else out.push({ x, y });
      }
    }
    return out;
  }

  /**
   * The top around a vertex at (x, y): the connected ground within `tol` of
   * y (either way: ground rising above the top ends it too), its ends
   * interpolated exactly inside the piece that leaves the band (a hole or a
   * jump also ends it).
   */
  topAround(x: number, y: number, tol: number): [number, number] {
    const lo = y - tol;
    const hi = y + tol;
    const inBand = (v: number) => v >= lo && v <= hi;
    /** Where the piece, entering at (x0, y0) in the band, leaves it towards (x1, y1). */
    const exit = (x0: number, y0: number, x1: number, y1: number) => {
      const level = y1 > hi ? hi : lo;
      return x0 + ((level - y0) * (x1 - x0)) / (y1 - y0);
    };
    let right = x;
    for (let i = this.first(x); i < this.pieces.length; i++) {
      const p = this.pieces[i]!;
      if (p.xa > right + 1e-12 || !inBand(p.ya)) break;
      if (inBand(p.yb)) {
        right = p.xb;
        continue;
      }
      right = exit(p.xa, p.ya, p.xb, p.yb);
      break;
    }
    let left = x;
    for (let i = this.first(x) - 1; i >= 0; i--) {
      const p = this.pieces[i]!;
      if (p.xb > x + 1e-12) continue; // the piece starting at x
      if (p.xb < left - 1e-12 || !inBand(p.yb)) break;
      if (inBand(p.ya)) {
        left = p.xa;
        continue;
      }
      left = exit(p.xb, p.yb, p.xa, p.ya);
      break;
    }
    return [left, right];
  }
}

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

interface Peak {
  /** Top extent (exact). */
  ta: number;
  tb: number;
  y: number;
}

/** Local tops: vertices with no ground higher within ±PEAK_REACH, with their exact top extents (deduplicated). */
function peaks(S: Surface): Peak[] {
  const out: Peak[] = [];
  for (const v of S.vertices(S.x0, S.x1)) {
    if (S.extremes(v.x - PEAK_REACH, v.x + PEAK_REACH).minY < v.y - 1e-6) continue;
    const [ta, tb] = S.topAround(v.x, v.y, PEAK_FLAT_TOL);
    const last = out[out.length - 1];
    if (last && ta <= last.tb + 1e-9) {
      // the same top (a flat run of vertices): keep the union and the highest point
      last.tb = Math.max(last.tb, tb);
      last.y = Math.min(last.y, v.y);
      continue;
    }
    out.push({ ta, tb, y: v.y });
  }
  return out;
}

/** Maximal runs of consecutive, continuous pieces whose slope dy/dx satisfies `ok(slope, firstSlope)`; [x0, y0, x1, y1]. */
function runs(S: Surface, ok: (slope: number, first: number) => boolean): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const slope = (p: Piece) => (p.yb - p.ya) / (p.xb - p.xa);
  const P = S.pieces;
  for (let i = 0; i < P.length; i++) {
    const first = slope(P[i]!);
    if (!ok(first, first)) continue;
    let j = i;
    while (j + 1 < P.length && Math.abs(P[j + 1]!.xa - P[j]!.xb) <= 1e-9 && Math.abs(P[j + 1]!.ya - P[j]!.yb) <= 1e-9 && ok(slope(P[j + 1]!), first)) j++;
    out.push([P[i]!.xa, P[i]!.ya, P[j]!.xb, P[j]!.yb]);
    i = j;
  }
  return out;
}

function detect(S: Surface): Hazard[] {
  const out: Hazard[] = [];

  // gaps: exact hole widths
  for (const [h0, h1] of S.holes) {
    if (h0 <= S.x0 || h1 >= S.x1) continue; // cut by the census window: not a measurable hole
    if (h1 - h0 >= GAP_MIN_WIDTH - EPS) out.push({ kind: 'gap', x0: h0 - 1, x1: h1 + 1 });
  }

  // washboards: runs of teeth
  const pk = peaks(S);
  const isTooth = (q: Peak) =>
    q.tb - q.ta <= TOOTH_MAX_TOP &&
    S.lowestSolid(q.ta - TOOTH_REACH, q.ta) - q.y >= TOOTH_MIN_HEIGHT - EPS &&
    S.lowest(q.tb, q.tb + TOOTH_REACH) - q.y >= TOOTH_MIN_HEIGHT - EPS;
  const teeth = pk.filter(isTooth);
  const inBoard = new Set<Peak>();
  for (let i = 0; i < teeth.length; ) {
    let j = i;
    while (j + 1 < teeth.length && teeth[j + 1]!.ta - teeth[j]!.tb <= WASHBOARD_MAX_PITCH) j++;
    if (j - i + 1 >= WASHBOARD_MIN_TEETH) {
      for (let t = i; t <= j; t++) inBoard.add(teeth[t]!);
      out.push({ kind: 'washboard', x0: teeth[i]!.ta - 0.75, x1: teeth[j]!.tb + 0.75 });
    }
    i = j + 1;
  }

  // lips, kickers, crests
  const lipRanges: [number, number][] = [];
  for (const q of pk) {
    if (inBoard.has(q)) continue;
    if (q.tb - q.ta > PEAK_MAX_TOP) continue; // a plateau: its edges are drops
    // the approach is measured where the cart leaves the top (its far edge)
    const approach = S.y(q.tb - LIP_APPROACH);
    const approachSlope = approach === null ? 0 : (approach - q.y) / LIP_APPROACH;
    const rise3 = S.lowestSolid(q.tb - 3, q.tb) - q.y;
    const fallQuick = S.lowest(q.tb, q.tb + 2) - q.y;
    const fall4 = S.lowest(q.tb, q.tb + 4) - q.y;
    const at = (q.ta + q.tb) / 2;
    if (approachSlope >= LIP_MIN_APPROACH_SLOPE - EPS && rise3 >= 0.3 - EPS && fallQuick >= LIP_MIN_FALL - EPS) {
      const kind: HazardKind = fall4 >= rise3 + 0.3 ? 'launchLip' : 'kicker';
      out.push({ kind, x0: q.ta - 3, x1: q.tb + 3, at });
      lipRanges.push([q.ta - 3, q.tb + 3]);
      continue;
    }
    const riseBefore = S.lowestSolid(q.ta - CREST_REACH, q.ta) - q.y;
    const fallAfter = S.lowestSolid(q.tb, q.tb + CREST_REACH) - q.y;
    const prev = out[out.length - 1];
    if (prev?.kind === 'crest' && prev.x1 > q.ta) continue; // the same hill
    if (riseBefore >= CREST_MIN_PROMINENCE - EPS && fallAfter >= CREST_MIN_PROMINENCE - EPS) out.push({ kind: 'crest', x0: q.ta - 4, x1: q.tb + 4, at });
  }

  // drops: steep descending runs, not a lip's fall and not into a gap
  const gapRanges = out.filter((h) => h.kind === 'gap').map((h) => [h.x0, h.x1] as [number, number]);
  const overlaps = (a: number, b: number, rs: readonly [number, number][]) => rs.some(([c, d]) => c < b && d > a);
  for (const [xa, ya, xb, yb] of runs(S, (sl) => sl >= DROP_MIN_SLOPE - EPS)) {
    if (yb - ya >= DROP_MIN_HEIGHT - EPS && !overlaps(xa, xb, lipRanges) && !overlaps(xa, xb, gapRanges)) out.push({ kind: 'drop', x0: xa - 1, x1: xb + 1 });
  }

  // steps: >= 2 same-direction risers
  const risers: { x: number; end: number; dir: number }[] = [];
  for (const [xa, ya, xb, yb] of runs(S, (sl, first) => Math.abs(sl) >= 1 - EPS && Math.sign(sl) === Math.sign(first))) {
    const h = Math.abs(yb - ya);
    if (h >= 0.25 - EPS && h <= 1.2 && xb - xa <= 0.75) risers.push({ x: xa, end: xb, dir: Math.sign(yb - ya) });
  }
  // consecutive risers separated by a tread (>= 1 m), not one steep face split in two
  const next = (a: { end: number; dir: number }, b: { x: number; dir: number }) => b.dir === a.dir && b.x - a.end >= 1 && b.x - a.end <= 6;
  for (let i = 0; i < risers.length; ) {
    let j = i;
    while (j + 1 < risers.length && next(risers[j]!, risers[j + 1]!)) j++;
    if (j > i) out.push({ kind: 'steps', x0: risers[i]!.x - 0.5, x1: risers[j]!.end + 1 });
    i = j + 1;
  }

  return out.sort((a, b) => a.x0 - b.x0);
}

/** Does the zone's rect reach the driving corridor (surface .. ZONE_CORRIDOR_HEIGHT above it) anywhere in its x-range? Exact per piece. */
function inCorridor(S: Surface, z: ZoneDef): boolean {
  const { x, y, width, height } = z.rect;
  // y is down: the cart's band [g - CORRIDOR, g] overlaps [y, y + height] iff y <= g <= y + height + CORRIDOR
  const bottom = y + height + ZONE_CORRIDOR_HEIGHT;
  for (const p of S.pieces) {
    const a = Math.max(p.xa, x);
    const b = Math.min(p.xb, x + width);
    if (b < a) continue;
    const ya = lerp(p, a);
    const yb = lerp(p, b);
    // the piece is linear: its ground heights over [a, b] are exactly [min, max]
    if (Math.max(ya, yb) >= y && Math.min(ya, yb) <= bottom) return true;
  }
  return false;
}

/** Zone hazards from the level's zones (S9, see the header). */
function detectZones(S: Surface, zones: readonly ZoneDef[]): Hazard[] {
  const out: Hazard[] = [];
  for (const z of zones) {
    const x0 = Math.max(S.x0, z.rect.x);
    const x1 = Math.min(S.x1, z.rect.x + z.rect.width);
    if (x1 <= x0 || !inCorridor(S, z)) continue;
    let kind: HazardKind | null = null;
    if (z.kind === 'gravity' && (z.gravityScale ?? 1) <= ZONE_MAX_GRAVITY_SCALE + EPS) kind = 'lowGravity';
    else if (z.kind === 'force' && Math.hypot(z.force?.x ?? 0, z.force?.y ?? 0) >= ZONE_MIN_FORCE - EPS) kind = 'shooter';
    else if (z.kind === 'beads' && z.rect.width >= ZONE_MIN_BEADS_WIDTH - EPS && z.rect.height >= ZONE_MIN_BEADS_DEPTH - EPS) kind = 'beads';
    if (kind) out.push({ kind, x0, x1 });
  }
  return out;
}

/** First x past the lip where a point launched from (lipX, lipY) at `v` along slope `rise` (per m, up) meets the ground. */
function landing(S: Surface, lipX: number, lipY: number, rise: number, v: number): number {
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
    if (px > S.x1) return Infinity;
    const g = S.y(px);
    if (g !== null && py >= g && px > lipX + 0.1) return px;
  }
  return Infinity;
}

function findShortcuts(S: Surface, hz: readonly Hazard[]): Shortcut[] {
  const out: Shortcut[] = [];
  for (const lip of hz) {
    if ((lip.kind !== 'launchLip' && lip.kind !== 'kicker') || lip.at === undefined) continue;
    const lipX = lip.at;
    const y = S.y(lipX);
    const before = S.y(lipX - LIP_APPROACH);
    if (y === null || before === null) continue;
    const rise = (before - y) / LIP_APPROACH;
    const landX = landing(S, lipX, y, rise, SHORTCUT_FAST_SPEED);
    if (!Number.isFinite(landX) || landX - lipX < SHORTCUT_MIN_SKIP) continue;
    if (S.hasHole(lipX, landX)) continue; // a hole under the flight: the jump is mandatory, not a shortcut
    const { maxY: below, maxX: deepX } = S.extremes(lipX, landX);
    const landY = S.y(landX)!;
    const depth = below - Math.max(y, landY);
    if (depth < SHORTCUT_MIN_DEPTH) continue;
    const skipped = hz.find((h) => (h.kind === 'washboard' || h.kind === 'steps') && h.x0 >= lipX && h.x1 <= landX);
    if (!skipped) continue;
    const slowLandX = landing(S, lipX, y, rise, SHORTCUT_SLOW_SPEED);
    if (!(slowLandX < deepX)) continue;
    out.push({ lipX, landX, slowLandX, depth, skips: skipped.kind });
  }
  return out;
}

/**
 * The goal pit's lip, from the geometry alone, the same rule on every course
 * (M1 audit #1): the right-most terrain vertex at or before the goal line
 * that stands at least 1 m above the pit floor (the goal sensor's bottom).
 * On the premades it is exactly the `finish` feature's x0 (pinned in
 * test/levels/excitement.test.ts); on the original it is the 2008 shredder
 * lip (x 255.408, 7662.25 px). Everything from here on is finish geometry:
 * the drop into the pit and, where the line sits in the pit (Kitchen, the
 * original), the landing counter before it.
 */
export function finishLipX(level: LevelDef): number {
  const floorY = level.goal.sensor.y + level.goal.sensor.height;
  let lip = -Infinity;
  for (const s of level.terrain.spans) for (const q of s.points) if (q.x <= level.goal.lineX && q.y <= floorY - 1 && q.x > lip) lip = q.x;
  if (!Number.isFinite(lip)) throw new Error(`finishLipX: no lip before the goal line in ${level.id}`);
  return lip;
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
  const S = new Surface(level, range.x0 - 12, range.x1 + 12);
  const all = [...detect(S), ...detectZones(S, level.zones)].sort((a, b) => a.x0 - b.x0);
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
  for (let k = 0; range.x0 + k * DULL_SCAN < range.x1 - DULL_WINDOW; k++) {
    const x = range.x0 + k * DULL_SCAN;
    const inHazard = all.some((h) => h.x0 < x + DULL_WINDOW && h.x1 > x);
    if (!inHazard && windowIsDull(S, x)) {
      if (run === 0) runStart = x;
      run += DULL_SCAN;
      runSeconds += DULL_SCAN / Math.max(0.5, speedAt(x));
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
    shortcuts: findShortcuts(S, all).filter((s) => s.lipX >= range.x0 && s.lipX < range.x1),
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
 *   - a crest label is confirmed by a lip or a drop too: a lip IS a peak,
 *     one whose far side falls away abruptly, and the generator's crest is
 *     "climb + steep drop" off a 2–4 m flat top, which is wider than
 *     PEAK_MAX_TOP, so its hazard is the drop;
 *   - a drop label is confirmed by a launch lip (its far side is the drop).
 * Never by a gap, washboard or steps, and never by nothing.
 */
function confirms(detected: HazardKind, label: string): boolean {
  if (detected === label) return true;
  const lip = detected === 'launchLip' || detected === 'kicker';
  if ((label === 'launchLip' || label === 'kicker' || label === 'crest') && lip) return true;
  if (label === 'crest' && detected === 'drop') return true;
  return label === 'drop' && detected === 'launchLip';
}

/** Is [x, x + DULL_WINDOW] dull? Exact: any hole, and the deviation from the chord at every vertex. */
function windowIsDull(S: Surface, x: number): boolean {
  const x1 = x + DULL_WINDOW;
  if (S.hasHole(x, x1)) return false;
  const y0 = S.y(x);
  const y1 = S.y(x1);
  if (y0 === null || y1 === null) return false;
  const slope = (y1 - y0) / DULL_WINDOW;
  if (Math.abs(slope) >= DULL_MAX_SLOPE) return false;
  return S.vertices(x, x1).every((v) => Math.abs(v.y - (y0 + slope * (v.x - x))) <= DULL_STRAIGHTNESS);
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
