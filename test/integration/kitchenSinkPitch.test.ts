/**
 * K1 audit #1, pitch: the cart reaches the sink pitching after a bump. On
 * Kitchen the last bumps before the sink are the grout washboard (10 teeth
 * 0.45 m, 4/3 m pitch), 12 m before the hole; kitchen.test.ts pins that run-up.
 *
 * Measured (TUNING.md "K1 audit"): a bump that ENDS close to the hole is a
 * launch lip and does let the example cart jump it (a 0.3 m hump within 4 m
 * of the edge at >= 12 m/s, a 0.6 m hump or kicker within 8 m at >= 10-14
 * m/s). So these cases pin the margin the shipped run-up has: the washboard
 * at 3-12 m, and 0.3 m / 0.6 m humps and kickers 12 m back, never cross.
 * (The bumps bleed speed, so the target speed is not checked at the hole.)
 */
import { describe, it } from 'vitest';
import { expectNoCrossing, SWEEP_SPEEDS, type SinkSpec } from './sinkCourse';

const CASES: [string, SinkSpec][] = [
  ...[12, 9, 6, 3].map((d): [string, SinkSpec] => [`Kitchen's washboard ${d} m before the sink`, { runUp: d, width: 5.5, rise: 0.5, bump: { kind: 'washboard', h: 0.45, bumpToEdge: d } }]),
  ...(['hump', 'kicker'] as const).flatMap((kind) =>
    [0.3, 0.6].map((h): [string, SinkSpec] => [`a ${h} m ${kind} 12 m before the sink`, { runUp: 30, width: 5.5, rise: 0.5, bump: { kind, h, bumpToEdge: 12 } }]),
  ),
];

describe('K1 audit #1: the example cart never crosses the sink after a bump at Kitchen distances (5-15 m/s, holding right)', () => {
  for (const [name, spec] of CASES) {
    it(name, async () => {
      for (const v of SWEEP_SPEEDS) await expectNoCrossing(spec, v);
    }, 600_000);
  }
});
