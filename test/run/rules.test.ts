/**
 * S1 run-rule scenarios added in audit fix cycle 1: the level-mode lost flag
 * is advisory, base-only swept goal sensing, solid props, the narrowed
 * kill-plane, run modes (endless `allLost`) and terminal-event re-entrancy.
 * Headless, deterministic (fixed steps, seeded spawns).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CartDesign } from '../../src/model/cart';
import type { LevelDef, Rect } from '../../src/model/level';
import type { RunEvent } from '../../src/model/runEvents';
import { PINEAPPLE_RADIUS } from '../../src/physics/cargo';
import type { DriveDirection } from '../../src/physics/compound';
import { PhysicsWorld } from '../../src/physics/engine';
import { RunController } from '../../src/run/controller';
import { loadFixtureCart, loadFlatGoalLevel } from '../../src/run/fixtures';
import { circleTouchesRect } from '../../src/run/shapes';

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

type Lost = Extract<RunEvent, { type: 'pineappleLost' }>;
type Goal = Extract<RunEvent, { type: 'goalReached' }>;

function record(rc: RunController): RunEvent[] {
  const out: RunEvent[] = [];
  rc.on((e) => out.push(e));
  return out;
}

/** Start, 1 s in the funnel, Release, `after` steps. */
function startAndRelease(rc: RunController, after = 0): void {
  rc.start();
  for (let i = 0; i < 60; i++) rc.step();
  rc.release();
  for (let i = 0; i < after; i++) rc.step();
}

function steps(rc: RunController, n: number, dir: DriveDirection = 0): void {
  for (let i = 0; i < n && rc.phase !== 'ended'; i++) {
    rc.setDrive(dir);
    rc.step();
  }
}

/** Fixture level with the cart parked on the far side of the blender (out of the way). */
function cartBeyondPit(): LevelDef {
  return { ...loadFlatGoalLevel(), cartStart: { x: 57, y: 2 } };
}

/** The pineapple furthest right (after the load has spilled on the ground). */
function rightmostPineapple(w: PhysicsWorld, rc: RunController): { id: number; handle: number } {
  const alive = rc.pineappleStates().filter((p) => p.alive);
  return alive.reduce((a, b) => (w.getTransform(b.handle).x > w.getTransform(a.handle).x ? b : a));
}

describe('level mode: lost is advisory', () => {
  it('a pineapple already reported lost can still be pushed into the blender: it ends the run and counts as delivered', async () => {
    const w = await world();
    // the load drops onto open ground near the pit (funnel at x 28), the cart
    // waits on the left, then bulldozes the spilled (lost) pile into the pit
    const level: LevelDef = { ...loadFlatGoalLevel(), funnel: { x: 28, y: 4.5 }, cartStart: { x: 10, y: 8.2 } };
    const rc = new RunController(w, loadFixtureCart(), level);
    const events = record(rc);
    startAndRelease(rc);
    steps(rc, 7 * 60); // everything spilled is lost by now (grounded 3 s outside the cart)
    const lostBefore = events.filter((e): e is Lost => e.type === 'pineappleLost');
    expect(lostBefore.length).toBe(15);
    expect(rc.phase).toBe('released'); // level runs continue after the last loss
    expect(events.some((e) => e.type === 'allLost')).toBe(false);

    steps(rc, 30 * 60, 1);
    const goal = events.at(-1) as Goal;
    expect(goal.type).toBe('goalReached');
    // every counted pineapple was lost before; lost ones still count
    const lineX = level.goal.lineX;
    const past = rc.pineappleStates().filter((p) => p.alive && w.getTransform(p.handle).x > lineX);
    expect(past.length).toBeGreaterThan(0);
    expect(past.every((p) => p.lost)).toBe(true);
    expect(goal.delivered).toBe(past.length);
    expect(goal.delivered).toBeGreaterThan(rc.remaining); // remaining is 0: lost is advisory
    console.info(`[S1 late delivery] goal at ${goal.simTime.toFixed(3)} s, delivered ${goal.delivered} (all previously lost)`);
  });
});

