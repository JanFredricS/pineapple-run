/**
 * Map builder (mapbuilder.html): edit LevelDef terrain spans, markers, props
 * and zones; test-roll a physics ball; import/export JSON through
 * model/validate. Keyboard + mouse first; usable, not beautiful.
 *
 * All terrain edits go through the pure ops in ./ops.ts. The test roll uses
 * the production path: validateLevelDef -> LevelChunkSource ->
 * TerrainStreamer (chunked chains) -> PhysicsWorld.
 *
 * Acceptance checklist (manual):
 *  1. Drag points; A adds (segment / beyond an end); Del deletes; G cuts a gap;
 *     J rejoins; N adds a span. Status bar stays "valid".
 *  2. S/F/O/P/Z place cart start, funnel, goal, props, zones; drag them in V mode.
 *  3. T rolls a ball from the cart start over the edited terrain; it drops into gaps.
 *  4. Export → text / Download produce JSON that Import reads back; importing
 *     broken JSON shows the validation error (code, path) and keeps the doc.
 *  5. Ctrl/Cmd+Z / Shift+Z undo/redo every edit.
 */

import { pixelsPerMetre, screenToWorld, worldToScreen, type Camera } from '../../src/model/coords';
import type { Vec2 } from '../../src/model/geometry';
import { THEME_IDS, type LevelDef, type ZoneDef } from '../../src/model/level';
import { parseLevelDef, validateLevelDef, type ValidationError } from '../../src/model/validate';
import { FixedStepClock } from '../../src/physics/clock';
import { PhysicsWorld } from '../../src/physics/engine';
import { CHUNK_WIDTH, LevelChunkSource } from '../../src/terrain/chunks';
import { generateLevel } from '../../src/terrain/generator';
import { loadOriginalCourse } from '../../src/terrain/levels';
import { TerrainStreamer } from '../../src/terrain/runtime';
import {
  addSpan,
  cutGap,
  defaultLevel,
  deletePoint,
  extendSpan,
  hitPoint,
  hitSegment,
  insertPoint,
  joinSpans,
  movePoint,
  uniqueId,
  type PointRef,
  type SegmentRef,
} from './ops';

// ------------------------------------------------------------------ DOM
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const ctx = canvas.getContext('2d')!;
const statusEl = $<HTMLDivElement>('status');
const errorsEl = $<HTMLDivElement>('errors');
const jsonEl = $<HTMLTextAreaElement>('json');
const inspectorEl = $<HTMLDivElement>('inspector');
const propsEl = $<HTMLDivElement>('props');
const zonesEl = $<HTMLDivElement>('zones');
const rollResultEl = $<HTMLDivElement>('rollResult');

// ------------------------------------------------------------------ state
type Mode = 'select' | 'add' | 'span' | 'cut' | 'start' | 'funnel' | 'goal' | 'prop' | 'zone';
const MODES: { mode: Mode; key: string; label: string }[] = [
  { mode: 'select', key: 'V', label: 'Select/drag' },
  { mode: 'add', key: 'A', label: 'Add point' },
  { mode: 'span', key: 'N', label: 'New span' },
  { mode: 'cut', key: 'G', label: 'Cut gap' },
  { mode: 'start', key: 'S', label: 'Cart start' },
  { mode: 'funnel', key: 'F', label: 'Funnel' },
  { mode: 'goal', key: 'O', label: 'Goal' },
  { mode: 'prop', key: 'P', label: 'Prop' },
  { mode: 'zone', key: 'Z', label: 'Zone' },
];

type Marker = 'cartStart' | 'funnel' | 'goal';
type Selection =
  | { kind: 'point'; ref: PointRef }
  | { kind: 'span'; span: number }
  | { kind: 'prop'; i: number }
  | { kind: 'zone'; i: number }
  | { kind: 'marker'; which: Marker }
  | null;

type Drag =
  | { kind: 'pan'; sx: number; sy: number; center: Vec2 }
  | { kind: 'point'; ref: PointRef }
  | { kind: 'prop'; i: number; off: Vec2 }
  | { kind: 'zone'; i: number; off: Vec2 }
  | { kind: 'marker'; which: Marker; off: Vec2 }
  | { kind: 'newZone'; from: Vec2; to: Vec2 }
  | null;

let doc: LevelDef = defaultLevel();
let validity: { ok: true } | { ok: false; error: ValidationError } = { ok: true };
const undoStack: string[] = [];
const redoStack: string[] = [];
let mode: Mode = 'select';
let sel: Selection = null;
let drag: Drag = null;
let spaceHeld = false;
let mouseWorld: Vec2 = { x: 0, y: 0 };
let message = '';
let messageUntil = 0;

const camera: Camera = { center: { x: 30, y: 8 }, zoom: 1, viewportWidth: 1, viewportHeight: 1 };
const ppm = () => pixelsPerMetre(camera);
const S = (p: Vec2) => worldToScreen(p, camera);

function flash(msg: string): void {
  message = msg;
  messageUntil = performance.now() + 3500;
}

// ------------------------------------------------------------ doc changes
function snapshot(): string {
  return JSON.stringify(doc);
}

/** Replace the doc as one undoable edit. */
function commit(next: LevelDef, opts: { pushUndo?: boolean } = {}): void {
  if (opts.pushUndo !== false) {
    undoStack.push(snapshot());
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
  }
  doc = next;
  changed();
}

