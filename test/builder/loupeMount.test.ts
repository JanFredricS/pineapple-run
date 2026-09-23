/**
 * UX1 #5 builder touch loupe, wired into the real mountBuilder: touch shows
 * it, it follows the finger, it hides on release AND on pointercancel, mouse
 * never shows it, and it is purely visual — the same stroke drawn with a
 * finger and with a mouse commits the same design. Pixi's Application and the
 * builder renderer/loupe are replaced with recording fakes on a minimal fake DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Vec2 } from '../../src/model/geometry';

class FakeTarget {
  private listeners = new Map<string, ((e: unknown) => void)[]>();
  addEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  fire(type: string, props: Record<string, unknown> = {}): void {
    const e = { type, detail: 0, button: 0, timeStamp: 0, target: this, preventDefault() {}, stopPropagation() {}, ...props };
    for (const f of [...(this.listeners.get(type) ?? [])]) f(e);
  }
}

class FakeEl extends FakeTarget {
  parent: FakeEl | null = null;
  children: FakeEl[] = [];
  attrs = new Map<string, string>();
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  className = '';
  innerHTML = '';
  title = '';
  type = '';
  value = '';
  textContent = '';
  hidden = false;
  open = false;
  disabled = false;
  tabIndex = -1;
  maxLength = 0;
  placeholder = '';
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
  append(...nodes: (FakeEl | string)[]): void {
    for (const n of nodes) if (typeof n !== 'string') this.appendChild(n);
  }
  appendChild(n: FakeEl): FakeEl {
    n.remove();
    n.parent = this;
    this.children.push(n);
    return n;
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  replaceChildren(): void {
    for (const c of [...this.children]) c.remove();
  }
  get firstElementChild(): FakeEl | null {
    return this.children[0] ?? null;
  }
  focus(): void {}
  setPointerCapture(): void {}
  /** The canvas fills the 800x600 stage; the palette (and everything else) measures 0 wide. */
  getBoundingClientRect() {
    return this.tagName === 'canvas' ? { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 } : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
}

