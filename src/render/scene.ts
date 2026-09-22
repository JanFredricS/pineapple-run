/**
 * SceneRenderer (S4): draws a run from the S0 render contract only —
 * SceneManifest (what each body is) + RenderSnapshot (interpolated poses) —
 * plus optional static context (LevelDef for theme/props/goal, CartDesign for
 * part kinds and umbrella shocks, which are joints and so aren't manifest
 * bodies). It never sees a physics object.
 *
 * Layers (back to front): parallax sky/layers (screen space) | world:
 * terrain (fill, depth shade, edge strip) -> props + blender -> cart bodies
 * -> wheels -> shocks -> pineapples.
 *
 * Each body gets a Container built once in BODY-LOCAL metres from its
 * manifest shapes; per frame only its position/rotation change. Visuals are
 * diffed by body id when the manifest revision changes, so streamed terrain
 * chunks or spawned pineapples never rebuild the rest. Terrain meshes are
 * rebuilt only when the set of terrain bodies changes.
 */

import { Container, MeshSimple, NineSliceSprite, Sprite, Texture, TilingSprite, Graphics } from 'pixi.js';
import { resolveAttachments, type CompoundSpec, type ShapeSpec } from '../model/attach';
import type { CartDesign, PartKind } from '../model/cart';
import { cameraTransform, type Camera } from '../model/coords';
import type { Vec2 } from '../model/geometry';
import type { LevelDef, ThemeId } from '../model/level';
import type { BodyTransform, RenderBodyInfo, RenderSnapshot, SceneManifest } from '../model/snapshot';
import { ART, BLENDER_LAYOUT, PROP_ART } from './artCatalog';
import { BlenderView } from './blender';
import { ParallaxBackground } from './parallax';
import {
  bindShocks,
  boxFromPolygon,
  canopyFor,
  circleSpritePose,
  classifyShape,
  partKinds,
  shockPose,
  type ShockBinding,
} from './pose';
import { chainPolylines, edgeStrip, fillMesh, maxY, medianY, shadeMesh, type MeshData } from './terrainMesh';
import { getTheme, hexToNumber, themeAssetId, type Theme } from './themes';
import { SHADE_ID, type TextureProvider } from './textures';

/** How far below the deepest terrain point the fill extends (m). */
export const TERRAIN_FILL_DEPTH_M = 40;
/** World height of the blender goal (m). */
export const BLENDER_HEIGHT_M = 3.6;
/** Visual thickness of the umbrella shaft (m). */
const SHOCK_SHAFT_M = 0.09;
const PIN_DIAMETER_M = 0.16;

interface BodyVisual {
  id: number;
  role: RenderBodyInfo['role'];
  /** Content signature: an id reused for different content (new world) is rebuilt. */
  sig: string;
  view: Container;
}

/** Everything that determines a body's art (not its pose). */
export function bodySignature(info: RenderBodyInfo): string {
  return JSON.stringify([info.role, info.partIds ?? [], info.shapes]);
}

interface ShockVisual {
  binding: ShockBinding;
  view: Container;
  stick: Sprite;
  canopy: Sprite;
  pinA: Sprite;
  pinB: Sprite;
}

export interface SceneRendererOptions {
  theme?: ThemeId;
  /** Draw the sky + parallax layers (default true). */
  background?: boolean;
}

export class SceneRenderer {
  /** Add this to the stage. */
  readonly view = new Container();
  readonly world = new Container();
  private background: ParallaxBackground | null = null;
  private readonly bgHost = new Container();
  private readonly terrainLayer = new Container();
  private readonly propLayer = new Container();
  private readonly cartLayer = new Container();
  private readonly wheelLayer = new Container();
  private readonly shockLayer = new Container();
  private readonly pineappleLayer = new Container();

  private theme: Theme;
  private level: LevelDef | null = null;
  private kinds = new Map<string, PartKind>();
  private spec: CompoundSpec | null = null;
  private shocks: ShockVisual[] = [];
  private shockKey = '';

