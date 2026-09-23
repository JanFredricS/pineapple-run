/**
 * Bead ocean (S9 exotic physics): a LevelDef zone of kind 'beads' is filled,
 * at level load, with BEAD_COUNT_MIN..BEAD_COUNT_MAX small sleeping-enabled
 * circle bodies (role 'bead') piled over the terrain inside the zone's rect.
 * The cart has to plough through them.
 *
 * Beads are furniture, not cargo:
 *   - the RunController never counts, delivers or loses them (scoring sees
 *     only the 15 pineapples);
 *   - they are not terrain-streaming anchors (RunSession pins the bead
 *     ZONE's fixed x-range instead, see RunSession.furnitureXs), so a bead
 *     knocked far away cannot keep terrain alive;
 *   - they opt out of sensor events (zones never act on them);
 *   - a bead that falls below killY is destroyed by sweep() (every
 *     BEAD_SWEEP_STEPS), so their count only ever goes down.
 *
 * Adaptive count (PLAN S9): the COUNT is chosen once, at level load
 * (src/game/deviceTier.ts: a static device-capability bucket), never changed
 * mid-run. The pile keeps its extent and total mass for any count: the bead
 * radius is derived from the count (fewer, bigger beads on weaker devices),
 * so the section plays alike on every tier. The layout is a pure function of
 * (level terrain, zone rect, count): a hex lattice filled bottom-up.
 */

import type { Vec2 } from '../model/geometry';
import type { LevelDef, Rect, ZoneDef } from '../model/level';
import type { BodyHandle, PhysicsWorld } from '../physics/engine';

export const BEAD_COUNT_MIN = 300;
export const BEAD_COUNT_MAX = 600;
/** Used when the caller does not choose (headless tests, harness pages). */
export const BEAD_COUNT_DEFAULT = 450;
/** Fraction of the pile area covered by beads (hex packing is 0.907; the lattice needs spare sites). */
export const BEAD_FILL = 0.8;
/** Bead area density (kg/m²) — light: the ocean slows a cart, it must not stop it. */
export const BEAD_DENSITY = 0.35;
export const BEAD_MATERIAL = { density: BEAD_DENSITY, friction: 0.2, restitution: 0.05, sensorVisitor: false } as const;
/** Gap between lattice neighbours, as a fraction of the diameter (beads spawn not quite touching). */
const LATTICE_GAP = 0.02;
export const BEAD_SWEEP_STEPS = 30;

export interface BeadLayout {
  radius: number;
  centres: Vec2[];
}

/** Clamp a requested bead count into [MIN, MAX] (integers). */
export function clampBeadCount(n: number): number {
  if (!Number.isFinite(n)) return BEAD_COUNT_DEFAULT;
  return Math.max(BEAD_COUNT_MIN, Math.min(BEAD_COUNT_MAX, Math.round(n)));
}

interface Seg {
  a: Vec2;
  b: Vec2;
}

/** Terrain segments overlapping [x0, x1] (gap walls included: they are real walls). */
function segmentsIn(level: LevelDef, x0: number, x1: number): Seg[] {
  const out: Seg[] = [];
  for (const s of level.terrain.spans) {
    for (let i = 1; i < s.points.length; i++) {
      const a = s.points[i - 1]!;
      const b = s.points[i]!;
      if (b.x < x0 || a.x > x1) continue;
      out.push({ a, b });
    }
  }
  return out;
}

/** Topmost ground height at x from the segments (null if none covers x). */
function groundAt(segs: readonly Seg[], x: number): number | null {
  let best: number | null = null;
  for (const { a, b } of segs) {
    if (x < a.x || x > b.x || b.x === a.x) continue;
    const y = a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    if (best === null || y < best) best = y;
  }
  return best;
}

function distToSeg(p: Vec2, { a, b }: Seg): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Area between the rect's top and the ground inside it (column sums, 5 cm columns). */
function pileArea(segs: readonly Seg[], r: Rect): number {
  const n = Math.max(1, Math.ceil(r.width / 0.05));
  const dx = r.width / n;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const g = groundAt(segs, r.x + (i + 0.5) * dx);
    if (g === null) continue;
    area += Math.max(0, Math.min(g, r.y + r.height) - r.y) * dx;
  }
  return area;
}

