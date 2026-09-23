/**
 * FROZEN. This wrapper was frozen from S1 through S6T and opened ONCE,
 * deliberately, in S8a (2026-09-23) for exactly two additions (residual R19):
 *  1. pairwise contact friction — MaterialDef.surface (Box2D userMaterialId)
 *     + PhysicsWorld.setPairFriction(), via b2World_SetFrictionCallback;
 *     unlisted pairs keep Box2D's own sqrtf(fA·fB) mix bit-for-bit
 *     (S8a audit-1: one module-level dispatcher + a per-world tag in
 *     userMaterialId, because the binding keeps one callback per module);
 *  2. distance-joint limits — DistanceJointDef.limits (b2DistanceJointDef
 *     enableLimit/minLength/maxLength) + getDistanceJointLength/Limits.
 * It is frozen again. Any further change to this file needs a plan-owner
 * decision recorded in RESIDUALS.md / PLAN.md first — do not open it as a
 * side effect of another slice.
 *
 * Physics wrapper — the ONLY module that imports box2d3-wasm.
 *
 * Everything outside src/physics talks to plain numbers/objects: body and
 * joint handles are integers, vectors are {x, y}. Swapping the engine (e.g.
 * to Rapier) means rewriting this file only.
 *
 * World convention: metres, y-down, gravity (0, +10), fixed 60 Hz step with 4
 * sub-steps (see clock.ts for the accumulator / pause policy).
 *
 * Memory: box2d3-wasm is an Emscripten/embind build.
 *  - Objects made with `new` (b2Vec2, b2Circle, b2Transform) and defs from
 *    `b2Default*Def()` live on the wasm heap and must be `.delete()`d.
 *  - FUNCTION return values (b2Body_GetPosition, b2MakeRot,
 *    b2Joint_GetConstraintForce, ...) are fresh copies: `.delete()` them.
 *  - PROPERTY getters on a value object (`shapeDef.material`, `jointDef.base`,
 *    `base.localFrameA`, ...) return REFERENCES into the parent. Mutate them in
 *    place and never `.delete()` them: that frees memory the parent still owns
 *    and silently corrupts the def (seen as joint anchors drifting).
 *  - Property setters copy the value in.
 *  - Ids (b2BodyId, b2JointId, ...) are plain JS objects; nothing to free.
 * This file keeps two scratch vectors and frees every temporary it owns.
 */

import Box2DFactory from '#box2d-compat';
import type { MainModule, b2BodyId, b2JointDef, b2JointId, b2Rot, b2ShapeId, b2Vec2, b2WorldId, b2Transform } from '#box2d-compat';
import type { Vec2 } from '../model/geometry';
import type { BodyRole, BodyTransform, RenderBodyInfo, RenderShape, RenderSnapshot, SceneManifest, SnapshotSource } from '../model/snapshot';
import { interpolateTransform } from '../model/snapshot';
import { FIXED_DT, SUB_STEPS } from './clock';

export type BodyHandle = number;
export type JointHandle = number;

let modulePromise: Promise<MainModule> | null = null;

/** Load (once) the single-threaded compat wasm build. */
export function loadPhysics(): Promise<MainModule> {
  modulePromise ??= Box2DFactory();
  return modulePromise;
}

export interface MaterialDef {
  density?: number;
  friction?: number;
  restitution?: number;
  rollingResistance?: number;
  /**
   * Collision group: shapes sharing the same NEGATIVE group never collide
   * with each other (used so a cart's own bodies don't fight each other).
   */
  groupIndex?: number;
  /**
   * Surface id (S8a): a small non-negative integer naming what this shape is
   * made of, for pairwise friction overrides (PhysicsWorld.setPairFriction).
   * 0 (the default) = no special surface. Stored in the low 20 bits of Box2D's userMaterialId (the world's tag above).
   */
  surface?: number;
}

