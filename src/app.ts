/**
 * App state machine skeleton: title -> select -> build -> run -> results.
 *
 * S0 ships stubs for every screen except `run`, which mounts the stability
 * spike page (the current entry point). Later slices replace the stubs:
 * level select (S5), builder (S3), run screen (S1/S4), results (S5/S6).
 */

import type { RunEvent } from './model/runEvents';

export type AppState =
  | { name: 'title' }
  | { name: 'select' }
  | { name: 'build'; levelId: string }
  | { name: 'run'; levelId: string }
  | { name: 'results'; levelId: string; outcome: RunEvent | null };

export type AppAction =
  | { type: 'play' }
  | { type: 'selectLevel'; levelId: string }
  | { type: 'backToSelect' }
  | { type: 'startRun' }
  | { type: 'runEnded'; outcome: RunEvent }
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
      if (action.type === 'runEnded') return { name: 'results', levelId: state.levelId, outcome: action.outcome };
      if (action.type === 'backToBuild') return { name: 'build', levelId: state.levelId };
      return state;
    case 'results':
      if (action.type === 'backToBuild') return { name: 'build', levelId: state.levelId };
      if (action.type === 'startRun') return { name: 'run', levelId: state.levelId };
      if (action.type === 'backToSelect') return { name: 'select' };
      if (action.type === 'toTitle') return { name: 'title' };
      return state;
  }
}

/** S0 entry: the run screen on the spike level. */
export const SPIKE_LEVEL_ID = 's0-spike';

interface Screen {
  destroy(): void;
}

export class App {
  private state: AppState;
  private screen: Screen | null = null;
  /** Bumped on every transition so a slow async mount can't clobber a newer screen. */
  private generation = 0;

  constructor(
    private readonly host: HTMLElement,
    initial: AppState = { name: 'run', levelId: SPIKE_LEVEL_ID },
  ) {
    this.state = initial;
  }

  get current(): AppState {
    return this.state;
  }

  start(): Promise<void> {
    return this.mount();
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
    switch (state.name) {
      case 'run': {
        // S0: the stability spike is the run screen.
        const { mountSpikePage } = await import('./spike/page');
        return mountSpikePage(this.host);
      }
      case 'title':
        return this.stub('Pineapple Run', 'Play', { type: 'play' });
      case 'select':
        return this.stub('Level select (coming in S5)', 'Spike level', { type: 'selectLevel', levelId: SPIKE_LEVEL_ID });
      case 'build':
        return this.stub('Build (coming in S3)', 'Run', { type: 'startRun' });
      case 'results':
        return this.stub('Results (coming in S6)', 'Back to build', { type: 'backToBuild' });
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
