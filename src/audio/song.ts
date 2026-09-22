/**
 * Procedural loop composition — pure data, no Web Audio.
 *
 * Every theme is an 8-bar, 16th-note-grid loop at the shared BPM, built from a
 * hand-written ThemeSpec (key, chord progression, instruments, groove
 * patterns) plus a seeded generator (melody motif, arpeggio mask, ghost
 * notes). Same (theme, seed) → identical Song, event for event.
 *
 * Layers (the stems the stage cross-fade ramps between):
 *   0 base    — bass + chords (always on)
 *   1 groove  — percussion
 *   2 melody  — lead motif (A A' B A-cadence phrase form)
 *   3 sparkle — high arpeggio / counter line
 */

import { BARS_PER_LOOP, degreeToMidi, LOOP_STEPS, SCALES, STEPS_PER_BAR, triadDegrees, type ScaleName } from './dsp';
import { hashString, mulberry32 } from './rng';
import type { VoiceId } from './voices';

export type MusicTheme = 'title' | 'beach' | 'kitchen' | 'workbench' | 'endless';
export const MUSIC_THEMES: readonly MusicTheme[] = ['title', 'beach', 'kitchen', 'workbench', 'endless'];

export type LayerIndex = 0 | 1 | 2 | 3;

export interface NoteEvent {
  /** Step within the loop, 0..LOOP_STEPS-1. */
  step: number;
  layer: LayerIndex;
  voice: VoiceId;
  midi: number;
  /** Length in steps. */
  length: number;
  /** 0..1 */
  velocity: number;
}

export interface PercHit {
  voice: VoiceId;
  midi: number;
  /** Steps within a bar (0..15). */
  steps: readonly number[];
  velocity: number;
}

export interface ThemeSpec {
  /** Tonic MIDI note (around middle C). */
  root: number;
  scale: ScaleName;
  /** Chord root scale degree for each 2-bar phrase (4 phrases = 8 bars). */
  progression: readonly [number, number, number, number];
  bassVoice: VoiceId;
  /** Bass hits within a bar: [step, chord-tone index (0 root, 1 third, 2 fifth, 3 octave), length]. */
  bassPattern: ReadonlyArray<readonly [number, number, number]>;
  chordVoice: VoiceId;
  /** Chord hits within a bar: [step, length]. */
  chordPattern: ReadonlyArray<readonly [number, number]>;
  chordVelocity: number;
  perc: readonly PercHit[];
  /** Probability of a quiet ghost hit of perc[0] on empty 8ths. */
  ghostChance: number;
  leadVoice: VoiceId;
  /** Octave offset of the lead relative to root. */
  leadOctave: number;
  /** Chance an 8th-note slot of the motif carries a note. */
  leadDensity: number;
  counterVoice: VoiceId;
  counterOctave: number;
  /** 16th steps between arpeggio notes (2 = 8ths, 4 = quarters). */
  counterEvery: number;
}

const beat = (...steps: number[]) => steps;

