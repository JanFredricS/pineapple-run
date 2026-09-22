/**
 * AppState 'run': the real run. Per mount (every Retry is a fresh mount, so
 * nothing carries over between runs):
 *
 *   RunSession (S1 RunController + S3 streamed terrain, fresh PhysicsWorld)
 *   -> S4 SceneRenderer (setLevel, setCartDesign, resetSource, funnel, goal)
 *   -> S5 HUD via mountRunHudScreen (source = the session: events + simTime;
 *      telemetry = furthestMetres/aboard; controls = release/giveUp/setDrive)
 *   -> S0 FrameLoop (fixed 1/60 steps, pauses on hidden/blurred; the rotate
 *      overlay drives the manual pause cause, INTEGRATION #8).
 *
 * Drive = keyboard (S1 DriveInput: ←/→, A/D) OR the HUD's touch buttons.
 * Escape goes back to the builder. Audio goes through the AudioHooks seam
 * (no-op until S7).
 */

import { Application } from 'pixi.js';
import type { AppAction, AppState, MountContext, Screen } from '../app';
import type { Camera } from '../model/coords';
import type { LevelDef, ThemeId } from '../model/level';
import type { RunEvent } from '../model/runEvents';
import { TOTAL_PINEAPPLES } from '../model/score';
import type { DriveDirection } from '../physics/compound';
import { FrameLoop } from '../physics/clock';
import { coreAssetDefs } from '../render/artCatalog';
import { AssetLibrary } from '../render/assets';
import { SceneRenderer } from '../render/scene';
import { getTheme, themeAssetDefs } from '../render/themes';
import { funnelGeometry } from '../run/funnel';
import { DriveInput } from '../run/input';
import { mountRunHudScreen } from '../ui/appScreens';
import { el } from '../ui/dom';
import { isPortraitBlocked, onPortraitChange } from '../ui/orientation';
import type { DriveIntent } from '../ui/screens/runHud';
import { NO_AUDIO, type AudioHooks } from './audioHooks';
import { mountMissingCourse } from './buildScreen';
import { testedDesign } from './cartState';
import { courseFor } from './courses';
import { RunSession } from './session';
import './game.css';

type Dispatch = (action: AppAction) => Promise<void> | void;

export interface RunScreenDeps {
  /** S7 plugs in here (TODO(S7)); default no-op. */
  audio?: AudioHooks;
  /** HUD end-banner delay before results (ms). */
  endDelayMs?: number;
}

/** Course width shown across the screen (m) on narrow screens; zoom is clamped. */
const VIEW_WIDTH_M = 24;
/** Blender fill animation duration after the goal (s). */
const GOAL_FILL_SECONDS = 1.2;

// ------------------------------------------------------------ shared assets

const libraries = new Map<ThemeId, Promise<AssetLibrary>>();

/** Baked textures for one theme (+ core art), cached for the page. */
export function assetsFor(theme: ThemeId): Promise<AssetLibrary> {
  let p = libraries.get(theme);
  if (!p) {
    const lib = new AssetLibrary([...coreAssetDefs(), ...themeAssetDefs(getTheme(theme))]);
    p = lib.ready.then(() => lib);
    p.catch(() => libraries.delete(theme));
    libraries.set(theme, p);
  }
  return p;
}

/** One Pixi Application for the page: its canvas moves into each run mount. */
let pixi: Promise<Application> | null = null;
function pixiApp(): Promise<Application> {
  pixi ??= (async () => {
    const app = new Application();
    await app.init({ background: 0x1d2330, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2) });
    app.ticker.stop(); // the FrameLoop drives rendering
    return app;
  })();
  pixi.catch(() => (pixi = null));
  return pixi;
}

// ------------------------------------------------------------------- screen

/** Dev/test handle on the live run (the browser check drives it). */
export interface RunDebugHandle {
  session: RunSession;
  level: LevelDef;
}

declare global {
  interface Window {
    __prRun?: RunDebugHandle | null;
  }
}

