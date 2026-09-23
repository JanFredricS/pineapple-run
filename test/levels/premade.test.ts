/**
 * The three premade campaign levels (S6). levels/{beach,kitchen,workbench}.json
 * are generated from the Track DSL in tools/levels/premade.ts; regenerate with
 *   UPDATE_FIXTURES=1 npx vitest run test/levels/premade.test.ts
 *
 * Checks every shipped level (premade + the original bonus) against the
 * shared start-area / goal conventions (INTEGRATION.md #3, #4, #6, #7, #12).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LevelDef } from '../../src/model/level';
import { validateLevelDef } from '../../src/model/validate';
import { COURSES } from '../../src/ui/catalog';
import { funnelFor, plateauRange } from '../../src/game/startArea';
import { courseFor, endlessTheme, levelById, SHIPPED_LEVEL_IDS } from '../../src/game/courses';
import { ENDLESS_KILL_Y, ProceduralChunkSource, START_CART, START_FUNNEL } from '../../src/terrain/generator';
import { LevelChunkSource } from '../../src/terrain/chunks';
import { groundAt, PREMADE } from '../../tools/levels/premade';

const root = join(__dirname, '..', '..');
const ids = ['beach', 'kitchen', 'workbench'] as const;
const authored = Object.fromEntries(ids.map((id) => [id, PREMADE[id]()])) as Record<(typeof ids)[number], ReturnType<(typeof PREMADE)['beach']>>;

if (process.env.UPDATE_FIXTURES) {
  for (const id of ids) writeFileSync(join(root, `levels/${id}.json`), JSON.stringify(authored[id].level, null, 1) + '\n');
}

/** Deepest SURFACE point (gap side walls, S6T #1, run down to killY by design). */
function maxTerrainY(level: LevelDef): number {
  let m = -Infinity;
  for (const s of level.terrain.spans) for (const p of s.points) if (p.y < level.killY) m = Math.max(m, p.y);
  return m;
}

describe('premade level fixtures', () => {
  for (const id of ids) {
    it(`${id}: levels/${id}.json exists, matches the DSL, validates clean`, () => {
      const path = join(root, `levels/${id}.json`);
      expect(existsSync(path)).toBe(true);
      const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      expect(raw).toEqual(authored[id].level);
      const r = validateLevelDef(raw);
      if (!r.ok) throw new Error(r.error.message);
      expect(r.migratedFrom).toBeUndefined();
      expect(r.value).toEqual(raw);
    });
  }

  it('the shipped ids are exactly the catalog ids (INTEGRATION #4)', () => {
    expect([...SHIPPED_LEVEL_IDS].sort()).toEqual(COURSES.map((c) => c.levelId).sort());
    for (const c of COURSES) {
      const l = levelById(c.levelId)!;
      expect(l.id).toBe(c.levelId);
      expect(l.theme).toBe(c.theme);
    }
  });
});

