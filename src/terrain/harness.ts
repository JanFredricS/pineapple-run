/**
 * S3 terrain harness page (terrain-harness.html).
 *
 * Streams terrain chunks around live bodies into the real physics world and
 * draws them through a ChunkLifecycleListener (a stand-in for the S4
 * renderer: it only ever sees chunk data from the listener callbacks).
 *
 * Acceptance checklist (manual):
 *  1. Endless: drive right (→) — chunks appear ahead, disappear behind; the
 *     HUD's loaded range follows [min live x − 30, max live x + 90].
 *  2. P drops a pineapple; drive away — its chunks stay loaded (body-aware
 *     retention). L marks all pineapples lost — the trailing chunks go.
 *  3. J / H teleport the cart ±300 m, or drive back: "regen mismatches"
 *     stays 0 (every recreated chunk equals its first creation).
 *  4. Ball rolls over chunk seams without hops; gaps swallow it.
 *  5. Other sources: generated level, original 2008 course, S0 spike level.
 */

import type { Camera } from '../model/coords';
import { worldToScreen, pixelsPerMetre } from '../model/coords';
import type { LevelDef } from '../model/level';
import { FrameLoop } from '../physics/clock';
import { PhysicsWorld } from '../physics/engine';
import { loadSpikeLevel } from '../spike/data';
import { LevelChunkSource, surfaceYAt, type ChunkLifecycleListener, type TerrainChunk, type TerrainSource } from './chunks';
import { ENDLESS_KILL_Y, generateLevel, ProceduralChunkSource, START_CART } from './generator';
import { loadOriginalCourse } from './levels';
import { TerrainStreamer } from './runtime';
import { retentionWindow } from './streaming';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const ctx = canvas.getContext('2d')!;
const hud = $<HTMLDivElement>('hud');
const sourceSel = $<HTMLSelectElement>('source');
const seedIn = $<HTMLInputElement>('seed');
const lengthIn = $<HTMLInputElement>('length');
const autoBox = $<HTMLInputElement>('auto');
const overlayBox = $<HTMLInputElement>('chunkview');

const CART_R = 0.8;
const PINEAPPLE_R = 1 / 3;

interface Scene {
  world: PhysicsWorld;
  source: TerrainSource;
  streamer: TerrainStreamer;
  killY: number;
  cart: number;
  pineapples: { body: number; live: boolean }[];
  label: string;
  endless: ProceduralChunkSource | null;
}

/** The "renderer": mirrors chunks purely from lifecycle callbacks. */
class MirrorRenderer implements ChunkLifecycleListener {
  readonly chunks = new Map<number, TerrainChunk>();
  private readonly firstSeen = new Map<number, string>();
  created = 0;
  destroyed = 0;
  recreated = 0;
  mismatches = 0;

  chunkCreated(chunk: TerrainChunk): void {
    this.created++;
    this.chunks.set(chunk.index, chunk);
    const json = JSON.stringify(chunk);
    const prev = this.firstSeen.get(chunk.index);
    if (prev === undefined) this.firstSeen.set(chunk.index, json);
    else {
      this.recreated++;
      if (prev !== json) this.mismatches++;
    }
  }

  chunkDestroyed(index: number): void {
    this.destroyed++;
    this.chunks.delete(index);
  }
}

let scene: Scene | null = null;
let mirror = new MirrorRenderer();
let generation = 0;
const camera: Camera = { center: { x: 0, y: 8 }, zoom: 1, viewportWidth: 1, viewportHeight: 1 };
let userZoom = 1;
let lastProgress = { x: 0, t: 0 };

function makeSource(): { source: TerrainSource; killY: number; label: string; endless: ProceduralChunkSource | null; level?: LevelDef } {
  const seed = seedIn.value.trim() || '0';
  switch (sourceSel.value) {
    case 'generated': {
      const len = Math.max(40, Math.min(60_000, Number(lengthIn.value) || 1200));
      const { level } = generateLevel(seed, len);
      return { source: new LevelChunkSource(level.terrain), killY: level.killY, label: level.name, endless: null, level };
    }
    case 'original': {
      const level = loadOriginalCourse();
      return { source: new LevelChunkSource(level.terrain), killY: level.killY, label: level.name, endless: null, level };
    }
    case 'spike': {
      const level = loadSpikeLevel();
      return { source: new LevelChunkSource(level.terrain), killY: level.killY, label: level.name, endless: null, level };
    }
    default: {
      const endless = new ProceduralChunkSource(seed);
      return { source: endless, killY: ENDLESS_KILL_Y, label: `Endless seed "${seed}" (${endless.seed})`, endless };
    }
  }
}

function groundY(source: TerrainSource, x: number): number | null {
  return surfaceYAt(source.chunk(Math.floor(x / source.chunkWidth)), x);
}

function spawnCart(world: PhysicsWorld, x: number, y: number): number {
  const b = world.createBody({ type: 'dynamic', position: { x, y }, angularDamping: 0.1, role: 'wheel' });
  world.addCircle(b, { x: 0, y: 0 }, CART_R, { density: 1, friction: 0.9, restitution: 0.2 });
  return b;
}

