/**
 * GL1: the builder's Pixi Application is a page singleton (`builderPixi`) —
 * successive mounts reuse ONE app and an unmount never destroys it — and a
 * WebGL context loss while building tears the mount down, hands over the
 * CURRENT design, and the build screen re-mounts onto a fresh app with that
 * design (or, once the automatic re-mounts are spent, shows its error UI
 * whose retry mounts fresh — no page reload). Pixi's Application and the
 * builder's renderer are fakes; the builder runs for real on a fake DOM
 * (same pattern as mountFailure.test.ts). The loss is the browser's
 * `webglcontextlost` event fired on the app's canvas, so these tests fail if
 * nothing listens for it.
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

const { apps, FakeApp, FakeRenderer } = vi.hoisted(() => {
  const apps: FakeApp[] = [];
  class FakeApp {
    renderer: object | undefined;
    inits = 0;
    destroyCalls = 0;
    canvas = document.createElement('canvas') as unknown as { remove(): void; parent: unknown; fire(type: string): void };
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
    tickerRunning = true;
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
      this.inits++;
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
    setTheme(): void {}
    setStartArea(): void {}
    draw(): void {}
    destroy(): void {}
  }
  return { apps, FakeApp, FakeRenderer };
});
type FakeApp = InstanceType<typeof FakeApp>;

vi.mock('pixi.js', async (orig) => ({ ...(await orig<typeof import('pixi.js')>()), Application: FakeApp }));
vi.mock('../../src/builder/render', async (orig) => ({
  ...(await orig<typeof import('../../src/builder/render')>()),
  BuilderRenderer: FakeRenderer,
  BuilderLoupe: FakeRenderer,
  themeFromCss: () => ({}),
}));
vi.mock('../../src/ui/chrome', () => ({ installChrome: () => () => {} }));

import { builderPixi, mountBuilder, type BuilderHandle, type BuilderOptions } from '../../src/builder/builder';
import { exampleCart } from '../../src/builder/exampleCart';
import { mountBuildScreen } from '../../src/game/buildScreen';
import { draftDesign, resetCartState, setDraftDesign } from '../../src/game/cartState';
import type { CartDesign } from '../../src/model/cart';
import { MAX_CONTEXT_RECOVERIES } from '../../src/render/sharedPixi';

// --------------------------------------------------------------- globals

let liveObservers = 0;

beforeEach(() => {
  builderPixi.discard(); // the singleton outlives tests: isolate each one
  apps.length = 0;
  globalListeners = maxGlobalListeners = 0;
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
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
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
  vi.spyOn(console, 'warn').mockImplementation(() => {});
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

/** The browser reaps the app's WebGL context. */
const loseContext = (app: FakeApp) => app.canvas.fire('webglcontextlost');
const attachedTo = (app: FakeApp, host: FakeEl): boolean => {
  for (let n = app.canvas.parent as FakeEl | null; n; n = n.parent) if (n === host) return true;
  return false;
};
const edited = (): CartDesign => ({ ...exampleCart(), name: 'My cart', parts: exampleCart().parts.slice(0, 5) });

// ----------------------------------------------------------------- tests

describe('GL1: successive builder mounts reuse ONE Pixi application', () => {
  it('two mounts -> one init; unmount detaches (canvas, stage, ticker, resize target) but never destroys', async () => {
    const a = new FakeEl('div');
    const h1 = await mountBuilder(a as unknown as HTMLElement);
    expect(apps).toHaveLength(1);
    const app = apps[0]!;
    expect(attachedTo(app, a)).toBe(true);
    expect(app.tickerRunning).toBe(true);
    expect(app.resizeTo).not.toBeNull();
    expect(app.stage.children).toHaveLength(2);
    h1.destroy();
    expect(app.destroyCalls).toBe(0);
    expect(app.canvas.parent).toBeNull();
    expect(app.stage.children).toHaveLength(0);
    expect(app.tickerRunning).toBe(false);
    expect(app.resizeTo).toBeNull();

    const b = new FakeEl('div');
    const h2 = await mountBuilder(b as unknown as HTMLElement);
    expect(apps).toHaveLength(1); // no second Application...
    expect(app.inits).toBe(1); // ...and no second init
    expect(attachedTo(app, b)).toBe(true);
    expect(app.stage.children).toHaveLength(2); // this mount's scene + loupe only
    expect(app.tickerRunning).toBe(true);
    h2.destroy();
    expect(app.destroyCalls).toBe(0);
    expect(globalListeners).toBe(0);
    expect(liveObservers).toBe(0);
  });

  it('a stale child left on the shared stage is cleared by the next mount', async () => {
    const h1 = await mountBuilder(new FakeEl('div') as unknown as HTMLElement);
    h1.destroy();
    apps[0]!.stage.addChild({ stale: true });
    const h2 = await mountBuilder(new FakeEl('div') as unknown as HTMLElement);
    expect(apps[0]!.stage.children).toHaveLength(2);
    expect(apps[0]!.stage.children).not.toContainEqual({ stale: true });
    h2.destroy();
  });
});