function changed(structural = true): void {
  const r = validateLevelDef(doc);
  validity = r.ok ? { ok: true } : { ok: false, error: r.error };
  // Drop selections that no longer exist.
  if (sel?.kind === 'point' && !doc.terrain.spans[sel.ref.span]?.points[sel.ref.point]) sel = null;
  if (sel?.kind === 'span' && !doc.terrain.spans[sel.span]) sel = null;
  if (sel?.kind === 'prop' && !doc.props[sel.i]) sel = null;
  if (sel?.kind === 'zone' && !doc.zones[sel.i]) sel = null;
  syncMeta();
  renderInspector();
  if (structural) renderLists();
}

function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return flash('nothing to undo');
  redoStack.push(snapshot());
  doc = JSON.parse(prev) as LevelDef;
  changed();
}

function redo(): void {
  const next = redoStack.pop();
  if (!next) return flash('nothing to redo');
  undoStack.push(snapshot());
  doc = JSON.parse(next) as LevelDef;
  changed();
}

function loadDoc(next: LevelDef, what: string): void {
  stopRoll();
  commit(structuredClone(next));
  sel = null;
  fitView();
  errorsEl.textContent = '';
  flash(`loaded ${what}`);
}

// ------------------------------------------------------------ view
function bounds(): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of doc.terrain.spans) {
    for (const p of s.points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { minX, maxX, minY, maxY };
}

function fitView(): void {
  const b = bounds();
  if (!Number.isFinite(b.minX)) return;
  const w = canvas.clientWidth || 800;
  const h = canvas.clientHeight || 600;
  camera.center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const zx = (w * 0.9) / Math.max(1, b.maxX - b.minX) / 30;
  const zy = (h * 0.6) / Math.max(1, b.maxY - b.minY) / 30;
  camera.zoom = Math.max(0.02, Math.min(8, Math.min(zx, zy)));
}

// ------------------------------------------------------------ hit tests
const TOL_PX = 8;

function hitMarker(p: Vec2, tol: number): Marker | null {
  if (Math.hypot(doc.cartStart.x - p.x, doc.cartStart.y - p.y) <= Math.max(tol, 0.6)) return 'cartStart';
  if (Math.hypot(doc.funnel.x - p.x, doc.funnel.y - p.y) <= Math.max(tol, 0.6)) return 'funnel';
  const g = doc.goal.sensor;
  if (p.x >= g.x && p.x <= g.x + g.width && p.y >= g.y && p.y <= g.y + g.height) return 'goal';
  return null;
}

function hitProp(p: Vec2, tol: number): number {
  return doc.props.findIndex((q) => Math.hypot(q.position.x - p.x, q.position.y - p.y) <= Math.max(tol, 0.6));
}

function hitZone(p: Vec2): number {
  for (let i = doc.zones.length - 1; i >= 0; i--) {
    const r = doc.zones[i]!.rect;
    if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) return i;
  }
  return -1;
}

const markerPos = (m: Marker): Vec2 =>
  m === 'cartStart' ? doc.cartStart : m === 'funnel' ? doc.funnel : { x: doc.goal.sensor.x, y: doc.goal.sensor.y };

function setMarker(next: LevelDef, m: Marker, p: Vec2): void {
  if (m === 'cartStart') next.cartStart = { x: p.x, y: p.y };
  else if (m === 'funnel') next.funnel = { x: p.x, y: p.y };
  else {
    const dx = p.x - next.goal.sensor.x;
    next.goal.sensor.x = p.x;
    next.goal.sensor.y = p.y;
    next.goal.lineX += dx;
  }
}

