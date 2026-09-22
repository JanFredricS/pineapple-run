/**
 * Builder view transform (pure): screen = design * scale + offset.
 * Screen coordinates are CSS px relative to the canvas' top-left.
 */

import type { Vec2 } from '../model/geometry';
import { MAX_ZOOM, MIN_ZOOM, type Area } from './constants';

export interface BuilderView {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export const designToScreen = (p: Vec2, v: BuilderView): Vec2 => ({ x: p.x * v.scale + v.offsetX, y: p.y * v.scale + v.offsetY });
export const screenToDesign = (p: Vec2, v: BuilderView): Vec2 => ({ x: (p.x - v.offsetX) / v.scale, y: (p.y - v.offsetY) / v.scale });

const clampZoom = (s: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s));

/**
 * Scale by `factor` so that the design point under screen point `from` ends up
 * under screen point `to` (pinch: from = previous midpoint, to = new midpoint;
 * wheel zoom: from = to = cursor; pan: factor 1).
 */
export function zoomAbout(v: BuilderView, factor: number, from: Vec2, to: Vec2 = from): BuilderView {
  if (!Number.isFinite(factor) || factor <= 0) factor = 1;
  const anchor = screenToDesign(from, v);
  const scale = clampZoom(v.scale * factor);
  return { scale, offsetX: to.x - anchor.x * scale, offsetY: to.y - anchor.y * scale };
}

/**
 * Fit `area` (plus `margin` design px on every side) into the viewport,
 * leaving `reserveRight` screen px free on the right for the tool palette.
 */
export function fitView(area: Area, viewportW: number, viewportH: number, reserveRight = 0, margin = 40): BuilderView {
  const w = Math.max(1, viewportW - reserveRight);
  const h = Math.max(1, viewportH);
  const aw = area.maxX - area.minX + 2 * margin;
  const ah = area.maxY - area.minY + 2 * margin;
  const scale = clampZoom(Math.min(w / aw, h / ah));
  const cx = (area.minX + area.maxX) / 2;
  const cy = (area.minY + area.maxY) / 2;
  return { scale, offsetX: w / 2 - cx * scale, offsetY: h / 2 - cy * scale };
}

/** Top clearance kept above the funnel's highest point when fitting (design px). */
export const FUNNEL_FIT_CLEARANCE = 12;

/**
 * The area the builder's Fit frames: the build area plus the whole start-area
 * funnel (every wall and plug vertex, with a small clearance above its top),
 * so entering a course's builder shows the full funnel over the build area.
 * Without a real start area the mock funnel's bottom is included (S2 default).
 */
export function fitArea(
  build: Area,
  startArea?: { funnel: { walls: readonly (readonly Vec2[])[]; plug: readonly Vec2[] } },
  mockFunnelY = -250,
): Area {
  if (!startArea) return { ...build, minY: Math.min(build.minY, mockFunnelY - 10) };
  const pts = [...startArea.funnel.walls.flat(), ...startArea.funnel.plug];
  if (!pts.length) return { ...build };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    minX: Math.min(build.minX, ...xs),
    maxX: Math.max(build.maxX, ...xs),
    minY: Math.min(build.minY, Math.min(...ys) - FUNNEL_FIT_CLEARANCE),
    maxY: Math.max(build.maxY, ...ys),
  };
}
