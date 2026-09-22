/**
 * CompoundSpec -> physics bodies/joints (the ShapeCombiner equivalent).
 *
 * The attachment DECISIONS are made by model/attach.ts (pure, shared with the
 * builder preview). This module only instantiates them through the physics
 * wrapper:
 *  - each BodySpec becomes ONE dynamic body with several shapes (welding by
 *    construction, not by joints) — density 1 for every part;
 *  - wheel pins become revolute joints whose motor provides the drive:
 *    max torque = 20 × wheel mass, speed capped at ±20 rad/s;
 *  - shocks become spring distance joints, 5 Hz, damping ratio 0.5.
 *
 * All shapes of one cart share a negative collision group so the cart's own
 * bodies never collide with each other (a wheel overlapping the chassis it is
 * pinned to must not fight it); cargo and terrain still collide with the cart.
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

let nextGroup = -1;
/** A fresh negative collision group per cart instance. */
function allocateGroup(): number {
  const g = nextGroup;
  nextGroup = nextGroup <= -30000 ? -1 : nextGroup - 1;
  return g;
}

export type DriveDirection = -1 | 0 | 1;

export interface CartInstance {
  /** BodySpec id -> body handle. */
  bodies: Map<string, BodyHandle>;
  /** Wheel part id -> revolute joint handle. */
  wheelJoints: Map<string, JointHandle>;
  /** Shock part id -> distance joint handle. */
  shockJoints: Map<string, JointHandle>;
  /** Wheel body handles (all powered wheels, pinned or free). */
  wheelBodies: BodyHandle[];
  /** -1 = left, 0 = coast (motors off), +1 = right. */
  setDrive(dir: DriveDirection): void;
  /** Call once per fixed step BEFORE world.step() (drives free wheels). */
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
  const group = allocateGroup();
  const bodies = new Map<string, BodyHandle>();
  const wheelBodies: BodyHandle[] = [];
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
    const mat: MaterialDef = { density: PART_DENSITY, groupIndex: group, ...(isWheel ? WHEEL_MATERIAL : PART_MATERIAL) };
    for (const s of b.shapes) {
      if (s.type === 'circle') world.addCircle(handle, s.center, s.radius, mat, s.partId);
      else world.addPolygon(handle, s.vertices, mat, s.partId);
    }
    bodies.set(b.id, handle);
    if (isWheel) wheelBodies.push(handle);
  }

  const wheelJoints = new Map<string, JointHandle>();
  const shockJoints = new Map<string, JointHandle>();
  const wheelTorque = new Map<JointHandle, number>();

  for (const j of spec.joints) {
    const a = bodies.get(j.bodyA)!;
    const b = bodies.get(j.bodyB)!;
    if (j.type === 'revolute') {
      const torque = DRIVE_TORQUE_PER_MASS * world.getMass(b);
      const h = world.createRevoluteJoint({
        bodyA: a,
        bodyB: b,
        anchor: at(j.anchor),
        motor: { enabled: false, speed: 0, maxTorque: torque },
      });
      wheelJoints.set(j.partId, h);
      if (j.powered) wheelTorque.set(h, torque);
    } else {
      const h = world.createDistanceJoint({
        bodyA: a,
        bodyB: b,
        anchorA: at(j.anchorA),
        anchorB: at(j.anchorB),
        length: j.length,
        hertz: SHOCK_HERTZ,
        dampingRatio: SHOCK_DAMPING,
      });
      shockJoints.set(j.partId, h);
    }
  }

  // Free (unpinned) powered wheels — e.g. wheels hung only on shocks, like
  // the original's example cart — have no joint to motorise; the original
  // applied torque to the wheel body directly, and so do we (in preStep).
  const pinnedWheelBodies = new Set(
    spec.joints.filter((j) => j.type === 'revolute').map((j) => bodies.get(j.bodyB)!),
  );
  const freeWheels = wheelBodies.filter((h) => !pinnedWheelBodies.has(h));
  let drive: DriveDirection = 0;
  let destroyed = false;

  return {
    bodies,
    wheelJoints,
    shockJoints,
    wheelBodies,
    setDrive(dir) {
      if (destroyed || dir === drive) return;
      drive = dir;
      for (const [h, torque] of wheelTorque) {
        world.setRevoluteMotor(h, { enabled: dir !== 0, speed: dir * DRIVE_MAX_SPEED, maxTorque: torque });
      }
    },
    preStep() {
      if (destroyed || drive === 0) return;
      for (const h of freeWheels) {
        const w = world.getAngularVelocity(h);
        if (drive > 0 ? w < DRIVE_MAX_SPEED : w > -DRIVE_MAX_SPEED) {
          world.applyTorque(h, drive * DRIVE_TORQUE_PER_MASS * world.getMass(h));
        }
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
