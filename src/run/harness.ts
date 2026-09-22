/**
 * S1 run harness page (run-harness.html): loads a CartDesign + LevelDef
 * (fixtures by default, or JSON files through run/loadCheck: schema +
 * attachments, rejected files never replace the current run), runs the
 * RunController with the debug-draw overlay, drive keys / touch buttons,
 * Start / Release / Give Up, and an overlay log of every lifecycle event.
 */

import { Application, Graphics } from 'pixi.js';
import type { CartDesign } from '../model/cart';
import { cameraTransform, type Camera } from '../model/coords';
import type { LevelDef } from '../model/level';
import { isTerminalRunEvent, type RunEvent } from '../model/runEvents';
import { FrameLoop } from '../physics/clock';
import { PhysicsWorld } from '../physics/engine';
import { DebugDraw } from '../render/debugDraw';
import { RunController, type RunMode } from './controller';
import { loadFixtureCart, loadFlatGoalLevel } from './fixtures';
import { DriveInput, bindTouchButton, type DriveSide } from './input';
import { checkCartJson, checkLevelJson } from './loadCheck';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

async function main(): Promise<void> {
  const host = $('stage');
  const app = new Application();
  await app.init({ resizeTo: host, background: 0x1d2330, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2) });
  host.appendChild(app.canvas);

  const debug = new DebugDraw();
  const overlay = new Graphics();
  app.stage.addChild(overlay, debug.view);

  const ui = {
    start: $<HTMLButtonElement>('start'),
    release: $<HTMLButtonElement>('release'),
    giveUp: $<HTMLButtonElement>('giveup'),
    reset: $<HTMLButtonElement>('reset'),
    fixtures: $<HTMLButtonElement>('fixtures'),
    cartFile: $<HTMLInputElement>('cartFile'),
    levelFile: $<HTMLInputElement>('levelFile'),
    source: $('source'),
    error: $('error'),
    hud: $('hud'),
    log: $('log'),
  };

  let design: CartDesign = loadFixtureCart();
  let level: LevelDef = loadFlatGoalLevel();
  let sourceLabel = { cart: 'fixture: spike cart', level: 'fixture: flat-goal level' };

  const input = new DriveInput();
  // ?mode=endless runs the endless end rule (last pineapple lost -> allLost; no goal)
  const mode: RunMode = new URLSearchParams(location.search).get('mode') === 'endless' ? 'endless' : 'level';
  let world: PhysicsWorld | null = null;
  let run: RunController | null = null;

  // ----------------------------------------------------------- run setup
  // Worlds are created asynchronously; a generation token lets only the
  // latest (re)build win, and stale worlds are destroyed immediately. A new
  // run is built BEFORE the current one is torn down: if the candidate cart /
  // level cannot be built, the error is shown and the current run is kept.
  let generation = 0;
  const rebuild = async (
    next: { design: CartDesign; level: LevelDef; label: typeof sourceLabel } = { design, level, label: sourceLabel },
  ): Promise<boolean> => {
    const gen = ++generation;
    const w = await PhysicsWorld.create();
    if (gen !== generation) {
      w.destroy();
      return false;
    }
    let r: RunController;
    try {
      r = new RunController(w, next.design, next.level, { mode });
    } catch (err) {
      w.destroy();
      ui.error.textContent = `Cannot build run: ${err instanceof Error ? err.message : String(err)} (kept the current run)`;
      return false;
    }
    // commit: tear down the old run, adopt the new one
    input.clear();
    run?.destroy();
    if (world && !world.isDestroyed) world.destroy();
    ui.log.replaceChildren();
    design = next.design;
    level = next.level;
    sourceLabel = next.label;
    r.on(onEvent);
    world = w;
    run = r;
    loop.clock.reset();
    ui.error.textContent = '';
    ui.source.textContent = `${sourceLabel.cart} · ${sourceLabel.level}`;
    return true;
  };

  const onEvent = (e: RunEvent): void => {
    const li = document.createElement('li');
    li.className = e.type;
    const { type, ...rest } = e;
    li.textContent = `${type} ${JSON.stringify(rest)} @step ${run?.steps ?? 0}`;
    ui.log.appendChild(li);
    ui.log.scrollTop = ui.log.scrollHeight;
    console.info('[run event]', JSON.stringify(e));
    // phase changes drop any held input
    if (isTerminalRunEvent(e)) input.clear();
  };

  // ------------------------------------------------------------ controls
  const doStart = () => run?.start();
  const doRelease = () => run?.release();
  const doGiveUp = () => run?.giveUp();
  ui.start.addEventListener('click', doStart);
  ui.release.addEventListener('click', doRelease);
  ui.giveUp.addEventListener('click', doGiveUp);
  ui.reset.addEventListener('click', () => void rebuild());
  ui.fixtures.addEventListener('click', () => {
    void rebuild({
      design: loadFixtureCart(),
      level: loadFlatGoalLevel(),
      label: { cart: 'fixture: spike cart', level: 'fixture: flat-goal level' },
    });
  });
  const loadFile = (el: HTMLInputElement, kind: 'cart' | 'level') => {
    el.addEventListener('change', () => {
      const file = el.files?.[0];
      el.value = '';
      if (!file) return;
      void file.text().then((text) => {
        // validate fully (schema + attachments) before touching the current run
        const label = { ...sourceLabel, [kind]: `${kind}: ${file.name}` };
        if (kind === 'cart') {
          const r = checkCartJson(text);
          if (!r.ok) ui.error.textContent = `cart ${file.name}: ${r.message}`;
          else void rebuild({ design: r.value, level, label });
        } else {
          const r = checkLevelJson(text);
          if (!r.ok) ui.error.textContent = `level ${file.name}: ${r.message}`;
          else void rebuild({ design, level: r.value, label });
        }
      });
    });
  };
  loadFile(ui.cartFile, 'cart');
  loadFile(ui.levelFile, 'level');

  const unbindKeys = input.bindKeyboard(window);
  window.addEventListener('keydown', (e) => {
    // (focused buttons / inputs handle their own Enter; don't double-fire)
    if (e.repeat || (e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON'))) return;
    if (e.code === 'Enter') {
      if (run?.phase === 'idle') doStart();
      else if (run?.phase === 'started') doRelease();
    } else if (e.code === 'KeyG') doGiveUp();
    else if (e.code === 'KeyR') void rebuild();
    else return;
    e.preventDefault();
  });
  touchButtons(document.body, input);

  // -------------------------------------------------------------- loop
  const camera: Camera = { center: { x: 0, y: 0 }, zoom: 1, viewportWidth: 1, viewportHeight: 1 };
  let fps = 60;
  let lastFrame = performance.now();

  const loop = new FrameLoop({
    step() {
      if (!run || !world || world.isDestroyed) return;
      run.setDrive(input.direction);
      run.step();
    },
    render(alpha) {
      const now = performance.now();
      fps = fps * 0.9 + (1000 / Math.max(1, now - lastFrame)) * 0.1;
      lastFrame = now;
      if (!run || !world || world.isDestroyed) return;
      const w = app.screen.width;
      const h = app.screen.height;
      camera.viewportWidth = w;
      camera.viewportHeight = h;
      camera.zoom = Math.min(1.5, Math.max(0.5, w / (24 * 30)));
      camera.center = run.camera.interpolated(alpha);

      const snap = world.snapshot(alpha);
      debug.draw(world.manifest(), snap, world.debugJointLines(snap), camera);
      drawOverlay(overlay, camera, run);

      ui.start.disabled = run.phase !== 'idle';
      ui.release.disabled = run.phase !== 'started';
      ui.giveUp.disabled = run.phase === 'ended';
      const rm = run.rightmostCartBody();
      ui.hud.textContent =
        `${run.mode} · phase ${run.phase}${loop.clock.paused ? '  [paused]' : ''}   fps ${fps.toFixed(0)}\n` +
        `sim ${run.simTime().toFixed(2)} s since Release  (step ${run.steps})\n` +
        `remaining ${run.remaining}/${run.total}  aboard ${run.aboard}  delivered ${run.delivered ?? '–'}\n` +
        `drive ${input.direction}  cart x ${rm ? rm.x.toFixed(1) : 'lost'} m`;
    },
    onPauseChange(paused) {
      // hidden / blurred / manual pause: drop every held key and finger
      if (paused) input.clear();
    },
  });
  loop.bindVisibility();
  loop.start();
  await rebuild();

  // for debugging from the console / browser tools
  (window as unknown as Record<string, unknown>).__runHarness = {
    get run() {
      return run;
    },
    get world() {
      return world;
    },
    input,
    loop,
    unbindKeys,
  };
}

/** Goal sensor, goal line, kill plane, aboard box — in world metres under the camera transform. */
function drawOverlay(g: Graphics, camera: Camera, run: RunController): void {
  const t = cameraTransform(camera);
  g.scale.set(t.scale);
  g.position.set(t.offsetX, t.offsetY);
  const px = 1 / t.scale;
  const { level } = run;
  const s = level.goal.sensor;
  g.clear();
  g.rect(s.x, s.y, s.width, s.height).fill({ color: 0x3fbf7f, alpha: 0.25 }).stroke({ width: 1 * px, color: 0x3fbf7f });
  const top = camera.center.y - camera.viewportHeight / 2 / t.scale;
  const bottom = camera.center.y + camera.viewportHeight / 2 / t.scale;
  const left = camera.center.x - camera.viewportWidth / 2 / t.scale;
  const right = camera.center.x + camera.viewportWidth / 2 / t.scale;
  g.moveTo(level.goal.lineX, top).lineTo(level.goal.lineX, bottom).stroke({ width: 1 * px, color: 0x3fbf7f, alpha: 0.7 });
  g.moveTo(left, level.killY).lineTo(right, level.killY).stroke({ width: 1 * px, color: 0xff4d6d, alpha: 0.6 });
  const box = run.aboardBox;
  if (box) g.rect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY).stroke({ width: 1 * px, color: 0xffffff, alpha: 0.35 });
}

/** Hold-to-drive buttons (wiring: input.bindTouchButton — pointerup releases one finger, cancel clears all). */
function touchButtons(host: HTMLElement, input: DriveInput): void {
  const bar = document.createElement('div');
  bar.style.cssText =
    'position:fixed;left:0;right:0;bottom:calc(16px + env(safe-area-inset-bottom,0px));display:flex;justify-content:space-between;padding:0 16px;pointer-events:none';
  const mk = (label: string, side: DriveSide) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.setAttribute('aria-label', side === 'left' ? 'Drive left' : 'Drive right');
    b.style.cssText =
      'pointer-events:auto;width:72px;height:72px;border-radius:50%;border:2px solid #fff6;background:#fff2;color:#fff;font-size:28px;touch-action:none';
    bindTouchButton(b, side, input);
    return b;
  };
  bar.append(mk('◀', 'left'), mk('▶', 'right'));
  host.appendChild(bar);
}

main().catch((err: unknown) => {
  console.error(err);
  document.body.textContent = `Harness failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
