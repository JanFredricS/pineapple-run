import { describe, expect, it } from 'vitest';
import { resolveAttachments } from '../../src/model/attach';
import { STRAW_THICKNESS_PX, type CartDesign } from '../../src/model/cart';
import { PX_PER_M, cameraTransform } from '../../src/model/coords';
import { orientedBox, thickSegment } from '../../src/model/geometry';
import type { RenderBodyInfo, SceneManifest } from '../../src/model/snapshot';
import { ART } from '../../src/render/artCatalog';
import { blenderFillPolygon } from '../../src/render/blender';
import { baseLayerScale, layerPlacement } from '../../src/render/parallax';
import {
  applyTransform,
  bindShocks,
  boxFromPolygon,
  canopyFor,
  circleSpritePose,
  classifyShape,
  inverseTransform,
  partKinds,
  shockPose,
  worldBox,
} from '../../src/render/pose';
import { MOCK_CART, MockRunSource, manifestFromSpec, mockGround } from '../../src/render/styleguide/mockRun';
import { bodySignature } from '../../src/render/scene';

const close = (a: { x: number; y: number }, b: { x: number; y: number }, digits = 9) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

describe('transforms', () => {
  it('apply / inverse round-trip; rotation is clockwise-on-screen for positive angles (y-down)', () => {
    const t = { x: 3, y: -2, angle: 0.7 };
    const p = { x: 1.25, y: -0.5 };
    close(inverseTransform(t, applyTransform(t, p)), p);
    close(applyTransform({ x: 0, y: 0, angle: Math.PI / 2 }, { x: 1, y: 0 }), { x: 0, y: 1 });
  });
});

describe('boxFromPolygon', () => {
  it('recovers a straw (thickSegment) box: long axis along the straw', () => {
    const t = STRAW_THICKNESS_PX / PX_PER_M;
    const a = { x: 1, y: 1 };
    const b = { x: 3, y: 2 };
    const box = boxFromPolygon(thickSegment(a, b, t));
    close(box.center, { x: 2, y: 1.5 });
    // thickSegment extends t/2 past each end
    expect(box.width).toBeCloseTo(Math.hypot(2, 1) + t);
    expect(box.height).toBeCloseTo(t);
    expect(Math.cos(box.angle)).toBeCloseTo(Math.cos(Math.atan2(1, 2)));
  });

  it('normalises width >= height for tall boxes and composes with a body transform', () => {
    const box = boxFromPolygon(orientedBox({ x: 0, y: 0 }, 0.2, 0.6, 0));
    expect(box.width).toBeCloseTo(1.2);
    expect(box.height).toBeCloseTo(0.4);
    const w = worldBox({ id: 1, x: 5, y: 1, angle: 0.3 }, { ...box, center: { x: 1, y: 0 } });
    close(w.center, { x: 5 + Math.cos(0.3), y: 1 + Math.sin(0.3) });
    expect(w.angle).toBeCloseTo(0.3 + box.angle);
    expect(() => boxFromPolygon([{ x: 0, y: 0 }])).toThrow();
  });
});

describe('circleSpritePose', () => {
  it('maps the texture fit circle onto the collision circle', () => {
    const tex = { width: 96, height: 128 };
    const fit = ART.pineapple.fit;
    const body = { id: 1, x: 10, y: 4, angle: 1.1 };
    const pose = circleSpritePose(body, { center: { x: 0.2, y: 0 }, radius: 1 / 3 }, fit, tex);
    // collision centre in world
    close({ x: pose.x, y: pose.y }, applyTransform(body, { x: 0.2, y: 0 }));
    expect(pose.rotation).toBe(1.1);
    expect(pose.scale * fit.r).toBeCloseTo(1 / 3);
    expect(pose.anchorX * tex.width).toBeCloseTo(fit.cx);
    expect(pose.anchorY * tex.height).toBeCloseTo(fit.cy);
    // a texture point on the fit circle's right edge lands on the collision circle edge (rotated)
    const edgeLocal = { x: (fit.cx + fit.r - pose.anchorX * tex.width) * pose.scale, y: 0 };
    const edgeWorld = applyTransform({ x: pose.x, y: pose.y, angle: pose.rotation }, edgeLocal);
    expect(Math.hypot(edgeWorld.x - pose.x, edgeWorld.y - pose.y)).toBeCloseTo(1 / 3);
  });
});