describe('GL1: WebGL context loss while building', () => {
  it('mountBuilder: tears itself down and hands over the CURRENT design; the next mount gets a fresh app', async () => {
    const host = new FakeEl('div');
    const lost: CartDesign[] = [];
    const h = await mountBuilder(host as unknown as HTMLElement, { initialDesign: { version: 1, parts: [] }, onContextLost: (d) => lost.push(d) });
    h.setDesign(edited()); // an in-progress design no one else has seen (no onChange)
    const app = apps[0]!;

    loseContext(app);

    expect(lost).toEqual([edited()]);
    expect(host.children).toHaveLength(0); // not left mounted over a dead context
    expect(globalListeners).toBe(0);
    expect(liveObservers).toBe(0);
    expect(app.destroyCalls).toBe(1); // the dead app is discarded...
    h.destroy(); // ...and a late destroy is harmless
    expect(app.destroyCalls).toBe(1);

    const again = await mountBuilder(host as unknown as HTMLElement, { initialDesign: lost[0]! });
    expect(apps).toHaveLength(2); // ...and replaced
    expect(attachedTo(apps[1]!, host)).toBe(true);
    expect(again.getDesign()).toEqual(edited());
    again.destroy();
  });

  it('build screen: re-mounts in place on a fresh app with the design as it stood (no reload, no error)', async () => {
    const handles: BuilderHandle[] = [];
    const opts: BuilderOptions[] = [];
    const wrapped = async (h: HTMLElement, o: BuilderOptions = {}) => {
      opts.push(o);
      const handle = await mountBuilder(h, o);
      handles.push(handle);
      return handle;
    };
    const host = new FakeEl('div');
    const screen = await mountBuildScreen(host as unknown as HTMLElement, { name: 'build', levelId: 'workbench' }, () => {}, { isCurrent: () => true }, { mountBuilder: wrapped });
    handles[0]!.setDesign(edited());
    setDraftDesign({ version: 1, parts: [] }); // prove the design comes from the builder, not a stale draft

    loseContext(apps[0]!);
    await until(() => handles.length === 2 && host.find('build-back') !== null, 're-mounted builder');

    expect(apps).toHaveLength(2);
    expect(apps[0]!.destroyCalls).toBe(1);
    expect(attachedTo(apps[1]!, host)).toBe(true);
    expect(attachedTo(apps[0]!, host)).toBe(false);
    expect(opts[1]!.initialDesign).toEqual(edited());
    expect(handles[1]!.getDesign()).toEqual(edited());
    expect(draftDesign()).toEqual(edited());
    expect(host.find('screen-error')).toBeNull();
    expect(host.children).toHaveLength(1); // exactly one builder root
    screen.destroy();
    expect(host.children).toHaveLength(0);
    expect(globalListeners).toBe(0);
  });

  it(`after ${MAX_CONTEXT_RECOVERIES} automatic re-mounts the error UI shows; its retry mounts a fresh app with the design`, async () => {
    const handles: BuilderHandle[] = [];
    const wrapped = async (h: HTMLElement, o: BuilderOptions = {}) => {
      const handle = await mountBuilder(h, o);
      handles.push(handle);
      return handle;
    };
    const host = new FakeEl('div');
    const screen = await mountBuildScreen(host as unknown as HTMLElement, { name: 'build', levelId: 'workbench' }, () => {}, { isCurrent: () => true }, { mountBuilder: wrapped });
    handles[0]!.setDesign(edited());
    for (let i = 1; i <= MAX_CONTEXT_RECOVERIES; i++) {
      loseContext(apps.at(-1)!);
      await until(() => handles.length === i + 1, `re-mount ${i}`);
    }
    loseContext(apps.at(-1)!);
    await until(() => host.find('screen-error') !== null, 'error screen');
    expect(host.find('screen-error')!.textContent).toContain('Your cart is kept');
    expect(host.find('build-back')).toBeNull();
    expect(apps.every((a) => a.destroyCalls === 1)).toBe(true); // nothing drawing into a dead context

    host.find('build-error-retry')!.click();
    await until(() => host.find('build-back') !== null && handles.length === MAX_CONTEXT_RECOVERIES + 2, 'retried builder');
    expect(apps).toHaveLength(MAX_CONTEXT_RECOVERIES + 2);
    expect(attachedTo(apps.at(-1)!, host)).toBe(true);
    expect(handles.at(-1)!.getDesign()).toEqual(edited());
    expect(host.find('screen-error')).toBeNull();
    screen.destroy();
  });

  it('negative control: other canvas events do not re-mount; a loss after the screen was left is inert', async () => {
    const calls: number[] = [];
    const wrapped = async (h: HTMLElement, o: BuilderOptions = {}) => {
      calls.push(1);
      return mountBuilder(h, o);
    };
    const host = new FakeEl('div');
    const screen = await mountBuildScreen(host as unknown as HTMLElement, { name: 'build', levelId: 'workbench' }, () => {}, { isCurrent: () => true }, { mountBuilder: wrapped });
    apps[0]!.canvas.fire('webglcontextrestored');
    apps[0]!.canvas.fire('pointerleave');
    for (let i = 0; i < 10; i++) await tick();
    expect(calls).toHaveLength(1);
    expect(apps).toHaveLength(1);
    expect(apps[0]!.destroyCalls).toBe(0);

    screen.destroy();
    loseContext(apps[0]!); // the idle (detached) singleton dies: discarded, nothing re-mounts
    for (let i = 0; i < 10; i++) await tick();
    expect(calls).toHaveLength(1);
    expect(host.children).toHaveLength(0);
    expect(apps[0]!.destroyCalls).toBe(1);
    const next = await mountBuilder(new FakeEl('div') as unknown as HTMLElement);
    expect(apps).toHaveLength(2); // the next visit gets a fresh app
    next.destroy();
  });
});
