/**
 * SVG -> texture pipeline (S4).
 *
 * Art is authored as SVG (assets/svg/**, imported as raw strings). At load we
 * rasterize every SVG once at `rasterResolution(devicePixelRatio)` (capped at
 * 2x) and upload the result as GPU textures:
 *
 *  - ATLAS assets (sprites: parts, blender pieces, props) are shelf-packed
 *    into a few atlas pages (<= ATLAS_MAX_SIZE px) — one texture upload per
 *    page and batched draws.
 *  - REPEAT assets (terrain fills/edges, parallax layers, straw stripes) get
 *    a standalone texture with `addressMode: 'repeat'`, because GPU wrap
 *    modes only work on whole textures, never on an atlas sub-rectangle.
 *
 * All texture sizes below are in DESIGN units (the SVG's width/height). The
 * GPU sources carry `resolution`, so a Pixi texture's `width` equals the
 * design width regardless of DPR — callers size sprites in design units or
 * world metres and never think about device pixels.
 *
 * The pure half (size parsing, atlas packing, baking with an injectable
 * canvas backend) is unit-tested in Node; only `createBrowserBackend` touches
 * the DOM.
 */

import { CanvasSource, Rectangle, Texture, TextureSource } from 'pixi.js';

/** Hard GPU-safe atlas page size (4096 is the mobile ceiling; stay well under). */
export const ATLAS_MAX_SIZE = 2048;
/** Transparent gutter around each atlas entry (design px) — avoids bleeding at mip levels. */
export const ATLAS_PADDING = 4;

export interface SvgAssetDef {
  id: string;
  /** Full SVG document text; must declare width + height (or a viewBox). */
  svg: string;
  /** Standalone repeatable texture (tiling fills) instead of an atlas entry. */
  repeat?: boolean;
  /** Standalone clamped texture (gradients stretched over large areas). */
  standalone?: boolean;
}

export interface Size {
  width: number;
  height: number;
}

/** Raster scale for SVG baking: devicePixelRatio clamped to [1, 2]. */
export function rasterResolution(devicePixelRatio: number | undefined): number {
  const dpr = Number.isFinite(devicePixelRatio) && (devicePixelRatio as number) > 0 ? (devicePixelRatio as number) : 1;
  return Math.min(Math.max(dpr, 1), 2);
}

/** Intrinsic size of an SVG document from its width/height attributes, else its viewBox. */
export function parseSvgSize(svg: string): Size {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!tag) throw new Error('not an SVG document (no <svg> tag)');
  const attr = (name: string): number | undefined => {
    const m = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+)(px)?\\s*["']`, 'i').exec(tag);
    return m ? Number(m[1]) : undefined;
  };
  let width = attr('width');
  let height = attr('height');
  if (width === undefined || height === undefined) {
    const vb = /\sviewBox\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.trim().split(/[\s,]+/).map(Number);
    if (vb && vb.length === 4) {
      width ??= vb[2];
      height ??= vb[3];
    }
  }
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error('SVG has no usable width/height or viewBox');
  }
  return { width, height };
}

/** `data:` URI for an SVG document (UTF-8, percent-encoded — safe for any content). */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ------------------------------------------------------------------ packing

export interface PackItem {
  id: string;
  width: number;
  height: number;
}

export interface PackedRect {
  id: string;
  page: number;
  /** Top-left of the entry inside its page, design units (padding excluded). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PackResult {
  pages: Size[];
  rects: Map<string, PackedRect>;
}

/**
 * Shelf packer: tallest first, left-to-right rows, new page when full.
 * Deterministic for a given input. Units are whatever the caller uses (we
 * pack in device pixels so rounding never makes neighbours overlap).
 */
export function packAtlas(items: readonly PackItem[], maxSize = ATLAS_MAX_SIZE, padding = ATLAS_PADDING): PackResult {
  const sorted = [...items].sort((a, b) => b.height - a.height || b.width - a.width || (a.id < b.id ? -1 : 1));
  const pages: Size[] = [];
  const rects = new Map<string, PackedRect>();
  let page = -1;
  let cx = 0;
  let cy = 0;
  let shelfH = 0;
  let pageW = 0;
  let pageH = 0;
  const flush = () => {
    if (page >= 0) pages[page] = { width: pageW, height: pageH };
  };
  const newPage = () => {
    flush();
    page++;
    cx = padding;
    cy = padding;
    shelfH = 0;
    pageW = 0;
    pageH = 0;
  };
  for (const it of sorted) {
    if (rects.has(it.id)) throw new Error(`duplicate atlas id "${it.id}"`);
    const w = Math.ceil(it.width);
    const h = Math.ceil(it.height);
    if (w + 2 * padding > maxSize || h + 2 * padding > maxSize) {
      throw new Error(`atlas entry "${it.id}" (${w}x${h}) exceeds max page size ${maxSize}`);
    }
    if (page < 0) newPage();
    if (cx + w + padding > maxSize) {
      // next shelf
      cx = padding;
      cy += shelfH + padding;
      shelfH = 0;
    }
    if (cy + h + padding > maxSize) newPage();
    rects.set(it.id, { id: it.id, page, x: cx, y: cy, width: w, height: h });
    cx += w + padding;
    shelfH = Math.max(shelfH, h);
    pageW = Math.max(pageW, cx);
    pageH = Math.max(pageH, cy + shelfH + padding);
  }
  flush();
  return { pages, rects };
}

// ------------------------------------------------------------------ baking

/** Minimal canvas surface the baker needs (HTMLCanvasElement / OffscreenCanvas / test fake). */
export interface BakeCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): BakeContext | null;
}
export interface BakeContext {
  clearRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void;
}

