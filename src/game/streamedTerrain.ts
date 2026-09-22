/**
 * Ground-contact queries over STREAMED terrain (S6 glue between S3's
 * TerrainStreamer and S1's run controller).
 *
 * The run controller's lost rule asks "is this pineapple touching terrain?"
 * (TerrainQuery). With chunked, streamed terrain the answer must come from
 * exactly the chunks physics currently has — so this is a
 * ChunkLifecycleListener registered on the same TerrainStreamer that builds
 * the chain bodies: every chunk it creates is indexed here, every chunk it
 * destroys is dropped. The query never sees terrain physics does not have
 * (no invisible bridges), and never misses terrain physics does have.
 *
 * `minX` / `maxX` are the x-extent of the currently loaded pieces — the
 * kept-terrain window the controller uses for "fell off the kept terrain".
 */

import type { Vec2 } from '../model/geometry';
import type { TerrainQuery } from '../run/terrainQuery';
import { TerrainIndex } from '../run/terrainQuery';
import type { ChunkLifecycleListener, ReadonlyTerrainChunk } from '../terrain/chunks';

interface IndexedChunk {
  minX: number;
  maxX: number;
  index: TerrainIndex;
}

export class StreamedTerrainQuery implements TerrainQuery, ChunkLifecycleListener {
  private readonly chunks = new Map<number, IndexedChunk>();
  private extent: { minX: number; maxX: number } | null = null;

  chunkCreated(chunk: ReadonlyTerrainChunk): void {
    if (!chunk.extent || chunk.pieces.length === 0) return;
    const spans = chunk.pieces.map((points, i) => ({ id: `c${chunk.index}p${i}`, points: points.map((p) => ({ x: p.x, y: p.y })) }));
    this.chunks.set(chunk.index, { minX: chunk.extent.minX, maxX: chunk.extent.maxX, index: new TerrainIndex(spans) });
    this.extent = null;
  }

  chunkDestroyed(index: number): void {
    if (this.chunks.delete(index)) this.extent = null;
  }

  /** Loaded chunk indices (ascending) — tests / diagnostics. */
  loaded(): number[] {
    return [...this.chunks.keys()].sort((a, b) => a - b);
  }

  private bounds(): { minX: number; maxX: number } {
    if (!this.extent) {
      let minX = Infinity;
      let maxX = -Infinity;
      for (const c of this.chunks.values()) {
        minX = Math.min(minX, c.minX);
        maxX = Math.max(maxX, c.maxX);
      }
      this.extent = Number.isFinite(minX) ? { minX, maxX } : { minX: 0, maxX: 0 };
    }
    return this.extent;
  }

  get minX(): number {
    return this.bounds().minX;
  }

  get maxX(): number {
    return this.bounds().maxX;
  }

  circleTouches(p: Vec2, radius: number, slop = 0.05): boolean {
    const reach = radius + slop + 0.01;
    for (const c of this.chunks.values()) {
      if (p.x + reach < c.minX || p.x - reach > c.maxX) continue;
      if (c.index.circleTouches(p, radius, slop)) return true;
    }
    return false;
  }
}