  private bodies = new Map<number, BodyVisual>();
  private manifestRevision = -1;
  private manifest: SceneManifest | null = null;
  private terrainKey = '';
  private horizonY = 0;
  private blender: BlenderView | null = null;
  private readonly withBackground: boolean;

  constructor(
    private readonly textures: TextureProvider,
    opts: SceneRendererOptions = {},
  ) {
    this.theme = getTheme(opts.theme ?? 'beach');
    this.withBackground = opts.background ?? true;
    this.world.addChild(this.terrainLayer, this.propLayer, this.cartLayer, this.wheelLayer, this.shockLayer, this.pineappleLayer);
    this.view.addChild(this.bgHost, this.world);
    this.rebuildBackground();
  }

  get themeId(): ThemeId {
    return this.theme.id;
  }

  /** Switch theme (its textures must be in the provider). Rebuilds background + terrain skin. */
  setTheme(id: ThemeId): void {
    if (id === this.theme.id) return;
    this.theme = getTheme(id);
    this.rebuildBackground();
    this.terrainKey = ''; // force re-skin
    if (this.blender) this.placeLevelDecor();
  }

  /** Static level context: theme, props, blender goal. Terrain comes from the manifest. */
  setLevel(level: LevelDef | null): void {
    this.level = level;
    if (level) this.setTheme(level.theme);
    this.placeLevelDecor();
  }

  /** Cart design (for part kinds + umbrella shocks). Pass null to fall back to geometry heuristics. */
  setCartDesign(design: CartDesign | null): void {
    this.kinds = partKinds(design);
    this.spec = design ? resolveAttachments(design) : null;
    // part kinds affect body art: rebuild cart bodies next sync
    for (const [id, v] of this.bodies) {
      if (v.role === 'cart' || v.role === 'wheel') {
        v.view.destroy({ children: true });
        this.bodies.delete(id);
      }
    }
    this.manifestRevision = -1;
    this.shockKey = '';
  }

  /** Goal animation inputs. */
  setGoal(progress: number, whir: number): void {
    if (!this.blender) return;
    this.blender.progress = progress;
    this.blender.whir = whir;
  }

  get blenderView(): BlenderView | null {
    return this.blender;
  }

  /**
   * Draw one frame. `dt` (seconds) only drives cosmetic animation (blender);
   * all body motion comes from the snapshot.
   */
  render(manifest: SceneManifest, snapshot: RenderSnapshot, camera: Camera, dt = 1 / 60): void {
    this.sync(manifest);
    const byId = new Map<number, BodyTransform>();
    for (const b of snapshot.bodies) byId.set(b.id, b);

    this.syncTerrain(manifest, byId);

    for (const v of this.bodies.values()) {
      const t = byId.get(v.id);
      v.view.visible = !!t;
      if (!t) continue;
      v.view.position.set(t.x, t.y);
      v.view.rotation = t.angle;
    }
    this.updateShocks(manifest, byId);
    this.blender?.update(dt);

    const ct = cameraTransform(camera);
    this.world.scale.set(ct.scale);
    this.world.position.set(ct.offsetX, ct.offsetY);
    this.background?.update(camera, this.horizonY);
  }

  // ---------------------------------------------------------------- bodies

  private sync(manifest: SceneManifest): void {
    this.manifest = manifest;
    if (manifest.revision === this.manifestRevision) return;
    this.manifestRevision = manifest.revision;
    const live = new Set<number>();
    for (const info of manifest.bodies) {
      if (info.role === 'terrain' || info.role === 'debug') continue;
      live.add(info.id);
      const sig = bodySignature(info);
      const existing = this.bodies.get(info.id);
      if (existing) {
        if (existing.sig === sig) continue;
        existing.view.destroy({ children: true });
      }
      const view = this.buildBody(info);
      this.layerFor(info.role).addChild(view);
      this.bodies.set(info.id, { id: info.id, role: info.role, sig, view });
    }
    for (const [id, v] of this.bodies) {
      if (!live.has(id)) {
        v.view.destroy({ children: true });
        this.bodies.delete(id);
      }
    }
  }

