/**
 * Human-readable text for the closed AttachmentError union (model/attach.ts).
 * Exhaustive over the union: adding a code without a message fails to compile.
 */

import type { AttachmentError } from '../model/attach';
import type { CartDesign, CartPart } from '../model/cart';
import { MIN_CUBE_SIZE_PX, MIN_PART_SIZE_PX, SHOCK_SNAP_PX } from '../model/cart';
import { kindName } from './edits';

/** "Straw 3" — numbered per kind, in draw order (1-based). */
export function partLabels(design: CartDesign): Map<string, string> {
  const counts = new Map<CartPart['kind'], number>();
  const out = new Map<string, string>();
  for (const p of design.parts) {
    const n = (counts.get(p.kind) ?? 0) + 1;
    counts.set(p.kind, n);
    out.set(p.id, `${kindName(p.kind)} ${n}`);
  }
  return out;
}

export interface ErrorMessage {
  code: AttachmentError['code'];
  text: string;
  /** Parts to highlight when the message is hovered/focused (ALL involved parts). */
  partIds: string[];
  /**
   * disconnectedIslands only: every island, largest first. The largest (the
   * likely "main" cart) is highlighted dimly, the others brightly in
   * alternating colours, so every piece is visible and distinguishable.
   */
  islands?: string[][];
}

/**
 * Highlight tone per part for a hovered message: 0 = dim (main piece),
 * 1, 2, ... = bright, one distinct tone per detached piece.
 */
export function highlightMap(m: ErrorMessage): Map<string, number> {
  const out = new Map<string, number>();
  if (m.islands) m.islands.forEach((island, i) => island.forEach((id) => out.set(id, i)));
  else for (const id of m.partIds) out.set(id, 1);
  return out;
}

export function describeErrors(design: CartDesign, errors: readonly AttachmentError[]): ErrorMessage[] {
  const labels = partLabels(design);
  const label = (id: string) => labels.get(id) ?? id;
  const kindOf = new Map(design.parts.map((p) => [p.id, p.kind]));
  return errors.map((e): ErrorMessage => {
    switch (e.code) {
      case 'noWheels':
        return { code: e.code, text: 'Your cart is missing wheels! Add at least one bottle-cap wheel.', partIds: [] };
      case 'floatingShock': {
        const ends = e.ends.length === 2 ? 'Both ends are' : `One end is`;
        return {
          code: e.code,
          text: `${label(e.partId)}: ${ends} loose. Each end must sit on a part or within ${SHOCK_SNAP_PX} px of a wheel or lime centre.`,
          partIds: [e.partId],
        };
      }
      case 'disconnectedIslands': {
        const n = e.islands.length;
        // stable sort: largest first, ties keep the model's order
        const islands = [...e.islands].sort((a, b) => b.length - a.length).map((i) => [...i]);
        return {
          code: e.code,
          text: `Your cart is in ${n} separate pieces. Join them by overlapping parts, pinning a wheel over a part, or adding a shock.`,
          partIds: islands.flat(),
          islands,
        };
      }
      case 'shockSameBody':
        return {
          code: e.code,
          text: `${label(e.partId)} connects a piece to itself, so it does nothing. Attach its ends to two different pieces.`,
          partIds: [e.partId],
        };
      case 'partTooSmall': {
        const min = kindOf.get(e.partId) === 'cube' ? MIN_CUBE_SIZE_PX : MIN_PART_SIZE_PX;
        return { code: e.code, text: `${label(e.partId)} is too small (minimum ${min} px). Delete it or redraw it larger.`, partIds: [e.partId] };
      }
    }
  });
}
