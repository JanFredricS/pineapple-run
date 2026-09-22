/**
 * World <-> screen coordinate helpers (part of S0 contract 4).
 *
 * World: metres, y-down (gravity +y). Design/screen: pixels, y-down.
 * Engine scale is the original's 30 px = 1 m at camera zoom 1.
 */

import type { Vec2 } from './geometry';

export const PX_PER_M = 30;

export const mToPx = (m: number): number => m * PX_PER_M;
export const pxToM = (px: number): number => px / PX_PER_M;
export const vecMToPx = (v: Vec2): Vec2 => ({ x: v.x * PX_PER_M, y: v.y * PX_PER_M });
export const vecPxToM = (v: Vec2): Vec2 => ({ x: v.x / PX_PER_M, y: v.y / PX_PER_M });

/**
 * A 2D camera: `center` is the world point (metres) shown at the middle of the
 * viewport; `zoom` multiplies the base 30 px/m scale; viewport is in CSS px.
 */
export interface Camera {
  center: Vec2;
  zoom: number;
  viewportWidth: number;
  viewportHeight: number;
}

export function pixelsPerMetre(camera: Camera): number {
  return PX_PER_M * camera.zoom;
}

export function worldToScreen(p: Vec2, camera: Camera): Vec2 {
  const k = pixelsPerMetre(camera);
  return {
    x: (p.x - camera.center.x) * k + camera.viewportWidth / 2,
    y: (p.y - camera.center.y) * k + camera.viewportHeight / 2,
  };
}

export function screenToWorld(p: Vec2, camera: Camera): Vec2 {
  const k = pixelsPerMetre(camera);
  return {
    x: (p.x - camera.viewportWidth / 2) / k + camera.center.x,
    y: (p.y - camera.viewportHeight / 2) / k + camera.center.y,
  };
}

/** Container transform (for Pixi or Canvas): screen = world * scale + offset. */
export function cameraTransform(camera: Camera): { scale: number; offsetX: number; offsetY: number } {
  const k = pixelsPerMetre(camera);
  return {
    scale: k,
    offsetX: camera.viewportWidth / 2 - camera.center.x * k,
    offsetY: camera.viewportHeight / 2 - camera.center.y * k,
  };
}