// ------------------------------------------------------------ mouse
function eventWorld(e: MouseEvent): Vec2 {
  const r = canvas.getBoundingClientRect();
  return screenToWorld({ x: e.clientX - r.left, y: e.clientY - r.top }, camera);
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('mousedown', (e) => {
  canvas.focus();
  const p = eventWorld(e);
  const tol = TOL_PX / ppm();
  if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceHeld)) {
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, center: { ...camera.center } };
    return;
  }
  if (e.button !== 0) return;
  switch (mode) {
    case 'select': {
      const pt = hitPoint(doc, p, tol);
      if (pt) {
        sel = { kind: 'point', ref: pt };
        commit(doc); // undo checkpoint for the drag
        drag = { kind: 'point', ref: pt };
        break;
      }
      const m = hitMarker(p, tol);
      if (m) {
        sel = { kind: 'marker', which: m };
        commit(structuredClone(doc));
        const mp = markerPos(m);
        drag = { kind: 'marker', which: m, off: { x: mp.x - p.x, y: mp.y - p.y } };
        break;
      }
      const pi = hitProp(p, tol);
      if (pi >= 0) {
        sel = { kind: 'prop', i: pi };
        commit(structuredClone(doc));
        const q = doc.props[pi]!.position;
        drag = { kind: 'prop', i: pi, off: { x: q.x - p.x, y: q.y - p.y } };
        break;
      }
      const seg = hitSegment(doc, p, tol);
      if (seg) {
        sel = { kind: 'span', span: seg.span };
        changed(false);
        break;
      }
      const zi = hitZone(p);
      if (zi >= 0) {
        sel = { kind: 'zone', i: zi };
        commit(structuredClone(doc));
        const r = doc.zones[zi]!.rect;
        drag = { kind: 'zone', i: zi, off: { x: r.x - p.x, y: r.y - p.y } };
        break;
      }
      sel = null;
      changed(false);
      drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, center: { ...camera.center } };
      break;
    }
    case 'add': {
      const seg = hitSegment(doc, p, tol * 1.5);
      const res = seg ? insertPoint(doc, seg, p) : extendSpan(doc, p);
      if (!res) {
        flash(seg ? 'segment too short to split' : 'click a segment, or beyond a span end (not overlapping a neighbour)');
        break;
      }
      commit(res.doc);
      sel = { kind: 'point', ref: res.point };
      changed(false);
      drag = { kind: 'point', ref: res.point };
      break;
    }
    case 'span': {
      const res = addSpan(doc, p);
      if (!res) flash('a new span must start in free space (not inside an existing span)');
      else {
        commit(res.doc);
        sel = { kind: 'point', ref: { span: res.span, point: 1 } };
        changed(false);
      }
      break;
    }
    case 'cut': {
      const seg = hitSegment(doc, p, tol * 1.5);
      if (!seg) {
        flash('click a terrain segment to cut a gap into it');
        break;
      }
      const next = cutGap(doc, seg);
      if (!next) flash('segment too short to cut');
      else {
        commit(next);
        flash('gap cut: drag the new edge points to size it');
      }
      break;
    }
    case 'start':
    case 'funnel':
    case 'goal': {
      const next = structuredClone(doc);
      const which: Marker = mode === 'start' ? 'cartStart' : mode;
      if (which === 'goal') {
        const g = next.goal.sensor;
        const lineOff = next.goal.lineX - g.x;
        g.x = p.x - g.width / 2;
        g.y = p.y - g.height;
        next.goal.lineX = g.x + lineOff;
      } else setMarker(next, which, p);
      commit(next);
      sel = { kind: 'marker', which };
      changed(false);
      break;
    }
    case 'prop': {
      const next = structuredClone(doc);
      const art = ($<HTMLInputElement>('propArt').value || 'palm').trim().slice(0, 64) || 'palm';
      next.props.push({ id: uniqueId(next.props.map((q) => q.id), art), art, position: { x: p.x, y: p.y } });
      commit(next);
      sel = { kind: 'prop', i: next.props.length - 1 };
      changed();
      break;
    }
    case 'zone':
      drag = { kind: 'newZone', from: p, to: p };
      break;
  }
});

window.addEventListener('mousemove', (e) => {
  const p = eventWorld(e);
  mouseWorld = p;
  if (!drag) return;
  switch (drag.kind) {
    case 'pan': {
      const k = ppm();
      camera.center = { x: drag.center.x - (e.clientX - drag.sx) / k, y: drag.center.y - (e.clientY - drag.sy) / k };
      break;
    }
    case 'point':
      doc = movePoint(doc, drag.ref, p);
      changed(false);
      break;
    case 'marker': {
      const next = structuredClone(doc);
      setMarker(next, drag.which, { x: p.x + drag.off.x, y: p.y + drag.off.y });
      doc = next;
      changed(false);
      break;
    }
    case 'prop': {
      const next = structuredClone(doc);
      next.props[drag.i]!.position = { x: p.x + drag.off.x, y: p.y + drag.off.y };
      doc = next;
      changed(false);
      break;
    }
    case 'zone': {
      const next = structuredClone(doc);
      const r = next.zones[drag.i]!.rect;
      r.x = p.x + drag.off.x;
      r.y = p.y + drag.off.y;
      doc = next;
      changed(false);
      break;
    }
    case 'newZone':
      drag.to = p;
      break;
  }
});

window.addEventListener('mouseup', () => {
  if (drag?.kind === 'newZone') {
    const x = Math.min(drag.from.x, drag.to.x);
    const y = Math.min(drag.from.y, drag.to.y);
    const width = Math.abs(drag.to.x - drag.from.x);
    const height = Math.abs(drag.to.y - drag.from.y);
    if (width > 0.2 && height > 0.2) {
      const next = structuredClone(doc);
      const kind = $<HTMLSelectElement>('zoneKind').value === 'force' ? 'force' : 'gravity';
      const id = uniqueId(next.zones.map((z) => z.id), kind);
      const zone: ZoneDef =
        kind === 'gravity' ? { id, kind, rect: { x, y, width, height }, gravityScale: 0.3 } : { id, kind, rect: { x, y, width, height }, force: { x: 0, y: -15 } };
      next.zones.push(zone);
      commit(next);
      sel = { kind: 'zone', i: next.zones.length - 1 };
      changed();
    } else flash('drag out a rectangle to make a zone');
  }
  if (drag && drag.kind !== 'pan') renderLists();
  drag = null;
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const before = eventWorld(e);
    camera.zoom = Math.max(0.02, Math.min(12, camera.zoom * (e.deltaY > 0 ? 0.88 : 1 / 0.88)));
    const after = eventWorld(e);
    camera.center = { x: camera.center.x + before.x - after.x, y: camera.center.y + before.y - after.y };
  },
  { passive: false },
);

