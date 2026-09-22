/**
 * S6 audit fix cycle 1: run-screen resource acquisition (no leaked sessions
 * when a loader fails), the dev-only debug handle, and the builder Fit
 * framing the whole real funnel.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { exampleCart } from '../../src/builder/exampleCart';
import { BUILD_AREA, MOCK_FUNNEL } from '../../src/builder/constants';
import { designToScreen, fitArea, fitView } from '../../src/builder/view';
import { courseFor, SHIPPED_LEVEL_IDS } from '../../src/game/courses';
import { acquireRunResources } from '../../src/game/runResources';
import { RunSession } from '../../src/game/session';
import { startAreaPx } from '../../src/game/startArea';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('acquireRunResources', () => {
  it('destroys a created session when the assets loader rejects AFTER the session exists', async () => {
    const course = courseFor('beach')!;
    let created: RunSession | null = null;
    let rejectAssets!: (e: Error) => void;
    const assets = new Promise<never>((_, rej) => (rejectAssets = rej));
    const p = acquireRunResources({
      app: async () => 'app',
      lib: () => assets,
      session: async () => {
        created = await RunSession.create(exampleCart(), course);
        return created;
      },
    });
    // let the session finish first, then fail the textures
    for (let i = 0; i < 50 && !created; i++) await tick();
    expect(created).not.toBeNull();
    const s = created as unknown as RunSession;
    const destroySpy = vi.spyOn(s, 'destroy');
    expect(s.isDestroyed).toBe(false);
    rejectAssets(new Error('bad texture'));
    await expect(p).rejects.toThrow('bad texture');
    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(s.isDestroyed).toBe(true);
    expect(() => s.world.step()).toThrow(/after destroy/); // the WASM world is freed
  });

  it('destroys the session when the Pixi app loader rejects (sync throw included)', async () => {
    const destroy = vi.fn();
    await expect(
      acquireRunResources({
        app: () => {
          throw new Error('no webgl');
        },
        lib: async () => 'lib',
        session: async () => ({ destroy }),
      }),
    ).rejects.toThrow('no webgl');
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('rethrows a session failure with nothing to destroy, and returns all three on success', async () => {
    await expect(
      acquireRunResources({ app: async () => 1, lib: async () => 2, session: () => Promise.reject(new Error('invalid cart')) }),
    ).rejects.toThrow('invalid cart');
    const destroy = vi.fn();
    const ok = await acquireRunResources({ app: async () => 1, lib: async () => 2, session: async () => ({ destroy }) });
    expect(ok.app).toBe(1);
    expect(ok.lib).toBe(2);
    expect(destroy).not.toHaveBeenCalled();
  });
});

describe('run debug handle', () => {
  it('window.__prRun is assigned only under import.meta.env.DEV (no URL-param path)', () => {
    const src = readFileSync(new URL('../../src/game/runScreen.ts', import.meta.url), 'utf8');
    const assigns = [...src.matchAll(/^.*window\.__prRun\s*=(?!=).*$/gm)].map((m) => m[0].trim());
    // the set, plus the teardown reset (null) guarded by identity
    expect(assigns).toHaveLength(2);
    expect(assigns[0]).toMatch(/^if \(import\.meta\.env\.DEV\) window\.__prRun = \{/);
    expect(assigns[1]).toMatch(/^if \(import\.meta\.env\.DEV && window\.__prRun\?\.session === s\) window\.__prRun = null;$/);
    // every mention sits on a DEV-gated line (so the production bundle has none)
    const lines = src.split('\n').filter((l) => l.includes('window.__prRun'));
    for (const l of lines) expect(l).toMatch(/import\.meta\.env\.DEV/);
    expect(src).not.toMatch(/location\.search|URLSearchParams|['"]debug['"]/);
  });
});

describe('builder Fit frames the whole real funnel', () => {
  for (const id of [...SHIPPED_LEVEL_IDS, 'endless:ABC123']) {
    it(`${id}: every funnel wall/plug vertex is inside the fitted area and on screen`, () => {
      const c = courseFor(id)!;
      const sa = startAreaPx(c.level, c.source);
      const pts = [...sa.funnel.walls.flat(), ...sa.funnel.plug];
      const top = Math.min(...pts.map((p) => p.y));
      expect(top).toBeLessThan(-300); // walls reach well above the plug (~-333 px)
      const area = fitArea(BUILD_AREA, sa, MOCK_FUNNEL.y);
      expect(area.minY).toBeLessThan(top);
      for (const [w, h, reserve] of [
        [1280, 720, 180],
        [844, 390, 150], // phone landscape
      ] as const) {
        const v = fitView(area, w, h, reserve, 24);
        for (const p of pts) {
          const s = designToScreen(p, v);
          expect(s.y, `${id} ${w}x${h}`).toBeGreaterThanOrEqual(0);
          expect(s.y).toBeLessThanOrEqual(h);
          expect(s.x).toBeGreaterThanOrEqual(0);
          expect(s.x).toBeLessThanOrEqual(w - reserve);
        }
        // the build area is still fully framed
        expect(designToScreen({ x: BUILD_AREA.minX, y: BUILD_AREA.maxY }, v).y).toBeLessThanOrEqual(h);
      }
    });
  }

  it('without a real start area the S2 mock framing is unchanged', () => {
    expect(fitArea(BUILD_AREA, undefined, MOCK_FUNNEL.y)).toEqual({ ...BUILD_AREA, minY: Math.min(BUILD_AREA.minY, MOCK_FUNNEL.y - 10) });
  });
});
