/**
 * UX1 (Jan: "70% free air camera [..x.....]"): after the ready blend the
 * cart sits ~30% from the left edge while driving forward.
 *
 * S6T backlog #13: before Release the camera frames the whole funnel and the
 * waiting cart (inside the HUD-free area), then blends into the follow camera.
 * S6T audit-1 #3: the cart is framed by its real shape AABBs (not body
 * origins), and a cart driven far from the funnel is framed alone.
 */
import { describe, expect, it } from 'vitest';
import { exampleCart } from '../../src/builder/exampleCart';
import { courseFor } from '../../src/game/courses';
import {
  blendCamera,
  bodiesBox,
  bodyAabb,
  boxOf,
  cartAnchorX,
  FINISH_PAD,
  finishWeight,
  followCamera,
  followZoom,
  frameBox,
  LOOK_AHEAD_FRACTION,
  LookAheadFollow,
  READY_BLEND_SECONDS,
  READY_MIN_ZOOM,
  READY_PAD,
  readyFrame,
  runCamera,
  withFinish,
  goalBlenderBox,
  type Box,
} from '../../src/game/framing';
import { BLENDER_SIZE } from '../../src/model/goal';
import { PREMADE } from '../../tools/levels/premade';
import { ORIGINAL_EXPERT_LINE, paceDrive } from '../integration/driver';
import type { PaceNote } from '../../tools/levels/track';
import type { CartDesign } from '../../src/model/cart';
import type { Vec2 } from '../../src/model/geometry';
import { RunSession } from '../../src/game/session';
import { worldToScreen, type Camera } from '../../src/model/coords';
import { TOTAL_PINEAPPLES } from '../../src/model/score';
import { funnelGeometry } from '../../src/run/funnel';

const VIEWPORTS: [number, number][] = [
  [1280, 760],
  [800, 600],
  [844, 390], // phone landscape
];

/** Every world point of every cart shape (polygon vertices, 8 points on each circle). */
function cartShapePoints(s: RunSession): Vec2[] {
  const ids = new Set(s.controller.cartBodyHandles());
  const pts: Vec2[] = [];
  for (const info of s.world.manifest().bodies) {
    if (!ids.has(info.id)) continue;
    for (const sh of info.shapes) {
      if (sh.type === 'circle') {
        const c = s.world.localToWorld(info.id, sh.center);
        for (let k = 0; k < 8; k++) pts.push({ x: c.x + sh.radius * Math.cos((k * Math.PI) / 4), y: c.y + sh.radius * Math.sin((k * Math.PI) / 4) });
      } else if (sh.type === 'polygon') {
        for (const v of sh.vertices) pts.push(s.world.localToWorld(info.id, v));
      }
    }
  }
  return pts;
}

/** The example cart with a tall mast: a straw reaching ~6 m above the bed, far past any body origin + 1 m. */
function mastCart(): CartDesign {
  const d = exampleCart();
  return { ...d, parts: [...d.parts, { id: 'mast', kind: 'straw', a: { x: 115, y: -43 }, b: { x: 115, y: -223 } }] };
}

function expectOnScreen(pts: readonly Vec2[], cam: Camera, label: string): void {
  for (const p of pts) {
    const q = worldToScreen(p, cam);
    expect(q.x, label).toBeGreaterThanOrEqual(READY_PAD.side - 1);
    expect(q.x, label).toBeLessThanOrEqual(cam.viewportWidth - READY_PAD.side + 1);
    expect(q.y, label).toBeGreaterThanOrEqual(READY_PAD.top - 1);
    expect(q.y, label).toBeLessThanOrEqual(cam.viewportHeight - READY_PAD.bottom + 1);
  }
}

