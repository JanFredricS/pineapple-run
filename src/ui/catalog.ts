/**
 * Course catalog shown on level select, plus unlock rules and the run-target
 * encoding used in AppState.levelId. Pure.
 *
 * Level ids here are the ids S6's premade LevelDefs must use.
 */

import type { ThemeId } from '../model/level';
import { levelBest, type ScoreBook } from '../model/score';
import { validateSeed } from './seed';

export interface CourseInfo {
  levelId: string;
  name: string;
  blurb: string;
  theme: ThemeId;
  /** Bonus courses sit after the campaign and unlock differently. */
  bonus: boolean;
}

export const COURSES: readonly CourseInfo[] = [
  { levelId: 'beach', name: 'Beach Run', blurb: 'Dunes, driftwood and a blender at the tiki bar.', theme: 'beach', bonus: false },
  { levelId: 'kitchen', name: 'Kitchen Bench', blurb: 'Cutting-board ramps and gaps between the tiles.', theme: 'kitchen', bonus: false },
  { levelId: 'workbench', name: 'Workbench', blurb: 'Rulers, planks and a pegboard sky.', theme: 'workbench', bonus: false },
  { levelId: 'original', name: 'The Original Course', blurb: 'The recovered 2008 course, vertex for vertex. Expert: it forgives only the right speed.', theme: 'workbench', bonus: true },
];

export const ENDLESS_PREFIX = 'endless:';

/** What an AppState.levelId refers to. */
export type RunTarget = { kind: 'level'; levelId: string; course: CourseInfo | null } | { kind: 'endless'; seed: string };

export function endlessLevelId(seed: string): string {
  return ENDLESS_PREFIX + seed;
}

/**
 * Decode an AppState.levelId. `endless:<seed>` is endless mode; an invalid
 * seed after the prefix is treated as a plain (unknown) level id rather than
 * guessed at.
 */
export function parseRunTarget(levelId: string): RunTarget {
  if (levelId.startsWith(ENDLESS_PREFIX)) {
    const v = validateSeed(levelId.slice(ENDLESS_PREFIX.length));
    if (v.ok && v.seed === levelId.slice(ENDLESS_PREFIX.length)) return { kind: 'endless', seed: v.seed };
  }
  return { kind: 'level', levelId, course: COURSES.find((c) => c.levelId === levelId) ?? null };
}

/** A course counts as "cleared" once a run delivered with a non-zero rating. */
export function isCleared(book: ScoreBook, levelId: string): boolean {
  return (levelBest(book, levelId)?.bestRating ?? 0) > 0;
}

/**
 * Unlock rules: the first campaign course is always open; each next one opens
 * when the previous is cleared; the bonus (original) course opens when every
 * campaign course is cleared. Unknown ids are unlocked (dev/test levels).
 */
export function isUnlocked(book: ScoreBook, levelId: string): boolean {
  const idx = COURSES.findIndex((c) => c.levelId === levelId);
  if (idx < 0) return true;
  const course = COURSES[idx]!;
  if (course.bonus) return COURSES.filter((c) => !c.bonus).every((c) => isCleared(book, c.levelId));
  if (idx === 0) return true;
  return isCleared(book, COURSES[idx - 1]!.levelId);
}

/** The course after `levelId` in catalog order, or null at the end / unknown id. */
export function nextCourse(levelId: string): CourseInfo | null {
  const idx = COURSES.findIndex((c) => c.levelId === levelId);
  if (idx < 0) return null;
  return COURSES[idx + 1] ?? null;
}

/** Why a locked course is locked (for the card). */
export function lockReason(levelId: string): string {
  const idx = COURSES.findIndex((c) => c.levelId === levelId);
  const course = COURSES[idx];
  if (!course) return '';
  if (course.bonus) return 'Clear every course to unlock';
  const prev = COURSES[idx - 1];
  return prev ? `Clear ${prev.name} to unlock` : '';
}
