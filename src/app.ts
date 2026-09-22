/**
 * App state machine skeleton: title -> build -> run -> results.
 *
 * S0 ships stubs for every screen except `run`, which mounts the stability
 * spike page (the current entry point). Later slices replace the stubs:
 * builder (S3), run screen (S1/S4), results (S6).
 */

import type { RunEvent } from './model/runEvents';

export type AppState =
  | { name: 'title' }
  | { name: 'build' }
  | { name: 'run' }
  | { name: 'results'; outcome: RunEvent | null };

export type AppAction =
  | { type: 'play' }
  | { type: 'startRun' }
  | { type: 'runEnded'; outcome: RunEvent }
  | { type: 'backToBuild' }
  | { type: 'toTitle' };

/** Pure transition function (unit-tested). Invalid actions keep the state. */
export function transition(state: AppState, action: AppAction): AppState {
  switch (state.name) {
    case 'title':
      return action.type === 'play' ? { name: 'build' } : state;
    case 'build':
      if (action.type === 'startRun') return { name: 'run' };
      if (action.type === 'toTitle') return { name: 'title' };
      return state;
    case 'run':
      if (action.type === 'runEnded') return { name: 'results', outcome: action.outcome };
      if (action.type === 'backToBuild') return { name: 'build' };
      return state;
    case 'results':
      if (action.type === 'backToBuild') return { name: 'build' };
      if (action.type === 'startRun') return { name: 'run' };
      if (action.type === 'toTitle') return { name: 'title' };
      return state;
  }
}

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
    initial: AppState = { name: 'run' },
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
