/**
 * Run controller (S1): owns the run-phase simulation and EMITS the S0 run
 * lifecycle events (model/runEvents, contract 3). It never computes scores —
 * S5 feeds the events to model/score.
 *
 * Build (constructor): terrain from the LevelDef spans, solid props (static
 * boxes, run/props.ts — the blender is one), the cart through the production
 * path (resolveAttachments -> physics/compound.buildCompound) at
 * `level.cartStart`, and the funnel holding the pineapples behind a plug at
 * `level.funnel` (see run/funnel.ts).
 *
 * Flow:   idle --start()--> started --release()--> released --> ended
 *   - start():   physics begins stepping; emits `started`. Driving allowed.
 *   - release(): pulls the plug; emits `released`; the sim clock (seconds
 *                since Release = steps × 1/60) starts from 0.
 *   - ended:     exactly one terminal event — `goalReached(delivered)` (level
 *                mode), `allLost` (endless mode, or a level run with every
 *                pineapple lost) or `gaveUp`. Physics keeps
 *                stepping (for visuals) with the drive off; nothing further is
 *                emitted, even from listeners re-entering the controller.
 *
 * Modes (S1 audit ruling, INTEGRATION.md):
 *   - "level":   the goal ends the run (after its settle window). The lost
 *                flag is ADVISORY (HUD / `remaining` / pineappleLost events):
 *                it never stops a pineapple from triggering the goal or
 *                counting as delivered — recovered or catapulted cargo
 *                counts, as in the original. When nothing can be delivered
 *                any more (all lost AND all fallen out of the world, or the
 *                cart gone) the run ends with `allLost` after
 *                LEVEL_ALL_LOST_SECONDS (S6T #16; before, it went on until
 *                Give Up).
 *   - "endless": no goal (the LevelDef goal is ignored). Lost is final; the
 *                last loss ends the run with `allLost`.
 *
 * Per fixed step after Release (in this order; each stage stops once ended):
 *   1. kill-plane (level.killY): a pineapple below it is removed (and lost,
 *      unless it had already passed the goal line in a level run — then it
 *      still counts as delivered). A cart body below it is removed; if that
 *      body is the CHASSIS (heaviest rigid body) the whole cart is removed,
 *      otherwise only that body (its joints go with it) and whatever is no
 *      longer jointed to the chassis stops counting as cart.
 *   2. ground tracking for pineapples currently outside the cart.
 *   3. every ABOARD_CHECK_STEPS (1 s): the aboard check / lost rule.
 *   4. goal (level mode): a pineapple whose path this step (previous ->
 *      current centre, swept circle) touches the goal sensor starts the
 *      SETTLE WINDOW (S6T backlog #2): the clock freezes at that moment (the
 *      rating's time is the first touch), but physics, drive and the
 *      lost/kill rules keep running for GOAL_SETTLE_SECONDS so a carried
 *      load can tip in; then the run ends with `goalReached`, delivered =
 *      pineapples past goal.lineX at that moment. It ends early once every
 *      live pineapple is past the line (nothing left to wait for), and Give
 *      Up during the window finishes the goal instead of abandoning it.
 *
 * Lost rule (PLAN.md "Endless mode rules"): "aboard" = centre inside the
 * cart's world AABB + margin and not touching the terrain, re-checked each
 * second. A pineapple outside is lost ≥ 3 s after it was first seen
 * SUPPORTED (touching terrain, or slow and resting on a funnel wall, a solid
 * prop, a cart wheel, or a chain of spilled pineapples that itself rests on
 * one of those — never merely slow in mid-air, alone or in a cluster), or at
 * once when it leaves the kept-terrain window. In level runs pineapples past
 * the goal line have ARRIVED and are never marked lost. Lost is permanent:
 * `remaining` only goes down.
 */

