import { describe, expect, it } from 'vitest';
import { resolveAttachments } from '../../src/model/attach';
import { deletePart, type CartDesign, type CartPart } from '../../src/model/cart';
import { loadSpikeCart } from '../../src/spike/data';

const straw = (id: string, ax: number, ay: number, bx: number, by: number): CartPart => ({
  id,
  kind: 'straw',
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
});
const wheel = (id: string, x: number, y: number, r = 20): CartPart => ({ id, kind: 'wheel', center: { x, y }, radius: r });
const lime = (id: string, x: number, y: number, r = 15): CartPart => ({ id, kind: 'lime', center: { x, y }, radius: r });
const cube = (id: string, x: number, y: number, w = 20, h = 20, angle = 0): CartPart => ({
  id,
  kind: 'cube',
  center: { x, y },
  width: w,
  height: h,
  angle,
});
const shock = (id: string, ax: number, ay: number, bx: number, by: number): CartPart => ({
  id,
  kind: 'shock',
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
});
const design = (...parts: CartPart[]): CartDesign => ({ version: 1, parts });
const codes = (d: CartDesign) => resolveAttachments(d).errors.map((e) => e.code).sort();

describe('resolveAttachments — welding', () => {
  it('welds overlapping straws into one body with several shapes', () => {
    const spec = resolveAttachments(design(straw('a', 0, 0, 100, 0), straw('b', 50, -40, 50, 40), wheel('w', 0, 0)));
    const rigid = spec.bodies.filter((b) => b.kind === 'rigid');
    expect(rigid).toHaveLength(1);
    expect(rigid[0]!.partIds).toEqual(['a', 'b']);
    expect(rigid[0]!.shapes).toHaveLength(2);
    expect(spec.partBody.a).toBe(spec.partBody.b);
  });

  it('welds straws that only share an endpoint (straw ends are capped by thickness)', () => {
    const spec = resolveAttachments(design(straw('a', 0, 0, 100, 0), straw('b', 100, 0, 100, 60)));
    expect(spec.bodies).toHaveLength(1);
  });

  it('keeps separated parts as separate bodies', () => {
    const spec = resolveAttachments(design(straw('a', 0, 0, 100, 0), straw('b', 0, 20, 100, 20)));
    expect(spec.bodies).toHaveLength(2);
  });

  it('welding is transitive (a-b, b-c => one body even if a and c never touch)', () => {
    const spec = resolveAttachments(design(straw('a', 0, 0, 50, 0), straw('b', 50, 0, 100, 0), straw('c', 100, 0, 150, 0)));
    expect(spec.bodies).toHaveLength(1);
    expect(spec.bodies[0]!.partIds).toEqual(['a', 'b', 'c']);
  });

  it('welds cubes and limes with straws', () => {
    const spec = resolveAttachments(design(straw('a', 0, 0, 100, 0), cube('c', 100, 0), lime('l', 0, 10)));
    expect(spec.bodies).toHaveLength(1);
    expect(spec.bodies[0]!.shapes.map((s) => s.type).sort()).toEqual(['circle', 'polygon', 'polygon']);
  });

  it('respects rotated cubes (SAT, not AABB)', () => {
    // A 45° cube whose AABB overlaps the straw but whose shape does not.
    const d = design(straw('a', 0, 0, 100, 0), cube('c', 118, -18, 20, 20, Math.PI / 4));
    expect(resolveAttachments(d).bodies).toHaveLength(2);
    const d2 = design(straw('a', 0, 0, 100, 0), cube('c', 108, -8, 20, 20, Math.PI / 4));
    expect(resolveAttachments(d2).bodies).toHaveLength(1);
  });

  it('never welds wheels, even when overlapping', () => {
    const spec = resolveAttachments(design(straw('a', 0, 0, 100, 0), wheel('w', 50, 5)));
    expect(spec.bodies).toHaveLength(2);
    expect(spec.bodies.find((b) => b.kind === 'wheel')!.partIds).toEqual(['w']);
  });

  it('outputs metres (30 px = 1 m) with shapes relative to the body origin', () => {
    const spec = resolveAttachments(design(wheel('w', 60, 30, 15)));
    const b = spec.bodies[0]!;
    expect(b.origin).toEqual({ x: 2, y: 1 });
    expect(b.shapes[0]).toMatchObject({ type: 'circle', center: { x: 0, y: 0 }, radius: 0.5 });
  });
});

