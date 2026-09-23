/**
 * S6 audit round 2, finding 1: a screen whose initialisation fails must show
 * a visible error with recovery actions (never a blank host), release what it
 * acquired, and leave App navigation working. The real run / build screens
 * are mounted (through the real App state machine) on a minimal fake DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/ui/chrome', () => ({ installChrome: () => () => {} }));

import { App, type AppState, type MountContext, type Screen } from '../../src/app';
import type { BuilderHandle, BuilderOptions } from '../../src/builder/builder';
import { mountBuildScreen } from '../../src/game/buildScreen';
import { draftDesign, resetCartState, setTestedDesign, testedDesign } from '../../src/game/cartState';
import { exampleCart } from '../../src/builder/exampleCart';
import type { CartDesign } from '../../src/model/cart';
import { mountRunScreen } from '../../src/game/runScreen';
import { RunSession } from '../../src/game/session';

// ------------------------------------------------------------- fake DOM

class FakeNode {
  parent: FakeEl | null = null;
  constructor(public text = '') {}
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
  private listeners = new Map<string, ((e: unknown) => void)[]>();
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
  replaceChildren(): void {
    for (const c of [...this.children]) c.remove();
  }
  override get textContent(): string {
    return this.children.map((c) => c.textContent).join('');
  }
  override set textContent(v: string) {
    this.replaceChildren();
    this.append(v);
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  click(): void {
    for (const f of this.listeners.get('click') ?? []) f({ type: 'click' });
  }
  /** Depth-first search by data-testid. */
  find(testId: string): FakeEl | null {
    for (const c of this.children) {
      if (!(c instanceof FakeEl)) continue;
      if (c.getAttribute('data-testid') === testId) return c;
      const r = c.find(testId);
      if (r) return r;
    }
    return null;
  }
  count(testId: string): number {
    let n = 0;
    for (const c of this.children) {
      if (!(c instanceof FakeEl)) continue;
      if (c.getAttribute('data-testid') === testId) n++;
      n += c.count(testId);
    }
    return n;
  }
}

const fakeDocument = {
  createElement: (tag: string) => new FakeEl(tag),
  createTextNode: (t: string) => new FakeNode(t),
};

