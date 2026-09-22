/**
 * Builder canvas renderer (Pixi v8). Draws the mock start area and the live
 * weld/attachment preview. Every attachment fact it shows (weld groups, wheel
 * pins, shock end snapping, error parts) comes from a PreviewModel, i.e. from
 * resolveAttachments — shapes are the contract's own `partShapePx`.
 *
 * Colours come from CSS custom properties on the builder root (napkin-sketch
 * theming hook), read once per `setTheme`.
 */

import { Container, Graphics } from 'pixi.js';
import { partShapePx } from '../model/attach';
import type { CartPart } from '../model/cart';
import type { Vec2 } from '../model/geometry';
import { BUILD_AREA, MOCK_FUNNEL } from './constants';
import type { PreviewModel } from './preview';
import { screenToDesign, type BuilderView } from './view';

export interface BuilderTheme {
  grid: string;
  gridMajor: string;
  area: string;
  ground: string;
  groundFill: string;
  ink: string;
  wheel: string;
  wheelRim: string;
  shock: string;
  error: string;
  hover: string;
  groups: string[];
  /** Bright outlines for detached pieces (cycled) when an islands error is hovered. */
  islands: string[];
}

export const DEFAULT_THEME: BuilderTheme = {
  grid: '#dfe7ef',
  gridMajor: '#c7d3df',
  area: '#7a8aa0',
  ground: '#8a7560',
  groundFill: '#e9dfd2',
  ink: '#34495e',
  wheel: '#9aa4b1',
  wheelRim: '#4b5563',
  shock: '#616a7c',
  error: '#d62839',
  hover: '#ff8c00',
  groups: ['#5aa9e6', '#7fc8a9', '#f4a259', '#b388eb', '#e5989b', '#ffd166'],
  islands: ['#d62839', '#7b2cbf', '#0077b6'],
};

/** Read theme overrides from CSS custom properties (--pr-canvas-*). */
export function themeFromCss(el: Element): BuilderTheme {
  const cs = getComputedStyle(el);
  const get = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const t = DEFAULT_THEME;
  const groups = t.groups.map((g, i) => get(`--pr-canvas-group-${i}`, g));
  return {
    grid: get('--pr-canvas-grid', t.grid),
    gridMajor: get('--pr-canvas-grid-major', t.gridMajor),
    area: get('--pr-canvas-area', t.area),
    ground: get('--pr-canvas-ground', t.ground),
    groundFill: get('--pr-canvas-ground-fill', t.groundFill),
    ink: get('--pr-canvas-ink', t.ink),
    wheel: get('--pr-canvas-wheel', t.wheel),
    wheelRim: get('--pr-canvas-wheel-rim', t.wheelRim),
    shock: get('--pr-canvas-shock', t.shock),
    error: get('--pr-canvas-error', t.error),
    hover: get('--pr-canvas-hover', t.hover),
    groups,
    islands: t.islands.map((c, i) => get(`--pr-canvas-island-${i}`, c)),
  };
}

/**
 * The real level start area (S6, INTEGRATION #6), in design px (design
 * (0, 0) = LevelDef.cartStart). Without one the builder draws its mock
 * start area (flat ground + MOCK_FUNNEL).
 */
export interface StartAreaPx {
  /** Funnel wall quads + plug quad (S1 funnelGeometry, converted to design px). */
  funnel: { walls: readonly (readonly Vec2[])[]; plug: readonly Vec2[] };
  /** Terrain surface polylines near the start (design px); ground fill is drawn below them. */
  ground: readonly (readonly Vec2[])[];
}

export interface RenderOverlay {
  /** Id of the in-progress (draft) part inside `model.design`, if any. */
  draftId?: string | null;
  draftTooSmall?: boolean;
  /** Part under the delete tool. */
  hoverId?: string | null;
  /**
   * Parts highlighted from the error panel -> tone: 0 = dim (the main piece of
   * a disconnected cart), 1.. = bright, one colour per detached piece.
   */
  highlight?: ReadonlyMap<string, number>;
}

