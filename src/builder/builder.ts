/**
 * S2 Builder: freehand cart builder mounted into a host element.
 *
 * Wiring only — the logic lives in pure modules:
 *   gesture.ts  (pointer arbitration)   editor.ts / edits.ts (design edits)
 *   preview.ts  (resolveAttachments-derived preview)   storage.ts (saves)
 *   view.ts     (zoom/pan)   render.ts (Pixi drawing)
 *
 * Output: a CartDesign. "Test Cart" calls `onTestCart(design, spec)` and
 * dispatches a `pineapple:testcart` CustomEvent on the host (S6 wires this to
 * the run phase).
 */

import { Application } from 'pixi.js';
import type { CompoundSpec } from '../model/attach';
import type { CartDesign } from '../model/cart';
import type { Vec2 } from '../model/geometry';
import './builder.css';
import { BUILD_AREA, HIT_TOLERANCE_SCREEN_PX, MOCK_FUNNEL } from './constants';
import { DRAW_TOOLS, kindName, type Tool } from './edits';
import { initialEditorState, reduceEditor, type EditorAction, type EditorState } from './editor';
import { InputRouter, type DraftView } from './input';
import { PressRegistry } from './pressRegistry';
import { highlightMap } from './messages';
import { buildPreview, type PreviewModel } from './preview';
import { BuilderRenderer, themeFromCss } from './render';
import { browserCartStore, type CartStore } from './storage';
import { fitView, zoomAbout, type BuilderView } from './view';

export interface BuilderOptions {
  /** Named-cart persistence (default: window.localStorage). */
  store?: CartStore;
  initialDesign?: CartDesign;
  /** Called with a VALID design when the player presses "Test Cart". */
  onTestCart?: (design: CartDesign, spec: CompoundSpec) => void;
  /** Called after every committed design change. */
  onChange?: (design: CartDesign) => void;
}

export interface BuilderHandle {
  getDesign(): CartDesign;
  /** Replace the design (caller must have validated it via model/validate). */
  setDesign(design: CartDesign): void;
  /** Clear ALL input state (call on phase transitions). */
  resetInput(): void;
  destroy(): void;
}

export const TEST_CART_EVENT = 'pineapple:testcart';

const TOOL_LABEL: Record<Tool, string> = {
  straw: 'Straw',
  cube: 'Sugar cube',
  lime: 'Lime',
  wheel: 'Wheel',
  shock: 'Shock',
  delete: 'Delete',
};

const TOOL_HINT: Record<Tool, string> = {
  straw: 'Straw: drag to draw a thin rigid bar',
  cube: 'Sugar cube: drag corner to corner',
  lime: 'Lime wheel: press at the centre, drag out the radius (free-rolling, welds)',
  wheel: 'Bottle-cap wheel: press at the centre, drag out the radius (powered; pins to the part under its centre)',
  shock: 'Umbrella shock: drag between two parts (ends snap to wheel/lime centres)',
  delete: 'Delete: tap a part to remove it',
};