// ------------------------------------------------------------ keyboard
function setMode(m: Mode): void {
  mode = m;
  document.querySelectorAll<HTMLButtonElement>('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
}

function deleteSelection(): void {
  if (!sel) return;
  if (sel.kind === 'point') {
    const next = deletePoint(doc, sel.ref);
    if (!next) return flash('cannot delete the last span');
    sel = null;
    commit(next);
  } else if (sel.kind === 'span') {
    if (doc.terrain.spans.length <= 1) return flash('cannot delete the last span');
    const next = structuredClone(doc);
    next.terrain.spans.splice(sel.span, 1);
    sel = null;
    commit(next);
  } else if (sel.kind === 'prop') {
    const next = structuredClone(doc);
    next.props.splice(sel.i, 1);
    sel = null;
    commit(next);
  } else if (sel.kind === 'zone') {
    const next = structuredClone(doc);
    next.zones.splice(sel.i, 1);
    sel = null;
    commit(next);
  } else flash('markers cannot be deleted (move them instead)');
}

function nudge(dx: number, dy: number): void {
  if (sel?.kind === 'point') {
    const p = doc.terrain.spans[sel.ref.span]!.points[sel.ref.point]!;
    commit(movePoint(doc, sel.ref, { x: p.x + dx, y: p.y + dy }));
  } else if (sel?.kind === 'marker') {
    const next = structuredClone(doc);
    const p = markerPos(sel.which);
    setMarker(next, sel.which, { x: p.x + dx, y: p.y + dy });
    commit(next);
  } else if (sel?.kind === 'prop') {
    const next = structuredClone(doc);
    const q = next.props[sel.i]!.position;
    next.props[sel.i]!.position = { x: q.x + dx, y: q.y + dy };
    commit(next);
  }
}

/** Physical key code, falling back to `key` when `code` is empty (synthetic events, some IMEs). */
function keyCode(e: KeyboardEvent): string {
  if (e.code) return e.code;
  if (e.key === ' ') return 'Space';
  if (/^[a-z]$/i.test(e.key)) return `Key${e.key.toUpperCase()}`;
  if (/^[0-9]$/.test(e.key)) return `Digit${e.key}`;
  return e.key;
}

window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  const mod = e.ctrlKey || e.metaKey;
  const code = keyCode(e);
  if (mod && code === 'KeyZ') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if (mod && code === 'KeyY') {
    e.preventDefault();
    redo();
    return;
  }
  if (mod) return;
  const step = e.shiftKey ? 1 : 0.1;
  switch (code) {
    case 'Space':
      spaceHeld = true;
      break;
    case 'Escape':
      stopRoll();
      setMode('select');
      drag = null;
      break;
    case 'Delete':
    case 'Backspace':
      deleteSelection();
      break;
    case 'KeyJ': {
      const span = sel?.kind === 'span' ? sel.span : sel?.kind === 'point' ? sel.ref.span : -1;
      const next = span >= 0 ? joinSpans(doc, span) : null;
      if (!next) flash('select a span that has a span to its right, then J');
      else commit(next);
      break;
    }
    case 'KeyT':
      if (roll) stopRoll();
      else void startRoll();
      break;
    case 'Home':
    case 'Digit0':
      fitView();
      break;
    case 'ArrowLeft':
      nudge(-step, 0);
      break;
    case 'ArrowRight':
      nudge(step, 0);
      break;
    case 'ArrowUp':
      nudge(0, -step);
      break;
    case 'ArrowDown':
      nudge(0, step);
      break;
    default: {
      const m = MODES.find((x) => `Key${x.key}` === code);
      if (!m) return;
      setMode(m.mode);
    }
  }
  e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  if (keyCode(e) === 'Space') spaceHeld = false;
});
window.addEventListener('blur', () => {
  spaceHeld = false;
  drag = null;
});

// ------------------------------------------------------------ panel
const modesEl = $<HTMLDivElement>('modes');
for (const m of MODES) {
  const b = document.createElement('button');
  b.textContent = `${m.label} (${m.key})`;
  b.dataset.mode = m.mode;
  b.addEventListener('click', () => setMode(m.mode));
  modesEl.appendChild(b);
}
setMode('select');

const themeSel = $<HTMLSelectElement>('m-theme');
for (const t of THEME_IDS) themeSel.add(new Option(t, t));

const meta = {
  id: $<HTMLInputElement>('m-id'),
  name: $<HTMLInputElement>('m-name'),
  friction: $<HTMLInputElement>('m-friction'),
  restitution: $<HTMLInputElement>('m-restitution'),
  killY: $<HTMLInputElement>('m-killY'),
  lineX: $<HTMLInputElement>('m-lineX'),
};

function syncMeta(): void {
  const set = (el: HTMLInputElement | HTMLSelectElement, v: string) => {
    if (document.activeElement !== el) el.value = v;
  };
  set(meta.id, doc.id);
  set(meta.name, doc.name);
  set(themeSel, doc.theme);
  set(meta.friction, String(doc.terrain.friction));
  set(meta.restitution, String(doc.terrain.restitution));
  set(meta.killY, String(doc.killY));
  set(meta.lineX, String(round(doc.goal.lineX)));
}

const numOr = (el: HTMLInputElement, fallback: number) => (Number.isFinite(el.valueAsNumber) ? el.valueAsNumber : fallback);
function onMeta(): void {
  const next = structuredClone(doc);
  next.id = meta.id.value;
  next.name = meta.name.value;
  next.theme = themeSel.value as LevelDef['theme'];
  next.terrain.friction = numOr(meta.friction, doc.terrain.friction);
  next.terrain.restitution = numOr(meta.restitution, doc.terrain.restitution);
  next.killY = numOr(meta.killY, doc.killY);
  next.goal.lineX = numOr(meta.lineX, doc.goal.lineX);
  commit(next);
}
[...Object.values(meta), themeSel].forEach((el) => el.addEventListener('change', onMeta));

const round = (v: number) => Math.round(v * 1000) / 1000;

