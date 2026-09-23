import { describe, expect, it } from 'vitest';
import { resolveAttachments, type AttachmentError } from '../../src/model/attach';
import type { CartDesign, CartPart } from '../../src/model/cart';
import { validateCartDesign } from '../../src/model/validate';
import { BUILD_AREA } from '../../src/builder/constants';
import { EXAMPLE_CART, exampleCart } from '../../src/builder/exampleCart';
import { describeErrors, highlightMap, partLabels } from '../../src/builder/messages';
import { buildPreview } from '../../src/builder/preview';
import { fitView, designToScreen, screenToDesign, zoomAbout } from '../../src/builder/view';

const P = (x: number, y: number) => ({ x, y });

describe('Example Cart fixture', () => {
  it('passes model/validate unchanged', () => {
    const v = validateCartDesign(JSON.parse(JSON.stringify(EXAMPLE_CART)));
    expect(v.ok && v.value).toEqual(EXAMPLE_CART);
  });

  it('resolves with zero errors', () => {
    const spec = resolveAttachments(exampleCart());
    expect(spec.errors).toEqual([]);
    expect(spec.valid).toBe(true);
  });

  it('matches the original: 2-line bed + end rails weld into one chassis, two 25 px wheels, four shocks (two per wheel)', () => {
    const d = exampleCart();
    const spec = resolveAttachments(d);
    const rigid = spec.bodies.filter((b) => b.kind === 'rigid');
    expect(rigid).toHaveLength(1);
    expect(rigid[0]!.partIds).toEqual(['bed-l', 'bed-r', 'rail-l', 'rail-l-top', 'rail-r', 'rail-r-top']);
    const wheels = d.parts.filter((p): p is Extract<CartPart, { kind: 'wheel' }> => p.kind === 'wheel');
    expect(wheels.map((w) => w.radius)).toEqual([25, 25]);
    const dist = spec.joints.filter((j) => j.type === 'distance');
    expect(dist).toHaveLength(4);
    for (const w of wheels) {
      const wb = spec.partBody.get(w.id)!;
      expect(dist.filter((j) => j.bodyA === wb || j.bodyB === wb)).toHaveLength(2);
      // wheels hang from shocks (not pinned), like the original sample
      expect(spec.wheelPins.get(w.id)).toBeNull();
    }
    for (const [, ends] of spec.shockEnds) {
      expect([ends.a.snapped, ends.b.snapped].filter(Boolean)).toHaveLength(1);
    }
  });

  it('fits inside the build area with the wheels resting on the ground line (y = 0)', () => {
    for (const p of exampleCart().parts) {
      const pts =
        p.kind === 'wheel' || p.kind === 'lime'
          ? [P(p.center.x - p.radius, p.center.y - p.radius), P(p.center.x + p.radius, p.center.y + p.radius)]
          : p.kind === 'cube'
            ? [p.center]
            : [p.a, p.b];
      for (const q of pts) {
        expect(q.x).toBeGreaterThanOrEqual(BUILD_AREA.minX);
        expect(q.x).toBeLessThanOrEqual(BUILD_AREA.maxX);
        expect(q.y).toBeGreaterThanOrEqual(BUILD_AREA.minY);
        expect(q.y).toBeLessThanOrEqual(BUILD_AREA.maxY);
      }
    }
  });
});

describe('live preview (derived from resolveAttachments)', () => {
  it('welded parts share a group; separate bodies get different groups', () => {
    const pv = buildPreview(exampleCart());
    const chassis = pv.groupOf.get('bed-l');
    expect(pv.groupOf.get('rail-r-top')).toBe(chassis);
    expect(pv.groupOf.get('wheel-l')).not.toBe(chassis);
    expect(pv.groupOf.get('wheel-l')).not.toBe(pv.groupOf.get('wheel-r'));
    expect(pv.weldedGroups).toBe(1);
    expect(pv.messages).toEqual([]);
  });

  it('shock ends: snapped to a wheel centre, attached to a part, or floating', () => {
    const d: CartDesign = {
      version: 1,
      parts: [
        { id: 's', kind: 'straw', a: P(0, -50), b: P(100, -50) },
        { id: 'w', kind: 'wheel', center: P(50, -20), radius: 15 },
        { id: 'k', kind: 'shock', a: P(20, -50), b: P(56, -24) },
        { id: 'f', kind: 'shock', a: P(20, -50), b: P(200, -150) },
      ],
    };
    const pv = buildPreview(d);
    const k = pv.shocks.find((s) => s.partId === 'k')!;
    expect(k.a.state).toBe('attached');
    expect(k.b.state).toBe('snapped');
    expect(k.b.point).toEqual(P(50, -20));
    expect(k.b.group).toBe(pv.groupOf.get('w'));
    const f = pv.shocks.find((s) => s.partId === 'f')!;
    expect(f.b.state).toBe('floating');
    expect(f.b.group).toBe(-1);
    expect(pv.errorParts.has('f')).toBe(true);
    expect(pv.messages.map((m) => m.code)).toEqual(['floatingShock']);
  });

  it('wheel pin markers follow wheelPins (topmost part under the centre)', () => {
    const d: CartDesign = {
      version: 1,
      parts: [
        { id: 'a', kind: 'straw', a: P(0, -50), b: P(100, -50) },
        { id: 'b', kind: 'cube', center: P(50, -50), width: 20, height: 20, angle: 0 },
        { id: 'w', kind: 'wheel', center: P(50, -50), radius: 20 },
        { id: 'free', kind: 'wheel', center: P(250, -50), radius: 20 },
      ],
    };
    const pv = buildPreview(d);
    expect(pv.pins).toEqual([
      { wheelId: 'w', center: P(50, -50), pinnedTo: 'b', group: pv.groupOf.get('b') },
      { wheelId: 'free', center: P(250, -50), pinnedTo: null, group: -1 },
    ]);
  });

  it('shockSameBody is flagged', () => {
    const d: CartDesign = {
      version: 1,
      parts: [
        { id: 'a', kind: 'straw', a: P(0, -50), b: P(100, -50) },
        { id: 'w', kind: 'wheel', center: P(0, -50), radius: 20 },
        { id: 'k', kind: 'shock', a: P(30, -50), b: P(90, -50) },
      ],
    };
    const pv = buildPreview(d);
    expect(pv.shocks[0]!.sameBody).toBe(true);
    expect(pv.messages.map((m) => m.code)).toContain('shockSameBody');
  });
});