export interface BodyDef {
  type: 'static' | 'dynamic' | 'kinematic';
  position: Vec2;
  angle?: number;
  linearVelocity?: Vec2;
  angularVelocity?: number;
  linearDamping?: number;
  angularDamping?: number;
  /** Continuous collision against other dynamic bodies (CCD "bullet"). */
  bullet?: boolean;
  enableSleep?: boolean;
  /** Render/role metadata carried into the SceneManifest. */
  role?: BodyRole;
  partIds?: string[];
}

export interface RevoluteJointDef {
  bodyA: BodyHandle;
  bodyB: BodyHandle;
  /** World-space pin point. */
  anchor: Vec2;
  collideConnected?: boolean;
  motor?: { enabled: boolean; speed: number; maxTorque: number };
}

export interface DistanceJointDef {
  bodyA: BodyHandle;
  bodyB: BodyHandle;
  /** World-space anchors. */
  anchorA: Vec2;
  anchorB: Vec2;
  /** Rest length; defaults to the anchors' current distance. */
  length?: number;
  /** Spring (0 = rigid rod). */
  hertz?: number;
  dampingRatio?: number;
  /**
   * Hard travel limits (S8a): Box2D keeps the anchor distance within
   * [minLength, maxLength] as a rigid constraint, on top of the spring.
   */
  limits?: { minLength: number; maxLength: number };
  collideConnected?: boolean;
}

export interface WorldOptions {
  gravity?: Vec2;
}

interface BodyRecord {
  id: b2BodyId;
  role: BodyRole;
  partIds?: string[];
  dynamic: boolean;
  shapes: RenderShape[];
  prev: BodyTransform;
  curr: BodyTransform;
}

interface JointRecord {
  id: b2JointId;
  kind: 'revolute' | 'distance';
  bodyA: BodyHandle;
  bodyB: BodyHandle;
  /** Anchors in each body's local frame (for divergence checks & debug draw). */
  localA: Vec2;
  localB: Vec2;
}

/** Debug-draw line in world metres. */
export interface DebugLine {
  a: Vec2;
  b: Vec2;
  kind: 'revolute' | 'distance';
}

export class PhysicsWorld implements SnapshotSource {
  private readonly worldId: b2WorldId;
  private bodies = new Map<BodyHandle, BodyRecord>();
  private joints = new Map<JointHandle, JointRecord>();
  private nextBody = 1;
  private nextJoint = 1;
  private revision = 1;
  private _steps = 0;
  private destroyed = false;
  private readonly v1: b2Vec2;
  private readonly v2: b2Vec2;
  /** Pairwise friction overrides, keyed by pairKey(surfaceA, surfaceB). */
  private readonly pairFriction = new Map<number, number>();
  private frictionCallbackInstalled = false;
  /** This world's tag in the high bits of every shape's userMaterialId (see frictionDispatch). */
  private readonly frictionTag: number;

  static async create(options: WorldOptions = {}): Promise<PhysicsWorld> {
    return new PhysicsWorld(await loadPhysics(), options);
  }

  private constructor(
    private readonly b2: MainModule,
    options: WorldOptions,
  ) {
    this.frictionTag = allocateFrictionTag(); // first: it may throw, and nothing is allocated yet
    this.v1 = new b2.b2Vec2(0, 0);
    this.v2 = new b2.b2Vec2(0, 0);
    const def = b2.b2DefaultWorldDef();
    const g = options.gravity ?? { x: 0, y: 10 };
    def.gravity = this.vec(this.v1, g.x, g.y);
    def.enableContinuous = true;
    this.worldId = b2.b2CreateWorld(def);
    def.delete();
  }

  // ------------------------------------------------------------ lifecycle

  get steps(): number {
    return this._steps;
  }