function numField(label: string, value: number, onSet: (v: number) => void, step = 0.1): HTMLLabelElement {
  const l = document.createElement('label');
  l.textContent = label;
  const i = document.createElement('input');
  i.type = 'number';
  i.step = String(step);
  i.value = String(round(value));
  i.addEventListener('change', () => {
    if (Number.isFinite(i.valueAsNumber)) onSet(i.valueAsNumber);
  });
  l.appendChild(i);
  return l;
}

function renderInspector(): void {
  inspectorEl.textContent = '';
  if (!sel) {
    inspectorEl.textContent = 'Nothing selected.';
    return;
  }
  const head = document.createElement('div');
  inspectorEl.appendChild(head);
  if (sel.kind === 'point') {
    const ref = sel.ref;
    const span = doc.terrain.spans[ref.span]!;
    const p = span.points[ref.point]!;
    head.textContent = `span "${span.id}" point ${ref.point + 1}/${span.points.length}`;
    inspectorEl.append(
      numField('x (m)', p.x, (v) => commit(movePoint(doc, ref, { x: v, y: p.y }))),
      numField('y (m, down +)', p.y, (v) => commit(movePoint(doc, ref, { x: p.x, y: v }))),
    );
  } else if (sel.kind === 'span') {
    const span = doc.terrain.spans[sel.span]!;
    head.textContent = `span "${span.id}": ${span.points.length} points, x ${round(span.points[0]!.x)}..${round(span.points.at(-1)!.x)} (J joins with next, Del deletes)`;
  } else if (sel.kind === 'marker') {
    head.textContent = sel.which === 'cartStart' ? 'cart start (design origin)' : sel.which === 'funnel' ? 'funnel' : 'goal sensor';
    if (sel.which === 'goal') {
      const g = doc.goal.sensor;
      const setG = (k: 'x' | 'y' | 'width' | 'height') => (v: number) => {
        const next = structuredClone(doc);
        next.goal.sensor[k] = v;
        commit(next);
      };
      inspectorEl.append(numField('x', g.x, setG('x')), numField('y', g.y, setG('y')), numField('width', g.width, setG('width')), numField('height', g.height, setG('height')));
    } else {
      const which = sel.which;
      const p = markerPos(which);
      const setP = (k: 'x' | 'y') => (v: number) => {
        const next = structuredClone(doc);
        setMarker(next, which, { ...p, [k]: v });
        commit(next);
      };
      inspectorEl.append(numField('x', p.x, setP('x')), numField('y', p.y, setP('y')));
    }
  } else if (sel.kind === 'prop') {
    head.textContent = `prop "${doc.props[sel.i]!.id}" (edit in the Props list)`;
  } else if (sel.kind === 'zone') {
    head.textContent = `zone "${doc.zones[sel.i]!.id}" (edit in the Zones list)`;
  }
}

function renderLists(): void {
  if (propsEl.contains(document.activeElement) || zonesEl.contains(document.activeElement)) return;
  propsEl.textContent = '';
  doc.props.forEach((pr, i) => {
    const box = document.createElement('div');
    box.className = 'item' + (sel?.kind === 'prop' && sel.i === i ? ' sel' : '');
    const row = document.createElement('div');
    row.className = 'row';
    const art = document.createElement('input');
    art.type = 'text';
    art.value = pr.art;
    art.style.width = '7em';
    art.addEventListener('change', () => {
      const next = structuredClone(doc);
      next.props[i]!.art = art.value;
      commit(next);
    });
    const del = document.createElement('button');
    del.textContent = '✕';
    del.addEventListener('click', () => {
      const next = structuredClone(doc);
      next.props.splice(i, 1);
      sel = null;
      commit(next);
    });
    row.append(`${pr.id} art`, art, del);
    const setPos = (k: 'x' | 'y') => (v: number) => {
      const next = structuredClone(doc);
      next.props[i]!.position[k] = v;
      commit(next);
    };
    box.append(row, numField('x', pr.position.x, setPos('x')), numField('y', pr.position.y, setPos('y')));
    propsEl.appendChild(box);
  });
  if (!doc.props.length) propsEl.textContent = 'No props. Press P and click.';

  zonesEl.textContent = '';
  doc.zones.forEach((z, i) => {
    const box = document.createElement('div');
    box.className = 'item' + (sel?.kind === 'zone' && sel.i === i ? ' sel' : '');
    const del = document.createElement('button');
    del.textContent = '✕';
    del.addEventListener('click', () => {
      const next = structuredClone(doc);
      next.zones.splice(i, 1);
      sel = null;
      commit(next);
    });
    const head = document.createElement('div');
    head.className = 'row';
    head.append(`${z.id} (${z.kind})`, del);
    const upd = (f: (zz: ZoneDef) => void) => (v: number) => {
      const next = structuredClone(doc);
      f(next.zones[i]!);
      void v;
      commit(next);
    };
    box.append(
      head,
      numField('x', z.rect.x, (v) => upd((zz) => (zz.rect.x = v))(v)),
      numField('y', z.rect.y, (v) => upd((zz) => (zz.rect.y = v))(v)),
      numField('width', z.rect.width, (v) => upd((zz) => (zz.rect.width = v))(v)),
      numField('height', z.rect.height, (v) => upd((zz) => (zz.rect.height = v))(v)),
    );
    if (z.kind === 'gravity') box.append(numField('gravity scale', z.gravityScale ?? 1, (v) => upd((zz) => (zz.gravityScale = v))(v)));
    else {
      box.append(
        numField('force x', z.force?.x ?? 0, (v) => upd((zz) => (zz.force = { x: v, y: zz.force?.y ?? 0 }))(v), 1),
        numField('force y', z.force?.y ?? 0, (v) => upd((zz) => (zz.force = { x: zz.force?.x ?? 0, y: v }))(v), 1),
      );
    }
    zonesEl.appendChild(box);
  });
  if (!doc.zones.length) zonesEl.textContent = 'No zones. Press Z and drag.';
}

