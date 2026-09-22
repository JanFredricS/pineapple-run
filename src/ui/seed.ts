/**
 * Endless-mode seed entry: validation + normalisation. Pure.
 *
 * Seeds are short case-insensitive tokens (normalised to upper case) so a
 * seed read aloud or typed on a phone reproduces the same course, and so it
 * always fits the ScoreBook's per-seed id limit.
 */

export const SEED_MAX_LENGTH = 16;
const SEED_RE = /^[A-Z0-9_-]+$/;
/** Unambiguous alphabet for generated seeds (no 0/O, 1/I/L). */
const SEED_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export type SeedResult = { ok: true; seed: string } | { ok: false; message: string };

export function validateSeed(input: unknown): SeedResult {
  if (typeof input !== 'string') return { ok: false, message: 'Enter a seed' };
  const seed = input.trim().toUpperCase();
  if (seed.length === 0) return { ok: false, message: 'Enter a seed' };
  if (seed.length > SEED_MAX_LENGTH) return { ok: false, message: `Seed is at most ${SEED_MAX_LENGTH} characters` };
  if (!SEED_RE.test(seed)) return { ok: false, message: 'Use letters, digits, - or _' };
  return { ok: true, seed };
}

/** A fresh 6-character seed. `rand` returns [0, 1) (injectable for tests). */
export function randomSeed(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 6; i++) {
    const r = rand();
    const idx = Math.min(SEED_ALPHABET.length - 1, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * SEED_ALPHABET.length)));
    s += SEED_ALPHABET[idx];
  }
  return s;
}
