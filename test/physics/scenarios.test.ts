/**
 * Headless physics scenarios (PLAN.md "Testing"): Node + the same
 * box2d3-wasm compat build the browser uses, driven through the production
 * path (JSON -> validate -> resolveAttachments -> compound.ts).
 *
 * These guard welding / joints / cargo behaviour against regressions a
 * visual check would not catch. Thresholds were measured on box2d3-wasm
 * 5.2.0 and carry headroom; see the per-test comments.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { PhysicsWorld, type BodyHandle } from '../../src/physics/engine';
import { PINEAPPLE_MATERIAL, PINEAPPLE_RADIUS } from '../../src/physics/cargo';
import { buildTerrain } from '../../src/physics/terrain';
import { countAboard, createSpikeScene, loadOpenBedCart, loadSpikeLevel, type SpikeScene } from '../../src/spike/scene';
import type { DriveDirection } from '../../src/physics/compound';

let worlds: PhysicsWorld[] = [];
async function world(): Promise<PhysicsWorld> {
  const w = await PhysicsWorld.create();
  worlds.push(w);
  return w;
}
afterEach(() => {
  worlds.forEach((w) => w.destroy());
  worlds = [];
});

/**
 * Golden run: full throttle for 3 s (180 steps) from rest on the flat.
 * Measured 22.385 m on box2d3-wasm 5.2.0 (compat). The tolerance (~2%)
 * absorbs harmless float differences; a change in welding, drive torque,
 * speed cap or friction moves it by metres.
 */
const GOLDEN_STEPS = 180;
const GOLDEN_DX = 22.385;
const GOLDEN_TOLERANCE = 0.5;

/** Flat stretch of the spike level, well left of the washboard (x 20..32). */
const FLAT_START = { x: -55, y: 8.2 };

const chassisOf = (scene: SpikeScene): BodyHandle => scene.chassis;

function maxJointGap(w: PhysicsWorld): number {
  let g = 0;
  for (const j of w.jointHandles()) {
    const { a, b } = w.getJointAnchors(j);
    g = Math.max(g, Math.hypot(a.x - b.x, a.y - b.y));
  }
  return g;
}

/**
 * Drive at ~`cruise` m/s (bang-bang) for `distance` m, brake to a stop with
 * reverse drive, then coast. Returns the chassis x travelled.
 */
function cruiseAndStop(w: PhysicsWorld, scene: SpikeScene, cruise: number, distance: number, steps: number): number {
  const chassis = chassisOf(scene);
  const start = w.getTransform(chassis).x;
  let phase = 0;
  for (let s = 0; s < steps; s++) {
    const x = w.getTransform(chassis).x - start;
    const v = w.getLinearVelocity(chassis).x;
    let dir: DriveDirection = 0;
    if (s < 90) dir = 0; // let the load settle first
    else if (phase === 0) {
      dir = v < cruise ? 1 : 0;
      if (x > distance) phase = 1;
    } else if (phase === 1) {
      dir = v > 0.3 ? -1 : 0;
      if (v <= 0.3) phase = 2;
    }
    scene.cart.setDrive(dir);
    scene.step();
  }
  return w.getTransform(chassis).x - start;
}