  get simTime(): number {
    return this._steps * FIXED_DT;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Advance exactly one fixed step (1/60 s, 4 sub-steps). */
  step(): void {
    this.assertAlive();
    this.b2.b2World_Step(this.worldId, FIXED_DT, SUB_STEPS);
    this._steps++;
    for (const rec of this.bodies.values()) {
      if (!rec.dynamic) continue;
      const t = rec.prev;
      rec.prev = rec.curr;
      rec.curr = t;
      this.readTransform(rec.id, rec.curr);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.b2.b2DestroyWorld(this.worldId);
    frictionTables.delete(this.frictionTag); // release this world's override table
    liveFrictionTags.delete(this.frictionTag); // and its tag, for reuse
    this.v1.delete();
    this.v2.delete();
    this.bodies.clear();
    this.joints.clear();
    this.destroyed = true;
  }

  // ------------------------------------------------------------- bodies

  createBody(def: BodyDef): BodyHandle {
    this.assertAlive();
    const b2 = this.b2;
    const bd = b2.b2DefaultBodyDef();
    bd.type =
      def.type === 'static'
        ? b2.b2BodyType.b2_staticBody
        : def.type === 'kinematic'
          ? b2.b2BodyType.b2_kinematicBody
          : b2.b2BodyType.b2_dynamicBody;
    bd.position = this.vec(this.v1, def.position.x, def.position.y);
    if (def.angle) {
      const rot = b2.b2MakeRot(def.angle);
      bd.rotation = rot;
      rot.delete();
    }
    if (def.linearVelocity) bd.linearVelocity = this.vec(this.v1, def.linearVelocity.x, def.linearVelocity.y);
    if (def.angularVelocity !== undefined) bd.angularVelocity = def.angularVelocity;
    if (def.linearDamping !== undefined) bd.linearDamping = def.linearDamping;
    if (def.angularDamping !== undefined) bd.angularDamping = def.angularDamping;
    if (def.bullet) bd.isBullet = true;
    if (def.enableSleep !== undefined) bd.enableSleep = def.enableSleep;
    const id = b2.b2CreateBody(this.worldId, bd);
    bd.delete();

    const handle = this.nextBody++;
    const t: BodyTransform = { id: handle, x: 0, y: 0, angle: 0 };
    this.readTransform(id, t);
    const rec: BodyRecord = {
      id,
      role: def.role ?? 'debug',
      dynamic: def.type !== 'static',
      shapes: [],
      prev: { ...t },
      curr: t,
    };
    if (def.partIds) rec.partIds = [...def.partIds];
    this.bodies.set(handle, rec);
    this.revision++;
    return handle;
  }

  destroyBody(handle: BodyHandle): void {
    const rec = this.body(handle);
    // Box2D destroys attached joints with the body; drop our records too.
    for (const [jh, j] of this.joints) {
      if (j.bodyA === handle || j.bodyB === handle) this.joints.delete(jh);
    }
    this.b2.b2DestroyBody(rec.id);
    this.bodies.delete(handle);
    this.revision++;
  }

  hasBody(handle: BodyHandle): boolean {
    return this.bodies.has(handle);
  }

  bodyHandles(): BodyHandle[] {
    return [...this.bodies.keys()];
  }

  /** Convex polygon (3..8 vertices) in body-local metres. */
  addPolygon(handle: BodyHandle, vertices: Vec2[], material: MaterialDef = {}, partId = ''): void {
    const b2 = this.b2;
    const rec = this.body(handle);
    const pts = vertices.map((v) => new b2.b2Vec2(v.x, v.y));
    const hull = b2.b2ComputeHull(pts);
    pts.forEach((p) => p.delete());
    if (hull.count < 3) {
      hull.delete();
      throw new Error('addPolygon: degenerate polygon');
    }
    const poly = b2.b2MakePolygon(hull, 0);
    hull.delete();
    const sd = this.shapeDef(material);
    b2.b2CreatePolygonShape(rec.id, sd, poly);
    sd.delete();
    poly.delete();
    rec.shapes.push({ type: 'polygon', partId, vertices: vertices.map((v) => ({ ...v })) });
    this.revision++;
  }

  addCircle(handle: BodyHandle, center: Vec2, radius: number, material: MaterialDef = {}, partId = ''): void {
    const b2 = this.b2;
    const rec = this.body(handle);
    const c = new b2.b2Circle();
    c.center = this.vec(this.v1, center.x, center.y);
    c.radius = radius;
    const sd = this.shapeDef(material);
    b2.b2CreateCircleShape(rec.id, sd, c);
    sd.delete();
    c.delete();
    rec.shapes.push({ type: 'circle', partId, center: { ...center }, radius });
    this.revision++;
  }

  /**
   * One-sided chain (terrain). Points must run left -> right; the solid side
   * is below (+y).
   *
   * Box2D v3 open chains use their first and last points as GHOST vertices
   * only (no collision on the end segments), so we append a ghost point at
   * each end, continuing the end segment's direction. Every segment between
   * the given points therefore collides (and a span of 2 points becomes the
   * 4-point minimum Box2D requires).
   */
  addChain(handle: BodyHandle, points: Vec2[], material: MaterialDef = {}): void {
    if (points.length < 2) throw new Error('addChain: need at least 2 points');
    const b2 = this.b2;
    const rec = this.body(handle);
    const ghost = (from: Vec2, to: Vec2): Vec2 => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: to.x + dx / len, y: to.y + dy / len };
    };
    const n = points.length;
    const pts = [ghost(points[1]!, points[0]!), ...points.map((p) => ({ ...p })), ghost(points[n - 2]!, points[n - 1]!)];
    const cd = b2.b2DefaultChainDef();
    const vecs = pts.map((p) => new b2.b2Vec2(p.x, p.y));
    cd.SetPoints(vecs);
    cd.count = vecs.length;
    cd.isLoop = false;
    const chainId = b2.b2CreateChain(rec.id, cd);
    vecs.forEach((v) => v.delete());
    cd.delete();
    // NOTE: b2ChainDef.SetMaterials() in box2d3-wasm 5.2.0 corrupts the
    // material (friction reads as 0), so set it per segment after creation.
    const segCount = b2.b2Chain_GetSegmentCount(chainId);
    const segments = b2.b2Chain_GetSegments(chainId, segCount) as b2ShapeId[];
    for (const s of segments) {
      b2.b2Shape_SetFriction(s, material.friction ?? 0.9);
      b2.b2Shape_SetRestitution(s, material.restitution ?? 0.3);
    }
    rec.shapes.push({ type: 'chain', points: points.map((p) => ({ ...p })) });
    this.revision++;
  }