describe('classifyShape', () => {
  const straw = { type: 'polygon' as const, partId: 's', vertices: thickSegment({ x: 0, y: 0 }, { x: 2, y: 0 }, STRAW_THICKNESS_PX / PX_PER_M) };
  const cube = { type: 'polygon' as const, partId: 'c', vertices: orientedBox({ x: 0, y: 0 }, 0.35, 0.35, 0) };
  const circle = { type: 'circle' as const, partId: 'x', center: { x: 0, y: 0 }, radius: 0.3 };
  const cart: RenderBodyInfo = { id: 1, role: 'cart', shapes: [] };
  const wheel: RenderBodyInfo = { id: 2, role: 'wheel', shapes: [] };

  it('uses design part kinds when known', () => {
    const kinds = partKinds({ version: 1, name: '', parts: [{ id: 'x', kind: 'wheel', center: { x: 0, y: 0 }, radius: 9 }] } as CartDesign);
    expect(classifyShape(cart, circle, kinds)).toBe('wheel');
  });

  it('falls back to geometry / body role', () => {
    expect(classifyShape(cart, straw)).toBe('straw');
    expect(classifyShape(cart, cube)).toBe('cube');
    expect(classifyShape(cart, circle)).toBe('lime');
    expect(classifyShape(wheel, circle)).toBe('wheel');
    expect(classifyShape({ id: 3, role: 'pineapple', shapes: [] }, circle)).toBe('pineapple');
    expect(classifyShape({ id: 4, role: 'prop', shapes: [] }, circle)).toBe('unknown-circle');
    expect(classifyShape({ id: 4, role: 'prop', shapes: [] }, cube)).toBe('unknown-polygon');
  });

  it('classifies every shape of the mock cart as its design kind', () => {
    const src = new MockRunSource();
    const kinds = partKinds(MOCK_CART);
    for (const b of src.manifest().bodies) {
      if (b.role !== 'cart' && b.role !== 'wheel') continue;
      for (const s of b.shapes) {
        if (s.type === 'chain') continue;
        const byKind = classifyShape(b, s, kinds);
        expect(byKind).toBe(kinds.get(s.partId));
        // the heuristic agrees with the design for this cart
        expect(classifyShape(b, s)).toBe(byKind === 'wheel' && b.role !== 'wheel' ? 'lime' : byKind);
      }
    }
  });
});