async function reset(): Promise<void> {
  const gen = ++generation;
  const world = await PhysicsWorld.create();
  if (gen !== generation) {
    world.destroy();
    return;
  }
  if (scene && !scene.world.isDestroyed) {
    scene.streamer.destroyAll();
    scene.world.destroy();
  }
  const s = makeSource();
  mirror = new MirrorRenderer();
  const streamer = new TerrainStreamer(world, s.source);
  streamer.addListener(mirror);
  const start = s.level ? s.level.cartStart : START_CART;
  const gy = groundY(s.source, start.x) ?? start.y + 1.8;
  const cart = spawnCart(world, start.x, gy - CART_R - 0.2);
  scene = { world, source: s.source, streamer, killY: s.killY, cart, pineapples: [], label: s.label, endless: s.endless };
  camera.center = { x: start.x, y: gy - 3 };
  lastProgress = { x: start.x, t: 0 };
  streamer.update(liveXs(scene)); // stream the initial window before the first step (also while paused)
  loop.clock.reset();
}

function teleport(dx: number): void {
  if (!scene) return;
  const t = scene.world.getTransform(scene.cart);
  let x = t.x + dx;
  if (Number.isFinite(scene.source.firstChunk)) x = Math.max(scene.source.firstChunk * scene.source.chunkWidth + 1, x);
  if (Number.isFinite(scene.source.lastChunk)) x = Math.min((scene.source.lastChunk + 1) * scene.source.chunkWidth - 1, x);
  // find solid ground near x
  for (let probe = 0; probe < 40; probe++) {
    const gx = x + probe * 0.5;
    const gy = groundY(scene.source, gx);
    if (gy !== null) {
      scene.world.destroyBody(scene.cart);
      scene.cart = spawnCart(scene.world, gx, gy - CART_R - 0.3);
      camera.center = { x: gx, y: gy - 3 };
      return;
    }
  }
}

// ------------------------------------------------------------------ input
const held = { left: false, right: false };
const onKey = (down: boolean) => (e: KeyboardEvent) => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  // `code` can be empty for synthetic events; fall back to `key`.
  switch (e.code || (/^[a-z]$/i.test(e.key) ? `Key${e.key.toUpperCase()}` : e.key)) {
    case 'ArrowLeft':
    case 'KeyA':
      held.left = down;
      break;
    case 'ArrowRight':
    case 'KeyD':
      held.right = down;
      break;
    case 'KeyR':
      if (down) void reset();
      break;
    case 'KeyP':
      if (down && scene) {
        const t = scene.world.getTransform(scene.cart);
        const b = scene.world.createBody({ type: 'dynamic', position: { x: t.x, y: t.y - 2 }, bullet: true, role: 'pineapple' });
        scene.world.addCircle(b, { x: 0, y: 0 }, PINEAPPLE_R, { friction: 0.9, restitution: 0.3, rollingResistance: 0.1 });
        scene.pineapples.push({ body: b, live: true });
      }
      break;
    case 'KeyL':
      if (down && scene) scene.pineapples.forEach((p) => (p.live = false));
      break;
    case 'KeyJ':
      if (down) teleport(300);
      break;
    case 'KeyH':
      if (down) teleport(-300);
      break;
    default:
      return;
  }
  e.preventDefault();
};
window.addEventListener('keydown', onKey(true));
window.addEventListener('keyup', onKey(false));
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    userZoom = Math.max(0.1, Math.min(4, userZoom * (e.deltaY > 0 ? 0.9 : 1.1)));
  },
  { passive: false },
);
$<HTMLButtonElement>('reset').addEventListener('click', () => void reset());
sourceSel.addEventListener('change', () => void reset());

// ------------------------------------------------------------------ loop
function liveXs(s: Scene): number[] {
  const xs = [s.world.getTransform(s.cart).x];
  for (const p of s.pineapples) {
    if (!p.live) continue;
    const t = s.world.getTransform(p.body);
    if (t.y > s.killY) {
      p.live = false; // fell off: no longer holds terrain
      continue;
    }
    xs.push(t.x);
  }
  return xs;
}

const loop = new FrameLoop({
  step() {
    const s = scene;
    if (!s || s.world.isDestroyed) return;
    const drive = autoBox.checked ? 1 : held.right === held.left ? 0 : held.right ? 1 : -1;
    const w = s.world.getAngularVelocity(s.cart);
    const mass = s.world.getMass(s.cart);
    // original rule: torque = 20 × mass, spin capped at ±20 rad/s (clockwise = forward, y-down)
    if (drive !== 0 && Math.abs(w) < 20) s.world.applyTorque(s.cart, drive * 20 * mass);
    s.world.step();
    const t = s.world.getTransform(s.cart);
    if (t.y > s.killY) {
      teleport(-10);
    }
    if (autoBox.checked) {
      if (t.x > lastProgress.x + 1) lastProgress = { x: t.x, t: s.world.simTime };
      else if (s.world.simTime - lastProgress.t > 3) {
        teleport(12);
        lastProgress = { x: t.x + 12, t: s.world.simTime };
      }
    }
    s.streamer.update(liveXs(s));
  },
  render(alpha) {
    draw(alpha);
  },
  onPauseChange(paused) {
    if (paused) held.left = held.right = false;
  },
});
loop.bindVisibility();
loop.start();