describe('S0 physics scenarios', () => {
  it('load settles: all 15 pineapples come to rest in the bed and sleep', async () => {
    const w = await world();
    const scene = createSpikeScene(w);
    for (let s = 0; s < 180; s++) scene.step();
    expect(countAboard(w, scene)).toBe(15);
    // measured: all asleep by t = 2 s
    expect(scene.pineapples.filter((p) => w.isAwake(p))).toHaveLength(0);
    expect(maxJointGap(w)).toBeLessThan(0.01);
  });

  it('stability: spike cart shuttles over the washboard for 60 s without joint divergence', async () => {
    const w = await world();
    const scene = createSpikeScene(w);
    const chassis = chassisOf(scene);
    let peakGap = 0;
    let peakSpeed = 0;
    let dir: DriveDirection = 0;
    // 60 s: full throttle back and forth between x 0 and 90 (washboard,
    // ramp and drop included; stays clear of the end walls), then brake and
    // settle for the last 10 s.
    for (let s = 0; s < 60 * 60; s++) {
      const x = w.getTransform(chassis).x;
      const vx = w.getLinearVelocity(chassis).x;
      if (s < 120) dir = 0;
      else if (s >= 50 * 60) dir = vx > 0.3 ? -1 : vx < -0.3 ? 1 : 0;
      else if (dir === 0) dir = 1;
      else if (dir === 1 && x > 90) dir = -1;
      else if (dir === -1 && x < 0) dir = 1;
      scene.cart.setDrive(dir);
      scene.step();
      peakGap = Math.max(peakGap, maxJointGap(w));
      for (const h of w.bodyHandles()) {
        const t = w.getTransform(h);
        if (!Number.isFinite(t.x) || !Number.isFinite(t.y) || !Number.isFinite(t.angle)) {
          throw new Error(`body ${h} went non-finite at step ${s}`);
        }
        const v = w.getLinearVelocity(h);
        peakSpeed = Math.max(peakSpeed, Math.hypot(v.x, v.y));
      }
    }
    // Soft-step joints stretch briefly on ~19 m/s impacts (measured peak
    // 0.109 m) and always pull back; divergence would show as a growing or
    // residual gap.
    expect(peakGap).toBeLessThan(0.2);
    expect(maxJointGap(w)).toBeLessThan(0.01); // measured 0.0003 after settling
    expect(peakSpeed).toBeLessThan(30); // measured ~19 m/s (motor cap + ramp drop)
    // cart is upright and still on the course
    const t = w.getTransform(chassis);
    expect(Math.abs(t.angle)).toBeLessThan(0.5);
    expect(t.x).toBeGreaterThan(-60);
    expect(t.x).toBeLessThan(118);
    expect(t.y).toBeLessThan(10);
  });

  it('washboard spill: a flat open bed loses its pineapples on the washboard (but not on the flat)', async () => {
    const run = async (onFlat: boolean) => {
      const w = await world();
      const scene = createSpikeScene(w, { design: loadOpenBedCart(), ...(onFlat ? { cartStart: FLAT_START } : {}) });
      // cruise ~3.5 m/s over 36 m (level start: across all nine bumps), brake
      cruiseAndStop(w, scene, 3.5, 36, 60 * 20);
      return countAboard(w, scene);
    };
    const flat = await run(true);
    const wash = await run(false);
    // measured: flat keeps 5, washboard keeps 0
    expect(flat).toBeGreaterThanOrEqual(3);
    expect(wash).toBeLessThanOrEqual(2);
    expect(wash).toBeLessThan(flat);
  });

  it('rolling resistance stops a pineapple on the flat (no infinite rolling)', async () => {
    const w = await world();
    buildTerrain(w, loadSpikeLevel().terrain);
    const p = w.createBody({
      type: 'dynamic',
      position: { x: -40, y: 10 - PINEAPPLE_RADIUS },
      linearVelocity: { x: 3, y: 0 },
      angularVelocity: 3 / PINEAPPLE_RADIUS,
      bullet: true,
    });
    w.addCircle(p, { x: 0, y: 0 }, PINEAPPLE_RADIUS, PINEAPPLE_MATERIAL);
    let stoppedAt = -1;
    for (let s = 0; s < 60 * 15; s++) {
      w.step();
      if (stoppedAt < 0 && Math.abs(w.getLinearVelocity(p).x) < 0.02) stoppedAt = w.simTime;
    }
    // measured with rollingResistance 0.1: stops after 4.45 s / 6.7 m
    expect(stoppedAt).toBeGreaterThan(2);
    expect(stoppedAt).toBeLessThan(8);
    expect(w.getTransform(p).x + 40).toBeGreaterThan(3);
    expect(w.getTransform(p).x + 40).toBeLessThan(12);
  });

  it('golden: spike cart on flat ground reaches the expected x after N steps', async () => {
    const w = await world();
    const scene = createSpikeScene(w, { cartStart: FLAT_START });
    const chassis = chassisOf(scene);
    for (let s = 0; s < 60; s++) scene.step(); // settle
    const x0 = w.getTransform(chassis).x;
    scene.cart.setDrive(1);
    for (let s = 0; s < GOLDEN_STEPS; s++) scene.step();
    const dx = w.getTransform(chassis).x - x0;
    expect(dx).toBeGreaterThan(GOLDEN_DX - GOLDEN_TOLERANCE);
    expect(dx).toBeLessThan(GOLDEN_DX + GOLDEN_TOLERANCE);
  });
});