describe('ready-phase framing', () => {
  const carts: [string, () => CartDesign][] = [
    ['example', exampleCart],
    ['mast', mastCart],
  ];
  for (const [cartName, cart] of carts) {
    for (const id of ['beach', 'kitchen', 'workbench', 'original', 'endless:PINE']) {
      it(`${id}, ${cartName} cart: funnel and every cart shape are on screen, clear of the HUD pads, at every viewport`, async () => {
        const course = courseFor(id)!;
        const s = await RunSession.create(cart(), course);
        try {
          s.start();
          for (let i = 0; i < 30; i++) s.step();
          const f = funnelGeometry(course.level.funnel, TOTAL_PINEAPPLES);
          const funnelPts = [...f.walls[0], ...f.walls[1]];
          const cartPts = cartShapePoints(s);
          const cartBox = bodiesBox(s.world.manifest().bodies, s.controller.cartBodyHandles(), (h) => s.world.getTransform(h));
          expect(cartBox).not.toBeNull();
          if (cartName === 'mast') {
            // the old origin + 1 m box would clip the mast top
            const origins = boxOf(s.controller.cartBodyHandles().map((h) => s.world.getTransform(h)));
            expect(Math.min(...cartPts.map((p) => p.y))).toBeLessThan(origins.minY - 1 - 1);
          }
          for (const [w, h] of VIEWPORTS) {
            const followZoom = Math.min(1.5, Math.max(0.5, w / (24 * 30)));
            const fr = readyFrame(boxOf(funnelPts), cartBox, w, h, followZoom);
            expect(fr.framed).toBe('both');
            expect(fr.zoom).toBeLessThanOrEqual(followZoom);
            expectOnScreen([...funnelPts, ...cartPts], { center: fr.center, zoom: fr.zoom, viewportWidth: w, viewportHeight: h }, `${id} ${cartName} ${w}x${h}`);
          }
        } finally {
          s.destroy();
        }
      }, 30_000);
    }
  }

  it('bodyAabb covers rotated polygons and circles exactly', () => {
    const box = bodyAabb(
      [
        { type: 'polygon', partId: 'p', vertices: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 1 }] },
        { type: 'circle', partId: 'c', center: { x: 4, y: 0 }, radius: 0.5 },
      ],
      { x: 10, y: 20, angle: Math.PI / 2 },
    )!;
    // +90°: local (x, y) -> (-y, x)
    expect(box.minX).toBeCloseTo(9, 9);
    expect(box.maxX).toBeCloseTo(10.5, 9);
    expect(box.minY).toBeCloseTo(20, 9);
    expect(box.maxY).toBeCloseTo(24.5, 9);
  });

  it('a cart driven far from the funnel is framed alone (the cart wins); near it both are framed', () => {
    const funnel: Box = { minX: 0, minY: -8, maxX: 3, maxY: -2 };
    const cartAt = (x: number): Box => ({ minX: x, minY: -2.5, maxX: x + 6, maxY: 0 });
    for (const [w, h] of VIEWPORTS) {
      const followZoom = Math.min(1.5, Math.max(0.5, w / (24 * 30)));
      const near = readyFrame(funnel, cartAt(2), w, h, followZoom);
      expect(near.framed).toBe('both');
      const far = readyFrame(funnel, cartAt(300), w, h, followZoom);
      expect(far.framed).toBe('cart');
      expect(far.zoom).toBeGreaterThanOrEqual(READY_MIN_ZOOM);
      const c = cartAt(300);
      const cam: Camera = { center: far.center, zoom: far.zoom, viewportWidth: w, viewportHeight: h };
      expectOnScreen([{ x: c.minX, y: c.minY }, { x: c.maxX, y: c.maxY }], cam, `far ${w}x${h}`);
      // a cart bigger than READY_MIN_ZOOM allows is still fitted whole (zoom goes below the floor)
      const huge: Box = { minX: 300, minY: -60, maxX: 400, maxY: 0 };
      const hf = readyFrame(funnel, huge, w, h, followZoom);
      expect(hf.zoom).toBeLessThan(READY_MIN_ZOOM);
      expectOnScreen([{ x: huge.minX, y: huge.minY }, { x: huge.maxX, y: huge.maxY }], { center: hf.center, zoom: hf.zoom, viewportWidth: w, viewportHeight: h }, `huge ${w}x${h}`);
    }
    // no cart body left: the funnel is framed
    expect(readyFrame(funnel, null, 800, 600, 1).framed).toBe('funnel');
    // frameBox still clamps at READY_MIN_ZOOM by default
    expect(frameBox({ minX: 0, minY: -60, maxX: 100, maxY: 0 }, 800, 600, 1).zoom).toBe(READY_MIN_ZOOM);
  });

  it('blends to the follow camera after Release (smoothly, finished after READY_BLEND_SECONDS)', () => {
    const follow: Camera = { center: { x: 10, y: 5 }, zoom: 1.2, viewportWidth: 800, viewportHeight: 600 };
    const ready = { center: { x: 4, y: 1 }, zoom: 0.7 };
    expect(blendCamera(follow, ready, null)).toMatchObject({ center: ready.center, zoom: 0.7 });
    const mid = blendCamera(follow, ready, READY_BLEND_SECONDS / 2);
    expect(mid.zoom).toBeCloseTo(0.95, 6);
    expect(mid.center.x).toBeCloseTo(7, 6);
    expect(blendCamera(follow, ready, READY_BLEND_SECONDS)).toBe(follow);
    expect(blendCamera(follow, null, null)).toBe(follow);
  });
});

