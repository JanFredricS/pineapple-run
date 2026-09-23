/**
 * B1: The Original Course (2008) ships in the Blueprint theme (was 'test',
 * renamed; 'test' stays a legacy LevelDef alias). Pins the course -> theme
 * mapping so a fixture regen cannot silently flip it back, and renders the
 * real course headlessly against a STRICT texture provider holding only the
 * assets the run screen would load for it (core art + the level's theme):
 * any lookup outside that set, or any `has()` miss that would fall back to a
 * placeholder, fails.
 */
import { Container, Graphics, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { musicThemeForCourse } from '../../src/audio';
import { exampleCart } from '../../src/builder/exampleCart';
import { SHIPPED_LEVEL_IDS, courseFor, levelById } from '../../src/game/courses';
import { RunSession } from '../../src/game/session';
import type { Camera } from '../../src/model/coords';
import { LEGACY_THEME_IDS, THEME_IDS } from '../../src/model/level';
import { TOTAL_PINEAPPLES } from '../../src/model/score';
import { validateLevelDef } from '../../src/model/validate';
import { coreAssetDefs } from '../../src/render/artCatalog';
import { JAR_GLASS_OUTLINE, JAR_RIM } from '../../src/render/blender';
import { SceneRenderer } from '../../src/render/scene';
import { THEMES, getTheme, themeAssetDefs } from '../../src/render/themes';
import type { TextureProvider } from '../../src/render/textures';
import { funnelGeometry } from '../../src/run/funnel';
import { loadFlatGoalLevel } from '../../src/run/fixtures';
import { originalCourseLevel, parseOriginalTerrain } from '../../src/terrain/originalCourse';
import { COURSES } from '../../src/ui/catalog';

const root = join(__dirname, '..', '..');

/** WCAG relative-luminance contrast ratio of two #RRGGBB colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('B1: the original course is the blueprint of the original game', () => {
  it('converter, shipped fixture and catalog card all say blueprint', () => {
    const txt = readFileSync(join(root, 'research/original-game-files/terrain.txt'), 'utf8');
    expect(originalCourseLevel(parseOriginalTerrain(txt)).theme).toBe('blueprint');
    expect(levelById('original')!.theme).toBe('blueprint');
    expect(COURSES.find((c) => c.levelId === 'original')!.theme).toBe('blueprint');
  });

  it("every shipped course's catalog card uses the same theme as its level", () => {
    for (const c of COURSES) {
      if (!SHIPPED_LEVEL_IDS.includes(c.levelId)) continue;
      expect(c.theme, c.levelId).toBe(levelById(c.levelId)!.theme);
    }
  });

  it("music stays keyed by course id: the original keeps the workbench song", () => {
    expect(musicThemeForCourse('original')).toBe('workbench');
  });
});

describe('B1: theme id rename test -> blueprint', () => {
  it("one Blueprint theme, no 'test' id (styleguide cards iterate THEME_IDS)", () => {
    expect(THEME_IDS).toContain('blueprint');
    expect(THEME_IDS).not.toContain('test' as never);
    expect(THEMES.blueprint.name).toBe('Blueprint');
    expect(THEME_IDS.filter((id) => /blueprint/i.test(THEMES[id].name))).toEqual(['blueprint']);
    expect(new Set(THEME_IDS.map((id) => THEMES[id].name)).size).toBe(THEME_IDS.length);
  });

  it("a LevelDef still carrying the retired 'test' id validates, as blueprint", () => {
    expect(LEGACY_THEME_IDS).toEqual({ test: 'blueprint' });
    const level = loadFlatGoalLevel();
    const r = validateLevelDef(JSON.parse(JSON.stringify({ ...level, theme: 'test' })));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.theme).toBe('blueprint');
    // unknown ids are still rejected, and inherited keys are not aliases
    for (const theme of ['nope', 'toString', '__proto__']) {
      expect(validateLevelDef({ ...level, theme }).ok, theme).toBe(false);
    }
  });
});

describe('B1: Blueprint completeness', () => {
  const t = THEMES.blueprint;

  it('sky shows through the graph paper (no opaque full-tile background)', () => {
    const paper = t.parallax.find((l) => l.id === 'graph-paper')!;
    expect(paper.mode).toBe('fill');
    expect(paper.svg).not.toMatch(/<rect width="256" height="256" fill="#/);
  });

  it('drafting-blue linework reads on the pale palette', () => {
    const edgeInk = /<rect x="0" y="2" width="256" height="3" fill="(#[0-9A-F]{6})"\/>/i.exec(t.terrain.edge.svg)![1]!;
    expect(contrast(edgeInk, t.palette.ground)).toBeGreaterThanOrEqual(4.5); // surface line vs rock
    expect(contrast(edgeInk, t.palette.skyTop)).toBeGreaterThanOrEqual(7); // surface line vs paper
    expect(contrast(t.palette.ink, t.palette.skyTop)).toBeGreaterThanOrEqual(7); // funnel / prop outlines
    expect(contrast(t.goalOutline!, t.palette.skyTop)).toBeGreaterThanOrEqual(4.5); // blender jar
    expect(contrast(t.goalOutline!, t.palette.skyBottom)).toBeGreaterThanOrEqual(4);
    // the shared jar art alone does not: that is why the outline exists
    expect(contrast('#A9D8E6', t.palette.skyTop)).toBeLessThan(2);
  });

  it('jar outline constants match the jar art', () => {
    const jar = readFileSync(join(root, 'assets/svg/blender/jar.svg'), 'utf8');
    const [a, b, c, d] = JAR_GLASS_OUTLINE as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
    expect(jar).toContain(`<path d="M${a.x} ${a.y} H${b.x} L${c.x} ${c.y} H${d.x} Z"`);
    expect(b.y).toBe(a.y);
    expect(d.y).toBe(c.y);
    expect(jar).toContain(`<rect x="${JAR_RIM.x}" y="${JAR_RIM.y}" width="${JAR_RIM.width}" height="${JAR_RIM.height}"`);
  });

  it('only themes that ask for it get a blender outline', () => {
    const provider: TextureProvider = {
      has: () => true,
      texture: (id) => new Texture({ source: new TextureSource({ width: 64, height: 64, resolution: 1 }), label: id }),
    };
    for (const id of THEME_IDS) {
      const r = new SceneRenderer(provider, { theme: id, background: false });
      r.setLevel({ ...loadFlatGoalLevel(), theme: id });
      const outline = r.blenderView!.outline;
      if (THEMES[id].goalOutline) {
        expect(outline, id).toBeInstanceOf(Graphics);
        expect((outline!.parent as Container).children.indexOf(outline!), id).toBeGreaterThan(0);
      } else {
        expect(outline, id).toBeNull();
      }
      r.destroy();
    }
  });
});

describe('B1: headless render of the original course resolves every asset', () => {
  it('real session, strict provider: no missing texture, no placeholder fallback', async () => {
    const course = courseFor('original')!;
    const level = course.level;
    expect(level.theme).toBe('blueprint');
    const allowed = new Set([...coreAssetDefs(), ...themeAssetDefs(getTheme(level.theme))].map((d) => d.id));
    const misses = new Set<string>();
    const cache = new Map<string, Texture>();
    const provider: TextureProvider = {
      has(id) {
        if (!allowed.has(id)) misses.add(id);
        return allowed.has(id);
      },
      texture(id) {
        if (!allowed.has(id)) throw new Error(`texture "${id}" is not loaded for theme ${level.theme}`);
        let tex = cache.get(id);
        if (!tex) cache.set(id, (tex = new Texture({ source: new TextureSource({ width: 64, height: 64, resolution: 1 }), label: id })));
        return tex;
      },
    };
    const used = new Set<string>();
    const tracking: TextureProvider = { has: (id) => provider.has(id), texture: (id) => (used.add(id), provider.texture(id)) };

    const s = await RunSession.create(exampleCart(), course);
    const r = new SceneRenderer(tracking, { theme: level.theme });
    try {
      r.setLevel(level);
      r.setCartDesign(exampleCart());
      r.resetSource();
      r.setFunnel(funnelGeometry(level.funnel, TOTAL_PINEAPPLES));
      const cam = (x: number, y: number): Camera => ({ center: { x, y }, zoom: 1, viewportWidth: 740, viewportHeight: 360 });
      s.start();
      for (let i = 0; i < 30; i++) s.step();
      r.render(s.world.manifest(), s.world.snapshot(1), cam(level.cartStart.x, level.cartStart.y));
      s.release();
      r.setFunnelOpen(true);
      for (let i = 0; i < 240; i++) s.step();
      r.render(s.world.manifest(), s.world.snapshot(1), cam(level.cartStart.x, level.cartStart.y));
      // the finish: blender in the pit, whirring and full
      r.setGoal(1, 1);
      const goal = level.goal.sensor;
      r.render(s.world.manifest(), s.world.snapshot(1), cam(goal.x, goal.y));
      // the whole course (all spans, incl. the steep drops and the 2008 pit) skins cleanly
      r.buildTerrain(level.terrain.spans.map((sp) => sp.points.map((p) => ({ ...p }))));
      const fills = r.terrainFillPositions();
      expect(fills.length).toBeGreaterThan(0);
      for (const f of fills) for (const v of f) expect(Number.isFinite(v)).toBe(true);

      expect([...misses]).toEqual([]);
      // sky, fill, edge and every parallax layer, plus the blender and pineapples, were drawn
      for (const d of themeAssetDefs(THEMES.blueprint)) expect(used, d.id).toContain(d.id);
      for (const id of ['blender/jar', 'blender/base', 'part/pineapple', 'part/straw']) expect(used, id).toContain(id);
      expect(r.stats.funnel).toBe(true);
      expect(r.blenderView!.outline).not.toBeNull();
    } finally {
      r.destroy();
      s.destroy();
    }
  }, 60_000);
});
