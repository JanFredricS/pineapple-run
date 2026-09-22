/**
 * Run controller (S1): owns the run-phase simulation and EMITS the S0 run
 * lifecycle events (model/runEvents, contract 3). It never computes scores —
 * S5 feeds the events to model/score.
 *
 * Build (constructor): terrain from the LevelDef spans, the cart through the
 * production path (resolveAttachments -> physics/compound.buildCompound) at
 * `level.cartStart`, and the funnel holding the pineapples behind a plug at
 * `level.funnel` (see run/funnel.ts).
 *
 * Flow:   idle --start()--> started --release()--> released --> ended
 *   - start():   physics begins stepping; emits `started`. Driving allowed.
 *   - release(): pulls the plug; emits `released`; the sim clock (seconds
 *                since Release = steps × 1/60) starts from 0.
 *   - ended:     `goalReached(delivered)` or `gaveUp`. Physics keeps stepping
 *                (for visuals) with the drive off; no further events.
 *
 * Per fixed step after Release (in this order):
 *   1. kill-plane: any pineapple below level.killY is destroyed (and lost if
 *      not already); if any cart body falls below it the whole cart is
 *      destroyed (joints never break, so a cart falls as one piece).
 *   2. ground tracking for pineapples currently outside the cart.
 *   3. every ABOARD_CHECK_STEPS (1 s): the aboard check / lost rule.
 *   4. goal: a (non-lost) pineapple touching the goal sensor rect ends the
 *      run; delivered = non-lost pineapples whose centre is past goal.lineX.
 *
 * Lost rule (PLAN.md "Endless mode rules", applied in level runs too):
 * "aboard" = centre inside the cart's world AABB + margin and not touching
 * the terrain, re-checked each second. A pineapple is lost when it has stayed outside for ≥ 3 s since it
 * was grounded (touching terrain, or resting on something that isn't the
 * cart — e.g. a pile of spilled pineapples, or jammed in the funnel), or
 * when it leaves the kept-terrain window. Pineapples past the goal line have
 * ARRIVED and are never marked lost (the original counted anything that got
 * there). Lost is permanent: `remaining` only goes down.
 */

import { resolveAttachments, type CompoundSpec } from '../model/attach';
import type { CartDesign } from '../model/cart';
import type { AABB, Vec2 } from '../model/geometry';
import type { LevelDef } from '../model/level';
import { RunEventEmitter, type RunEvent, type RunEventListener, type RunEventSource } from '../model/runEvents';
import { TOTAL_PINEAPPLES } from '../model/score';
import { PINEAPPLE_RADIUS } from '../physics/cargo';
import { FIXED_DT } from '../physics/clock';
import { buildCompound, type CartInstance, type DriveDirection } from '../physics/compound';
import type { BodyHandle, PhysicsWorld } from '../physics/engine';
import { buildTerrain } from '../physics/terrain';
import { CameraFollow } from './camera';
import { buildFunnel, type FunnelInstance } from './funnel';
import { circleTouchesRect, expandBox, pointInBox, shapesWorldAABB, unionBoxes, type AboardMargin } from './shapes';
import { TerrainIndex } from './terrainQuery';

export type RunPhase = 'idle' | 'started' | 'released' | 'ended';

/** Aboard re-check period (1 s of sim time). */
export const ABOARD_CHECK_STEPS = 60;
/** Grounded outside the cart this long (sim s) => lost. */
export const LOST_GROUNDED_SECONDS = 3;
/** Below this speed (m/s) a pineapple outside the cart counts as resting on something. */
export const RESTING_SPEED = 0.5;
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
  /** Pineapples in the funnel (default 15). */
  pineapples?: number;
  /** Seed for spawn jitter / rotations. */
  seed?: number;
  /**
   * Kept-terrain window (S3 streaming supplies a body-aware one). Default:
   * the level's whole terrain x-extent.
   */
  keptWindow?: () => KeptWindow;
}

