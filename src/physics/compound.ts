/**
 * CompoundSpec -> physics bodies/joints (the ShapeCombiner equivalent).
 *
 * The attachment DECISIONS are made by model/attach.ts (pure, shared with the
 * builder preview). This module only instantiates them through the physics
 * wrapper:
 *  - each BodySpec becomes ONE dynamic body with several shapes (welding by
 *    construction, not by joints) — density 1 for every part;
 *  - wheel pins become plain (motorless) revolute joints;
 *  - shocks become spring distance joints (SHOCK_HERTZ / SHOCK_DAMPING) with
 *    real Box2D travel limits (enableLimit, SHOCK_MIN_RATIO..SHOCK_MAX_RATIO
 *    × rest length; S8a — S6T emulated them with velocity-level bump stops
 *    in preStep because the engine wrapper was frozen). The limit is a hard
 *    in-solver constraint, so it holds on an intact or a damaged cart alike;
 *  - drive (original WheelCommand): while a direction is held, every powered
 *    wheel BODY gets a direct torque of 20 × its mass, limited to the
 *    remaining headroom below the ±20 rad/s ABSOLUTE angular-velocity cap
 *    (min(20·m, I·(cap − |ω|)/dt)), so no wheel size can overshoot it.
 *    Pinned and shock-mounted wheels use the same law. Being an external
 *    torque on the wheel only, it has no reaction on the chassis.
 *
 * Collision: only DIRECTLY jointed pairs skip collision (Box2D joints with
 * collideConnected = false: a wheel vs the body it is pinned to, a shock's two
 * end bodies). Other bodies of the same cart collide normally.
 */

import type { CompoundSpec } from '../model/attach';
import type { Vec2 } from '../model/geometry';
import { FIXED_DT } from './clock';
import type { BodyHandle, JointHandle, MaterialDef, PhysicsWorld } from './engine';
import { installSurfacePairs, SURFACE } from './surfaces';

export const PART_DENSITY = 1;
/** Drive torque per kg of wheel mass (original WheelCommand). */
export const DRIVE_TORQUE_PER_MASS = 20;
/** Wheel spin cap, rad/s. Positive = clockwise on screen = drives right. */
export const DRIVE_MAX_SPEED = 20;
/**
 * Shock spring (S6T #4: was 5 Hz / 0.5). Stiffer and better damped so a hard
 * landing no longer swings a shock-hung wheel through its whole arc.
 */
export const SHOCK_HERTZ = 8;
export const SHOCK_DAMPING = 0.7;
/**
 * Shock travel limits as a fraction of rest length (S6T #4; real Box2D
 * distance-joint limits since S8a). Tighter than the playtest's 0.6..1.3
 * suggestion: the example cart hangs each wheel on a triangle of two shocks, and that triangle can flip
 * (the wheel folds under the bed) once long − short ≥ the anchor spacing,
 * i.e. at 1.22 / 0.88 of rest — reachable inside 0.6..1.3. At 0.8..1.15 it
 * is not (1.15 × 71 px − 0.8 × 32 px = 56 px < 58 px). Measured on the
 * scratch matrix (example + articulated carts × 4 courses × 5 styles):
 * 16 finishes with no stops, 14 at 0.6..1.3, 23 at 0.8..1.15.
 */
export const SHOCK_MIN_RATIO = 0.8;
export const SHOCK_MAX_RATIO = 1.15;
/** Original: wheels angular damping 0.1. */
export const WHEEL_ANGULAR_DAMPING = 0.1;
/**
 * Not recovered from the original; chosen so bottle caps grip the terrain.
 * S8a: pineapple–wheel contacts use PINEAPPLE_WHEEL_FRICTION (surfaces.ts),
 * not the 0.9 mix.
 */
export const WHEEL_MATERIAL = { friction: 0.9, restitution: 0.2, surface: SURFACE.wheel } as const;
export const PART_MATERIAL = { friction: 0.6, restitution: 0.2 } as const;

export type DriveDirection = -1 | 0 | 1;

