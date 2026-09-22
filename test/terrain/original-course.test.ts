/**
 * The original 71-vertex course port. levels/original-course.json is
 * generated from research/original-game-files/terrain.txt by
 * src/terrain/originalCourse.ts; regenerate with
 *   UPDATE_FIXTURES=1 npx vitest run test/terrain/original-course.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateLevelDef } from '../../src/model/validate';
import { LevelChunkSource } from '../../src/terrain/chunks';
import { originalCourseLevel, parseOriginalTerrain } from '../../src/terrain/originalCourse';

const root = join(__dirname, '..', '..');
const txt = readFileSync(join(root, 'research/original-game-files/terrain.txt'), 'utf8');
const fixturePath = join(root, 'levels/original-course.json');
const expected = originalCourseLevel(parseOriginalTerrain(txt));

if (process.env.UPDATE_FIXTURES) writeFileSync(fixturePath, JSON.stringify(expected, null, 1) + '\n');

describe('original course port', () => {
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown;

  it('fixture exists, is up to date with the converter, and validates clean', () => {
    expect(existsSync(fixturePath)).toBe(true);
    expect(raw).toEqual(expected);
    const r = validateLevelDef(raw);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.migratedFrom).toBeUndefined();
    expect(r.value).toEqual(raw);
  });

  it('keeps all 71 recovered vertices, px / 30, y not flipped (both y-down)', () => {
    const course = expected.terrain.spans.find((s) => s.id === 'course')!;
    expect(course.points).toHaveLength(71);
    const at = (i: number) => course.points[i]!;
    // first vertex / start plateau (-12.8, 278.15)
    expect(at(0).x).toBeCloseTo(-12.8 / 30, 12);
    expect(at(0).y).toBeCloseTo(278.15 / 30, 12);
    // high crest (1174.0, 160.8) then the steep drop to (1564.2, 432.15)
    expect(at(9).x).toBeCloseTo(1174.0 / 30, 12);
    expect(at(9).y).toBeCloseTo(160.8 / 30, 12);
    expect(at(11).y).toBeCloseTo(432.15 / 30, 12);
    expect(at(11).y).toBeGreaterThan(at(9).y); // y-down: the drop goes DOWN (larger y)
    // launch lip (2460.2, 226.15) -> (2511.2, 335.15)
    expect(at(15)).toEqual({ x: 2460.2 / 30, y: 226.15 / 30 });
    expect(at(16)).toEqual({ x: 2511.2 / 30, y: 335.15 / 30 });
    // kicker peak (4869.2, 187.15)
    expect(at(57)).toEqual({ x: 4869.2 / 30, y: 187.15 / 30 });
    // last vertex, the pit behind the shredder lip (7686.75, 433.9)
    expect(at(70)).toEqual({ x: 7686.75 / 30, y: 433.9 / 30 });
  });

  it('contains the washboard: nine ~15 px bumps, 40 px apart, x 3174–3519 px', () => {
    const course = expected.terrain.spans.find((s) => s.id === 'course')!.points;
    const wb = course.filter((p) => p.x * 30 >= 3174 && p.x * 30 <= 3520);
    const peaks = wb.filter((p, i) => i > 0 && i < wb.length - 1 && p.y < wb[i - 1]!.y && p.y < wb[i + 1]!.y);
    expect(peaks).toHaveLength(9);
    for (let i = 1; i < peaks.length; i++) expect((peaks[i]!.x - peaks[i - 1]!.x) * 30).toBeCloseTo(40, 6);
    for (const p of peaks) expect(297.15 - p.y * 30).toBeCloseTo(15.65, 6);
  });

  it('goal line is the original x 7670 px and the level chunks cleanly', () => {
    expect(expected.goal.lineX * 30).toBeCloseTo(7670, 9);
    expect(expected.theme).toBe('workbench');
    const src = new LevelChunkSource(expected.terrain);
    expect(src.firstChunk).toBe(-1);
    expect(src.lastChunk).toBe(6);
    let n = 0;
    for (let k = src.firstChunk; k <= src.lastChunk; k++) n += src.chunk(k).pieces.length;
    expect(n).toBeGreaterThanOrEqual(8);
  });

  it('rejects malformed terrain text', () => {
    expect(() => parseOriginalTerrain('1 2\n3\n')).toThrow(/line 2/);
  });
});
