/**
 * S1 headless scenarios (PLAN.md "Testing strategy"): full runs through the
 * run controller in Node + box2d3-wasm, production path end to end
 * (JSON -> validate -> resolveAttachments -> compound.ts, funnel, goal,
 * lifecycle events). Deterministic: fixed steps, seeded spawns, no wall clock.
 * Measured values are on box2d3-wasm 5.2.0 (compat).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { LevelDef } from '../../src/model/level';
import type { RunEvent } from '../../src/model/runEvents';
import { PhysicsWorld } from '../../src/physics/engine';
import { LEVEL_ALL_LOST_SECONDS, RunController } from '../../src/run/controller';
import { loadFixtureCart, loadFlatGoalLevel, loadOpenBedCart } from '../../src/run/fixtures';
import { loadSpikeLevel } from '../../src/spike/data';
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

/** Start, let the load settle in the funnel for 1 s, Release, let it drop for 3 s. */
function startAndLoad(rc: RunController): void {
  rc.start();
  for (let i = 0; i < 60; i++) rc.step();
  rc.release();
  for (let i = 0; i < 180; i++) rc.step();
}

/** Drive right (full throttle, or holding `cruise` m/s) until the run ends or `maxSteps`. */
function driveToEnd(w: PhysicsWorld, rc: RunController, cruise: number | null, maxSteps = 60 * 60): void {
  const wheel = rc.cart.wheelBodies[0]!;
  for (let n = 0; rc.phase !== 'ended' && n < maxSteps; n++) {
    const dir: DriveDirection = cruise === null ? 1 : rc.cartLost ? 0 : w.getLinearVelocity(wheel).x < cruise ? 1 : 0;
    rc.setDrive(dir);
    rc.step();
  }
}

function record(rc: RunController): RunEvent[] {
  const out: RunEvent[] = [];
  rc.on((e) => out.push(e));
  return out;
}