beforeEach(() => {
  vi.stubGlobal('document', fakeDocument);
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

// ---------------------------------------------------------------- tests

describe('run screen: a failed start shows an error with recovery (not a blank screen)', () => {
  it('texture loading fails after the session exists -> session destroyed, error shown, Back to builder navigates', async () => {
    const sessions: RunSession[] = [];
    const create = RunSession.create.bind(RunSession);
    vi.spyOn(RunSession, 'create').mockImplementation(async (d, c) => {
      const s = await create(d, c);
      sessions.push(s);
      return s;
    });
    let assetCalls = 0;
    const assets = async () => {
      assetCalls++;
      // reject only once the session has been built (the audited ordering)
      await until(() => sessions.length === assetCalls, 'session');
      throw new Error('missing texture: beach/sand.png');
    };
    const buildMounts: string[] = [];
    const host = new FakeEl('div');
    const app = new App(host as unknown as HTMLElement, { name: 'run', levelId: 'beach' }, {
      pwa: false,
      screens: {
        run: (h, st, d, ctx) =>
          mountRunScreen(h, st as Extract<AppState, { name: 'run' }>, d, ctx, {
            loaders: { app: async () => ({}) as never, assets },
          }),
        build: (h, st) => {
          buildMounts.push((st as Extract<AppState, { name: 'build' }>).levelId);
          return { destroy() {} };
        },
      },
    });
    await app.start();

    // visible error, with the loader's message and both recovery actions
    const err = host.find('screen-error');
    expect(err, 'error screen').not.toBeNull();
    expect(err!.getAttribute('role')).toBe('alert');
    expect(err!.textContent).toContain('Could not start the run');
    expect(err!.textContent).toContain('missing texture: beach/sand.png');
    expect(host.find('run-error-retry')).not.toBeNull();
    expect(host.children).toHaveLength(1); // the run root was removed; only the error remains
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.isDestroyed).toBe(true); // nothing leaked

    // Try again: re-attempts in place (a new session, destroyed again), still one error screen
    host.find('run-error-retry')!.click();
    await until(() => assetCalls === 2 && host.count('screen-error') === 1, 'second attempt');
    expect(sessions).toHaveLength(2);
    expect(sessions[1]!.isDestroyed).toBe(true);
    expect(host.children).toHaveLength(1);
    expect(app.current.name).toBe('run');

    // Back to builder: App navigation still works
    host.find('run-error-back')!.click();
    await until(() => app.current.name === 'build', 'build state');
    expect(app.current).toEqual({ name: 'build', levelId: 'beach' });
    expect(buildMounts).toEqual(['beach']);
    expect(host.find('screen-error')).toBeNull();
    app.destroy();
  });

  it('Pixi init fails -> error shown; destroying the screen removes it and a late retry is inert', async () => {
    const host = new FakeEl('div');
    const ctx: MountContext = { isCurrent: () => true };
    let appCalls = 0;
    const screen = await mountRunScreen(host as unknown as HTMLElement, { name: 'run', levelId: 'kitchen' }, () => {}, ctx, {
      loaders: {
        app: () => {
          appCalls++;
          return Promise.reject(new Error('WebGL unavailable'));
        },
        assets: async () => ({}) as never,
      },
    });
    expect(host.find('screen-error')!.textContent).toContain('WebGL unavailable');
    const retry = host.find('run-error-retry')!;
    screen.destroy();
    expect(host.children).toHaveLength(0);
    retry.click(); // stale button from a destroyed screen
    for (let i = 0; i < 20; i++) await tick();
    expect(host.children).toHaveLength(0);
    expect(appCalls).toBe(1);
  });
});

describe('build screen: a failed builder mount shows an error with recovery', () => {
  it('error shown, Levels navigates, Try again re-mounts the builder', async () => {
    const dispatched: string[] = [];
    let calls = 0;
    const handle = { destroy: vi.fn() } as unknown as BuilderHandle;
    const mountBuilder = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error('canvas init failed');
      return handle;
    });
    const host = new FakeEl('div');
    const ctx: MountContext = { isCurrent: () => true };
    const screen: Screen = await mountBuildScreen(
      host as unknown as HTMLElement,
      { name: 'build', levelId: 'workbench' },
      (a) => void dispatched.push(a.type),
      ctx,
      { mountBuilder },
    );
    expect(host.find('screen-error')!.textContent).toContain('canvas init failed');
    expect(host.find('build-back')).toBeNull(); // the half-built builder root is gone
    host.find('build-error-back')!.click();
    expect(dispatched).toEqual(['backToSelect']);

    host.find('build-error-retry')!.click();
    await until(() => calls === 2, 'builder re-mount');
    await mountBuilder.mock.results[1]!.value;
    await tick();
    expect(host.find('build-back')).not.toBeNull();
    expect(host.find('screen-error')).toBeNull();
    screen.destroy();
    expect(handle.destroy).toHaveBeenCalledTimes(1);
    expect(host.children).toHaveLength(0);
  });
});

