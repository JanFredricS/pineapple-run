import { describe, expect, it } from 'vitest';
import {
  AssetLibrary,
  bakeAssets,
  packAtlas,
  parseSvgSize,
  rasterResolution,
  svgDataUri,
  type BakeCanvas,
  type RasterBackend,
  type SvgAssetDef,
} from '../../src/render/assets';
import { coreAssetDefs } from '../../src/render/artCatalog';
import { THEMES, themeAssetDefs } from '../../src/render/themes';
import { THEME_IDS } from '../../src/model/level';

const svg = (w: number, h: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect/></svg>`;

interface FakeCanvas extends BakeCanvas {
  draws: { image: unknown; dx: number; dy: number; dw: number; dh: number }[];
}

/** Node stand-in for the DOM raster backend: records draw calls. */
function fakeBackend(opts: { fail?: string } = {}): RasterBackend & { canvases: FakeCanvas[] } {
  const canvases: FakeCanvas[] = [];
  return {
    canvases,
    createCanvas(width, height) {
      const draws: FakeCanvas['draws'] = [];
      const c: FakeCanvas = {
        width,
        height,
        draws,
        getContext: () => ({
          clearRect() {},
          drawImage(image, dx, dy, dw, dh) {
            draws.push({ image, dx, dy, dw, dh });
          },
        }),
      };
      canvases.push(c);
      return c;
    },
    async loadSvg(s, size) {
      if (opts.fail && s.includes(opts.fail)) throw new Error('decode failed');
      return { svg: s, size };
    },
  };
}

describe('rasterResolution', () => {
  it('clamps devicePixelRatio to [1, 2]', () => {
    expect(rasterResolution(undefined)).toBe(1);
    expect(rasterResolution(0)).toBe(1);
    expect(rasterResolution(Number.NaN)).toBe(1);
    expect(rasterResolution(0.75)).toBe(1);
    expect(rasterResolution(1.5)).toBe(1.5);
    expect(rasterResolution(3)).toBe(2);
  });
});

describe('parseSvgSize', () => {
  it('reads width/height attributes (with or without px)', () => {
    expect(parseSvgSize('<svg width="64" height="32px" viewBox="0 0 1 1"></svg>')).toEqual({ width: 64, height: 32 });
  });
  it('falls back to the viewBox', () => {
    expect(parseSvgSize('<svg viewBox="0 0 120 40.5"></svg>')).toEqual({ width: 120, height: 40.5 });
  });
  it('rejects non-SVG and unsized SVG', () => {
    expect(() => parseSvgSize('<div/>')).toThrow(/no <svg>/);
    expect(() => parseSvgSize('<svg></svg>')).toThrow(/width\/height/);
  });
  it('data URIs round-trip', () => {
    const s = svg(4, 4) + '#%"';
    expect(decodeURIComponent(svgDataUri(s).split(',')[1]!)).toBe(s);
  });
});

describe('packAtlas', () => {
  const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  it('packs without overlap, inside the page, with padding', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ id: `a${i}`, width: 20 + ((i * 37) % 90), height: 10 + ((i * 53) % 70) }));
    const { pages, rects } = packAtlas(items, 256, 2);
    expect(rects.size).toBe(items.length);
    const all = [...rects.values()];
    for (const r of all) {
      const page = pages[r.page]!;
      expect(r.x).toBeGreaterThanOrEqual(2);
      expect(r.y).toBeGreaterThanOrEqual(2);
      expect(r.x + r.width + 2).toBeLessThanOrEqual(page.width);
      expect(r.y + r.height + 2).toBeLessThanOrEqual(page.height);
      expect(page.width).toBeLessThanOrEqual(256);
      expect(page.height).toBeLessThanOrEqual(256);
    }
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]!;
        const b = all[j]!;
        if (a.page !== b.page) continue;
        // inflate by padding: neighbours keep a gap
        expect(overlap({ ...a, width: a.width + 2, height: a.height + 2 }, b)).toBe(false);
      }
    expect(pages.length).toBeGreaterThan(1); // 40 items do not fit one 256 page
  });

  it('is deterministic and rejects duplicates / oversize entries', () => {
    const items = [
      { id: 'b', width: 10, height: 10 },
      { id: 'a', width: 10, height: 10 },
    ];
    expect([...packAtlas(items).rects.values()]).toEqual([...packAtlas([...items].reverse()).rects.values()]);
    expect(() => packAtlas([...items, { id: 'a', width: 1, height: 1 }])).toThrow(/duplicate/);
    expect(() => packAtlas([{ id: 'x', width: 300, height: 10 }], 256)).toThrow(/exceeds/);
  });
});

describe('bakeAssets', () => {
  const defs: SvgAssetDef[] = [
    { id: 'sprite/a', svg: svg(64, 32) },
    { id: 'sprite/b', svg: svg(16, 16) },
    { id: 'tile/r', svg: svg(128, 64), repeat: true },
    { id: 'grad/s', svg: svg(4, 64), standalone: true },
  ];

  it('atlases sprites and keeps repeat/standalone textures separate', async () => {
    const be = fakeBackend();
    const baked = await bakeAssets(defs, be, 2);
    expect(baked.atlasPages).toBe(1);
    expect(baked.canvases).toHaveLength(3);
    const a = baked.entries.get('sprite/a')!;
    const r = baked.entries.get('tile/r')!;
    const s = baked.entries.get('grad/s')!;
    expect(a.page).toBe(0);
    expect(a.size).toEqual({ width: 64, height: 32 });
    // frames are in design units (canvas px / resolution)
    expect(a.frame.width).toBe(64);
    expect(a.frame.height).toBe(32);
    expect(r).toMatchObject({ page: -1, repeat: true, frame: { x: 0, y: 0, width: 128, height: 64 } });
    expect(s).toMatchObject({ page: -1, repeat: false });
    // standalone canvases are rasterised at the resolution
    expect(baked.canvases[r.canvas]!.width).toBe(256);
    // sprite drawn at its packed (device px) rect on the page
    const page = be.canvases[0]!;
    const draw = page.draws.find((d) => (d.image as { svg: string }).svg === defs[0]!.svg)!;
    expect(draw).toMatchObject({ dx: a.frame.x * 2, dy: a.frame.y * 2, dw: 128, dh: 64 });
  });

  it('names the failing asset and rejects duplicate ids', async () => {
    await expect(bakeAssets([{ id: 'bad/one', svg: svg(8, 8).replace('<rect/>', '<rect id="BROKEN"/>') }], fakeBackend({ fail: 'BROKEN' }), 1)).rejects.toThrow(/bad\/one/);
    await expect(bakeAssets([defs[0]!, defs[0]!], fakeBackend(), 1)).rejects.toThrow(/duplicate/);
  });

  it('bakes every real asset (all themes + core) into one atlas page at 2x', async () => {
    const all = [...coreAssetDefs(), ...THEME_IDS.flatMap((id) => themeAssetDefs(THEMES[id]))];
    const baked = await bakeAssets(all, fakeBackend(), 2);
    expect(baked.entries.size).toBe(all.length);
    expect(baked.atlasPages).toBe(1);
    for (const d of all) {
      const e = baked.entries.get(d.id)!;
      // repeat textures must never live in an atlas (GPU wrapping needs the whole texture)
      if (d.repeat) expect(e.page).toBe(-1);
    }
  });
});

describe('AssetLibrary (Pixi textures)', () => {
  it('resolves ready, then serves atlas-framed and standalone textures', async () => {
    const lib = new AssetLibrary(
      [
        { id: 'sprite/a', svg: svg(64, 32) },
        { id: 'sprite/b', svg: svg(16, 16) },
        { id: 'tile/r', svg: svg(128, 64), repeat: true },
      ],
      { resolution: 2, backend: fakeBackend() },
    );
    expect(lib.isReady).toBe(false);
    expect(() => lib.texture('sprite/a')).toThrow(/before AssetLibrary.ready/);
    await lib.ready;
    expect(lib.isReady).toBe(true);
    expect(lib.resolution).toBe(2);
    expect(lib.ids().sort()).toEqual(['sprite/a', 'sprite/b', 'tile/r']);
    const a = lib.texture('sprite/a');
    const b = lib.texture('sprite/b');
    const r = lib.texture('tile/r');
    // texture size is in design units regardless of raster resolution
    expect([a.width, a.height]).toEqual([64, 32]);
    expect([r.width, r.height]).toEqual([128, 64]);
    // atlas lookup: both sprites share one page source at distinct frames
    expect(a.source).toBe(b.source);
    expect(a.frame.x !== b.frame.x || a.frame.y !== b.frame.y).toBe(true);
    expect(a.source.resolution).toBe(2);
    expect(r.source).not.toBe(a.source);
    expect(r.source.style.addressMode).toBe('repeat');
    expect(a.source.style.addressMode).toBe('clamp-to-edge');
    expect(lib.atlasPageCount).toBe(1);
    expect(() => lib.texture('nope')).toThrow(/unknown asset "nope"/);
    lib.destroy();
    expect(lib.has('sprite/a')).toBe(false);
  });

  it('rejects ready when an SVG fails to decode', async () => {
    const lib = new AssetLibrary([{ id: 'x/broken', svg: svg(8, 8).replace('<rect/>', '<g id="BROKEN"/>') }], {
      resolution: 1,
      backend: fakeBackend({ fail: 'BROKEN' }),
    });
    await expect(lib.ready).rejects.toThrow(/x\/broken/);
  });
});