  getTransform(handle: BodyHandle): BodyTransform {
    const rec = this.body(handle);
    const t: BodyTransform = { id: handle, x: 0, y: 0, angle: 0 };
    this.readTransform(rec.id, t);
    return t;
  }

  /** Rotational inertia about the body's centre of mass (kg·m²). */
  getRotationalInertia(handle: BodyHandle): number {
    return this.b2.b2Body_GetRotationalInertia(this.body(handle).id);
  }

  getMass(handle: BodyHandle): number {
    return this.b2.b2Body_GetMass(this.body(handle).id);
  }

  getLinearVelocity(handle: BodyHandle): Vec2 {
    const v = this.b2.b2Body_GetLinearVelocity(this.body(handle).id);
    const out = { x: v.x, y: v.y };
    v.delete();
    return out;
  }

  setLinearVelocity(handle: BodyHandle, v: Vec2): void {
    this.b2.b2Body_SetLinearVelocity(this.body(handle).id, this.vec(this.v1, v.x, v.y));
  }

  getAngularVelocity(handle: BodyHandle): number {
    return this.b2.b2Body_GetAngularVelocity(this.body(handle).id);
  }

  applyTorque(handle: BodyHandle, torque: number): void {
    this.b2.b2Body_ApplyTorque(this.body(handle).id, torque, true);
  }

  isAwake(handle: BodyHandle): boolean {
    return this.b2.b2Body_IsAwake(this.body(handle).id);
  }

  /** Local point -> world point for a body at its CURRENT (non-interpolated) pose. */
  localToWorld(handle: BodyHandle, p: Vec2): Vec2 {
    return applyTransform(this.getTransform(handle), p);
  }

  // ------------------------------------------------------------- joints