import { resolveAttachments, type CompoundSpec } from '../model/attach';
import type { CartDesign } from '../model/cart';
import type { AABB, Vec2 } from '../model/geometry';
import type { LevelDef } from '../model/level';
import { RunEventEmitter, isTerminalRunEvent, type RunEvent, type RunEventListener, type RunEventSource } from '../model/runEvents';
import { TOTAL_PINEAPPLES } from '../model/score';
import { PINEAPPLE_RADIUS } from '../physics/cargo';
import { FIXED_DT } from '../physics/clock';
import { DRIVE_MAX_SPEED, DRIVE_TORQUE_PER_MASS, buildCompound, type CartInstance, type DriveDirection } from '../physics/compound';
import type { BodyHandle, PhysicsWorld } from '../physics/engine';
import { buildTerrain } from '../physics/terrain';
import { CameraFollow } from './camera';
import { buildFunnel, type FunnelInstance } from './funnel';
import { buildSolidProps, type SolidProp } from './props';
import {
  circleTouchesPolygon,
  expandBox,
  pointInBox,
  shapesWorldAABB,
  sweptCircleTouchesRect,
  unionBoxes,
  type AboardMargin,
} from './shapes';
import { TerrainIndex, type TerrainQuery } from './terrainQuery';

export type RunPhase = 'idle' | 'started' | 'released' | 'ended';
export type RunMode = 'level' | 'endless';

/** Aboard re-check period (1 s of sim time). */
export const ABOARD_CHECK_STEPS = 60;
/** Supported outside the cart this long (sim s) => lost. */
export const LOST_GROUNDED_SECONDS = 3;
/** Below this speed (m/s) a pineapple touching a support counts as resting on it. */
export const RESTING_SPEED = 0.5;
/** Contact tolerance for the geometric support test, metres. */
export const SUPPORT_SLOP = 0.05;
/**
 * Settle window after the first goal touch (S6T backlog #2), sim seconds.
 * Before: the run ended on the first touch, so pineapples still in the cart
 * behind the line never counted and careful driving scored worse than
 * flooring it. 2 s is about the time a cart at walking pace needs to roll
 * over the lip and tip its bed into the pit.
 */
export const GOAL_SETTLE_SECONDS = 2;
/**
 * Level runs: once nothing can be delivered any more (every pineapple lost,
 * and none left in the world or no cart left) for this long, the run ends
 * with `allLost` (S6T backlog #16). Before, it went on until Give Up.
 */
export const LEVEL_ALL_LOST_SECONDS = 2;
/** Cart bounds + this margin = the aboard box. */
export const ABOARD_MARGIN: AboardMargin = {
  side: PINEAPPLE_RADIUS,
  // two pineapple diameters of load may pile above the cart's top
  top: 4 * PINEAPPLE_RADIUS,
  bottom: 0,
};

export interface KeptWindow {
  minX: number;
  maxX: number;
}

export interface RunControllerOptions {
  /** "level" (default): goal ends the run. "endless": last loss ends it (`allLost`). */
  mode?: RunMode;
  /** Pineapples in the funnel (default 15). */
  pineapples?: number;
  /** Seed for spawn jitter / rotations. */
  seed?: number;
  /**
   * Kept-terrain window (S3 streaming supplies a body-aware one). Default:
   * the level's whole terrain x-extent.
   */
  keptWindow?: () => KeptWindow;
  /**
   * Caller-owned terrain (S6: the S3 TerrainStreamer builds the chunked
   * chain bodies from a LevelChunkSource / ProceduralChunkSource). When set,
   * the controller builds NO terrain body from `level.terrain` and answers
   * its ground-contact queries (lost rule) from this query instead. Without
   * it, the whole `level.terrain` is built as one static body (S1 default).
   */
  terrain?: TerrainQuery;
}

interface PineappleState {
  id: number;
  handle: BodyHandle;
  /** Still a body in the world (false once removed by the kill-plane). */
  alive: boolean;
  lost: boolean;
  /** Removed by the kill-plane after passing the goal line (level mode): counts as delivered. */
  arrived: boolean;
  /** Inside the aboard box at the last check. */
  aboard: boolean;
  /** Outside the aboard box at the last check. */
  out: boolean;
  /** Supported (landed / came to rest) since it was last seen out. */
  grounded: boolean;
  /** Check step at which it was first seen out AND grounded. */
  groundedOutSince: number | null;
  /** Centre at the previous step (swept goal test). */
  prev: Vec2;
}

