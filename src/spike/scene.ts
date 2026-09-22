/**
 * S0 stability spike scene — shared by the spike page and the headless
 * scenario tests so both exercise exactly the same production path:
 *   JSON -> model/validate -> model/attach.resolveAttachments
 *        -> physics/compound.buildCompound (+ physics/terrain, physics/cargo)
 * No hand-assembled bodies.
 */

import { resolveAttachments, type CompoundSpec } from '../model/attach';
import type { CartDesign } from '../model/cart';
import type { LevelDef } from '../model/level';
import { spawnPineapple } from '../physics/cargo';
import { buildCompound, type CartInstance } from '../physics/compound';
import type { BodyHandle, PhysicsWorld } from '../physics/engine';
import { buildTerrain } from '../physics/terrain';
import { loadSpikeCart, loadSpikeLevel } from './data';

export { loadOpenBedCart, loadSpikeCart, loadSpikeLevel } from './data';

export interface SpikeScene {
  level: LevelDef;
  design: CartDesign;
  spec: CompoundSpec;
  cart: CartInstance;
  ground: BodyHandle;
  pineapples: BodyHandle[];
  /** The cart's chassis (the rigid body the wheels hang off). */
  chassis: BodyHandle;
  /** One fixed step: drive + physics. */
  step(): void;
}

export interface SpikeOptions {
  design?: CartDesign;
  level?: LevelDef;
  pineapples?: number;
  /** Override where design px (0,0) lands (metres). */
  cartStart?: { x: number; y: number };
}

/** Deterministic PRNG (mulberry32) for pineapple spawn jitter/rotation. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSpikeScene(world: PhysicsWorld, opts: SpikeOptions = {}): SpikeScene {
  const level = opts.level ?? loadSpikeLevel();
  const design = opts.design ?? loadSpikeCart();
  const spec = resolveAttachments(design);
  if (!spec.valid) throw new Error(`spike cart invalid: ${JSON.stringify(spec.errors)}`);

  const ground = buildTerrain(world, level.terrain);
  const start = opts.cartStart ?? level.cartStart;
  const cart = buildCompound(world, spec, start);

  // Drop the pineapples into the bed: 7 per row, rows stacked upward.
  const rand = mulberry32(15);
  const pineapples: BodyHandle[] = [];
  const count = opts.pineapples ?? 15;
  for (let i = 0; i < count; i++) {
    const col = i % 7;
    const row = Math.floor(i / 7);
    const x = start.x + 0.6 + col * 0.75 + (rand() - 0.5) * 0.1;
    const y = start.y - 0.5 - row * 0.75;
    pineapples.push(spawnPineapple(world, { x, y }, rand() * Math.PI * 2));
  }

  const chassisSpec = spec.bodies.find((b) => b.kind === 'rigid');
  const chassis = chassisSpec && cart.bodies.get(chassisSpec.id);
  if (chassis === undefined) throw new Error('spike cart has no chassis body');

  return {
    level,
    design,
    spec,
    cart,
    ground,
    pineapples,
    chassis,
    step() {
      cart.preStep();
      world.step();
    },
  };
}

/**
 * Pineapples still in the bed: inside the chassis-local box spanning the
 * spike cart's bed (design px x 0..180, up to 120 px above it), with margin.
 */
export function countAboard(world: PhysicsWorld, scene: SpikeScene): number {
  const spec = scene.spec.bodies.find((b) => b.kind === 'rigid')!;
  const t = world.getTransform(scene.chassis);
  const c = Math.cos(-t.angle);
  const s = Math.sin(-t.angle);
  return scene.pineapples.filter((p) => {
    const q = world.getTransform(p);
    const dx = q.x - t.x;
    const dy = q.y - t.y;
    // back into design-local metres (design px (0,0) = the bed's left end)
    const lx = c * dx - s * dy + spec.origin.x;
    const ly = s * dx + c * dy + spec.origin.y;
    return lx > -0.2 && lx < 6.2 && ly < 0.2 && ly > -4;
  }).length;
}
