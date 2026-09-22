/**
 * App state machine skeleton: title -> select -> build -> run -> results.
 *
 * S0 ships stubs for every screen except `run`, which mounts the stability
 * spike page (the current entry point). Later slices replace the stubs:
 * level select (S5), builder (S3), run screen (S1/S4), results (S5/S6).
 */

import type { RunEvent } from './model/runEvents';

/**
 * Endless-run stats that the lifecycle events don't carry (S5): furthest
 * distance carried (metres) and pineapples aboard at the end. Supplied by the
 * run screen alongside `runEnded`; absent for level runs.
 */
export interface EndlessRunStats {
  furthestMetres: number;
  aboard: number;
}

export type AppState =
  | { name: 'title' }
  | { name: 'select' }
  | { name: 'build'; levelId: string }
  | { name: 'run'; levelId: string }
  | {
      name: 'results';
      levelId: string;
      outcome: RunEvent | null;
      endless?: EndlessRunStats;
      /**
       * Identity of this run result (S5): the score is recorded once per id,
       * so re-mounting the results screen re-renders without re-recording.
       * Stamped by App when absent.
       */
      resultId?: string;
    };

export type AppAction =
  | { type: 'play' }
  | { type: 'selectLevel'; levelId: string }
  | { type: 'backToSelect' }
  | { type: 'startRun' }
  | { type: 'runEnded'; outcome: RunEvent; endless?: EndlessRunStats; resultId?: string }
  | { type: 'backToBuild' }
  | { type: 'toTitle' };

/** Pure transition function (unit-tested). Invalid actions keep the state. */
export function transition(state: AppState, action: AppAction): AppState {
  switch (state.name) {
    case 'title':
      return action.type === 'play' ? { name: 'select' } : state;
    case 'select':
      if (action.type === 'selectLevel') return { name: 'build', levelId: action.levelId };
      if (action.type === 'toTitle') return { name: 'title' };
      return state;
    case 'build':
      if (action.type === 'startRun') return { name: 'run', levelId: state.levelId };
      if (action.type === 'backToSelect') return { name: 'select' };
      if (action.type === 'toTitle') return { name: 'title' };
      return state;
    case 'run':
      if (action.type === 'runEnded') {
        return {
          name: 'results',
          levelId: state.levelId,
          outcome: action.outcome,
          ...(action.endless ? { endless: action.endless } : {}),
          ...(action.resultId ? { resultId: action.resultId } : {}),
        };
      }
      if (action.type === 'backToBuild') return { name: 'build', levelId: state.levelId };
      return state;
    case 'results':
      if (action.type === 'backToBuild') return { name: 'build', levelId: state.levelId };
      if (action.type === 'startRun') return { name: 'run', levelId: state.levelId };
      // S5: "Next level" / "New seed" go straight to that course's build.
      if (action.type === 'selectLevel') return { name: 'build', levelId: action.levelId };
      if (action.type === 'backToSelect') return { name: 'select' };
      if (action.type === 'toTitle') return { name: 'title' };
      return state;
  }
}

/** S0 entry: the run screen on the spike level. */
export const SPIKE_LEVEL_ID = 's0-spike';

export interface Screen {
  destroy(): void;
}

/** Per-mount context handed to screen factories. */
export interface MountContext {
  /**
   * False once this mount is stale (a newer transition or destroy() happened
   * while it was loading). Factories must not write persistent state (e.g.
   * record a score) when this is false.
   */
  isCurrent(): boolean;
}

/** Mounts one screen into `host`; `dispatch` drives the app state machine. */
export type ScreenFactory = (
  host: HTMLElement,
  state: AppState,
  dispatch: (action: AppAction) => Promise<void>,
  ctx: MountContext,
) => Screen | Promise<Screen>;

let resultSeq = 0;
/** Unique-per-page result identity (see AppState 'results'.resultId). */
export function newResultId(): string {
  resultSeq++;
  return `r${Date.now().toString(36)}-${resultSeq}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface AppOptions {
  /** Per-state screen overrides (S6 run controller, the S5 UI harness). */
  screens?: Partial<Record<AppState['name'], ScreenFactory>>;
  /** Register the PWA service worker (production builds only). Default true. */
  pwa?: boolean;
}

export class App {
  private state: AppState;
  private screen: Screen | null = null;
  /** Bumped on every transition so a slow async mount can't clobber a newer screen. */
  private generation = 0;
  private destroyed = false;
  private uninstallChrome: (() => void) | null = null;

  constructor(
    private readonly host: HTMLElement,
    initial: AppState = { name: 'title' },
    private readonly options: AppOptions = {},
  ) {
    this.state = initial;
  }

  get current(): AppState {
    return this.state;
  }

  start(): Promise<void> {
    // S5: rotate-device overlay, toast host, service worker (all idempotent).
    // Guarded by `destroyed`: a destroy() before the import resolves cancels it.
    if (!this.destroyed && !this.uninstallChrome) {
      void import('./ui/chrome').then((m) => {
        if (this.destroyed || this.uninstallChrome) return;
        this.uninstallChrome = m.installChrome({ pwa: this.options.pwa ?? true });
      });
    }
    return this.mount();
  }

  /**
   * Tear down the current screen, cancel any pending mount / chrome install,
   * and remove the rotate overlay + its listeners. The App is inert afterwards.
   */
  destroy(): void {
    this.destroyed = true;
    this.generation++;
    this.screen?.destroy();
    this.screen = null;
    this.host.replaceChildren();
    this.uninstallChrome?.();
    this.uninstallChrome = null;
  }

  dispatch(action: AppAction): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    // Stamp a result identity so the score is recorded once per run.
    if (action.type === 'runEnded' && !action.resultId) action = { ...action, resultId: newResultId() };
    const next = transition(this.state, action);
    if (next === this.state) return Promise.resolve();
    this.state = next;
    return this.mount();
  }

  private async mount(): Promise<void> {
    if (this.destroyed) return;
    const gen = ++this.generation;
    this.screen?.destroy();
    this.screen = null;
    this.host.replaceChildren();
    if (this.state.name === 'results' && !this.state.resultId) this.state = { ...this.state, resultId: newResultId() };
    const ctx: MountContext = { isCurrent: () => gen === this.generation && !this.destroyed };
    const screen = await this.createScreen(this.state, ctx);
    if (gen !== this.generation) {
      screen.destroy();
      return;
    }
    this.screen = screen;
  }

  private async createScreen(state: AppState, ctx: MountContext): Promise<Screen> {
    const override = this.options.screens?.[state.name];
    if (override) return override(this.host, state, (a) => this.dispatch(a), ctx);
    switch (state.name) {
      case 'run': {
        // S0: the stability spike is the run screen.
        const { mountSpikePage } = await import('./spike/page');
        return mountSpikePage(this.host);
      }
      case 'title':
      case 'select':
      case 'results': {
        // S5 screens.
        const { mountAppScreen } = await import('./ui/appScreens');
        return mountAppScreen(this.host, state, (a) => this.dispatch(a), ctx);
      }
      case 'build':
        return this.stub('Build (coming in S3)', 'Run', { type: 'startRun' });
    }
  }

  private stub(title: string, button: string, action: AppAction): Screen {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px';
    const h = document.createElement('h1');
    h.textContent = title;
    const b = document.createElement('button');
    b.textContent = button;
    b.addEventListener('click', () => void this.dispatch(action));
    el.append(h, b);
    this.host.appendChild(el);
    return { destroy: () => el.remove() };
  }
}