interface CartBody {
  id: string;
  handle: BodyHandle;
  spec: CompoundSpec['bodies'][number];
}

export class RunController implements RunEventSource {
  readonly mode: RunMode;
  readonly spec: CompoundSpec;
  readonly cart: CartInstance;
  /** The controller's own terrain body; null when the caller owns the terrain (options.terrain). */
  readonly ground: BodyHandle | null;
  readonly props: readonly SolidProp[];
  readonly funnel: FunnelInstance;
  readonly camera: CameraFollow;
  readonly terrain: TerrainQuery;
  readonly total: number;
  /** BodySpec id of the chassis (heaviest rigid body): losing it loses the cart. */
  readonly chassisId: string;

  private readonly emitter = new RunEventEmitter();
  private readonly pineapples: PineappleState[];
  private readonly cartBodies: CartBody[];
  /** Cart bodies still in the world AND jointed (transitively) to the chassis. */
  private attached: Set<string>;
  private readonly poweredWheels: Array<{ id: string; handle: BodyHandle; torque: number; inertia: number }>;
  private readonly keptWindow: () => KeptWindow;
  private _phase: RunPhase = 'idle';
  private _steps = 0;
  private releaseStep: number | null = null;
  private endSimTime: number | null = null;
  private drive: DriveDirection = 0;
  private _cartLost = false;
  /** Some (non-chassis) cart body was removed: drive the survivors ourselves. */
  private _cartDamaged = false;
  private _delivered: number | null = null;
  private _aboard = 0;
  private _lastAboardBox: AABB | null = null;
  private _events: RunEvent[] = [];
  private supportCache: { step: number; set: Set<PineappleState> } | null = null;
  /** Level mode: step and sim time of the first goal touch (settle window running), else null. */
  private goalTouch: { step: number; simTime: number } | null = null;
  /** Level mode: step at which `remaining` reached 0 (all-lost grace running), else null. */
  private allLostSince: number | null = null;
  /** Chassis x at construction (distance origin for furthestMetres). */
  private readonly startX: number;
  private _furthest = 0;

  constructor(
    readonly world: PhysicsWorld,
    readonly design: CartDesign,
    readonly level: LevelDef,
    options: RunControllerOptions = {},
  ) {
    this.spec = resolveAttachments(design);
    if (!this.spec.valid) {
      throw new Error(`RunController: invalid cart (${this.spec.errors.map((e) => e.code).join(', ')})`);
    }
    this.mode = options.mode ?? 'level';
    this.total = options.pineapples ?? TOTAL_PINEAPPLES;
    this.terrain = options.terrain ?? new TerrainIndex(level.terrain.spans);
    this.keptWindow = options.keptWindow ?? (() => ({ minX: this.terrain.minX, maxX: this.terrain.maxX }));

    this.ground = options.terrain ? null : buildTerrain(world, level.terrain);
    this.props = buildSolidProps(world, level.props);
    this.cart = buildCompound(world, this.spec, level.cartStart);
    this.cartBodies = this.spec.bodies.map((b) => ({ id: b.id, handle: this.cart.bodies.get(b.id)!, spec: b }));
    this.attached = new Set(this.spec.bodies.map((b) => b.id));
    const rigid = this.cartBodies.filter((b) => b.spec.kind === 'rigid');
    const candidates = rigid.length > 0 ? rigid : this.cartBodies;
    let chassis = candidates[0]!;
    for (const b of candidates) if (world.getMass(b.handle) > world.getMass(chassis.handle)) chassis = b;
    this.chassisId = chassis.id;
    this.startX = world.getTransform(chassis.handle).x;
    // Same drive law as compound.ts (used only once the cart is damaged,
    // when compound's preStep would touch a removed wheel).
    this.poweredWheels = this.cartBodies
      .filter((b) => b.spec.kind === 'wheel' && b.spec.powered)
      .map((b) => ({
        id: b.id,
        handle: b.handle,
        torque: DRIVE_TORQUE_PER_MASS * world.getMass(b.handle),
        inertia: world.getRotationalInertia(b.handle),
      }));

    this.funnel = buildFunnel(world, level.funnel, this.total, options.seed ?? 15);
    this.pineapples = this.funnel.pineapples.map((handle, id) => {
      const t = world.getTransform(handle);
      return {
        id,
        handle,
        alive: true,
        lost: false,
        arrived: false,
        aboard: false,
        out: false,
        grounded: false,
        groundedOutSince: null,
        prev: { x: t.x, y: t.y },
      };
    });
    this._aboard = 0;

    this.camera = new CameraFollow({ x: 0, y: 0 });
    const rm = this.rightmostCartBody();
    if (rm) this.camera.snap(rm);
  }

