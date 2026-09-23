/**
 * S9 census zone handling (tools/levels/census.ts header, ZONE HAZARDS):
 * a zone counts as a hazard only when it is strong enough and reaches the
 * driving corridor; zone hazards break dull stretches like terrain hazards;
 * and Zero-G Tiki Bar passes the premade audit both with and without the
 * zone credit (the zones are not what carries it over the line).
 */
import { describe, expect, it } from 'vitest';
import { plateauRange } from '../../src/game/startArea';
import type { LevelDef, ZoneDef } from '../../src/model/level';
import { auditLevel, census, PREMADE_RULES, ZONE_CORRIDOR_HEIGHT, type Census, type CensusLabel } from '../../tools/levels/census';
import { PREMADE } from '../../tools/levels/premade';
import { Track, type AuthoredLevel } from '../../tools/levels/track';
import { targetSpeed } from '../integration/driver';

function premadeCensus(a: AuthoredLevel, level: LevelDef = a.level, labels: readonly CensusLabel[] = a.features): Census {
  return census(level, { x0: plateauRange(level.cartStart).maxX, x1: level.goal.lineX }, (x) => targetSpeed(a.pace, x), {
    labels,
    keepSharp: a.features.filter((f) => f.kind === 'washboard'),
  });
}

/** A flat road at y = 10 (ground), 200 m long after the plateau. */
function road(): AuthoredLevel {
  const t = new Track(0, 10);
  t.speed(7).flat(16, 'plateau').flat(200).finish();
  return t.build({ id: 'road', name: 'Road', theme: 'beach' });
}

const withZones = (a: AuthoredLevel, zones: ZoneDef[]): LevelDef => ({ ...a.level, zones });
const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('census: zone hazards', () => {
  it('strong zones on the road count as lowGravity / shooter / beads', () => {
    const a = road();
    const c = premadeCensus(a, withZones(a, [
      { id: 'g', kind: 'gravity', rect: rect(60, 4, 10, 6.5), gravityScale: 0.3 },
      { id: 'f', kind: 'force', rect: rect(100, 5, 6, 5.5), force: { x: 2, y: -16 } },
      { id: 'b', kind: 'beads', rect: rect(140, 9, 8, 1) },
    ]));
    expect(c.hazards).toEqual({ lowGravity: 1, shooter: 1, beads: 1 });
  });

  it('zones that are too weak, too small or out of the driving corridor do not count', () => {
    const a = road();
    const c = premadeCensus(a, withZones(a, [
      { id: 'mild', kind: 'gravity', rect: rect(40, 4, 10, 6.5), gravityScale: 0.8 },
      { id: 'breeze', kind: 'force', rect: rect(60, 4, 10, 6.5), force: { x: 2, y: -2 } },
      { id: 'puddle', kind: 'beads', rect: rect(80, 9.9, 8, 0.1) },
      { id: 'sliver', kind: 'beads', rect: rect(90, 9, 1, 1) },
      // entirely above the corridor: its bottom is ZONE_CORRIDOR_HEIGHT + 0.5 above the road
      { id: 'sky', kind: 'gravity', rect: rect(120, 10 - ZONE_CORRIDOR_HEIGHT - 0.5 - 2, 10, 2), gravityScale: 0.1 },
      // past the finish
      { id: 'late', kind: 'force', rect: rect(10_000, 4, 10, 6.5), force: { x: 0, y: -16 } },
    ]));
    expect(c.hazardCount).toBe(0);
  });

  it('a zone just reaching the corridor counts (the band is inclusive)', () => {
    const a = road();
    const c = premadeCensus(a, withZones(a, [{ id: 'edge', kind: 'gravity', rect: rect(120, 10 - ZONE_CORRIDOR_HEIGHT - 2, 10, 2), gravityScale: 0.1 }]));
    expect(c.hazards).toEqual({ lowGravity: 1 });
  });

  it('zone hazards break dull stretches like terrain hazards', () => {
    const a = road();
    const plain = premadeCensus(a);
    const zoned = premadeCensus(a, withZones(a, [{ id: 'g', kind: 'gravity', rect: rect(110, 4, 10, 6.5), gravityScale: 0.3 }]));
    expect(zoned.longestDullSeconds).toBeLessThan(plain.longestDullSeconds * 0.7);
  });
});

describe('census: Zero-G Tiki Bar', () => {
  const a = PREMADE.tikibar();

  it('credits each of its three zones once and passes the premade audit', () => {
    const c = premadeCensus(a);
    expect(c.hazards.lowGravity).toBe(1);
    expect(c.hazards.shooter).toBe(1);
    expect(c.hazards.beads).toBe(1);
    expect(auditLevel(c, PREMADE_RULES)).toEqual([]);
  });

  it('also passes with NO zone credit: the terrain alone meets every premade rule', () => {
    // the zone labels go too (they would be unconfirmed without their zones)
    const terrainLabels = a.features.filter((f) => !['lowGravity', 'shooter', 'beads'].includes(f.kind));
    expect(terrainLabels.length).toBe(a.features.length - 3);
    const c = premadeCensus(a, { ...a.level, zones: [] }, terrainLabels);
    expect(c.hazards.lowGravity ?? 0).toBe(0);
    expect(auditLevel(c, PREMADE_RULES)).toEqual([]);
  });
});