describe('goal: base sensor, swept', () => {
  it('a pineapple flying through the upper pit does NOT end the run; it ends when it reaches the base', async () => {
    const w = await world();
    const level = cartBeyondPit();
    const rc = new RunController(w, loadFixtureCart(), level);
    const events = record(rc);
    startAndRelease(rc, 120);
    const shot = rightmostPineapple(w, rc);
    w.setLinearVelocity(shot.handle, { x: 15, y: 0 });
    const sensor = level.goal.sensor;
    let upperPitSteps = 0;
    let atGoal: { x: number; y: number } | null = null;
    for (let n = 0; n < 20 * 60 && rc.phase !== 'ended'; n++) {
      rc.step();
      const t = w.getTransform(shot.handle);
      if (rc.events.length > 0 && rc.events.at(-1)!.type === 'goalReached') atGoal = { x: t.x, y: t.y };
      else if (t.x > sensor.x && t.x < sensor.x + sensor.width && t.y < sensor.y - 2) upperPitSteps++;
    }
    // it spent time in the upper part of the pit (where the old sensor volume fired) without ending the run
    expect(upperPitSteps).toBeGreaterThan(10);
    const goal = events.at(-1) as Goal;
    expect(goal.type).toBe('goalReached');
    expect(atGoal).not.toBeNull();
    // ...and the run ended only when it reached the base
    expect(atGoal!.y).toBeGreaterThan(sensor.y - PINEAPPLE_RADIUS - 0.5);
    expect(goal.delivered).toBe(1);
    console.info(`[S1 upper pit] ${upperPitSteps} steps above the base, goal at ${goal.simTime.toFixed(3)} s, y ${atGoal!.y.toFixed(2)}`);
  });

  it('a fast pineapple crossing a thin sensor between two steps is detected (swept test)', async () => {
    // pass 1: record the trajectory with the sensor out of the way
    const run = async (sensor: Rect) => {
      const w = await world();
      const level: LevelDef = { ...cartBeyondPit(), goal: { sensor, lineX: sensor.x } };
      const rc = new RunController(w, loadFixtureCart(), level);
      const events = record(rc);
      startAndRelease(rc, 120);
      const shot = rightmostPineapple(w, rc);
      w.setLinearVelocity(shot.handle, { x: 80, y: 0 });
      const path: Array<{ x: number; y: number }> = [];
      for (let n = 0; n < 60 && rc.phase !== 'ended'; n++) {
        rc.step();
        const t = w.getTransform(shot.handle);
        path.push({ x: t.x, y: t.y });
      }
      return { events, path };
    };
    const away: Rect = { x: -500, y: 0, width: 0.02, height: 1 };
    const { path } = await run(away);
    const r = PINEAPPLE_RADIUS;
    const width = 0.02;
    // pick a gap between two consecutive samples on the flat where no sample
    // touches a thin vertical strip placed in the middle of it
    let gap: [{ x: number; y: number }, { x: number; y: number }] | null = null;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      if (a.x > 12 && b.x < 40 && b.x - a.x > 2 * r + width + 0.1) {
        gap = [a, b];
        break;
      }
    }
    expect(gap).not.toBeNull();
    const [a, b] = gap!;
    const sensor: Rect = { x: (a.x + b.x) / 2 - width / 2, y: Math.min(a.y, b.y) - 1, width, height: 2 };
    // no sampled pose ever overlaps the strip: a point-in-time check would miss it
    expect(path.some((p) => circleTouchesRect(p, r, sensor))).toBe(false);
    const second = await run(sensor);
    expect(second.path.slice(0, second.path.length)).toEqual(path.slice(0, second.path.length));
    const goal = second.events.at(-1) as Goal;
    expect(goal.type).toBe('goalReached');
    expect(goal.delivered).toBe(1);
    // detected on the step that crossed it
    expect(second.path.at(-1)!.x).toBeCloseTo(b.x, 9);
    console.info(`[S1 swept] ${(b.x - a.x).toFixed(3)} m per step across a ${width} m strip at x ${sensor.x.toFixed(2)}`);
  });
});

