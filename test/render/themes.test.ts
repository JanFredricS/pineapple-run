import { describe, expect, it } from 'vitest';
import { THEME_IDS, type ThemeId } from '../../src/model/level';
import { parseSvgSize } from '../../src/render/assets';
import { ART, BLENDER_LAYOUT, PROP_ART, coreAssetDefs } from '../../src/render/artCatalog';
import {
  PALETTE_KEYS,
  THEMES,
  hexToNumber,
  themeAssetDefs,
  themeCssVars,
  themesCssText,
  type Theme,
  type ThemePalette,
} from '../../src/render/themes';

// Type-level exhaustiveness: THEMES must be keyed by exactly ThemeId.
type ThemeKeys = keyof typeof THEMES;
const _allIds: ThemeId extends ThemeKeys ? (ThemeKeys extends ThemeId ? true : false) : false = true;
void _allIds;

const HEX = /^#[0-9a-f]{6}$/i;

/** Minimal well-formedness check for hand-written SVG (no DOMParser in node). */
function checkSvg(svg: string, label: string): void {
  expect(svg.trimStart().startsWith('<svg'), `${label} starts with <svg`).toBe(true);
  expect(svg.trimEnd().endsWith('</svg>'), `${label} ends with </svg>`).toBe(true);
  expect(svg, `${label} xmlns`).toContain('xmlns="http://www.w3.org/2000/svg"');
  const size = parseSvgSize(svg);
  expect(size.width, label).toBeGreaterThan(0);
  expect(size.height, label).toBeGreaterThan(0);
  // every url(#id) / href="#id" reference is defined in the same document
  const ids = new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of svg.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)) {
    const ref = m[1] ?? m[2];
    expect(ids.has(ref), `${label}: #${ref} defined`).toBe(true);
  }
  // balanced element tags (self-closing excluded)
  const opens = [...svg.matchAll(/<([a-zA-Z][\w:-]*)\b[^>]*?(\/?)>/g)].filter((m) => m[2] !== '/').map((m) => m[1]);
  const closes = [...svg.matchAll(/<\/([a-zA-Z][\w:-]*)\s*>/g)].map((m) => m[1]);
  expect(closes.length, `${label} balanced tags`).toBe(opens.length);
}

describe('themes', () => {
  it('has a theme for every model ThemeId, with matching ids', () => {
    for (const id of THEME_IDS) expect(THEMES[id].id).toBe(id);
    expect(Object.keys(THEMES).sort()).toEqual([...THEME_IDS].sort());
  });

  it.each(THEME_IDS)('%s: complete palette of valid hex colours', (id) => {
    const p: ThemePalette = THEMES[id].palette;
    expect(Object.keys(p).sort()).toEqual([...PALETTE_KEYS].sort());
    for (const k of PALETTE_KEYS) expect(p[k], `${id}.${k}`).toMatch(HEX);
  });

  it.each(THEME_IDS)('%s: terrain skin and 3–4 parallax layers', (id) => {
    const t: Theme = THEMES[id];
    expect(t.name.length).toBeGreaterThan(0);
    expect(t.parallax.length).toBeGreaterThanOrEqual(3);
    expect(t.parallax.length).toBeLessThanOrEqual(4);
    expect(new Set(t.parallax.map((l) => l.id)).size).toBe(t.parallax.length);
    // back-to-front: factors never decrease
    for (let i = 1; i < t.parallax.length; i++) expect(t.parallax[i]!.factor).toBeGreaterThanOrEqual(t.parallax[i - 1]!.factor);
    for (const l of t.parallax) {
      expect(l.factor).toBeGreaterThanOrEqual(0);
      expect(l.factor).toBeLessThan(1);
      if (l.fillBelow) expect(l.fillBelow).toMatch(HEX);
      checkSvg(l.svg, `${id}/layer/${l.id}`);
    }
    expect(t.terrain.fill.metresPerTile).toBeGreaterThan(0);
    expect(t.terrain.edge.metresPerTile).toBeGreaterThan(0);
    expect(t.terrain.edge.above).toBeGreaterThanOrEqual(0);
    expect(t.terrain.edge.below).toBeGreaterThan(0);
    expect(t.terrain.shade.depth).toBeGreaterThan(0);
    expect(t.terrain.shade.alpha).toBeGreaterThan(0);
    expect(t.terrain.shade.alpha).toBeLessThanOrEqual(1);
    checkSvg(t.terrain.fill.svg, `${id}/fill`);
    checkSvg(t.terrain.edge.svg, `${id}/edge`);
  });

  it('asset defs: unique ids, repeat textures for tiling', () => {
    const all = [...coreAssetDefs(), ...THEME_IDS.flatMap((id) => themeAssetDefs(THEMES[id]))];
    const ids = all.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of THEME_IDS) {
      const defs = themeAssetDefs(THEMES[id]);
      expect(defs.filter((d) => d.repeat)).toHaveLength(2 + THEMES[id].parallax.length);
    }
    for (const d of all) checkSvg(d.svg, d.id);
  });

  it('CSS custom properties cover the palette', () => {
    const vars = themeCssVars(THEMES.beach);
    expect(vars['--pr-sky-top']).toBe(THEMES.beach.palette.skyTop);
    expect(vars['--pr-blender-fill']).toBe(THEMES.beach.palette.blenderFill);
    expect(vars['--pr-theme']).toBe('beach');
    expect(Object.keys(vars)).toHaveLength(PALETTE_KEYS.length + 1);
    const css = themesCssText();
    for (const id of THEME_IDS) expect(css).toContain(`[data-theme="${id}"]`);
    expect(hexToNumber('#FF8000')).toBe(0xff8000);
  });
});

