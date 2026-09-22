/**
 * Named cart save/load over localStorage (S0 contract 5).
 *
 * - One key per cart: CART_STORAGE_PREFIX + encodeURIComponent(name).
 * - Every load goes through model/validate (`parseCartDesign`); nothing
 *   unvalidated leaves this module.
 * - Saves are validated too, so we never write something we can't read back.
 * - Failures are returned as structured, recoverable errors for the UI:
 *     quota        -> storage full; nothing was written (old save intact);
 *     unavailable  -> storage blocked (private mode / disabled);
 *     corrupt      -> the entry was discarded (removed) — "discard-with-toast";
 *     incompatibleVersion -> saved by a newer build (or an unmigratable old
 *                    one): NOT deleted, just not loadable here;
 *     invalidName / invalidDesign / notFound.
 */

import type { CartDesign } from '../model/cart';
import { parseCartDesign, validateCartDesign, type ValidationError } from '../model/validate';
import { CART_STORAGE_PREFIX } from './constants';

/** The subset of the Web Storage API we use (mockable in tests). */
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type StoreErrorCode = 'quota' | 'unavailable' | 'corrupt' | 'incompatibleVersion' | 'invalidName' | 'invalidDesign' | 'notFound';

export interface StoreError {
  code: StoreErrorCode;
  /** Human-readable, safe to show in a toast. */
  message: string;
  name?: string;
  cause?: ValidationError;
}

export type StoreResult<T> = { ok: true; value: T } | { ok: false; error: StoreError };

export interface SavedCartEntry {
  name: string;
  /** null when the entry exists but cannot be loaded by this build. */
  partCount: number | null;
  /** Why the entry cannot be loaded (incompatible version); it can still be deleted. */
  problem?: string;
}

export interface ListResult {
  carts: SavedCartEntry[];
  /** Problems found while listing (corrupt entries were discarded). */
  problems: StoreError[];
}

export const MAX_CART_NAME_LENGTH = 100;

export function normalizeCartName(raw: string): StoreResult<string> {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: { code: 'invalidName', message: 'Give your cart a name first' } };
  if (name.length > MAX_CART_NAME_LENGTH) {
    return { ok: false, error: { code: 'invalidName', message: `Cart names can be at most ${MAX_CART_NAME_LENGTH} characters` } };
  }
  return { ok: true, value: name };
}

function isQuotaError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const err = e as { name?: unknown; code?: unknown };
  return (
    err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.code === 22 ||
    err.code === 1014
  );
}

const keyFor = (name: string) => CART_STORAGE_PREFIX + encodeURIComponent(name);

function nameFromKey(key: string): string | null {
  if (!key.startsWith(CART_STORAGE_PREFIX)) return null;
  try {
    return decodeURIComponent(key.slice(CART_STORAGE_PREFIX.length));
  } catch {
    return null;
  }
}

const unavailable = (e: unknown): StoreError => ({
  code: 'unavailable',
  message: `Saving is unavailable in this browser (${e instanceof Error ? e.message : String(e)})`,
});

export class CartStore {
  /**
   * `storage` may be a getter so that a SecurityError thrown merely by
   * touching `window.localStorage` is caught and reported as `unavailable`.
   */
  constructor(private readonly storage: StorageLike | (() => StorageLike)) {}

  /**
   * Keys of damaged entries whose removal FAILED and was already reported.
   * `list()` skips them silently afterwards, so a read-only / broken storage
   * doesn't re-toast the same problem on every list.
   */
  private readonly undeletable = new Set<string>();

  /** Remove a damaged entry; null on success, else an `unavailable` error (first time only reported by list). */
  private discard(key: string, what: string): StoreError | null {
    try {
      this.s.removeItem(key);
      this.undeletable.delete(key);
      return null;
    } catch (e) {
      this.undeletable.add(key);
      const base = unavailable(e);
      return { ...base, message: `${what} is damaged and could not be removed: ${base.message}` };
    }
  }

  private get s(): StorageLike {
    return typeof this.storage === 'function' ? this.storage() : this.storage;
  }

