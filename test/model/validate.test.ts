import { describe, expect, it } from 'vitest';
import {
  migrateDocument,
  parseCartDesign,
  parseLevelDef,
  validateCartDesign,
  validateLevelDef,
} from '../../src/model/validate';
import { MAX_PARTS } from '../../src/model/cart';
import spikeLevelJson from '../../src/spike/spike-level.json';
import spikeCartJson from '../../src/spike/spike-cart.json';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('validateCartDesign', () => {
  it('accepts the spike cart and returns a normalised copy', () => {
    const r = validateCartDesign({ ...clone(spikeCartJson), junk: 42 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.parts).toHaveLength(16);
      expect('junk' in r.value).toBe(false);
    }
  });

  it('rejects invalid JSON text', () => {
    const r = parseCartDesign('{not json');
    expect(r).toMatchObject({ ok: false, error: { code: 'invalidJson' } });
  });

  it('rejects non-objects', () => {
    expect(validateCartDesign([])).toMatchObject({ ok: false, error: { code: 'notObject' } });
    expect(validateCartDesign(null)).toMatchObject({ ok: false, error: { code: 'notObject' } });
  });

  it('rejects missing/garbage versions', () => {
    expect(validateCartDesign({ parts: [] })).toMatchObject({ ok: false, error: { code: 'missingVersion' } });
    expect(validateCartDesign({ version: '1', parts: [] })).toMatchObject({ ok: false, error: { code: 'missingVersion' } });
    expect(validateCartDesign({ version: 1.5, parts: [] })).toMatchObject({ ok: false, error: { code: 'missingVersion' } });
  });

  it('rejects future versions with a recoverable, human-readable error', () => {
    const r = validateCartDesign({ version: 99, parts: [] });
    expect(r).toMatchObject({ ok: false, error: { code: 'futureVersion', path: 'version' } });
    if (!r.ok) expect(r.error.message).toMatch(/newer version/);
  });

  it('rejects versions with no migration path', () => {
    expect(validateCartDesign({ version: 0, parts: [] })).toMatchObject({ ok: false, error: { code: 'unsupportedVersion' } });
  });

  it.each([
    ['unknown kind', { id: 'x', kind: 'rocket' }, 'parts[0].kind'],
    ['NaN coordinate', { id: 'x', kind: 'straw', a: { x: NaN, y: 0 }, b: { x: 1, y: 1 } }, 'parts[0].a.x'],
    ['missing end', { id: 'x', kind: 'shock', a: { x: 0, y: 0 } }, 'parts[0].b'],
    ['negative radius', { id: 'x', kind: 'wheel', center: { x: 0, y: 0 }, radius: -3 }, 'parts[0].radius'],
    ['zero cube width', { id: 'x', kind: 'cube', center: { x: 0, y: 0 }, width: 0, height: 5, angle: 0 }, 'parts[0].width'],
    ['empty id', { id: '', kind: 'lime', center: { x: 0, y: 0 }, radius: 5 }, 'parts[0].id'],
    ['huge coordinate', { id: 'x', kind: 'lime', center: { x: 1e12, y: 0 }, radius: 5 }, 'parts[0].center.x'],
  ])('rejects %s', (_name, part, path) => {
    const r = validateCartDesign({ version: 1, parts: [part] });
    expect(r).toMatchObject({ ok: false, error: { code: 'schema', path } });
  });

  it('rejects duplicate part ids', () => {
    const p = { id: 'dup', kind: 'lime', center: { x: 0, y: 0 }, radius: 5 };
    expect(validateCartDesign({ version: 1, parts: [p, p] })).toMatchObject({ ok: false, error: { code: 'schema', path: 'parts[1].id' } });
  });

  it('rejects designs over the part cap', () => {
    const parts = Array.from({ length: MAX_PARTS + 1 }, (_, i) => ({ id: `p${i}`, kind: 'lime', center: { x: i, y: 0 }, radius: 5 }));
    expect(validateCartDesign({ version: 1, parts })).toMatchObject({ ok: false, error: { code: 'schema', path: 'parts' } });
  });

  it('defaults a missing cube angle to 0', () => {
    const r = validateCartDesign({ version: 1, parts: [{ id: 'c', kind: 'cube', center: { x: 0, y: 0 }, width: 10, height: 10 }] });
    expect(r.ok && r.value.parts[0]).toMatchObject({ angle: 0 });
  });
});

