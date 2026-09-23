/**
 * GL1: the page-shared Pixi Application with WebGL context-loss recovery
 * (src/render/sharedPixi.ts). A fake Application whose canvas is a real
 * (Node) EventTarget receives the browser's `webglcontextlost` /
 * `webglcontextrestored` events.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Application } from 'pixi.js';
import { CONTEXT_LOST_EVENT, CONTEXT_RESTORED_EVENT, createSharedPixi } from '../../src/render/sharedPixi';

class FakeCanvas extends EventTarget {
  removed = 0;
  remove(): void {
    this.removed++;
  }
}

class FakeApp {
  canvas = new FakeCanvas();
  renderer: { gl: { isContextLost(): boolean } } | null = { gl: { isContextLost: () => this.glLost } };
  glLost = false;
  destroyCalls: unknown[][] = [];
  destroy(...args: unknown[]): void {
    this.destroyCalls.push(args);
    this.renderer = null;
  }
}

function setup(opts: { initDelay?: Promise<void> } = {}) {
  const apps: FakeApp[] = [];
  const shared = createSharedPixi('test', async () => {
    const app = new FakeApp();
    apps.push(app);
    await opts.initDelay;
    return app as unknown as Application;
  });
  const lose = (app: FakeApp) => app.canvas.dispatchEvent(new Event(CONTEXT_LOST_EVENT));
  return { apps, shared, lose };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('createSharedPixi', () => {
  it('initialises ONE app and hands the same one to every acquire', async () => {
    const { apps, shared } = setup();
    const [a, b] = await Promise.all([shared.acquire(), shared.acquire()]);
    const c = await shared.acquire();
    expect(apps).toHaveLength(1);
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(shared.isLive(a)).toBe(true);
  });

  it('webglcontextlost: subscribers run BEFORE the app is destroyed, the singleton is discarded, and the next acquire builds a fresh app', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { apps, shared, lose } = setup();
    const first = await shared.acquire();
    const order: string[] = [];
    const fake = apps[0]!;
    const destroy = fake.destroy.bind(fake);
    fake.destroy = (...args: unknown[]) => {
      order.push('destroy');
      destroy(...args);
    };
    shared.onLost(first, () => order.push(`subscriber (destroyed=${fake.destroyCalls.length})`));

    lose(fake);

    expect(order).toEqual(['subscriber (destroyed=0)', 'destroy']);
    expect(fake.destroyCalls).toHaveLength(1);
    // the view goes, the page-cached textures and the screens' stage children stay
    expect(fake.destroyCalls[0]).toEqual([{ removeView: true }, { children: false }]);
    expect(shared.isLive(first)).toBe(false);
    const second = await shared.acquire();
    expect(apps).toHaveLength(2);
    expect(second).not.toBe(first);
    expect(shared.isLive(second)).toBe(true);
    vi.restoreAllMocks();
  });

  it('re-entrancy: a second lost event, a restored event, and the destroy-time loss of the old app recover exactly once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { apps, shared, lose } = setup();
    const app = await shared.acquire();
    const fn = vi.fn();
    shared.onLost(app, fn);
    lose(apps[0]!);
    lose(apps[0]!);
    apps[0]!.canvas.dispatchEvent(new Event(CONTEXT_RESTORED_EVENT));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(apps[0]!.destroyCalls).toHaveLength(1);
    // the fresh app is unaffected by events on the old canvas
    const fresh = await shared.acquire();
    const freshFn = vi.fn();
    shared.onLost(fresh, freshFn);
    lose(apps[0]!);
    expect(freshFn).not.toHaveBeenCalled();
    expect(shared.isLive(fresh)).toBe(true);
    vi.restoreAllMocks();
  });

  it('negative control: without a lost event (or with an unrelated one) nothing is discarded', async () => {
    const { apps, shared } = setup();
    const app = await shared.acquire();
    const fn = vi.fn();
    shared.onLost(app, fn);
    apps[0]!.canvas.dispatchEvent(new Event('webglcontextcreationerror'));
    apps[0]!.canvas.dispatchEvent(new Event(CONTEXT_RESTORED_EVENT));
    expect(fn).not.toHaveBeenCalled();
    expect(await shared.acquire()).toBe(app);
    expect(apps[0]!.destroyCalls).toHaveLength(0);
  });

  it('unsubscribed listeners are not called; an unowned app is never watched', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { apps, shared, lose } = setup();
    const app = await shared.acquire();
    const fn = vi.fn();
    shared.onLost(app, fn)();
    const other = new FakeApp();
    const otherFn = vi.fn();
    shared.onLost(other as unknown as Application, otherFn);
    lose(apps[0]!);
    lose(other);
    await tick();
    expect(fn).not.toHaveBeenCalled();
    expect(otherFn).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('subscribing to an app that was already lost still reports it (on a microtask)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { apps, shared, lose } = setup();
    const app = await shared.acquire();
    lose(apps[0]!);
    const fn = vi.fn();
    shared.onLost(app, fn);
    expect(fn).not.toHaveBeenCalled();
    await tick();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('a context found dead at acquire() (no event arrived) is replaced', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { apps, shared } = setup();
    const app = await shared.acquire();
    const fn = vi.fn();
    shared.onLost(app, fn);
    apps[0]!.glLost = true;
    const next = await shared.acquire();
    expect(next).not.toBe(app);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(apps[0]!.destroyCalls).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('an app discarded while still initialising is destroyed, never handed out; a failed init is retried', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { apps, shared } = setup({ initDelay: gate });
    const p = shared.acquire();
    shared.discard();
    release();
    await expect(p).rejects.toThrow(/reset/);
    expect(apps[0]!.destroyCalls).toHaveLength(1);
    const fresh = await shared.acquire();
    expect(apps).toHaveLength(2);
    expect(shared.isLive(fresh)).toBe(true);

    let fail = true;
    const flaky = createSharedPixi('flaky', async () => {
      if (fail) throw new Error('no webgl');
      return new FakeApp() as unknown as Application;
    });
    await expect(flaky.acquire()).rejects.toThrow('no webgl');
    fail = false;
    await expect(flaky.acquire()).resolves.toBeInstanceOf(FakeApp);
  });
});