export interface CartInstance {
  /** BodySpec id -> body handle. */
  bodies: Map<string, BodyHandle>;
  /** Wheel part id -> revolute joint handle. */
  wheelJoints: Map<string, JointHandle>;
  /** Shock part id -> distance joint handle. */
  shockJoints: Map<string, JointHandle>;
  /** Wheel body handles (pinned or shock-mounted). */
  wheelBodies: BodyHandle[];
  /** -1 = left, 0 = coast (no torque), +1 = right. */
  setDrive(dir: DriveDirection): void;
  /** Call once per fixed step BEFORE world.step(): applies the drive torque. */
  preStep(): void;
  destroy(): void;
}

/**
 * Instantiate a resolved cart. `offset` (metres) is added to every design
 * position — the world location of design px (0, 0).
 * Throws if the spec is invalid; callers should check `spec.valid` first.
 */
export function buildCompound(world: PhysicsWorld, spec: CompoundSpec, offset: Vec2 = { x: 0, y: 0 }): CartInstance {
  if (!spec.valid) {
    throw new Error(`buildCompound: invalid cart (${spec.errors.map((e) => e.code).join(', ')})`);
  }
  installSurfacePairs(world);
  const bodies = new Map<string, BodyHandle>();
  const wheelBodies: BodyHandle[] = [];
  const poweredWheels: { handle: BodyHandle; torque: number; inertia: number }[] = [];
  const at = (p: Vec2): Vec2 => ({ x: p.x + offset.x, y: p.y + offset.y });

  for (const b of spec.bodies) {
    const isWheel = b.kind === 'wheel';
    const handle = world.createBody({
      type: 'dynamic',
      position: at(b.origin),
      role: isWheel ? 'wheel' : 'cart',
      partIds: b.partIds,
      ...(isWheel ? { angularDamping: WHEEL_ANGULAR_DAMPING } : {}),
    });
    const mat: MaterialDef = { density: PART_DENSITY, ...(isWheel ? WHEEL_MATERIAL : PART_MATERIAL) };
    for (const s of b.shapes) {
      if (s.type === 'circle') world.addCircle(handle, s.center, s.radius, mat, s.partId);
      else world.addPolygon(handle, s.vertices, mat, s.partId);
    }
    bodies.set(b.id, handle);
    if (isWheel) wheelBodies.push(handle);
    if (isWheel && b.powered) {
      poweredWheels.push({
        handle,
        torque: DRIVE_TORQUE_PER_MASS * world.getMass(handle),
        inertia: world.getRotationalInertia(handle),
      });
    }
  }

  const wheelJoints = new Map<string, JointHandle>();
  const shockJoints = new Map<string, JointHandle>();

  for (const j of spec.joints) {
    const a = bodies.get(j.bodyA)!;
    const b = bodies.get(j.bodyB)!;
    if (j.type === 'revolute') {
      const h = world.createRevoluteJoint({ bodyA: a, bodyB: b, anchor: at(j.anchor), collideConnected: false });
      wheelJoints.set(j.partId, h);
    } else {
      const h = world.createDistanceJoint({
        bodyA: a,
        bodyB: b,
        anchorA: at(j.anchorA),
        anchorB: at(j.anchorB),
        length: j.length,
        hertz: SHOCK_HERTZ,
        dampingRatio: SHOCK_DAMPING,
        limits: { minLength: j.length * SHOCK_MIN_RATIO, maxLength: j.length * SHOCK_MAX_RATIO },
        collideConnected: false,
      });
      shockJoints.set(j.partId, h);
    }
  }

  let drive: DriveDirection = 0;
  let destroyed = false;

  return {
    bodies,
    wheelJoints,
    shockJoints,
    wheelBodies,
    setDrive(dir) {
      if (!destroyed) drive = dir;
    },
    preStep() {
      if (destroyed || drive === 0) return;
      for (const { handle, torque, inertia } of poweredWheels) {
        // Spin headroom in the drive direction. Torque is limited to what
        // brings |ω| exactly to the cap in one step, so small wheels (tiny
        // inertia) cannot overshoot it.
        const headroom = DRIVE_MAX_SPEED - drive * world.getAngularVelocity(handle);
        if (headroom <= 0) continue;
        world.applyTorque(handle, drive * Math.min(torque, (inertia * headroom) / FIXED_DT));
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const h of bodies.values()) if (world.hasBody(h)) world.destroyBody(h);
      bodies.clear();
      wheelJoints.clear();
      shockJoints.clear();
    },
  };
}