describe('solid props', () => {
  const wallLevel = (solid: boolean): LevelDef => ({
    ...loadFlatGoalLevel(),
    funnel: { x: -5, y: 4.5 },
    props: [{ id: 'wall', art: 'blender', position: { x: 21, y: 8.5 }, solid, size: { x: 2, y: 3 } }],
  });

  it('a solid prop is a static body the cart collides with (and bounces off); a non-solid one is visual only', async () => {
    const drive = async (solid: boolean) => {
      const w = await world();
      const rc = new RunController(w, loadFixtureCart(), wallLevel(solid));
      expect(rc.props.length).toBe(solid ? 1 : 0);
      rc.start();
      let maxRight = -Infinity;
      let bounced = false;
      let hit = false;
      for (let n = 0; n < 6 * 60; n++) {
        rc.setDrive(1);
        rc.step();
        const box = rc.cartBounds()!;
        maxRight = Math.max(maxRight, box.maxX);
        if (box.maxX > 19.8) hit = true;
        const vx = w.getLinearVelocity(rc.cart.bodies.get(rc.chassisId)!).x;
        if (hit && vx < -0.2) bounced = true;
      }
      return { maxRight, bounced };
    };
    const solid = await drive(true);
    expect(solid.maxRight).toBeLessThan(20 + 0.05); // wall's left face at x 20
    expect(solid.bounced).toBe(true);
    const ghost = await drive(false);
    expect(ghost.maxRight).toBeGreaterThan(22);
  });

  it('the fixture blender (and its blade) are solid props: a full-throttle cart hits the blender and stays left of it', async () => {
    const w = await world();
    const level = loadFlatGoalLevel();
    const blender = level.props.find((p) => p.id === 'blender')!;
    expect(blender.solid).toBe(true);
    const rc = new RunController(w, loadFixtureCart(), level);
    expect(rc.props.map((p) => p.id)).toEqual(['blender', 'blender-blade']);
    startAndRelease(rc, 180);
    let maxRight = -Infinity;
    for (let n = 0; n < 20 * 60; n++) {
      rc.setDrive(1);
      rc.step();
      maxRight = Math.max(maxRight, rc.cartBounds()!.maxX);
    }
    const face = blender.position.x - blender.size!.x / 2;
    expect(maxRight).toBeGreaterThan(face - 0.3); // reached it
    expect(maxRight).toBeLessThan(face + 0.05); // never through it
  });
});