describe('UX1 look-ahead follow camera', () => {
  it('LookAheadFollow has no steady-state lag at constant speed, eases to a stop, and holds without a cart', () => {
    const f = new LookAheadFollow(0);
    let x = 0;
    for (let i = 0; i < 600; i++) f.step((x += 0.2)); // 12 m/s
    expect(f.x).toBeCloseTo(x, 6);
    for (let i = 0; i < 600; i++) f.step(x); // stopped
    expect(f.x).toBeCloseTo(x, 6);
    const held = f.x;
    f.step(null);
    expect(f.x).toBe(held);
    expect(f.interpolated(0.5)).toBe(held);
  });

  it('lookahead: the anchor lands at LOOK_AHEAD_FRACTION of the width at every follow zoom', () => {
    for (const [w, h] of VIEWPORTS) {
      const cam = followCamera(100, 5, followZoom(w), w, h);
      expect(worldToScreen({ x: 100, y: 5 }, cam).x / w).toBeCloseTo(LOOK_AHEAD_FRACTION, 9);
      expect(worldToScreen({ x: 100, y: 5 }, cam).y).toBeCloseTo(h / 2, 9); // vertical follow unchanged
    }
  });

  const lines: [string, readonly PaceNote[]][] = [
    ['beach', PREMADE.beach().pace],
    ['kitchen', PREMADE.kitchen().pace],
    ['workbench', PREMADE.workbench().pace],
    ['original', ORIGINAL_EXPERT_LINE],
    ['endless:PINE', [{ x: 0, speed: 7 }]],
  ];
  /** The cart's shape box at the RENDERED (interpolated) pose, as the renderer draws it. */
  const renderedCartBox = (s: RunSession, alpha: number): Box | null => {
    const snap = s.world.snapshot(alpha);
    const pose = new Map(snap.bodies.map((b) => [b.id, b]));
    return bodiesBox(s.world.manifest().bodies, s.controller.cartBodyHandles(), (id) => pose.get(id)!);
  };

  for (const [id, pace] of lines) {
    it(`${id}: on the RENDERED path the cart sits at 30% from the left edge (70% ahead) at every viewport, accelerating and cruising`, async () => {
      const course = courseFor(id)!;
      const s = await RunSession.create(exampleCart(), course);
      const blender = goalBlenderBox(course.level);
      try {
        const look = new LookAheadFollow(cartAnchorX(s.controller.cartBounds())!);
        const step = () => {
          s.step();
          look.step(cartAnchorX(s.controller.cartBounds()));
        };
        s.start();
        for (let i = 0; i < 60; i++) step();
        s.release();
        let sinceRelease = 0;
        const cruise: number[] = [];
        let worstCruise = 0;
        let worstInterp = 0;
        let accelSamples = 0;
        for (let n = 0; n < 60 * 20 && s.controller.phase !== 'ended'; n++) {
          s.setDrive(n < 180 ? 0 : paceDrive(s, pace));
          step();
          sinceRelease += 1 / 60;
          if (sinceRelease < READY_BLEND_SECONDS) continue; // still blending from the ready frame
          const h = s.controller.cart.bodies.get(s.controller.chassisId);
          if (!s.controller.cartBounds() || h === undefined || !s.world.hasBody(h)) continue;
          const vx = s.world.getLinearVelocity(h).x;
          const followY = s.controller.camera.position.y;
          for (const [w, vh] of VIEWPORTS) {
            // exactly what runScreen renders at this alpha: interpolated look anchor, interpolated cart
            const frac = (alpha: number): number => {
              const box = renderedCartBox(s, alpha)!;
              const cam = runCamera({ anchorX: look.interpolated(alpha), followY, viewportWidth: w, viewportHeight: vh, blender, cart: box, ready: null, sinceRelease: null });
              return worldToScreen({ x: cartAnchorX(box)!, y: 0 }, cam).x / w;
            };
            const f0 = frac(0);
            const f1 = frac(1);
            for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
              const f = frac(alpha);
              const where = `${id} ${w}x${vh} t=${sinceRelease.toFixed(2)} alpha=${alpha} vx=${vx.toFixed(1)}`;
              // the cart never drifts past screen centre: most of the view is always ahead
              expect(f, where).toBeLessThan(0.5);
              expect(f, where).toBeGreaterThan(0.1);
              // interpolation adds nothing of its own: a rendered frame lies on the line between its two steps
              worstInterp = Math.max(worstInterp, Math.abs(f - (f0 + (f1 - f0) * alpha)));
              if (vx > 4 && sinceRelease > READY_BLEND_SECONDS + 3) {
                cruise.push(f);
                worstCruise = Math.max(worstCruise, Math.abs(f - LOOK_AHEAD_FRACTION));
              } else if (vx > 0.5) accelSamples++;
            }
          }
        }
        expect(cruise.length).toBeGreaterThan(100);
        expect(accelSamples, 'acceleration / slow samples were checked too').toBeGreaterThan(50);
        const mean = cruise.reduce((a, b) => a + b, 0) / cruise.length;
        expect(Math.abs(mean - LOOK_AHEAD_FRACTION), `${id} mean ${mean}`).toBeLessThan(0.005);
        // measured on the rendered path: worst cruise deviation 0.007-0.011 (TUNING.md)
        expect(worstCruise, `${id} worst |fraction - 0.3| cruising`).toBeLessThan(0.015);
        expect(worstInterp, `${id} worst interpolation-only deviation`).toBeLessThan(0.002);
      } finally {
        s.destroy();
      }
    }, 120_000);
  }

  // audit-1 #2: the 9 m blender on a short landscape phone
  for (const id of ['beach', 'kitchen', 'workbench', 'original']) {
    it(`${id}: with the cart in the finish pit the WHOLE blender and the cart are on screen (844x390, 1280x720)`, async () => {
      const course = courseFor(id)!;
      const line = id === 'original' ? ORIGINAL_EXPERT_LINE : PREMADE[id as 'beach' | 'kitchen' | 'workbench']().pace;
      const s = await RunSession.create(exampleCart(), course);
      const blender = goalBlenderBox(course.level);
      const lineX = course.level.goal.lineX;
      try {
        const look = new LookAheadFollow(cartAnchorX(s.controller.cartBounds())!);
        s.start();
        for (let i = 0; i < 60; i++) {
          s.step();
          look.step(cartAnchorX(s.controller.cartBounds()));
        }
        s.release();
        let inPit = 0;
        let minZoomSeen = Infinity;
        for (let n = 0; n < 60 * 60 && s.controller.phase !== 'ended'; n++) {
          s.setDrive(n < 180 ? 0 : paceDrive(s, line));
          s.step();
          look.step(cartAnchorX(s.controller.cartBounds()));
          const cart = s.controller.cartBounds();
          if (!cart || cart.maxX < lineX) continue; // the cart's front is over the goal line: dropping into / in the pit
          inPit++;
          for (const [w, vh] of [[844, 390], [1280, 720]] as const) {
            const cam = runCamera({ anchorX: look.x, followY: s.controller.camera.position.y, viewportWidth: w, viewportHeight: vh, blender, cart, ready: null, sinceRelease: null });
            minZoomSeen = Math.min(minZoomSeen, cam.zoom / followZoom(w));
            const where = `${id} ${w}x${vh} step ${n}`;
            for (const p of [
              { x: blender.minX, y: blender.minY },
              { x: blender.maxX, y: blender.minY },
              { x: blender.minX, y: blender.maxY },
              { x: blender.maxX, y: blender.maxY },
              { x: cart.minX, y: cart.minY },
              { x: cart.maxX, y: cart.maxY },
            ]) {
              const q = worldToScreen(p, cam);
              expect(q.x, where).toBeGreaterThanOrEqual(0);
              expect(q.x, where).toBeLessThanOrEqual(w);
              expect(q.y, `${where}: y (blender top / cart)`).toBeGreaterThanOrEqual(FINISH_PAD.top - 1e-6);
              expect(q.y, where).toBeLessThanOrEqual(vh);
            }
          }
        }
        expect(inPit, `${id}: the cart reached the pit`).toBeGreaterThan(30);
        // it zooms out only as far as it must (the blender is 9 m; the phone view ~11 m tall)
        expect(minZoomSeen).toBeGreaterThan(0.75);
      } finally {
        s.destroy();
      }
    }, 120_000);
  }

  it('finish framing: off far from the goal, eases in as the blender nears the view, keeps the cart at 30%, zooms out only if needed', () => {
    const blender: Box = { minX: 100, maxX: 103.75, minY: -9, maxY: 0 };
    const cart: Box = { minX: 90, maxX: 94, minY: -2, maxY: -0.2 };
    for (const [w, h] of [[844, 390], [1280, 720], [800, 600]] as const) {
      const far = followCamera(40, -1, followZoom(w), w, h);
      expect(withFinish(far, 40, blender, cart)).toEqual(far);
      expect(finishWeight(far, blender)).toBe(0);
      const near = followCamera(92, -1, followZoom(w), w, h);
      expect(finishWeight(near, blender)).toBe(1);
      const f = withFinish(near, 92, blender, cart);
      expect(worldToScreen({ x: 92, y: 0 }, f).x / w).toBeCloseTo(LOOK_AHEAD_FRACTION, 9);
      expect(worldToScreen({ x: 100, y: -9 }, f).y).toBeGreaterThanOrEqual(FINISH_PAD.top - 1e-9);
      expect(worldToScreen({ x: 100, y: 0 }, f).y).toBeLessThanOrEqual(h - FINISH_PAD.bottom + 1e-9);
      expect(f.zoom).toBeLessThanOrEqual(near.zoom);
      if (w === 1280) expect(f.zoom).toBe(near.zoom); // tall enough: only the look point moves
      // monotone ease-in as the cart approaches
      let last = 0;
      for (let x = 60; x <= 92; x += 1) {
        const e = finishWeight(followCamera(x, -1, followZoom(w), w, h), blender);
        expect(e).toBeGreaterThanOrEqual(last);
        last = e;
      }
    }
  });

  it('goalBlenderBox is the drawn blender on every shipped level and generated levels', () => {
    for (const id of ['beach', 'kitchen', 'workbench', 'original']) {
      const level = courseFor(id)!.level;
      const b = level.props.find((p) => p.art === 'blender')!;
      expect(goalBlenderBox(level)).toEqual({
        minX: b.position.x - b.size!.x / 2,
        maxX: b.position.x + b.size!.x / 2,
        minY: b.position.y - b.size!.y / 2,
        maxY: b.position.y + b.size!.y / 2,
      });
    }
    const gen = courseFor('endless:PINE')!.level;
    const box = goalBlenderBox(gen);
    expect(box.maxX - box.minX).toBeCloseTo(BLENDER_SIZE.x, 9);
    expect(box.maxY - box.minY).toBeCloseTo(BLENDER_SIZE.y, 9);
  });
});
