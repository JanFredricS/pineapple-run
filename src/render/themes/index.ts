/**
 * Theme registry + derived asset lists + CSS custom properties.
 */

import { THEME_IDS, type ThemeId } from '../../model/level';
import type { SvgAssetDef } from '../assets';
import { skyAssetDef } from '../textures';
import { beach } from './beach';
import { kitchen } from './kitchen';
import { PALETTE_KEYS, type Theme, type ThemePalette } from './types';
import { test } from './test';
import { tiki } from './tiki';
import { workbench } from './workbench';

export * from './types';

/** Exhaustive over the model's ThemeId: a new id without a theme fails to compile. */
export const THEMES: { readonly [K in ThemeId]: Theme } = { beach, kitchen, workbench, tiki, test };

export function getTheme(id: ThemeId): Theme {
  return THEMES[id];
}

/** Asset ids of a theme's textures (all standalone repeat textures). */
export const themeAssetId = {
  fill: (t: ThemeId) => `${t}/ground-fill`,
  edge: (t: ThemeId) => `${t}/ground-edge`,
  layer: (t: ThemeId, layerId: string) => `${t}/layer/${layerId}`,
};

/** Every texture a theme needs; load only the active theme's on phones. */
export function themeAssetDefs(theme: Theme): SvgAssetDef[] {
  return [
    skyAssetDef(theme),
    { id: themeAssetId.fill(theme.id), svg: theme.terrain.fill.svg, repeat: true },
    { id: themeAssetId.edge(theme.id), svg: theme.terrain.edge.svg, repeat: true },
    ...theme.parallax.map((l) => ({ id: themeAssetId.layer(theme.id, l.id), svg: l.svg, repeat: true })),
  ];
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** `--pr-sky-top`-style custom properties for HTML UI theming. */
export function themeCssVars(theme: Theme): Record<`--pr-${string}`, string> {
  const vars: Record<`--pr-${string}`, string> = {};
  for (const key of PALETTE_KEYS) vars[`--pr-${kebab(key)}`] = theme.palette[key];
  vars['--pr-theme'] = theme.id;
  return vars;
}

/** Apply a theme's custom properties to an element (default: :root). */
export function applyThemeCss(theme: Theme, el: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(themeCssVars(theme))) el.style.setProperty(k, v);
  el.dataset.theme = theme.id;
}

/** CSS text (`selector { --pr-…: … }`) for every theme, keyed by `[data-theme=…]`. */
export function themesCssText(): string {
  return THEME_IDS.map((id) => {
    const body = Object.entries(themeCssVars(THEMES[id]))
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n');
    return `[data-theme="${id}"] {\n${body}\n}`;
  }).join('\n');
}

export function hexToNumber(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}

export type { ThemePalette };