export async function mountRunScreen(
  host: HTMLElement,
  state: Extract<AppState, { name: 'run' }>,
  dispatch: Dispatch,
  ctx: MountContext,
  deps: RunScreenDeps = {},
): Promise<Screen> {
  const course = courseFor(state.levelId);
  if (!course) return mountMissingCourse(host, state.levelId, 'Back', () => void dispatch({ type: 'backToBuild' }));
  const audio = deps.audio ?? NO_AUDIO;
  const level = course.level;
  const design = testedDesign();

  const root = el('div', { class: 'pr-run', 'data-level': state.levelId });
  const canvasHost = el('div', { class: 'pr-run__canvas' });
  const hudHost = el('div', { class: 'pr-run__hud' });
  const loading = el('div', { class: 'pr-run__loading', text: 'Loading…' });
  root.append(canvasHost, loading, hudHost);
  host.appendChild(root);

  let session: RunSession | null = null;
  let app: Application;
  let lib: AssetLibrary;
  try {
    [app, lib, session] = await Promise.all([pixiApp(), assetsFor(level.theme), RunSession.create(design, course)]);
  } catch (err) {
    session?.destroy();
    root.remove();
    throw err;
  }
  if (!ctx.isCurrent()) {
    session.destroy();
    root.remove();
    return { destroy() {} };
  }
  const s = session;
  loading.remove();

  // ---------------------------------------------------------------- render
  canvasHost.appendChild(app.canvas);
  app.resizeTo = canvasHost;
  app.resize();
  const renderer = new SceneRenderer(lib, { theme: level.theme });
  renderer.setLevel(level);
  renderer.setCartDesign(design); // INTEGRATION #11: always
  renderer.resetSource(); // RESIDUALS R5: new world
  renderer.setFunnel(funnelGeometry(level.funnel, TOTAL_PINEAPPLES));
  app.stage.addChild(renderer.view);
  const camera: Camera = { center: s.controller.camera.position, zoom: 1, viewportWidth: 1, viewportHeight: 1 };

  // ----------------------------------------------------------------- input
  const input = new DriveInput();
  const unbindKeys = input.bindKeyboard(window);
  let hudDrive: DriveIntent = 0;
  let lastDrive: DriveDirection = 0;
  const onEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') void dispatch({ type: 'backToBuild' });
  };
  window.addEventListener('keydown', onEsc);

  // ------------------------------------------------------------ goal / audio
  let goalAt: number | null = null;
  let goalFill = 0;
  const offEvents = s.on((e: RunEvent) => {
    if (e.type === 'released') renderer.setFunnelOpen(true);
    if (e.type === 'goalReached') {
      goalAt = 0;
      goalFill = Math.min(1, e.delivered / TOTAL_PINEAPPLES);
    }
    audio.runEvent?.(e);
  });

  // ------------------------------------------------------------------- HUD
  const hud = mountRunHudScreen(hudHost, state, dispatch, {
    source: s,
    telemetry: { furthestMetres: () => s.furthestMetres(), aboard: () => s.aboard() },
    controls: {
      release: () => void s.release(),
      giveUp: () => void s.giveUp(),
      setDrive: (d) => (hudDrive = d),
    },
    ...(deps.endDelayMs !== undefined ? { endDelayMs: deps.endDelayMs } : {}),
  });

  // ------------------------------------------------------------------ loop
  let lastRenderMs = performance.now();
  const loop = new FrameLoop({
    step() {
      const dir: DriveDirection = input.direction !== 0 ? input.direction : hudDrive;
      if (dir !== lastDrive) {
        lastDrive = dir;
        audio.drive?.(dir);
      }
      s.setDrive(dir);
      s.step();
      if (goalAt !== null) goalAt += 1 / 60;
    },
    render(alpha) {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastRenderMs) / 1000);
      lastRenderMs = now;
      const w = app.screen.width;
      const h = app.screen.height;
      camera.viewportWidth = w;
      camera.viewportHeight = h;
      camera.zoom = Math.min(1.5, Math.max(0.5, w / (VIEW_WIDTH_M * 30)));
      camera.center = s.controller.camera.interpolated(alpha);
      if (goalAt !== null) renderer.setGoal(goalFill * Math.min(1, goalAt / GOAL_FILL_SECONDS), goalAt < GOAL_FILL_SECONDS + 1 ? 1 : 0.3);
      renderer.render(s.world.manifest(), s.world.snapshot(alpha), camera, dt);
      app.render();
    },
    onPauseChange(paused) {
      if (paused) {
        input.clear();
        hudDrive = 0;
      }
      audio.paused?.(paused);
    },
  });
  loop.bindVisibility();
  // INTEGRATION #8: the rotate-device overlay pauses the run (manual cause).
  loop.setPaused(isPortraitBlocked());
  const offPortrait = onPortraitChange((portrait) => loop.setPaused(portrait));

  audio.runStarted?.({ levelId: state.levelId, theme: level.theme });
  s.start(); // physics on, `started` -> HUD shows Release
  loop.start();

  if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) window.__prRun = { session: s, level };

  let destroyed = false;
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      loop.stop();
      offPortrait();
      unbindKeys();
      window.removeEventListener('keydown', onEsc);
      offEvents();
      hud.destroy();
      app.stage.removeChild(renderer.view);
      renderer.destroy();
      app.canvas.remove();
      s.destroy();
      if (window.__prRun?.session === s) window.__prRun = null;
      audio.runStopped?.();
      root.remove();
    },
  };
}
