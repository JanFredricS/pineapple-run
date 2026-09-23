/**
 * RunSession: one run of one cart on one course, headless (no DOM, no Pixi).
 *
 * The integration core shared by the browser run screen (src/game/runScreen)
 * and the S6 integration tests. It owns, per run:
 *   - a fresh PhysicsWorld (every retry gets a new one: nothing carries over),
 *   - the S3 TerrainStreamer over the course's TerrainSource
 *     (LevelChunkSource for premade levels, ProceduralChunkSource for
 *     endless) building chunked chain bodies, streamed around the live
 *     bodies (attached cart + every live pineapple that can still count —
 *     see liveXs()),
 *   - a StreamedTerrainQuery mirroring exactly those chunks for the
 *     controller's ground-contact queries,
 *   - the S1 RunController in `level` or `endless` mode, with
 *     `terrain` = the streamed query (it then builds no terrain of its own).
 *
 * Deterministic: identical design + course + drive sequence => identical
 * event stream and poses (fixed 1/60 steps, seeded spawns, no wall clock).
 */

import type { CartDesign } from '../model/cart';
import type { LevelDef } from '../model/level';
import type { RunEvent, RunEventListener, RunEventSource } from '../model/runEvents';
import type { DriveDirection } from '../physics/compound';
import { FIXED_DT } from '../physics/clock';
import { PhysicsWorld } from '../physics/engine';
import { RunController, type RunMode } from '../run/controller';
import { StuckDetector } from '../run/stuck';
import type { TerrainSource } from '../terrain/chunks';
import { TerrainStreamer } from '../terrain/runtime';
import { designBottomPx } from './startArea';
import { StreamedTerrainQuery } from './streamedTerrain';

/** What a run is played on: a validated LevelDef plus its terrain source. */
export interface Course {
  /** AppState levelId: `beach` / `kitchen` / `workbench` / `original` / `endless:<SEED>`. */
  levelId: string;
  mode: RunMode;
  /**
   * Level context: cart start, funnel, goal, props, killY, theme. For endless
   * the terrain spans are empty (terrain comes from `source`) and the goal is
   * unused (the controller ignores it in endless mode).
   */
  level: LevelDef;
  source: TerrainSource;
  /** Endless seed (display), absent for premade levels. */
  seed?: string;
}

/** Terrain is re-planned every this many fixed steps (0.1 s; windows have tens of metres of margin). */
export const STREAM_EVERY_STEPS = 6;

export class RunSession implements RunEventSource {
  readonly terrain: TerrainStreamer;
  readonly query = new StreamedTerrainQuery();
  readonly controller: RunController;
  /** Actual cart spawn (cartStart, lifted if the design reaches below its ground line). */
  readonly spawn: { x: number; y: number };
  /** S6T #5: the cart has barely moved for a while (HUD shows "Stuck?"). */
  readonly stuckDetector = new StuckDetector();
  private destroyed = false;

  private constructor(
    readonly world: PhysicsWorld,
    readonly design: CartDesign,
    readonly course: Course,
  ) {
    this.terrain = new TerrainStreamer(world, course.source);
    this.terrain.addListener(this.query);
    const start = course.level.cartStart;
    // Builder convention (INTEGRATION.md #3): design y = 0 is the ground line
    // and cartStart is the ground at the start. A wheel whose radius was
    // dragged below the line would spawn inside the ground: lift the cart
    // by exactly that overlap.
    const below = Math.max(0, designBottomPx(design)) / 30;
    this.spawn = { x: start.x, y: start.y - below };
    // Terrain first (around the cart and the funnel), then the run.
    this.terrain.update([start.x - 1, start.x + 12, course.level.funnel.x]);
    this.controller = new RunController(world, design, { ...course.level, cartStart: this.spawn }, {
      mode: course.mode,
      terrain: this.query,
      keptWindow: () => ({ minX: this.query.minX, maxX: this.query.maxX }),
    });
    this.stream();
  }

  /** Build a session in a fresh physics world. Throws (and frees the world) on an invalid cart. */
  static async create(design: CartDesign, course: Course): Promise<RunSession> {
    const world = await PhysicsWorld.create();
    try {
      return new RunSession(world, design, course);
    } catch (err) {
      world.destroy();
      throw err;
    }
  }

  // ------------------------------------------------------ RunEventSource

  on(listener: RunEventListener): () => void {
    return this.controller.on(listener);
  }

  simTime(): number {
    return this.controller.simTime();
  }

  // ------------------------------------------------------------ telemetry

  furthestMetres(): number {
    return this.controller.furthestMetres();
  }

  aboard(): number {
    return this.controller.aboard;
  }

  get events(): readonly RunEvent[] {
    return this.controller.events;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  // ------------------------------------------------------------- commands

  start(): boolean {
    return this.controller.start();
  }

  release(): boolean {
    return this.controller.release();
  }

  giveUp(): boolean {
    return this.controller.giveUp();
  }

  setDrive(dir: DriveDirection): void {
    this.controller.setDrive(dir);
  }

  /** One fixed step (1/60 s) of the whole run: controller, then terrain streaming. */
  step(): void {
    if (this.destroyed) return;
    this.controller.step();
    if (this.controller.steps % STREAM_EVERY_STEPS === 0) this.stream();
    const c = this.controller;
    const h = c.cart.bodies.get(c.chassisId);
    const pos = !c.cartLost && h !== undefined && this.world.hasBody(h) ? this.world.getTransform(h) : null;
    this.stuckDetector.sample(pos, FIXED_DT, c.phase === 'released' && !c.goalSettling);
  }

  /** S6T #5: the cart has moved less than STUCK_DISPLACEMENT for STUCK_SECONDS of live run. */
  get stuck(): boolean {
    return this.stuckDetector.stuck;
  }

  /**
   * Streaming anchors: the attached cart + every pineapple that can still
   * count. Level runs: every LIVE pineapple, lost or not — lost is advisory
   * there (INTEGRATION.md S1 ruling): a lost pineapple can still be recovered
   * and delivered, so its ground must stay loaded (else it falls through
   * unloaded terrain and is destroyed at killY). Endless: lost is final, so
   * lost pineapples are not anchors (their terrain may unload; they then
   * fall away like cart debris, which never counts again).
   */
  liveXs(): number[] {
    const xs: number[] = [];
    for (const h of this.controller.cartBodyHandles()) xs.push(this.world.getTransform(h).x);
    const lostAnchors = this.course.mode === 'level';
    for (const p of this.controller.pineappleStates()) {
      if (p.alive && (lostAnchors || !p.lost)) xs.push(this.world.getTransform(p.handle).x);
    }
    return xs;
  }

  private stream(): void {
    const xs = this.liveXs();
    // Cart gone and everything lost: keep what is loaded (the plan is a no-op anyway).
    if (xs.length) this.terrain.update(xs);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.controller.destroy();
    this.terrain.destroyAll();
    this.terrain.removeListener(this.query);
    this.world.destroy();
  }
}
