/**
 * S5 screens for the App state machine (src/app.ts): title, select, results,
 * plus `mountRunHudScreen` — the HUD half of the 'run' screen, which S6 (and
 * the UI harness) mount over the game canvas with a real/mock run source.
 */

import { newResultId, type AppAction, type AppState, type EndlessRunStats, type MountContext, type Screen } from '../app';
import type { RunEventSource } from '../model/runEvents';
import { parseRunTarget } from './catalog';
import { resultsFor } from './resultsModel';
import { browserStorage, ScoreStore } from './scoreStore';
import { mountResultsScreen } from './screens/results';
import { mountRunHud, type RunControls, type RunHud, type RunTelemetry } from './screens/runHud';
import { mountSelectScreen } from './screens/select';
import { mountTitleScreen } from './screens/title';
import { showToast } from './toast';

type Dispatch = (action: AppAction) => Promise<void> | void;

let store: ScoreStore | null = null;

/** The app-wide score store (localStorage, notices surface as toasts). */
export function getScoreStore(): ScoreStore {
  store ??= new ScoreStore(browserStorage(), (n) => showToast(n.message));
  return store;
}

/** Harness/tests: swap the store (e.g. a throwing or corrupt fake storage). */
export function setScoreStore(s: ScoreStore | null): void {
  store = s;
}

/**
 * Bare results states (no resultId — only possible via direct
 * mountAppScreen calls; App always stamps one) get an id memoized on the
 * state OBJECT, so mounting the same object twice is idempotent while two
 * distinct runs with identical content still record separately.
 */
const bareIds = new WeakMap<object, string>();
export function resultIdOf(state: Extract<AppState, { name: 'results' }>): string {
  if (state.resultId) return state.resultId;
  let id = bareIds.get(state);
  if (!id) bareIds.set(state, (id = newResultId()));
  return id;
}

const ALWAYS_CURRENT: MountContext = { isCurrent: () => true };

export function mountAppScreen(host: HTMLElement, state: AppState, dispatch: Dispatch, ctx: MountContext = ALWAYS_CURRENT): Screen {
  // A stale mount (superseded while its module loaded) renders nothing and,
  // crucially, never records a score.
  if (!ctx.isCurrent()) return { destroy() {} };
  const go = (a: AppAction) => void dispatch(a);
  switch (state.name) {
    case 'title':
      return mountTitleScreen(host, { onPlay: () => go({ type: 'play' }) });
    case 'select':
      return mountSelectScreen(host, {
        store: getScoreStore(),
        onSelect: (levelId) => go({ type: 'selectLevel', levelId }),
        onBack: () => go({ type: 'toTitle' }),
      });
    case 'results': {
      const model = resultsFor(resultIdOf(state), state, getScoreStore());
      return mountResultsScreen(host, model, {
        retry: () => go({ type: 'startRun' }),
        editCart: () => go({ type: 'backToBuild' }),
        levels: () => go({ type: 'backToSelect' }),
        selectLevel: (levelId) => go({ type: 'selectLevel', levelId }),
      });
    }
    default:
      throw new Error(`S5 has no screen for "${state.name}"`);
  }
}

export interface RunHudScreenOptions {
  source: RunEventSource;
  clock: () => number;
  controls: RunControls;
  telemetry?: RunTelemetry;
  touchControls?: 'auto' | 'always' | 'never';
  endDelayMs?: number;
}

/**
 * Mount the HUD for AppState 'run' and dispatch `runEnded` (with endless
 * stats) when the lifecycle events end the run. For S6: call this from the
 * run screen factory after mounting the canvas, with S1's controller.
 */
export function mountRunHudScreen(
  host: HTMLElement,
  state: Extract<AppState, { name: 'run' }>,
  dispatch: Dispatch,
  opts: RunHudScreenOptions,
): RunHud {
  const target = parseRunTarget(state.levelId);
  return mountRunHud(host, {
    ...opts,
    mode: target.kind,
    courseName: target.kind === 'level' ? (target.course?.name ?? target.levelId) : `Endless ${target.seed}`,
    onEnded: (info) => {
      const endless: EndlessRunStats | undefined =
        target.kind === 'endless' ? { furthestMetres: info.furthestMetres, aboard: info.aboard } : undefined;
      const resultId = newResultId();
      void dispatch(
        endless ? { type: 'runEnded', outcome: info.outcome, endless, resultId } : { type: 'runEnded', outcome: info.outcome, resultId },
      );
    },
  });
}
