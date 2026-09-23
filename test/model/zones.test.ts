/**
 * S9 zone rules (src/model/zones.ts) and the zone schema (model/validate).
 */
import { describe, expect, it } from 'vitest';
import { MAX_BEAD_ZONES, MAX_ZONE_FORCE, type ZoneDef } from '../../src/model/level';
import { validateLevelDef } from '../../src/model/validate';
import { accelerationOf, gravityScaleOf, isFieldZone, parseZoneTag, rectCentre, rectLocalBox, zoneTag, type FieldZone } from '../../src/model/zones';
import { PREMADE } from '../../tools/levels/premade';

const R = { x: 10, y: 2, width: 4, height: 6 };
const low = (id: string, gravityScale: number): FieldZone => ({ id, kind: 'gravity', rect: R, gravityScale });
const push = (id: string, x: number, y: number): FieldZone => ({ id, kind: 'force', rect: R, force: { x, y } });

describe('zone rules', () => {
  it('gravity scale: 1 outside, the LOWEST scale when pockets overlap (never compounded)', () => {
    expect(gravityScaleOf([])).toBe(1);
    expect(gravityScaleOf([low('a', 0.3)])).toBe(0.3);
    expect(gravityScaleOf([low('a', 0.3), low('b', 0.5)])).toBe(0.3);
    expect(gravityScaleOf([low('b', 0.5), low('a', 0.3)])).toBe(0.3);
    expect(gravityScaleOf([push('f', 0, -10)])).toBe(1);
  });

  it('acceleration: the SUM of the force zones, order-independent; gravity zones add nothing', () => {
    expect(accelerationOf([])).toEqual({ x: 0, y: 0 });
    expect(accelerationOf([push('f', 2, -16), low('a', 0.3), push('g', 1, 4)])).toEqual({ x: 3, y: -12 });
    expect(accelerationOf([push('g', 1, 4), push('f', 2, -16)])).toEqual({ x: 3, y: -12 });
  });

  it('field zones are gravity/force only; bead zones are furniture', () => {
    expect(isFieldZone(low('a', 0.3))).toBe(true);
    expect(isFieldZone(push('f', 0, -1))).toBe(true);
    expect(isFieldZone({ id: 'b', kind: 'beads', rect: R })).toBe(false);
  });

  it('rect helpers: centre and a body-local box around it', () => {
    expect(rectCentre(R)).toEqual({ x: 12, y: 5 });
    expect(rectLocalBox(R)).toEqual([
      { x: -2, y: -3 },
      { x: 2, y: -3 },
      { x: 2, y: 3 },
      { x: -2, y: 3 },
    ]);
  });

  it('the zone tag (the renderer\'s only zone input) round-trips; anything else parses to null', () => {
    expect(parseZoneTag(zoneTag(low('a', 0.3)))).toEqual({ kind: 'gravity', gravityScale: 0.3 });
    expect(parseZoneTag(zoneTag(push('f', 2, -16)))).toEqual({ kind: 'force', force: { x: 2, y: -16 } });
    for (const bad of [undefined, [], ['cube'], ['zone'], ['zone', 'gravity'], ['zone', 'gravity', 'x'], ['zone', 'force', '1'], ['zone', 'beads', '1']]) {
      expect(parseZoneTag(bad)).toBeNull();
    }
  });
});

describe('zone schema', () => {
  const base = () => JSON.parse(JSON.stringify(PREMADE.beach().level)) as Record<string, unknown>;
  const withZones = (zones: unknown[]) => validateLevelDef({ ...base(), zones });

  it('accepts beads zones (rect only)', () => {
    const r = withZones([{ id: 'b', kind: 'beads', rect: { x: 50, y: 8, width: 10, height: 1 } }]);
    expect(r.ok && r.value.zones).toEqual([{ id: 'b', kind: 'beads', rect: { x: 50, y: 8, width: 10, height: 1 } }]);
  });

  it(`caps force zones at ${MAX_ZONE_FORCE} m/s² and bead zones at ${MAX_BEAD_ZONES} per level`, () => {
    const f = (x: number, y: number) => ({ id: 'f', kind: 'force', rect: R, force: { x, y } });
    expect(withZones([f(0, -MAX_ZONE_FORCE)]).ok).toBe(true);
    expect(withZones([f(MAX_ZONE_FORCE, 1)])).toMatchObject({ ok: false, error: { path: 'zones[0].force' } });
    const beads = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, kind: 'beads', rect: { x: 50 + 20 * i, y: 8, width: 10, height: 1 } }));
    expect(withZones(beads(MAX_BEAD_ZONES)).ok).toBe(true);
    expect(withZones(beads(MAX_BEAD_ZONES + 1))).toMatchObject({ ok: false, error: { path: 'zones' } });
  });

  it('shipped tikibar zones validate and every shipped pre-S9 level has none', () => {
    const t = PREMADE.tikibar().level;
    const r = validateLevelDef(JSON.parse(JSON.stringify(t)));
    expect(r.ok && r.value.zones.map((z: ZoneDef) => z.kind)).toEqual(['gravity', 'force', 'beads']);
    for (const id of ['beach', 'kitchen', 'workbench'] as const) expect(PREMADE[id]().level.zones).toEqual([]);
  });
});