describe('coil-spring shocks', () => {
  const spec = resolveAttachments(MOCK_CART);
  const { bodies, ids } = manifestFromSpec(spec, 10);
  const manifest: SceneManifest = { revision: 1, bodies };
  const start = { x: 7, y: 3 };
  const restPose = (id: string) => {
    const b = spec.bodies.find((x) => x.id === id)!;
    return { id: ids.get(id)!, x: start.x + b.origin.x, y: start.y + b.origin.y, angle: 0 };
  };

  it('binds every distance joint to manifest bodies by part id', () => {
    const joints = spec.joints.filter((j) => j.type === 'distance');
    const binds = bindShocks(spec, manifest);
    expect(joints.length).toBe(2);
    expect(binds.map((b) => b.partId).sort()).toEqual(['k1', 'k2']);
    for (const b of binds) expect(b.bodyA).not.toBe(b.bodyB);
  });

  it('at the build pose, shock ends sit on the design anchors and ratio = 1', () => {
    const binds = bindShocks(spec, manifest);
    const joints = spec.joints.filter((j) => j.type === 'distance');
    for (const bind of binds) {
      const j = joints.find((x) => x.partId === bind.partId)!;
      const specA = spec.bodies.find((b) => ids.get(b.id) === bind.bodyA)!;
      const specB = spec.bodies.find((b) => ids.get(b.id) === bind.bodyB)!;
      const p = shockPose(bind, restPose(specA.id), restPose(specB.id));
      close(p.a, { x: start.x + j.anchorA.x, y: start.y + j.anchorA.y });
      close(p.b, { x: start.x + j.anchorB.x, y: start.y + j.anchorB.y });
      expect(p.ratio).toBeCloseTo(1);
      expect(Math.cos(p.angle) * p.length).toBeCloseTo(p.b.x - p.a.x);
    }
  });

  it('skips shocks whose bodies are not in the manifest', () => {
    expect(bindShocks(spec, { revision: 2, bodies: bodies.filter((b) => b.role !== 'wheel') })).toEqual([]);
  });

  it('canopy opens as the spring compresses and folds as it extends', () => {
    expect(canopyFor(0.7)).toEqual({ frame: 'open', spread: 1 });
    expect(canopyFor(1).frame).toBe('half');
    expect(canopyFor(1.3)).toEqual({ frame: 'closed', spread: 0 });
    expect(canopyFor(Number.NaN).frame).toBe('half');
    let last = 2;
    for (let r = 0.6; r <= 1.4; r += 0.05) {
      const s = canopyFor(r).spread;
      expect(s).toBeLessThanOrEqual(last);
      last = s;
    }
  });
});

describe('scene body signature', () => {
  it('changes when an id is reused for different content (new world), not when poses change', () => {
    const a: RenderBodyInfo = { id: 10, role: 'cart', partIds: ['s1'], shapes: [] };
    expect(bodySignature(a)).toBe(bodySignature({ ...a }));
    expect(bodySignature(a)).not.toBe(bodySignature({ ...a, role: 'pineapple' }));
    expect(bodySignature(a)).not.toBe(bodySignature({ ...a, partIds: ['s2'] }));
  });
});

