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
 * Terrain under a live body is never dropped. Only if the bodies are spread
 * wider than `maxChunks` does the window stop being contiguous: the empty
 * middle between far-apart bodies is released (see StreamingConfig.maxChunks).
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
   * Cap on the CONTIGUOUS window width in chunks. Every live body always
   * keeps its own neighbourhood [x − behind, x + ahead] — terrain under a
   * live body is never dropped. When live bodies are spread wider than this
   * (a straggler kilometres behind), the empty middle between them is what
   * gets dropped: the window becomes the union of the per-body
   * neighbourhoods, so the chunk count stays O(bodies), not O(distance).
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

/** Merge ranges (sorted by `from`) that overlap or touch; drops empty ones. */
function mergeRanges(ranges: ChunkRange[]): ChunkRange[] {
  const out: ChunkRange[] = [];
  for (const r of [...ranges].filter((q) => q.from <= q.to).sort((a, b) => a.from - b.from)) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to + 1) last.to = Math.max(last.to, r.to);
    else out.push({ ...r });
  }
  return out;
}

const inRanges = (k: number, rs: readonly ChunkRange[]) => rs.some((r) => k >= r.from && k <= r.to);

/**
 * Chunk ranges to keep for the live bodies, with `extra` metres of slack on
 * both sides (0 = the wanted window, hysteresis = the hold window): the one
 * contiguous window if it fits in maxChunks, else the per-body
 * neighbourhoods (see StreamingConfig.maxChunks).
 */
function windowRanges(xs: readonly number[], bounds: ChunkBounds, cfg: StreamingConfig, extra: number): ChunkRange[] {
  const win = retentionWindow(xs, cfg)!;
  const full = chunkRangeForWindow({ min: win.min - extra, max: win.max + extra }, cfg.chunkWidth, bounds);
  const cap = Math.max(1, Math.floor(cfg.maxChunks));
  if (full.to - full.from + 1 <= cap) return full.from <= full.to ? [full] : [];
  return mergeRanges(
    xs.map((x) => chunkRangeForWindow({ min: x - cfg.behind - extra, max: x + cfg.ahead + extra }, cfg.chunkWidth, bounds)),
  );
}

/**
 * Given the currently loaded chunks and the live body x positions, what to
 * create and destroy. Pure and deterministic. Guarantee: after applying the
 * plan, every chunk overlapping [x − behind, x + ahead] of every live
 * (finite) x is loaded; the whole [min − behind, max + ahead] span is loaded
 * whenever it fits in maxChunks.
 */
export function planStreaming(
  loaded: Iterable<number>,
  bodyXs: Iterable<number>,
  bounds: ChunkBounds,
  cfg: StreamingConfig = DEFAULT_STREAMING,
): StreamingPlan {
  const current = [...new Set(loaded)].sort((a, b) => a - b);
  const xs = [...bodyXs].filter((x) => Number.isFinite(x));
  if (!xs.length) return { keep: current, create: [], destroy: [] };
  const want = windowRanges(xs, bounds, cfg, 0);
  const hold = windowRanges(xs, bounds, cfg, cfg.hysteresis);
  // hold ⊇ want by construction when both are in the same mode; guard the
  // mode-switch edge (want contiguous, hold per-body) by holding want too.
  const holdAll = [...hold, ...want];
  const loadedSet = new Set(current);
  const destroy = current.filter((k) => !inRanges(k, holdAll));
  const create: number[] = [];
  for (const r of want) for (let k = r.from; k <= r.to; k++) if (!loadedSet.has(k)) create.push(k);
  const keep = [...current.filter((k) => inRanges(k, holdAll)), ...create].sort((a, b) => a - b);
  return { keep, create, destroy };
}