  // ------------------------------------------------------------ queries

  on(listener: RunEventListener): () => void {
    return this.emitter.on(listener);
  }

  get phase(): RunPhase {
    return this._phase;
  }

  /** Fixed steps simulated since start(). */
  get steps(): number {
    return this._steps;
  }

  /**
   * Simulation seconds since Release (0 before; frozen once ended).
   * RunEventSource contract (INTEGRATION.md amendment 1): a method, polled
   * by the HUD timer.
   */
  simTime(): number {
    if (this.endSimTime !== null) return this.endSimTime;
    if (this.goalTouch !== null) return this.goalTouch.simTime;
    return this.releaseStep === null ? 0 : (this._steps - this.releaseStep) * FIXED_DT;
  }

  get lostCount(): number {
    return this.pineapples.filter((p) => p.lost).length;
  }

  get remaining(): number {
    return this.total - this.lostCount;
  }

  /** Pineapples inside the aboard box at the last 1 Hz check. */
  get aboard(): number {
    return this._aboard;
  }

  /** Aboard box used at the last check (debug draw); null before Release / without a cart. */
  get aboardBox(): AABB | null {
    return this._lastAboardBox ? { ...this._lastAboardBox } : null;
  }

  get delivered(): number | null {
    return this._delivered;
  }

  /** Level mode: a pineapple has touched the goal and the settle window is running (the clock is frozen). */
  get goalSettling(): boolean {
    return this.goalTouch !== null && this._phase === 'released';
  }

  /** Pineapples past the goal line right now (arrived ones included). */
  pastGoalLine(): number {
    const lineX = this.level.goal.lineX;
    return this.pineapples.filter((p) => p.arrived || (p.alive && this.world.getTransform(p.handle).x > lineX)).length;
  }

  get cartLost(): boolean {
    return this._cartLost;
  }

  /** A non-chassis cart body has been removed by the kill-plane. */
  get cartDamaged(): boolean {
    return this._cartDamaged;
  }

  /**
   * Furthest distance (metres) the cart has carried cargo: the chassis x
   * travelled from its start, sampled every step after Release while at
   * least one pineapple was aboard at the last 1 Hz check (PLAN "Endless
   * mode rules"). Frozen once the run ends. Never negative. Controller
   * surface for the endless HUD / results (INTEGRATION.md amendment 2).
   */
  furthestMetres(): number {
    return this._furthest;
  }

  /** Every event emitted so far (for logs / tests). */
  get events(): readonly RunEvent[] {
    return this._events;
  }

  /** Pineapple bodies with their ids and status. */
  pineappleStates(): Array<{ id: number; handle: BodyHandle; alive: boolean; lost: boolean }> {
    return this.pineapples.map(({ id, handle, alive, lost }) => ({ id, handle, alive, lost }));
  }

  /** Cart bodies that still count as the cart (in the world, jointed to the chassis). */
  cartBodyHandles(): BodyHandle[] {
    if (this._cartLost) return [];
    return this.cartBodies.filter((b) => this.attached.has(b.id)).map((b) => b.handle);
  }

