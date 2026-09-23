/**
 * Port of the original Coconut Run course (71 vertices recovered from
 * GroundShape.frame1, research/original-game-files/terrain.txt) to a
 * LevelDef. levels/original-course.json is generated from this and a test
 * keeps the two in sync (UPDATE_FIXTURES=1 regenerates the JSON).
 *
 * Units: the original is Flash stage pixels at 30 px = 1 m (Box2DFlashAS3
 * scale), so metres = px / 30 on both axes.
 *
 * Y axis: Flash's stage is y-DOWN, and so is our world (gravity +y, see
 * model/level.ts) — so y is NOT flipped, only scaled. Larger y = lower
 * ground: the start plateau is y 278 px = 9.27 m, the "first hill" crest
 * y 160.8 px = 5.36 m is higher up, the lowest point y 443.15 px = 14.77 m.
 * x is kept as-is (no re-origin), so the original's x-positions quoted in
 * research/coconut-run-mechanics.md map 1:1 (goal line 7670 px = 255.67 m).
 *
 * The original extruded each vertex pair down into a solid column; our
 * one-sided chain (solid below) is the same surface. Additions that are NOT
 * in the recovered data, flagged: a steep backstop wall at each end (like
 * the S0 spike level) so cargo cannot roll off the world, the goal sensor
 * rectangle (the original's shredder base sat over the pit behind the lip at
 * x ≈ 7660 px; exact sensor size not recovered), cart/funnel start positions
 * on the plateau (the original build area was x < 366 px), and killY.
 *
 * S6 integration (INTEGRATION.md #3, #4, #6, #7, #12): id is the catalog id
 * 'original'; cartStart is the GROUND under design (0, 0) — the 2008 build
 * area (design x −20..340 px) exactly covers the recovered plateau (x
 * −12.8..355.7 px), so design x −20 sits just right of the first recovered
 * vertex, with y at the plateau's highest vertex (the plateau falls 0.5 px
 * over its length, so nothing is spawned inside the ground); the funnel
 * outlet sits at the shared start-area offset (+115, −225) px. UX1: the
 * build area now reaches design x −190 px, left of the recovered course, so
 * a flat START PLATEAU (flagged addition, like the pit floor) runs from the
 * first recovered vertex back past the build area's left edge + 1 m, and the
 * start wall moved to its left end. The recovered vertices are unchanged. The recovered course ends in a 0.8 m-wide chasm
 * behind the lip, too narrow for a blender body, so the end wall is replaced
 * by an added pit floor (PIT_FLOOR_M, flagged addition) with the SOLID
 * blender standing on it (position = box centre) and the goal sensor over
 * the floor's bottom 2.2 m, like the premade courses.
 */

import { pxToM } from '../model/coords';
import type { Vec2 } from '../model/geometry';
import { DEFAULT_TERRAIN_FRICTION, DEFAULT_TERRAIN_RESTITUTION, LEVEL_DEF_VERSION, type LevelDef } from '../model/level';

/** Parse terrain.txt: one "x y" pair (px) per line. */
export function parseOriginalTerrain(text: string): Vec2[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l, i) => {
      const parts = l.split(/\s+/).map(Number);
      if (parts.length !== 2 || !parts.every(Number.isFinite)) throw new Error(`terrain.txt line ${i + 1}: expected "x y"`);
      return { x: parts[0]!, y: parts[1]! };
    });
}

export const ORIGINAL_GOAL_LINE_PX = 7670;
/** Added pit floor after the last recovered vertex (m). */
export const PIT_FLOOR_M = 7;
/** Solid blender body (m): same as the premade courses (tools/levels/track.ts BLENDER_SIZE). */
export const ORIGINAL_BLENDER_SIZE = { x: 1.5, y: 3.6 } as const;
/** The 2008 build area's left edge (design px): design x −20 sits just right of the first recovered vertex. */
const ORIGINAL_BUILD_MIN_X_PX = -20;
/** Start-area offsets, design px (must equal src/game/startArea.ts; an integration test checks). */
const BUILD_MIN_X_PX = -190;
const FUNNEL_OFFSET = { x: 115, y: -225 } as const;
/** Added flat start plateau (UX1): reaches this far left of the build area's left edge (m). */
const START_PLATEAU_MARGIN_M = 1.5;

export function originalCourseLevel(pxVertices: readonly Vec2[]): LevelDef {
  const pts = pxVertices.map((p) => ({ x: pxToM(p.x), y: pxToM(p.y) }));
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const maxY = Math.max(...pts.map((p) => p.y));
  // Plateau = the recovered vertices up to the original build-area edge (366 px).
  const plateau = pts.filter((p) => p.x <= pxToM(366));
  const plateauY = Math.min(...plateau.map((p) => p.y));
  const startX = first.x - pxToM(ORIGINAL_BUILD_MIN_X_PX) + 0.05;
  const wallX = Math.min(first.x, startX + pxToM(BUILD_MIN_X_PX) - START_PLATEAU_MARGIN_M);
  const floorEnd = last.x + PIT_FLOOR_M;
  return {
    version: LEVEL_DEF_VERSION,
    id: 'original',
    name: 'The Original Course (2008)',
    theme: 'workbench',
    terrain: {
      spans: [
        { id: 'start-plateau', points: [{ x: wallX - 0.1, y: first.y - 6 }, { x: wallX, y: first.y }, { ...first }] },
        { id: 'course', points: pts },
        { id: 'pit-floor', points: [{ ...last }, { x: floorEnd, y: last.y }, { x: floorEnd + 0.1, y: last.y - 8 }] },
      ],
      friction: DEFAULT_TERRAIN_FRICTION,
      restitution: DEFAULT_TERRAIN_RESTITUTION,
    },
    cartStart: { x: startX, y: plateauY },
    funnel: { x: startX + pxToM(FUNNEL_OFFSET.x), y: plateauY + pxToM(FUNNEL_OFFSET.y) },
    goal: {
      sensor: { x: last.x, y: last.y - 2.2, width: PIT_FLOOR_M, height: 2.2 },
      lineX: pxToM(ORIGINAL_GOAL_LINE_PX),
    },
    props: [
      {
        id: 'blender',
        art: 'blender',
        solid: true,
        position: { x: last.x + 4.5, y: last.y - ORIGINAL_BLENDER_SIZE.y / 2 },
        size: { ...ORIGINAL_BLENDER_SIZE },
      },
    ],
    zones: [],
    killY: Math.ceil(maxY + 15),
  };
}