describe('resolveAttachments — wheel pinning', () => {
  it('pins a wheel whose centre is over a part (revolute at the wheel centre)', () => {
    const spec = resolveAttachments(design(straw('a', 0, 0, 90, 0), wheel('w', 30, 0)));
    expect(spec.wheelPins.w).toBe('a');
    const j = spec.joints.find((j) => j.type === 'revolute')!;
    expect(j).toMatchObject({ type: 'revolute', partId: 'w', bodyA: 'body:a', bodyB: 'body:w', anchor: { x: 1, y: 0 } });
  });

  it('pins to the TOPMOST (most recently drawn) overlapped part', () => {
    // Two separate straws crossing the wheel centre; the later one wins.
    const d = design(straw('under', -50, 0, 50, 0), cube('top', 100, 0, 30, 30), wheel('w', 0, 0), straw('over', 0, -50, 0, 50));
    // 'under' and 'over' cross at the wheel centre -> they weld, but the pin
    // target part must be the most recent one.
    expect(resolveAttachments(d).wheelPins.w).toBe('over');
  });

  it('topmost considers parts drawn after the wheel too', () => {
    const d = design(straw('a', -50, 0, 50, 0), wheel('w', 0, 0), lime('l', 0, 0, 10));
    expect(resolveAttachments(d).wheelPins.w).toBe('l');
  });

  it('can pin a wheel to another wheel', () => {
    const d = design(straw('a', -50, 0, 50, 0), wheel('big', 0, 0, 30), wheel('small', 10, 10, 8));
    const spec = resolveAttachments(d);
    expect(spec.wheelPins.small).toBe('big');
    expect(spec.valid).toBe(true);
  });

  it('a wheel over nothing is a free body (no pin)', () => {
    const spec = resolveAttachments(design(straw('a', 0, 0, 90, 0), wheel('w', 300, 300)));
    expect(spec.wheelPins.w).toBeNull();
    expect(spec.joints).toHaveLength(0);
  });
});

describe('resolveAttachments — shocks', () => {
  it('snaps an end within 10 px of a wheel centre to that centre', () => {
    const d = design(straw('a', 0, 0, 100, 0), wheel('w', 200, 100), shock('s', 50, 0, 207, 106));
    const spec = resolveAttachments(d);
    expect(spec.shockEnds.s!.b).toMatchObject({ point: { x: 200, y: 100 }, partId: 'w', snapped: true });
    const j = spec.joints.find((j) => j.type === 'distance')!;
    expect(j).toMatchObject({ bodyA: 'body:a', bodyB: 'body:w' });
  });

  it('snaps to lime centres too', () => {
    const d = design(straw('a', 0, 0, 100, 0), lime('l', 200, 100), wheel('w', 50, 0), shock('s', 50, 0, 195, 95));
    expect(resolveAttachments(d).shockEnds.s!.b.partId).toBe('l');
  });

  it('does not snap beyond 10 px; attaches to the topmost overlapped part instead', () => {
    const d = design(straw('a', 0, 0, 100, 0), cube('big', 200, 100, 60, 60), wheel('w', 200, 100, 8), shock('s', 50, 0, 215, 100));
    const end = resolveAttachments(d).shockEnds.s!.b;
    expect(end.snapped).toBe(false);
    expect(end.partId).toBe('big');
    expect(end.point).toEqual({ x: 215, y: 100 });
  });

  it('nearest snap target wins', () => {
    const d = design(straw('a', 0, 0, 100, 0), wheel('w1', 200, 100, 8), wheel('w2', 212, 100, 8), shock('s', 50, 0, 209, 100));
    expect(resolveAttachments(d).shockEnds.s!.b.partId).toBe('w2');
  });

  it('equal-distance snap ties resolve to the topmost', () => {
    const d = design(straw('a', 0, 0, 100, 0), wheel('w1', 200, 100, 8), wheel('w2', 210, 100, 8), shock('s', 50, 0, 205, 100));
    expect(resolveAttachments(d).shockEnds.s!.b.partId).toBe('w2');
  });

  it('floating shock end => floatingShock error and no joint', () => {
    const d = design(straw('a', 0, 0, 100, 0), wheel('w', 50, 0), shock('s', 50, 0, 500, 500));
    const spec = resolveAttachments(d);
    expect(spec.errors).toContainEqual({ code: 'floatingShock', partId: 's', ends: ['b'] });
    expect(spec.joints.some((j) => j.partId === 's')).toBe(false);
    expect(spec.valid).toBe(false);
  });

  it('both ends on the same body => shockSameBody', () => {
    const d = design(straw('a', 0, 0, 100, 0), wheel('w', 50, 0), shock('s', 10, 0, 90, 0));
    expect(codes(d)).toEqual(['shockSameBody']);
  });

  it('a shock connects otherwise separate islands', () => {
    const d = design(straw('a', 0, 0, 100, 0), wheel('w1', 50, 0), wheel('w2', 50, 100), shock('s', 50, 0, 50, 100));
    // w2 is free, hung on the shock (like the original's example cart).
    const spec = resolveAttachments(d);
    expect(spec.valid).toBe(true);
    expect(spec.wheelPins.w2).toBeNull();
  });
});