  /** Current pose of the right-most cart body (by body origin x); null once the cart is gone. */
  rightmostCartBody(): Vec2 | null {
    let best: Vec2 | null = null;
    for (const handle of this.cartBodyHandles()) {
      const t = this.world.getTransform(handle);
      if (!best || t.x > best.x) best = { x: t.x, y: t.y };
    }
    return best;
  }

  /** World AABB of the whole cart (current pose), null without a cart. */
  cartBounds(): AABB | null {
    if (this._cartLost) return null;
    return unionBoxes(
      this.cartBodies.filter((b) => this.attached.has(b.id)).map(({ handle, spec }) => shapesWorldAABB(spec.shapes, this.world.getTransform(handle))),
    );
  }

  // ------------------------------------------------------------ commands

  /** Start: physics begins. Returns false if not idle. */
  start(): boolean {
    if (this._phase !== 'idle') return false;
    this._phase = 'started';
    this.emit({ type: 'started', simTime: 0 });
    return true;
  }

  /** Release: pull the plug, start the sim clock. Only after start(). */
  release(): boolean {
    if (this._phase !== 'started') return false;
    this.funnel.pullPlug();
    this.releaseStep = this._steps;
    this._phase = 'released';
    this.emit({ type: 'released', simTime: 0 });
    return true;
  }

  /** Give up: ends the run (any phase before ended). */
  giveUp(): boolean {
    if (this._phase === 'ended') return false;
    if (this.goalSettling) {
      // the goal was already reached: Give Up just skips the rest of the window
      this.finishGoal();
      return true;
    }
    const t = this.simTime();
    this.end();
    this.emit({ type: 'gaveUp', simTime: t });
    return true;
  }

  /** Drive direction for the following steps; ignored when idle/ended. */
  setDrive(dir: DriveDirection): void {
    this.drive = dir;
  }

  /** One fixed step. No-op while idle (physics is off before Start). */
  step(): void {
    if (this._phase === 'idle') return;
    this.applyDrive(this._phase !== 'ended' && !this._cartLost ? this.drive : 0);
    this.world.step();
    this._steps++;

    if (this._phase === 'released') {
      this.killPlane();
      if (this.isOpen()) this.trackGround();
      if (this.isOpen() && (this._steps - this.releaseStep!) % ABOARD_CHECK_STEPS === 0) this.aboardCheck();
      if (this.isOpen()) this.checkGoal();
      if (this.isOpen()) this.checkLevelAllLost();
      if (this.isOpen()) this.trackDistance();
      this.recordPositions();
    } else {
      // started: nothing can be lost before Release, but a cart can still be
      // driven off the world. ended: keep removing what falls out.
      this.killCart();
      if (this._phase === 'ended') this.killPineapplesSilently();
      this.recordPositions();
    }
    this.camera.step(this.rightmostCartBody());
  }

  /** Tear down the run's bodies (the world itself belongs to the caller). */
  destroy(): void {
    this.emitter.clear();
    if (this.world.isDestroyed) return;
    this.cart.destroy();
    for (const p of this.pineapples) if (this.world.hasBody(p.handle)) this.world.destroyBody(p.handle);
    this.funnel.pullPlug();
    if (this.world.hasBody(this.funnel.walls)) this.world.destroyBody(this.funnel.walls);
    for (const p of this.props) if (this.world.hasBody(p.handle)) this.world.destroyBody(p.handle);
    if (this.ground !== null && this.world.hasBody(this.ground)) this.world.destroyBody(this.ground);
  }

  // ------------------------------------------------------------ internals

  private isOpen(): boolean {
    return this._phase === 'released';
  }

  /**
   * Emit, with the terminal guard: once a terminal event has been emitted,
   * nothing else is (a listener that gives up inside pineappleLost cannot be
   * followed by more losses or a goal).
   */
  private emit(e: RunEvent): void {
    const last = this._events.at(-1);
    if (last && isTerminalRunEvent(last)) return;
    this._events.push(e);
    this.emitter.emit(e);
  }

