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
 * Escape goes back to the builder; R restarts the run (S6T #5). Audio goes through the AudioHooks seam
 * (S6V: the App passes S7's GameAudio adapted by gameAudioHooks; every hook
 * is wrapped by safeHooks, so audio can never break the run).
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
import type { SoundControl } from '../ui/sound';
import { bodiesBox, boxOf, cartAnchorX, followZoom, goalBlenderBox, LookAheadFollow, READY_BLEND_SECONDS, readyFrame, runCamera, type Box } from './framing';
import { NO_AUDIO, RunAudioFeed, safeHooks, type AudioHooks } from './audioHooks';
import { mountMissingCourse } from './buildScreen';
import { mountScreenError } from './errorScreen';
import { testedDesign } from './cartState';
import { courseFor } from './courses';
import { acquireRunResources } from './runResources';
import { deviceBeadStorage, detectDeviceInfo, resolveBeadCount, type BeadCountStorage, type DeviceInfo } from './deviceTier';
import { RunSession, type RunSessionOptions } from './session';
import { createSharedPixi, initApplication, MAX_CONTEXT_RECOVERIES, type SharedPixi } from '../render/sharedPixi';
import './game.css';

type Dispatch = (action: AppAction) => Promise<void> | void;

export interface RunScreenDeps {
  /** Run audio (the App's GameAudio via gameAudioHooks); default silent. */
  audio?: AudioHooks;
  /** Mute toggle shown in the HUD. */
  sound?: SoundControl;
  /** HUD end-banner delay before results (ms). */
  endDelayMs?: number;
  /** Loader overrides (tests: fail a loader to exercise the error screen). */
  loaders?: {
    app?: () => Promise<Application>;
    assets?: (theme: ThemeId) => Promise<AssetLibrary>;
  };
  /** Bead-ocean count override (S9; default: this device's pinned count, see deviceTier.ts). Never pinned. */
  beadCount?: number;
  /** The shared Pixi app + context-loss watch (tests; default: the page's runPixi). */
  pixi?: SharedPixi;
  /** Device report for the bead tier (tests; default: navigator). */
  deviceInfo?: DeviceInfo;
  /** Where the device's bead count is pinned (tests; default: localStorage; null = no pinning). */
  beadStorage?: BeadCountStorage | null;
}

/** The bead count a run built with `deps` uses (S9): override, else the device's pinned count. */
export function runBeadCount(deps: Pick<RunScreenDeps, 'beadCount' | 'deviceInfo' | 'beadStorage'>): number {
  return resolveBeadCount({
    ...(deps.beadCount !== undefined ? { override: deps.beadCount } : {}),
    info: deps.deviceInfo ?? detectDeviceInfo(),
    storage: deps.beadStorage !== undefined ? deps.beadStorage : deviceBeadStorage(),
  });
}

/**
 * Session options for running `level` (S9 audit-2): the bead count is
 * resolved — and so pinned — ONLY for a level that has a bead zone. Any other
 * course touches no bead state, so the device's count is pinned by its first
 * bead-level load, never by an earlier Beach / Kitchen / Endless run.
 */
export function runSessionOptions(level: Pick<LevelDef, 'zones'>, deps: Pick<RunScreenDeps, 'beadCount' | 'deviceInfo' | 'beadStorage'>): RunSessionOptions {
  return level.zones.some((z) => z.kind === 'beads') ? { beadCount: runBeadCount(deps) } : {};
}


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

/**
 * One Pixi Application for the page: its canvas moves into each run mount.
 * GL1: on a WebGL context loss it is discarded and the next acquire() builds
 * a fresh one (sharedPixi.ts); the mounted run remounts onto it.
 */
export const runPixi: SharedPixi = createSharedPixi('run', async () => {
  const app = new Application();
  // a partially initialised app is destroyed if init rejects (no context leaked per retry)
  await initApplication(app, { background: 0x1d2330, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2) });
  app.ticker.stop(); // the FrameLoop drives rendering
  return app;
});

// ------------------------------------------------------------------- screen

/** Dev-only handle on the live run (browser checks drive it via `npm run dev`). */
export interface RunDebugHandle {
  session: RunSession;
  level: LevelDef;
}

declare global {
  interface Window {
    __prRun?: RunDebugHandle | null;
  }
}

/**
 * Mount the run. Never leaves a blank host: if loading or setup fails, every
 * resource acquired so far is released and a visible error screen offers
 * "Try again" (re-mounts in place) and "Back to builder". GL1: if the WebGL
 * context is lost mid-run, the mount is torn down and re-mounted onto a fresh
 * Pixi app (the run restarts; RESIDUALS R28), up to MAX_CONTEXT_RECOVERIES
 * times, then the same error screen — whose retry gets a fresh app too.
 */