function lattice(segs: readonly Seg[], r: Rect, radius: number): Vec2[] {
  const step = 2 * radius * (1 + LATTICE_GAP);
  const rowH = Math.sqrt(3) * radius * (1 + LATTICE_GAP);
  let floor = -Infinity;
  for (let x = r.x; x <= r.x + r.width; x += step / 2) {
    const g = groundAt(segs, x);
    if (g !== null) floor = Math.max(floor, Math.min(g, r.y + r.height));
  }
  if (!Number.isFinite(floor)) return [];
  const out: Vec2[] = [];
  const clear = radius * (1 + LATTICE_GAP);
  for (let row = 0; ; row++) {
    const y = floor - radius * (1 + LATTICE_GAP) - row * rowH;
    if (y - radius < r.y) break;
    const x0 = r.x + radius + (row % 2 === 1 ? step / 2 : 0);
    for (let x = x0; x <= r.x + r.width - radius; x += step) {
      const g = groundAt(segs, x);
      if (g === null || y + radius > g) continue; // under / in the ground
      const p = { x, y };
      if (segs.some((s) => distToSeg(p, s) < clear)) continue; // touching a slope or a wall
      out.push(p);
    }
  }
  return out;
}

/**
 * Deterministic bead layout for `count` beads in a beads zone: radius from
 * the pile area (so extent and total mass do not depend on the count), then
 * a hex lattice over the ground, lowest rows first; the lowest `count` sites
 * are used (shrinking the radius 2% at a time if the lattice is short).
 */
export function beadLayout(level: LevelDef, zone: Pick<ZoneDef, 'rect'>, count: number): BeadLayout {
  const n = clampBeadCount(count);
  const segs = segmentsIn(level, zone.rect.x - 1, zone.rect.x + zone.rect.width + 1);
  const area = pileArea(segs, zone.rect);
  if (!(area > 0)) throw new Error('beadLayout: the bead zone has no room above the terrain');
  let radius = Math.sqrt((area * BEAD_FILL) / (n * Math.PI));
  for (let tries = 0; tries < 60; tries++) {
    const sites = lattice(segs, zone.rect, radius);
    if (sites.length >= n) {
      // lowest first (largest y), then left to right: a pile, not a slab hanging from the top
      sites.sort((p, q) => q.y - p.y || p.x - q.x);
      return { radius, centres: sites.slice(0, n) };
    }
    radius *= 0.98;
  }
  throw new Error('beadLayout: cannot fit the beads');
}

export class BeadOcean {
  /** Every bead ever created (destroyed ones are removed). */
  private readonly live: BodyHandle[] = [];
  readonly layouts: BeadLayout[];
  readonly created: number;

  constructor(
    private readonly world: PhysicsWorld,
    private readonly level: LevelDef,
    count: number,
  ) {
    const zones = level.zones.filter((z) => z.kind === 'beads');
    this.layouts = zones.map((z) => beadLayout(level, z, count));
    for (const lay of this.layouts) {
      for (const c of lay.centres) {
        const h = world.createBody({ type: 'dynamic', position: c, role: 'bead', enableSleep: true });
        world.addCircle(h, { x: 0, y: 0 }, lay.radius, BEAD_MATERIAL, 'bead');
        this.live.push(h);
      }
    }
    this.created = this.live.length;
  }

  /** Beads still in the world. */
  get count(): number {
    return this.live.length;
  }

  handles(): readonly BodyHandle[] {
    return this.live;
  }

  /** Every BEAD_SWEEP_STEPS steps: destroy beads that fell below killY. */
  sweep(step: number): void {
    if (step % BEAD_SWEEP_STEPS !== 0 || this.live.length === 0) return;
    let j = 0;
    for (const h of this.live) {
      if (this.world.hasBody(h) && this.world.getTransform(h).y <= this.level.killY) this.live[j++] = h;
      else if (this.world.hasBody(h)) this.world.destroyBody(h);
    }
    this.live.length = j;
  }

  destroy(): void {
    for (const h of this.live) if (this.world.hasBody(h)) this.world.destroyBody(h);
    this.live.length = 0;
  }
}