  private end(): void {
    this.endSimTime = this.simTime();
    this._phase = 'ended';
    this.drive = 0;
    this.cart.setDrive(0);
  }

  private applyDrive(dir: DriveDirection): void {
    if (this._cartLost) return;
    if (!this._cartDamaged) {
      this.cart.setDrive(dir);
      this.cart.preStep();
      return;
    }
    // compound.preStep would touch removed wheels: same law, survivors only.
    // The surviving shocks keep their bump stops (S6T audit-1 #2).
    this.cart.setDrive(0);
    this.cart.applyShockStops();
    if (dir === 0) return;
    for (const w of this.poweredWheels) {
      if (!this.attached.has(w.id)) continue;
      const headroom = DRIVE_MAX_SPEED - dir * this.world.getAngularVelocity(w.handle);
      if (headroom <= 0) continue;
      this.world.applyTorque(w.handle, dir * Math.min(w.torque, (w.inertia * headroom) / FIXED_DT));
    }
  }

  private markLost(p: PineappleState): void {
    if (p.lost || this._phase !== 'released') return;
    p.lost = true;
    this.emit({ type: 'pineappleLost', simTime: this.simTime(), pineappleId: p.id, remaining: this.remaining });
    if (this.mode === 'endless' && this.remaining === 0 && this._phase === 'released') {
      const t = this.simTime();
      this.end();
      this.emit({ type: 'allLost', simTime: t });
    }
  }

  private killCart(): void {
    if (this._cartLost) return;
    let removed = false;
    for (const b of this.cartBodies) {
      if (!this.world.hasBody(b.handle) || this.world.getTransform(b.handle).y <= this.level.killY) continue;
      if (b.id === this.chassisId) {
        this.cart.destroy();
        this._cartLost = true;
        this.attached = new Set();
        return;
      }
      this.world.destroyBody(b.handle); // Box2D removes its joints with it
      removed = true;
    }
    if (removed) {
      this._cartDamaged = true;
      this.attached = this.connectedToChassis();
    }
  }

  /** Bodies still in the world and reachable from the chassis through surviving joints. */
  private connectedToChassis(): Set<string> {
    const alive = new Set(this.cartBodies.filter((b) => this.world.hasBody(b.handle)).map((b) => b.id));
    const out = new Set<string>();
    if (!alive.has(this.chassisId)) return out;
    const queue = [this.chassisId];
    out.add(this.chassisId);
    while (queue.length) {
      const id = queue.pop()!;
      for (const j of this.spec.joints) {
        const other = j.bodyA === id ? j.bodyB : j.bodyB === id ? j.bodyA : null;
        if (other && alive.has(other) && !out.has(other)) {
          out.add(other);
          queue.push(other);
        }
      }
    }
    return out;
  }

  private killPlane(): void {
    this.killCart();
    const lineX = this.level.goal.lineX;
    for (const p of this.pineapples) {
      if (!p.alive) continue;
      const t = this.world.getTransform(p.handle);
      if (t.y <= this.level.killY) continue;
      this.world.destroyBody(p.handle);
      p.alive = false;
      // level runs: past the goal line it has arrived, never lost
      if (this.mode === 'level' && Math.max(t.x, p.prev.x) > lineX) p.arrived = true;
      else this.markLost(p);
      if (!this.isOpen()) return;
    }
  }

  /** After the end: bodies still fall out of the world, but nothing is reported. */
  private killPineapplesSilently(): void {
    for (const p of this.pineapples) {
      if (p.alive && this.world.getTransform(p.handle).y > this.level.killY) {
        this.world.destroyBody(p.handle);
        p.alive = false;
      }
    }
  }

  /** Per step: pineapples seen outside the cart note when they land / come to rest. */
  private trackGround(): void {
    for (const p of this.pineapples) {
      if (!p.alive || p.lost || !p.out || p.grounded) continue;
      if (this.isSupported(p)) p.grounded = true;
    }
  }

