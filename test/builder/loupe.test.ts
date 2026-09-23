/**
 * UX1 #5 builder touch loupe — pure rules (tracker + placement) and the Pixi
 * lens transform. The wired-up behaviour (touch only, follows, hides on
 * release/cancel, never changes edits) is in loupeMount.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { LOUPE, LoupeTracker, loupeAllowed, loupeLayout, type LoupeBounds } from '../../src/builder/loupe';
import { BuilderLoupe } from '../../src/builder/render';
import { designToScreen, screenToDesign, type BuilderView } from '../../src/builder/view';

const B: LoupeBounds = { left: 0, top: 0, right: 600, bottom: 400 };
const R = LOUPE.radius;

function inside(c: { x: number; y: number }, b: LoupeBounds) {
  expect(c.x - R).toBeGreaterThanOrEqual(b.left);
  expect(c.x + R).toBeLessThanOrEqual(b.right);
  expect(c.y - R).toBeGreaterThanOrEqual(b.top);
  expect(c.y + R).toBeLessThanOrEqual(b.bottom);
}

describe('UX1 loupe parameters', () => {
  it('radius in the 56-72 px band, 2x zoom, circle clear of the fingertip', () => {
    expect(R).toBeGreaterThanOrEqual(56);
    expect(R).toBeLessThanOrEqual(72);
    expect(LOUPE.zoom).toBe(2);
    expect(LOUPE.gap).toBeGreaterThanOrEqual(40);
  });
});

describe('loupeLayout: above the finger, toward the centre, flipping at edges', () => {
  it('mid-screen: directly above (circle edge `gap` px over the fingertip), leaning toward the centre', () => {
    const left = loupeLayout({ x: 200, y: 300 }, B);
    expect(left.side).toBe('above');
    expect(left.center.y).toBe(300 - LOUPE.gap - R);
    expect(left.center.x).toBeCloseTo(200 + LOUPE.lean * R, 9); // finger left of centre -> leans right
    const right = loupeLayout({ x: 450, y: 300 }, B);
    expect(right.center.x).toBeCloseTo(450 - LOUPE.lean * R, 9); // leans left
    // the fingertip is never under the circle
    for (const p of [left, right]) expect(Math.hypot(p.center.x - (p === left ? 200 : 450), p.center.y - 300)).toBeGreaterThan(R + 40);
  });

  it('near the left / right edge: clamped inside the area', () => {
    for (const x of [0, 5, 30, 570, 600]) {
      const p = loupeLayout({ x, y: 300 }, B);
      expect(p.side).toBe('above');
      inside(p.center, B);
    }
  });

  it('near the top edge: flips BESIDE the finger, on the side facing the centre, and stays inside', () => {
    const l = loupeLayout({ x: 100, y: 40 }, B);
    expect(l.side).toBe('right');
    expect(l.center.x).toBe(100 + LOUPE.gap + R);
    const r = loupeLayout({ x: 500, y: 40 }, B);
    expect(r.side).toBe('left');
    expect(r.center.x).toBe(500 - LOUPE.gap - R);
    for (const p of [l, r, loupeLayout({ x: 0, y: 0 }, B), loupeLayout({ x: 600, y: 0 }, B)]) {
      inside(p.center, B);
      expect(p.side).not.toBe('above');
    }
    // beside the finger: its centre is level with the fingertip where possible
    expect(l.center.y).toBe(LOUPE.margin + R);
    expect(loupeLayout({ x: 100, y: 120 }, B)).toEqual({ side: 'right', center: { x: 100 + LOUPE.gap + R, y: 120 } });
  });

  it('the flip happens exactly when the above-placement would leave the area', () => {
    const edge = LOUPE.margin + 2 * R + LOUPE.gap; // lowest finger y that does not fit above
    expect(loupeLayout({ x: 300, y: edge }, B).side).toBe('above');
    expect(loupeLayout({ x: 300, y: edge - 1 }, B).side).not.toBe('above');
  });

  it('respects a non-zero area origin (canvas minus palette)', () => {
    const b = { left: 0, top: 0, right: 380, bottom: 700 };
    const p = loupeLayout({ x: 375, y: 500 }, b);
    inside(p.center, b);
  });
});

describe('LoupeTracker: touch only, first finger followed', () => {
  it('mouse and pen never produce a loupe', () => {
    const t = new LoupeTracker();
    t.down(1, 'mouse', { x: 10, y: 10 });
    t.move(1, { x: 20, y: 20 });
    expect(t.position).toBeNull();
    t.down(2, 'pen', { x: 10, y: 10 });
    expect(t.position).toBeNull();
  });

  it('follows the finger and hides on release', () => {
    const t = new LoupeTracker();
    t.down(7, 'touch', { x: 10, y: 20 });
    expect(t.position).toEqual({ x: 10, y: 20 });
    t.move(7, { x: 50, y: 60 });
    expect(t.position).toEqual({ x: 50, y: 60 });
    t.move(8, { x: 1, y: 1 }); // an untracked pointer changes nothing
    expect(t.position).toEqual({ x: 50, y: 60 });
    t.up(7);
    expect(t.position).toBeNull();
  });

  it('a second finger does not steal it; after the followed finger lifts, nothing shows until all are up', () => {
    const t = new LoupeTracker();
    t.down(1, 'touch', { x: 10, y: 10 });
    t.down(2, 'touch', { x: 90, y: 90 });
    expect(t.position).toEqual({ x: 10, y: 10 });
    t.up(1);
    expect(t.position).toBeNull();
    t.move(2, { x: 80, y: 80 });
    expect(t.position).toBeNull();
    t.down(3, 'touch', { x: 5, y: 5 }); // still mid-sequence
    expect(t.position).toBeNull();
    t.up(2);
    t.up(3);
    t.down(4, 'touch', { x: 1, y: 2 }); // fresh sequence
    expect(t.position).toEqual({ x: 1, y: 2 });
  });

  it('reset (pointercancel / input reset) hides it', () => {
    const t = new LoupeTracker();
    t.down(1, 'touch', { x: 10, y: 10 });
    t.reset();
    expect(t.position).toBeNull();
    t.up(1); // late lostpointercapture is harmless
    t.down(2, 'touch', { x: 3, y: 3 });
    expect(t.position).toEqual({ x: 3, y: 3 });
  });

  it('pinch / pan / post-pinch hide it; a stroke shows it', () => {
    expect(loupeAllowed('stroke')).toBe(true);
    expect(loupeAllowed('idle')).toBe(true);
    for (const g of ['pinch', 'pan', 'ignoring']) expect(loupeAllowed(g)).toBe(false);
  });
});

describe('BuilderLoupe lens: 2x the builder view, fingertip design point at the lens centre', () => {
  it('maps the design point under the finger to (r, r) at zoom x the scale', () => {
    const v: BuilderView = { scale: 1.7, offsetX: 123, offsetY: 456 };
    const tip = { x: 300, y: 250 };
    const lv = BuilderLoupe.lensView(v, tip, 2, R);
    expect(lv.scale).toBeCloseTo(3.4, 12);
    const d = screenToDesign(tip, v);
    const s = designToScreen(d, lv);
    expect(s.x).toBeCloseTo(R, 9);
    expect(s.y).toBeCloseTo(R, 9);
    // 10 screen px in the builder = 20 px in the lens
    const d2 = screenToDesign({ x: tip.x + 10, y: tip.y }, v);
    expect(designToScreen(d2, lv).x - R).toBeCloseTo(20, 9);
  });

  it('show/hide toggle a display-only overlay', async () => {
    const { buildPreview } = await import('../../src/builder/preview');
    const { exampleCart } = await import('../../src/builder/exampleCart');
    const l = new BuilderLoupe();
    expect(l.visible).toBe(false);
    expect(l.view.eventMode).toBe('none');
    l.show(buildPreview(exampleCart()), {}, { scale: 1, offsetX: 200, offsetY: 300 }, { x: 250, y: 280 }, { side: 'above', center: { x: 272, y: 172 } }, 2, R);
    expect(l.visible).toBe(true);
    l.hide();
    expect(l.visible).toBe(false);
    l.destroy();
  });
});