interface PineappleState {
  id: number;
  handle: BodyHandle;
  /** Still a body in the world (false once removed by the kill-plane). */
  alive: boolean;
  lost: boolean;
  /** Outside the aboard box at the last check. */
  out: boolean;
  /** Touched ground / came to rest since it was last seen out. */
  grounded: boolean;
  /** Check step at which it was first seen out AND grounded. */
  groundedOutSince: number | null;
}

export class RunController implements RunEventSource {
  readonly spec: CompoundSpec;
  readonly cart: CartInstance;
  readonly ground: BodyHandle;
  readonly funnel: FunnelInstance;
  readonly camera: CameraFollow;
  readonly terrain: TerrainIndex;
  readonly total: number;

  private readonly emitter = new RunEventEmitter();
  private readonly pineapples: PineappleState[];
  private readonly cartShapes: Array<{ handle: BodyHandle; spec: CompoundSpec['bodies'][number] }>;
  private readonly keptWindow: () => KeptWindow;
  private _phase: RunPhase = 'idle';
  private _steps = 0;
  private releaseStep: number | null = null;
  private endSimTime: number | null = null;
  private drive: DriveDirection = 0;
  private _cartLost = false;
  private _delivered: number | null = null;
  private _aboard = 0;
  private _lastAboardBox: AABB | null = null;
  private _events: RunEvent[] = [];

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
    this.total = options.pineapples ?? TOTAL_PINEAPPLES;
    this.terrain = new TerrainIndex(level.terrain.spans);
    this.keptWindow = options.keptWindow ?? (() => ({ minX: this.terrain.minX, maxX: this.terrain.maxX }));

    this.ground = buildTerrain(world, level.terrain);
    this.cart = buildCompound(world, this.spec, level.cartStart);
    this.cartShapes = this.spec.bodies.map((b) => ({ handle: this.cart.bodies.get(b.id)!, spec: b }));
    this.funnel = buildFunnel(world, level.funnel, this.total, options.seed ?? 15);
    this.pineapples = this.funnel.pineapples.map((handle, id) => ({
      id,
      handle,
      alive: true,
      lost: false,
      out: false,
      grounded: false,
      groundedOutSince: null,
    }));
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