  /**
   * Supported = in real contact with the world, directly or through a chain
   * of pineapples. Seeds: touching terrain, or slow AND touching a funnel
   * wall / plug, a solid prop or a cart wheel. Then, transitively: slow AND
   * touching a supported pineapple that sits at or below it. Pineapples in
   * the cart (aboard) neither seed nor extend a chain. A cluster of slow
   * pineapples in mid-air (apex of a throw) touches nothing real, so none of
   * it is supported. Computed once per step (cached).
   */
  private supportedSet(): Set<PineappleState> {
    if (this.supportCache && this.supportCache.step === this._steps) return this.supportCache.set;
    const r = PINEAPPLE_RADIUS;
    const polys = [...this.funnel.geometry.walls, ...(this.funnel.plug !== null ? [this.funnel.geometry.plug] : []), ...this.props.map((q) => q.polygon)];
    const wheels = this.cartBodies
      .filter((b) => b.spec.kind === 'wheel' && this.attached.has(b.id))
      .flatMap((b) => {
        const t = this.world.getTransform(b.handle);
        return b.spec.shapes.flatMap((sh) =>
          sh.type === 'circle' ? [{ x: t.x + Math.cos(t.angle) * sh.center.x - Math.sin(t.angle) * sh.center.y, y: t.y + Math.sin(t.angle) * sh.center.x + Math.cos(t.angle) * sh.center.y, radius: sh.radius }] : [],
        );
      });
    const cands = this.pineapples
      .filter((p) => p.alive && !p.aboard)
      .map((p) => {
        const c = this.world.getTransform(p.handle);
        const v = this.world.getLinearVelocity(p.handle);
        return { p, c, slow: Math.hypot(v.x, v.y) < RESTING_SPEED };
      });
    const set = new Set<PineappleState>();
    const frontier: typeof cands = [];
    for (const k of cands) {
      const seeded =
        this.terrain.circleTouches(k.c, r) ||
        (k.slow &&
          (polys.some((poly) => circleTouchesPolygon(k.c, r, poly, SUPPORT_SLOP)) ||
            wheels.some((wh) => Math.hypot(wh.x - k.c.x, wh.y - k.c.y) <= wh.radius + r + SUPPORT_SLOP)));
      if (seeded) {
        set.add(k.p);
        frontier.push(k);
      }
    }
    while (frontier.length) {
      const m = frontier.pop()!;
      for (const k of cands) {
        if (set.has(k.p) || !k.slow) continue;
        // resting on m: touching it, and m at or below (y-down: larger y)
        if (m.c.y >= k.c.y - SUPPORT_SLOP && Math.hypot(m.c.x - k.c.x, m.c.y - k.c.y) <= 2 * r + SUPPORT_SLOP) {
          set.add(k.p);
          frontier.push(k);
        }
      }
    }
    this.supportCache = { step: this._steps, set };
    return set;
  }

  private isSupported(p: PineappleState): boolean {
    return this.supportedSet().has(p);
  }

  private aboardCheck(): void {
    const bounds = this.cartBounds();
    const box = bounds ? expandBox(bounds, ABOARD_MARGIN) : null;
    this._lastAboardBox = box;
    const win = this.keptWindow();
    const lineX = this.level.goal.lineX;
    const lostAfter = Math.round(LOST_GROUNDED_SECONDS / FIXED_DT);
    // aboard flags first (the support test reads them)
    for (const p of this.pineapples) {
      if (!p.alive || p.lost) {
        p.aboard = false;
        continue;
      }
      const pos = this.world.getTransform(p.handle);
      // On the ground is never aboard, even inside the box (e.g. a spilled
      // pineapple resting against a wheel of a parked cart).
      p.aboard = box !== null && pointInBox(pos, box) && !this.terrain.circleTouches(pos, PINEAPPLE_RADIUS);
    }
    this._aboard = this.pineapples.filter((p) => p.aboard).length;
    this.supportCache = null; // aboard flags changed: recompute support this step
    for (const p of this.pineapples) {
      if (!this.isOpen()) return; // a listener ended the run
      if (!p.alive || p.lost) continue;
      const pos = this.world.getTransform(p.handle);
      if (this.mode === 'level' && pos.x >= lineX) {
        // arrived: never lost from here on
        p.out = false;
        p.grounded = false;
        p.groundedOutSince = null;
        continue;
      }
      if (pos.x < win.minX || pos.x > win.maxX) {
        this.markLost(p);
        continue;
      }
      if (p.aboard) {
        p.out = false;
        p.grounded = false;
        p.groundedOutSince = null;
        continue;
      }
      if (!p.out) {
        p.out = true;
        p.grounded = this.isSupported(p);
      }
      if (p.grounded && p.groundedOutSince === null) p.groundedOutSince = this._steps;
      if (p.groundedOutSince !== null && this._steps - p.groundedOutSince >= lostAfter) this.markLost(p);
    }
  }

