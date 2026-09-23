/**
 * S9 renderer: zones and beads are drawn from the manifest alone (role +
 * sensor polygon + zone tag; role + circle). Uses the real tikibar session
 * manifest so the renderer sees exactly what the run screen hands it.
 */
import { Container, Graphics, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { exampleCart } from '../../src/builder/exampleCart';
import type { Camera } from '../../src/model/coords';
import { courseFor } from '../../src/game/courses';
import { RunSession } from '../../src/game/session';
import type { RenderSnapshot, SceneManifest } from '../../src/model/snapshot';
import { SceneRenderer } from '../../src/render/scene';
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

const cam: Camera = { center: { x: 170, y: 3 }, zoom: 1, viewportWidth: 800, viewportHeight: 600 };

function snapOf(s: RunSession, manifest: SceneManifest): RenderSnapshot {
  return {
    step: 0,
    simTime: 0,
    alpha: 0,
    manifestRevision: manifest.revision,
    bodies: manifest.bodies.map((b) => ({ ...s.world.getTransform(b.id), id: b.id })),
  };
}

describe('S9 renderer: zones and beads', () => {
  it('draws both field zones behind the world and every bead in front of the load; pre-S9 world layers keep their indices', async () => {
    const s = await RunSession.create(exampleCart(), courseFor('tikibar')!, { beadCount: 300 });
    const r = new SceneRenderer(provider, { background: false, theme: 'tiki' });
    try {
      const m = s.world.manifest();
      r.render(m, snapOf(s, m), cam);
      const zoneLayer = r.view.children[1] as Container;
      expect(r.view.children[2]).toBe(r.world); // zones are behind the whole world (terrain included)
      expect(zoneLayer.children.map((c) => c.label).every((l) => l.startsWith('zone:'))).toBe(true);
      expect(zoneLayer.children).toHaveLength(2);
      // the zone layer follows the camera exactly like the world
      expect(zoneLayer.scale.x).toBe(r.world.scale.x);
      expect(zoneLayer.position.x).toBe(r.world.position.x);
      expect(zoneLayer.position.y).toBe(r.world.position.y);
      // each zone draws a real shape (not the empty fallback)
      for (const z of zoneLayer.children) expect((z as Container).children[0]).toBeInstanceOf(Graphics);

      const beadLayer = r.world.children[6] as Container;
      expect(beadLayer.children).toHaveLength(300);
      expect(beadLayer.children.every((c) => c.label.startsWith('bead:'))).toBe(true);
      // one shared GraphicsContext per radius (all beads share one radius)
      const ctxs = new Set(beadLayer.children.map((c) => ((c as Container).children[0] as Graphics).context));
      expect(ctxs.size).toBe(1);
      // three palette tints, by body id
      const tints = new Set(beadLayer.children.map((c) => ((c as Container).children[0] as Graphics).tint));
      expect(tints.size).toBe(3);
    } finally {
      r.destroy();
      s.destroy();
    }
  });

  it('a theme switch re-tints zones and beads; a destroyed bead disappears', async () => {
    const s = await RunSession.create(exampleCart(), courseFor('tikibar')!, { beadCount: 300 });
    const r = new SceneRenderer(provider, { background: false, theme: 'tiki' });
    try {
      const m = s.world.manifest();
      r.render(m, snapOf(s, m), cam);
      const beadLayer = r.world.children[6] as Container;
      const tintsBefore = beadLayer.children.map((c) => ((c as Container).children[0] as Graphics).tint);
      r.setTheme('beach');
      r.render(m, snapOf(s, m), cam);
      const tintsAfter = beadLayer.children.map((c) => ((c as Container).children[0] as Graphics).tint);
      expect(beadLayer.children).toHaveLength(300);
      expect(tintsAfter).not.toEqual(tintsBefore);
      expect((r.view.children[1] as Container).children).toHaveLength(2);

      const victim = s.controller.beads!.handles()[0]!;
      s.world.destroyBody(victim);
      const m2 = s.world.manifest();
      r.render(m2, snapOf(s, m2), cam);
      expect(beadLayer.children).toHaveLength(299);
      expect(beadLayer.children.some((c) => c.label === `bead:${victim}`)).toBe(false);
    } finally {
      r.destroy();
      s.destroy();
    }
  });

  it('a pre-S9 level draws no zone or bead visuals', async () => {
    const s = await RunSession.create(exampleCart(), courseFor('beach')!);
    const r = new SceneRenderer(provider, { background: false });
    try {
      const m = s.world.manifest();
      r.render(m, snapOf(s, m), cam);
      expect((r.view.children[1] as Container).children).toHaveLength(0);
      expect((r.world.children[6] as Container).children).toHaveLength(0);
    } finally {
      r.destroy();
      s.destroy();
    }
  });
});