  /** Simulation seconds since Release (0 before; frozen once ended). */
  get simTime(): number {
    if (this.endSimTime !== null) return this.endSimTime;
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

  get cartLost(): boolean {
    return this._cartLost;
  }

  /** Every event emitted so far (for logs / tests). */
  get events(): readonly RunEvent[] {
    return this._events;
  }

  /** Pineapple bodies still in the world, with their ids and status. */
  pineappleStates(): Array<{ id: number; handle: BodyHandle; alive: boolean; lost: boolean }> {
    return this.pineapples.map(({ id, handle, alive, lost }) => ({ id, handle, alive, lost }));
  }

  /** Current pose of the right-most cart body (by body origin x); null once the cart is gone. */
  rightmostCartBody(): Vec2 | null {
    if (this._cartLost) return null;
    let best: Vec2 | null = null;
    for (const { handle } of this.cartShapes) {
      if (!this.world.hasBody(handle)) continue;
      const t = this.world.getTransform(handle);
      if (!best || t.x > best.x) best = { x: t.x, y: t.y };
    }
    return best;
  }

  /** World AABB of the whole cart (current pose), null without a cart. */
  cartBounds(): AABB | null {
    if (this._cartLost) return null;
    return unionBoxes(
      this.cartShapes.filter(({ handle }) => this.world.hasBody(handle)).map(({ handle, spec }) => shapesWorldAABB(spec.shapes, this.world.getTransform(handle))),
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
    const t = this.simTime;
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
    const driving = this._phase !== 'ended' && !this._cartLost;
    this.cart.setDrive(driving ? this.drive : 0);
    if (!this._cartLost) this.cart.preStep();
    this.world.step();
    this._steps++;

    if (this._phase === 'released') {
      this.killPlane();
      this.trackGround();
      if ((this._steps - this.releaseStep!) % ABOARD_CHECK_STEPS === 0) this.aboardCheck();
      this.checkGoal();
    } else if (this._phase === 'started') {
      // nothing can be lost before Release, but a cart can still be driven off the world
      this.killCart();
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
    if (this.world.hasBody(this.ground)) this.world.destroyBody(this.ground);
  }

  // ------------------------------------------------------------ internals

  private emit(e: RunEvent): void {
    this._events.push(e);
    this.emitter.emit(e);
  }

  private end(): void {
    this.endSimTime = this.simTime;
    this._phase = 'ended';
    this.drive = 0;
    this.cart.setDrive(0);
  }

  private markLost(p: PineappleState): void {
    if (p.lost) return;
    p.lost = true;
    this.emit({ type: 'pineappleLost', simTime: this.simTime, pineappleId: p.id, remaining: this.remaining });
  }

  private killCart(): void {
    if (this._cartLost) return;
    for (const { handle } of this.cartShapes) {
      if (this.world.hasBody(handle) && this.world.getTransform(handle).y > this.level.killY) {
        this.cart.destroy();
        this._cartLost = true;
        return;
      }
    }
  }

  private killPlane(): void {
    this.killCart();
    for (const p of this.pineapples) {
      if (!p.alive) continue;
      if (this.world.getTransform(p.handle).y > this.level.killY) {
        this.world.destroyBody(p.handle);
        p.alive = false;
        this.markLost(p);
      }
    }
  }

  /** Per step: pineapples seen outside the cart note when they touch down / come to rest. */
  private trackGround(): void {
    for (const p of this.pineapples) {
      if (!p.alive || p.lost || !p.out || p.grounded) continue;
      if (this.isGrounded(p)) p.grounded = true;
    }
  }

  private isGrounded(p: PineappleState): boolean {
    const t = this.world.getTransform(p.handle);
    if (this.terrain.circleTouches(t, PINEAPPLE_RADIUS)) return true;
    const v = this.world.getLinearVelocity(p.handle);
    return Math.hypot(v.x, v.y) < RESTING_SPEED;
  }

  private aboardCheck(): void {
    const bounds = this.cartBounds();
    const box = bounds ? expandBox(bounds, ABOARD_MARGIN) : null;
    this._lastAboardBox = box;
    const win = this.keptWindow();
    const lineX = this.level.goal.lineX;
    const lostAfter = Math.round(LOST_GROUNDED_SECONDS / FIXED_DT);
    let aboard = 0;
    for (const p of this.pineapples) {
      if (!p.alive || p.lost) continue;
      const pos = this.world.getTransform(p.handle);
      // On the ground is never aboard, even inside the box (e.g. a spilled
      // pineapple resting against a wheel of a parked cart).
      const inside = box !== null && pointInBox(pos, box) && !this.terrain.circleTouches(pos, PINEAPPLE_RADIUS);
      if (inside) aboard++;
      if (pos.x >= lineX) {
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
      if (inside) {
        p.out = false;
        p.grounded = false;
        p.groundedOutSince = null;
        continue;
      }
      if (!p.out) {
        p.out = true;
        p.grounded = this.isGrounded(p);
      }
      if (p.grounded && p.groundedOutSince === null) p.groundedOutSince = this._steps;
      if (p.groundedOutSince !== null && this._steps - p.groundedOutSince >= lostAfter) this.markLost(p);
    }
    this._aboard = aboard;
  }

  private checkGoal(): void {
    if (this._phase !== 'released') return;
    const sensor = this.level.goal.sensor;
    const touching = this.pineapples.some(
      (p) => p.alive && !p.lost && circleTouchesRect(this.world.getTransform(p.handle), PINEAPPLE_RADIUS, sensor),
    );
    if (!touching) return;
    const lineX = this.level.goal.lineX;
    const delivered = this.pineapples.filter((p) => p.alive && !p.lost && this.world.getTransform(p.handle).x > lineX).length;
    const t = this.simTime;
    this._delivered = delivered;
    this.end();
    this.emit({ type: 'goalReached', simTime: t, delivered });
  }
}
