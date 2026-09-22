/**
 * Audit fix cycle 1: record-once results (finding 4), App.destroy() cancels the
 * chrome install (finding 6), rotate overlay teardown (finding 6).
 * Node env: DOM pieces are minimal fakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const installChrome = vi.fn(() => () => {});
vi.mock('../../src/ui/chrome', () => ({ installChrome }));

import { App, transition, type AppState, type MountContext, type ScreenFactory } from '../../src/app';
import { isResultRecorded, resultsFor } from '../../src/ui/resultsModel';
import { ScoreStore } from '../../src/ui/scoreStore';

class MemStorage {
  data = new Map<string, string>();
  writes = 0;
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.writes++;
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

const fakeHost = () => ({ replaceChildren() {}, appendChild() {} }) as unknown as HTMLElement;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('record once, render many (resultId)', () => {
  const goal = { type: 'goalReached' as const, simTime: 25, delivered: 11 };

  it('same resultId records once and renders the identical model', () => {
    const storage = new MemStorage();
    const store = new ScoreStore(storage);
    const spy = vi.spyOn(store, 'recordLevel');
    const input = { levelId: 'beach', outcome: goal };
    const a = resultsFor('r1', input, store);
    const b = resultsFor('r1', input, store);
    expect(b).toBe(a);
    expect(a).toMatchObject({ newBest: true, saved: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(storage.writes).toBe(1);
    expect(isResultRecorded('r1', store)).toBe(true);
    // a genuinely new run (new id) records again: equal run -> not a new best
    const c = resultsFor('r2', input, store);
    expect(c).toMatchObject({ newBest: false });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('endless: re-mount never double-records or flips "new best"', () => {
    const store = new ScoreStore(new MemStorage());
    const input = { levelId: 'endless:ABC', outcome: { type: 'gaveUp' as const, simTime: 9 }, endless: { furthestMetres: 90, aboard: 2 } };
    const first = resultsFor('e1', input, store);
    const again = resultsFor('e1', input, store);
    expect(again).toEqual(first);
    expect(again).toMatchObject({ newSeedBest: true, newOverallBest: true });
  });

  it('transition carries resultId; App stamps one on runEnded and on bare results states', async () => {
    const outcome = { type: 'gaveUp' as const, simTime: 3 };
    expect(transition({ name: 'run', levelId: 'beach' }, { type: 'runEnded', outcome, resultId: 'x' })).toEqual({
      name: 'results',
      levelId: 'beach',
      outcome,
      resultId: 'x',
    });
    const seen: AppState[] = [];
    const f: ScreenFactory = (_h, s) => (seen.push(s), { destroy() {} });
    const app = new App(fakeHost(), { name: 'run', levelId: 'beach' }, { screens: { run: f, results: f } });
    await app.dispatch({ type: 'runEnded', outcome });
    const cur = app.current;
    expect(cur.name === 'results' && typeof cur.resultId).toBe('string');
    expect(seen.at(-1)).toBe(cur);

    const bare = new App(fakeHost(), { name: 'results', levelId: 'beach', outcome }, { screens: { results: f } });
    await (bare as unknown as { mount(): Promise<void> }).mount();
    const id1 = bare.current.name === 'results' ? bare.current.resultId : undefined;
    await (bare as unknown as { mount(): Promise<void> }).mount();
    expect(id1).toBeTruthy();
    expect(bare.current.name === 'results' && bare.current.resultId).toBe(id1);
  });

  it('stale mounts see isCurrent() === false and must not write', async () => {
    const storage = new MemStorage();
    const store = new ScoreStore(storage);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const ctxs: MountContext[] = [];
    const results: ScreenFactory = async (_h, s, _d, ctx) => {
      ctxs.push(ctx);
      await gate; // slow module load
      if (ctx.isCurrent() && s.name === 'results') resultsFor(s.resultId!, s, store);
      return { destroy() {} };
    };
    const noop: ScreenFactory = () => ({ destroy() {} });
    const app = new App(fakeHost(), { name: 'run', levelId: 'beach' }, { screens: { results, run: noop, build: noop } });
    const pending = app.dispatch({ type: 'runEnded', outcome: { type: 'goalReached', simTime: 25, delivered: 11 } });
    await app.dispatch({ type: 'backToBuild' }); // supersedes the results mount
    release();
    await pending;
    expect(ctxs[0]!.isCurrent()).toBe(false);
    expect(storage.writes).toBe(0);
  });

  it('mountAppScreen skips a stale results mount without recording', async () => {
    const { mountAppScreen, setScoreStore } = await import('../../src/ui/appScreens');
    const storage = new MemStorage();
    setScoreStore(new ScoreStore(storage));
    const state: AppState = { name: 'results', levelId: 'beach', outcome: { type: 'goalReached', simTime: 25, delivered: 11 }, resultId: 'stale-1' };
    const screen = mountAppScreen(fakeHost(), state, () => {}, { isCurrent: () => false });
    screen.destroy();
    expect(storage.writes).toBe(0);
    setScoreStore(null);
  });
});

describe('App.destroy() cancels the pending chrome install', () => {
  beforeEach(() => installChrome.mockClear());

  it('destroy before the dynamic import resolves -> installChrome never runs', async () => {
    const noop: ScreenFactory = () => ({ destroy() {} });
    const app = new App(fakeHost(), { name: 'title' }, { screens: { title: noop }, pwa: false });
    void app.start();
    app.destroy();
    await import('../../src/ui/chrome');
    await tick();
    await tick();
    expect(installChrome).not.toHaveBeenCalled();
  });

  it('installs once when alive, and destroy() calls the returned uninstall', async () => {
    const uninstall = vi.fn();
    installChrome.mockImplementationOnce(() => uninstall);
    const noop: ScreenFactory = () => ({ destroy() {} });
    const app = new App(fakeHost(), { name: 'title' }, { screens: { title: noop }, pwa: false });
    await app.start();
    await tick();
    await tick();
    expect(installChrome).toHaveBeenCalledTimes(1);
    app.destroy();
    expect(uninstall).toHaveBeenCalledTimes(1);
    // inert after destroy
    await app.dispatch({ type: 'play' });
    expect(app.current).toEqual({ name: 'title' });
  });
});

// ------------------------------------------------------ rotate overlay teardown

class FakeEl {
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  attrs = new Map<string, string>();
  className = '';
  textContent: string | null = '';
  connectedRoot = false;
  classList = { set: new Set<string>(), toggle(c: string, on: boolean) { if (on) this.set.add(c); else this.set.delete(c); }, remove(c: string) { this.set.delete(c); } };
  get isConnected(): boolean {
    let n: FakeEl | null = this;
    while (n) {
      if (n.connectedRoot) return true;
      n = n.parent;
    }
    return false;
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  append(...cs: (FakeEl | string)[]) {
    for (const c of cs) if (typeof c !== 'string') this.appendChild(c);
  }
  appendChild(c: FakeEl) {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
    this.parent = null;
  }
  set innerHTML(_: string) {
    this.content = { firstElementChild: new FakeEl() };
  }
  content: { firstElementChild: FakeEl | null } = { firstElementChild: null };
}

describe('rotate overlay install/uninstall (orientation.ts)', () => {
  const listeners = new Map<string, Set<unknown>>();
  const mqListeners = new Set<unknown>();
  let body: FakeEl;
  let html: FakeEl;

  beforeEach(() => {
    listeners.clear();
    mqListeners.clear();
    body = new FakeEl();
    body.connectedRoot = true;
    html = new FakeEl();
    vi.stubGlobal('document', {
      body,
      documentElement: html,
      createElement: () => new FakeEl(),
      createTextNode: () => new FakeEl(),
    });
    vi.stubGlobal('window', {
      innerWidth: 375,
      innerHeight: 812,
      addEventListener: (t: string, f: unknown) => (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(f),
      removeEventListener: (t: string, f: unknown) => listeners.get(t)?.delete(f),
      matchMedia: () => ({ addEventListener: (_: string, f: unknown) => mqListeners.add(f), removeEventListener: (_: string, f: unknown) => mqListeners.delete(f) }),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('ref-counted: listeners + overlay + class removed when the last holder uninstalls', async () => {
    const o = await import('../../src/ui/orientation');
    const changes: boolean[] = [];
    const off = o.onPortraitChange((p) => changes.push(p));
    const u1 = o.installRotateOverlay();
    const u2 = o.installRotateOverlay();
    expect(body.children).toHaveLength(1);
    expect(listeners.get('resize')?.size).toBe(1);
    expect(mqListeners.size).toBe(1);
    expect(html.classList.set.has('pr-portrait')).toBe(true);
    expect(o.isPortraitBlocked()).toBe(true);
    u1();
    u1(); // idempotent
    expect(body.children).toHaveLength(1);
    u2();
    expect(body.children).toHaveLength(0);
    expect(listeners.get('resize')?.size ?? 0).toBe(0);
    expect(listeners.get('orientationchange')?.size ?? 0).toBe(0);
    expect(mqListeners.size).toBe(0);
    expect(html.classList.set.has('pr-portrait')).toBe(false);
    expect(o.isPortraitBlocked()).toBe(false);
    expect(o.rotateOverlayElement()).toBeNull();
    expect(changes).toEqual([true, false]);
    off();
  });
});
