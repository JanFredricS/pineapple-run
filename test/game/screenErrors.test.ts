/**
 * S6 audit round 2, finding 1: a screen whose initialisation fails must show
 * a visible error with recovery actions (never a blank host), release what it
 * acquired, and leave App navigation working. The real run / build screens
 * are mounted (through the real App state machine) on a minimal fake DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/ui/chrome', () => ({ installChrome: () => () => {} }));

import { App, type AppState, type MountContext, type Screen } from '../../src/app';
import type { BuilderHandle } from '../../src/builder/builder';
import { mountBuildScreen } from '../../src/game/buildScreen';
import { resetCartState } from '../../src/game/cartState';
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