export async function mountRunScreen(
  host: HTMLElement,
  state: Extract<AppState, { name: 'run' }>,
  dispatch: Dispatch,
  ctx: MountContext,
  deps: RunScreenDeps = {},
): Promise<Screen> {
  let current: Screen | null = null;
  let dead = false;
  // Attempt generation: only the newest attempt may install itself, and only
  // the newest attempt's error screen may retry (once) — so a second retry
  // activation while an attempt is in flight, or a stale error screen's
  // button, is a no-op, and a superseded/destroyed attempt releases its own
  // resources instead of overwriting `current`.
  let generation = 0;
  // GL1: automatic remounts after WebGL context losses (a manual retry resets it).
  let recoveries = 0;
  const attempt = async (): Promise<void> => {
    const gen = ++generation;
    const live = () => !dead && gen === generation;
    const attemptCtx: MountContext = { isCurrent: () => live() && ctx.isCurrent() };
    const showError = (title: string, err: unknown) => {
      current = mountScreenError(host, title, err, [
        {
          label: 'Try again',
          primary: true,
          testId: 'run-error-retry',
          onClick: () => {
            if (!live()) return; // destroyed, or a retry already started
            current?.destroy();
            current = null;
            recoveries = 0;
            void attempt(); // a fresh attempt acquires a fresh Pixi app if the old one was lost
          },
        },
        { label: 'Back to builder', testId: 'run-error-back', onClick: () => void dispatch({ type: 'backToBuild' }) },
      ]);
    };
    // GL1: the run's WebGL context died (the shared app is already discarded):
    // tear this attempt down — never keep rendering into a dead context — and
    // remount onto a fresh Application, or show the error UI once the
    // automatic remounts are spent.
    const onContextLost = () => {
      if (!attemptCtx.isCurrent()) return;
      current?.destroy();
      current = null;
      if (recoveries < MAX_CONTEXT_RECOVERIES) {
        recoveries++;
        console.warn(`[run] WebGL context lost; remounting the run (${recoveries}/${MAX_CONTEXT_RECOVERIES})`);
        void attempt();
      } else {
        showError('The graphics were interrupted', new Error('The browser reset the WebGL graphics context.'));
      }
    };
    try {
      const screen = await mountRunOnce(host, state, dispatch, attemptCtx, deps, onContextLost);
      if (live()) current = screen;
      else screen.destroy();
    } catch (err) {
      console.error('[run] failed to start', err);
      if (!attemptCtx.isCurrent()) return;
      showError('Could not start the run', err);
    }
  };
  await attempt();
  return {
    destroy() {
      dead = true;
      current?.destroy();
      current = null;
    },
  };
}

