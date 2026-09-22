/**
 * Texture lookup shared by the render views, plus the few textures that are
 * generated from code rather than authored art (per-theme sky gradient, the
 * depth-shade ramp).
 */

import type { Texture } from 'pixi.js';
import type { SvgAssetDef } from './assets';
import type { Theme } from './themes/types';

export interface TextureProvider {
  texture(id: string): Texture;
  has(id: string): boolean;
}

/** First provider that has the id wins. */
export function combineProviders(...providers: TextureProvider[]): TextureProvider {
  return {
    has: (id) => providers.some((p) => p.has(id)),
    texture(id) {
      for (const p of providers) if (p.has(id)) return p.texture(id);
      throw new Error(`unknown asset "${id}"`);
    },
  };
}

export const SHADE_ID = 'fx/shade';
export const skyId = (theme: Theme) => `${theme.id}/sky`;

/** Vertical white alpha ramp (0 at top -> 1 at bottom); tinted per theme. */
export function shadeAssetDef(): SvgAssetDef {
  return {
    id: SHADE_ID,
    standalone: true,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="64" viewBox="0 0 4 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/>
    <stop offset="0.35" stop-color="#FFFFFF" stop-opacity="0.35"/>
    <stop offset="1" stop-color="#FFFFFF" stop-opacity="1"/>
  </linearGradient></defs>
  <rect width="4" height="64" fill="url(#g)"/>
</svg>`,
  };
}

/** Theme sky: vertical gradient skyTop -> skyBottom, stretched over the screen. */
export function skyAssetDef(theme: Theme): SvgAssetDef {
  const { skyTop, skyBottom } = theme.palette;
  return {
    id: skyId(theme),
    standalone: true,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="256" viewBox="0 0 4 256">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${skyTop}"/>
    <stop offset="1" stop-color="${skyBottom}"/>
  </linearGradient></defs>
  <rect width="4" height="256" fill="url(#g)"/>
</svg>`,
  };
}
