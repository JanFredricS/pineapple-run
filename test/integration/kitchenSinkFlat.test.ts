/**
 * K1 audit #1: the example cart cannot cross a Kitchen-style sink, off the
 * shipped course too: synthetic sinks (test/integration/sinkCourse.ts) at
 * every steady speed from 5 to 15 m/s in 1 m/s steps plus holding right
 * (~16 m/s), after flat run-ups of 12 m (Kitchen's), 30 m and 60 m, and at
 * the margin cases around Kitchen's 5.5 m hole / 0.5 m rise: a 5.0 m hole
 * with the same rise, and a 5.5 m hole with only 0.3 m. The approach speed
 * is checked, so the grid is the speeds the cart actually arrives at.
 *
 * "Never crosses" = the cart's rear never passes the far edge (the far
 * bevel's top), whatever happens at the far wall (bounces included); and
 * the run never soft-locks: it ends (allLost, Retry) or the stuck hint
 * shows. Pitch cases (a bump before the hole): kitchenSinkPitch.test.ts.
 */
import { describe, it } from 'vitest';
import { expectNoCrossing, SWEEP_SPEEDS, type SinkSpec } from './sinkCourse';

const FAMILIES: [string, SinkSpec][] = [
  ['Kitchen sink (5.5 m, +0.5 m), 12 m flat run-up', { runUp: 12, width: 5.5, rise: 0.5 }],
  ['Kitchen sink, 30 m flat run-up', { runUp: 30, width: 5.5, rise: 0.5 }],
  ['Kitchen sink, 60 m flat run-up', { runUp: 60, width: 5.5, rise: 0.5 }],
  ['margin: 5.0 m hole, +0.5 m, 60 m run-up', { runUp: 60, width: 5.0, rise: 0.5 }],
  ['margin: 5.5 m hole, +0.3 m, 60 m run-up', { runUp: 60, width: 5.5, rise: 0.3 }],
];

describe('K1 audit #1: the example cart never crosses a flat-approach sink (5-15 m/s every 1 m/s, holding right)', () => {
  for (const [name, spec] of FAMILIES) {
    it(name, async () => {
      for (const v of SWEEP_SPEEDS) await expectNoCrossing(spec, v, true);
    }, 600_000);
  }
});