const { loupes, FakeApp, FakeRenderer, FakeLoupe } = vi.hoisted(() => {
  const loupes: FakeLoupe[] = [];
  class FakeApp {
    renderer: object | undefined;
    canvas = document.createElement('canvas');
    stage = { addChild() {}, removeChild() {}, removeChildren() {} };
    ticker = { start() {}, stop() {} };
    resizeTo: unknown = null;
    screen = { width: 800, height: 600 };
    async init(): Promise<void> {
      this.renderer = {};
    }
    resize(): void {}
    destroy(): void {
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
  class FakeLoupe {
    view = {};
    visible = false;
    /** every show(): fingertip + placement + the overlay drawn */
    shows: { tip: Vec2; center: Vec2; zoom: number; radius: number; draftId: string | null | undefined }[] = [];
    hides = 0;
    constructor() {
      loupes.push(this);
    }
    setTheme(): void {}
    setStartArea(): void {}
    show(_m: unknown, overlay: { draftId?: string | null }, _v: unknown, tip: Vec2, at: { center: Vec2 }, zoom: number, radius: number): void {
      this.visible = true;
      this.shows.push({ tip, center: at.center, zoom, radius, draftId: overlay.draftId });
    }
    hide(): void {
      this.visible = false;
      this.hides++;
    }
    destroy(): void {}
  }
  return { loupes, FakeApp, FakeRenderer, FakeLoupe };
});

vi.mock('pixi.js', async (orig) => ({ ...(await orig<typeof import('pixi.js')>()), Application: FakeApp }));
vi.mock('../../src/builder/render', async (orig) => ({
  ...(await orig<typeof import('../../src/builder/render')>()),
  BuilderRenderer: FakeRenderer,
  BuilderLoupe: FakeLoupe,
  themeFromCss: () => ({}),
}));

import { builderPixi, mountBuilder, type BuilderHandle } from '../../src/builder/builder';
import { LOUPE, loupeLayout } from '../../src/builder/loupe';

let frames = new Map<number, () => void>();
let nextFrame = 1;
/** Run pending animation frames (input coalescing first, then the draw). */
function flush(): void {
  for (let i = 0; i < 5 && frames.size; i++) {
    const pending = [...frames.values()];
    frames = new Map();
    for (const f of pending) f();
  }
}

beforeEach(() => {
  builderPixi.discard(); // GL1: the builder's app is a page singleton; isolate each test
  loupes.length = 0;
  frames = new Map();
  const storage = new Map<string, string>();
  const win = Object.assign(new FakeTarget(), {
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
  const doc = Object.assign(new FakeTarget(), { visibilityState: 'visible', createElement: (tag: string) => new FakeEl(tag) });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('requestAnimationFrame', (f: () => void) => {
    const id = nextFrame++;
    frames.set(id, f);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => void frames.delete(id));
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount(): Promise<{ h: BuilderHandle; canvas: FakeEl; loupe: InstanceType<typeof FakeLoupe> }> {
  const host = new FakeEl('div');
  const h = await mountBuilder(host as unknown as HTMLElement);
  flush();
  const find = (e: FakeEl): FakeEl | null => (e.tagName === 'canvas' ? e : e.children.map(find).find((x) => x) ?? null);
  return { h, canvas: find(host)!, loupe: loupes.at(-1)! };
}

const P = (pointerType: string, pointerId: number, p: Vec2, timeStamp = 0) => ({ pointerType, pointerId, clientX: p.x, clientY: p.y, timeStamp });

/** A straw stroke inside the build area (screen px under the fitted view). */
function stroke(canvas: FakeEl, type: string, onMove?: (p: Vec2) => void): void {
  const a = { x: 200, y: 440 };
  const b = { x: 330, y: 400 };
  canvas.fire('pointerdown', P(type, 1, a, 0));
  flush();
  for (let i = 1; i <= 4; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / 4, y: a.y + ((b.y - a.y) * i) / 4 };
    canvas.fire('pointermove', P(type, 1, p, 20 * i));
    flush();
    onMove?.(p);
  }
  canvas.fire('pointerup', P(type, 1, b, 200));
  canvas.fire('lostpointercapture', P(type, 1, b, 200));
  flush();
}

describe('UX1 builder touch loupe (mounted)', () => {
  it('a touch stroke shows the loupe, which follows the finger (with the live draft) and hides on release', async () => {
    const { h, canvas, loupe } = await mount();
    stroke(canvas, 'touch', (p) => {
      expect(loupe.visible).toBe(true);
      const last = loupe.shows.at(-1)!;
      expect(last.tip).toEqual(p);
      expect(last.center).toEqual(loupeLayout(p, { left: 0, top: 0, right: 800 - 16, bottom: 600 }).center);
      expect(last.zoom).toBe(LOUPE.zoom);
      expect(last.radius).toBe(LOUPE.radius);
      expect(last.draftId).toBeTruthy(); // the straw being drawn is in the magnified view
    });
    expect(loupe.visible).toBe(false);
    expect(loupe.hides).toBeGreaterThan(0);
    expect(h.getDesign().parts).toHaveLength(1);
    h.destroy();
  });

  it('pointercancel hides it immediately', async () => {
    const { h, canvas, loupe } = await mount();
    canvas.fire('pointerdown', P('touch', 3, { x: 200, y: 440 }));
    canvas.fire('pointermove', P('touch', 3, { x: 260, y: 430 }, 16));
    flush();
    expect(loupe.visible).toBe(true);
    canvas.fire('pointercancel', P('touch', 3, { x: 260, y: 430 }, 30));
    flush();
    expect(loupe.visible).toBe(false);
    expect(h.getDesign().parts).toHaveLength(0); // and, as before, nothing committed
    h.destroy();
  });

  it('input resets (window blur) hide it too', async () => {
    const { h, canvas, loupe } = await mount();
    canvas.fire('pointerdown', P('touch', 3, { x: 200, y: 440 }));
    flush();
    expect(loupe.visible).toBe(true);
    (window as unknown as FakeTarget).fire('blur');
    flush();
    expect(loupe.visible).toBe(false);
    h.destroy();
  });

  it('a mouse stroke never shows it — and commits exactly the design the touch stroke did', async () => {
    const touch = await mount();
    stroke(touch.canvas, 'touch');
    const touchDesign = touch.h.getDesign();
    touch.h.destroy();

    const mouse = await mount();
    stroke(mouse.canvas, 'mouse');
    mouse.canvas.fire('pointermove', P('mouse', 1, { x: 300, y: 300 }, 300)); // idle hover
    flush();
    expect(mouse.loupe.shows).toHaveLength(0);
    expect(mouse.loupe.visible).toBe(false);
    expect(mouse.h.getDesign()).toEqual(touchDesign);
    mouse.h.destroy();
  });

  it('a pinch hides it (two-finger navigation, not drawing)', async () => {
    const { h, canvas, loupe } = await mount();
    canvas.fire('pointerdown', P('touch', 1, { x: 200, y: 440 }, 0));
    flush();
    expect(loupe.visible).toBe(true);
    canvas.fire('pointerdown', P('touch', 2, { x: 400, y: 440 }, 10)); // inside the grace window -> pinch
    canvas.fire('pointermove', P('touch', 2, { x: 450, y: 440 }, 30));
    flush();
    expect(loupe.visible).toBe(false);
    canvas.fire('pointerup', P('touch', 2, { x: 450, y: 440 }, 40));
    canvas.fire('pointermove', P('touch', 1, { x: 210, y: 440 }, 50));
    flush();
    expect(loupe.visible).toBe(false);
    h.destroy();
  });
});
