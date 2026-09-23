/**
 * Snapshot -> sprite pose math (pure; no Pixi). Everything the scene needs to
 * place art from the S0 render contract: body transforms applied to local
 * shapes, rectangle recovery from polygon vertices, circle-fit sprite
 * placement, part-kind classification and shock (coil spring) endpoints from a
 * resolved CompoundSpec.
 */

import type { CompoundSpec, DistanceJointSpec, ShapeSpec } from '../model/attach';
import type { CartDesign, PartKind } from '../model/cart';
import { STRAW_THICKNESS_PX } from '../model/cart';
import { PX_PER_M } from '../model/coords';
import type { Vec2 } from '../model/geometry';
import type { BodyTransform, RenderBodyInfo, SceneManifest } from '../model/snapshot';
import type { CircleFit } from './artCatalog';

/** Body-local point -> world point. */
export function applyTransform(t: Pick<BodyTransform, 'x' | 'y' | 'angle'>, p: Vec2): Vec2 {
  const c = Math.cos(t.angle);
  const s = Math.sin(t.angle);
  return { x: t.x + c * p.x - s * p.y, y: t.y + s * p.x + c * p.y };
}

/** World point -> body-local point. */
export function inverseTransform(t: Pick<BodyTransform, 'x' | 'y' | 'angle'>, p: Vec2): Vec2 {
  const c = Math.cos(t.angle);
  const s = Math.sin(t.angle);
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  return { x: c * dx + s * dy, y: -s * dx + c * dy };
}

/** A rectangle recovered from 4 vertices: centre, full width along the first edge, height, angle of the first edge. */
export interface BoxPose {
  center: Vec2;
  width: number;
  height: number;
  angle: number;
}

/**
 * Recover centre/size/angle of an oriented rectangle from its 4 vertices in
 * order (as produced by model/geometry `orientedBox`/`thickSegment`).
 * Normalised so width >= height (the long axis is the angle's direction) —
 * a straw's texture always runs along its length.
 */
export function boxFromPolygon(vertices: readonly Vec2[]): BoxPose {
  if (vertices.length !== 4) throw new Error(`expected 4 vertices, got ${vertices.length}`);
  const [a, b, c, d] = vertices as [Vec2, Vec2, Vec2, Vec2];
  const center = { x: (a.x + b.x + c.x + d.x) / 4, y: (a.y + b.y + c.y + d.y) / 4 };
  const e0 = { x: b.x - a.x, y: b.y - a.y };
  const e1 = { x: c.x - b.x, y: c.y - b.y };
  const l0 = Math.hypot(e0.x, e0.y);
  const l1 = Math.hypot(e1.x, e1.y);
  if (l0 >= l1) return { center, width: l0, height: l1, angle: Math.atan2(e0.y, e0.x) };
  return { center, width: l1, height: l0, angle: Math.atan2(e1.y, e1.x) };
}

/** Body-local box pose -> world pose. */
export function worldBox(t: BodyTransform, box: BoxPose): BoxPose {
  return { center: applyTransform(t, box.center), width: box.width, height: box.height, angle: t.angle + box.angle };
}

export interface SpritePose {
  /** World position of the sprite's anchor. */
  x: number;
  y: number;
  rotation: number;
  /** Uniform scale: world metres per texture design px. */
  scale: number;
  /** Anchor (0..1) inside the texture. */
  anchorX: number;
  anchorY: number;
}

/**
 * Place a texture so that its `fit` circle (texture px) coincides with a
 * collision circle (body-local centre + radius, metres) under body transform
 * `t`. The sprite rotates with the body about the collision centre — which
 * is what makes an oval pineapple roll "right" around its circle collider.
 */
export function circleSpritePose(
  t: BodyTransform,
  shape: { center: Vec2; radius: number },
  fit: CircleFit,
  texture: { width: number; height: number },
): SpritePose {
  const c = applyTransform(t, shape.center);
  return {
    x: c.x,
    y: c.y,
    rotation: t.angle,
    scale: shape.radius / fit.r,
    anchorX: fit.cx / texture.width,
    anchorY: fit.cy / texture.height,
  };
}

/** Metres per design px at camera zoom 1. */
export const M_PER_PX = 1 / PX_PER_M;

/** How a shape should be drawn. */
export type ShapeArt = 'straw' | 'cube' | 'lime' | 'wheel' | 'pineapple' | 'unknown-circle' | 'unknown-polygon';