describe('UX1: the builder opens EMPTY on a fresh entry and keeps the current design afterwards', () => {
  async function enter(levelId: string): Promise<{ initial: CartDesign; opts: BuilderOptions; screen: Screen; dispatched: string[] }> {
    const captured: BuilderOptions[] = [];
    const mountBuilder = async (_host: HTMLElement, o: BuilderOptions = {}): Promise<BuilderHandle> => {
      captured.push(o);
      return { destroy() {} } as unknown as BuilderHandle;
    };
    const dispatched: string[] = [];
    const screen = await mountBuildScreen(new FakeEl('div') as unknown as HTMLElement, { name: 'build', levelId }, (a) => void dispatched.push(a.type), { isCurrent: () => true }, { mountBuilder });
    const opts = captured[0];
    if (!opts?.initialDesign) throw new Error('builder not mounted');
    return { initial: opts.initialDesign, opts, screen, dispatched };
  }

  it('fresh entry: no parts (the Example Cart button loads the demo); later entries restore the draft / tested cart', async () => {
    const first = await enter('beach');
    expect(first.initial.parts).toEqual([]);
    // the player loads the example and edits it: the draft follows every change
    const edited: CartDesign = { ...exampleCart(), parts: exampleCart().parts.slice(0, 3) };
    first.opts.onChange!(edited);
    first.screen.destroy();
    // back to levels -> another course: the same cart is carried over
    const other = await enter('kitchen');
    expect(other.initial).toEqual(edited);
    // Test Cart -> run -> back to the builder: the tested cart is restored, and Retry replays it
    other.opts.onTestCart!(exampleCart(), undefined as never);
    expect(other.dispatched).toEqual(['startRun']);
    other.screen.destroy();
    expect(testedDesign()).toEqual(exampleCart());
    const back = await enter('kitchen');
    expect(back.initial).toEqual(exampleCart());
    // an emptied builder stays empty (Clear all is the player's choice)
    back.opts.onChange!({ version: 1, parts: [] });
    back.screen.destroy();
    expect((await enter('kitchen')).initial.parts).toEqual([]);
  });

  it('cartState: nothing set -> empty draft; the run-only fallback stays the example cart', () => {
    expect(draftDesign().parts).toEqual([]);
    expect(testedDesign()).toEqual(exampleCart());
    setTestedDesign(exampleCart());
    expect(draftDesign()).toEqual(exampleCart());
  });
});

/** A promise the test settles by hand (holds a mount attempt mid-flight). */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

