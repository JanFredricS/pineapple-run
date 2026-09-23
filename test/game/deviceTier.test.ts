/**
 * S9 bead-count heuristic: a static bucket of reported device capability,
 * chosen once at level load, with a clamped test override.
 */
import { describe, expect, it } from 'vitest';
import { BEAD_COUNT_KEY, BEADS_BY_TIER, beadCountFor, deviceTier, detectDeviceInfo, readPinnedBeadCount, resolveBeadCount, type BeadCountStorage } from '../../src/game/deviceTier';
import { runBeadCount, runSessionOptions } from '../../src/game/runScreen';
import { courseFor } from '../../src/game/courses';
import { BEAD_COUNT_MAX, BEAD_COUNT_MIN } from '../../src/run/beads';

describe('device tier', () => {
  it('buckets by cores and memory; unknown is mid', () => {
    expect(deviceTier({})).toBe('mid');
    expect(deviceTier({ hardwareConcurrency: 2 })).toBe('low');
    expect(deviceTier({ hardwareConcurrency: 8, deviceMemory: 2 })).toBe('low');
    expect(deviceTier({ hardwareConcurrency: 4, deviceMemory: 8 })).toBe('mid');
    expect(deviceTier({ deviceMemory: 8 })).toBe('mid');
    expect(deviceTier({ hardwareConcurrency: 8 })).toBe('high');
    expect(deviceTier({ hardwareConcurrency: 16, deviceMemory: 8 })).toBe('high');
    expect(deviceTier({ hardwareConcurrency: Number.NaN, deviceMemory: 0 })).toBe('mid');
  });

  it('tiers span the 300..600 range; the override is clamped and wins', () => {
    expect(BEADS_BY_TIER).toEqual({ low: BEAD_COUNT_MIN, mid: 450, high: BEAD_COUNT_MAX });
    expect(BEAD_COUNT_MIN).toBe(300);
    expect(BEAD_COUNT_MAX).toBe(600);
    expect(beadCountFor({ hardwareConcurrency: 16 })).toBe(600);
    expect(beadCountFor({ hardwareConcurrency: 16 }, 320)).toBe(320);
    expect(beadCountFor({}, 5)).toBe(BEAD_COUNT_MIN);
    expect(beadCountFor({}, 5000)).toBe(BEAD_COUNT_MAX);
  });

  it('is empty (so mid) outside a browser', () => {
    const info = detectDeviceInfo();
    expect(deviceTier(info)).toMatch(/^(low|mid|high)$/);
  });
});

class Mem implements BeadCountStorage {
  readonly m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
}

const HIGH = { hardwareConcurrency: 16, deviceMemory: 8 };
const LOW = { hardwareConcurrency: 2, deviceMemory: 1 };

describe('bead count pin (audit-1 #1: a reload never re-guesses the count)', () => {
  it('the first load pins the tier count; later loads use it whatever the device now reports', () => {
    const st = new Mem();
    expect(resolveBeadCount({ info: HIGH, storage: st })).toBe(600);
    expect(st.m.get(BEAD_COUNT_KEY)).toBe('600');
    expect(resolveBeadCount({ info: LOW, storage: st })).toBe(600);
    expect(resolveBeadCount({ info: {}, storage: st })).toBe(600);
    // and the other way round
    const st2 = new Mem();
    expect(resolveBeadCount({ info: LOW, storage: st2 })).toBe(300);
    expect(resolveBeadCount({ info: HIGH, storage: st2 })).toBe(300);
  });

  it('an override wins and is never pinned', () => {
    const st = new Mem();
    expect(resolveBeadCount({ override: 333, info: HIGH, storage: st })).toBe(333);
    expect(st.m.size).toBe(0);
    expect(resolveBeadCount({ info: LOW, storage: st })).toBe(300);
  });

  it('invalid, unreadable or unwritable storage falls back to the tier bucket', () => {
    for (const bad of ['', 'abc', '299', '601', '450.5', '-450', '1e3', ' 450']) {
      const st = new Mem();
      st.m.set(BEAD_COUNT_KEY, bad);
      expect(readPinnedBeadCount(st)).toBeNull();
      expect(resolveBeadCount({ info: HIGH, storage: st })).toBe(600);
      expect(st.m.get(BEAD_COUNT_KEY)).toBe('600'); // repaired
    }
    const throwing: BeadCountStorage = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    };
    expect(resolveBeadCount({ info: LOW, storage: throwing })).toBe(300);
    expect(resolveBeadCount({ info: HIGH, storage: null })).toBe(600);
  });

  it('the run screen resolves its count through the pin (deps: override, device, storage)', () => {
    const st = new Mem();
    expect(runBeadCount({ deviceInfo: HIGH, beadStorage: st })).toBe(600);
    expect(runBeadCount({ deviceInfo: LOW, beadStorage: st })).toBe(600);
    expect(runBeadCount({ deviceInfo: LOW, beadStorage: null })).toBe(300);
    expect(runBeadCount({ beadCount: 480, deviceInfo: LOW, beadStorage: st })).toBe(480);
  });
});

describe('run screen wiring', () => {
  it('builds its one session with runSessionOptions(course.level, deps) (no other bead-count source)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/game/runScreen.ts', import.meta.url), 'utf8');
    expect(src).toContain('RunSession.create(design, course, runSessionOptions(course.level, deps))');
    expect(src.match(/RunSession\.create\(/g)).toHaveLength(1);
    // the resolver is reached only through runSessionOptions' bead-zone branch
    expect(src.match(/runBeadCount\(deps\)/g)).toHaveLength(1);
    expect(src).toContain("level.zones.some((z) => z.kind === 'beads') ? { beadCount: runBeadCount(deps) } : {}");
  });

  it('audit-2: only a bead level resolves (and pins) the count; non-bead courses touch no bead state', () => {
    const st = new Mem();
    for (const id of ['beach', 'kitchen', 'workbench', 'original'] as const) {
      expect(runSessionOptions(courseFor(id)!.level, { deviceInfo: LOW, beadStorage: st })).toEqual({});
    }
    expect(runSessionOptions(courseFor('endless:ABC')!.level, { deviceInfo: LOW, beadStorage: st })).toEqual({});
    expect(st.m.size).toBe(0);
    expect(runSessionOptions(courseFor('tikibar')!.level, { deviceInfo: LOW, beadStorage: st })).toEqual({ beadCount: 300 });
    expect(st.m.get(BEAD_COUNT_KEY)).toBe('300');
  });

  it("audit-2 scenario: Beach on a 300-tier report, then the device reports the 600 tier, then the first Tiki Bar run gets 600", () => {
    const st = new Mem();
    expect(runSessionOptions(courseFor('beach')!.level, { deviceInfo: LOW, beadStorage: st })).toEqual({});
    expect(st.m.has(BEAD_COUNT_KEY)).toBe(false); // Beach pinned nothing
    expect(runSessionOptions(courseFor('tikibar')!.level, { deviceInfo: HIGH, beadStorage: st })).toEqual({ beadCount: 600 });
    expect(st.m.get(BEAD_COUNT_KEY)).toBe('600');
    // and from now on the pin holds
    expect(runSessionOptions(courseFor('tikibar')!.level, { deviceInfo: LOW, beadStorage: st })).toEqual({ beadCount: 600 });
  });
});
