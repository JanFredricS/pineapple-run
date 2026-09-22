/**
 * S5 UI harness (ui-harness.html): every S5 screen reachable, driven off the
 * S0 mock run event stream / a manual RunEventEmitter. No physics, no Pixi.
 *
 * The run screen here is a fake backdrop + the real HUD; harness buttons fire
 * lifecycle events exactly as S1's run controller will.
 *
 * Acceptance checklist (walk at desktop and at 800x400; `?screen=select|run`):
 *  [ ] Title -> Play -> Select; Esc/back returns to title.
 *  [ ] Select: beach open, others locked with reason; "Unlock all" shows
 *      band-coloured best badges + "Best m:ss x n/15" footers, bonus unlocked.
 *  [ ] Endless card: seed validates live (bad chars / >16 -> error, Play
 *      disabled), dice makes a new seed, per-seed best shown.
 *  [ ] Run: "Getting ready…" -> (started) "Release the Pineapples" -> click or
 *      Space -> "Releasing…" -> (released) button gone, timer runs.
 *  [ ] pineappleLost decrements the count; "lose all" in level mode pulses
 *      Give Up, in endless ends the run.
 *  [ ] goal N shows the banner, then results with the right band
 *      (presets: 32 red / 33 yellow / 66 yellow / 67 green / 0 / >115 s).
 *  [ ] Give Up -> "Giving up…" -> gaveUp -> results "no score recorded".
 *  [ ] Touch: always -> thumb buttons emit drive -1/0/1 (see log); blur clears.
 *  [ ] Storage: bad JSON / schema -> "damaged ... reset" toast, select still
 *      works; newer version -> read-only toast, data untouched; throwing
 *      storage -> one "can't be saved" toast.
 *  [ ] Rotate overlay ON (and a portrait phone viewport) covers the game.
 *  [ ] Endless: "aboard −1" drops the HUD count below `remaining` (telemetry);
 *      the results bonus uses that aboard count however the run ended; bests
 *      stay raw distance.
 *  [ ] Results -> "Re-mount current screen": identical render, no new best
 *      flip, nothing recorded twice (same resultId).
 *  [ ] setItem throws -> results show "(not saved)".
 */

import { App, type AppState, type ScreenFactory } from '../../app';
import { MockRunEventStream, RunEventEmitter, type RunEvent, type RunEventSource } from '../../model/runEvents';
import { emptyScoreBook, recordEndlessResult, recordLevelResult, TOTAL_PINEAPPLES } from '../../model/score';
import { endlessLevelId, parseRunTarget } from '../catalog';
import { el } from '../dom';
import { forceRotateOverlay } from '../orientation';
import { mountRunHudScreen, setScoreStore } from '../appScreens';
import { SCORE_STORAGE_KEY, ScoreStore, browserStorage, type StorageLike } from '../scoreStore';
import { showToast } from '../toast';
import type { DriveIntent } from '../screens/runHud';

// ------------------------------------------------------------------ storage

const real = browserStorage();
const faults = { get: false, set: false };
const flaky: StorageLike = {
  getItem(k) {
    if (faults.get) throw new Error('SecurityError (harness)');
    return real?.getItem(k) ?? null;
  },
  setItem(k, v) {
    if (faults.set) throw new Error('QuotaExceededError (harness)');
    real?.setItem(k, v);
  },
  removeItem(k) {
    real?.removeItem(k);
  },
};
const freshStore = () => setScoreStore(new ScoreStore(flaky, (n) => showToast(n.message)));
freshStore();

// ------------------------------------------------------------------ logging

const logEl = el('pre', { class: 'hx-log' });
function log(msg: string): void {
  const t = new Date().toISOString().slice(14, 23);
  logEl.textContent = `${t} ${msg}\n${logEl.textContent ?? ''}`.slice(0, 4000);
}

// ------------------------------------------------------------ mock run host

