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
 * Pinned per device (S9 audit-1 #1): the first bead level this browser loads
 * stores its tier count (localStorage, BEAD_COUNT_KEY) and every later load —
 * a retry, a page reload, a reload after the browser starts reporting
 * different cores / memory — uses the STORED count, never a fresh guess. A
 * run and its reload therefore always build the same bead ocean. (Nothing
 * else about a run crosses devices: saved carts are designs, scores are
 * local, and there is no run/replay save format; a different device plays
 * at its own pinned count.) Unreadable or invalid storage falls back to the
 * tier bucket; unwritable storage just skips pinning.
 *
 * Test override: RunScreenDeps.beadCount (run screen) or
 * RunSessionOptions.beadCount (headless); an override is never pinned.
 * There is deliberately no URL parameter (the run screen reads no query
 * string; test/game/runScreen).
 */

import { BEAD_COUNT_MAX, BEAD_COUNT_MIN, clampBeadCount } from '../run/beads';

/** localStorage key of this device's pinned bead count. */
export const BEAD_COUNT_KEY = 'pineapple-run.beadCount.v1';

/** The localStorage subset the pin needs. */
export interface BeadCountStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

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

/** A stored count, if it is a valid one (an integer in BEAD_COUNT_MIN..BEAD_COUNT_MAX). */
export function readPinnedBeadCount(storage: BeadCountStorage | null): number | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(BEAD_COUNT_KEY);
  } catch {
    return null;
  }
  if (raw === null || !/^\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= BEAD_COUNT_MIN && n <= BEAD_COUNT_MAX ? n : null;
}

/**
 * The bead count for a run: the override if given (never pinned); else this
 * device's pinned count; else the tier bucket of `info`, which is pinned for
 * every later load.
 */
export function resolveBeadCount(opts: { override?: number; info: DeviceInfo; storage: BeadCountStorage | null }): number {
  if (opts.override !== undefined) return clampBeadCount(opts.override);
  const pinned = readPinnedBeadCount(opts.storage);
  if (pinned !== null) return pinned;
  const n = BEADS_BY_TIER[deviceTier(opts.info)];
  try {
    opts.storage?.setItem(BEAD_COUNT_KEY, String(n));
  } catch {
    // unwritable (private mode, quota): this load still uses the tier count
  }
  return n;
}

/** window.localStorage if reachable (accessing it can throw in some browsers). */
export function deviceBeadStorage(): BeadCountStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