describe('mock run source (snapshot contract)', () => {
  it('emits a finite transform for every manifest body', () => {
    const src = new MockRunSource();
    src.advance(5);
    const m = src.manifest();
    const s = src.snapshot();
    expect(new Set(s.bodies.map((b) => b.id))).toEqual(new Set(m.bodies.map((b) => b.id)));
    for (const b of s.bodies) expect(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.angle)).toBe(true);
  });

  it('wheels rest on the terrain surface (centre = ground - radius) away from the gap', () => {
    const src = new MockRunSource();
    const wheels = src.manifest().bodies.filter((b) => b.role === 'wheel');
    expect(wheels).toHaveLength(2);
    let checked = 0;
    for (let t = 0; t < 30; t += 0.37) {
      src.time = t;
      const snap = src.snapshot();
      for (const w of wheels) {
        const shape = w.shapes[0]!;
        if (shape.type !== 'circle') throw new Error('wheel shape');
        const tr = snap.bodies.find((b) => b.id === w.id)!;
        if (tr.x > 45 && tr.x < 49.5) continue; // bridging the gap
        expect(tr.y + shape.radius, `t=${t.toFixed(2)} x=${tr.x.toFixed(2)}`).toBeCloseTo(mockGround(tr.x), 6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('all rigid cart bodies share the chassis angle', () => {
    const src = new MockRunSource();
    src.time = 12.3;
    const snap = src.snapshot();
    const cart = src.manifest().bodies.filter((b) => b.role === 'cart');
    const poses = cart.map((b) => snap.bodies.find((x) => x.id === b.id)!);
    for (const p of poses) expect(p.angle).toBeCloseTo(poses[0]!.angle);
  });
});

describe('parallax placement', () => {
  const cam = { center: { x: 0, y: 0 }, zoom: 1, viewportWidth: 1280, viewportHeight: 720 };
  const tex = { width: 1024, height: 300 };

  it('factor 0 layers are screen-fixed; factor f scrolls f times as fast', () => {
    const a = layerPlacement({ factor: 0 }, tex, cam, 0);
    const b = layerPlacement({ factor: 0 }, tex, { ...cam, center: { x: 17, y: 3 } }, 0);
    for (const k of ['scale', 'tileX', 'tileY', 'bottomY'] as const) expect(b[k] + 0).toBeCloseTo(a[k] + 0);
    const p0 = layerPlacement({ factor: 0.25 }, tex, cam, 0);
    const p1 = layerPlacement({ factor: 0.25 }, tex, { ...cam, center: { x: 1, y: 0 } }, 0);
    // moved left by 0.25 * 30 px (mod the tile period)
    const d = (p0.tileX - p1.tileX + tex.width) % tex.width;
    expect(d).toBeCloseTo(0.25 * PX_PER_M);
  });

  it('tile offsets are wrapped into (-period, 0]', () => {
    for (const x of [-500, -3, 0, 12.5, 999]) {
      const p = layerPlacement({ factor: 0.4 }, tex, { ...cam, center: { x, y: x / 3 } }, 2);
      expect(p.tileX).toBeLessThanOrEqual(0);
      expect(p.tileX).toBeGreaterThan(-tex.width * p.scale - 1e-9);
      expect(p.tileY).toBeLessThanOrEqual(0);
    }
  });

  it('band bottom tracks the horizon; zoom scales near layers more than far ones', () => {
    const at = layerPlacement({ factor: 0.5, bottom: 40 }, tex, cam, 0);
    expect(at.bottomY).toBe(360 + 40);
    const below = layerPlacement({ factor: 0.5, bottom: 40 }, tex, { ...cam, center: { x: 0, y: 2 } }, 0);
    expect(below.bottomY).toBeCloseTo(400 - 2 * PX_PER_M * 0.5); // camera lower -> horizon moves up
    const zNear = layerPlacement({ factor: 0.5 }, tex, { ...cam, zoom: 2 }, 0).scale;
    const zFar = layerPlacement({ factor: 0.05 }, tex, { ...cam, zoom: 2 }, 0).scale;
    expect(zNear).toBeGreaterThan(zFar);
    expect(baseLayerScale(360)).toBe(0.5);
    expect(baseLayerScale(4000)).toBe(1.6);
  });

  it('world camera transform matches the S0 contract used by the scene', () => {
    const ct = cameraTransform({ ...cam, center: { x: 2, y: 1 } });
    expect(ct.scale).toBe(PX_PER_M);
    expect(ct.offsetX).toBe(640 - 2 * PX_PER_M);
  });
});

describe('blender fill', () => {
  it('empty at 0, rises with progress, stays inside the jar', () => {
    expect(blenderFillPolygon(0, 0, 0)).toEqual([]);
    const lo = blenderFillPolygon(0.2, 0, 0);
    const hi = blenderFillPolygon(0.9, 0, 0);
    const top = (poly: { y: number }[]) => Math.min(...poly.map((p) => p.y));
    expect(top(hi)).toBeLessThan(top(lo));
    for (const poly of [lo, hi, blenderFillPolygon(1, 2, 1), blenderFillPolygon(5, 1, 1)]) {
      for (const p of poly) {
        expect(p.x).toBeGreaterThanOrEqual(20 - 1e-9);
        expect(p.x).toBeLessThanOrEqual(124 + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(22 - 1e-9);
        expect(p.y).toBeLessThanOrEqual(190 + 1e-9);
      }
    }
  });

  it('the vortex dips the middle of the surface', () => {
    const calm = blenderFillPolygon(0.6, 0, 0, 16);
    const whirl = blenderFillPolygon(0.6, 0, 1, 16);
    expect(whirl[8]!.y).toBeGreaterThan(calm[8]!.y + 5);
  });
});
