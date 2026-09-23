/**
 * K1: the purpose-built "Kitchen Bridger", the cart that proves Kitchen
 * Bench's sink (a 5.5 m hole to a counter 0.5 m higher) is beatable. The
 * example cart cannot cross it (test/integration/acceptance.test.ts,
 * TUNING.md "K1: Kitchen difficulty").
 *
 * Design (builder px, 30 px = 1 m; y-down, y = 0 is the ground line):
 *   - four wheels in a rigid arch: rear R (x -150, r 35), middle M1 (65, r 25)
 *     and M2 (130, r 25) under the bed, front F (305, r 35). Every gap the
 *     cart must bridge is crossed with at least one wheel on EACH side of the
 *     hole and the load's centre of mass between supports:
 *       F - M2 = 175 px = 5.83 m  > 5.5 m  (front reaches the far counter
 *                                           before the middle pair leaves the near one)
 *       M1 - R = 215 px = 7.17 m  > 5.5 m  (rear still on the near counter
 *                                           when the middle pair is over the hole)
 *     with the loaded centre of mass (~97 px) between M1 and M2, so the cart
 *     never rests on one side of the hole alone;
 *   - high chords (y -115, 3.8 m) from the bed rails out to the end legs:
 *     ground clearance for the slabs and pool lip (a straight low beam this
 *     long high-centres on the pool lip);
 *   - a 140 px bed at y -55 under the funnel (x 115) with leaning rails and
 *     100 px end posts to keep the load aboard on the slabs.
 * Overall -185..340 px x -155..0 px (17.5 x 5.2 m): it fits the 17.67 x 7 m
 * build area (BUILD_AREA -190..340 x -210..0); the front wheel's rim is
 * flush with the right edge (maxRadiusInArea at its centre is exactly 35).
 */
import type { CartDesign } from '../../src/model/cart';
import { PREMADE } from '../../tools/levels/premade';
import type { PaceNote } from '../../tools/levels/track';

const R = -150;
const M1 = 65;
const M2 = 130;
const F = 305;
const R_END = 35;
const R_MID = 25;
const CHORD_Y = -115;
const BED_Y = -55;
const BED_L = 45;
const BED_R = 185;
const RAIL_H = 60;
const POST_H = 100;

export function kitchenBridger(): CartDesign {
  const lt = { x: BED_L - 15, y: BED_Y - RAIL_H };
  const rt = { x: BED_R + 15, y: BED_Y - RAIL_H };
  return {
    version: 1,
    name: 'Kitchen Bridger',
    parts: [
      { id: 'bed', kind: 'straw', a: { x: BED_L, y: BED_Y }, b: { x: BED_R, y: BED_Y } },
      { id: 'rail-l', kind: 'straw', a: { x: BED_L, y: BED_Y }, b: lt },
      { id: 'rail-r', kind: 'straw', a: { x: BED_R, y: BED_Y }, b: rt },
      { id: 'hang-1', kind: 'straw', a: { x: M1, y: BED_Y }, b: { x: M1, y: -R_MID } },
      { id: 'hang-2', kind: 'straw', a: { x: M2, y: BED_Y }, b: { x: M2, y: -R_MID } },
      { id: 'chord-r', kind: 'straw', a: lt, b: { x: R, y: CHORD_Y } },
      { id: 'leg-r', kind: 'straw', a: { x: R, y: CHORD_Y }, b: { x: R, y: -R_END } },
      { id: 'chord-f', kind: 'straw', a: rt, b: { x: F, y: CHORD_Y } },
      { id: 'leg-f', kind: 'straw', a: { x: F, y: CHORD_Y }, b: { x: F, y: -R_END } },
      { id: 'wR', kind: 'wheel', center: { x: R, y: -R_END }, radius: R_END },
      { id: 'wM1', kind: 'wheel', center: { x: M1, y: -R_MID }, radius: R_MID },
      { id: 'wM2', kind: 'wheel', center: { x: M2, y: -R_MID }, radius: R_MID },
      { id: 'wF', kind: 'wheel', center: { x: F, y: -R_END }, radius: R_END },
      { id: 'post-l', kind: 'straw', a: { x: BED_L, y: BED_Y }, b: { x: BED_L, y: BED_Y - POST_H } },
      { id: 'post-r', kind: 'straw', a: { x: BED_R, y: BED_Y }, b: { x: BED_R, y: BED_Y - POST_H } },
    ],
  };
}

/**
 * The bridger's line on Kitchen = Kitchen's pace notes (tools/levels/premade.ts):
 * 6.5 m/s, inside the measured working band (steady 4-9 m/s all reach the
 * goal with >= 13/15), then 10 m/s from the kicker through the drainer pool.
 * Above ~9 m/s the crossing turns chaotic (the long cart can nose into the
 * sink's far wall: 9.5 m/s stalls there, 12 m/s delivers 9/15); holding
 * right delivers 11/15 at rating 62 against the line's 15/15 at 75.
 */
export const KITCHEN_BRIDGER_LINE: readonly PaceNote[] = PREMADE.kitchen().pace;