  private layerFor(role: RenderBodyInfo['role']): Container {
    switch (role) {
      case 'wheel':
        return this.wheelLayer;
      case 'pineapple':
        return this.pineappleLayer;
      case 'prop':
        return this.propLayer;
      default:
        return this.cartLayer;
    }
  }

  private buildBody(info: RenderBodyInfo): Container {
    const c = new Container();
    c.label = `body:${info.id}`;
    // straws first so cubes/limes sit on top of the frame
    const shapes = [...info.shapes].filter((s): s is ShapeSpec => s.type !== 'chain');
    const order = (s: ShapeSpec) => (classifyShape(info, s, this.kinds) === 'straw' ? 0 : 1);
    shapes.sort((a, b) => order(a) - order(b));
    for (const shape of shapes) {
      const art = classifyShape(info, shape, this.kinds);
      const v = this.buildShape(art, shape);
      if (v) c.addChild(v);
    }
    return c;
  }

  private buildShape(art: ReturnType<typeof classifyShape>, shape: ShapeSpec): Container | null {
    const ident = { id: 0, x: 0, y: 0, angle: 0 };
    if (shape.type === 'circle') {
      const def = art === 'pineapple' ? ART.pineapple : art === 'wheel' ? ART.cap : art === 'lime' ? ART.lime : null;
      if (!def) return this.placeholderCircle(shape.center, shape.radius);
      const tex = this.textures.texture(def.id);
      const pose = circleSpritePose(ident, shape, def.fit, tex);
      const s = new Sprite(tex);
      s.anchor.set(pose.anchorX, pose.anchorY);
      s.position.set(pose.x, pose.y);
      s.scale.set(pose.scale);
      return s;
    }
    if (shape.vertices.length !== 4) return this.placeholderPoly(shape.vertices);
    const box = boxFromPolygon(shape.vertices);
    const holder = new Container();
    holder.position.set(box.center.x, box.center.y);
    holder.rotation = box.angle;
    if (art === 'straw') {
      // texture px -> metres: the 16 px tile height spans the straw thickness
      const bodyTex = this.textures.texture(ART.straw.id);
      const endTex = this.textures.texture(ART.strawEnd.id);
      const s = box.height / bodyTex.height;
      const inner = new Container();
      inner.scale.set(s);
      const len = Math.max(0, box.width - box.height) / s; // between end-cap centres
      for (const dir of [-1, 1]) {
        const end = new Sprite(endTex);
        end.anchor.set(0.5);
        end.scale.set(bodyTex.height / endTex.height);
        end.position.set((dir * len) / 2, 0);
        inner.addChild(end);
      }
      const tile = new TilingSprite({ texture: bodyTex, width: len, height: bodyTex.height });
      tile.anchor.set(0.5);
      inner.addChild(tile);
      holder.addChild(inner);
      return holder;
    }
    if (art === 'cube') {
      const tex = this.textures.texture(ART.cube.id);
      const b = ART.cube.border;
      // corner radius ~ 22% of the short side (texture corners are 16/64 px)
      const s = Math.max(1e-4, (Math.min(box.width, box.height) * 0.28) / b);
      const ns = new NineSliceSprite({ texture: tex, leftWidth: b, rightWidth: b, topHeight: b, bottomHeight: b });
      ns.width = Math.max(2 * b, box.width / s);
      ns.height = Math.max(2 * b, box.height / s);
      ns.pivot.set(ns.width / 2, ns.height / 2);
      ns.scale.set(s);
      holder.addChild(ns);
      return holder;
    }
    holder.destroy();
    return this.placeholderPoly(shape.vertices);
  }

