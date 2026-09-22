import { describe, expect, it } from 'vitest';
import {
  AUDIO_STORAGE_KEY,
  RESUME_RETRY_DELAYS_MS,
  AudioEngine,
  DEFAULT_AUDIO_SETTINGS,
  MUSIC_BUS_LEVEL,
  parseAudioSettings,
  SFX_BUS_LEVEL,
  UNLOCK_EVENTS,
} from '../../src/audio/engine';
import { FakeAudioContext, FakeStorage, FakeTarget, FakeTimers, fakeFactory, flush, quotaError, type FakeGain } from './fakeAudio';

function make(opts: { behaviour?: ConstructorParameters<typeof FakeAudioContext>[0]; storage?: FakeStorage | null } = {}) {
  const { factory, created } = fakeFactory(opts.behaviour);
  const storage = opts.storage === undefined ? new FakeStorage() : opts.storage;
  const doc = new FakeTarget();
  const engine = new AudioEngine({ createContext: factory, storage, visibility: doc });
  return { engine, created, storage, doc };
}

async function unlockedWithTimers() {
  const { factory, created } = fakeFactory();
  const doc = new FakeTarget();
  const timers = new FakeTimers();
  const engine = new AudioEngine({ createContext: factory, storage: null, visibility: doc, timers });
  const el = new FakeTarget();
  engine.attach(el);
  el.dispatch('pointerdown');
  await flush();
  expect(engine.unlocked).toBe(true);
  expect(el.count()).toBe(0);
  return { engine, created, doc, timers, el };
}

describe('AudioEngine: lazy context', () => {
  it('creates no context until needed, then exactly one with the bus graph', () => {
    const { engine, created } = make();
    const el = new FakeTarget();
    engine.attach(el);
    expect(created).toHaveLength(0);
    expect(engine.state).toBe('none');
    const g = engine.ensureGraph()!;
    expect(created).toHaveLength(1);
    expect(engine.ensureGraph()).toBe(g);
    expect(created).toHaveLength(1);
    // musicBus → tone → master → limiter → destination; sfxBus → master
    expect(g.musicBus.connect).toBeDefined();
    const ctx = created[0]!;
    const master = g.master as FakeGain;
    expect((g.musicBus as FakeGain).outputs).toEqual([g.musicTone]);
    expect((g.sfxBus as FakeGain).outputs).toEqual([master]);
    expect(master.outputs).toEqual([g.limiter]);
    expect((g.limiter as unknown as FakeGain).outputs).toEqual([ctx.destination]);
    expect((g.musicBus as FakeGain).gain.value).toBeCloseTo(DEFAULT_AUDIO_SETTINGS.music * MUSIC_BUS_LEVEL, 12);
    expect((g.sfxBus as FakeGain).gain.value).toBeCloseTo(DEFAULT_AUDIO_SETTINGS.sfx * SFX_BUS_LEVEL, 12);
  });

  it('a missing Web Audio (factory → null, or throws) is a silent no-op', () => {
    const e1 = new AudioEngine({ createContext: () => null, storage: null, visibility: null });
    expect(e1.ensureGraph()).toBeNull();
    const e2 = new AudioEngine({
      createContext: () => {
        throw new Error('too many contexts');
      },
      storage: null,
      visibility: null,
    });
    expect(e2.ensureGraph()).toBeNull();
    expect(e2.setMuted(true)).toBe(false);
  });
});