export class BuilderRenderer {
  readonly view = new Container();
  private readonly bg = new Graphics();
  private readonly world = new Container();
  private readonly partsG = new Graphics();
  private readonly markersG = new Graphics();
  private theme: BuilderTheme = DEFAULT_THEME;
  private startArea: StartAreaPx | null = null;

  constructor() {
    this.world.addChild(this.partsG, this.markersG);
    this.view.addChild(this.bg, this.world);
  }

  setTheme(theme: BuilderTheme): void {
    this.theme = theme;
  }

  /** Draw the real level start area instead of the mock (null = mock). */
  setStartArea(area: StartAreaPx | null): void {
    this.startArea = area;
  }

  draw(model: PreviewModel, overlay: RenderOverlay, v: BuilderView, viewportW: number, viewportH: number): void {
    this.world.scale.set(v.scale);
    this.world.position.set(v.offsetX, v.offsetY);
    this.drawBackground(v, viewportW, viewportH);
    this.drawParts(model, overlay, v.scale);
  }

  private groupColor(i: number | undefined): string {
    const g = this.theme.groups;
    return i === undefined || i < 0 ? this.theme.ink : g[i % g.length]!;
  }

  private drawBackground(v: BuilderView, w: number, h: number): void {
    const t = this.theme;
    const g = this.bg;
    g.clear();
    // Graph-paper grid in design px (10 px minor, 50 px major), screen space.
    const tl = screenToDesign({ x: 0, y: 0 }, v);
    const br = screenToDesign({ x: w, y: h }, v);
    const minor = v.scale * 10 >= 6 ? 10 : 50;
    const line = (x0: number, y0: number, x1: number, y1: number, color: string) =>
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 1, color, alpha: 0.9 });
    for (let x = Math.floor(tl.x / minor) * minor; x <= br.x; x += minor) {
      const sx = Math.round(x * v.scale + v.offsetX) + 0.5;
      line(sx, 0, sx, h, x % 50 === 0 ? t.gridMajor : t.grid);
    }
    for (let y = Math.floor(tl.y / minor) * minor; y <= br.y; y += minor) {
      const sy = Math.round(y * v.scale + v.offsetY) + 0.5;
      line(0, sy, w, sy, y % 50 === 0 ? t.gridMajor : t.grid);
    }
    const S = (p: Vec2) => ({ x: p.x * v.scale + v.offsetX, y: p.y * v.scale + v.offsetY });
    const sa = this.startArea;
    if (sa && sa.ground.length) {
      // Real terrain near the start: fill below each polyline, then its edge.
      for (const line of sa.ground) {
        if (line.length < 2) continue;
        const pts = line.map(S);
        const first = pts[0]!;
        const last = pts[pts.length - 1]!;
        g.poly([...pts.flatMap((p) => [p.x, p.y]), last.x, h, first.x, h], true).fill({ color: t.groundFill, alpha: 0.8 });
        g.moveTo(first.x, first.y);
        for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
        g.stroke({ width: 2, color: t.ground });
      }
    } else {
      // Ground (design y = 0) with a filled "terrain" below it.
      const gy = S({ x: 0, y: 0 }).y;
      g.rect(0, gy, w, Math.max(0, h - gy)).fill({ color: t.groundFill, alpha: 0.8 });
      g.moveTo(0, gy).lineTo(w, gy).stroke({ width: 2, color: t.ground });
    }
    // Build area outline.
    const a0 = S({ x: BUILD_AREA.minX, y: BUILD_AREA.minY });
    const a1 = S({ x: BUILD_AREA.maxX, y: BUILD_AREA.maxY });
    g.rect(a0.x, a0.y, a1.x - a0.x, a1.y - a0.y).stroke({ width: 1.5, color: t.area, alpha: 0.7 });
    if (sa) {
      // The level's real funnel (walls + plug) above the area.
      for (const wall of sa.funnel.walls) g.poly(wall.map(S).flatMap((p) => [p.x, p.y]), true).fill({ color: t.area, alpha: 0.35 }).stroke({ width: 2, color: t.area });
      g.poly(sa.funnel.plug.map(S).flatMap((p) => [p.x, p.y]), true).fill({ color: t.ground, alpha: 0.8 });
      return;
    }
    // Mock funnel above the area.
    const f = MOCK_FUNNEL;
    const p = [
      S({ x: f.x - f.topWidth / 2, y: f.y - f.height }),
      S({ x: f.x - f.bottomWidth / 2, y: f.y }),
      S({ x: f.x + f.bottomWidth / 2, y: f.y }),
      S({ x: f.x + f.topWidth / 2, y: f.y - f.height }),
    ];
    g.moveTo(p[0]!.x, p[0]!.y).lineTo(p[1]!.x, p[1]!.y).stroke({ width: 2, color: t.area });
    g.moveTo(p[2]!.x, p[2]!.y).lineTo(p[3]!.x, p[3]!.y).stroke({ width: 2, color: t.area });
    g.moveTo(p[1]!.x, p[1]!.y).lineTo(p[2]!.x, p[2]!.y).stroke({ width: 3, color: t.ground });
  }

  private drawParts(model: PreviewModel, overlay: RenderOverlay, scale: number): void {
    const t = this.theme;
    const g = this.partsG;
    const m = this.markersG;
    g.clear();
    m.clear();
    const px = 1 / scale; // one screen pixel in design px
    const highlight = overlay.highlight ?? new Map<string, number>();

    const outline = (part: CartPart): { color: string; width: number; alpha: number } | null => {
      if (part.id === overlay.hoverId) return { color: t.hover, width: 3 * px, alpha: 1 };
      if (part.id === overlay.draftId && overlay.draftTooSmall) return { color: t.error, width: 2 * px, alpha: 1 };
      const tone = highlight.get(part.id);
      if (tone === 0) return { color: t.ink, width: 2.5 * px, alpha: 0.75 };
      if (tone !== undefined) return { color: t.islands[(tone - 1) % t.islands.length] ?? t.error, width: 3.5 * px, alpha: 1 };
      if (model.errorParts.has(part.id)) return { color: t.error, width: 2 * px, alpha: 1 };
      return null;
    };

    // Solid parts first (draw order), shocks on top so they stay visible.
    for (const part of model.design.parts) {
      if (part.kind === 'shock') continue;
      const alpha = part.id === overlay.draftId ? 0.6 : 1;
      const color = this.groupColor(model.groupOf.get(part.id));
      const shape = partShapePx(part);
      const ol = outline(part);
      if (part.kind === 'wheel') {
        const { center: c, radius: r } = part;
        g.circle(c.x, c.y, r).fill({ color: t.wheel, alpha: 0.85 * alpha }).stroke({ width: Math.max(2 * px, r * 0.12), color: t.wheelRim, alpha });
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          g.moveTo(c.x, c.y).lineTo(c.x + Math.cos(a) * r * 0.8, c.y + Math.sin(a) * r * 0.8).stroke({ width: 1.5 * px, color: t.wheelRim, alpha });
        }
      } else if (shape.type === 'circle') {
        // lime wheel: group-coloured slice with wedge lines
        const { center: c, radius: r } = shape;
        g.circle(c.x, c.y, r).fill({ color, alpha: 0.45 * alpha }).stroke({ width: 1.5 * px, color, alpha });
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          g.moveTo(c.x, c.y).lineTo(c.x + Math.cos(a) * r * 0.85, c.y + Math.sin(a) * r * 0.85).stroke({ width: 1 * px, color, alpha: 0.7 * alpha });
        }
      } else {
        const pts = shape.vertices.flatMap((p) => [p.x, p.y]);
        g.poly(pts, true).fill({ color, alpha: 0.55 * alpha }).stroke({ width: 1.5 * px, color, alpha });
      }
      if (ol) {
        if (shape.type === 'circle') g.circle(shape.center.x, shape.center.y, shape.radius + ol.width / 2).stroke(ol);
        else g.poly(shape.vertices.flatMap((p) => [p.x, p.y]), true).stroke(ol);
      }
    }

    // Wheel pin markers (before shock ends, so a snapped end stays visible).
    for (const pin of model.pins) {
      const c = pin.center;
      if (pin.pinnedTo) {
        m.circle(c.x, c.y, 5 * px).fill({ color: '#ffffff' }).stroke({ width: 2.5 * px, color: this.groupColor(pin.group) });
        m.circle(c.x, c.y, 1.8 * px).fill({ color: t.ink });
      } else {
        m.circle(c.x, c.y, 3.5 * px).fill({ color: t.wheelRim });
      }
    }

    // Shocks: drawn between their RESOLVED (possibly snapped) end points.
    const byId = new Map(model.design.parts.map((p) => [p.id, p]));
    for (const s of model.shocks) {
      const part = byId.get(s.partId);
      if (!part || part.kind !== 'shock') continue;
      const alpha = part.id === overlay.draftId ? 0.7 : 1;
      const ol = outline(part);
      const bad = s.sameBody || s.a.state === 'floating' || s.b.state === 'floating';
      const color = bad ? t.error : t.shock;
      if (ol) g.moveTo(s.a.point.x, s.a.point.y).lineTo(s.b.point.x, s.b.point.y).stroke({ width: ol.width + 6 * px, color: ol.color, alpha: 0.5 * ol.alpha });
      this.spring(g, s.a.point, s.b.point, color, px, alpha);
      // raw drag point -> snapped centre (so the snap is visible)
      for (const [raw, end] of [
        [part.a, s.a],
        [part.b, s.b],
      ] as const) {
        if (end.state === 'snapped' && (raw.x !== end.point.x || raw.y !== end.point.y)) {
          g.moveTo(raw.x, raw.y).lineTo(end.point.x, end.point.y).stroke({ width: 1 * px, color: t.shock, alpha: 0.5 });
        }
      }
      for (const end of [s.a, s.b]) this.shockEndMarker(m, end.point, end.state, this.groupColor(end.group), px);
    }
  }

  /** Umbrella-shock spring: zig-zag between the ends, straight caps. */
  private spring(g: Graphics, a: Vec2, b: Vec2, color: string, px: number, alpha: number): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const cap = Math.min(len * 0.2, 8);
    const coils = Math.max(3, Math.min(10, Math.floor((len - 2 * cap) / 6)));
    const amp = Math.min(4, len * 0.08);
    g.moveTo(a.x, a.y).lineTo(a.x + ux * cap, a.y + uy * cap);
    for (let i = 1; i <= coils * 2; i++) {
      const tt = cap + ((len - 2 * cap) * i) / (coils * 2);
      const side = i === coils * 2 ? 0 : i % 2 ? 1 : -1;
      g.lineTo(a.x + ux * tt + nx * amp * side, a.y + uy * tt + ny * amp * side);
    }
    g.lineTo(b.x, b.y).stroke({ width: Math.max(1.5 * px, 1.2), color, alpha });
  }

  private shockEndMarker(m: Graphics, p: Vec2, state: 'snapped' | 'attached' | 'floating', color: string, px: number): void {
    const t = this.theme;
    if (state === 'floating') {
      const r = 5 * px;
      m.moveTo(p.x - r, p.y - r).lineTo(p.x + r, p.y + r).moveTo(p.x + r, p.y - r).lineTo(p.x - r, p.y + r).stroke({ width: 2.5 * px, color: t.error });
    } else if (state === 'snapped') {
      m.circle(p.x, p.y, 4 * px).fill({ color }).stroke({ width: 1.5 * px, color: t.ink });
    } else {
      m.circle(p.x, p.y, 4 * px).fill({ color: '#ffffff' }).stroke({ width: 2 * px, color });
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
