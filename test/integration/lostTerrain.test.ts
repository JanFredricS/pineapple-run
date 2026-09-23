/**
 * S6V finding 2: "lost is advisory" in level runs — a lost pineapple keeps
 * its streamed ground. The whole load spills onto open ground (the cart
 * waits left of the funnel) and is marked lost; the cart drives far away
 * (beyond the retention + hysteresis margin), the pile's terrain stays
 * loaded and every pineapple survives; the cart drives back and bulldozes
 * the (lost) pile into the blender pit, which delivers it.
 *
 * Endless (lost is final) keeps the old rule: lost pineapples are not
 * streaming anchors.
 */
import { describe, expect, it } from 'vitest';
import { exampleCart } from '../../src/builder/exampleCart';
import { courseFor } from '../../src/game/courses';
import { RunSession, type Course } from '../../src/game/session';
import type { CartDesign } from '../../src/model/cart';
import type { LevelDef } from '../../src/model/level';
import { loadFixtureCart, loadFlatGoalLevel } from '../../src/run/fixtures';
import { LevelChunkSource } from '../../src/terrain/chunks';
import { planStreaming } from '../../src/terrain/streaming';

/** The S1 flat-goal fixture (pit at x 44..54), its flat run extended far to the left. */
function longFlatGoalLevel(): LevelDef {
  const base = loadFlatGoalLevel();
  const spans = base.terrain.spans.map((s) => {
    if (s.id === 'left-wall') return { ...s, points: [{ x: -250, y: 0 }, { x: -249.9, y: 10 }] };
    if (s.id === 'main') return { ...s, points: [{ x: -249.9, y: 10 }, ...s.points.slice(1)] };
    return s;
  });
  // the load drops onto open ground (funnel x 28); the cart waits on the left
  return { ...base, id: 's6v-long-flat', terrain: { ...base.terrain, spans }, funnel: { x: 28, y: 4.5 }, cartStart: { x: 10, y: 8.2 } };
}

function chassisX(s: RunSession): number {
  const h = s.controller.cart.bodies.get(s.controller.chassisId)!;
  return s.world.getTransform(h).x;
}

describe('level run: lost pineapples keep their streamed ground', () => {
  it('lost pile survives the cart driving far away, then is bulldozed into the blender and delivered', async () => {
    const level = longFlatGoalLevel();
    const course: Course = { levelId: level.id, mode: 'level', level, source: new LevelChunkSource(level.terrain) };
    // S8a: the example cart. The S1 spike fixture cart's low front wheels
    // used to claw up the heap at the old 0.9 pineapple–wheel friction; at
    // 0.3 (backlog #9) they slip on its face and that cart stalls against
    // it. The example cart pushes the heap into the pit at 0.3 (and was the
    // one that stalled at 0.9: the heap locked its wheels — backlog #9
    // itself). This test is about streaming retention and lost-but-delivered
    // scoring, not about which cart can bulldoze.
    const s = await RunSession.create(exampleCart(), course);
    try {
      s.start();
      s.release();
      for (let i = 0; i < 7 * 60; i++) s.step(); // everything spilled is lost by now
      const lost = s.controller.pineappleStates().filter((p) => p.alive && p.lost);
      expect(lost).toHaveLength(15);
      expect(s.controller.phase).toBe('released');
      const pileXs = lost.map((p) => s.world.getTransform(p.handle).x);
      const pileYs = lost.map((p) => s.world.getTransform(p.handle).y);

      // drive far left: well past the margin that would unload the pile's chunks
      const width = s.terrain.config.chunkWidth;
      const unloadAt = Math.min(...pileXs) - s.terrain.config.ahead - s.terrain.config.hysteresis - 2 * width;
      let n = 0;
      s.setDrive(-1);
      while (chassisX(s) > unloadAt && n < 90 * 60) {
        s.step();
        n++;
      }
      s.setDrive(0);
      for (let i = 0; i < 60; i++) s.step(); // several streaming updates at the far point
      expect(chassisX(s)).toBeLessThanOrEqual(unloadAt);

      // Pre-fix anchors (cart only) WOULD unload the pile's ground here...
      const cartOnly = s.controller.cartBodyHandles().map((h) => s.world.getTransform(h).x);
      const pileChunks = [...new Set(pileXs.map((x) => Math.floor(x / width)))];
      const plan = planStreaming(s.terrain.loadedChunks(), cartOnly, s.terrain.source, s.terrain.config);
      expect(pileChunks.some((k) => plan.destroy.includes(k))).toBe(true);
      // ...but it is still loaded, and every lost pineapple is alive where it rested.
      for (const k of pileChunks) expect(s.terrain.isLoaded(k), `chunk ${k}`).toBe(true);
      const now = s.controller.pineappleStates();
      expect(now.every((p) => p.alive)).toBe(true);
      lost.forEach((p, i) => {
        const t = s.world.getTransform(p.handle);
        expect(Math.abs(t.y - pileYs[i]!)).toBeLessThan(0.5);
      });
      expect(s.liveXs()).toHaveLength(s.controller.cartBodyHandles().length + 15);

      // drive back and bulldoze the lost pile into the pit: lost ones still count
      s.setDrive(1);
      for (let i = 0; i < 120 * 60 && s.controller.phase !== 'ended'; i++) s.step();
      const goal = s.events.at(-1)!;
      expect(goal.type).toBe('goalReached');
      if (goal.type !== 'goalReached') return;
      expect(goal.delivered).toBeGreaterThan(0);
      expect(s.controller.remaining).toBe(0); // every delivered one had been lost
      console.info(`[S6V lost terrain] far point x ${unloadAt.toFixed(1)} after ${(n / 60).toFixed(1)} s; delivered ${goal.delivered} previously-lost pineapples`);
    } finally {
      s.destroy();
    }
  }, 120_000);

  it('endless: lost pineapples are NOT streaming anchors (lost is final there)', async () => {
    // no bed: the whole load spills and is lost (the last loss ends the run)
    const noBed: CartDesign = {
      version: 1,
      parts: [
        { id: 'b', kind: 'cube', center: { x: 0, y: -30 }, width: 40, height: 20, angle: 0 },
        { id: 'w', kind: 'wheel', center: { x: 0, y: -30 }, radius: 12 },
      ],
    };
    const s = await RunSession.create(noBed, courseFor('endless:ANCHOR')!);
    try {
      s.start();
      s.release();
      for (let i = 0; i < 60 * 12 && s.controller.phase !== 'ended'; i++) s.step();
      expect(s.events.at(-1)!.type).toBe('allLost');
      const aliveLost = s.controller.pineappleStates().filter((p) => p.alive && p.lost);
      expect(aliveLost.length).toBeGreaterThan(0);
      expect(s.liveXs()).toHaveLength(s.controller.cartBodyHandles().length);
    } finally {
      s.destroy();
    }
  }, 60_000);
});
