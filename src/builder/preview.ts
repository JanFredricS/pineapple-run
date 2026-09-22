/**
 * Live weld/attachment preview model (pure). Everything here is DERIVED from
 * `resolveAttachments` — the builder never decides on its own what welds,
 * what a wheel pins to, or where a shock end attaches.
 */

import { resolveAttachments, type CompoundSpec, type ShockEndResolution } from '../model/attach';
import type { CartDesign, CartPart } from '../model/cart';
import type { Vec2 } from '../model/geometry';
import { describeErrors, type ErrorMessage } from './messages';

export type ShockEndState = 'snapped' | 'attached' | 'floating';

export interface PreviewShockEnd {
  point: Vec2;
  state: ShockEndState;
  /** Group colour index of the body this end attaches to (-1 floating). */
  group: number;
}

export interface PreviewShock {
  partId: string;
  a: PreviewShockEnd;
  b: PreviewShockEnd;
  /** Both ends on the same body (shockSameBody). */
  sameBody: boolean;
}

export interface PreviewPin {
  wheelId: string;
  center: Vec2;
  /** Part the wheel is pinned to, or null for a free wheel. */
  pinnedTo: string | null;
  /** Group colour index of the body it is pinned to (-1 when free). */
  group: number;
}

export interface PreviewModel {
  design: CartDesign;
  spec: CompoundSpec;
  /**
   * partId -> weld-group colour index. Every rigid body (welded group) gets
   * its own index in body order; wheels get the index of their own body too.
   */
  groupOf: Map<string, number>;
  /** Number of distinct weld groups (rigid bodies with 2+ parts are "welded"). */
  weldedGroups: number;
  pins: PreviewPin[];
  shocks: PreviewShock[];
  /** Parts named by any validation error (drawn with an error outline). */
  errorParts: Set<string>;
  messages: ErrorMessage[];
}

export function buildPreview(design: CartDesign): PreviewModel {
  const spec = resolveAttachments(design);
  const bodyIndex = new Map(spec.bodies.map((b, i) => [b.id, i]));
  const groupOf = new Map<string, number>();
  for (const [partId, bodyId] of spec.partBody) groupOf.set(partId, bodyIndex.get(bodyId) ?? -1);

  const byId = new Map<string, CartPart>(design.parts.map((p) => [p.id, p]));
  const pins: PreviewPin[] = [];
  for (const [wheelId, target] of spec.wheelPins) {
    const w = byId.get(wheelId);
    if (!w || w.kind !== 'wheel') continue;
    pins.push({ wheelId, center: w.center, pinnedTo: target, group: target ? (groupOf.get(target) ?? -1) : -1 });
  }

  const end = (r: ShockEndResolution): PreviewShockEnd => ({
    point: r.point,
    state: r.bodyId === null ? 'floating' : r.snapped ? 'snapped' : 'attached',
    group: r.bodyId === null ? -1 : (bodyIndex.get(r.bodyId) ?? -1),
  });
  const shocks: PreviewShock[] = [];
  for (const [partId, ends] of spec.shockEnds) {
    shocks.push({
      partId,
      a: end(ends.a),
      b: end(ends.b),
      sameBody: ends.a.bodyId !== null && ends.a.bodyId === ends.b.bodyId,
    });
  }

  const messages = describeErrors(design, spec.errors);
  const errorParts = new Set<string>();
  for (const e of spec.errors) {
    if ('partId' in e) errorParts.add(e.partId);
  }

  return {
    design,
    spec,
    groupOf,
    weldedGroups: spec.bodies.filter((b) => b.kind === 'rigid' && b.partIds.length > 1).length,
    pins,
    shocks,
    errorParts,
    messages,
  };
}