describe('migrateDocument', () => {
  it('runs migrations in order and reports migratedFrom', () => {
    const table = {
      1: (d: Record<string, unknown>) => ({ ...d, version: 2, a: 1 }),
      2: (d: Record<string, unknown>) => ({ ...d, version: 3, b: 2 }),
    };
    const r = migrateDocument({ version: 1 }, 3, table, 'Doc');
    expect(r).toEqual({ ok: true, value: { version: 3, a: 1, b: 2 }, migratedFrom: 1 });
  });

  it('fails if a migration does not produce the next version', () => {
    const table = { 1: (d: Record<string, unknown>) => ({ ...d }) };
    expect(migrateDocument({ version: 1 }, 2, table, 'Doc')).toMatchObject({ ok: false, error: { code: 'unsupportedVersion' } });
  });

  it('passes current-version documents through untouched', () => {
    expect(migrateDocument({ version: 2, x: 1 }, 2, {}, 'Doc')).toEqual({ ok: true, value: { version: 2, x: 1 } });
  });
});

describe('validateLevelDef', () => {
  it('accepts the spike level with terrain spans', () => {
    const r = validateLevelDef(clone(spikeLevelJson));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.terrain.spans.map((s) => s.id)).toEqual(['left-wall', 'main', 'right-wall']);
      expect(r.value.theme).toBe('test');
    }
  });

  it('round-trips through JSON text', () => {
    expect(parseLevelDef(JSON.stringify(spikeLevelJson)).ok).toBe(true);
  });

  it('defaults terrain material to the original (0.9 / 0.3)', () => {
    const lvl = clone(spikeLevelJson) as Record<string, any>;
    delete lvl.terrain.friction;
    delete lvl.terrain.restitution;
    const r = validateLevelDef(lvl);
    expect(r.ok && r.value.terrain).toMatchObject({ friction: 0.9, restitution: 0.3 });
  });

  it('supports gaps: spans that do not touch are valid', () => {
    const lvl = clone(spikeLevelJson) as Record<string, any>;
    lvl.terrain.spans = [
      { id: 'a', points: [{ x: 0, y: 10 }, { x: 10, y: 10 }] },
      { id: 'b', points: [{ x: 14, y: 10 }, { x: 30, y: 10 }] },
    ];
    expect(validateLevelDef(lvl).ok).toBe(true);
  });

  it('rejects spans whose x does not strictly increase', () => {
    const lvl = clone(spikeLevelJson) as Record<string, any>;
    lvl.terrain.spans = [{ id: 'a', points: [{ x: 0, y: 10 }, { x: 0, y: 5 }] }];
    expect(validateLevelDef(lvl)).toMatchObject({ ok: false, error: { code: 'schema', path: 'terrain.spans[0].points[1].x' } });
  });

  it('rejects overlapping / out-of-order spans', () => {
    const lvl = clone(spikeLevelJson) as Record<string, any>;
    lvl.terrain.spans = [
      { id: 'a', points: [{ x: 0, y: 10 }, { x: 10, y: 10 }] },
      { id: 'b', points: [{ x: 5, y: 10 }, { x: 30, y: 10 }] },
    ];
    expect(validateLevelDef(lvl)).toMatchObject({ ok: false, error: { code: 'schema', path: 'terrain.spans[1]' } });
  });

  it('rejects single-point spans, empty terrain, bad themes, bad zones', () => {
    const base = () => clone(spikeLevelJson) as Record<string, any>;
    const a = base();
    a.terrain.spans = [{ id: 'a', points: [{ x: 0, y: 0 }] }];
    expect(validateLevelDef(a).ok).toBe(false);
    const b = base();
    b.terrain.spans = [];
    expect(validateLevelDef(b).ok).toBe(false);
    const c = base();
    c.theme = 'space';
    expect(validateLevelDef(c)).toMatchObject({ ok: false, error: { path: 'theme' } });
    const d = base();
    d.zones = [{ id: 'z', kind: 'antigravity', rect: { x: 0, y: 0, width: 1, height: 1 } }];
    expect(validateLevelDef(d)).toMatchObject({ ok: false, error: { path: 'zones[0].kind' } });
  });

  it('accepts gravity and force zones', () => {
    const lvl = clone(spikeLevelJson) as Record<string, any>;
    lvl.zones = [
      { id: 'low', kind: 'gravity', rect: { x: 10, y: 0, width: 5, height: 10 }, gravityScale: 0.2 },
      { id: 'shoot', kind: 'force', rect: { x: 20, y: 0, width: 5, height: 10 }, force: { x: 5, y: -20 } },
    ];
    const r = validateLevelDef(lvl);
    expect(r.ok && r.value.zones).toHaveLength(2);
  });

  it('rejects future level versions', () => {
    expect(validateLevelDef({ ...clone(spikeLevelJson), version: 2 })).toMatchObject({ ok: false, error: { code: 'futureVersion' } });
  });
});