describe('AudioEngine: unlock on first gesture', () => {
  it('adds capture listeners for every unlock event, removes them once running', async () => {
    const { engine, created } = make();
    const el = new FakeTarget();
    engine.attach(el);
    for (const t of UNLOCK_EVENTS) expect(el.count(t)).toBe(1);
    expect(el.options.filter((o) => (UNLOCK_EVENTS as readonly string[]).includes(o.type)).every((o) => (o.options as AddEventListenerOptions).capture === true)).toBe(true);
    expect(engine.awaitingUnlock).toBe(true);
    el.dispatch('pointerdown');
    const ctx = created[0]!;
    expect(ctx.resumeCalls).toBe(1); // synchronously inside the gesture
    // the iOS silent-buffer kick was started inside the gesture too
    expect(ctx.ofKind<import('./fakeAudio').FakeBufferSource>('bufferSource')[0]!.startedAt).toBe(0);
    await flush();
    expect(engine.unlocked).toBe(true);
    expect(el.count()).toBe(0);
    expect(engine.awaitingUnlock).toBe(false);
  });

  it('keeps listening when resume rejects or leaves the context suspended', async () => {
    for (const behaviour of [{ resumeRejects: true }, { resumeNoop: true }]) {
      const { engine } = make({ behaviour });
      const el = new FakeTarget();
      engine.attach(el);
      el.dispatch('touchend');
      await flush();
      expect(engine.unlocked).toBe(false);
      expect(el.count()).toBe(UNLOCK_EVENTS.length);
    }
  });

  it('stops listening when there is no Web Audio at all', () => {
    const engine = new AudioEngine({ createContext: () => null, storage: null, visibility: null });
    const el = new FakeTarget();
    engine.attach(el);
    el.dispatch('keydown');
    expect(el.count()).toBe(0);
  });

  it('attach is idempotent and re-targeting moves the listeners', () => {
    const { engine } = make();
    const a = new FakeTarget();
    const b = new FakeTarget();
    engine.attach(a);
    engine.attach(a);
    expect(a.count()).toBe(UNLOCK_EVENTS.length);
    engine.attach(b);
    expect(a.count()).toBe(0);
    expect(b.count()).toBe(UNLOCK_EVENTS.length);
  });
});

