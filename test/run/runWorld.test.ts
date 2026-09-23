/**
 * S9 audit-1 #2: every run world is configured from its level (run/runWorld),
 * so the generic run harness page can load a gravity/force-zone level such as
 * levels/tikibar.json (it used to build a default world and ZoneField threw).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PhysicsWorld } from '../../src/physics/engine';
import { RunController } from '../../src/run/controller';
import { loadFixtureCart } from '../../src/run/fixtures';
import { checkLevelJson } from '../../src/run/loadCheck';
import { createRun, worldOptionsForLevel } from '../../src/run/runWorld';

const levelText = (id: string) => readFileSync(new URL(`../../levels/${id}.json`, import.meta.url), 'utf8');

function load(id: string) {
  const r = checkLevelJson(levelText(id));
  if (!r.ok) throw new Error(r.message);
  return r.value;
}

describe('run world from the level', () => {
  it('sensor visitors exactly for levels with gravity/force zones', () => {
    expect(worldOptionsForLevel(load('tikibar'))).toEqual({ sensorVisitors: true });
    for (const id of ['beach', 'kitchen', 'workbench', 'original-course']) expect(worldOptionsForLevel(load(id))).toEqual({});
    expect(worldOptionsForLevel({ zones: [{ id: 'b', kind: 'beads', rect: { x: 0, y: 0, width: 5, height: 1 } }] })).toEqual({});
  });

  it('the harness path (loadCheck -> createRun) builds and runs tikibar.json; the old default-world path threw', async () => {
    const level = load('tikibar');
    const old = await PhysicsWorld.create();
    try {
      expect(() => new RunController(old, loadFixtureCart(), level, { mode: 'level' })).toThrow(/sensorVisitors/);
    } finally {
      old.destroy();
    }
    const { world, run } = await createRun(loadFixtureCart(), level, { mode: 'level' });
    try {
      expect(world.sensorVisitors).toBe(true);
      expect(run.zones?.zones).toHaveLength(2);
      expect(run.beads?.count).toBeGreaterThan(0);
      run.start();
      for (let i = 0; i < 120; i++) run.step();
      expect(run.phase).toBe('started');
    } finally {
      run.destroy();
      world.destroy();
    }
  });

  it('a run that cannot be built frees its world and rethrows', async () => {
    const bad = { ...loadFixtureCart(), parts: [] };
    await expect(createRun(bad, load('beach'))).rejects.toThrow();
  });

  it('the harness page and RunSession both build worlds through run/runWorld', () => {
    const harness = readFileSync(new URL('../../src/run/harness.ts', import.meta.url), 'utf8');
    expect(harness).toContain('await createRun(next.design, next.level, { mode })');
    expect(harness).not.toMatch(/PhysicsWorld\.create\(|new RunController\(/);
    const session = readFileSync(new URL('../../src/game/session.ts', import.meta.url), 'utf8');
    expect(session).toContain('PhysicsWorld.create(worldOptionsForLevel(course.level))');
  });
});
