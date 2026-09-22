/**
 * Kinematic mock run for the style guide (same pattern as S0's
 * MockSnapshotSource, richer): a real CartDesign resolved through
 * `resolveAttachments`, its bodies emitted as a SceneManifest, and poses
 * computed analytically from time — the cart follows a bumpy terrain with a
 * gap, wheels spin by distance, the sprung front wheel tracks the ground so
 * the umbrella shocks visibly compress, and a load of pineapples jiggles in
 * the bed. Deterministic in `time`. No physics.
 */

import { resolveAttachments, type CompoundSpec } from '../../model/attach';
import type { CartDesign } from '../../model/cart';
import type { Vec2 } from '../../model/geometry';
import type { LevelDef, ThemeId } from '../../model/level';
import type { BodyTransform, RenderBodyInfo, RenderSnapshot, SceneManifest, SnapshotSource } from '../../model/snapshot';

export const MOCK_CART: CartDesign = {
  version: 1,
  name: 'Style-guide tiki wagon',
  parts: [
    { id: 's1', kind: 'straw', a: { x: 0, y: 0 }, b: { x: 120, y: 0 } },
    { id: 's2', kind: 'straw', a: { x: 0, y: 0 }, b: { x: -12, y: -42 } },
    { id: 's3', kind: 'straw', a: { x: 120, y: 0 }, b: { x: 132, y: -42 } },
    { id: 's4', kind: 'straw', a: { x: 18, y: 0 }, b: { x: 34, y: 22 } },
    { id: 'c1', kind: 'cube', center: { x: 30, y: 26 }, width: 22, height: 22, angle: 0 },
    { id: 'l1', kind: 'lime', center: { x: 64, y: 4 }, radius: 9 },
    { id: 's5', kind: 'straw', a: { x: 100, y: 0 }, b: { x: 110, y: 14 } },
    { id: 'w1', kind: 'wheel', center: { x: 30, y: 30 }, radius: 18 },
    { id: 'w2', kind: 'wheel', center: { x: 106, y: 38 }, radius: 18 },
    { id: 'k1', kind: 'shock', a: { x: 108, y: 13 }, b: { x: 106, y: 38 } },
    { id: 'k2', kind: 'shock', a: { x: 86, y: 0 }, b: { x: 106, y: 38 } },
  ],
};

const PINEAPPLE_R = 1 / 3;
const GAP: [number, number] = [46, 48.5];

/** Mock terrain height (y-down, metres). */
export function mockGround(x: number): number {
  return 8 + 0.55 * Math.sin(x / 4.2) + 0.22 * Math.sin(x / 1.3 + 1) - 0.9 * Math.exp(-(((x - 30) / 5) ** 2)) + 1.4 * smooth((x - 70) / 12);
}
function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

export function mockTerrainSpans(from = -30, to = 150, step = 0.5): Vec2[][] {
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (let x = from; x <= to + 1e-9; x += step) {
    const p = { x, y: mockGround(x) };
    if (x <= GAP[0]) left.push(p);
    else if (x >= GAP[1]) right.push(p);
  }
  return [left, right];
}

export class MockRunSource implements SnapshotSource {
  time = 0;
  speed = 3.2;
  /** Loop length in metres (the cart wraps back to the start). */
  loop = 110;
  readonly spec: CompoundSpec;
  private readonly bodyIds = new Map<string, number>();
  private readonly pineapples: { id: number; local: Vec2; phase: number }[] = [];
  private readonly terrainId = 1;
  private filteredAngle = 0;
  private lastTime = -1;

  constructor(readonly design: CartDesign = MOCK_CART) {
    this.spec = resolveAttachments(design);
    if (!this.spec.valid) throw new Error(`mock cart invalid: ${JSON.stringify(this.spec.errors)}`);
    let next = 10;
    for (const b of this.spec.bodies) this.bodyIds.set(b.id, next++);
    // 2 rows of pineapples resting on the floor straw, chassis-local (metres)
    const chassis = this.chassisSpec();
    const floorY = -chassis.origin.y - 0.083; // top of the floor straw
    const xs = [0.45, 1.13, 1.81, 2.49, 3.17];
    xs.forEach((x, i) => this.pineapples.push({ id: 100 + i, local: { x: x - chassis.origin.x, y: floorY - PINEAPPLE_R }, phase: i * 1.7 }));
    [0.8, 1.48, 2.16, 2.84].forEach((x, i) =>
      this.pineapples.push({ id: 200 + i, local: { x: x - chassis.origin.x, y: floorY - PINEAPPLE_R * 2.7 }, phase: i * 2.3 + 0.5 }),
    );
  }

  private chassisSpec() {
    return this.spec.bodies.find((b) => b.partIds.includes('s1'))!;
  }

  manifest(): SceneManifest {
    const bodies: RenderBodyInfo[] = [
      { id: this.terrainId, role: 'terrain', shapes: mockTerrainSpans().map((points) => ({ type: 'chain' as const, points })) },
    ];
    for (const b of this.spec.bodies) {
      bodies.push({ id: this.bodyIds.get(b.id)!, role: b.kind === 'wheel' ? 'wheel' : 'cart', partIds: [...b.partIds], shapes: b.shapes });
    }
    for (const p of this.pineapples) {
      bodies.push({ id: p.id, role: 'pineapple', shapes: [{ type: 'circle', partId: `p${p.id}`, center: { x: 0, y: 0 }, radius: PINEAPPLE_R }] });
    }
    return { revision: 1, bodies };
  }