describe('AudioEngine: visibility', () => {
  it('suspends when hidden and resumes when visible again', async () => {
    const { engine, created, doc } = make();
    const el = new FakeTarget();
    engine.attach(el);
    expect(doc.count('visibilitychange')).toBe(1);
    el.dispatch('pointerdown');
    await flush();
    const ctx = created[0]!;
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    await engine.visibilitySettled;
    expect(ctx.suspendCalls).toBe(1);
    expect(ctx.state).toBe('suspended');
    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    await engine.visibilitySettled;
    expect(ctx.resumeCalls).toBe(2);
    expect(ctx.state).toBe('running');
  });

  it('hide→show before suspend() settles still ends running (intent, not snapshot)', async () => {
    const { engine, created, doc } = make({ behaviour: { deferSuspend: true } });
    const el = new FakeTarget();
    engine.attach(el);
    el.dispatch('pointerdown');
    await flush();
    const ctx = created[0]!;
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    await flush();
    expect(ctx.suspendPending).toBe(1);
    expect(ctx.state).toBe('running'); // suspension not settled yet
    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    await flush();
    expect(ctx.resumeCalls).toBe(1); // nothing yet: waits for the pending suspend
    ctx.settleSuspend();
    await engine.visibilitySettled;
    await flush();
    expect(ctx.state).toBe('running');
    expect(ctx.resumeCalls).toBe(2);
  });

  it('hide and show queued before any transition runs: no suspend at all', async () => {
    const { engine, created, doc } = make({ behaviour: { deferSuspend: true } });
    const el = new FakeTarget();
    engine.attach(el);
    el.dispatch('pointerdown');
    await flush();
    const ctx = created[0]!;
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    await engine.visibilitySettled;
    expect(ctx.suspendCalls).toBe(0);
    expect(ctx.state).toBe('running');
  });

  it('show→hide queued while suspended: intent wins, stays suspended', async () => {
    const { engine, created, doc } = make({ behaviour: { deferSuspend: true } });
    const el = new FakeTarget();
    engine.attach(el);
    el.dispatch('pointerdown');
    await flush();
    const ctx = created[0]!;
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    await flush();
    ctx.settleSuspend();
    await engine.visibilitySettled;
    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    await flush();
    ctx.settleSuspend();
    await engine.visibilitySettled;
    await flush();
    ctx.settleSuspend();
    await engine.visibilitySettled;
    expect(ctx.state).toBe('suspended');
  });

  it('a transiently rejected resume on show is retried by the timer backoff', async () => {
    const { engine, created, doc, timers, el } = await unlockedWithTimers();
    const ctx = created[0]!;
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    await engine.visibilitySettled;
    expect(ctx.state).toBe('suspended');
    ctx.behaviour.resumeRejectCount = 1;
    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    await engine.visibilitySettled;
    expect(ctx.state).toBe('suspended'); // first resume rejected
    expect(engine.resumeRetryPending).toBe(true);
    expect(el.count()).toBe(UNLOCK_EVENTS.length); // gesture healing re-armed
    timers.advance(RESUME_RETRY_DELAYS_MS[0]!);
    await engine.visibilitySettled;
    await flush();
    expect(ctx.state).toBe('running');
    expect(engine.resumeRetryPending).toBe(false);
    expect(el.count()).toBe(0); // healing listeners removed again
    expect(timers.pending).toBe(0);
  });

  it('persistent rejection: bounded retries, then a user gesture heals it', async () => {
    const { engine, created, doc, timers, el } = await unlockedWithTimers();
    const ctx = created[0]!;
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    await engine.visibilitySettled;
    ctx.behaviour.resumeRejects = true;
    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    await engine.visibilitySettled;
    const before = ctx.resumeCalls;
    for (const d of RESUME_RETRY_DELAYS_MS) {
      expect(engine.resumeRetryPending).toBe(true);
      timers.advance(d);
      await engine.visibilitySettled;
      await flush();
    }
    expect(ctx.resumeCalls).toBe(before + RESUME_RETRY_DELAYS_MS.length);
    expect(engine.resumeRetryPending).toBe(false); // budget exhausted, no busy loop
    expect(timers.pending).toBe(0);
    expect(ctx.state).toBe('suspended');
    expect(el.count()).toBe(UNLOCK_EVENTS.length);
    // The browser now allows it (user activation): a tap heals.
    ctx.behaviour.resumeRejects = false;
    el.dispatch('pointerdown');
    await flush();
    expect(ctx.state).toBe('running');
    expect(el.count()).toBe(0);
  });

  /** Unlocked → hidden → visible with every resume rejected until the retry budget is spent. */
  async function exhaustedRetries() {
    const env = await unlockedWithTimers();
    const { engine, created, doc, timers, el } = env;
    const ctx = created[0]!;
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    await engine.visibilitySettled;
    ctx.behaviour.resumeRejects = true;
    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    await engine.visibilitySettled;
    for (const d of RESUME_RETRY_DELAYS_MS) {
      timers.advance(d);
      await engine.visibilitySettled;
      await flush();
    }
    expect(engine.resumeRetryPending).toBe(false);
    expect(ctx.state).toBe('suspended');
    expect(el.count()).toBe(UNLOCK_EVENTS.length);
    return { ...env, ctx };
  }

  it('audit race: gesture resume pending → hide → resume settles → reconciled to suspended', async () => {
    const { engine, ctx, doc, timers, el } = await exhaustedRetries();
    ctx.behaviour.resumeRejects = false;
    ctx.behaviour.deferResume = true;
    const resumesBefore = ctx.resumeCalls;
    el.dispatch('pointerdown');
    expect(ctx.resumeCalls).toBe(resumesBefore + 1); // still called inside the gesture
    expect(ctx.resumePending).toBe(1);
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    await flush();
    // The hide step is queued behind the pending gesture resume, not racing it.
    expect(ctx.suspendCalls).toBe(1);
    expect(ctx.state).toBe('suspended');
    ctx.behaviour.deferResume = false;
    ctx.settleResume(); // the gesture's resume lands while hidden
    await engine.visibilitySettled;
    await flush();
    expect(ctx.state).toBe('suspended');
    expect(ctx.suspendCalls).toBe(2); // reconciliation re-suspended it
    expect(el.count()).toBe(0); // the gesture did succeed: healing listeners gone
    expect(engine.resumeRetryPending).toBe(false);
    expect(timers.pending).toBe(0);
    // And a later show resumes normally.
    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    await engine.visibilitySettled;
    expect(ctx.state).toBe('running');
  });

  it('audit race, converse: gesture resume pending → hide → show → settle ends running', async () => {
    const { engine, ctx, doc, el } = await exhaustedRetries();
    ctx.behaviour.resumeRejects = false;
    ctx.behaviour.deferResume = true;
    el.dispatch('pointerdown');
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    await flush();
    ctx.behaviour.deferResume = false;
    ctx.settleResume();
    await engine.visibilitySettled;
    await flush();
    expect(ctx.state).toBe('running');
    expect(ctx.suspendCalls).toBe(1); // only the original hide; no spurious suspend
    expect(el.count()).toBe(0);
  });

  it('gesture resume pending → hide → resume rejects: stays suspended, listeners kept, no retry', async () => {
    const { engine, ctx, doc, timers, el } = await exhaustedRetries();
    ctx.behaviour.resumeRejects = false;
    ctx.behaviour.deferResume = true;
    el.dispatch('pointerdown');
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    await flush();
    ctx.behaviour.deferResume = false;
    ctx.settleResume(true);
    await engine.visibilitySettled;
    await flush();
    expect(ctx.state).toBe('suspended');
    expect(el.count()).toBe(UNLOCK_EVENTS.length);
    expect(timers.pending).toBe(0);
  });

  it('first-ever unlock gesture resolving after the page hid is reconciled to suspended', async () => {
    const { engine, created, doc } = make({ behaviour: { deferResume: true } });
    const el = new FakeTarget();
    engine.attach(el);
    el.dispatch('pointerdown');
    const ctx = created[0]!;
    expect(ctx.resumePending).toBe(1);
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    await flush();
    expect(ctx.suspendCalls).toBe(0); // hide step waits behind the gesture
    ctx.behaviour.deferResume = false;
    ctx.settleResume();
    await engine.visibilitySettled;
    await flush();
    expect(engine.unlocked).toBe(true);
    expect(el.count()).toBe(0);
    expect(ctx.state).toBe('suspended');
    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    await engine.visibilitySettled;
    expect(ctx.state).toBe('running');
  });

  it('show then immediately hide: no resume attempt and no retry', async () => {
    const { engine, created, doc, timers } = await unlockedWithTimers();
    const ctx = created[0]!;
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    await engine.visibilitySettled;
    ctx.behaviour.resumeRejectCount = 1;
    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    doc.visibilityState = 'hidden'; // hidden before the resume step even runs
    await engine.visibilitySettled;
    expect(engine.resumeRetryPending).toBe(false);
    expect(timers.pending).toBe(0);
    expect(ctx.state).toBe('suspended');
  });

  it('destroy cancels a pending resume retry', async () => {
    const { engine, created, doc, timers } = await unlockedWithTimers();
    const ctx = created[0]!;
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    await engine.visibilitySettled;
    ctx.behaviour.resumeRejects = true;
    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    await engine.visibilitySettled;
    expect(timers.pending).toBe(1);
    await engine.destroy();
    expect(timers.pending).toBe(0);
  });

  it('does not resume a context that was never unlocked', async () => {
    const { engine, created, doc } = make();
    engine.attach(new FakeTarget());
    engine.ensureGraph();
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    await engine.visibilitySettled;
    expect(created[0]!.resumeCalls).toBe(0);
  });
});

