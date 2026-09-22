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

  constructor(
    textures: TextureProvider,
    private readonly fillColor = 0xfff1c9,
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
    this.body.addChild(base, this.fill, this.blades, jar, lid);
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
