import { describe, expect, it } from 'vitest';
import { validateLevelDef } from '../../src/model/validate';
import {
  addSpan,
  cutGap,
  defaultLevel,
  deletePoint,
  extendSpan,
  hitPoint,
  hitSegment,
  insertPoint,
  joinSpans,
  movePoint,
} from '../../tools/mapbuilder/ops';

const valid = (doc: unknown) => {
  const r = validateLevelDef(doc);
  if (!r.ok) throw new Error(r.error.message);
};

describe('map-builder ops', () => {
  it('default level validates', () => valid(defaultLevel()));

  it('movePoint keeps x strictly increasing and never mutates the input', () => {
    const doc = defaultLevel();
    const before = JSON.stringify(doc);
    const moved = movePoint(doc, { span: 0, point: 2 }, { x: 999, y: 7 });
    expect(JSON.stringify(doc)).toBe(before);
    expect(moved.terrain.spans[0]!.points[2]!.x).toBeLessThan(40);
    expect(moved.terrain.spans[0]!.points[2]!.y).toBe(7);
    valid(moved);
    valid(movePoint(doc, { span: 0, point: 2 }, { x: -999, y: 7 }));
  });

  it('insert, extend, delete points', () => {
    let doc = defaultLevel();
    const ins = insertPoint(doc, { span: 0, seg: 2 }, { x: 30, y: 8 })!;
    expect(ins.point).toEqual({ span: 0, point: 3 });
    doc = ins.doc;
    valid(doc);
    const ext = extendSpan(doc, { x: 70, y: 10 })!;
    expect(ext.doc.terrain.spans[0]!.points.at(-1)).toEqual({ x: 70, y: 10 });
    valid(ext.doc);
    const del = deletePoint(ext.doc, { span: 0, point: 3 })!;
    expect(del.terrain.spans[0]!.points).toHaveLength(ext.doc.terrain.spans[0]!.points.length - 1);
    valid(del);
  });

  it('cutGap splits a span into two with a real gap; joinSpans closes it', () => {
    const doc = defaultLevel();
    const cut = cutGap(doc, { span: 0, seg: 2 })!; // 20..40 -> gap 26.67..33.33
    expect(cut.terrain.spans).toHaveLength(2);
    const [a, b] = cut.terrain.spans;
    expect(a!.points.at(-1)!.x).toBeCloseTo(20 + 20 / 3, 9);
    expect(b!.points[0]!.x).toBeCloseTo(20 + 40 / 3, 9);
    expect(a!.id).not.toBe(b!.id);
    valid(cut);
    const joined = joinSpans(cut, 0)!;
    expect(joined.terrain.spans).toHaveLength(1);
    valid(joined);
  });

  it('deleting a 2-point span removes it, but never the last span', () => {
    const doc = defaultLevel();
    const added = addSpan(doc, { x: 80, y: 10 })!;
    expect(added.span).toBe(1);
    valid(added.doc);
    const removed = deletePoint(added.doc, { span: 1, point: 0 })!;
    expect(removed.terrain.spans).toHaveLength(1);
    const single = { ...doc, terrain: { ...doc.terrain, spans: [{ id: 'x', points: [{ x: 0, y: 1 }, { x: 1, y: 1 }] }] } };
    expect(deletePoint(single, { span: 0, point: 0 })).toBeNull();
    expect(addSpan(doc, { x: 30, y: 5 })).toBeNull(); // inside an existing span
  });

  it('span end points cannot be dragged across a neighbouring span', () => {
    const cut = cutGap(defaultLevel(), { span: 0, seg: 2 })!;
    const moved = movePoint(cut, { span: 0, point: cut.terrain.spans[0]!.points.length - 1 }, { x: 50, y: 10 });
    expect(moved.terrain.spans[0]!.points.at(-1)!.x).toBe(moved.terrain.spans[1]!.points[0]!.x); // touches, no overlap
    valid(moved);
  });

  it('hit tests find points and segments within tolerance', () => {
    const doc = defaultLevel();
    expect(hitPoint(doc, { x: 20.1, y: 10.1 }, 0.5)).toEqual({ span: 0, point: 2 });
    expect(hitPoint(doc, { x: 25, y: 5 }, 0.5)).toBeNull();
    expect(hitSegment(doc, { x: 10, y: 10.2 }, 0.5)).toEqual({ span: 0, seg: 1 });
  });
});