describe('AudioEngine: settings persistence honesty', () => {
  it('persists mute/volumes and reports true on success', () => {
    const { engine, storage } = make();
    expect(engine.setMuted(true)).toBe(true);
    expect(engine.setMusicVolume(0.25)).toBe(true);
    expect(engine.setSfxVolume(2)).toBe(true); // clamped
    const saved = JSON.parse(storage!.map.get(AUDIO_STORAGE_KEY)!);
    expect(saved).toEqual({ v: 1, muted: true, music: 0.25, sfx: 1 });
    // A fresh engine restores them.
    const again = new AudioEngine({ createContext: fakeFactory().factory, storage, visibility: null });
    expect(again.settings).toEqual({ muted: true, music: 0.25, sfx: 1 });
    const g = again.ensureGraph()!;
    expect((g.master as FakeGain).gain.value).toBe(0);
  });

  it('quota errors → false, but the setting still applies in memory and to the graph', () => {
    const { engine, storage } = make();
    const g = engine.ensureGraph()!;
    storage!.throwOnSet = quotaError();
    expect(engine.setMuted(true)).toBe(false);
    expect(engine.settings.muted).toBe(true);
    expect((g.master as FakeGain).gain.lastTarget()).toBe(0);
    expect(engine.setMusicVolume(0.5)).toBe(false);
    expect(engine.settings.music).toBe(0.5);
    expect(storage!.map.has(AUDIO_STORAGE_KEY)).toBe(false);
  });

  it('no storage → false; unreadable storage → defaults', () => {
    const { engine } = make({ storage: null });
    expect(engine.setMuted(true)).toBe(false);
    const s = new FakeStorage();
    s.throwOnGet = new Error('SecurityError');
    const e2 = new AudioEngine({ createContext: fakeFactory().factory, storage: s, visibility: null });
    expect(e2.settings).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('parse is tolerant field by field', () => {
    expect(parseAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings('{nope')).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings('42')).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings('{"muted":"yes","music":0.3,"sfx":7}')).toEqual({ muted: false, music: 0.3, sfx: 1 });
    expect(parseAudioSettings('{"muted":true,"music":null}')).toEqual({ ...DEFAULT_AUDIO_SETTINGS, muted: true });
  });

  it('volume changes are smoothed, not stepped', () => {
    const { engine } = make();
    const g = engine.ensureGraph()!;
    engine.setMusicVolume(0.5);
    const last = (g.musicBus as FakeGain).gain.calls.at(-1)!;
    expect(last.m).toBe('target');
    expect((last as { v: number }).v).toBeCloseTo(0.5 * MUSIC_BUS_LEVEL, 12);
  });
});

describe('AudioEngine: destroy', () => {
  it('removes every listener, disconnects the buses and closes the context', async () => {
    const { engine, created, doc } = make();
    const el = new FakeTarget();
    engine.attach(el);
    const g = engine.ensureGraph()!;
    await engine.destroy();
    expect(el.count()).toBe(0);
    expect(doc.count()).toBe(0);
    const ctx = created[0]!;
    expect(ctx.closeCalls).toBe(1);
    expect(ctx.state).toBe('closed');
    for (const n of [g.master, g.musicBus, g.musicTone, g.sfxBus, g.limiter]) expect((n as FakeGain).disconnectCount).toBeGreaterThan(0);
    expect(engine.graph).toBeNull();
    expect(engine.ensureGraph()).toBeNull(); // never resurrects
    await engine.destroy(); // idempotent
    expect(ctx.closeCalls).toBe(1);
    engine.attach(el);
    expect(el.count()).toBe(0);
  });

  it('a gesture resolving after destroy does not re-arm anything', async () => {
    const { engine } = make();
    const el = new FakeTarget();
    engine.attach(el);
    el.dispatch('pointerdown');
    await engine.destroy();
    await flush();
    expect(engine.unlocked).toBe(false);
    expect(el.count()).toBe(0);
  });
});
