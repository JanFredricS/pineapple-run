/**
 * Bead-ocean size by device capability (S9). The bead count of a level with
 * a bead zone is chosen ONCE, at level load, from a static bucket of the
 * device's reported capability — never adjusted mid-run (no frame-time
 * feedback): the run's physics must not depend on how fast the device
 * happened to be at that moment. The bead ocean keeps its extent and mass for
 * any count (src/run/beads.ts), so tiers play alike.
 *
 *   low  (<= 2 cores or <= 2 GB reported): BEADS_BY_TIER.low
 *   mid  (<= 4 cores, or nothing reported): BEADS_BY_TIER.mid
 *   high (more):                            BEADS_BY_TIER.high
 *
 * Test override: RunScreenDeps.beadCount (run screen) or
 * RunSessionOptions.beadCount (headless). There is deliberately no URL
 * parameter (the run screen reads no query string; test/game/runScreen).
 */

import { BEAD_COUNT_MAX, BEAD_COUNT_MIN, clampBeadCount } from '../run/beads';

export type DeviceTier = 'low' | 'mid' | 'high';

export const BEADS_BY_TIER: Readonly<Record<DeviceTier, number>> = { low: BEAD_COUNT_MIN, mid: 450, high: BEAD_COUNT_MAX };

/** What the browser reports (navigator.hardwareConcurrency / deviceMemory); either may be missing. */
export interface DeviceInfo {
  hardwareConcurrency?: number;
  deviceMemory?: number;
}

const known = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function deviceTier(info: DeviceInfo): DeviceTier {
  const cores = info.hardwareConcurrency;
  const mem = info.deviceMemory;
  if ((known(cores) && cores <= 2) || (known(mem) && mem <= 2)) return 'low';
  if (!known(cores) || cores <= 4) return 'mid';
  return 'high';
}

/** Bead count for this device: the test override (clamped) if given, else the tier's bucket. */
export function beadCountFor(info: DeviceInfo, override?: number): number {
  return override !== undefined ? clampBeadCount(override) : BEADS_BY_TIER[deviceTier(info)];
}

/** The running browser's DeviceInfo (empty outside a browser). */
export function detectDeviceInfo(): DeviceInfo {
  if (typeof navigator === 'undefined') return {};
  const nav = navigator as Navigator & { deviceMemory?: number };
  return { hardwareConcurrency: nav.hardwareConcurrency, deviceMemory: nav.deviceMemory };
}
