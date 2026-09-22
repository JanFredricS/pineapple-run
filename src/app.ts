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
  | { name: 'results'; levelId: string; outcome: RunEvent | null; endless?: EndlessRunStats };

export type AppAction =
  | { type: 'play' }
  | { type: 'selectLevel'; levelId: string }
  | { type: 'backToSelect' }
  | { type: 'startRun' }
  | { type: 'runEnded'; outcome: RunEvent; endless?: EndlessRunStats }
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
        const results: AppState = { name: 'results', levelId: state.levelId, outcome: action.outcome };
        return action.endless ? { ...results, endless: action.endless } : results;
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

/** Mounts one screen into `host`; `dispatch` drives the app state machine. */
export type ScreenFactory = (
  host: HTMLElement,
  state: AppState,
  dispatch: (action: AppAction) => Promise<void>,
) => Screen | Promise<Screen>;

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
    void import('./ui/chrome').then((m) => m.installChrome({ pwa: this.options.pwa ?? true }));
    return this.mount();
  }

  /** Tear down the current screen (and cancel any pending mount). */
  destroy(): void {
    this.generation++;
    this.screen?.destroy();
    this.screen = null;
    this.host.replaceChildren();
  }

  dispatch(action: AppAction): Promise<void> {
    const next = transition(this.state, action);
    if (next === this.state) return Promise.resolve();
    this.state = next;
    return this.mount();
  }

  private async mount(): Promise<void> {
    const gen = ++this.generation;
    this.screen?.destroy();
    this.screen = null;
    this.host.replaceChildren();
    const screen = await this.createScreen(this.state);
    if (gen !== this.generation) {
      screen.destroy();
      return;
    }
    this.screen = screen;
  }

  private async createScreen(state: AppState): Promise<Screen> {
    const override = this.options.screens?.[state.name];
    if (override) return override(this.host, state, (a) => this.dispatch(a));
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
        return mountAppScreen(this.host, state, (a) => this.dispatch(a));
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