let fps = 60;
let lastFrame = performance.now();

function draw(alpha: number): void {
  const now = performance.now();
  fps = fps * 0.9 + (1000 / Math.max(1, now - lastFrame)) * 0.1;
  lastFrame = now;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#1d2330';
  ctx.fillRect(0, 0, w, h);
  const s = scene;
  if (!s || s.world.isDestroyed) return;

  const snap = s.world.snapshot(alpha);
  const cartT = snap.bodies.find((b) => b.id === s.cart);
  camera.viewportWidth = w;
  camera.viewportHeight = h;
  camera.zoom = Math.min(1.5, Math.max(0.35, w / (40 * 30))) * userZoom;
  if (cartT) {
    camera.center.x += (cartT.x + 6 - camera.center.x) * 0.12;
    camera.center.y += (cartT.y - 2 - camera.center.y) * 0.12;
  }
  const k = pixelsPerMetre(camera);
  const S = (p: { x: number; y: number }) => worldToScreen(p, camera);

  // retention window
  const win = retentionWindow(liveXs(s), s.streamer.config);
  if (win && overlayBox.checked) {
    const a = S({ x: win.min, y: 0 }).x;
    const b = S({ x: win.max, y: 0 }).x;
    ctx.fillStyle = '#3b82f614';
    ctx.fillRect(a, 0, b - a, h);
  }

  // chunks (from the mirror only)
  const killScreenY = S({ x: 0, y: s.killY }).y;
  for (const chunk of mirror.chunks.values()) {
    const even = chunk.index % 2 === 0;
    for (const piece of chunk.pieces) {
      ctx.beginPath();
      piece.forEach((p, i) => {
        const q = S(p);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      const last = S(piece[piece.length - 1]!);
      const first = S(piece[0]!);
      ctx.lineTo(last.x, Math.max(killScreenY, last.y));
      ctx.lineTo(first.x, Math.max(killScreenY, first.y));
      ctx.closePath();
      ctx.fillStyle = overlayBox.checked ? (even ? '#4b6b3a' : '#3d5a6e') : '#4b6b3a';
      ctx.fill();
      ctx.beginPath();
      piece.forEach((p, i) => {
        const q = S(p);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.strokeStyle = '#b8e986';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (overlayBox.checked) {
      const x0 = S({ x: chunk.x0, y: 0 }).x;
      ctx.strokeStyle = '#ffffff30';
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.lineTo(x0, h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffffff90';
      ctx.font = '12px ui-monospace, monospace';
      ctx.fillText(`#${chunk.index}`, x0 + 4, 48);
      for (const piece of chunk.pieces) {
        for (const p of piece) {
          const q = S(p);
          ctx.fillStyle = '#ffffff60';
          ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3);
        }
      }
    }
  }

  // kill plane
  ctx.strokeStyle = '#ff5c5c60';
  ctx.beginPath();
  ctx.moveTo(0, killScreenY);
  ctx.lineTo(w, killScreenY);
  ctx.stroke();

  // bodies
  for (const b of snap.bodies) {
    const isCart = b.id === s.cart;
    const pa = s.pineapples.find((p) => p.body === b.id);
    if (!isCart && !pa) continue;
    const r = isCart ? CART_R : PINEAPPLE_R;
    const c = S(b);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * k, 0, Math.PI * 2);
    ctx.fillStyle = isCart ? '#ffd166' : pa!.live ? '#f4a259' : '#777';
    ctx.fill();
    ctx.strokeStyle = '#000a';
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x + Math.cos(b.angle) * r * k, c.y + Math.sin(b.angle) * r * k);
    ctx.stroke();
  }

  const cx = cartT ? cartT.x : 0;
  const feature = s.endless?.feature(Math.max(0, Math.floor(cx / 40)));
  const loaded = s.streamer.loadedChunks();
  hud.textContent =
    `${s.label}\n` +
    `fps ${fps.toFixed(0)}  x ${cx.toFixed(1)} m  live bodies ${1 + s.pineapples.filter((p) => p.live).length}\n` +
    `loaded chunks ${loaded.length ? `${loaded[0]}..${loaded[loaded.length - 1]}` : '-'} (${loaded.length})  ` +
    `window ${win ? `${win.min.toFixed(0)}..${win.max.toFixed(0)} m` : '-'}\n` +
    `created ${mirror.created}  destroyed ${mirror.destroyed}  recreated ${mirror.recreated}  regen mismatches ${mirror.mismatches}\n` +
    (s.endless ? `block feature: ${feature ? `${feature.kind} @ ${feature.x0.toFixed(0)}–${feature.x1.toFixed(0)} m` : 'none'}\n` : '') +
    `←/→ drive  P drop pineapple  L lose pineapples  J/H jump ±300 m  R reset  wheel zoom${loop.clock.paused ? '  [paused]' : ''}`;
}

void reset();
