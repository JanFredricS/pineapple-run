/**
 * GL1: one long-lived Pixi Application per role (run screen, builder), with
 * WebGL context-loss recovery.
 *
 * Why: Safari reaps WebGL contexts when a page churns through them (the
 * builder used to create + destroy an Application on every mount). A reaped
 * context fires `webglcontextlost` on its canvas; Pixi v8 only calls
 * preventDefault() and waits for a `webglcontextrestored` that Safari may
 * never send, so an unhandled loss leaves the canvas painting nothing while
 * the DOM HUD lives on — a permanently blank world until a page reload.
 *
 * Contract:
 *  - `acquire()` inits the Application once and returns the same one to every
 *    mount (mounts reparent `app.canvas`, re-target `resizeTo`, and detach on
 *    unmount WITHOUT destroying it).
 *  - On `webglcontextlost` for the live app (exactly once — later lost /
 *    restored events for it are ignored): the singleton is forgotten (the
 *    next `acquire()` builds a fresh Application), every `onLost` subscriber
 *    runs (the mounted screen tears down its stage children and remounts or
 *    shows its error UI), then the dead Application is destroyed. Its
 *    textures are NOT destroyed: texture sources are renderer-independent
 *    and re-upload to the next renderer on first use.
 *  - A context found dead at `acquire()` time (a loss event that never
 *    arrived) is treated the same way.
 *
 * Pixi v8 exposes no public context-lost signal on the renderer (its
 * GlContextSystem listens to the DOM events privately), so this listens to
 * the documented DOM events on `app.canvas`.
 */

import type { Application } from 'pixi.js';

export const CONTEXT_LOST_EVENT = 'webglcontextlost';
export const CONTEXT_RESTORED_EVENT = 'webglcontextrestored';

/** Automatic remounts per screen mount after context losses before the error UI takes over (a manual retry resets it). */
export const MAX_CONTEXT_RECOVERIES = 2;

export interface SharedPixi {
  /** The role's Application: created + initialised on first use, and again after a context loss. */
  acquire(): Promise<Application>;
  /**
   * Run `fn` once if `app`'s WebGL context is lost while it is this role's
   * live app. Returns an unsubscribe. An app this role does not own (a test
   * loader's fake) is not watched; an owned app that is already dead gets
   * `fn` on a microtask so the caller always learns about it.
   */
  onLost(app: Application, fn: () => void): () => void;
  /** Whether `app` is this role's live, undiscarded Application. */
  isLive(app: Application): boolean;
  /** Forget + destroy the live app (tests; also used internally on loss). */
  discard(): void;
}

interface Live {
  app: Application;
  lost: boolean;
  subscribers: Set<() => void>;
  unwatch: () => void;
}

/** True when the app's WebGL context is known to be lost (false when unknown, e.g. WebGPU or a fake). */
export function contextIsLost(app: Application): boolean {
  try {
    const gl = (app.renderer as unknown as { gl?: { isContextLost?: () => boolean } } | undefined)?.gl;
    return gl?.isContextLost?.() === true;
  } catch {
    return false;
  }
}

/**
 * @param label  log prefix ('run' | 'builder')
 * @param create builds and initialises a new Application (called again after each loss)
 */
export function createSharedPixi(label: string, create: () => Promise<Application>): SharedPixi {
  let pending: Promise<Application> | null = null;
  /** Bumped whenever `pending` is dropped: an init that finishes in a later epoch is an orphan. */
  let epoch = 0;
  let live: Live | null = null;
  /** Apps discarded after a loss: a late onLost() for one still hears about it. */
  const dead = new WeakSet<Application>();

  const destroyApp = (app: Application) => {
    try {
      // children: false — stage children belong to the screens, which remove
      // (and destroy) their own views; textures are page-cached and kept.
      if (app.renderer) app.destroy({ removeView: true }, { children: false });
    } catch (e) {
      console.error(`[${label}] destroying a lost Pixi app`, e);
    }
  };

  const lose = (state: Live, why: string) => {
    if (state.lost || live !== state) return; // re-entrancy: lost twice, restored after loss, stale app
    state.lost = true;
    live = null;
    pending = null; // the next acquire() builds a fresh Application
    epoch++;
    dead.add(state.app);
    state.unwatch();
    if (why !== 'discarded') console.warn(`[${label}] discarding the Pixi app (${why})`);
    const subs = [...state.subscribers];
    state.subscribers.clear();
    for (const fn of subs) {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }
    destroyApp(state.app); // after the screens detached their views
  };

  const watch = (app: Application): Live => {
    const canvas = app.canvas as unknown as EventTarget;
    const state: Live = { app, lost: false, subscribers: new Set(), unwatch: () => {} };
    const onLostEvent = () => lose(state, CONTEXT_LOST_EVENT);
    // The app is discarded on loss, so a restore of it is ignored (never a second recovery).
    const onRestored = () => {
      if (state.lost) console.warn(`[${label}] ignoring ${CONTEXT_RESTORED_EVENT} for a discarded Pixi app`);
    };
    canvas.addEventListener(CONTEXT_LOST_EVENT, onLostEvent);
    canvas.addEventListener(CONTEXT_RESTORED_EVENT, onRestored);
    state.unwatch = () => {
      canvas.removeEventListener(CONTEXT_LOST_EVENT, onLostEvent);
      canvas.removeEventListener(CONTEXT_RESTORED_EVENT, onRestored);
    };
    return state;
  };

  const acquire = (): Promise<Application> => {
    // Belt and braces: a live app whose context died without an event is replaced.
    if (live && contextIsLost(live.app)) lose(live, 'found lost at acquire');
    if (!pending) {
      const mine = epoch;
      const p = (async () => {
        const app = await create();
        if (mine !== epoch) {
          // discarded while initialising: never hand out an orphan
          destroyApp(app);
          throw new Error('The graphics context was reset; please try again');
        }
        live = watch(app);
        return app;
      })();
      pending = p;
      p.catch(() => {
        if (mine === epoch) pending = null;
      });
    }
    return pending;
  };

  return {
    acquire,
    onLost(app, fn) {
      if (live?.app === app && !live.lost) {
        const state = live;
        state.subscribers.add(fn);
        return () => void state.subscribers.delete(fn);
      }
      if (dead.has(app)) {
        let on = true;
        queueMicrotask(() => on && fn());
        return () => void (on = false);
      }
      return () => {};
    },
    isLive: (app) => live?.app === app && !live.lost,
    discard() {
      if (live) lose(live, 'discarded');
      pending = null;
      epoch++;
    },
  };
}
