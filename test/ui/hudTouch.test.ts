/**
 * S6V finding 4: the production HUD's touch drive buttons honour the run
 * input contract (src/run/input.ts bindTouchButton): pointerup releases only
 * that finger; pointercancel, and lostpointercapture while the finger is
 * still held, are a FULL clear of every held input. Also the sound toggle.
 * Node env: a minimal event-dispatching fake DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent, RunEventListener, RunEventSource } from '../../src/model/runEvents';
import { DriveInput } from '../../src/run/input';

type Listener = (e: unknown) => void;

class FakeEl {
  tag: string;
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  attrs = new Map<string, string>();
  dataset: Record<string, string> = {};
  className = '';
  textContent: string | null = '';
  hidden = false;
  disabled = false;
  listeners = new Map<string, Set<Listener>>();
  classList = { toggle() {}, add() {}, remove() {} };
  content: { firstElementChild: FakeEl | null } = { firstElementChild: null };
  constructor(tag = 'div') {
    this.tag = tag;
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
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
  replaceChildren(...cs: FakeEl[]) {
    this.children = [];
    this.append(...cs);
  }
  get lastElementChild(): FakeEl | null {
    return this.children.at(-1) ?? null;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
    this.parent = null;
  }
  set innerHTML(_: string) {
    this.content = { firstElementChild: new FakeEl('svg') };
  }
  addEventListener(t: string, f: Listener) {
    (this.listeners.get(t) ?? this.listeners.set(t, new Set()).get(t)!).add(f);
  }
  removeEventListener(t: string, f: Listener) {
    this.listeners.get(t)?.delete(f);
  }
  setPointerCapture() {}
  focus() {}
  click() {
    this.dispatch('click');
  }
  dispatch(type: string, init: Record<string, unknown> = {}) {
    const e = { type, preventDefault() {}, ...init };
    for (const f of [...(this.listeners.get(type) ?? [])]) f(e);
  }
  find(pred: (e: FakeEl) => boolean): FakeEl | null {
    if (pred(this)) return this;
    for (const c of this.children) {
      const r = c.find(pred);
      if (r) return r;
    }
    return null;
  }
}

class Source implements RunEventSource {
  private ls = new Set<RunEventListener>();
  on(l: RunEventListener) {
    this.ls.add(l);
    return () => void this.ls.delete(l);
  }
  simTime() {
    return 0;
  }
  emit(e: RunEvent) {
    for (const l of [...this.ls]) l(e);
  }
}

describe('HUD touch drive buttons: cancellation is a full clear', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: (t: string) => new FakeEl(t),
      createTextNode: (t: string) => Object.assign(new FakeEl('#text'), { textContent: t }),
      addEventListener() {},
      removeEventListener() {},
      hidden: false,
    });
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  async function mount() {
    const { mountRunHud } = await import('../../src/ui/screens/runHud');
    const host = new FakeEl();
    const source = new Source();
    const drives: number[] = [];
    const cancelInput = vi.fn();
    const muted = { v: false };
    const hud = mountRunHud(host as unknown as HTMLElement, {
      mode: 'level',
      source,
      controls: { release() {}, giveUp() {}, setDrive: (d) => void drives.push(d), cancelInput },
      onEnded() {},
      touchControls: 'always',
      sound: { muted: () => muted.v, setMuted: (m) => void (muted.v = m) },
    });
    source.emit({ type: 'started', simTime: 0 });
    source.emit({ type: 'released', simTime: 0 });
    const left = host.find((e) => e.attrs.get('aria-label') === 'Drive left')!;
    const right = host.find((e) => e.attrs.get('aria-label') === 'Drive right')!;
    return { hud, host, left, right, drives, cancelInput, muted };
  }

  it('two active pointers, pointercancel on one → every touch released (cart coasts) and the host clears its inputs', async () => {
    const { hud, left, right, drives, cancelInput } = await mount();
    right.dispatch('pointerdown', { pointerId: 1 });
    right.dispatch('pointerdown', { pointerId: 2 });
    expect(drives).toEqual([1]);
    right.dispatch('pointercancel', { pointerId: 1 });
    expect(drives).toEqual([1, 0]); // coasting — pointer 2 did NOT keep it driving
    expect(right.dataset.active).toBe('false');
    expect(cancelInput).toHaveBeenCalledTimes(1);
    // the stale pointer 2 lifting later changes nothing
    right.dispatch('pointerup', { pointerId: 2 });
    expect(drives).toEqual([1, 0]);
    // fingers on BOTH buttons: a cancel on one clears the other too
    left.dispatch('pointerdown', { pointerId: 3 });
    right.dispatch('pointerdown', { pointerId: 4 });
    left.dispatch('pointercancel', { pointerId: 3 });
    expect(drives.at(-1)).toBe(0);
    expect(left.dataset.active).toBe('false');
    expect(right.dataset.active).toBe('false');
    hud.destroy();
  });

  it('lostpointercapture while still held = cancellation; after a normal pointerup it is a no-op', async () => {
    const { hud, right, drives, cancelInput } = await mount();
    right.dispatch('pointerdown', { pointerId: 1 });
    right.dispatch('pointerdown', { pointerId: 2 });
    // finger 1 lifts normally: capture loss that follows must not clear finger 2
    right.dispatch('pointerup', { pointerId: 1 });
    right.dispatch('lostpointercapture', { pointerId: 1 });
    expect(drives).toEqual([1]);
    expect(cancelInput).not.toHaveBeenCalled();
    // finger 2 loses capture while held (interruption): full clear
    right.dispatch('lostpointercapture', { pointerId: 2 });
    expect(drives).toEqual([1, 0]);
    expect(cancelInput).toHaveBeenCalledTimes(1);
    hud.destroy();
  });

  it('the run-screen wiring (cancelInput → DriveInput.touchCancel) also releases held keys', () => {
    const input = new DriveInput();
    input.keyDown('ArrowRight');
    input.touchStart('right', 7);
    expect(input.direction).toBe(1);
    input.touchCancel();
    expect(input.direction).toBe(0);
  });

  it('sound toggle in the HUD flips mute and reflects it (aria-pressed)', async () => {
    const { hud, host, muted } = await mount();
    const b = host.find((e) => e.attrs.get('data-testid') === 'sound-toggle')!;
    expect(b.getAttribute('aria-pressed')).toBe('false');
    b.click();
    expect(muted.v).toBe(true);
    expect(b.getAttribute('aria-pressed')).toBe('true');
    b.click();
    expect(muted.v).toBe(false);
    hud.destroy();
  });
});