  createRevoluteJoint(def: RevoluteJointDef): JointHandle {
    const b2 = this.b2;
    const a = this.body(def.bodyA);
    const b = this.body(def.bodyB);
    const localA = this.worldToLocal(def.bodyA, def.anchor);
    const localB = this.worldToLocal(def.bodyB, def.anchor);
    const jd = b2.b2DefaultRevoluteJointDef();
    const base = jd.base;
    this.fillJointBase(base, a.id, b.id, localA, localB, def.collideConnected ?? false);
    // `jd.base` is an embind property getter: it returns a reference into
    // `jd`, so it is mutated in place and must NOT be deleted.
    if (def.motor) {
      jd.enableMotor = def.motor.enabled;
      jd.motorSpeed = def.motor.speed;
      jd.maxMotorTorque = def.motor.maxTorque;
    }
    const id = b2.b2CreateRevoluteJoint(this.worldId, jd);
    jd.delete();
    return this.addJoint({ id, kind: 'revolute', bodyA: def.bodyA, bodyB: def.bodyB, localA, localB });
  }

  createDistanceJoint(def: DistanceJointDef): JointHandle {
    const b2 = this.b2;
    const a = this.body(def.bodyA);
    const b = this.body(def.bodyB);
    const localA = this.worldToLocal(def.bodyA, def.anchorA);
    const localB = this.worldToLocal(def.bodyB, def.anchorB);
    const jd = b2.b2DefaultDistanceJointDef();
    const base = jd.base;
    this.fillJointBase(base, a.id, b.id, localA, localB, def.collideConnected ?? false);
    // `jd.base` is an embind property getter: it returns a reference into
    // `jd`, so it is mutated in place and must NOT be deleted.
    const len = def.length ?? Math.hypot(def.anchorB.x - def.anchorA.x, def.anchorB.y - def.anchorA.y);
    jd.length = Math.max(0.01, len);
    if (def.hertz !== undefined && def.hertz > 0) {
      jd.enableSpring = true;
      jd.hertz = def.hertz;
      jd.dampingRatio = def.dampingRatio ?? 0;
    }
    if (def.limits) {
      const { minLength, maxLength } = def.limits;
      if (!(minLength > 0) || !(maxLength >= minLength)) throw new Error('createDistanceJoint: need 0 < minLength <= maxLength');
      jd.enableLimit = true;
      jd.minLength = minLength;
      jd.maxLength = maxLength;
    }
    const id = b2.b2CreateDistanceJoint(this.worldId, jd);
    jd.delete();
    return this.addJoint({ id, kind: 'distance', bodyA: def.bodyA, bodyB: def.bodyB, localA, localB });
  }

  destroyJoint(handle: JointHandle): void {
    const j = this.joint(handle);
    this.b2.b2DestroyJoint(j.id, true);
    this.joints.delete(handle);
  }

  hasJoint(handle: JointHandle): boolean {
    return this.joints.has(handle);
  }

  setRevoluteMotor(handle: JointHandle, motor: { enabled: boolean; speed: number; maxTorque: number }): void {
    const j = this.joint(handle);
    if (j.kind !== 'revolute') throw new Error('setRevoluteMotor: not a revolute joint');
    const b2 = this.b2;
    b2.b2RevoluteJoint_EnableMotor(j.id, motor.enabled);
    b2.b2RevoluteJoint_SetMotorSpeed(j.id, motor.speed);
    b2.b2RevoluteJoint_SetMaxMotorTorque(j.id, motor.maxTorque);
    b2.b2Joint_WakeBodies(j.id);
  }

  /** Current anchor distance of a distance joint (m), as Box2D sees it. */
  getDistanceJointLength(handle: JointHandle): number {
    const j = this.joint(handle);
    if (j.kind !== 'distance') throw new Error('getDistanceJointLength: not a distance joint');
    return this.b2.b2DistanceJoint_GetCurrentLength(j.id);
  }

