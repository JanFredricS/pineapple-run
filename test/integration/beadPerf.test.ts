/**
 * S9 headless perf measurement for the bead ocean (TUNING.md, S9 section).
 * OPT-IN: runs only with S9_PERF=1 exactly (0, false or any other value skips; timings are machine-dependent and never
 * a gate); prints a markdown table.
 *
 *   S9_PERF=1 npx vitest run test/integration/beadPerf.test.ts
 *
 * Per bead count: session build time; steps until every bead sleeps after
 * load; mean step cost with the cart parked on the plateau (beads asleep);
 * mean step cost while the chassis is inside the bead zone on the pace line
 * (cart ploughing, beads awake); and the whole pace run. The 0-bead row is
 * the same level with its bead zone removed.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { exampleCart } from '../../src/builder/exampleCart';
import { courseFor } from '../../src/game/courses';
import { RunSession, type Course } from '../../src/game/session';
import { PREMADE } from '../../tools/levels/premade';
import { paceDrive } from './driver';

const PACE = PREMADE.tikibar().pace;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function course(beads: boolean): Course {
  const c = courseFor('tikibar')!;
  return beads ? c : { ...c, level: { ...c.level, zones: c.level.zones.filter((z) => z.kind !== 'beads') } };
}

async function measure(n: number): Promise<string> {
  const beads = n > 0;
  const zone = courseFor('tikibar')!.level.zones.find((z) => z.kind === 'beads')!;
  const t0 = performance.now();
  const s = await RunSession.create(exampleCart(), course(beads), { beadCount: beads ? n : 300 });
  const build = performance.now() - t0;
  try {
    const c = s.controller;
    const allAsleep = () => !c.beads || c.beads.handles().every((h) => !s.world.isAwake(h));
    s.start();
    let settle = 0;
    while (!allAsleep() && settle < 1200) {
      s.step();
      settle++;
    }
    const parked: number[] = [];
    for (let i = 0; i < 300; i++) {
      const a = performance.now();
      s.step();
      parked.push(performance.now() - a);
    }
    s.release();
    const plough: number[] = [];
    const run: number[] = [];
    for (let k = 0; c.phase !== 'ended' && k < 120 * 60; k++) {
      s.setDrive(paceDrive(s, PACE));
      const a = performance.now();
      s.step();
      const dt = performance.now() - a;
      run.push(dt);
      const h = c.cart.bodies.get(c.chassisId);
      if (h !== undefined && s.world.hasBody(h)) {
        const x = s.world.getTransform(h).x;
        if (x >= zone.rect.x && x <= zone.rect.x + zone.rect.width) plough.push(dt);
      }
    }
    const f = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : '-');
    return `| ${n} | ${build.toFixed(0)} | ${settle >= 1200 ? '>1200' : settle} | ${f(mean(parked))} | ${f(mean(plough))} | ${f(Math.max(...(plough.length ? plough : [NaN])))} | ${f(mean(run))} |`;
  } finally {
    s.destroy();
  }
}

describe.skipIf(process.env.S9_PERF !== '1')('S9 bead-ocean perf (opt-in)', () => {
  it('prints the table', async () => {
    const rows = ['| beads | build ms | settle steps | parked ms/step | ploughing ms/step | ploughing max ms | whole run ms/step |', '|---|---|---|---|---|---|---|'];
    await measure(300); // warm-up (JIT, wasm)
    for (const n of [0, 300, 450, 600]) rows.push(await measure(n));
    console.log(`\n${rows.join('\n')}\n`);
    expect(rows).toHaveLength(6);
  }, 300_000);
});
