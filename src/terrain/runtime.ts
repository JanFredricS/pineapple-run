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
import { freezeChunk, type ChunkLifecycleListener, type ReadonlyTerrainChunk, type TerrainSource } from './chunks';
import { DEFAULT_STREAMING, planStreaming, type StreamingConfig, type StreamingPlan } from './streaming';

interface Loaded {
  chunk: ReadonlyTerrainChunk;
  /** null for a chunk without terrain: it counts as loaded (so it is not re-requested) but has no body. */
  body: number | null;
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

  /**
   * Load every chunk that holds terrain, for a finite source that lists its
   * occupied chunks (throws otherwise). Cost is O(occupied chunks), however
   * far apart the spans are. For long or untrusted levels prefer update().
   */
  loadAll(): void {
    const { firstChunk, lastChunk } = this.source;
    if (!Number.isFinite(firstChunk) || !Number.isFinite(lastChunk)) throw new Error('loadAll: unbounded terrain source');
    if (!this.source.occupiedChunks) throw new Error('loadAll: source does not list its occupied chunks');
    const create = this.source.occupiedChunks().filter((k) => !this.loaded.has(k));
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

  /** Physics body of a loaded chunk; undefined if not loaded or the chunk has no terrain. */
  bodyOf(index: number): number | undefined {
    return this.loaded.get(index)?.body ?? undefined;
  }

  /**
   * Loaded chunks WITH terrain (ascending), e.g. to bring a late listener up
   * to date — exactly what chunkCreated announced. Chunks are deep-frozen.
   */
  loadedChunkData(): { chunk: ReadonlyTerrainChunk; body: number }[] {
    const out: { chunk: ReadonlyTerrainChunk; body: number }[] = [];
    for (const k of this.loadedChunks()) {
      const rec = this.loaded.get(k)!;
      if (rec.body !== null) out.push({ chunk: rec.chunk, body: rec.body });
    }
    return out;
  }

  private apply(plan: Pick<StreamingPlan, 'create' | 'destroy'>): void {
    for (const k of plan.destroy) {
      const rec = this.loaded.get(k);
      if (!rec) continue;
      this.loaded.delete(k);
      if (rec.body === null) continue; // empty chunk: no body, never announced
      if (!this.world.isDestroyed && this.world.hasBody(rec.body)) this.world.destroyBody(rec.body);
      for (const l of this.listeners) l.chunkDestroyed(k, rec.body);
    }
    const material = { friction: this.source.friction, restitution: this.source.restitution };
    for (const k of plan.create) {
      if (this.loaded.has(k)) continue;
      const chunk = freezeChunk(this.source.chunk(k));
      if (!chunk.pieces.length) {
        this.loaded.set(k, { chunk, body: null });
        continue;
      }
      const body = this.world.createBody({ type: 'static', position: { x: 0, y: 0 }, role: 'terrain' });
      // addChain (physics, frozen API) takes Vec2[] but only reads + copies the points
      for (const piece of chunk.pieces) this.world.addChain(body, [...piece], material);
      this.loaded.set(k, { chunk, body });
      for (const l of this.listeners) l.chunkCreated(chunk, body);
    }
  }
}