  private placeholderCircle(center: Vec2, r: number): Graphics {
    return new Graphics().circle(center.x, center.y, r).fill({ color: 0xff00ff, alpha: 0.5 });
  }

  private placeholderPoly(vertices: readonly Vec2[]): Graphics {
    return new Graphics().poly(vertices.flatMap((p) => [p.x, p.y])).fill({ color: 0xff00ff, alpha: 0.5 });
  }

  // ---------------------------------------------------------------- shocks

  private updateShocks(manifest: SceneManifest, byId: Map<number, BodyTransform>): void {
    const key = this.spec ? `${manifest.revision}` : '';
    if (key !== this.shockKey) {
      this.shockKey = key;
      for (const s of this.shocks) s.view.destroy({ children: true });
      this.shocks = this.spec ? bindShocks(this.spec, manifest).map((b) => this.buildShock(b)) : [];
    }
    for (const s of this.shocks) {
      const ta = byId.get(s.binding.bodyA);
      const tb = byId.get(s.binding.bodyB);
      s.view.visible = !!(ta && tb);
      if (!ta || !tb) continue;
      const p = shockPose(s.binding, ta, tb);
      s.view.position.set(p.a.x, p.a.y);
      s.view.rotation = p.angle;
      s.stick.scale.x = p.length / s.stick.texture.width;
      s.pinB.position.set(p.length, 0);
      const { frame, spread } = canopyFor(p.ratio);
      const tex = this.textures.texture(ART.umbrella[frame].id);
      if (s.canopy.texture !== tex) s.canopy.texture = tex;
      const rest = s.binding.restLength;
      const cs = Math.min(rest, 1.6) * 0.62 / tex.width; // canopy ~62% of rest length along the axis
      s.canopy.scale.set(cs, cs * (0.92 + 0.16 * spread));
      s.canopy.position.set(Math.min(p.length * 0.12, 0.2), 0);
    }
  }

  private buildShock(binding: ShockBinding): ShockVisual {
    const view = new Container();
    const stickTex = this.textures.texture(ART.umbrellaStick.id);
    const stick = new Sprite(stickTex);
    stick.anchor.set(0, 0.5);
    stick.scale.y = SHOCK_SHAFT_M / 5; // 5 px of the 8 px texture is the shaft
    const canopy = new Sprite(this.textures.texture(ART.umbrella.half.id));
    canopy.anchor.set(ART.umbrella.apexX / 64, ART.umbrella.axisY / 96);
    const pinTex = this.textures.texture(ART.pin.id);
    const pin = () => {
      const p = new Sprite(pinTex);
      p.anchor.set(0.5);
      p.scale.set(PIN_DIAMETER_M / pinTex.width);
      return p;
    };
    const pinA = pin();
    const pinB = pin();
    view.addChild(stick, canopy, pinA, pinB);
    this.shockLayer.addChild(view);
    return { binding, view, stick, canopy, pinA, pinB };
  }

  // ---------------------------------------------------------------- terrain

  private syncTerrain(manifest: SceneManifest, byId: Map<number, BodyTransform>): void {
    const terrain = manifest.bodies.filter((b) => b.role === 'terrain');
    const key = `${this.theme.id}|${terrain.map((b) => `${b.id}:${b.shapes.length}`).join(',')}`;
    if (key === this.terrainKey) return;
    // wait until every terrain body has a pose
    if (terrain.some((b) => !byId.has(b.id))) return;
    this.terrainKey = key;

    const polylines: Vec2[][] = [];
    for (const b of terrain) {
      const t = byId.get(b.id)!;
      const c = Math.cos(t.angle);
      const s = Math.sin(t.angle);
      for (const sh of b.shapes) {
        if (sh.type !== 'chain') continue;
        polylines.push(sh.points.map((p) => ({ x: t.x + c * p.x - s * p.y, y: t.y + s * p.x + c * p.y })));
      }
    }
    this.buildTerrain(polylines);
  }

