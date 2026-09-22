/**
 * Minimal fake Web Audio + DOM bits for Node tests. Injected through factory
 * parameters (AudioEngineOptions.createContext / storage / visibility, the
 * timers option) — nothing global is patched.
 */
import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  AudioTimers,
  BiquadFilterNodeLike,
  BufferSourceNodeLike,
  DynamicsCompressorNodeLike,
  GainNodeLike,
  ListenerLike,
  OscillatorNodeLike,
  StorageLike,
  VisibilitySourceLike,
} from '../../src/audio/types';

export type ParamCall =
  | { m: 'set'; v: number; t: number }
  | { m: 'lin'; v: number; t: number }
  | { m: 'exp'; v: number; t: number }
  | { m: 'target'; v: number; t: number; c: number }
  | { m: 'cancel'; t: number };

export class FakeParam implements AudioParamLike {
  value: number;
  calls: ParamCall[] = [];
  constructor(initial = 0) {
    this.value = initial;
  }
  setValueAtTime(v: number, t: number) {
    this.calls.push({ m: 'set', v, t });
    this.value = v;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.calls.push({ m: 'lin', v, t });
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    if (!(v > 0)) throw new RangeError('exponential ramp to non-positive value');
    this.calls.push({ m: 'exp', v, t });
  }
  setTargetAtTime(v: number, t: number, c: number) {
    this.calls.push({ m: 'target', v, t, c });
  }
  cancelScheduledValues(t: number) {
    this.calls.push({ m: 'cancel', t });
  }
  /** Last scheduled target value (set/lin/exp/target), for assertions. */
  lastTarget(): number | undefined {
    for (let i = this.calls.length - 1; i >= 0; i--) {
      const c = this.calls[i]!;
      if (c.m !== 'cancel') return c.v;
    }
    return undefined;
  }
}

let nextId = 1;

export class FakeNode implements AudioNodeLike {
  readonly id = nextId++;
  outputs: Array<AudioNodeLike | AudioParamLike> = [];
  disconnectCount = 0;
  constructor(
    readonly kind: string,
    readonly ctx: FakeAudioContext,
  ) {
    ctx.nodes.push(this);
  }
  connect(dest: AudioNodeLike | AudioParamLike) {
    this.outputs.push(dest);
    return dest;
  }
  disconnect() {
    this.outputs = [];
    this.disconnectCount++;
  }
}

export class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam(1);
  constructor(ctx: FakeAudioContext) {
    super('gain', ctx);
  }
}

class FakeSource extends FakeNode {
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  start(when = 0) {
    if (this.startedAt !== null) throw new Error('InvalidStateError: start called twice');
    this.startedAt = when;
  }
  stop(when = 0) {
    this.stoppedAt = when;
  }
}

export class FakeOscillator extends FakeSource implements OscillatorNodeLike {
  type: OscillatorType = 'sine';
  readonly frequency = new FakeParam(440);
  readonly detune = new FakeParam(0);
  constructor(ctx: FakeAudioContext) {
    super('oscillator', ctx);
  }
}

export class FakeBufferSource extends FakeSource implements BufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  readonly playbackRate = new FakeParam(1);
  offset = 0;
  constructor(ctx: FakeAudioContext) {
    super('bufferSource', ctx);
  }
  override start(when = 0, offset = 0) {
    super.start(when);
    this.offset = offset;
  }
}

export class FakeBiquad extends FakeNode implements BiquadFilterNodeLike {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
  constructor(ctx: FakeAudioContext) {
    super('biquad', ctx);
  }
}

export class FakeCompressor extends FakeNode implements DynamicsCompressorNodeLike {
  readonly threshold = new FakeParam(-24);
  readonly knee = new FakeParam(30);
  readonly ratio = new FakeParam(12);
  readonly attack = new FakeParam(0.003);
  readonly release = new FakeParam(0.25);
  constructor(ctx: FakeAudioContext) {
    super('compressor', ctx);
  }
}

export class FakeBuffer implements AudioBufferLike {
  private readonly data: Float32Array;
  constructor(
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length);
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(): Float32Array {
    return this.data;
  }
}

export interface FakeContextBehaviour {
  /** resume() rejects instead of resolving. */
  resumeRejects?: boolean;
  /** resume() resolves but the state stays 'suspended' (e.g. no gesture). */
  resumeNoop?: boolean;
  initialState?: string;
  /**
   * suspend() stays pending (state still 'running', like a real context)
   * until the test calls `settleSuspend()` — reproduces the async race.
   */
  deferSuspend?: boolean;
  /** The next N resume() calls reject (then behave normally). */
  resumeRejectCount?: number;
}