const STRAW_THICKNESS_M = STRAW_THICKNESS_PX / PX_PER_M;

/**
 * Decide the art for one manifest shape. Uses the cart design's part kinds
 * when known; otherwise falls back to geometry (circles on wheel bodies are
 * caps, other circles limes; boxes as thin as a straw are straws).
 */
export function classifyShape(body: RenderBodyInfo, shape: ShapeSpec, kinds?: ReadonlyMap<string, PartKind>): ShapeArt {
  if (body.role === 'pineapple') return 'pineapple';
  const known = kinds?.get(shape.partId);
  if (known === 'straw' || known === 'cube' || known === 'lime' || known === 'wheel') return known;
  if (shape.type === 'circle') {
    if (body.role === 'wheel') return 'wheel';
    if (body.role === 'cart') return 'lime';
    return 'unknown-circle';
  }
  if (body.role !== 'cart' || shape.vertices.length !== 4) return 'unknown-polygon';
  const box = boxFromPolygon(shape.vertices);
  return box.height <= STRAW_THICKNESS_M * 1.05 ? 'straw' : 'cube';
}

/** partId -> kind for a design (for classifyShape). */
export function partKinds(design: CartDesign | null | undefined): Map<string, PartKind> {
  return new Map((design?.parts ?? []).map((p) => [p.id, p.kind]));
}

export interface ShockBinding {
  partId: string;
  /** Manifest body ids each end is attached to. */
  bodyA: number;
  bodyB: number;
  /** Anchors in each body's local frame (metres). */
  localA: Vec2;
  localB: Vec2;
  restLength: number;
}

/**
 * Bind every distance joint (coil-spring shock) of a resolved design to manifest
 * bodies. Spec bodies are created unrotated at `start + origin`
 * (physics/compound.ts), so a design-frame anchor becomes body-local by
 * subtracting the body origin. Manifest bodies are matched by part ids —
 * shocks whose bodies aren't (yet) in the manifest are skipped.
 */
export function bindShocks(spec: CompoundSpec, manifest: SceneManifest): ShockBinding[] {
  const byPart = new Map<string, RenderBodyInfo>();
  for (const b of manifest.bodies) for (const pid of b.partIds ?? []) byPart.set(pid, b);
  const specBody = new Map(spec.bodies.map((b) => [b.id, b]));
  const out: ShockBinding[] = [];
  for (const j of spec.joints) {
    if (j.type !== 'distance') continue;
    const sa = specBody.get(j.bodyA);
    const sb = specBody.get(j.bodyB);
    const ma = sa && byPart.get(sa.partIds[0]!);
    const mb = sb && byPart.get(sb.partIds[0]!);
    if (!sa || !sb || !ma || !mb) continue;
    out.push({
      partId: j.partId,
      bodyA: ma.id,
      bodyB: mb.id,
      localA: { x: j.anchorA.x - sa.origin.x, y: j.anchorA.y - sa.origin.y },
      localB: { x: j.anchorB.x - sb.origin.x, y: j.anchorB.y - sb.origin.y },
      restLength: (j as DistanceJointSpec).length,
    });
  }
  return out;
}

export interface ShockPose {
  a: Vec2;
  b: Vec2;
  length: number;
  angle: number;
  /** length / rest length (1 = at rest, < 1 compressed). */
  ratio: number;
}

export function shockPose(binding: ShockBinding, ta: BodyTransform, tb: BodyTransform): ShockPose {
  const a = applyTransform(ta, binding.localA);
  const b = applyTransform(tb, binding.localB);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return {
    a,
    b,
    length,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
    ratio: binding.restLength > 1e-9 ? length / binding.restLength : 1,
  };
}

export type CanopyFrame = 'open' | 'half' | 'closed';

/**
 * Shock art frame from spring compression: compressed -> 'open' (tight coil;
 * the frame names date from the old umbrella art), extended -> 'closed'
 * (open coil). Also returns a continuous spread factor for smooth
 * scaling between the three frames.
 */
export function canopyFor(ratio: number): { frame: CanopyFrame; spread: number } {
  const r = Number.isFinite(ratio) ? ratio : 1;
  // spread: 1 = fully open at <= 0.8, 0 = closed at >= 1.2
  const spread = Math.min(1, Math.max(0, (1.2 - r) / 0.4));
  const frame: CanopyFrame = spread > 0.66 ? 'open' : spread < 0.33 ? 'closed' : 'half';
  return { frame, spread };
}