function showError(err: ValidationError, prefix: string): void {
  errorsEl.textContent = `${prefix}\n${err.code}: ${err.message}${err.path ? `\npath: ${err.path}` : ''}`;
}

$<HTMLButtonElement>('new').addEventListener('click', () => loadDoc(defaultLevel(), 'a new level'));
$<HTMLButtonElement>('loadOriginal').addEventListener('click', () => loadDoc(loadOriginalCourse(), 'the original 2008 course'));
$<HTMLButtonElement>('undo').addEventListener('click', undo);
$<HTMLButtonElement>('redo').addEventListener('click', redo);
$<HTMLButtonElement>('fit').addEventListener('click', fitView);
$<HTMLButtonElement>('generate').addEventListener('click', () => {
  const seed = $<HTMLInputElement>('genSeed').value.trim() || '0';
  const len = Math.max(40, Math.min(4000, $<HTMLInputElement>('genLength').valueAsNumber || 600));
  loadDoc(generateLevel(seed, len).level, `generated level (seed "${seed}", ${len} m)`);
});

function importText(text: string, what: string): void {
  const r = parseLevelDef(text);
  if (!r.ok) {
    showError(r.error, `Import of ${what} rejected — current level unchanged.`);
    return;
  }
  loadDoc(r.value, what + (r.migratedFrom !== undefined ? ` (migrated from v${r.migratedFrom})` : ''));
}
$<HTMLButtonElement>('import').addEventListener('click', () => importText(jsonEl.value, 'pasted JSON'));
$<HTMLInputElement>('file').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  if (f.size > 20 * 1024 * 1024) {
    errorsEl.textContent = `File ${f.name} is too large (${f.size} bytes)`;
    return;
  }
  importText(await f.text(), f.name);
  (e.target as HTMLInputElement).value = '';
});