describe('S6 audit round 3, finding 2: retry is guarded against concurrent / stale attempts', () => {
  function spySessions(): RunSession[] {
    const sessions: RunSession[] = [];
    const create = RunSession.create.bind(RunSession);
    vi.spyOn(RunSession, 'create').mockImplementation(async (d, c) => {
      const s = await create(d, c);
      sessions.push(s);
      return s;
    });
    return sessions;
  }

  it('run: a second retry activation while the first attempt is in flight is a no-op', async () => {
    const sessions = spySessions();
    const held = deferred<never>();
    let appCalls = 0;
    const host = new FakeEl('div');
    const screen = await mountRunScreen(host as unknown as HTMLElement, { name: 'run', levelId: 'beach' }, () => {}, { isCurrent: () => true }, {
      loaders: {
        app: () => (++appCalls === 1 ? Promise.reject(new Error('WebGL unavailable')) : held.promise),
        assets: async () => ({}) as never,
      },
    });
    const retry = host.find('run-error-retry')!;
    retry.click();
    retry.click(); // queued / programmatic second activation of the same control
    await until(() => sessions.length === 2, 'retry session');
    for (let i = 0; i < 10; i++) await tick();
    expect(appCalls).toBe(2); // exactly one retry attempt started
    expect(sessions).toHaveLength(2);
    expect(host.count('screen-error')).toBe(0);
    expect(host.children).toHaveLength(1); // the single in-flight run root

    held.reject(new Error('still no WebGL'));
    await until(() => host.count('screen-error') === 1, 'second error');
    expect(host.children).toHaveLength(1);
    expect(sessions.every((s) => s.isDestroyed)).toBe(true);
    screen.destroy();
    expect(host.children).toHaveLength(0);
  });

  it('run: an attempt that completes after the screen was destroyed releases its own session and root', async () => {
    const sessions = spySessions();
    const held = deferred<never>();
    let assetCalls = 0;
    const host = new FakeEl('div');
    const screen = await mountRunScreen(host as unknown as HTMLElement, { name: 'run', levelId: 'beach' }, () => {}, { isCurrent: () => true }, {
      loaders: {
        app: async () => ({}) as never,
        assets: () => (++assetCalls === 1 ? Promise.reject(new Error('missing texture')) : held.promise),
      },
    });
    host.find('run-error-retry')!.click();
    await until(() => sessions.length === 2 && assetCalls === 2, 'retry in flight');
    screen.destroy(); // e.g. the player navigated away mid-load
    expect(sessions[1]!.isDestroyed).toBe(false); // still owned by the in-flight attempt
    held.resolve({} as never); // the stale attempt now completes successfully
    for (let i = 0; i < 20; i++) await tick();
    expect(host.children).toHaveLength(0); // it did not install itself
    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => s.isDestroyed)).toBe(true);
  });

  it('build: double retry mounts exactly one builder; destroy releases it; nothing else survives', async () => {
    const held = deferred<BuilderHandle>();
    const handles: { destroy: ReturnType<typeof vi.fn> }[] = [];
    const mountBuilder = vi.fn(async () => {
      if (mountBuilder.mock.calls.length === 1) throw new Error('canvas init failed');
      const h = await held.promise;
      handles.push(h as never);
      return h;
    });
    const host = new FakeEl('div');
    const screen = await mountBuildScreen(host as unknown as HTMLElement, { name: 'build', levelId: 'workbench' }, () => {}, { isCurrent: () => true }, {
      mountBuilder,
    });
    const retry = host.find('build-error-retry')!;
    retry.click();
    retry.click();
    for (let i = 0; i < 10; i++) await tick();
    expect(mountBuilder).toHaveBeenCalledTimes(2); // one failure + one retry, not two
    held.resolve({ destroy: vi.fn() } as unknown as BuilderHandle);
    await until(() => handles.length === 1 && host.count('build-back') === 1, 'builder mounted');
    await tick();
    expect(host.children).toHaveLength(1);
    expect(host.count('build-back')).toBe(1);
    retry.click(); // a stale error screen's button stays inert after success
    for (let i = 0; i < 10; i++) await tick();
    expect(mountBuilder).toHaveBeenCalledTimes(2);
    expect(host.count('build-back')).toBe(1);
    screen.destroy();
    expect(handles[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(host.children).toHaveLength(0);
  });

  it('build: a builder mount that completes after destroy is destroyed, not installed', async () => {
    const held = deferred<BuilderHandle>();
    const handle = { destroy: vi.fn() } as unknown as BuilderHandle;
    let calls = 0;
    const mountBuilder = vi.fn(async () => {
      if (++calls === 1) throw new Error('canvas init failed');
      return held.promise;
    });
    const host = new FakeEl('div');
    const screen = await mountBuildScreen(host as unknown as HTMLElement, { name: 'build', levelId: 'workbench' }, () => {}, { isCurrent: () => true }, {
      mountBuilder,
    });
    host.find('build-error-retry')!.click();
    await until(() => calls === 2, 'retry in flight');
    screen.destroy();
    held.resolve(handle);
    for (let i = 0; i < 20; i++) await tick();
    expect(handle.destroy).toHaveBeenCalledTimes(1);
    expect(host.children).toHaveLength(0);
  });
});

describe('App fallback', () => {
  it('a screen factory that throws (e.g. a lazy chunk failed) renders a reload prompt, not a blank host', async () => {
    const host = new FakeEl('div');
    const app = new App(host as unknown as HTMLElement, { name: 'title' }, {
      pwa: false,
      screens: {
        title: () => Promise.reject(new Error('Failed to fetch dynamically imported module')),
      },
    });
    await app.start();
    expect(host.find('app-error')!.textContent).toContain('Failed to fetch dynamically imported module');
    expect(host.find('app-error-reload')).not.toBeNull();
    app.destroy();
    expect(host.children).toHaveLength(0);
  });
});
