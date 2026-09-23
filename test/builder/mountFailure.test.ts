/**
 * S6 audit round 3, finding 1: `mountBuilder()` must release everything it
 * acquired (its hold on the Pixi application, renderer, global listeners,
 * observer, animation frames, DOM) when any step AFTER Pixi init throws — and
 * "Try again" on the build screen must not accumulate Pixi applications.
 * GL1: the builder's Application is now a page singleton (`builderPixi`), so
 * "released" means DETACHED (canvas out of the DOM, stage empty, ticker
 * stopped, no resize target) — never destroyed by an unmount — and every
 * mount/retry reuses the one app. Pixi's Application and the builder's
 * renderer are replaced with counting fakes; the rest of the builder runs for
 * real on a minimal fake DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ------------------------------------------------------------ fake DOM

/** Live listeners on window + document (per-element ones die with the DOM). */
let globalListeners = 0;
let maxGlobalListeners = 0;

class FakeTarget {
  private listeners = new Map<string, ((e: unknown) => void)[]>();
  constructor(private readonly global = false) {}
  addEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    if (this.global) maxGlobalListeners = Math.max(maxGlobalListeners, ++globalListeners);
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    const i = list.indexOf(fn);
    if (i < 0) return;
    list.splice(i, 1);
    if (this.global) globalListeners--;
  }
  fire(type: string): void {
    for (const f of [...(this.listeners.get(type) ?? [])]) f({ type, detail: 0 });
  }
}

class FakeNode extends FakeTarget {
  parent: FakeEl | null = null;
  constructor(public text = '') {
    super();
  }
  remove(): void {
    if (!this.parent) return;
    const kids = this.parent.children;
    kids.splice(kids.indexOf(this), 1);
    this.parent = null;
  }
  get textContent(): string {
    return this.text;
  }
}

class FakeEl extends FakeNode {
  children: FakeNode[] = [];
  attrs = new Map<string, string>();
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  className = '';
  innerHTML = '';
  title = '';
  type = '';
  value = '';
  hidden = false;
  open = false;
  disabled = false;
  tabIndex = -1;
  constructor(public tagName: string) {
    super();
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  removeAttribute(k: string): void {
    this.attrs.delete(k);
  }
  append(...nodes: (FakeNode | string)[]): void {
    for (const n of nodes) this.appendChild(typeof n === 'string' ? new FakeNode(n) : n);
  }
  appendChild(n: FakeNode): FakeNode {
    n.remove();
    n.parent = this;
    this.children.push(n);
    return n;
  }
  replaceChildren(): void {
    for (const c of [...this.children]) c.remove();
  }
  get firstElementChild(): FakeEl | null {
    return (this.children.find((c) => c instanceof FakeEl) as FakeEl | undefined) ?? null;
  }
  override get textContent(): string {
    return this.children.map((c) => c.textContent).join('');
  }
  override set textContent(v: string) {
    this.replaceChildren();
    if (v) this.append(v);
  }
  focus(): void {}
  setPointerCapture(): void {}
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
  }
  click(): void {
    this.fire('click');
  }
  find(testId: string): FakeEl | null {
    for (const c of this.children) {
      if (!(c instanceof FakeEl)) continue;
      if (c.getAttribute('data-testid') === testId) return c;
      const r = c.find(testId);
      if (r) return r;
    }
    return null;
  }
}

// ------------------------------------------------------ Pixi / renderer fakes

const { apps, renderers, fakes, FakeApp, FakeRenderer } = vi.hoisted(() => {
  const apps: { destroyCalls: number; canvas: { parent: unknown }; stage: { children: unknown[] }; tickerRunning: boolean; resizeTo: unknown }[] = [];
  const renderers: { destroyCalls: number }[] = [];
  const fakes = { rendererThrows: false };
  class FakeApp {
    renderer: object | undefined;
    destroyCalls = 0;
    canvas = document.createElement('canvas') as unknown as { remove(): void; parent: unknown };
    stage = {
      children: [] as unknown[],
      addChild(c: unknown) {
        this.children.push(c);
      },
      removeChild(c: unknown) {
        const i = this.children.indexOf(c);
        if (i >= 0) this.children.splice(i, 1);
      },
      removeChildren() {
        this.children.length = 0;
      },
    };
    tickerRunning = true; // Pixi's default autoStart
    ticker = {
      start: () => void (this.tickerRunning = true),
      stop: () => void (this.tickerRunning = false),
    };
    resizeTo: unknown = null;
    screen = { width: 800, height: 600 };
    constructor() {
      apps.push(this);
    }
    async init(): Promise<void> {
      this.renderer = {};
    }
    resize(): void {}
    destroy(): void {
      this.destroyCalls++;
      this.canvas.remove();
      this.renderer = undefined;
    }
  }
  class FakeRenderer {
    view = {};
    destroyCalls = 0;
    constructor() {
      if (fakes.rendererThrows) throw new Error('renderer init failed');
      renderers.push(this);
    }
    setTheme(): void {}
    setStartArea(): void {}
    draw(): void {}
    destroy(): void {
      this.destroyCalls++;
    }
  }
  return { apps, renderers, fakes, FakeApp, FakeRenderer };
});
const liveApps = () => apps.filter((a) => a.destroyCalls === 0).length;
/** The shared app is not held by any mount: canvas out of the DOM, empty stage, ticker stopped, no resize target. */
const detached = (a: (typeof apps)[number]) => a.canvas.parent === null && a.stage.children.length === 0 && !a.tickerRunning && a.resizeTo === null;

