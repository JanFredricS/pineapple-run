/**
 * Blender goal: base + glass jar + lid, with a whir animation — spinning
 * blades (faked in side view by oscillating scale.x), a rising piña-colada
 * fill driven by `progress` (0..1), a vortex dip and a little motor shake
 * driven by `whir` (0..1).
 *
 * Local units are design px with the origin at the base's bottom-centre; the
 * owner scales `view` into world metres (see SceneRenderer).
 */

import { Container, Graphics, Sprite } from 'pixi.js';
import { ART, BLENDER_LAYOUT as L } from './artCatalog';
import type { TextureProvider } from './textures';
import type { Vec2 } from '../model/geometry';

/** Fill polygon (jar-local px) for a fill fraction, wave phase and vortex depth. Pure. */
export function blenderFillPolygon(progress: number, phase: number, vortex: number, segments = 16): Vec2[] {
  const p = Math.min(1, Math.max(0, progress));
  if (p <= 0) return [];
  const [tl, tr, br, bl] = L.jarInterior as [Vec2, Vec2, Vec2, Vec2];
  const top = tl.y + 10; // leave headroom under the rim
  const bottom = bl.y;
  const level = bottom - p * (bottom - top);
  const xAt = (y: number, left: boolean) => {
    const t = (y - tl.y) / (bl.y - tl.y);
    return left ? tl.x + (bl.x - tl.x) * t : tr.x + (br.x - tr.x) * t;
  };
  const x0 = xAt(level, true);
  const x1 = xAt(level, false);
  const amp = 1.5 + 2.5 * vortex;
  const surface: Vec2[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const x = x0 + (x1 - x0) * u;
    const dip = vortex * 14 * p * (1 - (2 * u - 1) ** 2);
    const y = Math.min(bottom, level + amp * Math.sin(phase + u * Math.PI * 3) + dip);
    surface.push({ x, y });
  }
  return [...surface, { x: br.x, y: bottom }, { x: bl.x, y: bottom }];
}

/**
 * The jar's glass body and rim in jar.svg px (its `M14 16 H130 L108 196 H36 Z`
 * path and `rect x=10 y=10 w=124 h=10`); test/render/blueprint.test.ts pins
 * these against the SVG so the outline cannot drift from the art.
 */
export const JAR_GLASS_OUTLINE: readonly Vec2[] = [
  { x: 14, y: 16 },
  { x: 130, y: 16 },
  { x: 108, y: 196 },
  { x: 36, y: 196 },
];
export const JAR_RIM = { x: 10, y: 10, width: 124, height: 10 } as const;
/** Opacity of the jar outline strokes (B1 audit-1: the contrast test composites at this alpha). */
export const JAR_OUTLINE_ALPHA = 1;

/** Drafting-style linework over the jar (jar-local px, positioned like the jar sprite). */
function jarOutline(color: number): Graphics {
  const g = new Graphics();
  g.label = 'blender-outline';
  g.position.set(L.jar.x, L.jar.y);
  g.poly(JAR_GLASS_OUTLINE.flatMap((p) => [p.x, p.y]))
    .stroke({ color, width: 3, alpha: JAR_OUTLINE_ALPHA, join: 'round' })
    .roundRect(JAR_RIM.x, JAR_RIM.y, JAR_RIM.width, JAR_RIM.height, 4)
    .stroke({ color, width: 2, alpha: JAR_OUTLINE_ALPHA });
  return g;
}

export class BlenderView {
  readonly view = new Container();
  /** 0..1 piña-colada level. */
  progress = 0;
  /** 0..1 motor speed. */
  whir = 0;
  private readonly body = new Container();
  private readonly fill = new Graphics();
  private readonly blades: Sprite;
  private phase = 0;
  private bladePhase = 0;
  private time = 0;

  /** B1: ink outline over the jar's glass edge, or null (theme.goalOutline unset). */
  readonly outline: Graphics | null;

  constructor(
    textures: TextureProvider,
    private readonly fillColor = 0xfff1c9,
    outlineColor: number | null = null,
  ) {
    const sprite = (id: string, x: number, y: number) => {
      const s = new Sprite(textures.texture(id));
      s.position.set(x, y);
      return s;
    };
    const base = sprite(ART.blender.base.id, L.base.x, L.base.y);
    const jar = sprite(ART.blender.jar.id, L.jar.x, L.jar.y);
    const lid = sprite(ART.blender.lid.id, L.lid.x, L.lid.y);
    this.blades = sprite(ART.blender.blades.id, L.blades.x, L.blades.y);
    this.blades.anchor.set(L.blades.hubX / this.blades.texture.width, L.blades.hubY / this.blades.texture.height);
    this.fill.position.set(L.jar.x, L.jar.y);
    this.outline = outlineColor === null ? null : jarOutline(outlineColor);
    // the outline sits over the glass, under the lid (the lid covers the rim's top)
    this.body.addChild(base, this.fill, this.blades, jar, ...(this.outline ? [this.outline] : []), lid);
    this.view.addChild(this.body);
    this.redrawFill();
  }

  update(dt: number): void {
    const d = Math.min(Math.max(dt, 0), 0.1);
    this.time += d;
    this.phase += d * (2 + 10 * this.whir);
    this.bladePhase += d * (1.5 + 38 * this.whir);
    const c = Math.cos(this.bladePhase);
    this.blades.scale.x = Math.sign(c || 1) * Math.max(0.12, Math.abs(c));
    // motor shake (px), subtle
    const shake = this.whir * 1.2;
    this.body.position.set(Math.sin(this.time * 71) * shake, Math.cos(this.time * 53) * shake * 0.6);
    this.redrawFill();
  }

  private redrawFill(): void {
    const poly = blenderFillPolygon(this.progress, this.phase, this.whir);
    const g = this.fill;
    g.clear();
    if (poly.length === 0) return;
    g.poly(poly.flatMap((p) => [p.x, p.y])).fill({ color: this.fillColor });
    // foam band + a pineapple-yellow tint toward the bottom
    const surface = poly.slice(0, -2);
    const foam = [...surface, ...surface.map((p) => ({ x: p.x, y: p.y + 5 })).reverse()];
    g.poly(foam.flatMap((p) => [p.x, p.y])).fill({ color: 0xffffff, alpha: 0.7 });
    const bottom = poly[poly.length - 1]!.y;
    const lvl = Math.min(...surface.map((p) => p.y));
    const band = Math.min(40, (bottom - lvl) * 0.5);
    if (band > 2) {
      const [, , br, bl] = L.jarInterior as [Vec2, Vec2, Vec2, Vec2];
      g.poly([bl.x, bottom - band, br.x, bottom - band, br.x, bottom, bl.x, bottom]).fill({ color: 0xffd35c, alpha: 0.25 });
    }
    // bubbles
    for (let i = 0; i < 5; i++) {
      const y = bottom - (((this.time * (12 + i * 5) + i * 37) % 1000) / 1000) * (bottom - lvl);
      const x = 52 + ((i * 29) % 44);
      if (y > lvl + 4) g.circle(x, y, 1.5 + (i % 3)).fill({ color: 0xffffff, alpha: 0.55 });
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