export const THEME_SPECS: Readonly<Record<MusicTheme, ThemeSpec>> = {
  // Gentle ukulele strum + marimba lead, sparse — the menu should never tire.
  title: {
    root: 60,
    scale: 'major',
    progression: [0, 5, 3, 4],
    bassVoice: 'bass',
    bassPattern: [
      [0, 0, 5],
      [8, 2, 4],
    ],
    chordVoice: 'uke',
    chordPattern: [
      [0, 3],
      [6, 2],
      [10, 2],
    ],
    chordVelocity: 0.55,
    perc: [{ voice: 'shaker', midi: 0, steps: beat(4, 12), velocity: 0.45 }],
    ghostChance: 0.2,
    leadVoice: 'pluck',
    leadOctave: 1,
    leadDensity: 0.4,
    counterVoice: 'bell',
    counterOctave: 1,
    counterEvery: 4,
  },
  // Marimba-ish plucks + soft shaker; lazy reggae-ish bass.
  beach: {
    root: 62,
    scale: 'major',
    progression: [0, 3, 4, 0],
    bassVoice: 'bass',
    bassPattern: [
      [0, 0, 3],
      [6, 2, 2],
      [8, 3, 3],
      [14, 2, 2],
    ],
    chordVoice: 'pad',
    chordPattern: [[0, 16]],
    chordVelocity: 0.8,
    perc: [
      { voice: 'shaker', midi: 0, steps: beat(2, 6, 10, 14), velocity: 0.6 },
      { voice: 'shaker', midi: 0, steps: beat(0, 4, 8, 12), velocity: 0.3 },
      { voice: 'kick', midi: 0, steps: beat(0, 10), velocity: 0.45 },
    ],
    ghostChance: 0.25,
    leadVoice: 'pluck',
    leadOctave: 1,
    leadDensity: 0.55,
    counterVoice: 'pluck',
    counterOctave: 1,
    counterEvery: 2,
  },
  // Bouncy square-wave stabs on the off-beats, oom-pah bass, woodblocks.
  kitchen: {
    root: 60,
    scale: 'mixolydian',
    progression: [0, 3, 0, 4],
    bassVoice: 'bass',
    bassPattern: [
      [0, 0, 2],
      [4, 2, 2],
      [8, 0, 2],
      [12, 2, 2],
    ],
    chordVoice: 'square',
    chordPattern: [
      [2, 1],
      [6, 1],
      [10, 1],
      [14, 1],
    ],
    chordVelocity: 0.6,
    perc: [
      { voice: 'block', midi: 84, steps: beat(4, 12), velocity: 0.55 },
      { voice: 'block', midi: 79, steps: beat(7, 15), velocity: 0.35 },
      { voice: 'kick', midi: 0, steps: beat(0, 8), velocity: 0.45 },
    ],
    ghostChance: 0.15,
    leadVoice: 'square',
    leadOctave: 1,
    leadDensity: 0.6,
    counterVoice: 'bell',
    counterOctave: 1,
    counterEvery: 4,
  },
  // Muted-saw riff, hats and a metallic clank — workshop groove, bVII chord.
  workbench: {
    root: 55,
    scale: 'mixolydian',
    progression: [0, 6, 3, 0],
    bassVoice: 'bass',
    bassPattern: [
      [0, 0, 2],
      [3, 0, 1],
      [6, 0, 2],
      [10, 2, 2],
      [12, 3, 2],
    ],
    chordVoice: 'mutedSaw',
    chordPattern: [
      [0, 2],
      [3, 1],
      [6, 2],
      [8, 1],
      [11, 2],
      [14, 1],
    ],
    chordVelocity: 0.6,
    perc: [
      { voice: 'hat', midi: 0, steps: beat(0, 2, 4, 6, 8, 10, 12, 14), velocity: 0.5 },
      { voice: 'clank', midi: 76, steps: beat(4, 12), velocity: 0.6 },
      { voice: 'kick', midi: 0, steps: beat(0, 6, 8), velocity: 0.45 },
    ],
    ghostChance: 0.2,
    leadVoice: 'uke',
    leadOctave: 1,
    leadDensity: 0.5,
    counterVoice: 'clank',
    counterOctave: 1,
    counterEvery: 4,
  },
  // Steel-drum lead over a pad, a bit more driving for the long haul.
  endless: {
    root: 65,
    scale: 'major',
    progression: [0, 4, 5, 3],
    bassVoice: 'bass',
    bassPattern: [
      [0, 0, 3],
      [3, 0, 1],
      [8, 2, 3],
      [11, 3, 1],
      [14, 2, 2],
    ],
    chordVoice: 'pad',
    chordPattern: [[0, 16]],
    chordVelocity: 0.7,
    perc: [
      { voice: 'shaker', midi: 0, steps: beat(2, 6, 10, 14), velocity: 0.55 },
      { voice: 'kick', midi: 0, steps: beat(0, 8), velocity: 0.5 },
      { voice: 'block', midi: 81, steps: beat(3, 11), velocity: 0.35 },
    ],
    ghostChance: 0.3,
    leadVoice: 'steel',
    leadOctave: 0,
    leadDensity: 0.55,
    counterVoice: 'pluck',
    counterOctave: 1,
    counterEvery: 2,
  },
};

export interface Song {
  theme: MusicTheme;
  seed: number;
  loopSteps: number;
  /** Sorted by step, then layer. */
  events: readonly NoteEvent[];
  /** events bucketed by step (length loopSteps). */
  byStep: ReadonlyArray<readonly NoteEvent[]>;
}

/** Motif relative to the phrase chord root, in scale degrees; null = rest. 16 slots (8ths over 2 bars). */
type Motif = Array<{ degree: number; length: number } | null>;

function makeMotif(rng: () => number, density: number): Motif {
  const slots = 16;
  const motif: Motif = new Array<{ degree: number; length: number } | null>(slots).fill(null);
  const chordTones = [0, 2, 4, 7];
  let deg = chordTones[Math.floor(rng() * 3)]!;
  for (let i = 0; i < slots; i++) {
    const strong = i % 4 === 0;
    const play = i === 0 || rng() < (strong ? Math.min(1, density + 0.3) : density);
    if (!play) continue;
    if (strong) {
      // Strong beats land on a chord tone near the current pitch.
      let best = chordTones[0]!;
      for (const c of chordTones) if (Math.abs(c - deg) < Math.abs(best - deg)) best = c;
      deg = best;
    } else {
      const stepBy = [-2, -1, -1, 1, 1, 2][Math.floor(rng() * 6)]!;
      deg = Math.max(-2, Math.min(7, deg + stepBy));
    }
    motif[i] = { degree: deg, length: 1 };
  }
  // Extend notes over following rests (up to a quarter) for a legato feel.
  for (let i = 0; i < slots; i++) {
    const m = motif[i];
    if (!m) continue;
    let len = 1;
    while (len < 2 && i + len < slots && motif[i + len] === null) len++;
    m.length = len;
  }
  return motif;
}

