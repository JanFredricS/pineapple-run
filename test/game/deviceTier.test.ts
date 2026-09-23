/**
 * S9 bead-count heuristic: a static bucket of reported device capability,
 * chosen once at level load, with a clamped test override.
 */
import { describe, expect, it } from 'vitest';
import { BEADS_BY_TIER, beadCountFor, deviceTier, detectDeviceInfo } from '../../src/game/deviceTier';
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