describe('kill-plane: only the chassis loses the cart', () => {
  /** Bed straw on two pinned wheels, plus a wheel hanging 3 m below the bed on a shock. */
  const shockCart: CartDesign = {
    version: 1,
    parts: [
      { id: 'A', kind: 'straw', a: { x: 0, y: 0 }, b: { x: 180, y: 0 } },
      { id: 'w1', kind: 'wheel', center: { x: 20, y: 0 }, radius: 22 },
      { id: 'w2', kind: 'wheel', center: { x: 160, y: 0 }, radius: 22 },
      { id: 'w3', kind: 'wheel', center: { x: 90, y: 90 }, radius: 22 },
      { id: 'k', kind: 'shock', a: { x: 90, y: 0 }, b: { x: 90, y: 90 } },
    ],
  };
  // flat ground y 10 with a 2 m hole under the shock wheel; killY 12 sits
  // between the ground and the dangling wheel's centre (~12.27)
  const holeLevel = (): LevelDef => {
    const base = loadFlatGoalLevel();
    return {
      ...base,
      cartStart: { x: 0, y: 10 - 22 / 30 },
      funnel: { x: 30, y: 4.5 },
      killY: 12,
      props: [],
      terrain: {
        ...base.terrain,
        spans: [
          { id: 'left-wall', points: [{ x: -10, y: 0 }, { x: -9.9, y: 10 }] },
          { id: 'before', points: [{ x: -9.9, y: 10 }, { x: 2, y: 10 }] },
          { id: 'after', points: [{ x: 4, y: 10 }, { x: 60, y: 10 }] },
        ],
      },
    };
  };

  it('a shock-mounted wheel dipping below killY is removed alone (with its shock); the cart keeps driving', async () => {
    const w = await world();
    const rc = new RunController(w, shockCart, holeLevel());
    const events = record(rc);
    const id = (part: string) => rc.spec.partBody.get(part)!;
    const h = (part: string) => rc.cart.bodies.get(id(part))!;
    const shock = rc.cart.shockJoints.get('k')!;
    expect(rc.chassisId).toBe(id('A'));
    expect(w.hasJoint(shock)).toBe(true);
    startAndRelease(rc, 30);
    expect(rc.cartLost).toBe(false);
    expect(rc.cartDamaged).toBe(true);
    expect(w.hasBody(h('w3'))).toBe(false);
    expect(w.hasJoint(shock)).toBe(false);
    for (const p of ['A', 'w1', 'w2']) expect(w.hasBody(h(p))).toBe(true);
    expect(rc.cartBodyHandles().sort()).toEqual([h('A'), h('w1'), h('w2')].sort());
    // still drivable (the survivors get the same direct torque)
    const x0 = w.getTransform(h('A')).x;
    steps(rc, 120, 1);
    expect(w.getAngularVelocity(h('w1'))).toBeGreaterThan(5);
    expect(w.getTransform(h('A')).x).toBeGreaterThan(x0 + 1);
    expect(rc.cartLost).toBe(false);
    expect(rc.rightmostCartBody()).not.toBeNull();
    expect(events.map((e) => e.type)).toEqual(['started', 'released']);
  });

  it('the chassis crossing killY removes the whole cart', async () => {
    const w = await world();
    // kill plane above the chassis (y ~9.27): the chassis crosses at once
    const rc = new RunController(w, shockCart, { ...holeLevel(), killY: 9 });
    startAndRelease(rc, 5);
    expect(rc.cartLost).toBe(true);
    expect(rc.cartBodyHandles()).toEqual([]);
    expect(rc.rightmostCartBody()).toBeNull();
    for (const b of rc.spec.bodies) expect(w.hasBody(rc.cart.bodies.get(b.id) ?? -1)).toBe(false);
  });
});

describe('run modes', () => {
  const parked = (): LevelDef => ({ ...loadFlatGoalLevel(), cartStart: { x: 14, y: 8.2 } });

  it('endless: the last loss ends the run with allLost (after the final pineappleLost), then nothing more; no goal-line exemption', async () => {
    const w = await world();
    // goal line far left: in a level run nothing here could be lost
    const level: LevelDef = { ...parked(), goal: { ...parked().goal, lineX: -100 } };
    const rc = new RunController(w, loadFixtureCart(), level, { mode: 'endless' });
    const events = record(rc);
    startAndRelease(rc);
    steps(rc, 10 * 60);
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'pineappleLost')).toHaveLength(15);
    expect(types.at(-1)).toBe('allLost');
    const last = events.at(-2) as Lost;
    expect(last.type).toBe('pineappleLost');
    expect(last.remaining).toBe(0);
    expect(events.at(-1)!.simTime).toBe(last.simTime);
    expect(rc.phase).toBe('ended');
    expect(rc.simTime()).toBe(last.simTime);
    const n = events.length;
    steps(rc, 120, 1);
    expect(rc.giveUp()).toBe(false);
    expect(events).toHaveLength(n);
  });

  it('level: losing every pineapple does not end the run', async () => {
    const w = await world();
    const rc = new RunController(w, loadFixtureCart(), parked());
    const events = record(rc);
    startAndRelease(rc);
    steps(rc, 10 * 60);
    expect(events.filter((e) => e.type === 'pineappleLost')).toHaveLength(15);
    expect(events.some((e) => e.type === 'allLost')).toBe(false);
    expect(rc.phase).toBe('released');
    expect(rc.giveUp()).toBe(true);
  });

  it('endless: the goal is ignored (a full-throttle run into the blender pit does not end it)', async () => {
    const w = await world();
    const rc = new RunController(w, loadFixtureCart(), loadFlatGoalLevel(), { mode: 'endless' });
    const events = record(rc);
    startAndRelease(rc, 180);
    steps(rc, 15 * 60, 1);
    expect(events.some((e) => e.type === 'goalReached')).toBe(false);
  });

  it('endless: kill-plane losses count towards allLost', async () => {
    const w = await world();
    const base = loadFlatGoalLevel();
    // same 8 m hole under the funnel as the kill-plane scenario, cart parked right of it
    const main = base.terrain.spans.find((s) => s.id === 'main')!;
    const level: LevelDef = {
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
    const rc = new RunController(w, loadFixtureCart(), level, { mode: 'endless' });
    const events = record(rc);
    startAndRelease(rc);
    steps(rc, 6 * 60);
    expect(events.filter((e) => e.type === 'pineappleLost')).toHaveLength(15);
    expect(events.at(-1)!.type).toBe('allLost');
  });
});