  snapshot(): RenderSnapshot {
    const t = this.time;
    const chassis = this.chassisSpec();
    const w1 = this.spec.bodies.find((b) => b.partIds.includes('w1'))!;
    const w2 = this.spec.bodies.find((b) => b.partIds.includes('w2'))!;
    const r1 = w1.shapes[0]!.type === 'circle' ? w1.shapes[0]!.radius : 0.6;
    const r2 = w2.shapes[0]!.type === 'circle' ? w2.shapes[0]!.radius : 0.6;
    // rear wheel centre (design-frame metres, relative to the chassis origin)
    const rearLocal = { x: w1.origin.x - chassis.origin.x, y: w1.origin.y - chassis.origin.y };
    const frontRest = { x: w2.origin.x - chassis.origin.x, y: w2.origin.y - chassis.origin.y };
    const baseAng = Math.atan2(frontRest.y - rearLocal.y, frontRest.x - rearLocal.x);
    const span = Math.hypot(frontRest.x - rearLocal.x, frontRest.y - rearLocal.y);

    const dist = (t * this.speed) % this.loop;
    const xr = -6 + dist;
    // wheels roll over the gap: interpolate across it
    const g = (x: number) => (x > GAP[0] && x < GAP[1] ? Math.min(mockGround(GAP[0]), mockGround(GAP[1])) : mockGround(x));
    const R = { x: xr, y: g(xr) - r1 };
    const xf = xr + span * Math.cos(baseAng);
    const F = { x: xf, y: g(xf) - r2 };
    const target = Math.atan2(F.y - R.y, F.x - R.x) - baseAng;
    // body lags the terrain a little -> the sprung wheel moves relative to it
    if (this.lastTime < 0 || t < this.lastTime || t - this.lastTime > 0.5) this.filteredAngle = target;
    else this.filteredAngle += (target - this.filteredAngle) * Math.min(1, (t - this.lastTime) * 5);
    this.lastTime = t;
    const ang = this.filteredAngle;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const rot = (p: Vec2) => ({ x: c * p.x - s * p.y, y: s * p.x + c * p.y });
    const rr = rot(rearLocal);
    const origin = { x: R.x - rr.x, y: R.y - rr.y };
    const bodies: BodyTransform[] = [{ id: this.terrainId, x: 0, y: 0, angle: 0 }];
    for (const b of this.spec.bodies) {
      const id = this.bodyIds.get(b.id)!;
      if (b.partIds.includes('w1')) bodies.push({ id, x: R.x, y: R.y, angle: dist / r1 });
      else if (b.partIds.includes('w2')) bodies.push({ id, x: F.x, y: F.y, angle: dist / r2 });
      else {
        const o = rot({ x: b.origin.x - chassis.origin.x, y: b.origin.y - chassis.origin.y });
        bodies.push({ id, x: origin.x + o.x, y: origin.y + o.y, angle: ang });
      }
    }
    const rough = Math.abs(Math.sin(t * 2.1)) * 0.5 + 0.5;
    for (const p of this.pineapples) {
      const j = 0.035 * rough * Math.sin(t * 11 + p.phase);
      const l = rot({ x: p.local.x + 0.02 * Math.sin(t * 3 + p.phase), y: p.local.y - Math.abs(j) });
      bodies.push({ id: p.id, x: origin.x + l.x, y: origin.y + l.y, angle: ang + 0.35 * Math.sin(t * 0.9 + p.phase) + p.phase });
    }
    return { step: Math.floor(t * 60), simTime: t, alpha: 0, manifestRevision: 1, bodies };
  }

  advance(dt: number): void {
    this.time += dt;
  }

  /** Chassis world position (for camera follow). */
  chassisPosition(snap: RenderSnapshot): Vec2 {
    const id = this.bodyIds.get(this.chassisSpec().id)!;
    const b = snap.bodies.find((x) => x.id === id)!;
    return { x: b.x, y: b.y };
  }
}

/** A minimal LevelDef so the scene places the blender goal and props. */
export function mockLevel(theme: ThemeId): LevelDef {
  const gx = 104;
  const props =
    theme === 'beach'
      ? [
          { id: 'palm1', art: 'palm', position: { x: 12, y: mockGround(12) + 0.3 } },
          { id: 'palm2', art: 'palm', position: { x: 60, y: mockGround(60) + 0.3 }, scale: 0.8 },
        ]
      : [];
  return {
    version: 1,
    id: `styleguide-${theme}`,
    name: 'Style guide',
    theme,
    terrain: { spans: mockTerrainSpans().map((points, i) => ({ id: `s${i}`, points })), friction: 0.9, restitution: 0.3 },
    cartStart: { x: 0, y: 6 },
    funnel: { x: 2, y: 2 },
    goal: { sensor: { x: gx - 1, y: mockGround(gx) - 0.4, width: 2, height: 0.4 }, lineX: gx - 2 },
    props: [...props, { id: 'funnel', art: 'funnel', position: { x: -2, y: mockGround(-2) - 3 } }],
    zones: [],
    killY: 40,
  };
}

/** Manifest bodies for every spec body (ids from `firstId`), in the physics wrapper's shape. */
export function manifestFromSpec(spec: CompoundSpec, firstId: number): { bodies: RenderBodyInfo[]; ids: Map<string, number> } {
  const ids = new Map<string, number>();
  const bodies = spec.bodies.map((b, i) => {
    ids.set(b.id, firstId + i);
    return { id: firstId + i, role: b.kind === 'wheel' ? ('wheel' as const) : ('cart' as const), partIds: [...b.partIds], shapes: b.shapes };
  });
  return { bodies, ids };
}
