import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BLENDER_WHIR_SECONDS, GameAudio, musicThemeForCourse, stageForEndlessDistance } from '../../src/audio';
import { audioViolations, scanImports, stripComments } from './importScan';
import { FakeStorage, FakeTarget, FakeTimers, fakeFactory, flush, quotaError, type FakeOscillator } from './fakeAudio';

function make() {
  const { factory, created } = fakeFactory();
  const timers = new FakeTimers();
  const doc = new FakeTarget();
  const storage = new FakeStorage();
  const audio = new GameAudio({ createContext: factory, storage, visibility: doc, timers, musicSeed: 1, random: () => 0.5 });
  return { audio, created, timers, doc, storage };
}

async function unlocked() {
  const m = make();
  const el = new FakeTarget();
  m.audio.init(el);
  el.dispatch('pointerdown');
  await flush();
  return { ...m, el, ctx: m.created[0]! };
}

describe('GameAudio facade', () => {
  it('construction and init are lazy (no context until a gesture or play)', () => {
    const { audio, created } = make();
    audio.init(new FakeTarget());
    expect(created).toHaveLength(0);
    expect(audio.unlocked).toBe(false);
  });

  it('unlocks on the first gesture', async () => {
    const { audio, el } = await unlocked();
    expect(audio.unlocked).toBe(true);
    expect(el.count()).toBe(0);
  });

  it('maps run events to sounds', async () => {
    const { audio, ctx, timers } = await unlocked();
    audio.music.play('beach', 2);
    audio.onRunEvent({ type: 'started', simTime: 0 });
    expect(audio.sfx.wheelMotor.running).toBe(true);
    expect(audio.music.stage).toBe(0);
    const before = ctx.nodes.length;
    audio.onRunEvent({ type: 'released', simTime: 0 });
    expect(ctx.nodes.length).toBeGreaterThan(before); // clatter
    audio.onRunEvent({ type: 'pineappleLost', simTime: 3, pineappleId: 1, remaining: 14 });
    audio.onRunEvent({ type: 'goalReached', simTime: 30, delivered: 12 });
    expect(audio.sfx.wheelMotor.running).toBe(false);
    expect(audio.sfx.blenderWhir.running).toBe(true);
    expect(audio.sfx.throttle.active('goalSting', ctx.currentTime)).toBe(1);
    timers.advance(BLENDER_WHIR_SECONDS * 1000);
    expect(audio.sfx.blenderWhir.running).toBe(false);

    ctx.currentTime = 10;
    audio.onRunEvent({ type: 'started', simTime: 0 });
    audio.onRunEvent({ type: 'gaveUp', simTime: 4 });
    expect(audio.sfx.wheelMotor.running).toBe(false);
    expect(audio.sfx.throttle.active('loseSting', ctx.currentTime)).toBe(1);
    ctx.currentTime = 20;
    audio.onRunEvent({ type: 'allLost', simTime: 9 });
    expect(audio.sfx.throttle.active('loseSting', ctx.currentTime)).toBe(1);
  });

  it('course progress and endless distance drive the stage', async () => {
    const { audio } = await unlocked();
    audio.music.play('kitchen', 0);
    audio.setCourseProgress(0.3);
    expect(audio.music.stage).toBe(1);
    audio.setCourseProgress(0.8);
    expect(audio.music.stage).toBe(3);
    audio.setEndlessDistance(10);
    expect(audio.music.stage).toBe(0);
    expect([0, 149, 150, 300, 449, 450, 1e6, Number.NaN, -5].map(stageForEndlessDistance)).toEqual([0, 0, 1, 2, 2, 3, 3, 0, 0]);
  });

  it('course id → theme', () => {
    expect(musicThemeForCourse('beach')).toBe('beach');
    expect(musicThemeForCourse('kitchen')).toBe('kitchen');
    expect(musicThemeForCourse('workbench')).toBe('workbench');
    expect(musicThemeForCourse('original')).toBe('workbench');
    expect(musicThemeForCourse('endless:ABC')).toBe('endless');
    expect(musicThemeForCourse('mystery')).toBe('beach');
  });

  it('mute persistence reports honestly through the facade', () => {
    const { audio, storage } = make();
    expect(audio.setMuted(true)).toBe(true);
    expect(audio.muted).toBe(true);
    storage.throwOnSet = quotaError();
    expect(audio.setMuted(false)).toBe(false);
    expect(audio.muted).toBe(false);
    expect(audio.setSfxVolume(0.1)).toBe(false);
    expect(audio.settings.sfx).toBe(0.1);
  });

  it('destroy is a complete teardown', async () => {
    const { audio, ctx, timers, doc } = await unlocked();
    const el2 = new FakeTarget();
    audio.music.play('endless', 3);
    for (let i = 0; i < 40; i++) {
      ctx.currentTime += 0.025;
      timers.fireIntervals();
    }
    audio.music.play('title'); // one session retiring
    audio.onRunEvent({ type: 'started', simTime: 0 });
    audio.onRunEvent({ type: 'goalReached', simTime: 5, delivered: 3 }); // blender timer pending
    audio.sfx.wheelMotor.start(1);
    audio.sfx.wheelMotor.stop(); // release pending
    expect(timers.pending).toBeGreaterThan(0);
    await audio.destroy();
    expect(timers.pending).toBe(0);
    expect(doc.count()).toBe(0);
    expect(ctx.state).toBe('closed');
    expect(ctx.closeCalls).toBe(1);
    for (const o of ctx.ofKind<FakeOscillator>('oscillator')) expect(o.stoppedAt).not.toBeNull();
    // Everything is inert afterwards.
    audio.init(el2);
    expect(el2.count()).toBe(0);
    audio.music.play('beach');
    expect(audio.music.theme).toBeNull();
    expect(audio.sfx.uiClick()).toBe(false);
    audio.onRunEvent({ type: 'gaveUp', simTime: 1 });
    await audio.destroy();
    expect(ctx.closeCalls).toBe(1);
  });
});