/** One mount attempt. Throws after releasing everything it acquired. */
async function mountRunOnce(
  host: HTMLElement,
  state: Extract<AppState, { name: 'run' }>,
  dispatch: Dispatch,
  ctx: MountContext,
  deps: RunScreenDeps,
  onContextLost: () => void,
): Promise<Screen> {
  const course = courseFor(state.levelId);
  if (!course) return mountMissingCourse(host, state.levelId, 'Back', () => void dispatch({ type: 'backToBuild' }));
  const audio = safeHooks(deps.audio ?? NO_AUDIO);
  const level = course.level;
  const design = testedDesign();

  // Teardown steps, run in reverse order of acquisition (destroy or failure).
  const cleanup: (() => void)[] = [];
  const teardown = () => {
    while (cleanup.length) {
      try {
        cleanup.pop()!();
      } catch (e) {
        console.error(e);
      }
    }
  };

  const root = el('div', { class: 'pr-run', 'data-level': state.levelId });
  const canvasHost = el('div', { class: 'pr-run__canvas' });
  const hudHost = el('div', { class: 'pr-run__hud' });
  const loading = el('div', { class: 'pr-run__loading', text: 'Loading…' });
  root.append(canvasHost, loading, hudHost);
  host.appendChild(root);
  cleanup.push(() => root.remove());

  try {
    // A failure in any loader destroys a session that did get created.
    const shared = deps.pixi ?? runPixi;
    const { app, lib, session: s } = await acquireRunResources({
      app: deps.loaders?.app ?? (() => shared.acquire()),
      lib: () => (deps.loaders?.assets ?? assetsFor)(level.theme),
      // S9: a bead level's count is fixed here, at level load: this device's pinned count (deviceTier.ts)
      session: () => RunSession.create(design, course, runSessionOptions(course.level, deps)),
    });
    let started = false;
    cleanup.push(() => {
      if (started) audio.runStopped?.();
    });
    cleanup.push(() => {
      s.destroy();
      if (import.meta.env.DEV && window.__prRun?.session === s) window.__prRun = null;
    });
    if (!ctx.isCurrent()) {
      teardown();
      return { destroy() {} };
    }
    loading.remove();

    // -------------------------------------------------------------- render
    // GL1: context loss -> the screen tears this mount down and recovers.
    // Subscribed first so it is released last (after every stage child).
    cleanup.push(shared.onLost(app, onContextLost));
    canvasHost.appendChild(app.canvas);
    cleanup.push(() => {
      // the shared app outlives this mount: detach it, never destroy it
      app.resizeTo = null as unknown as HTMLElement;
      app.canvas.remove();
    });
    app.resizeTo = canvasHost;
    app.resize();
    const renderer = new SceneRenderer(lib, { theme: level.theme });
    cleanup.push(() => renderer.destroy());
    renderer.setLevel(level);
    renderer.setCartDesign(design); // INTEGRATION #11: always
    renderer.resetSource(); // RESIDUALS R5: new world
    const funnel = funnelGeometry(level.funnel, TOTAL_PINEAPPLES);
    renderer.setFunnel(funnel);
    // S6T #13: before Release, frame the whole funnel + the waiting cart
    // (real shape AABBs; the cart alone when it was driven too far away)
    const funnelBox = boxOf([...funnel.walls[0], ...funnel.walls[1]]);
    const cartBox = (): Box | null => bodiesBox(s.world.manifest().bodies, s.controller.cartBodyHandles(), (id) => s.world.getTransform(id));
    let readyView: { center: { x: number; y: number }; zoom: number } | null = null;
    const blenderBox = goalBlenderBox(level);
    let sinceRelease: number | null = null;
    app.stage.addChild(renderer.view);
    cleanup.push(() => app.stage.removeChild(renderer.view));
    // UX1: horizontal look-ahead follow (cart at 30% from the left edge)
    const look = new LookAheadFollow(cartAnchorX(s.controller.cartBounds()) ?? s.spawn.x);

    // --------------------------------------------------------------- input
    const input = new DriveInput();
    cleanup.push(input.bindKeyboard(window));
    let hudDrive: DriveIntent = 0;
    let lastDrive: DriveDirection = 0;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void dispatch({ type: 'backToBuild' });
    };
    window.addEventListener('keydown', onEsc);
    cleanup.push(() => window.removeEventListener('keydown', onEsc));

    // ---------------------------------------------------------- goal / audio
    let goalAt: number | null = null;
    let goalFill = 0;
    cleanup.push(
      s.on((e: RunEvent) => {
        if (e.type === 'released') {
          renderer.setFunnelOpen(true);
          sinceRelease = 0;
        }
        if (e.type === 'goalReached') {
          goalAt = 0;
          goalFill = Math.min(1, e.delivered / TOTAL_PINEAPPLES);
        }
        audio.runEvent?.(e);
      }),
    );

    // ----------------------------------------------------------------- HUD
    const hud = mountRunHudScreen(hudHost, state, dispatch, {
      source: s,
      telemetry: { furthestMetres: () => s.furthestMetres(), aboard: () => s.aboard(), stuck: () => s.stuck },
      controls: {
        release: () => void s.release(),
        giveUp: () => void s.giveUp(),
        setDrive: (d) => (hudDrive = d),
        // a cancelled touch clears every held input (keys too), as input.ts touchCancel()
        cancelInput: () => {
          input.touchCancel();
          hudDrive = 0;
        },
      },
      ...(deps.endDelayMs !== undefined ? { endDelayMs: deps.endDelayMs } : {}),
      ...(deps.sound ? { sound: deps.sound } : {}),
    });
    cleanup.push(() => hud.destroy());

    // --------------------------------------------------------- audio feed
    const audioFeed = new RunAudioFeed(audio, s.spawn.x, level.goal.lineX);

    // ---------------------------------------------------------------- loop
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
        look.step(cartAnchorX(s.controller.cartBounds()));
        audioFeed.step(s.controller.rightmostCartBody()?.x ?? null, s.furthestMetres());
        if (goalAt !== null) goalAt += 1 / 60;
        if (sinceRelease !== null && sinceRelease < READY_BLEND_SECONDS) sinceRelease += 1 / 60;
      },
      render(alpha) {
        const now = performance.now();
        const dt = Math.min(0.1, (now - lastRenderMs) / 1000);
        lastRenderMs = now;
        const w = app.screen.width;
        const h = app.screen.height;
        const cart = cartBox();
        // ready phase: frame funnel + cart (tracks a cart driven before Release); then blend to follow
        if (sinceRelease === null) readyView = readyFrame(funnelBox, cart, w, h, followZoom(w, h));
        // look-ahead follow, eased into the whole-blender finish frame near the goal (framing.ts)
        const view: Camera = runCamera({
          anchorX: look.interpolated(alpha),
          followY: s.controller.camera.interpolated(alpha).y,
          viewportWidth: w,
          viewportHeight: h,
          blender: blenderBox,
          cart,
          ready: readyView,
          sinceRelease,
        });
        if (goalAt !== null) renderer.setGoal(goalFill * Math.min(1, goalAt / GOAL_FILL_SECONDS), goalAt < GOAL_FILL_SECONDS + 1 ? 1 : 0.3);
        renderer.render(s.world.manifest(), s.world.snapshot(alpha), view, dt);
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
    cleanup.push(() => loop.stop());
    loop.bindVisibility();
    // INTEGRATION #8: the rotate-device overlay pauses the run (manual cause).
    loop.setPaused(isPortraitBlocked());
    cleanup.push(onPortraitChange((portrait) => loop.setPaused(portrait)));

    audio.runStarted?.({ levelId: state.levelId, mode: course.mode });
    started = true;
    s.start(); // physics on, `started` -> HUD shows Release
    loop.start();

    // Dev-server builds only; never reachable in a production build.
    if (import.meta.env.DEV) window.__prRun = { session: s, level };
  } catch (err) {
    teardown();
    throw err;
  }

  return { destroy: teardown };
}
