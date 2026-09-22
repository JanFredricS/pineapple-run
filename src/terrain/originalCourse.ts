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

export function originalCourseLevel(pxVertices: readonly Vec2[]): LevelDef {
  const pts = pxVertices.map((p) => ({ x: pxToM(p.x), y: pxToM(p.y) }));
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const maxY = Math.max(...pts.map((p) => p.y));
  const plateauY = first.y;
  return {
    version: LEVEL_DEF_VERSION,
    id: 'original-course',
    name: 'The Original Course (2008)',
    theme: 'workbench',
    terrain: {
      spans: [
        { id: 'start-wall', points: [{ x: first.x - 0.1, y: first.y - 6 }, { ...first }] },
        { id: 'course', points: pts },
        { id: 'end-wall', points: [{ ...last }, { x: last.x + 0.1, y: last.y - 8 }] },
      ],
      friction: DEFAULT_TERRAIN_FRICTION,
      restitution: DEFAULT_TERRAIN_RESTITUTION,
    },
    cartStart: { x: 2, y: plateauY - 1.8 },
    funnel: { x: 5, y: plateauY - 6 },
    goal: {
      sensor: { x: pxToM(7665), y: last.y - 2.5, width: last.x - pxToM(7665) + 0.1, height: 2.5 },
      lineX: pxToM(ORIGINAL_GOAL_LINE_PX),
    },
    props: [{ id: 'blender', art: 'blender', position: { x: pxToM(7675), y: last.y } }],
    zones: [],
    killY: Math.ceil(maxY + 15),
  };
}
