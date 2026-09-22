/**
 * Parallax background: a stretched sky gradient plus the theme's 3–4 layers.
 * Screen-space (not inside the world container). Layer placement math is
 * pure (`layerPlacement`) and unit-tested.
 */

import { Container, Sprite, Texture, TilingSprite } from 'pixi.js';
import { PX_PER_M, type Camera } from '../model/coords';
import { hexToNumber, themeAssetId } from './themes';
import type { ParallaxLayerDef, Theme } from './themes/types';
import { skyId, type TextureProvider } from './textures';

/** Viewport height the layer art is authored for. */
export const DESIGN_VIEWPORT_H = 720;

export interface LayerPlacement {
  /** Uniform texture scale (screen px per design px). */
  scale: number;
  /** Tile offset (screen px), already wrapped into [−period, 0]. */
  tileX: number;
  tileY: number;
  /** band: screen y of the band's bottom edge. */
  bottomY: number;
}

/** Base art scale for a viewport height (phones shrink art, big screens grow it, clamped). */
export function baseLayerScale(viewportHeight: number): number {
  return Math.min(1.6, Math.max(0.5, viewportHeight / DESIGN_VIEWPORT_H));
}

function wrap(v: number, period: number): number {
  if (!(period > 0)) return 0;
  const m = v % period;
  return m > 0 ? m - period : m;
}

/**
 * Where a layer sits for a camera. A layer with factor f scrolls f times as
 * fast as the world and is scaled 1 + (zoom − 1)·f; `horizonY` is the world
 * height (metres) the far layers are anchored to.
 */
export function layerPlacement(
  layer: Pick<ParallaxLayerDef, 'factor' | 'bottom'>,
  texSize: { width: number; height: number },
  camera: Camera,
  horizonY: number,
): LayerPlacement {
  const base = baseLayerScale(camera.viewportHeight);
  const scale = base * (1 + (camera.zoom - 1) * layer.factor);
  const k = PX_PER_M * camera.zoom;
  const dx = -camera.center.x * k * layer.factor;
  const dy = (horizonY - camera.center.y) * k * layer.factor;
  return {
    scale,
    tileX: wrap(dx, texSize.width * scale),
    tileY: wrap(dy, texSize.height * scale),
    bottomY: camera.viewportHeight / 2 + (layer.bottom ?? 0) * base + dy,
  };
}

interface LayerView {
  def: ParallaxLayerDef;
  sprite: TilingSprite;
  below: Sprite | null;
  tex: Texture;
}

export class ParallaxBackground {
  readonly view = new Container();
  private readonly sky: Sprite;
  private readonly layers: LayerView[] = [];

  constructor(
    textures: TextureProvider,
    readonly theme: Theme,
  ) {
    this.sky = new Sprite(textures.texture(skyId(theme)));
    this.view.addChild(this.sky);
    for (const def of theme.parallax) {
      const tex = textures.texture(themeAssetId.layer(theme.id, def.id));
      const sprite = new TilingSprite({ texture: tex, width: 1, height: 1 });
      if (def.alpha !== undefined) sprite.alpha = def.alpha;
      let below: Sprite | null = null;
      if (def.mode === 'band' && def.fillBelow) {
        below = new Sprite(Texture.WHITE);
        below.tint = hexToNumber(def.fillBelow);
        this.view.addChild(below);
      }
      this.view.addChild(sprite);
      this.layers.push({ def, sprite, below, tex });
    }
  }

  update(camera: Camera, horizonY: number): void {
    const w = camera.viewportWidth;
    const h = camera.viewportHeight;
    this.sky.position.set(0, 0);
    this.sky.width = w;
    this.sky.height = h;
    for (const l of this.layers) {
      const p = layerPlacement(l.def, l.tex, camera, horizonY);
      const s = l.sprite;
      s.tileScale.set(p.scale);
      if (l.def.mode === 'fill') {
        s.position.set(0, 0);
        s.width = w;
        s.height = h;
        s.tilePosition.set(p.tileX, p.tileY);
      } else {
        const bandH = l.tex.height * p.scale;
        s.width = w;
        s.height = bandH;
        s.position.set(0, Math.round(p.bottomY - bandH));
        s.tilePosition.set(p.tileX, 0);
        if (l.below) {
          const top = Math.round(p.bottomY) - 1;
          l.below.position.set(0, top);
          l.below.width = w;
          l.below.height = Math.max(0, h - top);
          l.below.visible = top < h;
        }
      }
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
