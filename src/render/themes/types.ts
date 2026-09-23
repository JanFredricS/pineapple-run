/**
 * Theme = palette + terrain skin + parallax layer set. Every theme goes
 * through the same geometry pipeline (render/terrainMesh.ts, render/parallax.ts);
 * only data differs. `THEMES` (themes/index.ts) is typed `{ [K in ThemeId]: Theme }`
 * so adding a ThemeId to the model without a theme is a compile error.
 */

import type { ThemeId } from '../../model/level';

/** Colours as CSS hex strings (#RRGGBB). */
export interface ThemePalette {
  /** Sky / wall gradient behind all parallax layers (top -> horizon). */
  skyTop: string;
  skyBottom: string;
  /** Main ground colour (fill base) — also used as the loading/placeholder colour. */
  ground: string;
  /** Ground surface highlight (edge strip crest). */
  groundEdge: string;
  /** Depth shading tint applied under the surface. */
  groundShade: string;
  /** Primary text/ink colour on the theme's backdrop. */
  ink: string;
  /** Panel/paper colour for HTML UI on this theme. */
  paper: string;
  /** Brand accents (buttons, highlights). */
  accent: string;
  accentAlt: string;
  /** HUD panel background (use with some alpha) and its text colour. */
  uiPanel: string;
  uiText: string;
  /** Efficiency-rating bands: good (>66), ok (33–66), bad (<33). */
  good: string;
  ok: string;
  bad: string;
  /** Piña-colada fill in the blender goal. */
  blenderFill: string;
}

export const PALETTE_KEYS = [
  'skyTop',
  'skyBottom',
  'ground',
  'groundEdge',
  'groundShade',
  'ink',
  'paper',
  'accent',
  'accentAlt',
  'uiPanel',
  'uiText',
  'good',
  'ok',
  'bad',
  'blenderFill',
] as const satisfies readonly (keyof ThemePalette)[];

// Compile-time exhaustiveness: PALETTE_KEYS must list every ThemePalette key.
type MissingPaletteKeys = Exclude<keyof ThemePalette, (typeof PALETTE_KEYS)[number]>;
const _paletteKeysExhaustive: MissingPaletteKeys extends never ? true : false = true;
void _paletteKeysExhaustive;

export interface TileTexture {
  /** SVG document (raw string from assets/svg). */
  svg: string;
  /** World metres covered by one texture width (sets the on-screen scale). */
  metresPerTile: number;
}

export interface TerrainSkin {
  /** Tiled fill under each span polyline (world-space UVs). */
  fill: TileTexture;
  /**
   * Edge strip along the surface. The texture's v axis spans from `above`
   * metres above the surface (v=0) to `below` metres below it (v=1).
   */
  edge: TileTexture & { above: number; below: number };
  /** Depth shading: transparent at the surface, `alpha` of palette.groundShade at `depth` m and below. */
  shade: { depth: number; alpha: number };
}

export type ParallaxMode =
  /** Full-screen texture tiled in both axes (walls, paper). */
  | 'fill'
  /** Horizontal band anchored by its bottom edge relative to the horizon. */
  | 'band';

export interface ParallaxLayerDef {
  /** Unique within the theme; also the asset id suffix. */
  id: string;
  svg: string;
  mode: ParallaxMode;
  /** 0 = fixed to the screen, 1 = moves with the world. */
  factor: number;
  /**
   * band: design px from the horizon line (screen centre when the camera is at
   * the theme's horizon height) to the band's bottom edge; +down.
   */
  bottom?: number;
  /** band: solid colour drawn under the band down to the screen bottom. */
  fillBelow?: string;
  alpha?: number;
}

export interface Theme {
  id: ThemeId;
  name: string;
  palette: ThemePalette;
  terrain: TerrainSkin;
  /** Back-to-front. 3–4 layers. */
  parallax: ParallaxLayerDef[];
  /** Horizon offset: metres above the level's median terrain height where far layers sit. */
  horizonLift: number;
  /**
   * Optional ink colour (#RRGGBB) for an outline traced over the blender
   * jar's glass edge and rim (B1). The shared jar art is pale cyan glass,
   * which washes out on a near-white backdrop; light-sky themes set this.
   * Unset = no outline (the other themes render exactly as before).
   */
  goalOutline?: string;
}