describe('art catalog', () => {
  it('circle fits lie inside their textures', () => {
    for (const a of [ART.pineapple, ART.lime, ART.cap]) {
      const { width, height } = parseSvgSize(a.svg);
      expect(a.fit.cx - a.fit.r).toBeGreaterThanOrEqual(0);
      expect(a.fit.cx + a.fit.r).toBeLessThanOrEqual(width);
      expect(a.fit.cy - a.fit.r).toBeGreaterThanOrEqual(0);
      expect(a.fit.cy + a.fit.r).toBeLessThanOrEqual(height);
    }
  });

  it('nine-slice cube border fits the texture; umbrella frames share one size', () => {
    const cube = parseSvgSize(ART.cube.svg);
    expect(ART.cube.border * 2).toBeLessThan(Math.min(cube.width, cube.height));
    const sizes = [ART.umbrella.open, ART.umbrella.half, ART.umbrella.closed].map((f) => parseSvgSize(f.svg));
    expect(sizes[1]).toEqual(sizes[0]);
    expect(sizes[2]).toEqual(sizes[0]);
    expect(ART.umbrella.axisY).toBe(sizes[0]!.height / 2);
  });

  it('blender layout matches the part textures', () => {
    const base = parseSvgSize(ART.blender.base.svg);
    const jar = parseSvgSize(ART.blender.jar.svg);
    expect(BLENDER_LAYOUT.base.x).toBe(-base.width / 2);
    expect(BLENDER_LAYOUT.base.y).toBe(-base.height);
    expect(BLENDER_LAYOUT.baseWidth).toBe(base.width);
    // jar body (not its handle) is centred over the base; the blade hub sits inside the interior
    const [tl, tr] = BLENDER_LAYOUT.jarInterior as readonly [{ x: number }, { x: number }, ...unknown[]];
    expect(BLENDER_LAYOUT.jar.x + (tl.x + tr.x) / 2).toBe(0);
    expect(BLENDER_LAYOUT.jar.x + jar.width).toBeGreaterThan(0);
    for (const p of BLENDER_LAYOUT.jarInterior) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(jar.width);
      expect(p.y).toBeLessThanOrEqual(jar.height);
    }
    expect(-BLENDER_LAYOUT.lid.y).toBe(BLENDER_LAYOUT.height);
  });

  it('props have anchors in [0,1] and positive height', () => {
    for (const [, p] of PROP_ART) {
      expect(p.anchor.x).toBeGreaterThanOrEqual(0);
      expect(p.anchor.x).toBeLessThanOrEqual(1);
      expect(p.anchor.y).toBeGreaterThanOrEqual(0);
      expect(p.anchor.y).toBeLessThanOrEqual(1);
      expect(p.metresTall).toBeGreaterThan(0);
    }
  });
});
