/**
 * Course loading: AppState.levelId -> a validated LevelDef + TerrainSource.
 *
 *  - Premade campaign levels (levels/beach|kitchen|workbench.json, authored
 *    with tools/levels) and the original bonus (levels/original-course.json,
 *    id 'original') go through model/validate (S0 contract 5) and are played
 *    on a LevelChunkSource.
 *  - `endless:<SEED>` plays a ProceduralChunkSource(seed); its LevelDef is a
 *    context stub (no spans: terrain comes from the source; goal unused in
 *    endless mode) with the generator's start plateau, the shared funnel and
 *    ENDLESS_KILL_Y, and a theme picked from the seed.
 */

import type { LevelDef, ThemeId } from '../model/level';
import { DEFAULT_TERRAIN_FRICTION, DEFAULT_TERRAIN_RESTITUTION, LEVEL_DEF_VERSION } from '../model/level';
import { validateLevelDef } from '../model/validate';
import { LevelChunkSource } from '../terrain/chunks';
import { ENDLESS_KILL_Y, ProceduralChunkSource, START_CART } from '../terrain/generator';
import { parseRunTarget } from '../ui/catalog';
import { funnelFor } from './startArea';
import type { Course } from './session';
import beachJson from '../../levels/beach.json';
import kitchenJson from '../../levels/kitchen.json';
import workbenchJson from '../../levels/workbench.json';
import originalJson from '../../levels/original-course.json';

const RAW: Record<string, { file: string; json: unknown }> = {
  beach: { file: 'levels/beach.json', json: beachJson },
  kitchen: { file: 'levels/kitchen.json', json: kitchenJson },
  workbench: { file: 'levels/workbench.json', json: workbenchJson },
  original: { file: 'levels/original-course.json', json: originalJson },
};

export const SHIPPED_LEVEL_IDS: readonly string[] = Object.keys(RAW);

const cache = new Map<string, LevelDef>();

/** The validated shipped level with this id, or null for an unknown id. Throws if a shipped file is invalid. */
export function levelById(id: string): LevelDef | null {
  const hit = cache.get(id);
  if (hit) return hit;
  const raw = Object.prototype.hasOwnProperty.call(RAW, id) ? RAW[id] : undefined;
  if (!raw) return null;
  const r = validateLevelDef(raw.json);
  if (!r.ok) throw new Error(`${raw.file} failed validation: ${r.error.message}`);
  if (r.value.id !== id) throw new Error(`${raw.file}: id '${r.value.id}' does not match catalog id '${id}'`);
  cache.set(id, r.value);
  return r.value;
}

const ENDLESS_THEMES: readonly ThemeId[] = ['beach', 'kitchen', 'workbench'];

/** Theme for an endless seed (stable FNV-1a hash of the seed string). */
export function endlessTheme(seed: string): ThemeId {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ENDLESS_THEMES[h % ENDLESS_THEMES.length]!;
}

/** Endless context LevelDef (not a playable standalone level: no spans). */
export function endlessLevel(seed: string): LevelDef {
  const cartStart = { ...START_CART };
  return {
    version: LEVEL_DEF_VERSION,
    id: `endless:${seed}`,
    name: `Endless ${seed}`,
    theme: endlessTheme(seed),
    terrain: { spans: [], friction: DEFAULT_TERRAIN_FRICTION, restitution: DEFAULT_TERRAIN_RESTITUTION },
    cartStart,
    funnel: funnelFor(cartStart),
    // Unused in endless mode (the controller never checks the goal there).
    goal: { sensor: { x: -1e6, y: -1e6, width: 1, height: 1 }, lineX: Number.MAX_SAFE_INTEGER },
    props: [],
    zones: [],
    killY: ENDLESS_KILL_Y,
  };
}

/** Course for an AppState.levelId, or null for an unknown level. */
export function courseFor(levelId: string): Course | null {
  const t = parseRunTarget(levelId);
  if (t.kind === 'endless') {
    return { levelId, mode: 'endless', level: endlessLevel(t.seed), source: new ProceduralChunkSource(t.seed), seed: t.seed };
  }
  const level = levelById(levelId);
  if (!level) return null;
  return { levelId, mode: 'level', level, source: new LevelChunkSource(level.terrain) };
}