export interface RasterBackend {
  createCanvas(width: number, height: number): BakeCanvas;
  /** Decode an SVG document into something drawImage accepts. */
  loadSvg(svg: string, size: Size): Promise<unknown>;
}

export interface BakedEntry {
  id: string;
  /** Design size (SVG width/height). */
  size: Size;
  /** Atlas page index, or -1 for standalone textures. */
  page: number;
  /** Frame inside the page canvas in DESIGN units (canvas px / resolution). */
  frame: { x: number; y: number; width: number; height: number };
  /** Standalone texture with repeat wrapping (false = clamp). */
  repeat: boolean;
  /** Index into `canvases`. */
  canvas: number;
}

export interface BakedAssets {
  resolution: number;
  canvases: BakeCanvas[];
  /** Number of leading canvases that are atlas pages (the rest are standalone). */
  atlasPages: number;
  entries: Map<string, BakedEntry>;
}

/**
 * Rasterize every SVG (in parallel) and pack sprites into atlas pages.
 * Rejects with the failing asset id if any SVG fails to decode.
 */
export async function bakeAssets(
  defs: readonly SvgAssetDef[],
  backend: RasterBackend,
  resolution: number,
  maxSize = ATLAS_MAX_SIZE,
): Promise<BakedAssets> {
  const seen = new Set<string>();
  for (const d of defs) {
    if (seen.has(d.id)) throw new Error(`duplicate asset id "${d.id}"`);
    seen.add(d.id);
  }
  const sized = defs.map((d) => ({ def: d, size: parseSvgSize(d.svg) }));
  const images = await Promise.all(
    sized.map(({ def, size }) =>
      backend.loadSvg(def.svg, size).catch((err: unknown) => {
        throw new Error(`asset "${def.id}" failed to rasterize: ${err instanceof Error ? err.message : String(err)}`);
      }),
    ),
  );

  const px = (v: number) => Math.ceil(v * resolution);
  const isStandalone = (d: SvgAssetDef) => !!(d.repeat || d.standalone);
  const atlasItems = sized.filter((s) => !isStandalone(s.def));
  const pack = packAtlas(
    atlasItems.map((s) => ({ id: s.def.id, width: px(s.size.width), height: px(s.size.height) })),
    maxSize,
    Math.ceil(ATLAS_PADDING * resolution),
  );

  const canvases: BakeCanvas[] = pack.pages.map((p) => backend.createCanvas(p.width, p.height));
  const entries = new Map<string, BakedEntry>();
  const ctxOf = (c: BakeCanvas): BakeContext => {
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2d canvas context unavailable');
    return ctx;
  };
  const pageCtx = canvases.map(ctxOf);

  sized.forEach(({ def, size }, i) => {
    const img = images[i];
    if (isStandalone(def)) {
      const w = px(size.width);
      const h = px(size.height);
      if (w > maxSize * 2 || h > maxSize * 2) throw new Error(`repeat asset "${def.id}" too large`);
      const c = backend.createCanvas(w, h);
      ctxOf(c).drawImage(img, 0, 0, w, h);
      canvases.push(c);
      entries.set(def.id, {
        id: def.id,
        size,
        page: -1,
        frame: { x: 0, y: 0, width: w / resolution, height: h / resolution },
        repeat: !!def.repeat,
        canvas: canvases.length - 1,
      });
    } else {
      const r = pack.rects.get(def.id)!;
      pageCtx[r.page]!.drawImage(img, r.x, r.y, r.width, r.height);
      entries.set(def.id, {
        id: def.id,
        size,
        page: r.page,
        frame: { x: r.x / resolution, y: r.y / resolution, width: r.width / resolution, height: r.height / resolution },
        repeat: false,
        canvas: r.page,
      });
    }
  });

  return { resolution, canvases, atlasPages: pack.pages.length, entries };
}

