/**
 * S6V finding 1: S7 audio wired into the app. The run-screen adapter
 * (gameAudioHooks) mapped onto a fake GameAudio, the same adapter over the
 * REAL GameAudio (fake Web Audio) for music stages at exact quarter / 150 m
 * boundaries, the per-run tick feed over a real headless run, the app-level
 * owner (music per screen, mute persistence, teardown) and the App wiring.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/ui/chrome', () => ({ installChrome: () => () => {} }));
import { GameAudio, stageForEndlessDistance } from '../../src/audio';
import { App, type AppState } from '../../src/app';
import { exampleCart } from '../../src/builder/exampleCart';
import { AppAudio, musicForState, type AppAudioPort, type AppGameAudio } from '../../src/game/appAudio';
import {
  AUDIO_TICK_STEPS,
  courseProgress,
  gameAudioHooks,
  MOTOR_DRIVE_FLOOR,
  motorLevel,
  RunAudioFeed,
  safeHooks,
  type AudioHooks,
  type RunAudioTick,
} from '../../src/game/audioHooks';
import { courseFor } from '../../src/game/courses';
import { RunSession } from '../../src/game/session';
import type { RunEvent } from '../../src/model/runEvents';
import { FakeStorage, FakeTarget, FakeTimers, fakeFactory, flush } from '../audio/fakeAudio';

// ------------------------------------------------------------------ fakes

type Call = [string, ...unknown[]];

class FakeGameAudio implements AppGameAudio {
  calls: Call[] = [];
  motorRunning = false;
  mutedState = false;
  destroyCalls = 0;
  readonly music = { play: (theme: string, stage?: number) => void this.calls.push(stage === undefined ? ['play', theme] : ['play', theme, stage]) };
  readonly sfx = (() => {
    const owner = this;
    return {
    wheelMotor: {
      get running() {
        return owner.motorRunning;
      },
      start: (v?: number) => {
        this.motorRunning = true;
        this.calls.push(['motor.start', v]);
      },
      set: (v: number) => void this.calls.push(['motor.set', v]),
      stop: () => {
        this.motorRunning = false;
        this.calls.push(['motor.stop']);
      },
    },
    };
  })();
  init(t: unknown) {
    this.calls.push(['init', t]);
  }
  get muted() {
    return this.mutedState;
  }
  setMuted(m: boolean) {
    this.mutedState = m;
    this.calls.push(['setMuted', m]);
    return true;
  }
  onRunEvent(e: RunEvent) {
    this.calls.push(['event', e.type]);
    // mirror GameAudio: started starts the motor, terminals stop it
    if (e.type === 'started') this.motorRunning = true;
    if (e.type === 'goalReached' || e.type === 'gaveUp' || e.type === 'allLost') this.motorRunning = false;
  }
  setCourseProgress(p: number) {
    this.calls.push(['progress', p]);
  }
  setEndlessDistance(m: number) {
    this.calls.push(['endless', m]);
  }
  stopRunSounds() {
    this.motorRunning = false;
    this.calls.push(['stopRunSounds']);
  }
  async destroy() {
    this.destroyCalls++;
  }
  take(): Call[] {
    const c = this.calls;
    this.calls = [];
    return c;
  }
}

const tick = (t: Partial<RunAudioTick>): RunAudioTick => ({ courseProgress: 0, endlessMetres: 0, speed: 0, ...t });

function realAudio() {
  const { factory, created } = fakeFactory();
  const timers = new FakeTimers();
  const storage = new FakeStorage();
  const audio = new GameAudio({ createContext: factory, storage, visibility: new FakeTarget(), timers, musicSeed: 1, random: () => 0.5 });
  return { audio, created, timers, storage };
}

// ------------------------------------------------------- adapter mapping

describe('gameAudioHooks: run-screen hooks → GameAudio (fake)', () => {
  it('start: course theme at stage 0, then started → motor idle', () => {
    const a = new FakeGameAudio();
    const h = gameAudioHooks(a);
    h.runStarted!({ levelId: 'kitchen', mode: 'level' });
    expect(a.take()).toEqual([['play', 'kitchen', 0]]);
    h.runEvent!({ type: 'started', simTime: 0 });
    expect(a.take()).toEqual([['event', 'started'], ['motor.set', 0]]);
    h.runStarted!({ levelId: 'endless:ABC', mode: 'endless' });
    expect(a.take()).toEqual([['play', 'endless', 0]]);
    h.runStarted!({ levelId: 'original', mode: 'level' });
    expect(a.take()).toEqual([['play', 'workbench', 0]]);
  });

  it('release is forwarded (clatter); drive revs the motor; speed drives pitch', () => {
    const a = new FakeGameAudio();
    const h = gameAudioHooks(a);
    h.runStarted!({ levelId: 'beach', mode: 'level' });
    h.runEvent!({ type: 'started', simTime: 0 });
    a.take();
    h.runEvent!({ type: 'released', simTime: 0 });
    expect(a.take()).toEqual([['event', 'released']]);
    h.drive!(1);
    expect(a.take()).toEqual([['motor.set', MOTOR_DRIVE_FLOOR]]);
    h.tick!(tick({ speed: 5, courseProgress: 0.1 }));
    expect(a.take()).toEqual([['motor.set', 0.5], ['progress', 0.1]]);
    h.tick!(tick({ speed: 40 }));
    expect(a.take()[0]).toEqual(['motor.set', 1]);
    h.drive!(0);
    h.tick!(tick({ speed: 0 }));
    expect(a.take()).toEqual([['motor.set', 1], ['motor.set', 0], ['progress', 0]]);
    expect(motorLevel(-1, 0)).toBe(MOTOR_DRIVE_FLOOR);
    expect(motorLevel(0, Number.NaN)).toBe(0);
  });

  it('endless: ticks feed setEndlessDistance, never course progress', () => {
    const a = new FakeGameAudio();
    const h = gameAudioHooks(a);
    h.runStarted!({ levelId: 'endless:SEED', mode: 'endless' });
    h.runEvent!({ type: 'started', simTime: 0 });
    a.take();
    h.tick!(tick({ endlessMetres: 150, courseProgress: 0.9 }));
    expect(a.take()).toEqual([['motor.set', 0], ['endless', 150]]);
  });

  it('loss: pineappleLost forwarded; allLost ends the run — motor no longer driven, stop clears run sounds', () => {
    const a = new FakeGameAudio();
    const h = gameAudioHooks(a);
    h.runStarted!({ levelId: 'endless:X', mode: 'endless' });
    h.runEvent!({ type: 'started', simTime: 0 });
    h.runEvent!({ type: 'released', simTime: 0 });
    a.take();
    h.runEvent!({ type: 'pineappleLost', simTime: 3, pineappleId: 2, remaining: 0 });
    h.runEvent!({ type: 'allLost', simTime: 3 });
    expect(a.take()).toEqual([['event', 'pineappleLost'], ['event', 'allLost']]);
    h.drive!(1);
    h.paused!(true);
    h.paused!(false);
    expect(a.take()).toEqual([['motor.stop']]); // no set / restart after the end
    h.runStopped!();
    expect(a.take()).toEqual([['stopRunSounds']]);
  });

  it('delivery: goalReached forwarded; leaving the run stops only the motor (the blender whir finishes on its timer)', () => {
    const a = new FakeGameAudio();
    const h = gameAudioHooks(a);
    h.runStarted!({ levelId: 'beach', mode: 'level' });
    h.runEvent!({ type: 'started', simTime: 0 });
    h.runEvent!({ type: 'released', simTime: 0 });
    a.take();
    h.runEvent!({ type: 'goalReached', simTime: 30, delivered: 12 });
    expect(a.take()).toEqual([['event', 'goalReached']]);
    h.runStopped!();
    expect(a.take()).toEqual([['motor.stop']]);
    // the next run is a normal one again
    h.runStarted!({ levelId: 'beach', mode: 'level' });
    h.runEvent!({ type: 'started', simTime: 0 });
    h.runStopped!();
    expect(a.take().at(-1)).toEqual(['stopRunSounds']);
  });

  it('finish by giving up / leaving mid-run: stopRunSounds', () => {
    const a = new FakeGameAudio();
    const h = gameAudioHooks(a);
    h.runStarted!({ levelId: 'kitchen', mode: 'level' });
    h.runEvent!({ type: 'started', simTime: 0 });
    h.runEvent!({ type: 'gaveUp', simTime: 4 });
    h.runStopped!();
    expect(a.take().slice(-2)).toEqual([['event', 'gaveUp'], ['stopRunSounds']]);
    // Retry / Escape while still driving
    h.runStarted!({ levelId: 'kitchen', mode: 'level' });
    h.runEvent!({ type: 'started', simTime: 0 });
    h.runStopped!();
    expect(a.take().at(-1)).toEqual(['stopRunSounds']);
  });

  it('pause/resume: the motor stops while paused and restarts at the current level; idempotent', () => {
    const a = new FakeGameAudio();
    const h = gameAudioHooks(a);
    h.runStarted!({ levelId: 'beach', mode: 'level' });
    h.runEvent!({ type: 'started', simTime: 0 });
    h.drive!(1);
    a.take();
    h.paused!(true);
    h.paused!(true);
    expect(a.take()).toEqual([['motor.stop']]);
    h.drive!(0); // FrameLoop clears input on pause
    h.tick!(tick({ speed: 0 }));
    expect(a.take()).toEqual([['progress', 0]]); // no motor writes while paused
    h.paused!(false);
    h.paused!(false);
    expect(a.take()).toEqual([['motor.start', 0]]);
  });

  it('a run that starts while paused (portrait) keeps the motor silent until resume', () => {
    const a = new FakeGameAudio();
    const h = gameAudioHooks(a);
    h.paused!(true);
    h.runStarted!({ levelId: 'beach', mode: 'level' });
    h.runEvent!({ type: 'started', simTime: 0 });
    expect(a.take()).toEqual([['motor.stop'], ['play', 'beach', 0], ['event', 'started'], ['motor.stop']]);
    h.paused!(false);
    expect(a.take()).toEqual([['motor.start', 0]]);
  });

  it('safeHooks: a throwing hook is logged once and never escapes', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad: AudioHooks = {
      runEvent() {
        throw new Error('boom');
      },
    };
    const safe = safeHooks(bad);
    expect(() => safe.runEvent!({ type: 'started', simTime: 0 })).not.toThrow();
    expect(() => safe.runEvent!({ type: 'released', simTime: 0 })).not.toThrow();
    expect(err).toHaveBeenCalledTimes(1);
    expect(safe.drive).toBeUndefined();
    err.mockRestore();
  });
});

// -------------------------------------------- real GameAudio: music stages

describe('gameAudioHooks over the real GameAudio (fake Web Audio)', () => {
  it('level: quarter transitions at the exact boundaries (floor(p × 4)), via courseProgress', () => {
    const { audio } = realAudio();
    const h = gameAudioHooks(audio);
    h.runStarted!({ levelId: 'beach', mode: 'level' });
    h.runEvent!({ type: 'started', simTime: 0 });
    const start = 10;
    const line = 110; // span 100 m: quarters at 35 / 60 / 85
    const stageAt = (x: number) => {
      h.tick!(tick({ courseProgress: courseProgress(start, line, x) }));
      return audio.music.stage;
    };
    expect(stageAt(10)).toBe(0);
    expect(stageAt(34.999)).toBe(0);
    expect(stageAt(35)).toBe(1);
    expect(stageAt(59.999)).toBe(1);
    expect(stageAt(60)).toBe(2);
    expect(stageAt(84.999)).toBe(2);
    expect(stageAt(85)).toBe(3);
    expect(stageAt(110)).toBe(3);
    expect(stageAt(500)).toBe(3);
    // a new run resets to stage 0
    h.runStopped!();
    h.runStarted!({ levelId: 'beach', mode: 'level' });
    expect(audio.music.stage).toBe(0);
  });

  it('endless: stage steps at exactly 150 / 300 / 450 m', () => {
    const { audio } = realAudio();
    const h = gameAudioHooks(audio);
    h.runStarted!({ levelId: 'endless:ABC', mode: 'endless' });
    h.runEvent!({ type: 'started', simTime: 0 });
    for (const [m, stage] of [
      [0, 0],
      [149.99, 0],
      [150, 1],
      [299.99, 1],
      [300, 2],
      [450, 3],
      [5000, 3],
    ] as const) {
      h.tick!(tick({ endlessMetres: m, courseProgress: 0 }));
      expect(audio.music.stage, `${m} m`).toBe(stage);
      expect(stageForEndlessDistance(m)).toBe(stage);
    }
  });

  it('sound plays after a gesture: title music schedules notes, the run motor loop starts, the goal sting fires', async () => {
    const { audio, created, timers } = realAudio();
    const doc = new FakeTarget();
    const app = new AppAudio(audio, doc);
    expect(doc.count('pointerdown')).toBe(1); // unlock armed
    app.enterState({ name: 'title' });
    const ctx = created[0]!;
    expect(ctx.state).toBe('suspended'); // no gesture yet: silent
    doc.dispatch('pointerdown');
    await flush();
    expect(ctx.state).toBe('running');
    expect(audio.unlocked).toBe(true);
    expect(audio.music.theme).toBe('title');
    const before = ctx.nodes.length;
    while (ctx.currentTime < 2) {
      ctx.currentTime += 0.025; // audio clock advancing, 25 ms scheduler wakes
      timers.fireIntervals();
    }
    expect(ctx.nodes.length).toBeGreaterThan(before); // notes scheduled
    // run
    const h = app.hooks;
    h.runStarted!({ levelId: 'kitchen', mode: 'level' });
    expect(audio.music.theme).toBe('kitchen');
    h.runEvent!({ type: 'started', simTime: 0 });
    expect(audio.sfx.wheelMotor.running).toBe(true);
    h.drive!(1);
    expect(audio.sfx.wheelMotor.param).toBe(MOTOR_DRIVE_FLOOR);
    h.runEvent!({ type: 'released', simTime: 0 });
    h.runEvent!({ type: 'goalReached', simTime: 20, delivered: 15 });
    expect(audio.sfx.wheelMotor.running).toBe(false);
    expect(audio.sfx.blenderWhir.running).toBe(true);
    expect(audio.sfx.throttle.active('goalSting', ctx.currentTime)).toBe(1);
    h.runStopped!();
    expect(audio.sfx.blenderWhir.running).toBe(true); // finishes on its own timer
    app.destroy();
    await flush();
    expect(ctx.closeCalls).toBe(1);
    expect(doc.count()).toBe(0);
  });
});

// ------------------------------------------------------ app-level owner

describe('AppAudio: music per screen, mute, teardown', () => {
  it('musicForState', () => {
    expect(musicForState({ name: 'title' })).toEqual({ theme: 'title' });
    expect(musicForState({ name: 'select' })).toEqual({ theme: 'title' });
    expect(musicForState({ name: 'build', levelId: 'kitchen' })).toEqual({ theme: 'kitchen', stage: 0 });
    expect(musicForState({ name: 'results', levelId: 'endless:Q', outcome: null })).toEqual({ theme: 'endless' });
    expect(musicForState({ name: 'run', levelId: 'beach' })).toBeNull();
  });

  it('enterState plays; mute goes through GameAudio; destroy once', () => {
    const a = new FakeGameAudio();
    const target = new FakeTarget();
    const app = new AppAudio(a, target);
    expect(a.take()).toEqual([['init', target]]);
    app.enterState({ name: 'title' });
    app.enterState({ name: 'build', levelId: 'workbench' });
    app.enterState({ name: 'run', levelId: 'workbench' });
    app.enterState({ name: 'results', levelId: 'workbench', outcome: null });
    expect(a.take()).toEqual([['play', 'title'], ['play', 'workbench', 0], ['play', 'workbench']]);
    expect(app.sound.muted()).toBe(false);
    app.sound.setMuted(true);
    expect(app.sound.muted()).toBe(true);
    expect(a.take()).toEqual([['setMuted', true]]);
    app.destroy();
    app.destroy();
    expect(a.destroyCalls).toBe(1);
    app.enterState({ name: 'title' });
    expect(a.take()).toEqual([]);
  });

  it('mute persists through the real GameAudio settings storage', () => {
    const { audio, storage } = realAudio();
    const app = new AppAudio(audio, null);
    app.sound.setMuted(true);
    expect(app.sound.muted()).toBe(true);
    expect(JSON.parse([...storage.map.values()][0]!)).toMatchObject({ muted: true });
    const again = new GameAudio({ createContext: fakeFactory().factory, storage, visibility: null });
    expect(again.muted).toBe(true);
  });
});

describe('App wiring', () => {
  it('enterState on every mount (incl. the initial one), the audio is destroyed with the App', async () => {
    const states: AppState['name'][] = [];
    const destroy = vi.fn();
    const port: AppAudioPort = {
      enterState: (s) => void states.push(s.name),
      hooks: {},
      sound: { muted: () => false, setMuted() {} },
      destroy,
    };
    const noop = () => ({ destroy() {} });
    const host = { replaceChildren() {}, appendChild() {} } as unknown as HTMLElement;
    const app = new App(host, { name: 'title' }, { audio: port, pwa: false, screens: { title: noop, select: noop, build: noop } });
    await app.start();
    await app.dispatch({ type: 'play' });
    await app.dispatch({ type: 'selectLevel', levelId: 'beach' });
    expect(states).toEqual(['title', 'select', 'build']);
    app.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

// ------------------------------------------- tick feed over a real run

describe('RunAudioFeed over a headless run', () => {
  it('ticks every AUDIO_TICK_STEPS steps with monotonic progress and a real cart speed', async () => {
    const course = courseFor('beach')!;
    const s = await RunSession.create(exampleCart(), course);
    try {
      const ticks: RunAudioTick[] = [];
      const feed = new RunAudioFeed({ tick: (t) => void ticks.push(t) }, s.spawn.x, course.level.goal.lineX);
      s.start();
      s.release();
      s.setDrive(1);
      for (let i = 0; i < 60 * 8; i++) {
        s.step();
        feed.step(s.controller.rightmostCartBody()?.x ?? null, s.furthestMetres());
      }
      expect(ticks).toHaveLength((60 * 8) / AUDIO_TICK_STEPS);
      for (let i = 1; i < ticks.length; i++) expect(ticks[i]!.courseProgress).toBeGreaterThanOrEqual(ticks[i - 1]!.courseProgress);
      const last = ticks.at(-1)!;
      expect(last.courseProgress).toBeGreaterThan(0);
      expect(last.courseProgress).toBeLessThanOrEqual(1);
      expect(Math.max(...ticks.map((t) => t.speed))).toBeGreaterThan(0.5);
      expect(ticks[0]!.speed).toBe(0); // no previous sample yet
    } finally {
      s.destroy();
    }
  });

  it('no cart → speed 0, progress holds', () => {
    const ticks: RunAudioTick[] = [];
    const feed = new RunAudioFeed({ tick: (t) => void ticks.push(t) }, 0, 100);
    for (let i = 0; i < AUDIO_TICK_STEPS; i++) feed.step(50, 0);
    for (let i = 0; i < AUDIO_TICK_STEPS; i++) feed.step(null, 0);
    expect(ticks).toEqual([
      { courseProgress: 0.5, endlessMetres: 0, speed: 0 },
      { courseProgress: 0.5, endlessMetres: 0, speed: 0 },
    ]);
  });
});