export class FakeAudioContext implements AudioContextLike {
  currentTime = 0;
  readonly sampleRate = 8000;
  state: string;
  readonly nodes: FakeNode[] = [];
  readonly destination: FakeNode;
  resumeCalls = 0;
  suspendCalls = 0;
  closeCalls = 0;
  buffers: FakeBuffer[] = [];

  constructor(public behaviour: FakeContextBehaviour = {}) {
    this.state = behaviour.initialState ?? 'suspended';
    this.destination = new FakeNode('destination', this);
  }
  createGain() {
    return new FakeGain(this);
  }
  createOscillator() {
    return new FakeOscillator(this);
  }
  createBiquadFilter() {
    return new FakeBiquad(this);
  }
  createBufferSource() {
    return new FakeBufferSource(this);
  }
  createDynamicsCompressor() {
    return new FakeCompressor(this);
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const b = new FakeBuffer(length, sampleRate);
    this.buffers.push(b);
    return b;
  }
  resume() {
    this.resumeCalls++;
    if (this.state === 'closed') return Promise.reject(new Error('closed'));
    if (this.behaviour.resumeRejects) return Promise.reject(new Error('not allowed'));
    if (this.behaviour.resumeRejectCount && this.behaviour.resumeRejectCount > 0) {
      this.behaviour.resumeRejectCount--;
      return Promise.reject(new Error('transient'));
    }
    if (!this.behaviour.resumeNoop) this.state = 'running';
    return Promise.resolve();
  }
  private pendingSuspends: Array<() => void> = [];
  suspend() {
    this.suspendCalls++;
    const apply = () => {
      if (this.state !== 'closed') this.state = 'suspended';
    };
    if (!this.behaviour.deferSuspend) {
      apply();
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.pendingSuspends.push(() => {
        apply();
        resolve();
      });
    });
  }
  /** Completes every pending deferred suspend(). */
  settleSuspend() {
    const pending = this.pendingSuspends;
    this.pendingSuspends = [];
    for (const f of pending) f();
  }
  get suspendPending() {
    return this.pendingSuspends.length;
  }
  close() {
    this.closeCalls++;
    this.state = 'closed';
    return Promise.resolve();
  }
  ofKind<T extends FakeNode>(kind: string): T[] {
    return this.nodes.filter((n) => n.kind === kind) as T[];
  }
}

/** Factory that records every context it creates. */
export function fakeFactory(behaviour: FakeContextBehaviour = {}) {
  const created: FakeAudioContext[] = [];
  const factory = () => {
    const c = new FakeAudioContext(behaviour);
    created.push(c);
    return c;
  };
  return { factory, created };
}

export class FakeTimers implements AudioTimers {
  private next = 1;
  intervals = new Map<number, { cb: () => void; ms: number }>();
  timeouts = new Map<number, { cb: () => void; at: number }>();
  now = 0; // ms
  setInterval(cb: () => void, ms: number) {
    const id = this.next++;
    this.intervals.set(id, { cb, ms });
    return id;
  }
  clearInterval(h: unknown) {
    this.intervals.delete(h as number);
  }
  setTimeout(cb: () => void, ms: number) {
    const id = this.next++;
    this.timeouts.set(id, { cb, at: this.now + ms });
    return id;
  }
  clearTimeout(h: unknown) {
    this.timeouts.delete(h as number);
  }
  /** Fires every interval once. */
  fireIntervals() {
    for (const { cb } of [...this.intervals.values()]) cb();
  }
  /** Advances the timeout clock, firing due timeouts. */
  advance(ms: number) {
    this.now += ms;
    for (const [id, t] of [...this.timeouts]) {
      if (t.at <= this.now) {
        this.timeouts.delete(id);
        t.cb();
      }
    }
  }
  get pending() {
    return this.intervals.size + this.timeouts.size;
  }
}

export class FakeTarget implements VisibilitySourceLike {
  visibilityState = 'visible';
  listeners = new Map<string, Set<ListenerLike>>();
  options: Array<{ type: string; options: unknown }> = [];
  addEventListener(type: string, l: ListenerLike, options?: unknown) {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(l);
    this.options.push({ type, options });
  }
  removeEventListener(type: string, l: ListenerLike) {
    this.listeners.get(type)?.delete(l);
  }
  count(type?: string) {
    if (type) return this.listeners.get(type)?.size ?? 0;
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
  dispatch(type: string) {
    for (const l of [...(this.listeners.get(type) ?? [])]) l({ type });
  }
}

export class FakeStorage implements StorageLike {
  map = new Map<string, string>();
  throwOnSet: Error | null = null;
  throwOnGet: Error | null = null;
  getItem(key: string) {
    if (this.throwOnGet) throw this.throwOnGet;
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.throwOnSet) throw this.throwOnSet;
    this.map.set(key, value);
  }
}

export const quotaError = () => Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });

/** Lets pending promise callbacks run. */
export const flush = () => new Promise<void>((r) => setTimeout(r, 0));
