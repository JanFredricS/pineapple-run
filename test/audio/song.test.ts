import { describe, expect, it } from 'vitest';
import { BARS_PER_LOOP, LOOP_STEPS, SCALES, STEPS_PER_BAR } from '../../src/audio/dsp';
import { composeSong, MUSIC_THEMES, THEME_SPECS } from '../../src/audio/song';
import { VOICE_IDS } from '../../src/audio/voices';

describe('composeSong', () => {
  it('is deterministic per (theme, seed)', () => {
    for (const theme of MUSIC_THEMES) {
      expect(composeSong(theme, 1234)).toEqual(composeSong(theme, 1234));
    }
  });

  it('different seeds give different melodies; different themes differ with the same seed', () => {
    const lead = (seed: number) =>
      composeSong('beach', seed)
        .events.filter((e) => e.layer === 2)
        .map((e) => `${e.step}:${e.midi}`)
        .join(',');
    const variants = new Set([1, 2, 3, 4, 5].map(lead));
    expect(variants.size).toBeGreaterThan(1);
    expect(composeSong('kitchen', 7).events).not.toEqual(composeSong('workbench', 7).events);
  });

  it('every theme is an 8-bar loop with all 4 layers populated and sane events', () => {
    for (const theme of MUSIC_THEMES) {
      const song = composeSong(theme, 99);
      expect(song.loopSteps).toBe(LOOP_STEPS);
      expect(song.byStep).toHaveLength(LOOP_STEPS);
      for (const layer of [0, 1, 2, 3] as const) expect(song.events.some((e) => e.layer === layer)).toBe(true);
      for (const e of song.events) {
        expect(Number.isInteger(e.step) && e.step >= 0 && e.step < LOOP_STEPS).toBe(true);
        expect(e.length).toBeGreaterThan(0);
        expect(e.velocity).toBeGreaterThan(0);
        expect(e.velocity).toBeLessThanOrEqual(1);
        expect(VOICE_IDS).toContain(e.voice);
      }
      // byStep is exactly the events, bucketed.
      expect(song.byStep.flat()).toEqual(song.events);
      song.byStep.forEach((bucket, step) => bucket.forEach((e) => expect(e.step).toBe(step)));
      // Base layer (bass) plays on every bar's downbeat: the loop never goes empty.
      for (let bar = 0; bar < BARS_PER_LOOP; bar++) {
        expect(song.byStep[bar * STEPS_PER_BAR]!.some((e) => e.layer === 0)).toBe(true);
      }
    }
  });

  it('pitched layers stay in the key (no wrong notes)', () => {
    for (const theme of MUSIC_THEMES) {
      const spec = THEME_SPECS[theme];
      const pcs = new Set(SCALES[spec.scale].map((s) => (spec.root + s) % 12));
      const song = composeSong(theme, 5);
      for (const e of song.events.filter((x) => x.layer !== 1)) {
        expect(pcs.has(((e.midi % 12) + 12) % 12)).toBe(true);
      }
      // Registers: bass low, lead/sparkle above it.
      const bass = song.events.filter((e) => e.layer === 0 && e.voice === spec.bassVoice);
      expect(Math.max(...bass.map((e) => e.midi))).toBeLessThan(65);
      expect(Math.min(...bass.map((e) => e.midi))).toBeGreaterThanOrEqual(31);
      const lead = song.events.filter((e) => e.layer === 2);
      expect(Math.min(...lead.map((e) => e.midi))).toBeGreaterThanOrEqual(48);
      expect(Math.max(...lead.map((e) => e.midi))).toBeLessThanOrEqual(96);
    }
  });

  it('the loop ends on a held cadence note on the last chord root, and notes never ring past the loop', () => {
    for (const theme of MUSIC_THEMES) {
      const spec = THEME_SPECS[theme];
      const song = composeSong(theme, 3);
      const lastBar = (BARS_PER_LOOP - 1) * STEPS_PER_BAR;
      const cadence = song.events.filter((e) => e.layer === 2 && e.step >= lastBar + 8);
      expect(cadence).toHaveLength(1);
      expect(cadence[0]!.step).toBe(lastBar + 8);
      expect(cadence[0]!.length).toBe(8);
      const rootPc = (spec.root + SCALES[spec.scale][spec.progression[3] % SCALES[spec.scale].length]!) % 12;
      expect(cadence[0]!.midi % 12).toBe(rootPc);
      for (const e of song.events.filter((x) => x.layer === 2)) expect(e.step + e.length).toBeLessThanOrEqual(LOOP_STEPS);
    }
  });

  it('themes have distinct instrumentation', () => {
    const sig = MUSIC_THEMES.map((t) => {
      const s = THEME_SPECS[t];
      return `${s.chordVoice}/${s.leadVoice}/${s.perc.map((p) => p.voice).join('+')}`;
    });
    expect(new Set(sig).size).toBe(MUSIC_THEMES.length);
    expect(THEME_SPECS.beach.leadVoice).toBe('pluck');
    expect(THEME_SPECS.beach.perc.some((p) => p.voice === 'shaker')).toBe(true);
    expect(THEME_SPECS.kitchen.chordVoice).toBe('square');
    expect(THEME_SPECS.workbench.chordVoice).toBe('mutedSaw');
  });
});