describe('audio architecture', () => {
  const dir = join(__dirname, '..', '..', 'src', 'audio');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));

  it('src/audio depends only on itself and (type-only) src/model', () => {
    const bad = files.flatMap((f) => audioViolations(readFileSync(join(dir, f), 'utf8'), f));
    expect(bad).toEqual([]);
    // Sanity: the scan does see the real type-only model import.
    const index = stripComments(readFileSync(join(dir, 'index.ts'), 'utf8'));
    expect(scanImports(index)).toContainEqual({ spec: '../model/runEvents', typeOnly: true, form: 'static' });
  });

  it('scanner: every import form is found; only type-only ../model is exempt', () => {
    const sample = [
      "import '../run/x';",
      "const m = await import('../ui/y');",
      "export * from '../render/z';",
      "import { a } from './ok';",
      "const r = require('../builder/w');",
      "import type { RunEvent } from '../model/runEvents';",
      "export type { Ev } from '../model/types';",
      "import { RunEventEmitter } from '../model/runEvents';",
      "export { score } from '../model/score';",
      "import '../model/side';",
      "const lazy = () => import('../model/lazy');",
      "const req = require('../model/req');",
    ].join('\n');
    expect(audioViolations(sample, 's').sort()).toEqual(
      [
        's -> ../builder/w (require)',
        's -> ../model/lazy (dynamic)',
        's -> ../model/req (require)',
        's -> ../model/runEvents (static)',
        's -> ../model/score (static)',
        's -> ../model/side (side-effect)',
        's -> ../render/z (static)',
        's -> ../run/x (side-effect)',
        's -> ../ui/y (dynamic)',
        's mentions ../builder',
        's mentions ../render',
        's mentions ../run',
        's mentions ../ui',
      ].sort(),
    );
  });

  it('scanner: comment markers inside literals do not hide code', () => {
    expect(audioViolations(`const marker = 'x//y'; require('../run/bootstrap');`)).toContain('src -> ../run/bootstrap (require)');
    expect(audioViolations(`const m = "a/*b"; import('../ui/q'); const z = "*/";`)).toContain('src -> ../ui/q (dynamic)');
    expect(audioViolations('const t = `//${1}`; require("../render/r");')).toContain('src -> ../render/r (require)');
    // Genuine comments are ignored.
    expect(audioViolations(`// import '../run/x'\n/* require('../ui/y') */\nconst ok = 1; // ../render`)).toEqual([]);
  });
});

describe('stripComments', () => {
  it('keeps comment markers inside strings and removes trailing comments', () => {
    expect(stripComments(`const a = 'x//y'; b(); // tail`)).toBe(`const a = 'x//y'; b(); `);
    expect(stripComments(`const a = "/* no */"; c();`)).toBe(`const a = "/* no */"; c();`);
    expect(stripComments(`const a = 'it\\'s // not'; d();`)).toBe(`const a = 'it\\'s // not'; d();`);
  });

  it('replaces block comments with spaces, keeping newlines', () => {
    const src = `a();/* one\ntwo */b();`;
    const out = stripComments(src);
    expect(out).toBe(`a();      \n      b();`);
    expect(out.length).toBe(src.length);
  });

  it('handles templates with nested expressions, templates and braces', () => {
    const src = "const s = `a ${ `b ${'//'} c` } d ${ {k: '/*'}.k } e //`; f(); // gone";
    expect(stripComments(src)).toBe("const s = `a ${ `b ${'//'} c` } d ${ {k: '/*'}.k } e //`; f(); ");
    const multi = 'x = `${ fn({ a: { b: 1 } }) } // still template`; /* c */ y();';
    expect(stripComments(multi)).toBe('x = `${ fn({ a: { b: 1 } }) } // still template`;         y();');
  });

  it('copies regex literals verbatim (quotes / slashes inside do not open strings or comments)', () => {
    const src = `const r = /['"]\\/\\/[/*]/g; require('../run/x'); // c`;
    expect(stripComments(src)).toBe(`const r = /['"]\\/\\/[/*]/g; require('../run/x'); `);
    expect(stripComments(`if (ok) return /a"b/.test(s); // c`)).toBe(`if (ok) return /a"b/.test(s); `);
    // Division is not a regex.
    expect(stripComments(`const q = a / b; const w = 'x'; // c`)).toBe(`const q = a / b; const w = 'x'; `);
  });
});

describe('audio architecture (misc)', () => {
  const dir = join(__dirname, '..', '..', 'src', 'audio');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));

  it('loads nothing external (all audio is synthesized)', () => {
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(text).not.toMatch(/fetch\(|decodeAudioData|new Audio\(|\.mp3|\.ogg|\.wav/);
    }
  });
});
