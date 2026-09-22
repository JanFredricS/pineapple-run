/**
 * Harness file loading: everything that can reject a cart / level BEFORE the
 * current run is touched. Schema validation (model/validate) alone is not
 * enough for carts — a schema-valid cart can still be unplayable (no wheels,
 * disconnected islands…), which only resolveAttachments reports. Pure.
 */

import { resolveAttachments } from '../model/attach';
import type { CartDesign } from '../model/cart';
import type { LevelDef } from '../model/level';
import { parseCartDesign, parseLevelDef } from '../model/validate';

export type LoadCheck<T> = { ok: true; value: T } | { ok: false; message: string };

/** Parse + schema-validate + resolve attachments. Only a startable cart passes. */
export function checkCartJson(text: string): LoadCheck<CartDesign> {
  const r = parseCartDesign(text);
  if (!r.ok) return { ok: false, message: r.error.message };
  const spec = resolveAttachments(r.value);
  if (!spec.valid) {
    const codes = [...new Set(spec.errors.map((e) => e.code))].join(', ');
    return { ok: false, message: `cart cannot be started (${codes})` };
  }
  return { ok: true, value: r.value };
}

export function checkLevelJson(text: string): LoadCheck<LevelDef> {
  const r = parseLevelDef(text);
  if (!r.ok) return { ok: false, message: r.error.message };
  return { ok: true, value: r.value };
}
