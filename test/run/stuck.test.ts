/**
 * S6T backlog #5: the stuck detector (pure) and its RunSession wiring.
 */
import { describe, expect, it } from 'vitest';
import { RunSession } from '../../src/game/session';
import { loadFixtureCart, loadFlatGoalLevel } from '../../src/run/fixtures';
import { LevelChunkSource } from '../../src/terrain/chunks';
import { StuckDetector, STUCK_DISPLACEMENT, STUCK_SECONDS } from '../../src/run/stuck';

const DT = 1 / 60;

describe('StuckDetector (pure)', () => {
  it(`still (moves < ${STUCK_DISPLACEMENT} m) for ${STUCK_SECONDS} s -> stuck; a real move clears it`, () => {
    const d = new StuckDetector();
    let x = 10;
    let n = 0;
    // jitters within the threshold: counts as still
    while (!d.sample({ x: x + (n % 2 ? 0.1 : -0.1), y: 3 + (n % 3) * 0.05 }, DT, true)) n++;
    expect(n * DT).toBeCloseTo(STUCK_SECONDS - DT, 1);
    x += STUCK_DISPLACEMENT + 0.05;
    expect(d.sample({ x, y: 3 }, DT, true)).toBe(false);
    expect(d.stuck).toBe(false);
  });

  it('slow but steady progress (10 cm/s) re-anchors every 0.3 m and is never stuck', () => {
    const d = new StuckDetector();
    for (let i = 0; i < 60 * 60; i++) expect(d.sample({ x: 0.1 * i * DT, y: 0 }, DT, true)).toBe(false);
  });

  it('a lost cart (null) becomes stuck after the same delay; not live resets', () => {
    const d = new StuckDetector();
    d.sample({ x: 0, y: 0 }, DT, true);
    for (let i = 0; i < STUCK_SECONDS * 60; i++) d.sample(null, DT, true);
    expect(d.stuck).toBe(true);
    d.sample(null, DT, false);
    expect(d.stuck).toBe(false);
    expect(d.stillSeconds).toBe(0);
  });
});

describe('RunSession.stuck', () => {
  // (On a real course's start slope a parked cart may creep ~0.1 m/s: that is
  // movement, not stuck — the hint is for wheels spinning against a wall.)
  it('flat fixture level: never while waiting before Release; a parked cart turns stuck ~5 s after Release; driving clears it', async () => {
    const level = loadFlatGoalLevel();
    const s = await RunSession.create(loadFixtureCart(), { levelId: level.id, mode: 'level', level, source: new LevelChunkSource(level.terrain) });
    try {
      s.start();
      for (let i = 0; i < 8 * 60; i++) s.step(); // long wait before Release: not "stuck"
      expect(s.stuck).toBe(false);
      s.release();
      let n = 0;
      while (!s.stuck && n < 20 * 60) {
        s.step();
        n++;
      }
      expect(s.stuck).toBe(true);
      // the load drops in and settles, then 5 s of stillness
      expect(n * DT).toBeGreaterThanOrEqual(STUCK_SECONDS);
      expect(n * DT).toBeLessThan(STUCK_SECONDS + 4);
      s.setDrive(1);
      for (let i = 0; i < 90 && s.stuck; i++) s.step();
      expect(s.stuck).toBe(false);
    } finally {
      s.destroy();
    }
  }, 30_000);
});