describe('shipped level conventions', () => {
  for (const id of ['beach', 'kitchen', 'workbench', 'original']) {
    describe(id, () => {
      const level = levelById(id)!;

      it('cartStart is the ground and the plateau is flat across the build area (#3, #6)', () => {
        // The recovered original's plateau ends exactly at the 2008 build
        // area's right edge (no margin) and falls 0.5 px over its length;
        // premade are exact. UX1: the wider build area reaches left of the
        // recovered course, over the added flat start plateau (with margin).
        const tol = id === 'original' ? 0.02 : 1e-9;
        const range = plateauRange(level.cartStart);
        const minX = range.minX;
        const maxX = id === 'original' ? range.maxX - 1 : range.maxX;
        for (let x = minX; x <= maxX; x += 0.25) {
          const g = groundAt(level, x);
          expect(g, `ground at ${x}`).not.toBeNull();
          expect(Math.abs(g! - level.cartStart.y), `ground at ${x}`).toBeLessThanOrEqual(tol);
          // nothing is ever spawned inside the ground
          expect(g!).toBeGreaterThanOrEqual(level.cartStart.y - 1e-9);
        }
      });

      it('funnel outlet is at the shared start-area offset (#6)', () => {
        const f = funnelFor(level.cartStart);
        expect(level.funnel.x).toBeCloseTo(f.x, 3);
        expect(level.funnel.y).toBeCloseTo(f.y, 3);
      });

      it('has a SOLID blender body standing on the pit floor inside the goal sensor (#7, #12)', () => {
        const blenders = level.props.filter((p) => p.art === 'blender');
        expect(blenders).toHaveLength(1);
        const b = blenders[0]!;
        expect(b.solid).toBe(true);
        expect(b.size!.x).toBeGreaterThan(0);
        expect(b.size!.y).toBeGreaterThan(0);
        const bottom = b.position.y + b.size!.y / 2;
        expect(bottom).toBeCloseTo(groundAt(level, b.position.x)!, 3);
        const s = level.goal.sensor;
        expect(b.position.x).toBeGreaterThan(s.x);
        expect(b.position.x).toBeLessThan(s.x + s.width);
        expect(s.y + s.height).toBeCloseTo(bottom, 3); // sensor sits on the pit floor
        expect(level.goal.lineX).toBeLessThan(s.x + s.width);
      });

      it('killY is below all terrain', () => {
        expect(level.killY).toBeGreaterThan(maxTerrainY(level) + 5);
      });
    });
  }

  it('the endless start agrees with the shared start area', () => {
    const f = funnelFor(START_CART);
    expect(START_FUNNEL.x).toBeCloseTo(f.x, 9);
    expect(START_FUNNEL.y).toBeCloseTo(f.y, 9);
  });
});

describe('premade level design', () => {
  it('each level has distinct challenges, not flat roads', () => {
    const sigs = new Set<string>();
    for (const id of ids) {
      const kinds = new Set(authored[id].features.map((f) => f.kind));
      kinds.delete('plateau');
      kinds.delete('finish');
      expect(kinds.size, id).toBeGreaterThanOrEqual(5);
      // no long flat stretch outside the start plateau
      const level = authored[id].level;
      const plateauEnd = plateauRange(level.cartStart).maxX;
      let flatRun = 0;
      let longest = 0;
      for (let x = plateauEnd; x < level.goal.lineX - 3; x += 0.5) {
        const a = groundAt(level, x);
        const b = groundAt(level, x + 0.5);
        if (a !== null && b !== null && Math.abs(a - b) < 1e-6) flatRun += 0.5;
        else flatRun = 0;
        longest = Math.max(longest, flatRun);
      }
      expect(longest, id).toBeLessThanOrEqual(12);
      sigs.add(authored[id].features.map((f) => f.kind).join(','));
    }
    expect(sigs.size).toBe(3);
  });

  it('difficulty rises: beach has no gaps, kitchen several, workbench the widest', () => {
    const gaps = (id: (typeof ids)[number]) => authored[id].features.filter((f) => f.kind === 'gap').map((f) => f.x1 - f.x0);
    expect(gaps('beach')).toHaveLength(0);
    expect(gaps('kitchen').length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...gaps('workbench'))).toBeGreaterThan(Math.max(...gaps('kitchen')));
  });
});

describe('course loading (AppState.levelId -> course)', () => {
  it('premade ids load validated levels on a LevelChunkSource', () => {
    for (const id of SHIPPED_LEVEL_IDS) {
      const c = courseFor(id)!;
      expect(c.mode).toBe('level');
      expect(c.level.id).toBe(id);
      expect(c.source).toBeInstanceOf(LevelChunkSource);
    }
  });

  it('endless:<SEED> is an endless course on the seeded generator with the shared start', () => {
    const c = courseFor('endless:ABC123')!;
    expect(c.mode).toBe('endless');
    expect(c.seed).toBe('ABC123');
    expect(c.source).toBeInstanceOf(ProceduralChunkSource);
    expect(c.level.killY).toBe(ENDLESS_KILL_Y);
    expect(c.level.cartStart).toEqual(START_CART);
    expect(c.level.funnel).toEqual(funnelFor(START_CART));
    expect(c.level.theme).toBe(endlessTheme('ABC123'));
    expect(courseFor('endless:ABC123')!.level).toEqual(c.level); // deterministic
  });

  it('unknown or malformed ids have no course', () => {
    expect(courseFor('nope')).toBeNull();
    expect(courseFor('endless:bad seed!')).toBeNull();
    expect(courseFor('__proto__')).toBeNull();
  });
});