/** Deterministic loop for (theme, seed). */
export function composeSong(theme: MusicTheme, seed: number): Song {
  const spec = THEME_SPECS[theme];
  const rng = mulberry32((seed ^ hashString(theme)) >>> 0);
  const scale = SCALES[spec.scale];
  const note = (degree: number, octave: number) => degreeToMidi(spec.root + octave * 12, scale, degree);
  const events: NoteEvent[] = [];
  const humanize = (v: number) => Math.max(0.05, Math.min(1, v * (0.9 + rng() * 0.2)));

  const motifA = makeMotif(rng, spec.leadDensity);
  const motifB = makeMotif(rng, spec.leadDensity);
  // Arpeggio mask: which counter slots in a bar play (seeded, same every bar).
  const counterSlots = STEPS_PER_BAR / spec.counterEvery;
  const counterMask: boolean[] = [];
  for (let i = 0; i < counterSlots; i++) counterMask.push(i === 0 || rng() < 0.7);
  // Ghost hits: per bar-in-loop, on empty 8ths.
  const percSteps = new Set(spec.perc.flatMap((p) => [...p.steps]));

  for (let bar = 0; bar < BARS_PER_LOOP; bar++) {
    const phrase = Math.floor(bar / 2);
    const chordRoot = spec.progression[phrase]!;
    const triad = triadDegrees(chordRoot);
    const barStart = bar * STEPS_PER_BAR;
    const lastBar = bar === BARS_PER_LOOP - 1;

    // Layer 0: bass + chords.
    for (const [s, tone, len] of spec.bassPattern) {
      const deg = tone === 3 ? chordRoot + scale.length : triad[tone]!;
      events.push({ step: barStart + s, layer: 0, voice: spec.bassVoice, midi: note(deg, -2), length: len, velocity: humanize(s === 0 ? 0.9 : 0.7) });
    }
    for (const [s, len] of spec.chordPattern) {
      for (const deg of triad) {
        events.push({ step: barStart + s, layer: 0, voice: spec.chordVoice, midi: note(deg, 0), length: len, velocity: humanize(spec.chordVelocity) });
      }
    }

    // Layer 1: groove.
    for (const hit of spec.perc) {
      for (const s of hit.steps) {
        events.push({ step: barStart + s, layer: 1, voice: hit.voice, midi: hit.midi, length: 1, velocity: humanize(hit.velocity) });
      }
    }
    const ghost = spec.perc[0];
    if (ghost) {
      for (let s = 0; s < STEPS_PER_BAR; s += 2) {
        if (!percSteps.has(s) && rng() < spec.ghostChance) {
          events.push({ step: barStart + s, layer: 1, voice: ghost.voice, midi: ghost.midi, length: 1, velocity: humanize(ghost.velocity * 0.45) });
        }
      }
    }

    // Layer 2: melody, phrase form A A' B A(cadence).
    const motif = phrase === 2 ? motifB : motifA;
    const half = bar % 2; // which bar of the 2-bar motif
    // The loop's last half-bar is a cadence: land on the chord root and hold.
    const slots = lastBar ? 4 : 8;
    for (let slot = 0; slot < slots; slot++) {
      const m = motif[half * 8 + slot];
      if (!m) continue;
      const length = Math.min(m.length, slots - slot) * 2;
      events.push({ step: barStart + slot * 2, layer: 2, voice: spec.leadVoice, midi: note(chordRoot + m.degree, spec.leadOctave), length, velocity: humanize(slot % 2 === 0 ? 0.8 : 0.62) });
    }
    if (lastBar) {
      events.push({ step: barStart + 8, layer: 2, voice: spec.leadVoice, midi: note(chordRoot + 7, spec.leadOctave), length: 8, velocity: humanize(0.75) });
    }

    // Layer 3: sparkle arpeggio over chord tones.
    for (let i = 0; i < counterSlots; i++) {
      if (!counterMask[i]) continue;
      const deg = triad[i % 3]! + (i % 6 >= 3 ? scale.length : 0);
      events.push({ step: barStart + i * spec.counterEvery, layer: 3, voice: spec.counterVoice, midi: note(deg, spec.counterOctave), length: spec.counterEvery, velocity: humanize(i === 0 ? 0.6 : 0.42) });
    }
  }

  events.sort((a, b) => a.step - b.step || a.layer - b.layer);
  const byStep: NoteEvent[][] = Array.from({ length: LOOP_STEPS }, () => []);
  for (const e of events) byStep[e.step]!.push(e);
  return { theme, seed, loopSteps: LOOP_STEPS, events, byStep };
}