const ICONS: Record<Tool | 'clear', string> = {
  straw: '<svg viewBox="0 0 32 32"><line x1="5" y1="26" x2="27" y2="6" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>',
  cube: '<svg viewBox="0 0 32 32"><rect x="7" y="7" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
  lime: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="3"/><path d="M16 5v22M5 16h22M8.2 8.2l15.6 15.6M23.8 8.2 8.2 23.8" stroke="currentColor" stroke-width="1.2"/></svg>',
  wheel: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="16" cy="16" r="3" fill="currentColor"/><path d="M16 16V7M16 16l8 5M16 16l-8 5" stroke="currentColor" stroke-width="2"/></svg>',
  shock: '<svg viewBox="0 0 32 32"><path d="M5 27l4-4 2 5 4-9 3 6 4-9 3 5 3-15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><circle cx="5" cy="27" r="2.4" fill="currentColor"/><circle cx="28" cy="6" r="2.4" fill="currentColor"/></svg>',
  delete: '<svg viewBox="0 0 32 32"><rect x="5" y="9" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="23" cy="10" r="7" fill="currentColor"/><path d="M20 10h6" stroke="#fff" stroke-width="2.5"/></svg>',
  clear: '<svg viewBox="0 0 32 32"><path d="M8 10h16l-1.5 17h-13zM6 10h20M13 6h6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/></svg>',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/**
 * Palette button activation with pointer capture: the pointer is captured on
 * pointerdown (so a touch that starts on a button never leaks to the canvas),
 * and the action fires on pointerup only if the pointer is still over the
 * button. Keyboard activation (Enter/Space -> click with detail 0) also works.
 * (A pointerdown here also cancels any live canvas stroke: see the window
 * capture listener in mountBuilder.)
 */
function pressable(button: HTMLButtonElement, onActivate: () => void, registry: PressRegistry<HTMLButtonElement>): void {
  let active: number | null = null;
  const release = () => {
    active = null;
    button.removeAttribute('data-pressed');
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || button.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    active = e.pointerId;
    try {
      button.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers can't be captured */
    }
    button.setAttribute('data-pressed', 'true');
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== active) return;
    e.stopPropagation();
    const r = button.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    release();
    if (inside && !button.disabled) onActivate();
  };
  const cancel = (e: PointerEvent) => {
    if (e.pointerId === active) release();
  };
  const click = (e: MouseEvent) => {
    // pointer-generated clicks were already handled on pointerup
    if (e.detail === 0 && !button.disabled) onActivate();
  };
  button.addEventListener('pointerdown', down);
  button.addEventListener('pointerup', up);
  button.addEventListener('pointercancel', cancel);
  button.addEventListener('lostpointercapture', cancel);
  button.addEventListener('click', click);
  registry.register(button, release);
}