interface MockRun {
  emit(e: RunEvent): void;
  readonly simTime: number;
  setTime(t: number): void;
  remaining: number;
  /** Pineapples physically aboard (RunTelemetry.aboard) — can be < remaining. */
  aboard: number;
  furthest: number;
  scripted: boolean;
}

let current: MockRun | null = null;
let touchMode: 'auto' | 'always' | 'never' = 'auto';
let autoStart = true;
let useScript = false;

const runFactory: ScreenFactory = (host, state, dispatch) => {
  if (state.name !== 'run') throw new Error('run factory used for ' + state.name);
  const target = parseRunTarget(state.levelId);
  const backdrop = el('div', { class: 'hx-backdrop' }, [
    el('div', { class: 'hx-backdrop__label', text: `[canvas] ${target.kind === 'endless' ? `endless seed ${target.seed}` : target.levelId}` }),
  ]);
  host.appendChild(backdrop);

  const emitter = new RunEventEmitter();
  const script = useScript ? new MockRunEventStream() : null;
  let simTime = 0;
  let released = false;
  let ended = false;
  let drive: DriveIntent = 0;
  const run: MockRun = {
    emit(e) {
      if (ended) return log(`(ignored ${e.type}: run ended)`);
      if (e.type === 'released') released = true;
      if (e.type === 'goalReached' || e.type === 'gaveUp') ended = true;
      if (e.type === 'pineappleLost') {
        run.remaining = e.remaining;
        run.aboard = Math.min(run.aboard, e.remaining);
        if (target.kind === 'endless' && e.remaining === 0) ended = true;
      }
      log(`emit ${JSON.stringify(e)}`);
      emitter.emit(e);
    },
    get simTime() {
      return script ? script.simTime : simTime;
    },
    setTime(t) {
      simTime = t;
    },
    remaining: TOTAL_PINEAPPLES,
    aboard: TOTAL_PINEAPPLES,
    furthest: 0,
    scripted: !!script,
  };
  current = run;
  script?.on((e) => {
    if (e.type === 'pineappleLost') {
      run.remaining = e.remaining;
      run.aboard = Math.min(run.aboard, e.remaining);
    }
    log(`script ${JSON.stringify(e)}`);
  });
  const source: RunEventSource = {
    on(l) {
      const offs = [emitter.on(l), script?.on(l)];
      return () => offs.forEach((o) => o?.());
    },
  };

  const hud = mountRunHudScreen(host, state, dispatch, {
    source,
    clock: () => run.simTime,
    telemetry: { furthestMetres: () => run.furthest, aboard: () => run.aboard },
    touchControls: touchMode,
    controls: {
      release() {
        log('intent: release');
        if (!script) setTimeout(() => run.emit({ type: 'released', simTime: 0 }), 350);
      },
      giveUp() {
        log('intent: giveUp');
        if (script) script.giveUp();
        else setTimeout(() => run.emit({ type: 'gaveUp', simTime: run.simTime }), 150);
      },
      setDrive(dir) {
        drive = dir;
        log(`intent: drive ${dir}`);
      },
    },
  });

  // Fake sim clock: advances only after Release, pauses while hidden (like S1).
  let last = performance.now();
  let raf = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (!document.hidden) {
      if (script) script.advance(dt);
      else if (released && !ended) {
        simTime += dt;
        if (target.kind === 'endless') run.furthest += Math.max(0, drive) * dt * 7 + dt * 0.5;
      }
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  const startTimer = !script && autoStart ? setTimeout(() => run.emit({ type: 'started', simTime: 0 }), 400) : null;

  return {
    destroy() {
      if (startTimer) clearTimeout(startTimer);
      cancelAnimationFrame(raf);
      hud.destroy();
      backdrop.remove();
      if (current === run) current = null;
    },
  };
};

// --------------------------------------------------------------------- app

const host = document.getElementById('app')!;
let app: App | null = null;

function jump(state: AppState): void {
  app?.destroy();
  app = new App(host, state, { screens: { run: runFactory }, pwa: false });
  void app.start();
  log(`jump -> ${JSON.stringify(state)}`);
}

// ------------------------------------------------------------------- panel

function btn(label: string, fn: () => void): HTMLButtonElement {
  const b = el('button', { type: 'button', text: label });
  b.addEventListener('click', fn);
  return b;
}
function group(title: string, ...children: HTMLElement[]): HTMLElement {
  return el('fieldset', {}, [el('legend', { text: title }), ...children]);
}
function withRun(fn: (r: MockRun) => void): () => void {
  return () => {
    if (!current) return showToast('Harness: jump to a run screen first');
    fn(current);
  };
}

const goal = (delivered: number, at?: number) =>
  withRun((r) => {
    if (at !== undefined) r.setTime(at);
    r.emit({ type: 'goalReached', simTime: r.simTime, delivered });
  });

const results = (levelId: string, outcome: RunEvent | null, endless?: { furthestMetres: number; aboard: number }): AppState =>
  endless ? { name: 'results', levelId, outcome, endless } : { name: 'results', levelId, outcome };

function writeRaw(raw: string | null, label: string): void {
  if (raw === null) real?.removeItem(SCORE_STORAGE_KEY);
  else real?.setItem(SCORE_STORAGE_KEY, raw);
  freshStore();
  log(`storage: ${label}`);
  jump({ name: 'select' });
}

function unlockedBook(): string {
  let b = emptyScoreBook();
  b = recordLevelResult(b, 'beach', 28.4, 13);
  b = recordLevelResult(b, 'kitchen', 61, 9);
  b = recordLevelResult(b, 'workbench', 90, 4);
  b = recordEndlessResult(b, 'PINE42', 312.7);
  b = recordEndlessResult(b, 'TIKI', 118);
  return JSON.stringify(b);
}

const seedInput = el('input', { value: 'PINE42', size: 8 });

const panel = el('aside', { class: 'hx-panel' }, [
  el('h1', { text: 'S5 UI harness' }),
  group(
    'Screens',
    btn('Title', () => jump({ name: 'title' })),
    btn('Select', () => jump({ name: 'select' })),
    btn('Build (stub)', () => jump({ name: 'build', levelId: 'beach' })),
    btn('Run: beach', () => jump({ name: 'run', levelId: 'beach' })),
    btn('Run: endless', () => jump({ name: 'run', levelId: endlessLevelId(seedInput.value.toUpperCase() || 'PINE42') })),
    seedInput,
    btn('Run: default mock script', () => {
      useScript = true;
      jump({ name: 'run', levelId: 'beach' });
      useScript = false;
    }),
  ),
  group(
    'Results presets',
    btn('100% (15 @ 12s)', () => jump(results('beach', { type: 'goalReached', simTime: 12, delivered: 15 }))),
    btn('67% green', () => jump(results('beach', { type: 'goalReached', simTime: 14, delivered: 10 }))),
    btn('66% yellow (11 @ 25s)', () => jump(results('beach', { type: 'goalReached', simTime: 25, delivered: 11 }))),
    btn('33% yellow', () => jump(results('kitchen', { type: 'goalReached', simTime: 10, delivered: 5 }))),
    btn('32% red', () => jump(results('kitchen', { type: 'goalReached', simTime: 18, delivered: 5 }))),
    btn('0% (0/15)', () => jump(results('beach', { type: 'goalReached', simTime: 19, delivered: 0 }))),
    btn('0% (>115 s)', () => jump(results('beach', { type: 'goalReached', simTime: 130, delivered: 15 }))),
    btn('Gave up', () => jump(results('workbench', { type: 'gaveUp', simTime: 33.3 }))),
    btn('Original (bonus)', () => jump(results('original', { type: 'goalReached', simTime: 40, delivered: 12 }))),
    btn('Endless: lost last, 0 aboard', () =>
      jump(results('endless:PINE42', { type: 'pineappleLost', simTime: 80, pineappleId: 2, remaining: 0 }, { furthestMetres: 150, aboard: 0 })),
    ),
    btn('Endless: gave up, 6 aboard', () =>
      jump(results('endless:TIKI', { type: 'gaveUp', simTime: 64 }, { furthestMetres: 402.2, aboard: 6 })),
    ),
  ),
  group(
    'Record-once',
    btn('Re-mount current screen (same resultId)', () => {
      const s = app?.current;
      if (s) jump(s);
    }),
  ),
  group(
    'Run events (on run screen)',
    btn('started', withRun((r) => r.emit({ type: 'started', simTime: 0 }))),
    btn('released', withRun((r) => r.emit({ type: 'released', simTime: 0 }))),
    btn('pineappleLost', withRun((r) => r.emit({ type: 'pineappleLost', simTime: r.simTime, pineappleId: r.remaining, remaining: Math.max(0, r.remaining - 1) }))),
    btn('lose all', withRun((r) => r.emit({ type: 'pineappleLost', simTime: r.simTime, pineappleId: 0, remaining: 0 }))),
    btn('goal 15', goal(15)),
    btn('goal 11', goal(11)),
    btn('goal 5', goal(5)),
    btn('goal 1', goal(1)),
    btn('goal 0', goal(0)),
    btn('goal 15 @ 130 s', goal(15, 130)),
    btn('gaveUp', withRun((r) => r.emit({ type: 'gaveUp', simTime: r.simTime }))),
    btn('+10 s', withRun((r) => r.setTime(r.simTime + 10))),
    btn('t = 59.9 s', withRun((r) => r.setTime(59.9))),
    btn('t = 3599 s', withRun((r) => r.setTime(3599))),
    btn('+100 m', withRun((r) => (r.furthest += 100))),
    btn('aboard −1 (loose, not lost)', withRun((r) => (r.aboard = Math.max(0, r.aboard - 1)))),
    btn('aboard +1 (landed back)', withRun((r) => (r.aboard = Math.min(r.remaining, r.aboard + 1)))),
  ),
  group(
    'Scores storage',
    btn('Unlock all (seed book)', () => writeRaw(unlockedBook(), 'seeded')),
    btn('Clear', () => writeRaw(null, 'cleared')),
    btn('Corrupt: bad JSON', () => writeRaw('{"version":1,"levels":[', 'bad JSON')),
    btn('Corrupt: schema', () => writeRaw(JSON.stringify({ version: 1, levels: [{ levelId: 'beach', bestRating: 300 }] }), 'schema')),
    btn('Newer version', () => writeRaw(JSON.stringify({ version: 99, levels: [] }), 'future version')),
    btn('Toggle getItem throws', () => {
      faults.get = !faults.get;
      freshStore();
      log(`getItem throws: ${faults.get}`);
    }),
    btn('Toggle setItem throws', () => {
      faults.set = !faults.set;
      freshStore();
      log(`setItem throws: ${faults.set}`);
    }),
  ),
  group(
    'Overlays & input',
    btn('Rotate overlay ON', () => forceRotateOverlay('on')),
    btn('Rotate overlay auto', () => forceRotateOverlay('auto')),
    btn('Touch: always', () => {
      touchMode = 'always';
      log('touch controls: always (re-enter run)');
    }),
    btn('Touch: auto', () => {
      touchMode = 'auto';
      log('touch controls: auto (re-enter run)');
    }),
    btn('Toggle auto "started"', () => {
      autoStart = !autoStart;
      log(`auto started: ${autoStart}`);
    }),
    btn('Toast', () => showToast('Hello from the harness')),
  ),
  logEl,
]);

const toggle = el('button', { type: 'button', class: 'hx-toggle', text: 'Harness', 'aria-expanded': 'true' });
toggle.addEventListener('click', () => {
  panel.hidden = !panel.hidden;
  toggle.setAttribute('aria-expanded', String(!panel.hidden));
});
document.body.append(panel, toggle);
if (window.innerWidth < 1000) {
  panel.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
}

const initial = new URLSearchParams(location.search).get('screen');
jump(initial === 'select' ? { name: 'select' } : initial === 'run' ? { name: 'run', levelId: 'beach' } : { name: 'title' });
