/**
 * The start-area funnel: a V-shaped hopper above the start area holding the
 * pineapples behind a plug. Release removes the plug and the load drops.
 *
 * `LevelDef.funnel` is interpreted as the centre of the funnel's OUTLET (the
 * plug sits just below it); the walls rise from there. Geometry is pure
 * (`funnelGeometry`), instantiated as static 'prop' bodies by `buildFunnel`.
 */

import type { Vec2 } from '../model/geometry';
import { PINEAPPLE_RADIUS, spawnPineapple } from '../physics/cargo';
import type { BodyHandle, PhysicsWorld } from '../physics/engine';
import { mulberry32 } from './rng';

/**
 * Half the outlet width, metres. Outlet 2.4 m ≈ 3.6 pineapple diameters: the
 * high-friction load arches (jams) at 1.5 m and partly at 2.0 m (measured).
 */
export const FUNNEL_OUTLET_HALF_WIDTH = 1.2;
/** Wall height above the outlet, metres. */
export const FUNNEL_HEIGHT = 3.6;
/** Wall angle from horizontal, radians (70°). */
export const FUNNEL_WALL_ANGLE = (70 * Math.PI) / 180;
export const FUNNEL_WALL_THICKNESS = 0.2;
export const FUNNEL_PLUG_THICKNESS = 0.2;
/** Funnel walls / plug are frictionless so the load flows out cleanly (our tuning). */
export const FUNNEL_MATERIAL = { friction: 0, restitution: 0.1 } as const;

export interface FunnelGeometry {
  /** Wall quads in world metres (left, right). */
  walls: [Vec2[], Vec2[]];
  /** Plug quad in world metres, closing the outlet from below. */
  plug: Vec2[];
  /** Initial pineapple centres, bottom row first. */
  spawns: Vec2[];
}

/** Inner half-width of the V at height h above the outlet. */
function innerHalfWidth(h: number): number {
  return FUNNEL_OUTLET_HALF_WIDTH + h / Math.tan(FUNNEL_WALL_ANGLE);
}

export function funnelGeometry(outlet: Vec2, count: number, seed = 15): FunnelGeometry {
  const H = FUNNEL_HEIGHT;
  const t = FUNNEL_WALL_THICKNESS;
  const topHalf = innerHalfWidth(H);
  const a = FUNNEL_OUTLET_HALF_WIDTH;
  const { x, y } = outlet;
  // Each wall: inner edge from outlet corner up to the top, thickened outward.
  const left: Vec2[] = [
    { x: x - a, y },
    { x: x - topHalf, y: y - H },
    { x: x - topHalf - t, y: y - H },
    { x: x - a - t, y },
  ];
  const right: Vec2[] = [
    { x: x + a, y },
    { x: x + a + t, y },
    { x: x + topHalf + t, y: y - H },
    { x: x + topHalf, y: y - H },
  ];
  const pw = a + t;
  const plug: Vec2[] = [
    { x: x - pw, y },
    { x: x + pw, y },
    { x: x + pw, y: y + FUNNEL_PLUG_THICKNESS },
    { x: x - pw, y: y + FUNNEL_PLUG_THICKNESS },
  ];

  // Rows of pineapples inside the V, as many per row as fit with a small gap.
  const r = PINEAPPLE_RADIUS;
  const pitch = 2 * r + 0.04;
  const rand = mulberry32(seed);
  const spawns: Vec2[] = [];
  for (let row = 0; spawns.length < count; row++) {
    const h = r + 0.02 + row * pitch;
    // Clearance from the sloped wall: a circle of radius r touching the wall
    // has its centre r / sin(angle) further in horizontally.
    const half = innerHalfWidth(h) - r / Math.sin(FUNNEL_WALL_ANGLE) - 0.02;
    const n = Math.max(1, Math.floor((2 * half) / pitch) + 1);
    const span = (n - 1) * pitch;
    for (let i = 0; i < n && spawns.length < count; i++) {
      const jitter = (rand() - 0.5) * 0.04;
      spawns.push({ x: x - span / 2 + i * pitch + jitter, y: y - h });
    }
  }
  return { walls: [left, right], plug, spawns };
}

export interface FunnelInstance {
  geometry: FunnelGeometry;
  walls: BodyHandle;
  /** null once the plug has been pulled. */
  plug: BodyHandle | null;
  pineapples: BodyHandle[];
  /** Remove the plug (Release). Idempotent. */
  pullPlug(): void;
}

/** Local polygon relative to a static body at the origin = world coords. */
export function buildFunnel(world: PhysicsWorld, outlet: Vec2, count: number, seed = 15): FunnelInstance {
  const geometry = funnelGeometry(outlet, count, seed);
  const walls = world.createBody({ type: 'static', position: { x: 0, y: 0 }, role: 'prop', partIds: ['funnel'] });
  for (const w of geometry.walls) world.addPolygon(walls, w, FUNNEL_MATERIAL, 'funnel');
  const plug = world.createBody({ type: 'static', position: { x: 0, y: 0 }, role: 'prop', partIds: ['funnel-plug'] });
  world.addPolygon(plug, geometry.plug, FUNNEL_MATERIAL, 'funnel-plug');

  const rand = mulberry32(seed ^ 0x9e3779b9);
  const pineapples = geometry.spawns.map((p) => spawnPineapple(world, p, rand() * Math.PI * 2));

  const inst: FunnelInstance = {
    geometry,
    walls,
    plug,
    pineapples,
    pullPlug() {
      if (inst.plug === null) return;
      if (world.hasBody(inst.plug)) world.destroyBody(inst.plug);
      inst.plug = null;
    },
  };
  return inst;
}
