/**
 * Structural subset of the Web Audio API that src/audio actually uses.
 *
 * Every audio module is written against these interfaces, never against the
 * DOM classes directly, so tests can inject a small fake context through a
 * factory parameter (no global patching). engine.ts carries a compile-time
 * check that the real `AudioContext` satisfies `AudioContextLike`.
 */

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): unknown;
  cancelScheduledValues(time: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike | AudioParamLike): unknown;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface ScheduledSourceLike extends AudioNodeLike {
  start(when?: number): void;
  stop(when?: number): void;
}

export interface OscillatorNodeLike extends ScheduledSourceLike {
  type: OscillatorType;
  readonly frequency: AudioParamLike;
  readonly detune: AudioParamLike;
}

export interface AudioBufferLike {
  readonly length: number;
  readonly sampleRate: number;
  readonly duration: number;
  getChannelData(channel: number): Float32Array;
}

export interface BufferSourceNodeLike extends ScheduledSourceLike {
  start(when?: number, offset?: number): void;
  buffer: AudioBufferLike | null;
  loop: boolean;
  readonly playbackRate: AudioParamLike;
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: BiquadFilterType;
  readonly frequency: AudioParamLike;
  readonly Q: AudioParamLike;
}

export interface DynamicsCompressorNodeLike extends AudioNodeLike {
  readonly threshold: AudioParamLike;
  readonly knee: AudioParamLike;
  readonly ratio: AudioParamLike;
  readonly attack: AudioParamLike;
  readonly release: AudioParamLike;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  /** 'suspended' | 'running' | 'closed' (Safari also reports 'interrupted'). */
  readonly state: string;
  readonly destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createOscillator(): OscillatorNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  createBufferSource(): BufferSourceNodeLike;
  createDynamicsCompressor(): DynamicsCompressorNodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

/** Creates a context, or null when Web Audio is unavailable / creation failed. */
export type AudioContextFactory = () => AudioContextLike | null;

/** localStorage subset (same shape as src/ui/scoreStore's, redeclared: no ui import). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type ListenerLike = (event: unknown) => void;

/** Anything we attach DOM listeners to (unlock element, document). */
export interface EventTargetLike {
  addEventListener(type: string, listener: ListenerLike, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: ListenerLike, options?: boolean | EventListenerOptions): void;
}

/** The part of `document` the engine needs for suspend-on-hidden. */
export interface VisibilitySourceLike extends EventTargetLike {
  readonly visibilityState: string;
}

/** Timer functions, injectable so schedulers and fades are testable. */
export interface AudioTimers {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

type Handle = ReturnType<typeof globalThis.setTimeout>;

/** The global timers, wrapped to the AudioTimers shape. */
export const globalTimers: AudioTimers = {
  setInterval: (cb, ms) => globalThis.setInterval(cb, ms),
  clearInterval: (h) => globalThis.clearInterval(h as Handle),
  setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as Handle),
};
