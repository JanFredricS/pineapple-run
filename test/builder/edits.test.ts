import { describe, expect, it } from 'vitest';
import { resolveAttachments } from '../../src/model/attach';
import { MAX_PARTS, type CartDesign, type CartPart } from '../../src/model/cart';
import { validateCartDesign } from '../../src/model/validate';
import { BUILD_AREA } from '../../src/builder/constants';
import { applyStroke, clampToArea, hitTest, makeDraft, nextPartId, snapAngle } from '../../src/builder/edits';
import { initialEditorState, reduceEditor, type EditorAction, type EditorState } from '../../src/builder/editor';
import { EXAMPLE_CART } from '../../src/builder/exampleCart';

const P = (x: number, y: number) => ({ x, y });
const opts = { snap: false };

function dispatch(state: EditorState, ...actions: EditorAction[]) {
  let s = state;
  const outcomes = [];
  for (const a of actions) {
    const r = reduceEditor(s, a);
    s = r.state;
    if (r.outcome) outcomes.push(r.outcome);
  }
  return { state: s, outcomes };
}
const stroke = (x0: number, y0: number, x1: number, y1: number, tolerance = 4): EditorAction => ({
  type: 'stroke',
  start: P(x0, y0),
  end: P(x1, y1),
  tolerance,
});

describe('draft creation', () => {
  it('straw = segment from press to release', () => {
    const d = makeDraft('straw', P(0, -10), P(40, -10), 'p1', opts);
    expect(d.part).toEqual({ id: 'p1', kind: 'straw', a: P(0, -10), b: P(40, -10) });
    expect(d.tooSmall).toBe(false);
    expect(d.label).toBe('40 px');
  });

  it('sugar cube spans the drag corners (axis-aligned), any drag direction', () => {
    const d = makeDraft('cube', P(50, -10), P(20, -40), 'p1', opts);
    expect(d.part).toEqual({ id: 'p1', kind: 'cube', center: P(35, -25), width: 30, height: 30, angle: 0 });
  });

  it('lime / wheel: centre at press, radius = drag distance', () => {
    const lime = makeDraft('lime', P(100, -50), P(130, -10), 'p1', opts).part;
    expect(lime).toEqual({ id: 'p1', kind: 'lime', center: P(100, -50), radius: 50 });
    const wheel = makeDraft('wheel', P(100, -50), P(100, -25), 'p2', opts).part;
    expect(wheel).toEqual({ id: 'p2', kind: 'wheel', center: P(100, -50), radius: 25 });
  });

  it('shock = segment between the two drag points', () => {
    expect(makeDraft('shock', P(0, -50), P(0, -10), 'p1', opts).part).toEqual({ id: 'p1', kind: 'shock', a: P(0, -50), b: P(0, -10) });
  });

  it('min sizes come from the contract: straw < 5 px and cube side < 7 px are too small', () => {
    expect(makeDraft('straw', P(0, -10), P(4.9, -10), 'p', opts).tooSmall).toBe(true);
    expect(makeDraft('straw', P(0, -10), P(5, -10), 'p', opts).tooSmall).toBe(false);
    expect(makeDraft('cube', P(0, -10), P(6.9, -30), 'p', opts).tooSmall).toBe(true);
    expect(makeDraft('cube', P(0, -10), P(7, -17), 'p', opts).tooSmall).toBe(false);
    expect(makeDraft('wheel', P(50, -50), P(53, -50), 'p', opts).tooSmall).toBe(true);
    expect(makeDraft('lime', P(50, -50), P(55, -50), 'p', opts).tooSmall).toBe(false);
    expect(makeDraft('shock', P(50, -50), P(50, -46), 'p', opts).tooSmall).toBe(true);
  });

  it('clamps draft points into the build area', () => {
    const d = makeDraft('straw', P(0, -10), P(10_000, 500), 'p1', opts).part as Extract<CartPart, { kind: 'straw' }>;
    expect(d.b).toEqual(P(BUILD_AREA.maxX, BUILD_AREA.maxY));
    expect(clampToArea(P(-1e9, -1e9))).toEqual(P(BUILD_AREA.minX, BUILD_AREA.minY));
  });

  it('angle snap rounds straws/shocks to 15° steps keeping the length', () => {
    const b = snapAngle(P(0, 0), P(100, 8)); // ~4.6° -> 0°
    expect(b.x).toBeCloseTo(Math.hypot(100, 8));
    expect(b.y).toBeCloseTo(0);
    const c = snapAngle(P(0, 0), P(100, -95)); // ~-43.5° -> -45°
    expect(Math.atan2(c.y, c.x)).toBeCloseTo(-Math.PI / 4);
    const d = makeDraft('straw', P(0, -100), P(100, -92), 'p', { snap: true }).part as Extract<CartPart, { kind: 'straw' }>;
    expect(d.b.y).toBe(-100);
    const s = makeDraft('shock', P(0, -100), P(100, -92), 'p', { snap: true }).part as Extract<CartPart, { kind: 'shock' }>;
    expect(s.b.y).toBe(-100);
  });

  it('rounds committed coordinates to 2 decimals', () => {
    const d = makeDraft('straw', P(1 / 3, -10), P(40.123456, -10), 'p1', opts).part as Extract<CartPart, { kind: 'straw' }>;
    expect(d.a.x).toBe(0.33);
    expect(d.b.x).toBe(40.12);
  });
});

