/**
 * Body-aware terrain streaming — the window logic as pure functions
 * (PLAN.md S3 "Streaming with body-aware retention").
 *
 * The kept window is [min live-body x − behind, max live-body x + ahead],
 * NOT a window around the camera: a pineapple left 60 m behind the cart keeps
 * its ground for as long as the caller reports it as live. "Live" is the
 * caller's decision (S1/S6): typically the cart bodies plus every pineapple
 * not yet counted as lost. Non-finite positions (a diverged body) are ignored.
 *
 * Hysteresis: a loaded chunk is only dropped once it is `hysteresis` metres
 * outside the window, so a body jittering on a boundary does not thrash
 * create/destroy every step.
 *
 * With no live bodies the plan is a no-op (nothing created, nothing
 * destroyed): the run is over or not started, and the caller decides when to
 * tear the terrain down (TerrainStreamer#destroyAll).
 */

import { CHUNK_WIDTH } from './chunks';

export interface StreamingConfig {
  chunkWidth: number;
  /** Metres kept behind the left-most live body. */
  behind: number;
  /** Metres kept ahead of the right-most live body. */
  ahead: number;
  /** Extra metres a loaded chunk may drift outside the window before it is dropped. */
  hysteresis: number;
  /**
   * Safety cap on the window width in chunks. If live bodies are spread
   * wider than this (a runaway body the caller failed to drop), the window
   * keeps its RIGHT-most `maxChunks` chunks — the forward end, where the cart
   * drives — instead of allocating an unbounded number of chunks.
   */
  maxChunks: number;
}

export const DEFAULT_STREAMING: StreamingConfig = {
  chunkWidth: CHUNK_WIDTH,
  behind: 30,
  ahead: 90,
  hysteresis: 20,
  maxChunks: 256,
};

export interface XWindow {
  min: number;
  max: number;
}

/** Inclusive chunk index range; empty when from > to. */
export interface ChunkRange {
  from: number;
  to: number;
}

export interface ChunkBounds {
  firstChunk: number;
  lastChunk: number;
}

export interface StreamingPlan {
  /** Chunk indices that should exist after applying the plan (ascending). */
  keep: number[];
  /** To create, ascending. */
  create: number[];
  /** To destroy, ascending. */
  destroy: number[];
}

/** [min x − behind, max x + ahead] over finite body positions; null if there are none. */
export function retentionWindow(bodyXs: Iterable<number>, cfg: Pick<StreamingConfig, 'behind' | 'ahead'>): XWindow | null {
  let min = Infinity;
  let max = -Infinity;
  for (const x of bodyXs) {
    if (!Number.isFinite(x)) continue;
    if (x < min) min = x;
    if (x > max) max = x;
  }
  if (min > max) return null;
  return { min: min - cfg.behind, max: max + cfg.ahead };
}

/** Chunks overlapping the window (nominal bounds), clipped to the source's bounds. */
export function chunkRangeForWindow(win: XWindow, width: number, bounds: ChunkBounds): ChunkRange {
  const from = Math.max(bounds.firstChunk, Math.floor(win.min / width));
  const to = Math.min(bounds.lastChunk, Math.floor(win.max / width));
  return { from, to };
}

const inRange = (k: number, r: ChunkRange) => k >= r.from && k <= r.to;

/**
 * Given the currently loaded chunks and the live body x positions, what to
 * create and destroy. Pure and deterministic.
 */
export function planStreaming(
  loaded: Iterable<number>,
  bodyXs: Iterable<number>,
  bounds: ChunkBounds,
  cfg: StreamingConfig = DEFAULT_STREAMING,
): StreamingPlan {
  const current = [...new Set(loaded)].sort((a, b) => a - b);
  const win = retentionWindow(bodyXs, cfg);
  if (!win) return { keep: current, create: [], destroy: [] };
  const want = chunkRangeForWindow(win, cfg.chunkWidth, bounds);
  const hold = chunkRangeForWindow(
    { min: win.min - cfg.hysteresis, max: win.max + cfg.hysteresis },
    cfg.chunkWidth,
    bounds,
  );
  const cap = Math.max(1, Math.floor(cfg.maxChunks));
  if (want.to - want.from + 1 > cap) want.from = want.to - cap + 1;
  if (hold.to - hold.from + 1 > cap) hold.from = Math.min(want.from, hold.to - cap + 1);
  const loadedSet = new Set(current);
  const destroy = current.filter((k) => !inRange(k, hold));
  const create: number[] = [];
  for (let k = want.from; k <= want.to; k++) if (!loadedSet.has(k)) create.push(k);
  const keep = [...current.filter((k) => inRange(k, hold)), ...create].sort((a, b) => a - b);
  return { keep, create, destroy };
}