describe('terminal events are re-entrancy safe', () => {
  const parked = (): LevelDef => ({ ...loadFlatGoalLevel(), cartStart: { x: 14, y: 8.2 } });

  it('a listener giving up inside pineappleLost: gaveUp is the last event, even though more losses were due that step', async () => {
    const w = await world();
    const rc = new RunController(w, loadFixtureCart(), parked());
    const events: RunEvent[] = [];
    rc.on((e) => {
      events.push(e);
      if (e.type === 'pineappleLost') rc.giveUp();
    });
    startAndRelease(rc);
    steps(rc, 10 * 60);
    expect(events.map((e) => e.type)).toEqual(['started', 'released', 'pineappleLost', 'gaveUp']);
    expect(rc.events.map((e) => e.type)).toEqual(['started', 'released', 'pineappleLost', 'gaveUp']);
    // the other pineapples due that check were not marked lost after the end
    expect(rc.lostCount).toBe(1);
    expect(events[3]!.simTime).toBe(events[2]!.simTime);
  });

  it('endless: giving up on the last pineappleLost suppresses allLost', async () => {
    const w = await world();
    const rc = new RunController(w, loadFixtureCart(), parked(), { mode: 'endless' });
    const events: RunEvent[] = [];
    rc.on((e) => {
      events.push(e);
      if (e.type === 'pineappleLost' && e.remaining === 0) expect(rc.giveUp()).toBe(true);
    });
    startAndRelease(rc);
    steps(rc, 10 * 60);
    expect(events.at(-1)!.type).toBe('gaveUp');
    expect(events.some((e) => e.type === 'allLost')).toBe(false);
  });

  it('a listener calling giveUp / release / start inside goalReached changes nothing', async () => {
    const w = await world();
    const rc = new RunController(w, loadFixtureCart(), loadFlatGoalLevel());
    const events: RunEvent[] = [];
    const results: boolean[] = [];
    rc.on((e) => {
      events.push(e);
      if (e.type === 'goalReached') results.push(rc.giveUp(), rc.release(), rc.start());
    });
    startAndRelease(rc, 180);
    steps(rc, 20 * 60, 1);
    expect(events.at(-1)!.type).toBe('goalReached');
    expect(results).toEqual([false, false, false]);
    steps(rc, 60);
    expect(events.at(-1)!.type).toBe('goalReached');
  });
});

