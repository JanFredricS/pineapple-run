/**
 * The cart the player is working on, kept across screens for the page's
 * lifetime (named saves are the builder's CartStore):
 *  - `draft`:  the builder's latest committed design (restored on Edit Cart /
 *              when re-entering any course's builder, like the original,
 *              where one cart was carried from course to course);
 *  - `tested`: the design last sent to a run by Test Cart — what Retry
 *              replays, so a retry is always the identical cart.
 * Both start as the S2 example cart.
 */

import { exampleCart } from '../builder/exampleCart';
import type { CartDesign } from '../model/cart';

let draft: CartDesign | null = null;
let tested: CartDesign | null = null;

export function draftDesign(): CartDesign {
  return structuredClone(draft ?? tested ?? exampleCart());
}

export function setDraftDesign(d: CartDesign): void {
  draft = structuredClone(d);
}

export function testedDesign(): CartDesign {
  return structuredClone(tested ?? exampleCart());
}

export function setTestedDesign(d: CartDesign): void {
  tested = structuredClone(d);
  draft = structuredClone(d);
}

/** Tests: forget both. */
export function resetCartState(): void {
  draft = null;
  tested = null;
}