describe('S1 run scenarios', () => {
  it('full run at full throttle: the cart crashes into the blender pit, 14 of 15 delivered (one bounces back out)', async () => {
    const w = await world();
    const rc = new RunController(w, loadFixtureCart(), loadFlatGoalLevel());
    const events = record(rc);
    startAndLoad(rc);
    expect(rc.aboard).toBe(15);
    driveToEnd(w, rc, null);
    expect(events.map((e) => e.type)).toEqual(['started', 'released', 'goalReached']);
    const goal = events[2] as Extract<RunEvent, { type: 'goalReached' }>;
    // measured: 8.683 s, 14 delivered (the one left bounces back over the goal line)
    console.info(`[S1 full] goal ${goal.simTime.toFixed(3)} s, delivered ${goal.delivered}`);
    expect(goal.delivered).toBe(14);
    expect(goal.simTime).toBeGreaterThan(8.683 - 0.25);
    expect(goal.simTime).toBeLessThan(8.683 + 0.25);
    expect(rc.delivered).toBe(goal.delivered);
    expect(rc.phase).toBe('ended');
    expect(rc.simTime()).toBe(goal.simTime);
  });

  it('full run at a gentle 3 m/s: the cart rolls into the pit and delivers all 15', async () => {
    const w = await world();
    const rc = new RunController(w, loadFixtureCart(), loadFlatGoalLevel());
    const events = record(rc);
    startAndLoad(rc);
    driveToEnd(w, rc, 3);
    expect(events.map((e) => e.type)).toEqual(['started', 'released', 'goalReached']);
    const goal = events.at(-1) as Extract<RunEvent, { type: 'goalReached' }>;
    console.info(`[S1 cruise3] goal ${goal.simTime.toFixed(3)} s, delivered ${goal.delivered}`);
    // measured: 17.25 s, 15 delivered
    expect(goal.delivered).toBe(15);
    expect(goal.simTime).toBeGreaterThan(17.25 - 0.3);
    expect(goal.simTime).toBeLessThan(17.25 + 0.3);
  });

  it('a 5 m/s cruise tips the cart on the blender blade: all 15 delivered', async () => {
    const w = await world();
    const rc = new RunController(w, loadFixtureCart(), loadFlatGoalLevel());
    const events = record(rc);
    startAndLoad(rc);
    driveToEnd(w, rc, 5);
    expect(events.map((e) => e.type)).toEqual(['started', 'released', 'goalReached']);
    const goal = events.at(-1) as Extract<RunEvent, { type: 'goalReached' }>;
    console.info(`[S1 cruise5] goal ${goal.simTime.toFixed(3)} s, delivered ${goal.delivered}`);
    // measured: 13.05 s, 15 delivered
    expect(goal.delivered).toBe(15);
    expect(goal.simTime).toBeGreaterThan(13.05 - 0.3);
    expect(goal.simTime).toBeLessThan(13.05 + 0.3);
  });

  it('is deterministic: two identical runs emit identical events', async () => {
    const run = async () => {
      const w = await world();
      const rc = new RunController(w, loadOpenBedCart(), loadFlatGoalLevel());
      const events = record(rc);
      startAndLoad(rc);
      driveToEnd(w, rc, 5);
      return events;
    };
    expect(await run()).toEqual(await run());
  });

  it('pineappleLost: an open bed spills on the way, losses are reported once each and delivered counts what is past the goal line', async () => {
    const w = await world();
    const rc = new RunController(w, loadOpenBedCart(), loadFlatGoalLevel());
    const events = record(rc);
    startAndLoad(rc);
    driveToEnd(w, rc, 5);
    const lost = events.filter((e): e is Extract<RunEvent, { type: 'pineappleLost' }> => e.type === 'pineappleLost');
    const goal = events.at(-1) as Extract<RunEvent, { type: 'goalReached' }>;
    expect(goal.type).toBe('goalReached');
    // measured: 7 lost (first at 6 s), goal at 11.917 s with 9 delivered, 8 remaining.
    // S8a: was 11 lost / 4 delivered at the old 0.9 pineapple–wheel friction
    // (the load now slides off the wheels instead of being thrown by them);
    // the goal time is unchanged to the step.
    expect(lost.length).toBe(7);
    expect(new Set(lost.map((e) => e.pineappleId)).size).toBe(lost.length);
    lost.forEach((e, i) => {
      expect(e.remaining).toBe(15 - (i + 1));
      // lost rule is evaluated at the 1 Hz aboard checks, never before 3 s grounded
      expect(e.simTime).toBeGreaterThanOrEqual(3);
      expect(Number.isInteger(Math.round(e.simTime * 1e6) / 1e6)).toBe(true);
    });
    expect(rc.remaining).toBe(15 - lost.length);
    // lost is advisory in level runs: delivered = every pineapple past the
    // line (lost or not), so it is NOT bounded by remaining
    const lineX = loadFlatGoalLevel().goal.lineX;
    const past = rc.pineappleStates().filter((p) => p.alive && w.getTransform(p.handle).x > lineX).length;
    console.info(`[S1 spill] lost ${lost.length} (first at ${lost[0]?.simTime}), goal ${goal.simTime.toFixed(3)} s, delivered ${goal.delivered}, remaining ${rc.remaining}`);
    expect(goal.delivered).toBe(past);
    expect(goal.delivered).toBe(9);
    expect(goal.simTime).toBeGreaterThan(11.917 - 0.3);
    expect(goal.simTime).toBeLessThan(11.917 + 0.3);
  });

  it('pineappleLost: a cart parked away from the funnel loses the whole load 3 s after it lands (including one resting against a wheel)', async () => {
    const w = await world();
    const level: LevelDef = { ...loadFlatGoalLevel(), cartStart: { x: 14, y: 8.2 } };
    const rc = new RunController(w, loadFixtureCart(), level);
    const events = record(rc);
    startAndLoad(rc); // up to 3 s after Release
    for (let i = 0; i < 240; i++) rc.step(); // 7 s
    const lost = events.filter((e) => e.type === 'pineappleLost');
    expect(lost).toHaveLength(15);
    expect(rc.remaining).toBe(0);
    expect(rc.aboard).toBe(0);
    // measured: 9 lost at 5 s, the rest (rolled further / settled on others) at 6 s:
    // grounded at the 2 s check -> lost 3 s later
    for (const e of lost) expect([5, 6]).toContain(Math.round(e.simTime * 1e6) / 1e6);
    // lost pineapples are still bodies in the world (only the kill-plane removes)
    expect(rc.pineappleStates().every((p) => p.alive && w.hasBody(p.handle))).toBe(true);
  });

  const holeUnderFunnel = (): LevelDef => {
    const base = loadFlatGoalLevel();
    const main = base.terrain.spans.find((s) => s.id === 'main')!;
    // cut an 8 m hole (x 1..9, longer than the 6 m cart) under the funnel;
    // the cart starts right of it
    return {
      ...base,
      cartStart: { x: 12, y: 8.2 },
      terrain: {
        ...base.terrain,
        spans: [
          ...base.terrain.spans.filter((s) => s.id !== 'main'),
          { id: 'before-gap', points: [{ x: -9.9, y: 10 }, { x: 1, y: 10 }] },
          { id: 'after-gap', points: [{ x: 9, y: 10 }, ...main.points.slice(1)] },
        ],
      },
    };
  };

  it('kill-plane: pineapples dropped through a gap are removed and lost; with nothing left to deliver the level run ends with allLost (S6T #16)', async () => {
    const w = await world();
    const rc = new RunController(w, loadFixtureCart(), holeUnderFunnel());
    const events = record(rc);
    startAndLoad(rc);
    for (let i = 0; i < 60 && rc.phase !== 'ended'; i++) rc.step();
    const lost = events.filter((e): e is Extract<RunEvent, { type: 'pineappleLost' }> => e.type === 'pineappleLost');
    expect(lost).toHaveLength(15);
    const lastRemovedAt = lost.at(-1)!.simTime;
    // falling 20 m to killY 30 takes ~2.5 s: most are removed by the kill-plane
    // before the 3 s grounded rule could apply (a few graze the gap's edge first)
    expect(lost.filter((e) => e.simTime < 3).length).toBeGreaterThanOrEqual(10);
    expect(rc.pineappleStates().every((p) => !p.alive && !w.hasBody(p.handle))).toBe(true);
    for (let i = 0; i < 5 * 60 && rc.phase !== 'ended'; i++) rc.step();
    const end = events.at(-1)!;
    expect(end.type).toBe('allLost');
    expect(end.simTime).toBeCloseTo(lastRemovedAt + LEVEL_ALL_LOST_SECONDS, 6);
    expect(rc.phase).toBe('ended');
  });

  it('kill-plane: a cart driven into a hole is removed without breaking the run', async () => {
    const w = await world();
    const rc = new RunController(w, loadFixtureCart(), holeUnderFunnel());
    const events = record(rc);
    rc.start(); // no Release: the load stays in the funnel
    for (let i = 0; i < 60; i++) rc.step();
    const bodiesBefore = w.bodyHandles().length;
    for (let n = 0; n < 60 * 10 && !rc.cartLost; n++) {
      rc.setDrive(-1);
      rc.step();
    }
    expect(rc.cartLost).toBe(true);
    expect(w.bodyHandles().length).toBe(bodiesBefore - rc.spec.bodies.length);
    expect(rc.rightmostCartBody()).toBeNull();
    const cam = rc.camera.position;
    for (let i = 0; i < 60; i++) rc.step(); // stepping without a cart is fine; camera holds
    expect(rc.camera.position).toEqual(cam);
    expect(rc.phase).toBe('started');
    expect(events.map((e) => e.type)).toEqual(['started']);
    expect(rc.giveUp()).toBe(true);
  });

  it('give up mid-run: gaveUp carries sim time since Release, then the run is inert', async () => {
    const w = await world();
    const rc = new RunController(w, loadFixtureCart(), loadFlatGoalLevel());
    const events = record(rc);
    startAndLoad(rc);
    rc.setDrive(1);
    for (let i = 0; i < 120; i++) rc.step();
    expect(rc.giveUp()).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['started', 'released', 'gaveUp']);
    expect(events[2]!.simTime).toBeCloseTo(300 / 60, 9);
    expect(rc.phase).toBe('ended');

    // after the end: no more events, frozen clock, no drive, no second end
    const wheel = rc.cart.wheelBodies[0]!;
    rc.setDrive(1);
    for (let i = 0; i < 120; i++) rc.step();
    expect(w.getAngularVelocity(wheel)).toBeLessThan(20); // coasting, no torque applied
    expect(rc.simTime()).toBeCloseTo(5, 9);
    expect(rc.giveUp()).toBe(false);
    expect(rc.release()).toBe(false);
    expect(rc.start()).toBe(false);
    expect(events).toHaveLength(3);
  });

  it('give up before Release reports simTime 0; lifecycle guards hold', async () => {
    const w = await world();
    const rc = new RunController(w, loadFixtureCart(), loadFlatGoalLevel());
    const events = record(rc);
    // idle: physics is off, release is refused
    rc.step();
    expect(w.steps).toBe(0);
    expect(rc.release()).toBe(false);
    expect(rc.start()).toBe(true);
    expect(rc.start()).toBe(false);
    for (let i = 0; i < 90; i++) rc.step();
    expect(rc.simTime()).toBe(0);
    // plug still in: nothing has left the funnel
    expect(rc.funnel.plug).not.toBeNull();
    expect(rc.giveUp()).toBe(true);
    expect(events).toEqual([
      { type: 'started', simTime: 0 },
      { type: 'gaveUp', simTime: 0 },
    ]);
  });

  it('camera follows the right-most cart body with smoothing 0.1 and a −100 px offset', async () => {
    const w = await world();
    const rc = new RunController(w, loadFixtureCart(), loadFlatGoalLevel());
    startAndLoad(rc);
    rc.setDrive(1);
    for (let i = 0; i < 240; i++) rc.step();
    rc.setDrive(0);
    for (let i = 0; i < 240; i++) rc.step();
    const rm = rc.rightmostCartBody()!;
    const maxX = Math.max(...rc.spec.bodies.map((b) => w.getTransform(rc.cart.bodies.get(b.id)!).x));
    expect(rm.x).toBe(maxX);
    // once the cart has (nearly) stopped the camera converges on the target
    expect(rc.camera.position.x).toBeCloseTo(rm.x - 100 / 30, 1);
  });

  it('S0 stability gate re-run: funnel + goal integration, 60 s washboard shuttle, no joint divergence', async () => {
    const w = await world();
    // S8a: the goal (blender pit at x 115) is moved out of reach. With the
    // 0.3 pineapple–wheel friction the load mostly stays aboard (at 0.9 the
    // wheels flung all 15 off), and a pineapple that leaves the bed at ~12 s
    // rolls down the washboard into the pit — which correctly ENDS the level
    // run and would cut this 60 s shuttle short. The goal rule still runs
    // every step; it just cannot fire. The cart itself is checked against
    // x 115 below.
    const spike = loadSpikeLevel();
    const level = { ...spike, goal: { sensor: { ...spike.goal.sensor, x: spike.goal.sensor.x + 1000 }, lineX: spike.goal.lineX + 1000 } };
    const rc = new RunController(w, loadFixtureCart(), level);
    const events = record(rc);
    rc.start();
    for (let i = 0; i < 60; i++) rc.step();
    rc.release();
    const chassisSpec = rc.spec.bodies.find((b) => b.kind === 'rigid')!;
    const chassis = rc.cart.bodies.get(chassisSpec.id)!;
    const maxJointGap = () =>
      Math.max(0, ...w.jointHandles().map((j) => {
        const { a, b } = w.getJointAnchors(j);
        return Math.hypot(a.x - b.x, a.y - b.y);
      }));
    let peakGap = 0;
    let peakSpeed = 0;
    let cartMaxX = -Infinity;
    let dir: DriveDirection = 0;
    // identical drive script to the S0 stability test (test/physics/scenarios.test.ts)
    for (let s = 0; s < 60 * 60; s++) {
      const x = w.getTransform(chassis).x;
      const vx = w.getLinearVelocity(chassis).x;
      if (s < 120) dir = 0;
      else if (s >= 50 * 60) dir = vx > 0.3 ? -1 : vx < -0.3 ? 1 : 0;
      else if (dir === 0) dir = 1;
      else if (dir === 1 && x > 90) dir = -1;
      else if (dir === -1 && x < 0) dir = 1;
      rc.setDrive(dir);
      rc.step();
      cartMaxX = Math.max(cartMaxX, rc.rightmostCartBody()?.x ?? -Infinity);
      peakGap = Math.max(peakGap, maxJointGap());
      for (const h of w.bodyHandles()) {
        const t = w.getTransform(h);
        if (!Number.isFinite(t.x) || !Number.isFinite(t.y) || !Number.isFinite(t.angle)) {
          throw new Error(`body ${h} went non-finite at step ${s}`);
        }
        const v = w.getLinearVelocity(h);
        peakSpeed = Math.max(peakSpeed, Math.hypot(v.x, v.y));
      }
    }
    // same thresholds as the S0 gate (measured here: see report)
    expect(peakGap).toBeLessThan(0.2);
    expect(maxJointGap()).toBeLessThan(0.01);
    expect(peakSpeed).toBeLessThan(30);
    const t = w.getTransform(chassis);
    expect(Math.abs(w.getLinearVelocity(chassis).x)).toBeLessThan(0.5);
    expect(t.x).toBeGreaterThan(-60);
    expect(t.x).toBeLessThan(118);
    expect(t.y).toBeLessThan(10);
    // the shuttle never reaches the blender at x 115, and the cart never leaves the world
    expect(cartMaxX).toBeLessThan(115);
    expect(events.some((e) => e.type === 'goalReached')).toBe(false);
    expect(rc.phase).toBe('released');
    expect(rc.cartLost).toBe(false);
    console.info(`[S1 stability] peakGap=${peakGap.toFixed(4)} finalGap=${maxJointGap().toFixed(5)} peakSpeed=${peakSpeed.toFixed(2)} lost=${rc.lostCount}`);
  });
});