describe('kill-plane respects the goal line (level mode)', () => {
  it('a pineapple past the line that falls out of the world is not lost and still counts as delivered', async () => {
    const w = await world();
    const base = cartBeyondPit();
    // a bottomless pit (x 44..54): whatever rolls in falls to killY. The goal
    // sensor lies on the far rim.
    const level: LevelDef = {
      ...base,
      killY: 25,
      props: [],
      goal: { lineX: 44, sensor: { x: 54.1, y: 9.75, width: 9.8, height: 0.25 } },
      terrain: {
        ...base.terrain,
        spans: [
          base.terrain.spans[0]!,
          { id: 'approach', points: [{ x: -9.9, y: 10 }, { x: 44, y: 10 }] },
          { id: 'far', points: [{ x: 54, y: 10 }, { x: 64, y: 10 }] },
          { id: 'right-wall', points: [{ x: 64, y: 10 }, { x: 64.1, y: 0 }] },
        ],
      },
    };
    const rc = new RunController(w, loadFixtureCart(), level);
    const events = record(rc);
    startAndRelease(rc, 120);
    // first pineapple rolls into the bottomless pit
    // (fast, so it arrives before the 3 s lost rule could apply on the way)
    const first = rightmostPineapple(w, rc);
    w.setLinearVelocity(first.handle, { x: 30, y: 0 });
    steps(rc, 6 * 60);
    const state = rc.pineappleStates().find((p) => p.id === first.id)!;
    expect(state.alive).toBe(false); // removed by the kill-plane
    expect(state.lost).toBe(false); // ...but not lost: it had passed the goal line
    expect(events.some((e) => e.type === 'pineappleLost' && e.pineappleId === first.id)).toBe(false);
    // a second one is thrown across the pit onto the far-rim sensor
    const second = rightmostPineapple(w, rc);
    w.setLinearVelocity(second.handle, { x: 20, y: 0 });
    let jumped = false;
    for (let n = 0; n < 10 * 60 && rc.phase !== 'ended'; n++) {
      rc.step();
      if (!jumped && w.getTransform(second.handle).x > 42) {
        w.setLinearVelocity(second.handle, { x: 12, y: -6 });
        jumped = true;
      }
    }
    const goal = events.at(-1) as Goal;
    expect(goal.type).toBe('goalReached');
    // the one that fell out past the line + the one on the far rim
    expect(goal.delivered).toBe(2);
  });
});

describe('support is transitive from real contact (no mutual mid-air support)', () => {
  it('a packed cluster launched upward is slow at its apex exactly at an aboard check, yet no grounded timer starts', async () => {
    const w = await world();
    const base = loadFlatGoalLevel();
    const main = base.terrain.spans.find((s) => s.id === 'main')!;
    // a hole under the funnel (x 1..9) and a deep kill plane: nothing can land
    const level: LevelDef = {
      ...base,
      cartStart: { x: 12, y: 8.2 },
      killY: 400,
      terrain: {
        ...base.terrain,
        spans: [
          ...base.terrain.spans.filter((s) => s.id !== 'main'),
          { id: 'before-gap', points: [{ x: -9.9, y: 10 }, { x: 1, y: 10 }] },
          { id: 'after-gap', points: [{ x: 9, y: 10 }, ...main.points.slice(1)] },
        ],
      },
    };
    const rc = new RunController(w, loadFixtureCart(), level);
    const events = record(rc);
    startAndRelease(rc);
    // gravity is 10 m/s²: launched at 10 m/s the whole (touching) cluster
    // reaches its apex after 1 s — on the first 1 Hz aboard check
    for (const p of rc.pineappleStates()) w.setLinearVelocity(p.handle, { x: 0, y: -10 });
    let slowPairsAtCheck = 0;
    for (let n = 0; n < 60; n++) rc.step();
    const ps = rc.pineappleStates().map((p) => ({ t: w.getTransform(p.handle), v: w.getLinearVelocity(p.handle) }));
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i]!;
        const b = ps[j]!;
        const slow = Math.hypot(a.v.x, a.v.y) < 0.5 && Math.hypot(b.v.x, b.v.y) < 0.5;
        if (slow && Math.hypot(a.t.x - b.t.x, a.t.y - b.t.y) <= 2 * PINEAPPLE_RADIUS + 0.05) slowPairsAtCheck++;
      }
    }
    // precondition: slow, touching pairs in mid-air at the check (the old rule's false positive)
    expect(slowPairsAtCheck).toBeGreaterThan(5);
    expect(ps.every((p) => p.t.y < 0)).toBe(true); // all well above the funnel outlet
    // 3 s later (a grounded timer from the apex would have fired at 4 s) nothing is lost:
    // they are still falling through the hole, never having touched anything
    for (let n = 0; n < 3.5 * 60; n++) rc.step();
    expect(events.filter((e) => e.type === 'pineappleLost')).toHaveLength(0);
    expect(rc.pineappleStates().every((p) => p.alive)).toBe(true);
  });
});

