/**
 * The cart the player is working on, kept across screens for the page's
 * lifetime (named saves are the builder's CartStore):
 *  - `draft`:  the builder's latest committed design (restored on Edit Cart /
 *              when re-entering any course's builder, like the original,
 *              where one cart was carried from course to course);
 *  - `tested`: the design last sent to a run by Test Cart — what Retry
 *              replays, so a retry is always the identical cart.
 *
 * UX1 (Jan: "The default cart loads when start — should be empty area; only
 * if you click demo cart it should show"). The rule:
 *  - a FRESH entry (no design yet this page session: first visit to any
 *    builder) opens EMPTY; the builder's "Example Cart" button loads the demo;
 *  - every later entry keeps the player's CURRENT design: back from a run
 *    (Esc / Edit Cart / results → builder) restores the draft, which Test
 *    Cart set to the tested cart; Retry replays `tested`; picking another
 *    course carries the draft over (one cart from course to course, as in
 *    the original). Clearing the builder is the player's own choice (Clear
 *    all) and is kept like any other edit.
 * `tested` only ever comes from Test Cart; a run mounted without one (tests,
 * dev tools) still falls back to the example cart.
 */

import { emptyDesign } from '../builder/editor';
import { exampleCart } from '../builder/exampleCart';
import type { CartDesign } from '../model/cart';

let draft: CartDesign | null = null;
let tested: CartDesign | null = null;

export function draftDesign(): CartDesign {
  return structuredClone(draft ?? tested ?? emptyDesign());
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