  /** The [min, max] length range of a distance joint (Box2D's own values; unlimited joints report its huge defaults). */
  getDistanceJointLimits(handle: JointHandle): { enabled: boolean; minLength: number; maxLength: number } {
    const j = this.joint(handle);
    if (j.kind !== 'distance') throw new Error('getDistanceJointLimits: not a distance joint');
    const b2 = this.b2;
    return { enabled: b2.b2DistanceJoint_IsLimitEnabled(j.id), minLength: b2.b2DistanceJoint_GetMinLength(j.id), maxLength: b2.b2DistanceJoint_GetMaxLength(j.id) };
  }

  // ------------------------------------------------------------ friction

  /**
   * Pairwise friction override (S8a): every contact between a shape of
   * surface `a` and a shape of surface `b` (in either order) uses `friction`
   * instead of Box2D's mix sqrt(fA · fB). Surfaces are MaterialDef.surface
   * ids; 0 means "no surface" and cannot be overridden. Idempotent; call
   * before the pair first touches (Box2D fixes a contact's friction when the
   * contact is created).
   *
   * Mechanism: b2World_SetFrictionCallback. The JS callback is installed on
   * the first override and reproduces Box2D's default mix bit-for-bit for
   * every other pair (float32 product, then sqrt rounded to float32), so
   * installing it changes nothing but the overridden pairs.
   *
   * The binding keeps ONE JS friction callback for the whole module (the
   * latest b2World_SetFrictionCallback wins for every world that has one),
   * and the callback is not told which world is calling. So every world
   * installs the same module-level `frictionDispatch`, each shape's
   * userMaterialId carries its world's tag above the 20 surface bits, and
   * the dispatcher looks up that world's table. destroy() drops the table.
   */
  setPairFriction(a: number, b: number, friction: number): void {
    this.assertAlive();
    if (!(Number.isInteger(a) && Number.isInteger(b) && a > 0 && b > 0 && a < 1048576 && b < 1048576)) throw new Error('setPairFriction: surfaces must be integers in 1..2^20-1');
    if (!(Number.isFinite(friction) && friction >= 0)) throw new Error('setPairFriction: friction must be finite and >= 0');
    this.pairFriction.set(pairKey(a, b), friction);
    if (this.frictionCallbackInstalled) return;
    frictionTables.set(this.frictionTag, this.pairFriction);
    this.b2.b2World_SetFrictionCallback(this.worldId, frictionDispatch);
    this.frictionCallbackInstalled = true;
  }

  /** Constraint force (N) on body B, last step. For breakage / telemetry. */
  getJointForce(handle: JointHandle): Vec2 {
    const f = this.b2.b2Joint_GetConstraintForce(this.joint(handle).id);
    const out = { x: f.x, y: f.y };
    f.delete();
    return out;
  }

  getJointTorque(handle: JointHandle): number {
    return this.b2.b2Joint_GetConstraintTorque(this.joint(handle).id);
  }

  /**
   * World positions of the joint's anchor on body A and on body B (current
   * pose). For a healthy pin they coincide; a growing gap = joint divergence.
   */
  getJointAnchors(handle: JointHandle): { a: Vec2; b: Vec2 } {
    const j = this.joint(handle);
    return {
      a: applyTransform(this.getTransform(j.bodyA), j.localA),
      b: applyTransform(this.getTransform(j.bodyB), j.localB),
    };
  }

  /** Bytes allocated on the wasm heap (leak checks in tests). */
  heapBytesInUse(): number {
    return this.b2.GetMemoryStats().uordblks;
  }

  jointHandles(): JointHandle[] {
    return [...this.joints.keys()];
  }

  // ---------------------------------------------------- render contract

  manifest(): SceneManifest {
    const bodies: RenderBodyInfo[] = [];
    for (const [handle, rec] of this.bodies) {
      const info: RenderBodyInfo = { id: handle, role: rec.role, shapes: rec.shapes };
      if (rec.partIds) info.partIds = rec.partIds;
      bodies.push(info);
    }
    return { revision: this.revision, bodies };
  }

  /** Transforms of ALL bodies: dynamic ones interpolated (alpha in [0,1]), static ones as-is. */
  snapshot(alpha = 1): RenderSnapshot {
    const out: BodyTransform[] = [];
    for (const rec of this.bodies.values()) {
      out.push(rec.dynamic ? interpolateTransform(rec.prev, rec.curr, alpha) : { ...rec.curr });
    }
    return { step: this._steps, simTime: this.simTime, alpha, manifestRevision: this.revision, bodies: out };
  }

