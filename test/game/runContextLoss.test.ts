/**
 * GL1 (owner bug, Safari): mid-run / on Test Cart the world went blank navy
 * while the DOM HUD lived on — the run's page-singleton Pixi app had lost its
 * WebGL context and nothing handled it, so every later run rendered nothing
 * until a page reload.
 *
 * The real run screen is mounted with the real `runPixi` singleton and a real
 * RunSession; Pixi's Application, the SceneRenderer and the HUD are fakes on
 * a minimal fake DOM. The loss is the browser's `webglcontextlost` event fired
 * on the app's canvas, so every recovery assertion here fails if nothing
 * listens for it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ------------------------------------------------------------- fake DOM

class FakeTarget {
  private listeners = new Map<string, ((e: unknown) => void)[]>();
  addEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  fire(type: string): void {
    for (const f of [...(this.listeners.get(type) ?? [])]) f({ type, preventDefault() {} });
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
  className = '';
  type = '';
  constructor(public tagName: string) {
    super();
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
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
  override get textContent(): string {
    return this.children.map((c) => c.textContent).join('');
  }
  override set textContent(v: string) {
    for (const c of [...this.children]) c.remove();
    this.append(v);
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
  contains(n: FakeNode): boolean {
    for (let p = n.parent; p; p = p.parent) if (p === this) return true;
    return false;
  }
}

// ------------------------------------------------ Pixi / scene / HUD fakes

const { apps, scenes, FakeApp, FakeScene } = vi.hoisted(() => {
  const apps: FakeApp[] = [];
  const scenes: FakeScene[] = [];
  class FakeApp {
    renderer: object | undefined;
    inits = 0;
    destroyCalls = 0;
    /** Stage children still attached when the app was destroyed (must be none). */
    childrenAtDestroy: number | null = null;
    canvas = document.createElement('canvas') as unknown as FakeEl;
    stage = {
      children: [] as unknown[],
      addChild(c: unknown) {
        this.children.push(c);
      },
      removeChild(c: unknown) {
        const i = this.children.indexOf(c);
        if (i >= 0) this.children.splice(i, 1);
      },
    };
    ticker = { stop() {}, start() {} };
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
    render(): void {}
    destroy(): void {
      this.destroyCalls++;
      this.childrenAtDestroy = this.stage.children.length;
      this.canvas.remove();
      this.renderer = undefined;
    }
  }
  class FakeScene {
    view = {};
    destroyed = 0;
    constructor() {
      scenes.push(this);
    }
    setLevel(): void {}
    setCartDesign(): void {}
    resetSource(): void {}
    setFunnel(): void {}
    setFunnelOpen(): void {}
    setGoal(): void {}
    render(): void {}
    destroy(): void {
      this.destroyed++;
    }
  }
  return { apps, scenes, FakeApp, FakeScene };
});
type FakeApp = InstanceType<typeof FakeApp>;

vi.mock('pixi.js', async (orig) => ({ ...(await orig<typeof import('pixi.js')>()), Application: FakeApp }));
vi.mock('../../src/render/scene', () => ({ SceneRenderer: FakeScene }));
vi.mock('../../src/ui/appScreens', () => ({
  mountRunHudScreen: (host: FakeEl) => {
    const hud = document.createElement('div') as unknown as FakeEl;
    hud.setAttribute('data-testid', 'run-hud');
    host.appendChild(hud);
    return { destroy: () => hud.remove() };
  },
}));

import type { MountContext } from '../../src/app';
import { mountRunScreen, runPixi } from '../../src/game/runScreen';
import { resetCartState } from '../../src/game/cartState';
import { RunSession } from '../../src/game/session';
import { MAX_CONTEXT_RECOVERIES } from '../../src/render/sharedPixi';

// --------------------------------------------------------------- globals

let sessions: RunSession[] = [];

