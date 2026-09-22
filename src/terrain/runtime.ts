/**
 * Streaming terrain runtime: TerrainSource chunks -> physics chain bodies.
 *
 * One static body per loaded chunk, one chain per chunk piece (pieces of one
 * chunk never connect across a gap). The chunk set follows the pure window
 * logic in streaming.ts; every create/destroy is mirrored to registered
 * ChunkLifecycleListeners (the renderer) — see chunks.ts for the contract.
 *
 * Typical use (S1/S6):
 *   const terrain = new TerrainStreamer(world, source);
 *   terrain.addListener(renderer);
 *   each fixed step (or every few): terrain.update(liveBodyXs);
 * For a short finite level, `loadAll()` once is fine too.
 */

import type { PhysicsWorld } from '../physics/engine';
import type { ChunkLifecycleListener, TerrainChunk, TerrainSource } from './chunks';
import { DEFAULT_STREAMING, planStreaming, type StreamingConfig, type StreamingPlan } from './streaming';

interface Loaded {
  chunk: TerrainChunk;
  body: number;
}

export class TerrainStreamer {
  private readonly loaded = new Map<number, Loaded>();
  private readonly listeners = new Set<ChunkLifecycleListener>();
  readonly config: StreamingConfig;

  constructor(
    private readonly world: PhysicsWorld,
    readonly source: TerrainSource,
    config: Partial<StreamingConfig> = {},
  ) {
    this.config = { ...DEFAULT_STREAMING, chunkWidth: source.chunkWidth, ...config };
    if (this.config.chunkWidth !== source.chunkWidth) throw new Error('TerrainStreamer: chunkWidth must match the source');
  }

  addListener(l: ChunkLifecycleListener): void {
    this.listeners.add(l);
  }

  removeListener(l: ChunkLifecycleListener): void {
    this.listeners.delete(l);
  }

  /** Stream for the given live-body x positions. Returns what changed. */
  update(bodyXs: Iterable<number>): StreamingPlan {
    const plan = planStreaming(this.loaded.keys(), bodyXs, this.source, this.config);
    this.apply(plan);
    return plan;
  }

  /** Load every chunk of a finite source (throws for unbounded sources). */
  loadAll(): void {
    const { firstChunk, lastChunk } = this.source;
    if (!Number.isFinite(firstChunk) || !Number.isFinite(lastChunk)) throw new Error('loadAll: unbounded terrain source');
    const create: number[] = [];
    for (let k = firstChunk; k <= lastChunk; k++) if (!this.loaded.has(k)) create.push(k);
    this.apply({ create, destroy: [] });
  }

  /** Destroy every loaded chunk (run end / retry). */
  destroyAll(): void {
    this.apply({ create: [], destroy: [...this.loaded.keys()].sort((a, b) => a - b) });
  }

  loadedChunks(): number[] {
    return [...this.loaded.keys()].sort((a, b) => a - b);
  }

  isLoaded(index: number): boolean {
    return this.loaded.has(index);
  }

  bodyOf(index: number): number | undefined {
    return this.loaded.get(index)?.body;
  }

  /** Loaded chunk data (ascending), e.g. to bring a late listener up to date. */
  loadedChunkData(): { chunk: TerrainChunk; body: number }[] {
    return this.loadedChunks().map((k) => this.loaded.get(k)!);
  }

  private apply(plan: Pick<StreamingPlan, 'create' | 'destroy'>): void {
    for (const k of plan.destroy) {
      const rec = this.loaded.get(k);
      if (!rec) continue;
      if (!this.world.isDestroyed && this.world.hasBody(rec.body)) this.world.destroyBody(rec.body);
      this.loaded.delete(k);
      for (const l of this.listeners) l.chunkDestroyed(k, rec.body);
    }
    const material = { friction: this.source.friction, restitution: this.source.restitution };
    for (const k of plan.create) {
      if (this.loaded.has(k)) continue;
      const chunk = this.source.chunk(k);
      const body = this.world.createBody({ type: 'static', position: { x: 0, y: 0 }, role: 'terrain' });
      for (const piece of chunk.pieces) this.world.addChain(body, piece, material);
      this.loaded.set(k, { chunk, body });
      for (const l of this.listeners) l.chunkCreated(chunk, body);
    }
  }
}
