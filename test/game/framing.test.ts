/**
 * S6T backlog #13: before Release the camera frames the whole funnel and the
 * waiting cart (inside the HUD-free area), then blends into the follow camera.
 */
import { describe, expect, it } from 'vitest';
import { exampleCart } from '../../src/builder/exampleCart';
import { courseFor } from '../../src/game/courses';
import { blendCamera, boxOf, frameBox, READY_BLEND_SECONDS, READY_PAD } from '../../src/game/framing';
import { RunSession } from '../../src/game/session';
import { worldToScreen, type Camera } from '../../src/model/coords';
import { TOTAL_PINEAPPLES } from '../../src/model/score';
import { funnelGeometry } from '../../src/run/funnel';

const VIEWPORTS: [number, number][] = [
  [1280, 760],
  [800, 600],
  [844, 390], // phone landscape
];

describe('ready-phase framing', () => {
  for (const id of ['beach', 'kitchen', 'workbench', 'original', 'endless:PINE']) {
    it(`${id}: funnel top and cart are on screen, clear of the HUD pads, at every viewport`, async () => {
      const course = courseFor(id)!;
      const s = await RunSession.create(exampleCart(), course);
      try {
        s.start();
        for (let i = 0; i < 30; i++) s.step();
        const f = funnelGeometry(course.level.funnel, TOTAL_PINEAPPLES);
        const funnelPts = [...f.walls[0], ...f.walls[1]];
        const cartPts = s.controller.cartBodyHandles().map((h) => s.world.getTransform(h));
        const box = boxOf([...funnelPts, ...cartPts]);
        for (const [w, h] of VIEWPORTS) {
          const followZoom = Math.min(1.5, Math.max(0.5, w / (24 * 30)));
          const fr = frameBox({ minX: box.minX - 1, minY: box.minY - 1, maxX: box.maxX + 1, maxY: box.maxY + 1 }, w, h, followZoom);
          expect(fr.zoom).toBeLessThanOrEqual(followZoom);
          const cam: Camera = { center: fr.center, zoom: fr.zoom, viewportWidth: w, viewportHeight: h };
          for (const p of [...funnelPts, ...cartPts]) {
            const q = worldToScreen(p, cam);
            expect(q.x, `${id} ${w}x${h}`).toBeGreaterThanOrEqual(READY_PAD.side - 1);
            expect(q.x, `${id} ${w}x${h}`).toBeLessThanOrEqual(w - READY_PAD.side + 1);
            expect(q.y, `${id} ${w}x${h}`).toBeGreaterThanOrEqual(READY_PAD.top - 1);
            expect(q.y, `${id} ${w}x${h}`).toBeLessThanOrEqual(h - READY_PAD.bottom + 1);
          }
        }
      } finally {
        s.destroy();
      }
    }, 30_000);
  }

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
