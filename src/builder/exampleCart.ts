/**
 * "Example Cart": port of the original's hard-coded sample (`Car.drawSample`,
 * research/coconut-run-mechanics.md §2): a bed of two lines, two raised end
 * rails, two powered wheels of radius 25 px, four shocks (two per wheel).
 *
 * The exact vertex list was not recovered, so the layout is traced from the
 * builder screenshot (research/reference-images/
 * coconut-run-builder-screen-tool-palette.jpg), scaled so the wheels are
 * 25 px: each end rail is an outward-leaning straw with a short inward kink
 * at the top. The wheels hang free (not pinned) — each is held by a
 * triangle of two shocks, one from the rail's knee and one from the bed end,
 * exactly as in the screenshot.
 *
 * Design px, y-down; y = 0 is the start-area ground (wheels rest on it).
 */

import type { CartDesign, CartPart } from '../model/cart';

const PARTS: CartPart[] = [
  // bed: two lines
  { id: 'bed-l', kind: 'straw', a: { x: 67, y: -43 }, b: { x: 115, y: -43 } },
  { id: 'bed-r', kind: 'straw', a: { x: 115, y: -43 }, b: { x: 163, y: -43 } },
  // raised end rails (lean outward, then kink inward)
  { id: 'rail-l', kind: 'straw', a: { x: 67, y: -43 }, b: { x: 43, y: -96 } },
  { id: 'rail-l-top', kind: 'straw', a: { x: 43, y: -96 }, b: { x: 56, y: -109 } },
  { id: 'rail-r', kind: 'straw', a: { x: 163, y: -43 }, b: { x: 187, y: -96 } },
  { id: 'rail-r-top', kind: 'straw', a: { x: 187, y: -96 }, b: { x: 174, y: -109 } },
  // two bottle-cap wheels, radius 25 px, resting on y = 0
  { id: 'wheel-l', kind: 'wheel', center: { x: 40, y: -25 }, radius: 25 },
  { id: 'wheel-r', kind: 'wheel', center: { x: 190, y: -25 }, radius: 25 },
  // four coil-spring shocks, two per wheel (rail knee + bed end -> wheel centre)
  { id: 'shock-l1', kind: 'shock', a: { x: 43, y: -96 }, b: { x: 40, y: -25 } },
  { id: 'shock-l2', kind: 'shock', a: { x: 67, y: -43 }, b: { x: 40, y: -25 } },
  { id: 'shock-r1', kind: 'shock', a: { x: 187, y: -96 }, b: { x: 190, y: -25 } },
  { id: 'shock-r2', kind: 'shock', a: { x: 163, y: -43 }, b: { x: 190, y: -25 } },
];

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null) {
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
}

/** The fixture (deep-frozen). Use `exampleCart()` for an editable copy. */
export const EXAMPLE_CART: Readonly<CartDesign> = deepFreeze<CartDesign>({ version: 1, name: 'Example Cart', parts: PARTS });

/** A fresh, mutable deep copy of the example cart. */
export function exampleCart(): CartDesign {
  return structuredClone(EXAMPLE_CART) as CartDesign;
}