vi.mock('pixi.js', async (orig) => ({ ...(await orig<typeof import('pixi.js')>()), Application: FakeApp }));
vi.mock('../../src/builder/render', async (orig) => ({
  ...(await orig<typeof import('../../src/builder/render')>()),
  BuilderRenderer: FakeRenderer,
  themeFromCss: () => ({}),
}));
vi.mock('../../src/ui/chrome', () => ({ installChrome: () => () => {} }));

import { builderPixi, mountBuilder } from '../../src/builder/builder';
import { CartStore } from '../../src/builder/storage';
import { mountBuildScreen } from '../../src/game/buildScreen';
import { resetCartState } from '../../src/game/cartState';

// --------------------------------------------------------------- globals

const frames = new Set<number>();
let nextFrame = 1;
let liveObservers = 0;

beforeEach(() => {
  builderPixi.discard(); // GL1: the builder's app is a page singleton; isolate each test
  apps.length = 0;
  renderers.length = 0;
  fakes.rendererThrows = false;
  globalListeners = maxGlobalListeners = 0;
  frames.clear();
  liveObservers = 0;
  const storage = new Map<string, string>();
  const win = Object.assign(new FakeTarget(true), {
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }),
    setTimeout,
    clearTimeout,
    localStorage: {
      get length() {
        return storage.size;
      },
      key: (i: number) => [...storage.keys()][i] ?? null,
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
  });
  const doc = Object.assign(new FakeTarget(true), {
    visibilityState: 'visible',
    createElement: (tag: string) => new FakeEl(tag),
    createTextNode: (t: string) => new FakeNode(t),
  });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('requestAnimationFrame', () => {
    const id = nextFrame++;
    frames.add(id);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => void frames.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        liveObservers++;
      }
      disconnect() {
        liveObservers--;
      }
    },
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
  resetCartState();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 500 && !cond(); i++) await tick();
  if (!cond()) throw new Error(`timed out waiting for ${what}`);
}

function expectNothingLive(host: FakeEl): void {
  // GL1: at most the ONE shared app exists, alive but detached from every mount
  expect(apps.length).toBeLessThanOrEqual(1);
  expect(apps.every((a) => a.destroyCalls === 0 && detached(a))).toBe(true);
  expect(renderers.every((r) => r.destroyCalls === 1)).toBe(true);
  expect(globalListeners).toBe(0);
  expect(liveObservers).toBe(0);
  expect(frames.size).toBe(0);
  expect(host.children).toHaveLength(0);
}

// ----------------------------------------------------------------- tests

describe('mountBuilder: a failure after Pixi init releases everything acquired', () => {
  it('the renderer constructor throws -> the shared Pixi app is detached (kept for the next mount) and the root removed', async () => {
    fakes.rendererThrows = true;
    const host = new FakeEl('div');
    await expect(mountBuilder(host as unknown as HTMLElement)).rejects.toThrow('renderer init failed');
    expect(apps).toHaveLength(1);
    expect(apps[0]!.destroyCalls).toBe(0);
    expectNothingLive(host);
  });

  it('the last setup step throws -> app, renderer, window/document listeners, observer and frames are all released', async () => {
    const store = new CartStore(() => window.localStorage);
    vi.spyOn(store, 'list').mockImplementation(() => {
      throw new Error('storage exploded');
    });
    const host = new FakeEl('div');
    await expect(mountBuilder(host as unknown as HTMLElement, { store })).rejects.toThrow('storage exploded');
    expect(maxGlobalListeners).toBeGreaterThan(0); // they were acquired...
    expect(renderers).toHaveLength(1);
    expect(apps[0]!.destroyCalls).toBe(0);
    expectNothingLive(host); // ...and released
  });

  it('a successful mount acquires them and destroy() (twice) releases each exactly once', async () => {
    const host = new FakeEl('div');
    const h = await mountBuilder(host as unknown as HTMLElement);
    expect(liveApps()).toBe(1);
    expect(detached(apps[0]!)).toBe(false); // canvas in the stage, views on the Pixi stage, ticker running
    expect(apps[0]!.stage.children).toHaveLength(2); // scene + loupe
    expect(globalListeners).toBeGreaterThan(0);
    expect(liveObservers).toBe(1);
    h.destroy();
    h.destroy();
    expect(apps[0]!.destroyCalls).toBe(0); // GL1: the shared app outlives the mount
    expectNothingLive(host);
  });
});

describe('build screen "Try again" with the real mountBuilder does not accumulate Pixi apps', () => {
  it('two failed attempts leave nothing attached; the successful retry reuses the ONE app, detached on destroy', async () => {
    fakes.rendererThrows = true;
    const host = new FakeEl('div');
    const screen = await mountBuildScreen(host as unknown as HTMLElement, { name: 'build', levelId: 'workbench' }, () => {}, { isCurrent: () => true });
    expect(host.find('screen-error')!.textContent).toContain('renderer init failed');
    expect(apps).toHaveLength(1);
    expect(detached(apps[0]!)).toBe(true);

    const attempts = renderers.length;
    host.find('build-error-retry')!.click();
    await until(() => host.find('screen-error') !== null && host.find('build-back') === null && globalListeners === 0 && renderers.length === attempts, 'second failure');
    for (let i = 0; i < 5; i++) await tick();
    expect(host.find('screen-error')).not.toBeNull();
    expect(apps).toHaveLength(1); // no accumulation: not even a second app
    expect(detached(apps[0]!)).toBe(true);
    expect(globalListeners).toBe(0);

    fakes.rendererThrows = false;
    host.find('build-error-retry')!.click();
    await until(() => host.find('build-back') !== null && liveObservers === 1, 'builder mounted');
    await tick();
    expect(apps).toHaveLength(1);
    expect(liveApps()).toBe(1);
    expect(detached(apps[0]!)).toBe(false);
    expect(host.children).toHaveLength(1);

    screen.destroy();
    expectNothingLive(host);
  });
});