describe('part ids', () => {
  it('assigns p1, p2, … and never collides with existing ids', () => {
    const d: CartDesign = { version: 1, parts: [] };
    expect(nextPartId(d)).toBe('p1');
    expect(nextPartId({ version: 1, parts: [{ id: 'p7', kind: 'lime', center: P(0, 0), radius: 9 }] })).toBe('p8');
    expect(nextPartId({ version: 1, parts: [{ id: 'p2', kind: 'lime', center: P(0, 0), radius: 9 }] })).toBe('p3');
    expect(nextPartId({ version: 1, parts: [{ id: 'x', kind: 'lime', center: P(0, 0), radius: 9 }] })).toBe('p2');
  });
});

describe('palette -> CartDesign edit operations', () => {
  it('each draw tool appends one part in draw order', () => {
    let s = initialEditorState();
    const tools = ['straw', 'cube', 'lime', 'wheel', 'shock'] as const;
    for (const tool of tools) {
      s = dispatch(s, { type: 'setTool', tool }, stroke(20, -60, 60, -40)).state;
    }
    expect(s.design.parts.map((p) => p.kind)).toEqual([...tools]);
    expect(s.design.parts.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    // output is always a valid CartDesign per model/validate
    expect(validateCartDesign(s.design).ok).toBe(true);
  });

  it('rejects too-small parts without changing the design', () => {
    const s0 = initialEditorState();
    const { state, outcomes } = dispatch(s0, stroke(10, -10, 12, -10));
    expect(state.design.parts).toHaveLength(0);
    expect(outcomes[0]).toMatchObject({ kind: 'rejected', reason: 'tooSmall' });
  });

  it('rejects strokes that start outside the build area', () => {
    const { state, outcomes } = dispatch(initialEditorState(), stroke(BUILD_AREA.maxX + 50, -20, 100, -20));
    expect(state.design.parts).toHaveLength(0);
    expect(outcomes[0]).toMatchObject({ kind: 'rejected', reason: 'outsideArea' });
  });

  it(`refuses parts beyond MAX_PARTS (${MAX_PARTS})`, () => {
    const parts: CartPart[] = Array.from({ length: MAX_PARTS }, (_, i) => ({ id: `q${i}`, kind: 'lime', center: P(0, -20), radius: 10 }));
    const { state, outcomes } = dispatch(initialEditorState({ version: 1, parts }), stroke(10, -10, 60, -10));
    expect(state.design.parts).toHaveLength(MAX_PARTS);
    expect(outcomes[0]).toMatchObject({ kind: 'rejected', reason: 'partLimit' });
  });

  it('the snap toggle affects straws', () => {
    const { state } = dispatch(initialEditorState(), { type: 'setSnap', snap: true }, stroke(0, -100, 100, -93));
    expect((state.design.parts[0] as Extract<CartPart, { kind: 'straw' }>).b.y).toBe(-100);
  });

  it('delete tool removes the tapped part (topmost when stacked) and re-resolves', () => {
    let s = dispatch(
      initialEditorState(),
      stroke(0, -20, 100, -20), // p1 straw
      { type: 'setTool', tool: 'lime' },
      stroke(50, -20, 50, -5), // p2 lime over the straw (r 15)
      { type: 'setTool', tool: 'wheel' },
      stroke(150, -30, 150, -5), // p3 wheel
    ).state;
    expect(resolveAttachments(s.design).bodies).toHaveLength(2);
    const r = dispatch(s, { type: 'setTool', tool: 'delete' }, stroke(50, -20, 50, -20));
    expect(r.outcomes[0]).toEqual({ kind: 'deleted', partId: 'p2' });
    s = r.state;
    expect(s.design.parts.map((p) => p.id)).toEqual(['p1', 'p3']);
    // a miss changes nothing
    const miss = dispatch(s, stroke(300, -150, 300, -150));
    expect(miss.state.design).toBe(s.design);
    expect(miss.outcomes[0]).toMatchObject({ kind: 'rejected', reason: 'nothingHere' });
  });

  it('delete uses the release point and honours the pick tolerance', () => {
    const s = dispatch(initialEditorState(), { type: 'setTool', tool: 'shock' }, stroke(0, -50, 100, -50)).state;
    expect(hitTest(s.design, P(50, -58), 5)).toBeNull();
    expect(hitTest(s.design, P(50, -58), 10)).toBe('p1');
    const r = dispatch({ ...s, tool: 'delete' }, stroke(500, 500, 50, -54, 5));
    expect(r.state.design.parts).toHaveLength(0);
  });

  it('delete prefers the part closest to the tap', () => {
    const d: CartDesign = {
      version: 1,
      parts: [
        { id: 'a', kind: 'shock', a: P(0, 0), b: P(100, 0) },
        { id: 'b', kind: 'straw', a: P(0, 8), b: P(100, 8) },
      ],
    };
    expect(hitTest(d, P(50, 1), 10)).toBe('a');
    expect(hitTest(d, P(50, 7), 10)).toBe('b');
  });

  it('clear all empties the design and drops its name', () => {
    const s = dispatch(initialEditorState(), { type: 'loadExample' }, { type: 'clearAll' }).state;
    expect(s.design).toEqual({ version: 1, parts: [] });
  });

  it('example cart loads a fresh copy of the fixture', () => {
    const s = dispatch(initialEditorState(), { type: 'loadExample' }).state;
    expect(s.design).toEqual(EXAMPLE_CART);
    expect(s.design).not.toBe(EXAMPLE_CART);
    s.design.parts.pop();
    expect(EXAMPLE_CART.parts).toHaveLength(12);
  });

  it('applyStroke never mutates its input design', () => {
    const d: CartDesign = { version: 1, parts: [] };
    const frozen = Object.freeze({ ...d, parts: Object.freeze([]) as unknown as CartPart[] });
    const r = applyStroke(frozen, 'straw', P(0, -10), P(50, -10), opts);
    expect(r.design.parts).toHaveLength(1);
    expect(frozen.parts).toHaveLength(0);
  });
});