  private checkGoal(): void {
    if (this.mode !== 'level' || !this.isOpen()) return;
    if (this.goalTouch !== null) {
      const settled = this._steps - this.goalTouch.step >= Math.round(GOAL_SETTLE_SECONDS / FIXED_DT);
      const allIn = this.pineapples.every((p) => !p.alive || p.arrived || this.world.getTransform(p.handle).x > this.level.goal.lineX);
      if (settled || allIn) this.finishGoal();
      return;
    }
    const sensor = this.level.goal.sensor;
    // lost is advisory in level runs: any live pineapple can end it; the
    // swept test catches one that crosses a thin sensor between two steps
    const touching = this.pineapples.some(
      (p) => p.alive && sweptCircleTouchesRect(p.prev, this.world.getTransform(p.handle), PINEAPPLE_RADIUS, sensor),
    );
    if (!touching) return;
    this.goalTouch = { step: this._steps, simTime: this.simTime() };
    this.allLostSince = null;
  }

  /** End the settle window: delivered = pineapples past the line now; time = the first touch. */
  private finishGoal(): void {
    if (this.goalTouch === null || this._phase !== 'released') return;
    const delivered = this.pastGoalLine();
    const t = this.goalTouch.simTime;
    this._delivered = delivered;
    this.end();
    this.emit({ type: 'goalReached', simTime: t, delivered });
  }

  /**
   * Level mode (S6T #16): the run ends with `allLost` once NOTHING can be
   * delivered any more, for LEVEL_ALL_LOST_SECONDS: every pineapple lost
   * (none past the line — those are never lost) AND either none is still a
   * body in the world (all fell out) or the cart is gone. Lost stays
   * advisory otherwise (INTEGRATION S1 ruling): a lost pile on the ground
   * can still be bulldozed into the blender, so while it and a cart exist
   * the run goes on (the HUD nudges Give Up / Retry instead).
   */
  private checkLevelAllLost(): void {
    if (this.mode !== 'level' || this.goalTouch !== null) return;
    const recoverable = !this._cartLost && this.pineapples.some((p) => p.alive);
    if (this.remaining > 0 || recoverable) {
      this.allLostSince = null;
      return;
    }
    this.allLostSince ??= this._steps;
    if (this._steps - this.allLostSince < Math.round(LEVEL_ALL_LOST_SECONDS / FIXED_DT)) return;
    const t = this.simTime();
    this.end();
    this.emit({ type: 'allLost', simTime: t });
  }

  private trackDistance(): void {
    if (this._cartLost || this._aboard === 0) return;
    const chassis = this.cartBodies.find((b) => b.id === this.chassisId);
    if (!chassis || !this.world.hasBody(chassis.handle)) return;
    const d = this.world.getTransform(chassis.handle).x - this.startX;
    if (Number.isFinite(d) && d > this._furthest) this._furthest = d;
  }

  private recordPositions(): void {
    for (const p of this.pineapples) {
      if (!p.alive) continue;
      const t = this.world.getTransform(p.handle);
      p.prev = { x: t.x, y: t.y };
    }
  }
}