  /** Joint lines for the debug overlay, using interpolated poses. */
  debugJointLines(snapshot: RenderSnapshot): DebugLine[] {
    const byId = new Map(snapshot.bodies.map((b) => [b.id, b]));
    const lines: DebugLine[] = [];
    for (const j of this.joints.values()) {
      const ta = byId.get(j.bodyA);
      const tb = byId.get(j.bodyB);
      if (!ta || !tb) continue;
      lines.push({ a: applyTransform(ta, j.localA), b: applyTransform(tb, j.localB), kind: j.kind });
    }
    return lines;
  }

  // ------------------------------------------------------------ internals

  private assertAlive(): void {
    if (this.destroyed) throw new Error('PhysicsWorld used after destroy()');
  }

  private body(handle: BodyHandle): BodyRecord {
    this.assertAlive();
    const rec = this.bodies.get(handle);
    if (!rec) throw new Error(`unknown body handle ${handle}`);
    return rec;
  }

  private joint(handle: JointHandle): JointRecord {
    this.assertAlive();
    const rec = this.joints.get(handle);
    if (!rec) throw new Error(`unknown joint handle ${handle}`);
    return rec;
  }

  private addJoint(rec: JointRecord): JointHandle {
    const h = this.nextJoint++;
    this.joints.set(h, rec);
    return h;
  }

  private vec(v: b2Vec2, x: number, y: number): b2Vec2 {
    v.x = x;
    v.y = y;
    return v;
  }

  private readTransform(id: b2BodyId, out: BodyTransform): void {
    const p = this.b2.b2Body_GetPosition(id);
    const q: b2Rot = this.b2.b2Body_GetRotation(id);
    out.x = p.x;
    out.y = p.y;
    out.angle = Math.atan2(q.s, q.c);
    p.delete();
    q.delete();
  }

  private worldToLocal(handle: BodyHandle, p: Vec2): Vec2 {
    const t = this.getTransform(handle);
    const c = Math.cos(t.angle);
    const s = Math.sin(t.angle);
    const dx = p.x - t.x;
    const dy = p.y - t.y;
    return { x: c * dx + s * dy, y: -s * dx + c * dy };
  }

  private fillJointBase(
    base: b2JointDef,
    a: b2BodyId,
    b: b2BodyId,
    localA: Vec2,
    localB: Vec2,
    collideConnected: boolean,
  ): void {
    const b2 = this.b2;
    base.bodyIdA = a;
    base.bodyIdB = b;
    base.collideConnected = collideConnected;
    const identity = b2.b2MakeRot(0);
    const fa: b2Transform = new b2.b2Transform();
    fa.p = this.vec(this.v1, localA.x, localA.y);
    fa.q = identity;
    base.localFrameA = fa;
    const fb: b2Transform = new b2.b2Transform();
    fb.p = this.vec(this.v2, localB.x, localB.y);
    fb.q = identity;
    base.localFrameB = fb;
    fa.delete();
    fb.delete();
    identity.delete();
  }

  private shapeDef(m: MaterialDef) {
    const b2 = this.b2;
    const sd = b2.b2DefaultShapeDef();
    sd.density = m.density ?? 1;
    const mat = sd.material;
    mat.friction = m.friction ?? 0.6;
    mat.restitution = m.restitution ?? 0;
    mat.rollingResistance = m.rollingResistance ?? 0;
    // Property getters return references into `sd` (mutated in place; never delete them).
    if (m.groupIndex) {
      const f = sd.filter;
      f.groupIndex = m.groupIndex;
    }
    if (m.surface !== undefined) {
      // validated whenever present: NaN / Infinity / fractions throw rather than silently meaning "no surface"
      if (!Number.isInteger(m.surface) || m.surface < 0 || m.surface >= 1048576) throw new Error('MaterialDef.surface must be an integer in 0..2^20-1');
      if (m.surface > 0) mat.userMaterialId = (BigInt(this.frictionTag) << SURFACE_BITS) | BigInt(m.surface);
    }
    return sd;
  }
}

