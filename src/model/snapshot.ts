/**
 * Render snapshot interface (S0 contract 4).
 *
 * Physics -> renderer, once per rendered frame. The renderer (S4) draws ONLY
 * from these plain objects, never from physics objects. Two parts:
 *
 *  - SceneManifest: what each body IS (role + local shapes). Sent when bodies
 *    are created/destroyed (manifest `revision` bumps on change).
 *  - RenderSnapshot: per-frame transforms of EVERY manifest body (dynamic
 *    ones interpolated, static ones at their fixed pose).
 *
 * Units: metres and radians, y-down world (see model/coords.ts for helpers).
 */

import type { ShapeSpec } from './attach';
import type { Vec2 } from './geometry';

/**
 * S9 (additive): 'zone' = a level zone's sensor body (gravity pocket / force
 * field; its partIds carry the zone tag, see model/zones.ts); 'bead' = a
 * bead-ocean bead (decorative obstacle, never cargo).
 */
export type BodyRole = 'cart' | 'wheel' | 'pineapple' | 'terrain' | 'prop' | 'debug' | 'zone' | 'bead';

export interface RenderBodyInfo {
  /** Physics-wrapper body handle (stable for the body's lifetime). */
  id: number;
  role: BodyRole;
  /** Cart part ids for cart/wheel bodies (maps shapes back to design parts). */
  partIds?: string[];
  /** Local shapes (metres, relative to the body origin). */
  shapes: RenderShape[];
}

export type RenderShape =
  | ShapeSpec
  | { type: 'chain'; partId?: string; points: Vec2[] };

export interface SceneManifest {
  revision: number;
  bodies: RenderBodyInfo[];
}

export interface BodyTransform {
  id: number;
  /** Interpolated body origin position, metres. */
  x: number;
  y: number;
  /** Interpolated angle, radians (clockwise-positive on screen). */
  angle: number;
}

export interface RenderSnapshot {
  /** Fixed steps simulated so far. */
  step: number;
  /** Simulation seconds (step / 60). */
  simTime: number;
  /** Interpolation factor in [0,1) between the previous and current step. */
  alpha: number;
  /** Manifest revision these transforms belong to. */
  manifestRevision: number;
  bodies: BodyTransform[];
}

/** Anything that can supply snapshots (the physics world, or a mock). */
export interface SnapshotSource {
  manifest(): SceneManifest;
  snapshot(): RenderSnapshot;
}

/** Linear interpolation of an angle along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

export function interpolateTransform(prev: BodyTransform, curr: BodyTransform, alpha: number): BodyTransform {
  return {
    id: curr.id,
    x: prev.x + (curr.x - prev.x) * alpha,
    y: prev.y + (curr.y - prev.y) * alpha,
    angle: lerpAngle(prev.angle, curr.angle, alpha),
  };
}

/**
 * Mock snapshot source for developing the renderer (S4) with no physics:
 * a 2 m chassis box rolling right at `speed` m/s on two spinning wheels, plus
 * a pineapple riding on top. Deterministic in `time` (seconds).
 */
export class MockSnapshotSource implements SnapshotSource {
  time = 0;
  constructor(private readonly speed = 3) {}

  manifest(): SceneManifest {
    const box = (hw: number, hh: number): Vec2[] => [
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ];
    return {
      revision: 1,
      bodies: [
        { id: 1, role: 'terrain', shapes: [{ type: 'chain', points: [{ x: -50, y: 1.2 }, { x: 500, y: 1.2 }] }] },
        { id: 2, role: 'cart', partIds: ['chassis'], shapes: [{ type: 'polygon', partId: 'chassis', vertices: box(1, 0.1) }] },
        { id: 3, role: 'wheel', partIds: ['w1'], shapes: [{ type: 'circle', partId: 'w1', center: { x: 0, y: 0 }, radius: 0.5 }] },
        { id: 4, role: 'wheel', partIds: ['w2'], shapes: [{ type: 'circle', partId: 'w2', center: { x: 0, y: 0 }, radius: 0.5 }] },
        { id: 5, role: 'pineapple', shapes: [{ type: 'circle', partId: 'p0', center: { x: 0, y: 0 }, radius: 0.33 }] },
      ],
    };
  }

  snapshot(): RenderSnapshot {
    const t = this.time;
    const x = t * this.speed;
    const spin = (x / 0.5) % (2 * Math.PI);
    return {
      step: Math.floor(t * 60),
      simTime: t,
      alpha: 0,
      manifestRevision: 1,
      bodies: [
        // static bodies are included at their fixed pose, like PhysicsWorld.snapshot()
        { id: 1, x: 0, y: 0, angle: 0 },
        { id: 2, x, y: 0.2, angle: 0 },
        { id: 3, x: x - 0.8, y: 0.7, angle: spin },
        { id: 4, x: x + 0.8, y: 0.7, angle: spin },
        { id: 5, x, y: -0.23, angle: spin * 0.3 },
      ],
    };
  }

  advance(dt: number): void {
    this.time += dt;
  }
}
