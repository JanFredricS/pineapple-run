/**
 * S6V findings 5 + 6: solid props — validator, physics builder and renderer
 * share one predicate (model/level hasSolidBody), and the blender view is
 * placed on its (possibly rotated) collider box.
 */
import { Container, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { hasSolidBody, type LevelDef, type PropDef } from '../../src/model/level';
import { validateLevelDef } from '../../src/model/validate';
import { PhysicsWorld } from '../../src/physics/engine';
import { BLENDER_HEIGHT_M, SceneRenderer, blenderFoot } from '../../src/render/scene';
import { BLENDER_LAYOUT } from '../../src/render/artCatalog';
import { BLENDER_SCALE, BLENDER_SIZE } from '../../src/model/goal';
import { generateLevel } from '../../src/terrain/generator';
import { mockLevel } from '../../src/render/styleguide/mockRun';
import type { TextureProvider } from '../../src/render/textures';
import { boxPolygon } from '../../src/run/shapes';
import { buildSolidProps, isSolidProp } from '../../src/run/props';
import { SHIPPED_LEVEL_IDS, levelById } from '../../src/game/courses';
import { loadFlatGoalLevel } from '../../src/run/fixtures';

const texCache = new Map<string, Texture>();
const provider: TextureProvider = {
  has: () => true,
  texture(id) {
    let t = texCache.get(id);
    if (!t) texCache.set(id, (t = new Texture({ source: new TextureSource({ width: 64, height: 64, resolution: 1 }), label: id })));
    return t;
  },
};
const decorLayer = (r: SceneRenderer) => r.world.children[1] as Container;

const base = { id: 'p', art: 'crate', position: { x: 3, y: 4 } };
const SIZES: (PropDef['size'] | undefined)[] = [
  undefined,
  { x: 1, y: 2 },
  { x: 0, y: 3.6 },
  { x: 1.5, y: 0 },
  { x: -1, y: 2 },
  { x: 2, y: -0.5 },
  { x: 1e-6, y: 1e-6 },
];

function levelWith(props: PropDef[]): unknown {
  return JSON.parse(JSON.stringify({ ...mockLevel('beach'), props }));
}

describe('finding 5: one "is a body" rule for validate / physics / renderer', () => {
  it('validation rejects exactly the solid props physics would skip', () => {
    for (const size of SIZES) {
      for (const solid of [true, false, undefined]) {
        const prop: PropDef = { ...base, ...(solid !== undefined ? { solid } : {}), ...(size ? { size } : {}) };
        const r = validateLevelDef(levelWith([prop]));
        const expectOk = solid !== true || hasSolidBody(prop);
        expect(r.ok, JSON.stringify(prop)).toBe(expectOk);
        expect(isSolidProp(prop)).toBe(hasSolidBody(prop));
      }
    }
  });

  it('every shipped level and the S1 fixture level pass (no level relies on a non-positive solid size)', () => {
    for (const id of SHIPPED_LEVEL_IDS) {
      const l = levelById(id)!;
      for (const p of l.props) if (p.solid) expect(hasSolidBody(p), `${id}/${p.id}`).toBe(true);
    }
    for (const p of loadFlatGoalLevel().props) if (p.solid) expect(hasSolidBody(p)).toBe(true);
  });

  it('renderer and physics agree prop-by-prop on an UNVALIDATED level: a body-less solid prop is neither built nor drawn', async () => {
    const props: PropDef[] = [
      { id: 'ok', art: 'crate', solid: true, position: { x: 2, y: 3 }, size: { x: 1, y: 1 } },
      { id: 'flat', art: 'crate', solid: true, position: { x: 5, y: 3 }, size: { x: 0, y: 3.6 } },
      { id: 'neg', art: 'palm', solid: true, position: { x: 7, y: 3 }, size: { x: -1, y: 1 } },
      { id: 'deco', art: 'palm', position: { x: 9, y: 3 } },
      // a body-less blender must not become the goal view either
      { id: 'bad-blender', art: 'blender', solid: true, position: { x: 40, y: 3 }, size: { x: 1.5, y: 0 } },
    ];
    const world = await PhysicsWorld.create();
    try {
      const built = buildSolidProps(world, props).map((p) => p.id);
      expect(built).toEqual(['ok']);
    } finally {
      world.destroy();
    }
    const r = new SceneRenderer(provider, { background: false });
    const level: LevelDef = { ...mockLevel('beach'), props };
    r.setLevel(level);
    const children = decorLayer(r).children;
    // 'ok' + 'deco' + the BlenderView (at the goal sensor, not the bad prop)
    expect(children).toHaveLength(3);
    expect(children.map((c) => c.position.x)).toEqual([2, 9, r.blenderView!.view.position.x]);
    const g = level.goal.sensor;
    expect(r.blenderView!.view.position.x).toBeCloseTo(g.x + g.width / 2, 9);
    expect(r.blenderView!.view.position.y).toBeCloseTo(g.y + g.height, 9);
    r.destroy();
  });
});

describe('finding 6: the blender view follows its rotated collider', () => {
  const size = { x: 1.5, y: 3.6 };
  const blender = (angle: number): PropDef => ({ id: 'blender', art: 'blender', solid: true, position: { x: 50, y: 12.2 }, size, angle });

  it('foot = bottom-centre of the rotated physics box; view rotated by the same angle', () => {
    for (const angle of [0, 0.35, -0.6, Math.PI / 2]) {
      const p = blender(angle);
      const poly = boxPolygon(p.position, size, angle); // exactly what src/run/props.ts builds
      // bottom edge = vertices 2 and 3 ((+hx,+hy), (-hx,+hy) in box space)
      const bottomMid = { x: (poly[2]!.x + poly[3]!.x) / 2, y: (poly[2]!.y + poly[3]!.y) / 2 };
      const foot = blenderFoot(p);
      expect(foot.x).toBeCloseTo(bottomMid.x, 9);
      expect(foot.y).toBeCloseTo(bottomMid.y, 9);

      const r = new SceneRenderer(provider, { background: false });
      r.setLevel({ ...mockLevel('beach'), props: [p] });
      const v = r.blenderView!.view;
      expect(v.position.x).toBeCloseTo(bottomMid.x, 9);
      expect(v.position.y).toBeCloseTo(bottomMid.y, 9);
      expect(v.rotation).toBeCloseTo(angle, 9);
      // the view's local "up" axis runs along the box's centre line: rotating
      // local (0, -h/2) by the view's rotation from its origin lands on the box centre
      const a = v.rotation;
      const half = size.y / 2;
      expect(v.position.x + Math.sin(a) * half).toBeCloseTo(p.position.x, 9);
      expect(v.position.y - Math.cos(a) * half).toBeCloseTo(p.position.y, 9);
      r.destroy();
    }
  });

  it('upright blender unchanged (angle 0: foot at position.y + h/2)', () => {
    expect(blenderFoot(blender(0))).toEqual({ x: 50, y: 12.2 + 1.8 });
    // a decor (non-solid) blender stands on its position
    expect(blenderFoot({ id: 'b', art: 'blender', position: { x: 1, y: 2 }, angle: 1 })).toEqual({ x: 1, y: 2 });
  });
});

describe('UX1: the big goal blender — the drawn blender is exactly its solid collider', () => {
  it('the shared blender is 2.5x its S6 size; every shipped level uses it, standing clear of the lip with free pit floor before it', () => {
    expect(BLENDER_SIZE.x).toBeCloseTo(1.5 * BLENDER_SCALE, 9);
    expect(BLENDER_SIZE.y).toBeCloseTo(3.6 * BLENDER_SCALE, 9);
    expect(BLENDER_SCALE).toBe(2.5);
    for (const id of SHIPPED_LEVEL_IDS) {
      const l = levelById(id)!;
      const b = l.props.find((p) => p.art === 'blender')!;
      expect(b.size, id).toEqual(BLENDER_SIZE);
      const front = b.position.x - b.size!.x / 2;
      const s = l.goal.sensor;
      // the goal line and the first metres of the pit floor are clear: the cart and its load drop in before the blender
      expect(front - l.goal.lineX, id).toBeGreaterThan(3);
      expect(front - s.x, id).toBeGreaterThanOrEqual(3.75 - 1e-9);
      // and the blender stands inside the pit, clear of its back wall
      expect(b.position.x + b.size!.x / 2, id).toBeLessThan(s.x + s.width);
    }
    // generated finite levels: the (decor) blender's pit fits it with 1 m either side
    const gen = generateLevel('PINE', 300).level;
    expect(gen.goal.sensor.width + 0.6).toBeCloseTo(BLENDER_SIZE.x + 2, 9);
  });

  it('the view is scaled so it is exactly as tall as the collider (any size), standing on its bottom edge', () => {
    for (const size of [BLENDER_SIZE, { x: 1.5, y: 3.6 }, { x: 5, y: 12 }]) {
      const p: PropDef = { id: 'blender', art: 'blender', solid: true, position: { x: 50, y: 12.2 }, size };
      const r = new SceneRenderer(provider, { background: false });
      r.setLevel({ ...mockLevel('beach'), props: [p] });
      const v = r.blenderView!.view;
      expect(v.scale.y * BLENDER_LAYOUT.height).toBeCloseTo(size.y, 9);
      expect(v.position.y).toBeCloseTo(12.2 + size.y / 2, 9);
      r.destroy();
    }
    // a level without a solid blender draws the standard one
    const r = new SceneRenderer(provider, { background: false });
    r.setLevel({ ...mockLevel('beach'), props: [] });
    expect(r.blenderView!.view.scale.y * BLENDER_LAYOUT.height).toBeCloseTo(BLENDER_HEIGHT_M, 9);
    expect(BLENDER_HEIGHT_M).toBe(BLENDER_SIZE.y);
    r.destroy();
  });
});