  save(rawName: string, design: CartDesign): StoreResult<SavedCartEntry> {
    const n = normalizeCartName(rawName);
    if (!n.ok) return n;
    const name = n.value;
    const v = validateCartDesign({ ...design, name });
    if (!v.ok) return { ok: false, error: { code: 'invalidDesign', message: `Cart cannot be saved: ${v.error.message}`, name, cause: v.error } };
    try {
      this.s.setItem(keyFor(name), JSON.stringify(v.value));
    } catch (e) {
      if (isQuotaError(e)) {
        return {
          ok: false,
          error: { code: 'quota', message: 'Storage is full — delete an old cart and try again. Nothing was saved.', name },
        };
      }
      return { ok: false, error: { ...unavailable(e), name } };
    }
    return { ok: true, value: { name, partCount: v.value.parts.length } };
  }

  exists(rawName: string): boolean {
    const n = normalizeCartName(rawName);
    if (!n.ok) return false;
    try {
      return this.s.getItem(keyFor(n.value)) !== null;
    } catch {
      return false;
    }
  }

  /** Load + validate. A corrupt entry is removed and reported as `corrupt`. */
  load(rawName: string): StoreResult<CartDesign> {
    const n = normalizeCartName(rawName);
    if (!n.ok) return n;
    const name = n.value;
    let text: string | null;
    try {
      text = this.s.getItem(keyFor(name));
    } catch (e) {
      return { ok: false, error: { ...unavailable(e), name } };
    }
    if (text === null) return { ok: false, error: { code: 'notFound', message: `No saved cart called "${name}"`, name } };
    return this.check(name, text);
  }

  private check(name: string, text: string): StoreResult<CartDesign> {
    const r = parseCartDesign(text);
    if (r.ok) return { ok: true, value: { ...r.value, name } };
    if (r.error.code === 'futureVersion' || r.error.code === 'unsupportedVersion') {
      const why = r.error.code === 'futureVersion' ? 'a newer version of the game' : 'an old version of the game';
      return {
        ok: false,
        error: { code: 'incompatibleVersion', message: `"${name}" was saved by ${why} and can't be opened here`, name, cause: r.error },
      };
    }
    const failed = this.discard(keyFor(name), `Saved cart "${name}"`);
    if (failed) return { ok: false, error: { ...failed, name, cause: r.error } };
    return {
      ok: false,
      error: { code: 'corrupt', message: `Saved cart "${name}" was damaged and has been discarded (${r.error.message})`, name, cause: r.error },
    };
  }

  /** All saved carts (sorted by name). Corrupt entries are discarded and reported. */
  list(): StoreResult<ListResult> {
    let keys: string[];
    try {
      const s = this.s;
      keys = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k !== null && k.startsWith(CART_STORAGE_PREFIX)) keys.push(k);
      }
    } catch (e) {
      return { ok: false, error: unavailable(e) };
    }
    const carts: SavedCartEntry[] = [];
    const problems: StoreError[] = [];
    for (const k of keys) {
      if (this.undeletable.has(k)) continue; // already reported; don't repeat every list
      const name = nameFromKey(k);
      let text: string | null = null;
      try {
        text = this.s.getItem(k);
      } catch (e) {
        problems.push(unavailable(e));
        continue;
      }
      const norm = name === null ? null : normalizeCartName(name);
      if (name === null || !norm || !norm.ok || norm.value !== name) {
        const failed = this.discard(k, 'A saved cart with an unreadable name');
        problems.push(failed ?? { code: 'corrupt', message: 'A saved cart with an unreadable name was discarded' });
        continue;
      }
      if (text === null) continue;
      const r = this.check(name, text);
      if (r.ok) carts.push({ name, partCount: r.value.parts.length });
      else if (r.error.code === 'incompatibleVersion') carts.push({ name, partCount: null, problem: r.error.message });
      else problems.push(r.error);
    }
    carts.sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, value: { carts, problems } };
  }

  remove(rawName: string): StoreResult<null> {
    const n = normalizeCartName(rawName);
    if (!n.ok) return n;
    try {
      this.s.removeItem(keyFor(n.value));
      return { ok: true, value: null };
    } catch (e) {
      return { ok: false, error: { ...unavailable(e), name: n.value } };
    }
  }
}

/** Store backed by window.localStorage (access errors surface as `unavailable`). */
export function browserCartStore(): CartStore {
  return new CartStore(() => window.localStorage);
}
