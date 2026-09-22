/**
 * SceneRenderer lifecycle in node: Pixi display objects are built without a
 * GPU renderer, textures come from a fake provider. Covers the cache /
 * ownership invariants the renderer relies on (audit round 1).
 */
import { Container, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { resolveAttachments } from '../../src/model/attach';
import type { Camera } from '../../src/model/coords';
import type { Vec2 } from '../../src/model/geometry';
import type { BodyTransform, RenderBodyInfo, RenderSnapshot, SceneManifest } from '../../src/model/snapshot';
import { AssetLibrary, type RasterBackend } from '../../src/render/assets';
import { SceneRenderer, bodyFingerprint } from '../../src/render/scene';
import { MOCK_CART, manifestFromSpec, mockLevel } from '../../src/render/styleguide/mockRun';
import type { TextureProvider } from '../../src/render/textures';

const texCache = new Map<string, Texture>();
const provider: TextureProvider = {
  has: () => true,
  texture(id) {
    let t = texCache.get(id);
    if (!t) {
      t = new Texture({ source: new TextureSource({ width: 64, height: 64, resolution: 1 }), label: id });
      texCache.set(id, t);
    }
    return t;
  },
};

const cam: Camera = { center: { x: 0, y: 0 }, zoom: 1, viewportWidth: 800, viewportHeight: 600 };

function snap(manifest: SceneManifest, poses: Record<number, Partial<BodyTransform>> = {}): RenderSnapshot {
  return {
    step: 0,
    simTime: 0,
    alpha: 0,
    manifestRevision: manifest.revision,
    bodies: manifest.bodies.map((b) => ({ id: b.id, x: 0, y: 0, angle: 0, ...poses[b.id] })),
  };
}

function terrainBody(id: number, ...chains: Vec2[][]): RenderBodyInfo {
  return { id, role: 'terrain', shapes: chains.map((points) => ({ type: 'chain' as const, points })) };
}

function tops(positions: Float32Array): Vec2[] {
  // fill mesh vertices come in [top_i, bottom_i] pairs
  const out: Vec2[] = [];
  for (let i = 0; i < positions.length; i += 4) out.push({ x: positions[i]!, y: positions[i + 1]! });
  return out;
}

/** Layer order inside `renderer.world` (see SceneRenderer constructor). */
const LAYER = { terrain: 0, decor: 1, cart: 2, wheel: 3, shock: 4, pineapple: 5 } as const;
const layer = (r: SceneRenderer, k: keyof typeof LAYER) => r.world.children[LAYER[k]] as Container;

describe('terrain cache invalidation', () => {
  const courseA = [{ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 20, y: 6 }];
  const courseB = [{ x: 0, y: 8 }, { x: 7, y: 2 }, { x: 30, y: 3 }];

  it('re-skins when a same-theme level reuses terrain body id 1 with a different course (any revision)', () => {
    const r = new SceneRenderer(provider, { background: false });
    const a: SceneManifest = { revision: 1, bodies: [terrainBody(1, courseA)] };
    r.render(a, snap(a), cam);
    expect(tops(r.terrainFillPositions()[0]!)).toEqual(courseA);
    // new world: same id, same shape count, same revision number
    const b: SceneManifest = { revision: 1, bodies: [terrainBody(1, courseB)] };
    r.render(b, snap(b), cam);
    expect(tops(r.terrainFillPositions()[0]!)).toEqual(courseB);
    // and with a bumped revision
    const c: SceneManifest = { revision: 2, bodies: [terrainBody(1, courseA)] };
    r.render(c, snap(c), cam);
    expect(tops(r.terrainFillPositions()[0]!)).toEqual(courseA);
    r.destroy();
  });

  it('re-skins when the terrain body pose changes; not when content is equal', () => {
    const r = new SceneRenderer(provider, { background: false });
    const a: SceneManifest = { revision: 1, bodies: [terrainBody(1, courseA)] };
    r.render(a, snap(a), cam);
    const fillMeshObj = () => (layer(r, 'terrain').children[0] as Container).children[0];
    const first = fillMeshObj();
    // equal content, fresh arrays (e.g. a re-sent manifest): mesh kept
    const same: SceneManifest = { revision: 1, bodies: [terrainBody(1, courseA.map((p) => ({ ...p })))] };
    r.render(same, snap(same), cam);
    expect(fillMeshObj()).toBe(first);
    // also across a revision bump with equal content
    const bumped: SceneManifest = { revision: 2, bodies: same.bodies };
    r.render(bumped, snap(bumped), cam);
    expect(fillMeshObj()).toBe(first);
    // moved body: mesh rebuilt in world space
    r.render(bumped, snap(bumped, { 1: { x: 3, y: -1 } }), cam);
    expect(tops(r.terrainFillPositions()[0]!)[0]).toEqual({ x: 3, y: 4 });
    r.destroy();
  });

  it('draws chains pushed IN PLACE into an existing shapes array when the revision bumps', () => {
    // mirrors PhysicsWorld.addChain: rec.shapes.push(...) + revision++
    const r = new SceneRenderer(provider, { background: false });
    const body = terrainBody(1, courseA);
    const m1: SceneManifest = { revision: 1, bodies: [body] };
    r.render(m1, snap(m1), cam);
    expect(r.stats.terrainChains).toBe(1);
    body.shapes.push({ type: 'chain', points: [{ x: 40, y: 5 }, { x: 60, y: 5 }] });
    const m2: SceneManifest = { revision: 2, bodies: [body] };
    r.render(m2, snap(m2), cam);
    expect(r.stats.terrainChains).toBe(2);
    expect(tops(r.terrainFillPositions()[1]!)).toEqual([{ x: 40, y: 5 }, { x: 60, y: 5 }]);
    r.destroy();
  });

  it('fresh arrays every frame at an unchanged revision cost no content signatures (bounded per-frame work)', () => {
    const r = new SceneRenderer(provider, { background: false });
    const big = Array.from({ length: 5000 }, (_, i) => ({ x: i * 0.1, y: Math.sin(i * 0.01) }));
    const make = (): SceneManifest => ({ revision: 4, bodies: [terrainBody(1, big.map((p) => ({ ...p })))] });
    const m = make();
    r.render(m, snap(m), cam);
    const spy = vi.spyOn(JSON, 'stringify');
    try {
      for (let i = 0; i < 5; i++) {
        const f = make();
        r.render(f, snap(f), cam);
      }
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    r.destroy();
  });

  it('diagnostic positions are copies (cannot corrupt the live mesh)', () => {
    const r = new SceneRenderer(provider, { background: false });
    const m: SceneManifest = { revision: 1, bodies: [terrainBody(1, courseA)] };
    r.render(m, snap(m), cam);
    r.terrainFillPositions()[0]![0] = Number.NaN;
    expect(r.terrainFillPositions()[0]![0]).toBe(0);
    r.destroy();
  });

  it('streams chunks: gaps stay gaps, touching chunks join', () => {
    const r = new SceneRenderer(provider, { background: false });
    const m: SceneManifest = {
      revision: 3,
      bodies: [
        terrainBody(1, [{ x: 0, y: 0 }, { x: 5, y: 0 }]),
        terrainBody(2, [{ x: 5, y: 0 }, { x: 9, y: 1 }]), // continues chunk 1
        terrainBody(3, [{ x: 9.00001, y: 1 }, { x: 12, y: 1 }]), // tiny real gap
      ],
    };
    r.render(m, snap(m), cam);
    expect(r.stats.terrainChains).toBe(2);
    r.destroy();
  });
});

describe('body visuals across sources', () => {
  const strawBody: RenderBodyInfo = {
    id: 10,
    role: 'cart',
    partIds: ['s1'],
    shapes: [{ type: 'polygon', partId: 's1', vertices: [{ x: -1, y: -0.08 }, { x: 1, y: -0.08 }, { x: 1, y: 0.08 }, { x: -1, y: 0.08 }] }],
  };
  const pineBody: RenderBodyInfo = { id: 10, role: 'pineapple', shapes: [{ type: 'circle', partId: 'p', center: { x: 0, y: 0 }, radius: 1 / 3 }] };

  it('a new source at the SAME revision reusing a body id rebuilds that body', () => {
    const r = new SceneRenderer(provider, { background: false });
    const a: SceneManifest = { revision: 10, bodies: [strawBody] };
    r.render(a, snap(a), cam);
    expect(layer(r, 'cart').children).toHaveLength(1);
    expect(layer(r, 'pineapple').children).toHaveLength(0);
    const b: SceneManifest = { revision: 10, bodies: [pineBody] };
    r.render(b, snap(b), cam);
    expect(layer(r, 'cart').children).toHaveLength(0);
    expect(layer(r, 'pineapple').children).toHaveLength(1);
    r.destroy();
  });

  it('a new world at the same revision with identical structure is picked up after resetSource()', () => {
    const r = new SceneRenderer(provider, { background: false });
    const a: SceneManifest = { revision: 3, bodies: [terrainBody(1, [{ x: 0, y: 0 }, { x: 5, y: 1 }, { x: 10, y: 0 }])] };
    r.render(a, snap(a), cam);
    // same ids/structure/end points, different interior point: documented tier-3 blind spot
    const b: SceneManifest = { revision: 3, bodies: [terrainBody(1, [{ x: 0, y: 0 }, { x: 5, y: 9 }, { x: 10, y: 0 }])] };
    r.resetSource();
    r.render(b, snap(b), cam);
    expect(tops(r.terrainFillPositions()[0]!)[1]).toEqual({ x: 5, y: 9 });
    r.destroy();
  });

  it('unchanged manifests do not rebuild anything', () => {
    const r = new SceneRenderer(provider, { background: false });
    const a: SceneManifest = { revision: 1, bodies: [strawBody] };
    r.render(a, snap(a), cam);
    const view = layer(r, 'cart').children[0];
    r.render({ revision: 1, bodies: [strawBody] }, snap(a, { 10: { x: 2 } }), cam);
    expect(layer(r, 'cart').children[0]).toBe(view);
    expect(view!.position.x).toBe(2);
    r.destroy();
  });

  it('same-revision fresh arrays whose partIds differ only in comma placement rebuild the body', () => {
    const poly = strawBody.shapes[0]!;
    const withIds = (partIds: string[]): SceneManifest => ({
      revision: 7,
      bodies: [{ ...strawBody, partIds, shapes: [{ ...poly }] }],
    });
    const a = withIds(['a,b', 'c']);
    const b = withIds(['a', 'b,c']);
    expect(bodyFingerprint(b.bodies[0]!)).not.toBe(bodyFingerprint(a.bodies[0]!));
    const r = new SceneRenderer(provider, { background: false });
    r.render(a, snap(a), cam);
    const view = layer(r, 'cart').children[0];
    r.render(b, snap(b), cam);
    expect(layer(r, 'cart').children).toHaveLength(1);
    expect(layer(r, 'cart').children[0]).not.toBe(view);
    r.destroy();
  });

  it('rebinds umbrella shocks when a new world reuses the revision with new body ids', () => {
    const spec = resolveAttachments(MOCK_CART);
    const r = new SceneRenderer(provider, { background: false });
    r.setCartDesign(MOCK_CART);
    const w1 = manifestFromSpec(spec, 10);
    const a: SceneManifest = { revision: 5, bodies: w1.bodies };
    r.render(a, snap(a), cam);
    expect(r.stats.shocks).toBe(2);
    expect(layer(r, 'shock').children.every((c) => c.visible)).toBe(true);
    // new world: same revision, different ids — the old bindings would point at bodies with no pose
    const w2 = manifestFromSpec(spec, 50);
    const b: SceneManifest = { revision: 5, bodies: w2.bodies };
    r.render(b, snap(b), cam);
    expect(r.stats.shocks).toBe(2);
    expect(layer(r, 'shock').children.every((c) => c.visible)).toBe(true);
    r.destroy();
  });
});

describe('prop ownership', () => {
  it('solid props render once (LevelDef art), survive theme/level changes, colliders are not drawn', () => {
    const r = new SceneRenderer(provider, { background: false });
    const level = mockLevel('beach');
    const solid = { ...level, props: [{ id: 'palm1', art: 'palm', position: { x: 4, y: 0 }, solid: true, size: { x: 1, y: 3 } }] };
    r.setLevel(solid);
    const collider: RenderBodyInfo = {
      id: 7,
      role: 'prop',
      shapes: [{ type: 'polygon', partId: 'palm1', vertices: [{ x: -0.5, y: -3 }, { x: 0.5, y: -3 }, { x: 0.5, y: 0 }, { x: -0.5, y: 0 }] }],
    };
    const m: SceneManifest = { revision: 1, bodies: [terrainBody(1, [{ x: 0, y: 0 }, { x: 10, y: 0 }]), collider] };
    r.render(m, snap(m), cam);
    expect(r.stats.bodies).toBe(0); // the collider has no visual of its own
    expect(r.stats.decor).toBe(2); // palm art + blender
    // magenta placeholder never appears anywhere in the body layers
    for (const k of ['cart', 'wheel', 'pineapple'] as const) expect(layer(r, k).children).toHaveLength(0);
    // theme change + level reload used to destroy containers still referenced by the body map
    r.setTheme('kitchen');
    expect(() => r.render(m, snap(m, { 7: { x: 1 } }), cam)).not.toThrow();
    r.setLevel({ ...solid, theme: 'workbench' });
    expect(() => r.render(m, snap(m), cam)).not.toThrow();
    expect(r.stats.decor).toBe(2);
    r.setLevel(null);
    expect(r.stats.decor).toBe(0);
    r.destroy();
  });
});

describe('AssetLibrary destroyed while loading', () => {
  it('ready resolves (not rejects) when rasterisation FAILS after destroy; rejects on a live library', async () => {
    let fail!: (e: Error) => void;
    const gate = new Promise<never>((_, rej) => (fail = rej));
    const backend: RasterBackend = {
      createCanvas: (width, height) => ({ width, height, getContext: () => ({ clearRect() {}, drawImage() {} }) }),
      loadSvg: () => gate,
    };
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>';
    const lib = new AssetLibrary([{ id: 'x/y', svg }], { resolution: 1, backend });
    lib.destroy();
    fail(new Error('decode failed'));
    await expect(lib.ready).resolves.toBeUndefined();
    expect(lib.isReady).toBe(false);
    expect(() => lib.texture('x/y')).toThrow(/destroyed/);

    const live = new AssetLibrary([{ id: 'x/y', svg }], {
      resolution: 1,
      backend: { ...backend, loadSvg: () => Promise.reject(new Error('decode failed')) },
    });
    await expect(live.ready).rejects.toThrow(/x\/y/);
  });

  it('never uploads, never becomes ready, and ready still settles', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    let drawn = 0;
    const backend: RasterBackend = {
      createCanvas: (width, height) => ({
        width,
        height,
        getContext: () => ({ clearRect() {}, drawImage: () => void drawn++ }),
      }),
      loadSvg: async () => {
        await gate;
        return {};
      },
    };
    const lib = new AssetLibrary([{ id: 'a/b', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>' }], {
      resolution: 1,
      backend,
    });
    lib.destroy();
    release();
    await lib.ready;
    expect(lib.isReady).toBe(false);
    expect(lib.isDestroyed).toBe(true);
    expect(lib.has('a/b')).toBe(false);
    expect(lib.ids()).toEqual([]);
    expect(lib.atlasPageCount).toBe(0);
    expect(() => lib.texture('a/b')).toThrow(/destroyed/);
  });
});

describe('S6 level decor conventions', () => {
  const noArt: TextureProvider = { has: (id) => !id.startsWith('prop/'), texture: provider.texture };

  it('the blender prop is the goal: BlenderView stands on its bottom-centre and no placeholder is drawn', () => {
    const r = new SceneRenderer(provider, { background: false });
    const level = mockLevel('beach');
    r.setLevel({
      ...level,
      props: [{ id: 'blender', art: 'blender', solid: true, position: { x: 50, y: 12.2 }, size: { x: 1.5, y: 3.6 } }],
    });
    const decor = layer(r, 'decor');
    expect(decor.children).toHaveLength(1); // just the BlenderView
    const bv = r.blenderView!;
    expect(decor.children[0]).toBe(bv.view);
    expect(bv.view.position.x).toBeCloseTo(50, 9);
    expect(bv.view.position.y).toBeCloseTo(12.2 + 1.8, 9);
    r.destroy();
  });

  it('solid props are drawn CENTRED on position (run/props.ts convention), decor props stand on it', () => {
    const r = new SceneRenderer(noArt, { background: false });
    const level = mockLevel('beach');
    r.setLevel({
      ...level,
      props: [
        { id: 'crate', art: 'crate', solid: true, position: { x: 5, y: 3 }, size: { x: 2, y: 1 }, angle: 0.3 },
        { id: 'deco', art: 'thing', position: { x: 8, y: 4 } },
      ],
    });
    const [crate, deco] = layer(r, 'decor').children;
    expect(crate!.position.x).toBe(5);
    expect(crate!.position.y).toBe(3);
    expect(crate!.rotation).toBeCloseTo(0.3, 9);
    const b = crate!.getLocalBounds();
    expect(b.minX).toBeCloseTo(-1, 1); // + half the outline stroke
    expect(b.maxX).toBeCloseTo(1, 1);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(0, 3); // centred, not bottom-anchored
    const d = deco!.getLocalBounds();
    expect(d.maxY).toBeCloseTo(0, 3); // decor placeholder still stands on its position
    r.destroy();
  });

  it('solid props with art stand the art on the box bottom', () => {
    const r = new SceneRenderer(provider, { background: false });
    r.setLevel({ ...mockLevel('beach'), props: [{ id: 'p', art: 'palm', solid: true, position: { x: 4, y: 2 }, size: { x: 1, y: 3 } }] });
    const holder = layer(r, 'decor').children[0] as Container;
    expect(holder.position.y).toBe(2);
    expect(holder.children[0]!.position.y).toBeCloseTo(1.5, 9);
    r.destroy();
  });

  it('funnel: drawn from geometry, plug hidden on release, survives level and theme changes', () => {
    const r = new SceneRenderer(provider, { background: false });
    r.setLevel(mockLevel('beach'));
    const wall = [{ x: 0, y: 0 }, { x: -1, y: -3 }, { x: -1.2, y: -3 }, { x: -0.2, y: 0 }];
    r.setFunnel({ walls: [wall, wall.map((p) => ({ x: -p.x, y: p.y }))], plug: [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.2 }, { x: -1, y: 0.2 }] });
    expect(r.stats.funnel).toBe(true);
    const funnel = () => r.world.children.find((c) => c.label === 'funnel') as Container;
    expect(funnel().children).toHaveLength(3);
    expect(funnel().children[2]!.visible).toBe(true);
    r.setFunnelOpen(true);
    expect(funnel().children[2]!.visible).toBe(false);
    r.setTheme('kitchen');
    r.setLevel(mockLevel('workbench'));
    expect(r.world.children.filter((c) => c.label === 'funnel')).toHaveLength(1);
    expect(funnel().children[2]!.visible).toBe(false);
    r.setFunnel(null);
    expect(r.stats.funnel).toBe(false);
    r.destroy();
  });
});