beforeEach(() => {
  runPixi.discard(); // the singleton outlives tests: isolate each one
  apps.length = 0;
  scenes.length = 0;
  sessions = [];
  const win = Object.assign(new FakeTarget(), { devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, matchMedia: () => ({ matches: false }) });
  const doc = Object.assign(new FakeTarget(), {
    visibilityState: 'visible',
    createElement: (tag: string) => new FakeEl(tag),
    createTextNode: (t: string) => new FakeNode(t),
  });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('requestAnimationFrame', () => 1); // frames never run: the loop is not under test
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const create = RunSession.create.bind(RunSession);
  vi.spyOn(RunSession, 'create').mockImplementation(async (...args) => {
    const s = await create(...args);
    sessions.push(s);
    return s;
  });
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
  for (let i = 0; i < 2000 && !cond(); i++) await tick();
  if (!cond()) throw new Error(`timed out waiting for ${what}`);
}

const ctx: MountContext = { isCurrent: () => true };
const mount = (host: FakeEl) =>
  mountRunScreen(host as unknown as HTMLElement, { name: 'run', levelId: 'beach' }, () => {}, ctx, {
    loaders: { assets: async () => ({}) as never }, // the Pixi app comes from the real runPixi singleton
    beadStorage: null,
  });
/** The browser reaps the app's WebGL context. */
const loseContext = (app: FakeApp) => app.canvas.fire('webglcontextlost');
/** A mounted run whose world is drawn by `app`: its canvas is in the host, next to the HUD. */
const runningOn = (host: FakeEl, app: FakeApp) => host.contains(app.canvas) && host.find('run-hud') !== null && host.find('screen-error') === null;

// ----------------------------------------------------------------- tests

describe('GL1: WebGL context loss on the run screen', () => {
  it('mid-run loss: the singleton is discarded and the run re-mounts onto a FRESH app (no page reload)', async () => {
    const host = new FakeEl('div');
    const screen = await mount(host);
    expect(apps).toHaveLength(1);
    const dead = apps[0]!;
    expect(runningOn(host, dead)).toBe(true);
    expect(dead.stage.children).toHaveLength(1);

    loseContext(dead);

    // torn down at once: no renderer drawing into the dead context, its views off the stage first
    expect(dead.destroyCalls).toBe(1);
    expect(dead.childrenAtDestroy).toBe(0);
    expect(scenes[0]!.destroyed).toBe(1);
    expect(sessions[0]!.isDestroyed).toBe(true);
    expect(host.contains(dead.canvas)).toBe(false);

    await until(() => apps.length === 2 && runningOn(host, apps[1]!), 'run re-mounted on a fresh app');
    const fresh = apps[1]!;
    expect(fresh.inits).toBe(1);
    expect(runPixi.isLive(fresh as never)).toBe(true);
    expect(await runPixi.acquire()).toBe(fresh); // the next pixi app is the new one, not the dead one
    expect(sessions).toHaveLength(2);
    expect(sessions[1]!.isDestroyed).toBe(false);
    expect(host.children).toHaveLength(1); // one run root, no leftovers

    screen.destroy();
    expect(host.children).toHaveLength(0);
    expect(fresh.destroyCalls).toBe(0); // unmount detaches, never destroys
    expect(fresh.stage.children).toHaveLength(0);
    expect(sessions.every((s) => s.isDestroyed)).toBe(true);
  });

  it(`after ${MAX_CONTEXT_RECOVERIES} automatic re-mounts: the error screen, whose Try again mounts a fresh app`, async () => {
    const host = new FakeEl('div');
    const screen = await mount(host);
    for (let i = 1; i <= MAX_CONTEXT_RECOVERIES; i++) {
      loseContext(apps.at(-1)!);
      await until(() => apps.length === i + 1 && runningOn(host, apps.at(-1)!), `re-mount ${i}`);
    }
    loseContext(apps.at(-1)!);
    await until(() => host.find('screen-error') !== null, 'error screen');
    expect(host.find('run-hud')).toBeNull(); // never the HUD over a blank world
    expect(host.children).toHaveLength(1);
    expect(apps.every((a) => a.destroyCalls === 1)).toBe(true);

    host.find('run-error-retry')!.click();
    await until(() => apps.length === MAX_CONTEXT_RECOVERIES + 2 && runningOn(host, apps.at(-1)!), 'retried run');
    expect(runPixi.isLive(apps.at(-1)! as never)).toBe(true);

    // a manual retry re-arms the automatic recovery
    loseContext(apps.at(-1)!);
    await until(() => apps.length === MAX_CONTEXT_RECOVERIES + 3 && runningOn(host, apps.at(-1)!), 're-armed re-mount');
    screen.destroy();
    expect(host.children).toHaveLength(0);
  });

  it('negative control: without a lost event nothing re-mounts; a restored event is ignored', async () => {
    const host = new FakeEl('div');
    const screen = await mount(host);
    apps[0]!.canvas.fire('webglcontextrestored');
    for (let i = 0; i < 20; i++) await tick();
    expect(apps).toHaveLength(1);
    expect(sessions).toHaveLength(1);
    expect(apps[0]!.destroyCalls).toBe(0);
    expect(runningOn(host, apps[0]!)).toBe(true);
    screen.destroy();
  });

  it('two runs share ONE app; a loss while no run is mounted is inert until the next run, which gets a fresh app', async () => {
    const a = new FakeEl('div');
    const s1 = await mount(a);
    s1.destroy();
    const b = new FakeEl('div');
    const s2 = await mount(b);
    expect(apps).toHaveLength(1);
    expect(apps[0]!.inits).toBe(1);
    s2.destroy();

    loseContext(apps[0]!); // e.g. Safari reaps it while the player is in the builder
    for (let i = 0; i < 20; i++) await tick();
    expect(a.children).toHaveLength(0);
    expect(b.children).toHaveLength(0);
    expect(apps[0]!.destroyCalls).toBe(1);

    const c = new FakeEl('div');
    const s3 = await mount(c);
    expect(apps).toHaveLength(2);
    expect(runningOn(c, apps[1]!)).toBe(true);
    s3.destroy();
  });
});
