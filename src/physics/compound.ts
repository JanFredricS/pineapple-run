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
 *    emulated travel limits (SHOCK_MIN_RATIO..SHOCK_MAX_RATIO × rest length,
 *    S6T #4): the frozen engine wrapper has no distance-joint limits, so
 *    preStep() stops a shock that is past a limit and still moving away from
 *    it — a momentum-conserving, perfectly inelastic velocity correction on
 *    the two bodies (plus a small push back inside), like a bump stop;
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
 * Shock travel limits as a fraction of rest length (S6T #4, emulated bump
 * stops). Tighter than the playtest's 0.6..1.3 suggestion: the example cart
 * hangs each wheel on a triangle of two shocks, and that triangle can flip
 * (the wheel folds under the bed) once long − short ≥ the anchor spacing,
 * i.e. at 1.22 / 0.88 of rest — reachable inside 0.6..1.3. At 0.8..1.15 it
 * is not (1.15 × 71 px − 0.8 × 32 px = 56 px < 58 px). Measured on the
 * scratch matrix (example + articulated carts × 4 courses × 5 styles):
 * 16 finishes with no stops, 14 at 0.6..1.3, 23 at 0.8..1.15.
 */
export const SHOCK_MIN_RATIO = 0.8;
export const SHOCK_MAX_RATIO = 1.15;
/** Bump-stop push-back: fraction of the overshoot removed per step, capped (m/s). */
const SHOCK_STOP_BIAS = 0.2;
const SHOCK_STOP_MAX_PUSH = 1;
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
  const shockStops: ShockStop[] = [];
  const com = new Map(spec.bodies.map((b) => [b.id, localCentroid(b.shapes)]));

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
      shockStops.push({ joint: h, a, b, comA: com.get(j.bodyA)!, comB: com.get(j.bodyB)!, min: j.length * SHOCK_MIN_RATIO, max: j.length * SHOCK_MAX_RATIO });
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
      if (destroyed) return;
      for (const s of shockStops) bumpStop(world, s);
      if (drive === 0) return;
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

/** Centre of mass of uniform-density shapes, in their body's local frame (Box2D reports velocity at it). */
export function localCentroid(shapes: CompoundSpec['bodies'][number]['shapes']): Vec2 {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (const s of shapes) {
    if (s.type === 'circle') {
      const a = Math.PI * s.radius * s.radius;
      area += a;
      cx += a * s.center.x;
      cy += a * s.center.y;
      continue;
    }
    const v = s.vertices;
    for (let i = 0; i < v.length; i++) {
      const p = v[i]!;
      const q = v[(i + 1) % v.length]!;
      const cross = p.x * q.y - q.x * p.y;
      area += cross / 2;
      cx += ((p.x + q.x) * cross) / 6;
      cy += ((p.y + q.y) * cross) / 6;
    }
  }
  return area !== 0 ? { x: cx / area, y: cy / area } : { x: 0, y: 0 };
}

export interface ShockStop {
  joint: JointHandle;
  a: BodyHandle;
  b: BodyHandle;
  comA: Vec2;
  comB: Vec2;
  min: number;
  max: number;
}

const cross = (r: Vec2, n: Vec2) => r.x * n.y - r.y * n.x;

/**
 * Emulated distance-joint limit (S6T #4). Past `min` and still closing, or
 * past `max` and still opening: an impulse along the shock axis, at the two
 * anchors, cancels the separation rate (plus a capped push back inside) —
 * equal and opposite, so momentum is conserved and energy only removed.
 * The linear part is applied with setLinearVelocity, the angular part as a
 * one-step torque (the wrapper has no angular-velocity setter).
 */
export function bumpStop(world: PhysicsWorld, s: ShockStop): void {
  if (!world.hasJoint(s.joint) || !world.hasBody(s.a) || !world.hasBody(s.b)) return;
  const { a, b } = world.getJointAnchors(s.joint);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6 || (len >= s.min && len <= s.max)) return;
  const n = { x: dx / len, y: dy / len };
  const ca = world.localToWorld(s.a, s.comA);
  const cb = world.localToWorld(s.b, s.comB);
  const ra = { x: a.x - ca.x, y: a.y - ca.y };
  const rb = { x: b.x - cb.x, y: b.y - cb.y };
  const la = world.getLinearVelocity(s.a);
  const lb = world.getLinearVelocity(s.b);
  const wa = world.getAngularVelocity(s.a);
  const wb = world.getAngularVelocity(s.b);
  const va = { x: la.x - wa * ra.y, y: la.y + wa * ra.x };
  const vb = { x: lb.x - wb * rb.y, y: lb.y + wb * rb.x };
  const rate = (vb.x - va.x) * n.x + (vb.y - va.y) * n.y; // + = extending
  const over = len < s.min ? s.min - len : s.max - len; // + = must extend
  const push = Math.sign(over) * Math.min(SHOCK_STOP_MAX_PUSH, (SHOCK_STOP_BIAS * Math.abs(over)) / FIXED_DT);
  // only act while moving further out of range (or too slowly back in)
  const dRate = over > 0 ? Math.max(0, push - rate) : Math.min(0, push - rate);
  if (dRate === 0) return;
  const ma = world.getMass(s.a);
  const mb = world.getMass(s.b);
  const ia = world.getRotationalInertia(s.a);
  const ib = world.getRotationalInertia(s.b);
  if (!(ma > 0) || !(mb > 0) || !(ia > 0) || !(ib > 0)) return;
  const rna = cross(ra, n);
  const rnb = cross(rb, n);
  const impulse = dRate / (1 / ma + 1 / mb + (rna * rna) / ia + (rnb * rnb) / ib);
  world.setLinearVelocity(s.a, { x: la.x - (impulse / ma) * n.x, y: la.y - (impulse / ma) * n.y });
  world.setLinearVelocity(s.b, { x: lb.x + (impulse / mb) * n.x, y: lb.y + (impulse / mb) * n.y });
  // angular impulse r × P, delivered as a torque over the coming step
  if (rna !== 0) world.applyTorque(s.a, (-rna * impulse) / FIXED_DT);
  if (rnb !== 0) world.applyTorque(s.b, (rnb * impulse) / FIXED_DT);
}