export async function mountBuilder(host: HTMLElement, options: BuilderOptions = {}): Promise<BuilderHandle> {
  const store = options.store ?? browserCartStore();
  const cleanups: Array<() => void> = [];
  const presses = new PressRegistry<HTMLButtonElement>();
  const listen = <T extends EventTarget>(target: T, type: string, fn: EventListenerOrEventListenerObject, opts?: AddEventListenerOptions) => {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };

  // ------------------------------------------------------------------ DOM
  const root = el('div', 'pr-builder');
  const stage = el('div', 'pr-builder__stage');
  root.append(stage);
  host.append(root);

  const app = new Application();
  await app.init({
    resizeTo: stage,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  const canvas = app.canvas;
  canvas.setAttribute('aria-label', 'Cart drawing area');
  stage.append(canvas);
  const renderer = new BuilderRenderer();
  renderer.setTheme(themeFromCss(root));
  app.stage.addChild(renderer.view);

  // ---------------------------------------------------------------- state
  let editor: EditorState = initialEditorState(options.initialDesign ?? undefined);
  let committed: PreviewModel = buildPreview(editor.design);
  let draft: DraftView | null = null;
  let hoverId: string | null = null;
  let highlight: ReadonlyMap<string, number> = new Map();
  let view: BuilderView = { scale: 1, offsetX: 0, offsetY: 0 };
  let userMovedView = false;

  // ---------------------------------------------------------- palette DOM
  const palette = el('aside', 'pr-palette');
  palette.setAttribute('aria-label', 'Build tools');
  const toolButtons = new Map<Tool, HTMLButtonElement>();
  const mkBtn = (label: string, cls = 'pr-btn', onActivate: () => void, title = ''): HTMLButtonElement => {
    const b = el('button', cls);
    b.type = 'button';
    b.innerHTML = label;
    if (title) b.title = title;
    pressable(b, onActivate, presses);
    return b;
  };
  const mkTool = (tool: Tool) => {
    const icon = ICONS[tool];
    const b = mkBtn(`${icon}<span>${TOOL_LABEL[tool]}</span>`, 'pr-btn pr-tool', () => dispatch({ type: 'setTool', tool }), TOOL_HINT[tool]);
    b.setAttribute('aria-label', TOOL_LABEL[tool]);
    b.dataset.tool = tool;
    toolButtons.set(tool, b);
    return b;
  };

  const buildHeading = el('h2', 'pr-palette__heading', 'Build Tools');
  const buildGrid = el('div', 'pr-palette__grid');
  for (const t of DRAW_TOOLS) buildGrid.append(mkTool(t));
  const snapBtn = mkBtn('Snap 15°', 'pr-btn pr-tool', () => dispatch({ type: 'setSnap', snap: !editor.snap }), 'Angle snap for straws and shocks (15° steps)');
  snapBtn.dataset.role = 'snap';
  buildGrid.append(snapBtn);

  const deleteHeading = el('h2', 'pr-palette__heading', 'Delete Tools');
  const deleteGrid = el('div', 'pr-palette__grid');
  deleteGrid.append(mkTool('delete'));
  const clearBtn = mkBtn(`${ICONS.clear}<span>Clear all</span>`, 'pr-btn pr-tool pr-btn--danger', () => askClear(), 'Remove every part');
  clearBtn.setAttribute('aria-label', 'Clear all');
  deleteGrid.append(clearBtn);

  // inline confirmation slot (no window.confirm)
  const confirmSlot = el('div');
  const askConfirm = (slot: HTMLElement, message: string, okLabel: string, onOk: () => void) => {
    slot.replaceChildren();
    const box = el('div', 'pr-confirm');
    box.setAttribute('role', 'alertdialog');
    box.append(el('div', '', message));
    const row = el('div', 'pr-palette__row');
    const ok = mkBtn(okLabel, 'pr-btn pr-btn--danger pr-btn--solid', () => {
      slot.replaceChildren();
      onOk();
    });
    const cancel = mkBtn('Cancel', 'pr-btn', () => slot.replaceChildren());
    row.append(ok, cancel);
    box.append(row);
    slot.append(box);
    cancel.focus();
  };
  const askClear = () => {
    if (editor.design.parts.length === 0) return toast('Nothing to clear');
    askConfirm(confirmSlot, `Clear all ${editor.design.parts.length} parts?`, 'Clear all', () => dispatch({ type: 'clearAll' }));
  };
  const replaceDesign = (label: string, action: EditorAction, slot: HTMLElement = confirmSlot) => {
    if (editor.design.parts.length === 0) return dispatch(action);
    askConfirm(slot, `Replace your current cart with ${label}?`, 'Replace', () => dispatch(action));
  };

  const zoomRow = el('div', 'pr-palette__row');
  const zoomBy = (f: number) => {
    const c = { x: stageW() / 2, y: stageH() / 2 };
    setView(zoomAbout(view, f, c));
  };
  zoomRow.append(
    mkBtn('−', 'pr-btn', () => zoomBy(1 / 1.25), 'Zoom out'),
    mkBtn('Fit', 'pr-btn', () => fit(true), 'Fit the build area'),
    mkBtn('+', 'pr-btn', () => zoomBy(1.25), 'Zoom in'),
  );

  const exampleBtn = mkBtn('Example Cart', 'pr-btn', () => replaceDesign('the example cart', { type: 'loadExample' }), 'Load the original sample cart');
  const cartsBtn = mkBtn('Save / Load…', 'pr-btn', () => toggleCarts(), 'Save or load named carts');
  const testBtn = mkBtn('Test Cart ▶', 'pr-btn pr-btn--primary', () => testCart(), 'Drive this cart');
  testBtn.dataset.role = 'test';

  palette.append(buildHeading, buildGrid, deleteHeading, deleteGrid, confirmSlot, zoomRow, exampleBtn, cartsBtn, testBtn);
  root.append(palette);

  // ------------------------------------------------------- status panel
  // <details>: collapsible so it doesn't cover the cart on short screens.
  const status = el('details', 'pr-status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-label', 'Cart check');
  status.open = !window.matchMedia('(max-height: 480px)').matches;
  const statusSummary = el('summary', 'pr-status__summary');
  const statusList = el('ul', 'pr-status__list');
  const statusMeta = el('div', 'pr-status__meta');
  status.append(statusSummary, statusList, statusMeta);
  root.append(status);

  // -------------------------------------------------------------- toasts
  const toasts = el('div', 'pr-toasts');
  const toastTimers = new Set<number>();
  cleanups.push(() => toastTimers.forEach((t) => window.clearTimeout(t)));
  root.append(toasts);
  const toast = (message: string, kind: 'info' | 'error' = 'info') => {
    const t = el('div', 'pr-toast', message);
    t.dataset.kind = kind;
    t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    toasts.append(t);
    while (toasts.children.length > 3) toasts.firstElementChild?.remove();
    const timer = window.setTimeout(() => {
      toastTimers.delete(timer);
      t.remove();
    }, kind === 'error' ? 6000 : 3000);
    toastTimers.add(timer);
  };

  const draftLabel = el('div', 'pr-draft-label');
  draftLabel.hidden = true;
  root.append(draftLabel);

  // --------------------------------------------------------- carts panel
  const carts = el('section', 'pr-carts');
  carts.hidden = true;
  carts.setAttribute('aria-label', 'Saved carts');
  root.append(carts);

  const toggleCarts = (open = carts.hidden) => {
    carts.hidden = !open;
    cartsBtn.setAttribute('aria-pressed', String(open));
    if (open) renderCarts();
  };

  const renderCarts = () => {
    carts.replaceChildren();
    const title = el('h2', 'pr-palette__heading', 'Saved carts');
    const name = el('input');
    name.type = 'text';
    name.maxLength = 100;
    name.placeholder = 'Cart name';
    name.value = editor.design.name ?? '';
    name.setAttribute('aria-label', 'Cart name');
    const confirm = el('div');
    const doSave = () => {
      const r = store.save(name.value, editor.design);
      if (!r.ok) return toast(r.error.message, 'error');
      dispatch({ type: 'load', design: { ...editor.design, name: r.value.name } }, false);
      toast(`Saved "${r.value.name}"`);
      renderCarts();
    };
    const saveBtn = mkBtn('Save', 'pr-btn pr-btn--primary', () => {
      if (store.exists(name.value)) askConfirm(confirm, `Overwrite "${name.value.trim()}"?`, 'Overwrite', doSave);
      else doSave();
    });
    const closeBtn = mkBtn('Close', 'pr-btn', () => toggleCarts(false));
    const saveRow = el('div', 'pr-palette__row');
    saveRow.append(saveBtn, closeBtn);
    carts.append(title, name, saveRow, confirm);

    const listed = store.list();
    if (!listed.ok) {
      carts.append(el('div', 'pr-carts__problem', listed.error.message));
      return;
    }
    for (const p of listed.value.problems) toast(p.message, 'error');
    const ul = el('ul');
    if (listed.value.carts.length === 0) ul.append(el('li', 'pr-carts__empty', 'No saved carts yet'));
    for (const c of listed.value.carts) {
      const li = el('li');
      const label = el('span', 'pr-carts__name', c.name);
      label.title = c.problem ?? `${c.name} (${c.partCount} parts)`;
      li.append(label);
      if (c.problem) {
        li.append(el('span', 'pr-carts__problem', 'unreadable'));
      } else {
        li.append(
          mkBtn('Load', 'pr-btn', () => {
            const r = store.load(c.name);
            if (!r.ok) {
              toast(r.error.message, 'error');
              renderCarts();
              return;
            }
            replaceDesign(`"${c.name}"`, { type: 'load', design: r.value }, confirm);
          }),
        );
      }
      li.append(
        mkBtn('✕', 'pr-btn pr-btn--danger', () =>
          askConfirm(confirm, `Delete saved cart "${c.name}"?`, 'Delete', () => {
            const r = store.remove(c.name);
            if (!r.ok) toast(r.error.message, 'error');
            renderCarts();
          }),
        ),
      );
      ul.append(li);
    }
    carts.append(ul);
  };

  // -------------------------------------------------------------- update
  const refreshPalette = () => {
    for (const [tool, b] of toolButtons) b.setAttribute('aria-pressed', String(tool === editor.tool));
    snapBtn.setAttribute('aria-pressed', String(editor.snap));
    canvas.style.cursor = editor.tool === 'delete' ? 'pointer' : 'crosshair';
  };

  const refreshStatus = () => {
    const { messages, spec } = committed;
    const n = editor.design.parts.length;
    status.dataset.valid = n === 0 ? 'empty' : String(spec.valid);
    statusList.replaceChildren();
    if (n === 0) {
      statusSummary.textContent = 'Draw a cart — or try the Example Cart';
    } else if (spec.valid) {
      statusSummary.textContent = 'Cart OK — ready to test';
    } else {
      statusSummary.textContent = messages.length === 1 ? '1 problem' : `${messages.length} problems`;
    }
    for (const m of n === 0 ? [] : messages) {
      const li = el('li', '', m.text);
      li.dataset.code = m.code;
      li.tabIndex = 0;
      const on = () => {
        highlight = highlightMap(m);
        requestDraw();
      };
      const off = () => {
        highlight = new Map();
        requestDraw();
      };
      li.addEventListener('pointerenter', on);
      li.addEventListener('pointerleave', off);
      li.addEventListener('focus', on);
      li.addEventListener('blur', off);
      statusList.append(li);
    }
    const rigid = spec.bodies.filter((b) => b.kind === 'rigid').length;
    const wheels = spec.bodies.length - rigid;
    statusMeta.textContent = n ? `${n} parts · ${rigid} rigid piece${rigid === 1 ? '' : 's'} · ${wheels} wheel${wheels === 1 ? '' : 's'} · ${spec.joints.length} joints` : '';
    testBtn.disabled = !spec.valid;
    testBtn.title = spec.valid ? 'Drive this cart' : 'Fix the problems listed first';
  };

  function dispatch(action: EditorAction, notify = true) {
    // Replacing the design while a stroke is live would commit against the
    // wrong design: cancel all input first.
    if (action.type === 'clearAll' || action.type === 'load' || action.type === 'loadExample') resetInput();
    const prev = editor.design;
    const r = reduceEditor(editor, action);
    editor = r.state;
    if (r.outcome?.kind === 'rejected' && r.outcome.reason !== 'nothingHere') toast(r.outcome.message, 'error');
    if (editor.design !== prev) {
      committed = buildPreview(editor.design);
      highlight = new Map();
      if (hoverId && !editor.design.parts.some((p) => p.id === hoverId)) hoverId = null;
      refreshStatus();
      if (notify) options.onChange?.(editor.design);
    }
    if (action.type === 'setTool') {
      hoverId = null;
      confirmSlot.replaceChildren();
    }
    refreshPalette();
    requestDraw();
  }

  // ---------------------------------------------------------------- draw
  let frame = 0;
  const stageW = () => app.screen.width;
  const stageH = () => app.screen.height;
  const paletteReserve = () => palette.getBoundingClientRect().width + 16;
  function requestDraw() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const model = draft?.preview ?? committed;
      renderer.draw(
        model,
        { draftId: draft ? draft.draft.part.id : null, draftTooSmall: draft?.draft.tooSmall ?? false, hoverId, highlight },
        view,
        stageW(),
        stageH(),
      );
    });
  }
  const setView = (v: BuilderView) => {
    view = v;
    userMovedView = true;
    requestDraw();
  };
  const fit = (explicit = false) => {
    // include the bottom of the mock funnel so the start area reads as one scene
    const area = { ...BUILD_AREA, minY: Math.min(BUILD_AREA.minY, MOCK_FUNNEL.y - 10) };
    view = fitView(area, stageW(), stageH(), paletteReserve(), 24);
    if (explicit) userMovedView = false;
    requestDraw();
  };

  // --------------------------------------------------------------- input
  const localPos = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const tolerance = () => HIT_TOLERANCE_SCREEN_PX / view.scale;

  const showDraft = (d: DraftView | null) => {
    draft = d;
    draftLabel.hidden = !d;
    if (d) {
      const { draft: dr, screenPos: pos } = d;
      draftLabel.textContent = dr.tooSmall ? `${dr.label} — too small` : `${kindName(dr.part.kind)} ${dr.label}`;
      draftLabel.dataset.bad = String(dr.tooSmall);
      draftLabel.style.left = `${Math.min(stageW() - 140, pos.x + 14)}px`;
      draftLabel.style.top = `${Math.max(0, pos.y - 28)}px`;
    }
    requestDraw();
  };

  let inputFrame = 0;
  const router = new InputRouter({
    getDesign: () => editor.design,
    getTool: () => editor.tool,
    getSnap: () => editor.snap,
    getView: () => view,
    tolerance,
    setView,
    commit: (tool, snap, start, end) => dispatch({ type: 'stroke', tool, snap, start, end, tolerance: tolerance() }),
    onDraft: showDraft,
    onHover: (id) => {
      if (id !== hoverId) {
        hoverId = id;
        requestDraw();
      }
    },
    onStrokeStart: () => confirmSlot.replaceChildren(),
    requestFrame: () => {
      if (!inputFrame)
        inputFrame = requestAnimationFrame(() => {
          inputFrame = 0;
          router.frame();
        });
    },
    buildPreview,
  });

  listen(canvas, 'pointerdown', ((e: PointerEvent) => {
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    router.down(e.pointerId, localPos(e), e.timeStamp, e.pointerType === 'mouse' ? e.button : 0);
  }) as EventListener);
  listen(canvas, 'pointermove', ((e: PointerEvent) => {
    if (router.gestureState.name === 'idle') {
      // hover preview for the delete tool (mouse/pen only)
      if (e.pointerType !== 'touch') router.hover(localPos(e));
      return;
    }
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const last = events.length ? events[events.length - 1]! : e;
    router.move(e.pointerId, localPos(last), e.timeStamp);
  }) as EventListener);
  listen(canvas, 'pointerup', ((e: PointerEvent) => router.up(e.pointerId, localPos(e), e.timeStamp)) as EventListener);
  // pointercancel = the browser took the gesture over: full reset.
  listen(canvas, 'pointercancel', (() => resetInput()) as EventListener);
  // lostpointercapture also fires after a normal pointerup; the router ignores untracked pointers.
  listen(canvas, 'lostpointercapture', ((e: PointerEvent) => router.cancel(e.pointerId)) as EventListener);
  // Any pointerdown outside the canvas (palette, panels, page) cancels a live stroke.
  listen(
    window,
    'pointerdown',
    ((e: PointerEvent) => {
      if (e.target !== canvas) router.outsideDown();
    }) as EventListener,
    { capture: true },
  );
  listen(canvas, 'pointerleave', (() => {
    if (router.gestureState.name === 'idle' && hoverId) {
      hoverId = null;
      requestDraw();
    }
  }) as EventListener);
  listen(canvas, 'contextmenu', (e) => e.preventDefault());
  listen(
    canvas,
    'wheel',
    ((e: WheelEvent) => {
      e.preventDefault();
      const p = localPos(e);
      if (e.ctrlKey || !e.shiftKey) {
        // clamp per event so one coarse wheel notch is a gentle ~15% step
        const raw = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        const dy = Math.max(-100, Math.min(100, raw));
        setView(zoomAbout(view, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0014)), p));
      } else {
        setView(zoomAbout(view, 1, p, { x: p.x - e.deltaY, y: p.y - e.deltaX }));
      }
    }) as EventListener,
    { passive: false },
  );

  /** Clear ALL input state: gestures, draft, hover, highlighted palette presses. */
  function resetInput() {
    router.reset();
    draft = null;
    draftLabel.hidden = true;
    hoverId = null;
    highlight = new Map();
    presses.releaseAll();
    requestDraw();
  }
  listen(window, 'blur', resetInput);
  listen(window, 'pagehide', resetInput);
  listen(document, 'visibilitychange', () => {
    if (document.visibilityState !== 'visible') resetInput();
  });
  listen(window, 'keydown', ((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      resetInput();
      confirmSlot.replaceChildren();
    }
  }) as EventListener);

  // ---------------------------------------------------------- test cart
  const testCart = () => {
    resetInput();
    if (!committed.spec.valid) {
      toast('Fix the problems listed before testing', 'error');
      return;
    }
    const design = structuredClone(editor.design);
    options.onTestCart?.(design, committed.spec);
    host.dispatchEvent(new CustomEvent(TEST_CART_EVENT, { detail: { design } }));
  };

  // --------------------------------------------------------------- start
  const ro = new ResizeObserver(() => {
    app.resize();
    if (!userMovedView) fit();
    else requestDraw();
  });
  ro.observe(stage);
  cleanups.push(() => ro.disconnect());
  app.resize();
  fit();
  refreshPalette();
  refreshStatus();

  // Surface (and discard) corrupt saves up front — "discard-with-toast".
  const initial = store.list();
  if (!initial.ok) toast(initial.error.message, 'error');
  else for (const p of initial.value.problems) toast(p.message, 'error');

  return {
    getDesign: () => structuredClone(editor.design),
    setDesign: (d) => dispatch({ type: 'load', design: structuredClone(d) }),
    resetInput,
    destroy() {
      resetInput();
      if (frame) cancelAnimationFrame(frame);
      if (inputFrame) cancelAnimationFrame(inputFrame);
      for (const c of cleanups) c();
      app.stage.removeChild(renderer.view);
      renderer.destroy();
      app.destroy(true, { children: true });
      root.remove();
    },
  };
}
