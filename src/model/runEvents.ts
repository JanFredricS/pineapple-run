/**
 * Run lifecycle interface (S0 contract 3).
 *
 * S1 owns the simulation and EMITS these events; S5 owns UI state, consumes
 * them, and calls model/score for any scoring. `simTime` is simulation time in
 * seconds since Release (0 before Release) — steps × 1/60, never wall clock.
 */

export type RunEvent =
  | { type: 'started'; simTime: 0 }
  | { type: 'released'; simTime: 0 }
  | { type: 'pineappleLost'; simTime: number; pineappleId: number; remaining: number }
  | { type: 'goalReached'; simTime: number; delivered: number }
  | { type: 'gaveUp'; simTime: number };

export type RunEventType = RunEvent['type'];
export type RunEventListener = (event: RunEvent) => void;

/** What S5 subscribes to. S1's run controller implements it; mocks too. */
export interface RunEventSource {
  on(listener: RunEventListener): () => void;
}

/** Tiny synchronous emitter usable by S1's real implementation and mocks. */
export class RunEventEmitter implements RunEventSource {
  private listeners = new Set<RunEventListener>();

  on(listener: RunEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: RunEvent): void {
    for (const l of [...this.listeners]) l(event);
  }

  clear(): void {
    this.listeners.clear();
  }
}

/** A scripted event at a given sim time (seconds since Release). */
export interface ScriptedRunEvent {
  at: number;
  event: RunEvent;
}

/** Default mock run: loses 2 pineapples, delivers 13 at 40 s sim time. */
export function defaultMockRunScript(): ScriptedRunEvent[] {
  return [
    { at: 0, event: { type: 'started', simTime: 0 } },
    { at: 0, event: { type: 'released', simTime: 0 } },
    { at: 6.5, event: { type: 'pineappleLost', simTime: 6.5, pineappleId: 3, remaining: 14 } },
    { at: 21, event: { type: 'pineappleLost', simTime: 21, pineappleId: 11, remaining: 13 } },
    { at: 40, event: { type: 'goalReached', simTime: 40, delivered: 13 } },
  ];
}

/**
 * Mock run event stream for developing S5 without physics. Deterministic:
 * the host advances it by simulation time (e.g. from a rAF loop, or directly
 * in tests). `giveUp()` emits gaveUp and ends the script.
 */
export class MockRunEventStream implements RunEventSource {
  private emitter = new RunEventEmitter();
  private time = 0;
  private cursor = 0;
  private ended = false;

  constructor(private readonly script: ScriptedRunEvent[] = defaultMockRunScript()) {
    this.script = [...script].sort((a, b) => a.at - b.at);
  }

  on(listener: RunEventListener): () => void {
    return this.emitter.on(listener);
  }

  get simTime(): number {
    return this.time;
  }

  get isEnded(): boolean {
    return this.ended;
  }

  /** Advance simulated time and emit every scripted event now due. */
  advance(dtSeconds: number): void {
    if (this.ended) return;
    this.time += Math.max(0, dtSeconds);
    while (!this.ended && this.cursor < this.script.length && this.script[this.cursor]!.at <= this.time) {
      const { event } = this.script[this.cursor++]!;
      this.emitter.emit(event);
      if (event.type === 'goalReached' || event.type === 'gaveUp') this.ended = true;
    }
  }

  giveUp(): void {
    if (this.ended) return;
    this.ended = true;
    this.emitter.emit({ type: 'gaveUp', simTime: this.time });
  }
}
