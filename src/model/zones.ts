/**
 * Zone rules (S9 exotic physics) as pure functions, shared by the physics
 * side (src/run/zones.ts) and the renderer (src/render/scene.ts), which only
 * ever sees a zone as a manifest body (role 'zone') whose partIds carry the
 * tag written here.
 *
 * Membership is decided by Box2D sensors (a body is in a zone while any of
 * its sensor-visitor shapes overlaps the zone's sensor rectangle); these
 * functions turn a membership set into what the body feels:
 *   - gravity scale = the LOWEST gravityScale of the gravity zones it is in
 *     (1 when in none), so overlapping pockets never compound;
 *   - acceleration  = the SUM of the force zones' vectors it is in (a force
 *     of mass × that is applied before every step).
 * Both are order-independent, so they depend only on the membership SET.
 */

import type { Vec2 } from './geometry';
import type { Rect, ZoneDef } from './level';

/** Zone kinds that act on bodies through a sensor (bead zones are furniture, not fields). */
export type FieldZone = ZoneDef & { kind: 'gravity' | 'force' };

export function isFieldZone(z: ZoneDef): z is FieldZone {
  return z.kind === 'gravity' || z.kind === 'force';
}

export function gravityScaleOf(zones: Iterable<ZoneDef>): number {
  let s = 1;
  let any = false;
  for (const z of zones) {
    if (z.kind !== 'gravity') continue;
    const g = z.gravityScale ?? 1;
    s = any ? Math.min(s, g) : g;
    any = true;
  }
  return any ? s : 1;
}

export function accelerationOf(zones: Iterable<ZoneDef>): Vec2 {
  let x = 0;
  let y = 0;
  for (const z of zones) {
    if (z.kind !== 'force' || !z.force) continue;
    x += z.force.x;
    y += z.force.y;
  }
  return { x, y };
}

/** Rect corners, clockwise from top-left, relative to its centre (body-local sensor box). */
export function rectLocalBox(r: Rect): Vec2[] {
  const hw = r.width / 2;
  const hh = r.height / 2;
  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
}

export function rectCentre(r: Rect): Vec2 {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** What the renderer needs to draw a field zone. */
export type ZoneLook = { kind: 'gravity'; gravityScale: number } | { kind: 'force'; force: Vec2 };

const TAG = 'zone';

/** The zone body's partIds (manifest): ['zone', kind, params…] — the renderer's only zone input. */
export function zoneTag(z: FieldZone): string[] {
  return z.kind === 'gravity' ? [TAG, 'gravity', String(z.gravityScale ?? 1)] : [TAG, 'force', String(z.force?.x ?? 0), String(z.force?.y ?? 0)];
}

/** Inverse of zoneTag; null for anything else. */
export function parseZoneTag(partIds: readonly string[] | undefined): ZoneLook | null {
  if (!partIds || partIds[0] !== TAG) return null;
  const num = (i: number) => {
    const v = Number(partIds[i]);
    return Number.isFinite(v) ? v : null;
  };
  if (partIds[1] === 'gravity' && partIds.length === 3) {
    const g = num(2);
    return g === null ? null : { kind: 'gravity', gravityScale: g };
  }
  if (partIds[1] === 'force' && partIds.length === 4) {
    const x = num(2);
    const y = num(3);
    return x === null || y === null ? null : { kind: 'force', force: { x, y } };
  }
  return null;
}