describe('resolveAttachments — validation errors', () => {
  it('noWheels', () => {
    expect(codes(design(straw('a', 0, 0, 100, 0)))).toEqual(['noWheels']);
    expect(codes(design())).toEqual(['noWheels']);
  });

  it('disconnectedIslands lists every island', () => {
    const d = design(straw('a', 0, 0, 100, 0), wheel('w', 50, 0), straw('b', 0, 200, 100, 200));
    const spec = resolveAttachments(d);
    const err = spec.errors.find((e) => e.code === 'disconnectedIslands');
    expect(err).toEqual({ code: 'disconnectedIslands', islands: [['a', 'w'], ['b']] });
  });

  it('partTooSmall', () => {
    const d = design(straw('a', 0, 0, 100, 0), wheel('w', 50, 0), straw('tiny', 10, 0, 12, 0));
    expect(codes(d)).toEqual(['partTooSmall']);
  });

  it('a valid design has no errors', () => {
    const spec = resolveAttachments(loadSpikeCart());
    expect(spec.errors).toEqual([]);
    expect(spec.valid).toBe(true);
  });
});

describe('resolveAttachments — delete re-resolution', () => {
  it('deleting a bridging straw splits a body', () => {
    const d = design(straw('a', 0, 0, 50, 0), straw('bridge', 50, 0, 100, 0), straw('c', 100, 0, 150, 0), wheel('w', 25, 0));
    expect(resolveAttachments(d).bodies.filter((b) => b.kind === 'rigid')).toHaveLength(1);
    const after = resolveAttachments(deletePart(d, 'bridge'));
    expect(after.bodies.filter((b) => b.kind === 'rigid')).toHaveLength(2);
    expect(after.errors.map((e) => e.code)).toContain('disconnectedIslands');
  });

  it('deleting a pinned part re-pins the wheel to the next topmost part', () => {
    const d = design(straw('a', -50, 0, 50, 0), wheel('w', 0, 0), lime('l', 0, 0, 10));
    expect(resolveAttachments(d).wheelPins.w).toBe('l');
    expect(resolveAttachments(deletePart(d, 'l')).wheelPins.w).toBe('a');
  });

  it('deleting a snapped wheel makes its shock re-resolve (floating here)', () => {
    const d = design(straw('a', 0, 0, 100, 0), wheel('w0', 50, 0), wheel('w', 200, 100), shock('s', 50, 0, 200, 100));
    expect(resolveAttachments(d).valid).toBe(true);
    const after = resolveAttachments(deletePart(d, 'w'));
    expect(after.errors).toContainEqual({ code: 'floatingShock', partId: 's', ends: ['b'] });
  });

  it('is deterministic and does not mutate its input', () => {
    const d = loadSpikeCart();
    const copy = JSON.parse(JSON.stringify(d));
    expect(resolveAttachments(d)).toEqual(resolveAttachments(d));
    expect(d).toEqual(copy);
  });
});

describe('spike cart', () => {
  it('is one 12-straw chassis body + 4 pinned powered wheels', () => {
    const spec = resolveAttachments(loadSpikeCart());
    const rigid = spec.bodies.filter((b) => b.kind === 'rigid');
    expect(rigid).toHaveLength(1);
    expect(rigid[0]!.shapes).toHaveLength(12);
    const wheels = spec.bodies.filter((b) => b.kind === 'wheel');
    expect(wheels).toHaveLength(4);
    expect(spec.joints.filter((j) => j.type === 'revolute')).toHaveLength(4);
    expect(Object.values(spec.wheelPins).every((p) => p !== null)).toBe(true);
  });
});
