/**
 * CompoundSpec -> physics bodies/joints (the ShapeCombiner equivalent).
 *
 * The attachment DECISIONS are made by model/attach.ts (pure, shared with the
 * builder preview). This module only instantiates them through the physics
 * wrapper:
 *  - each BodySpec becomes ONE dynamic body with several shapes (welding by
 *    construction, not by joints) — density 1 for every part;
 *  - wheel pins become plain (motorless) revolute joints;
 *  - shocks become spring distance joints, 5 Hz, damping ratio 0.5;
 *  - drive (original WheelCommand): while a direction is held, every powered
 *    wheel BODY gets a direct torque of 20 × its mass, unless its ABSOLUTE
 *    angular velocity is already at the ±20 rad/s cap in that direction.
 *    Pinned and shock-mounted wheels use the same law. Being an external
 *    torque on the wheel only, it has no reaction on the chassis.
 *
 * Collision: only DIRECTLY jointed pairs skip collision (Box2D joints with
 * collideConnected = false: a wheel vs the body it is pinned to, a shock's two
 * end bodies). Other bodies of the same cart collide normally.
 */

import type { CompoundSpec } from '../model/attach';
import type { Vec2 } from '../model/geometry';
import type { BodyHandle, JointHandle, MaterialDef, PhysicsWorld } from './engine';

export const PART_DENSITY = 1;
/** Drive torque per kg of wheel mass (original WheelCommand). */
export const DRIVE_TORQUE_PER_MASS = 20;
/** Wheel spin cap, rad/s. Positive = clockwise on screen = drives right. */
export const DRIVE_MAX_SPEED = 20;
export const SHOCK_HERTZ = 5;
export const SHOCK_DAMPING = 0.5;
/** Original: wheels angular damping 0.1. */
export const WHEEL_ANGULAR_DAMPING = 0.1;
/** Not recovered from the original; chosen so bottle caps grip the terrain. */
export const WHEEL_MATERIAL = { friction: 0.9, restitution: 0.2 } as const;
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
  const bodies = new Map<string, BodyHandle>();
  const wheelBodies: BodyHandle[] = [];
  const poweredWheels: { handle: BodyHandle; torque: number }[] = [];
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
    if (isWheel && b.powered) poweredWheels.push({ handle, torque: DRIVE_TORQUE_PER_MASS * world.getMass(handle) });
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
      for (const { handle, torque } of poweredWheels) {
        const w = world.getAngularVelocity(handle);
        if (drive > 0 ? w < DRIVE_MAX_SPEED : w > -DRIVE_MAX_SPEED) world.applyTorque(handle, drive * torque);
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