describe('validation messages', () => {
  const d: CartDesign = {
    version: 1,
    parts: [
      { id: 'a', kind: 'straw', a: P(0, 0), b: P(3, 0) },
      { id: 'b', kind: 'cube', center: P(50, 0), width: 5, height: 20, angle: 0 },
      { id: 'c', kind: 'shock', a: P(0, 0), b: P(20, 0) },
    ],
  };

  it('labels parts per kind in draw order', () => {
    expect([...partLabels(d).values()]).toEqual(['Straw 1', 'Sugar cube 1', 'Coil spring 1']);
  });

  it('has readable text for every code in the closed error union', () => {
    const all: AttachmentError[] = [
      { code: 'noWheels' },
      { code: 'floatingShock', partId: 'c', ends: ['a', 'b'] },
      { code: 'disconnectedIslands', islands: [['a'], ['b', 'c'], ['x', 'y', 'z']] },
      { code: 'shockSameBody', partId: 'c' },
      { code: 'partTooSmall', partId: 'a' },
      { code: 'partTooSmall', partId: 'b' },
    ];
    const msgs = describeErrors(d, all);
    expect(msgs.map((m) => m.code)).toEqual(all.map((e) => e.code));
    expect(msgs[0]!.text).toMatch(/missing wheels/);
    expect(msgs[1]!.text).toMatch(/^Coil spring 1: Both ends are loose/);
    expect(msgs[2]!.text).toMatch(/3 separate pieces/);
    // every island is highlighted; largest first (dim tone 0), detached pieces bright 1, 2, ...
    expect(msgs[2]!.partIds).toEqual(['x', 'y', 'z', 'b', 'c', 'a']);
    expect(msgs[2]!.islands).toEqual([['x', 'y', 'z'], ['b', 'c'], ['a']]);
    expect([...highlightMap(msgs[2]!)]).toEqual([
      ['x', 0], ['y', 0], ['z', 0], ['b', 1], ['c', 1], ['a', 2],
    ]);
    expect([...highlightMap(msgs[1]!)]).toEqual([['c', 1]]);
    expect(msgs[3]!.text).toMatch(/connects a piece to itself/);
    expect(msgs[4]!.text).toMatch(/Straw 1 is too small \(minimum 5 px\)/);
    expect(msgs[5]!.text).toMatch(/Sugar cube 1 is too small \(minimum 7 px\)/);
    for (const m of msgs) expect(m.text.length).toBeGreaterThan(10);
  });
});

describe('view transform', () => {
  it('design <-> screen round-trips', () => {
    const v = { scale: 2, offsetX: 10, offsetY: -5 };
    const p = P(12.5, -40);
    expect(screenToDesign(designToScreen(p, v), v)).toEqual(p);
  });

  it('zoomAbout keeps the anchor point fixed and clamps zoom', () => {
    const v = { scale: 1, offsetX: 0, offsetY: 0 };
    const z = zoomAbout(v, 2, P(100, 100));
    expect(designToScreen(P(100, 100), z)).toEqual(P(100, 100));
    expect(z.scale).toBe(2);
    expect(zoomAbout(v, 1000, P(0, 0)).scale).toBe(6);
    expect(zoomAbout(v, NaN, P(0, 0)).scale).toBe(1);
    const pan = zoomAbout(v, 1, P(0, 0), P(30, -20));
    expect(pan).toEqual({ scale: 1, offsetX: 30, offsetY: -20 });
  });

  it('fitView fits the build area into an ~800x400 landscape phone beside the palette', () => {
    const v = fitView(BUILD_AREA, 800, 400, 200);
    const tl = designToScreen(P(BUILD_AREA.minX, BUILD_AREA.minY), v);
    const br = designToScreen(P(BUILD_AREA.maxX, BUILD_AREA.maxY), v);
    expect(tl.x).toBeGreaterThanOrEqual(0);
    expect(tl.y).toBeGreaterThanOrEqual(0);
    expect(br.x).toBeLessThanOrEqual(600);
    expect(br.y).toBeLessThanOrEqual(400);
  });
});