// ------------------------------------------------------------------ Pixi

/**
 * Loaded texture library. `ready` resolves once every asset is rasterized and
 * uploaded; `texture(id)` throws for unknown ids (a typo should fail loudly in
 * the style guide, not render nothing).
 */
export class AssetLibrary {
  readonly ready: Promise<void>;
  private readonly textures = new Map<string, Texture>();
  private readonly sources: TextureSource[] = [];
  private baked: BakedAssets | null = null;
  private loaded = false;
  private destroyed = false;

  constructor(
    defs: readonly SvgAssetDef[],
    opts: { resolution?: number; backend?: RasterBackend } = {},
  ) {
    const resolution = opts.resolution ?? rasterResolution(globalThis.devicePixelRatio);
    const backend = opts.backend ?? createBrowserBackend();
    // Destroy-while-loading: rasterisation can't be aborted mid-decode, but a
    // destroyed library never uploads (no GPU sources are created), never
    // becomes ready, and `ready` still settles (resolves) so awaiting callers
    // don't hang; `texture()` then reports the destroyed state.
    this.ready = bakeAssets(defs, backend, resolution).then((baked) => {
      if (this.destroyed) return;
      this.baked = baked;
      this.upload(baked);
      this.loaded = true;
    });
  }

  get isReady(): boolean {
    return this.loaded && !this.destroyed;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  get resolution(): number {
    return this.baked?.resolution ?? 1;
  }

  has(id: string): boolean {
    return this.textures.has(id);
  }

  ids(): string[] {
    return [...this.textures.keys()];
  }

  texture(id: string): Texture {
    const t = this.textures.get(id);
    if (!t) {
      if (this.destroyed) throw new Error(`asset "${id}" requested from a destroyed AssetLibrary`);
      throw new Error(this.loaded ? `unknown asset "${id}"` : `asset "${id}" requested before AssetLibrary.ready`);
    }
    return t;
  }

  /** Baked metadata (page, frame) for diagnostics / the style guide. */
  entry(id: string): BakedEntry | undefined {
    return this.baked?.entries.get(id);
  }

  get atlasPageCount(): number {
    return this.baked?.atlasPages ?? 0;
  }

  /** The atlas page texture itself (style guide shows the packed sheet). */
  atlasPage(index: number): Texture {
    const src = this.sources[index];
    if (!src || !this.baked || index >= this.baked.atlasPages) throw new Error(`no atlas page ${index}`);
    return new Texture({ source: src });
  }

  private upload(baked: BakedAssets): void {
    const repeatCanvas = new Set([...baked.entries.values()].filter((e) => e.repeat).map((e) => e.canvas));
    baked.canvases.forEach((canvas, i) => {
      const repeat = repeatCanvas.has(i);
      this.sources.push(
        new CanvasSource({
          resource: canvas as unknown as HTMLCanvasElement,
          resolution: baked.resolution,
          addressMode: repeat ? 'repeat' : 'clamp-to-edge',
          scaleMode: 'linear',
          autoGenerateMipmaps: true,
          alphaMode: 'premultiply-alpha-on-upload',
        }),
      );
    });
    for (const e of baked.entries.values()) {
      const source = this.sources[e.canvas]!;
      const tex = e.page < 0
        ? new Texture({ source, label: e.id })
        : new Texture({ source, frame: new Rectangle(e.frame.x, e.frame.y, e.frame.width, e.frame.height), label: e.id });
      this.textures.set(e.id, tex);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.loaded = false;
    this.baked = null;
    for (const t of this.textures.values()) t.destroy(false);
    for (const s of this.sources) s.destroy();
    this.textures.clear();
    this.sources.length = 0;
  }
}

/** DOM backend: <img> decode of a data: URI, drawn onto an HTMLCanvasElement. */
export function createBrowserBackend(): RasterBackend {
  return {
    createCanvas(width, height) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, width);
      c.height = Math.max(1, height);
      return c as unknown as BakeCanvas;
    },
    async loadSvg(svg, size) {
      const img = new Image(size.width, size.height);
      img.decoding = 'async';
      img.src = svgDataUri(svg);
      try {
        await img.decode();
      } catch {
        // Some engines reject decode() for SVG but still load it.
        await new Promise<void>((resolve, reject) => {
          if (img.complete && img.naturalWidth > 0) return resolve();
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('image load error'));
        });
      }
      return img;
    },
  };
}