/** Validated JSON of the current doc, or null (error shown). */
function exportJson(): string | null {
  const r = validateLevelDef(doc);
  if (!r.ok) {
    showError(r.error, 'Export blocked: the level does not validate.');
    return null;
  }
  errorsEl.textContent = '';
  return JSON.stringify(r.value, null, 1) + '\n';
}
$<HTMLButtonElement>('export').addEventListener('click', () => {
  const j = exportJson();
  if (j) {
    jsonEl.value = j;
    flash('exported to the text box');
  }
});
$<HTMLButtonElement>('download').addEventListener('click', () => {
  const j = exportJson();
  if (!j) return;
  const url = URL.createObjectURL(new Blob([j], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.id.replace(/[^a-z0-9_-]+/gi, '_') || 'level'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$<HTMLButtonElement>('copy').addEventListener('click', () => {
  const j = exportJson();
  if (!j) return;
  navigator.clipboard?.writeText(j).then(
    () => flash('copied'),
    () => {
      jsonEl.value = j;
      flash('clipboard unavailable: JSON placed in the text box');
    },
  );
});

// ------------------------------------------------------------ test roll
interface Roll {
  world: PhysicsWorld;
  terrain: TerrainStreamer;
  ball: number;
  radius: number;
  clock: FixedStepClock;
  trail: Vec2[];
  level: LevelDef;
  stillFor: number;
  done: string | null;
}
let roll: Roll | null = null;
let rollGen = 0;

async function startRoll(): Promise<void> {
  const r = validateLevelDef(doc);
  if (!r.ok) {
    showError(r.error, 'Test roll needs a valid level.');
    return;
  }
  const gen = ++rollGen;
  const world = await PhysicsWorld.create();
  if (gen !== rollGen) {
    world.destroy();
    return;
  }
  stopRoll();
  rollGen = gen;
  const level = r.value;
  // Stream around the ball (as the game does) rather than loadAll: an imported
  // level can be very long or spread out; streaming keeps the body count bounded.
  const terrain = new TerrainStreamer(world, new LevelChunkSource(level.terrain));
  const radius = Math.max(0.05, $<HTMLInputElement>('rollRadius').valueAsNumber || 0.4);
  const speed = $<HTMLInputElement>('rollSpeed').valueAsNumber || 0;
  const ball = world.createBody({
    type: 'dynamic',
    position: { ...level.cartStart },
    linearVelocity: { x: speed, y: 0 },
    angularVelocity: speed / radius,
    bullet: true,
  });
  world.addCircle(ball, { x: 0, y: 0 }, radius, { density: 1, friction: 0.9, restitution: 0.3, rollingResistance: 0.02 });
  terrain.update([level.cartStart.x]);
  roll = { world, terrain, ball, radius, clock: new FixedStepClock(), trail: [], level, stillFor: 0, done: null };
  rollResultEl.textContent = 'rolling… (T / Esc stops)';
}

function stopRoll(): void {
  rollGen++;
  if (roll && !roll.world.isDestroyed) roll.world.destroy();
  roll = null;
}

function stepRoll(dt: number): void {
  if (!roll || roll.done) return;
  const n = roll.clock.advance(dt);
  for (let i = 0; i < n && !roll.done; i++) {
    roll.world.step();
    roll.terrain.update([roll.world.getTransform(roll.ball).x]);
    const t = roll.world.getTransform(roll.ball);
    if (roll.world.steps % 3 === 0) roll.trail.push({ x: t.x, y: t.y });
    const v = roll.world.getLinearVelocity(roll.ball);
    roll.stillFor = Math.hypot(v.x, v.y) < 0.05 ? roll.stillFor + 1 : 0;
    const time = roll.world.simTime.toFixed(1);
    if (t.y > roll.level.killY) roll.done = `fell below killY at x ${t.x.toFixed(1)} m after ${time} s (gap or edge)`;
    else if (t.x >= roll.level.goal.lineX) roll.done = `crossed the goal line after ${time} s`;
    else if (roll.stillFor > 120) roll.done = `stopped at x ${t.x.toFixed(1)} m after ${time} s`;
    else if (roll.world.simTime > 120) roll.done = `still rolling after 120 s, x ${t.x.toFixed(1)} m`;
  }
  if (roll.done) rollResultEl.textContent = `Ball ${roll.done}.`;
  if (roll && $<HTMLInputElement>('follow').checked) {
    const t = roll.world.getTransform(roll.ball);
    camera.center = { x: camera.center.x + (t.x - camera.center.x) * 0.15, y: camera.center.y + (t.y - 2 - camera.center.y) * 0.15 };
  }
}
$<HTMLButtonElement>('roll').addEventListener('click', () => void startRoll());

// ------------------------------------------------------------ drawing
function line(a: Vec2, b: Vec2): void {
  const p = S(a);
  const q = S(b);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(q.x, q.y);
  ctx.stroke();
}

function draw(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  camera.viewportWidth = w;
  camera.viewportHeight = h;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#1b202b';
  ctx.fillRect(0, 0, w, h);
  const k = ppm();
  const tl = screenToWorld({ x: 0, y: 0 }, camera);
  const br = screenToWorld({ x: w, y: h }, camera);

  // grid
  const minor = k >= 12 ? 1 : k >= 3 ? 5 : k >= 0.6 ? 25 : 100;
  const major = minor * 10;
  ctx.lineWidth = 1;
  ctx.font = '11px ui-monospace, monospace';
  for (let x = Math.floor(tl.x / minor) * minor; x <= br.x; x += minor) {
    const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-9;
    ctx.strokeStyle = isMajor ? '#ffffff22' : '#ffffff0c';
    line({ x, y: tl.y }, { x, y: br.y });
    if (isMajor) {
      ctx.fillStyle = '#ffffff55';
      ctx.fillText(`${x}`, S({ x, y: 0 }).x + 3, h - 24);
    }
  }
  for (let y = Math.floor(tl.y / minor) * minor; y <= br.y; y += minor) {
    const isMajor = Math.abs(y / major - Math.round(y / major)) < 1e-9;
    ctx.strokeStyle = isMajor ? '#ffffff22' : '#ffffff0c';
    line({ x: tl.x, y }, { x: br.x, y });
    if (isMajor) {
      ctx.fillStyle = '#ffffff55';
      ctx.fillText(`y ${y}`, 4, S({ x: 0, y }).y - 3);
    }
  }
  // chunk boundaries
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = '#7aa2ff33';
  for (let c = Math.floor(tl.x / CHUNK_WIDTH); c * CHUNK_WIDTH <= br.x; c++) line({ x: c * CHUNK_WIDTH, y: tl.y }, { x: c * CHUNK_WIDTH, y: br.y });
  ctx.setLineDash([]);

  // zones
  doc.zones.forEach((z, i) => {
    const a = S({ x: z.rect.x, y: z.rect.y });
    ctx.fillStyle = z.kind === 'gravity' ? '#38bdf826' : '#c084fc26';
    ctx.fillRect(a.x, a.y, z.rect.width * k, z.rect.height * k);
    ctx.strokeStyle = sel?.kind === 'zone' && sel.i === i ? '#fff' : z.kind === 'gravity' ? '#38bdf8' : '#c084fc';
    ctx.strokeRect(a.x, a.y, z.rect.width * k, z.rect.height * k);
    ctx.fillStyle = '#fff9';
    ctx.fillText(`${z.id} ${z.kind === 'gravity' ? `×${z.gravityScale}` : `F(${z.force?.x},${z.force?.y})`}`, a.x + 4, a.y + 13);
  });
  if (drag?.kind === 'newZone') {
    const a = S(drag.from);
    const b = S(drag.to);
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  }

  // kill plane
  const ky = S({ x: 0, y: doc.killY }).y;
  ctx.strokeStyle = '#ff5c5c88';
  ctx.setLineDash([10, 6]);
  line({ x: tl.x, y: doc.killY }, { x: br.x, y: doc.killY });
  ctx.setLineDash([]);
  ctx.fillStyle = '#ff8a8a';
  ctx.fillText('killY', 4, ky - 3);

  // terrain
  const hoverSeg: SegmentRef | null = mode === 'add' || mode === 'cut' ? hitSegment(doc, mouseWorld, (TOL_PX * 1.5) / k) : null;
  doc.terrain.spans.forEach((s, si) => {
    const pts = s.points.map(S);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.lineTo(pts.at(-1)!.x, Math.max(ky, pts.at(-1)!.y));
    ctx.lineTo(pts[0]!.x, Math.max(ky, pts[0]!.y));
    ctx.closePath();
    ctx.fillStyle = '#6b8f4e40';
    ctx.fill();
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.strokeStyle = sel?.kind === 'span' && sel.span === si ? '#ffffff' : '#b8e986';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 1;
    if (hoverSeg && hoverSeg.span === si) {
      ctx.strokeStyle = mode === 'cut' ? '#ff5c5c' : '#3b82f6';
      ctx.lineWidth = 4;
      line(s.points[hoverSeg.seg]!, s.points[hoverSeg.seg + 1]!);
      ctx.lineWidth = 1;
    }
    pts.forEach((p, pi) => {
      const selected = sel?.kind === 'point' && sel.ref.span === si && sel.ref.point === pi;
      ctx.fillStyle = selected ? '#ff5c5c' : '#e6e6e6';
      const r = selected ? 5 : 3.5;
      ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r);
    });
    ctx.fillStyle = '#b8e986aa';
    ctx.fillText(s.id, pts[0]!.x + 4, pts[0]!.y - 8);
    // gap to the next span
    const next = doc.terrain.spans[si + 1];
    if (next) {
      const a = s.points.at(-1)!;
      const b = next.points[0]!;
      if (b.x > a.x) {
        ctx.strokeStyle = '#ff5c5c';
        ctx.setLineDash([3, 3]);
        line(a, b);
        ctx.setLineDash([]);
        const m = S({ x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) });
        ctx.fillStyle = '#ff8a8a';
        ctx.fillText(`gap ${(b.x - a.x).toFixed(2)} m`, m.x - 30, m.y - 10);
      }
    }
  });

  // markers
  const cs = S(doc.cartStart);
  ctx.strokeStyle = sel?.kind === 'marker' && sel.which === 'cartStart' ? '#fff' : '#ffd166';
  ctx.lineWidth = 2;
  ctx.strokeRect(cs.x - 0.6 * k, cs.y - 0.3 * k, 3 * k, 0.6 * k);
  ctx.beginPath();
  ctx.arc(cs.x, cs.y, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ffd166';
  ctx.fillText('cart start', cs.x + 6, cs.y - 0.3 * k - 4);
  const fu = S(doc.funnel);
  ctx.strokeStyle = sel?.kind === 'marker' && sel.which === 'funnel' ? '#fff' : '#f4a259';
  ctx.beginPath();
  ctx.moveTo(fu.x - 0.8 * k, fu.y - 0.8 * k);
  ctx.lineTo(fu.x, fu.y);
  ctx.lineTo(fu.x + 0.8 * k, fu.y - 0.8 * k);
  ctx.stroke();
  ctx.fillStyle = '#f4a259';
  ctx.fillText('funnel', fu.x + 6, fu.y + 12);
  const g = doc.goal.sensor;
  const gs = S({ x: g.x, y: g.y });
  ctx.strokeStyle = sel?.kind === 'marker' && sel.which === 'goal' ? '#fff' : '#4ade80';
  ctx.strokeRect(gs.x, gs.y, g.width * k, g.height * k);
  ctx.setLineDash([8, 4]);
  line({ x: doc.goal.lineX, y: tl.y }, { x: doc.goal.lineX, y: br.y });
  ctx.setLineDash([]);
  ctx.fillStyle = '#4ade80';
  ctx.fillText('goal', gs.x + 2, gs.y - 4);
  ctx.lineWidth = 1;

  // props
  doc.props.forEach((p, i) => {
    const q = S(p.position);
    ctx.strokeStyle = sel?.kind === 'prop' && sel.i === i ? '#fff' : '#c3a6ff';
    ctx.beginPath();
    ctx.arc(q.x, q.y, Math.max(5, 0.4 * k), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#c3a6ff';
    ctx.fillText(p.art, q.x + 8, q.y + 4);
  });

  // test roll
  if (roll && !roll.world.isDestroyed) {
    ctx.strokeStyle = '#ffd16688';
    ctx.beginPath();
    roll.trail.forEach((p, i) => {
      const q = S(p);
      if (i) ctx.lineTo(q.x, q.y);
      else ctx.moveTo(q.x, q.y);
    });
    ctx.stroke();
    const t = roll.world.getTransform(roll.ball);
    const q = S(t);
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(q.x, q.y, roll.radius * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    line(t, { x: t.x + Math.cos(t.angle) * roll.radius, y: t.y + Math.sin(t.angle) * roll.radius });
  }

  // status
  const v = validity.ok
    ? '<span class="ok">valid ✓</span>'
    : `<span class="bad">INVALID — ${escapeHtml(validity.error.message)}</span>`;
  const pts = doc.terrain.spans.reduce((n, s) => n + s.points.length, 0);
  const msg = performance.now() < messageUntil ? `  — ${escapeHtml(message)}` : '';
  statusEl.innerHTML =
    `mode ${mode}  x ${mouseWorld.x.toFixed(2)}  y ${mouseWorld.y.toFixed(2)} m  ` +
    `spans ${doc.terrain.spans.length}  points ${pts}  undo ${undoStack.length}  ${v}${msg}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

let lastT = performance.now();
function frame(now: number): void {
  const dt = (now - lastT) / 1000;
  lastT = now;
  stepRoll(dt);
  draw();
  requestAnimationFrame(frame);
}

changed();
requestAnimationFrame(() => {
  fitView();
  requestAnimationFrame(frame);
});