/** Surface ids live in the low 20 bits of userMaterialId; the world's tag above them. */
const SURFACE_BITS = 20n;
const SURFACE_MASK = (1n << SURFACE_BITS) - 1n;
/** Tags must fit in the 44 bits above the surface: (tag << 20) | surface < 2^64. */
const MAX_FRICTION_TAG = 2 ** 44 - 1;
let frictionTagBound = MAX_FRICTION_TAG;
let nextFrictionTag = 1;
/**
 * Tags held by live (not destroyed) worlds. A tag is reusable only once its
 * world is destroyed — not merely when it has no table, because a live world
 * that installs its first override later must still own a unique tag.
 */
const liveFrictionTags = new Set<number>();
/** Live worlds' override tables by world tag (entries removed on destroy). */
const frictionTables = new Map<number, Map<number, number>>();

/**
 * Bounded tag allocator: counts up to the 44-bit bound, then reuses the
 * lowest tag no live world holds (found within liveFrictionTags.size + 1
 * probes). Throws — never truncates — if every tag is live.
 */
function allocateFrictionTag(): number {
  let tag: number;
  while (nextFrictionTag <= frictionTagBound && liveFrictionTags.has(nextFrictionTag)) nextFrictionTag++;
  if (nextFrictionTag <= frictionTagBound) {
    tag = nextFrictionTag++;
  } else {
    tag = 1;
    while (liveFrictionTags.has(tag)) tag++;
    if (tag > frictionTagBound) throw new Error(`PhysicsWorld: all ${frictionTagBound} friction world tags are live`);
  }
  liveFrictionTags.add(tag);
  return tag;
}

/**
 * Test seam for the tag allocator (the real bound, 2^44 − 1, cannot be
 * reached in a test). `set` moves the counter and/or lowers the bound;
 * `reset` restores the 44-bit bound. Not for game code.
 */
export const frictionTagsForTests = {
  MAX_FRICTION_TAG,
  set(opts: { next?: number; bound?: number }): void {
    if (opts.bound !== undefined) frictionTagBound = Math.min(opts.bound, MAX_FRICTION_TAG);
    if (opts.next !== undefined) nextFrictionTag = opts.next;
  },
  reset(): void {
    frictionTagBound = MAX_FRICTION_TAG;
  },
  tagOf(w: PhysicsWorld): number {
    return (w as unknown as { frictionTag: number }).frictionTag;
  },
  live(): number[] {
    return [...liveFrictionTags].sort((a, b) => a - b);
  },
};

/**
 * The single friction callback shared by every world (see setPairFriction).
 * Hot path: called when a contact begins touching (~8 calls/step in a real run;
 * see TUNING.md "S8a" for the measured cost); two Map lookups and bigint masks,
 * no allocation beyond the bigint ops.
 */
function frictionDispatch(fA: number, idA: bigint, fB: number, idB: bigint): number {
  const sA = idA & SURFACE_MASK;
  const sB = idB & SURFACE_MASK;
  if (sA !== 0n && sB !== 0n) {
    const f = frictionTables.get(Number(idA >> SURFACE_BITS))?.get(pairKey(Number(sA), Number(sB)));
    if (f !== undefined) return f;
  }
  // Box2D's b2MixFriction: sqrtf(fA * fB), all float32.
  return Math.sqrt(Math.fround(fA * fB));
}

/** Order-independent key for a surface pair (ids < 2^20). */
function pairKey(a: number, b: number): number {
  return a < b ? a * 1048576 + b : b * 1048576 + a;
}

export function applyTransform(t: { x: number; y: number; angle: number }, p: Vec2): Vec2 {
  const c = Math.cos(t.angle);
  const s = Math.sin(t.angle);
  return { x: t.x + c * p.x - s * p.y, y: t.y + s * p.x + c * p.y };
}