  /** Build terrain meshes from world-space polylines (also used directly by the style guide). */
  buildTerrain(polylines: Vec2[][]): void {
    for (const ch of this.terrainLayer.removeChildren()) ch.destroy();
    const chains = chainPolylines(polylines);
    if (chains.length === 0) return;
    const bottom = maxY(chains) + TERRAIN_FILL_DEPTH_M;
    this.horizonY = medianY(chains) - this.theme.horizonLift;
    const skin = this.theme.terrain;
    const fillTex = this.textures.texture(themeAssetId.fill(this.theme.id));
    const edgeTex = this.textures.texture(themeAssetId.edge(this.theme.id));
    const shadeTex = this.textures.texture(SHADE_ID);
    const fills = new Container();
    const shades = new Container();
    const edges = new Container();
    for (const chain of chains) {
      fills.addChild(mesh(fillMesh(chain, bottom, skin.fill.metresPerTile), fillTex));
      const sm = mesh(shadeMesh(chain, bottom, skin.shade.depth), shadeTex);
      sm.tint = hexToNumber(this.theme.palette.groundShade);
      sm.alpha = skin.shade.alpha;
      shades.addChild(sm);
      edges.addChild(
        mesh(
          edgeStrip(chain, {
            above: skin.edge.above,
            below: skin.edge.below,
            metresPerTile: skin.edge.metresPerTile,
            wrapDepth: skin.edge.below * 0.9,
          }),
          edgeTex,
        ),
      );
    }
    this.terrainLayer.addChild(fills, shades, edges);
  }

  /** Terrain horizon (world y) the parallax layers are anchored to. */
  get horizon(): number {
    return this.horizonY;
  }

  // ---------------------------------------------------------------- decor

  private rebuildBackground(): void {
    this.background?.destroy();
    this.background = null;
    if (!this.withBackground) return;
    this.background = new ParallaxBackground(this.textures, this.theme);
    this.bgHost.addChild(this.background.view);
  }

  private placeLevelDecor(): void {
    for (const ch of this.propLayer.removeChildren()) ch.destroy({ children: true });
    this.blender = null;
    const level = this.level;
    if (!level) return;
    for (const prop of level.props) {
      const art = PROP_ART.get(prop.art);
      let v: Container;
      if (art && this.textures.has(art.id)) {
        const tex = this.textures.texture(art.id);
        const s = new Sprite(tex);
        s.anchor.set(art.anchor.x, art.anchor.y);
        s.scale.set(((prop.scale ?? 1) * art.metresTall) / tex.height);
        v = s;
      } else {
        const size = prop.size ?? { x: 1, y: 1 };
        v = new Graphics().rect(-size.x / 2, -size.y, size.x, size.y).fill({ color: 0xff00ff, alpha: 0.35 });
      }
      v.position.set(prop.position.x, prop.position.y);
      v.rotation = prop.angle ?? 0;
      this.propLayer.addChild(v);
    }
    const g = level.goal.sensor;
    this.blender = new BlenderView(this.textures, hexToNumber(this.theme.palette.blenderFill));
    this.blender.view.position.set(g.x + g.width / 2, g.y + g.height);
    this.blender.view.scale.set(BLENDER_HEIGHT_M / BLENDER_LAYOUT.height);
    this.propLayer.addChild(this.blender.view);
  }

  /** The current manifest (for callers that inspect what was drawn). */
  get lastManifest(): SceneManifest | null {
    return this.manifest;
  }

  destroy(): void {
    this.background?.destroy();
    this.view.destroy({ children: true });
    this.bodies.clear();
    this.shocks = [];
  }
}

function mesh(data: MeshData, texture: Texture): MeshSimple {
  return new MeshSimple({ texture, vertices: data.positions, uvs: data.uvs, indices: data.indices });
}
