/**
 * SceneRenderer (S4): draws a run from the S0 render contract only —
 * SceneManifest (what each body is) + RenderSnapshot (interpolated poses) —
 * plus optional static context (LevelDef for theme/props/goal, CartDesign for
 * part kinds and coil-spring shocks, which are joints and so aren't manifest
 * bodies). It never sees a physics object.
 *
 * Layers (back to front): parallax sky/layers (screen space) | zones (S9,
 * a world-space layer that shares the world transform) | world: terrain
 * (fill, depth shade, edge strip) -> props + blender -> cart bodies ->
 * wheels -> shocks -> pineapples -> beads (S9) -> funnel. The pre-S9 world
 * child indices are unchanged; beads sit in front of the load so a cart
 * ploughing the bead ocean reads as wading through it.
 *
 * S9 exotic physics, still manifest-only: a 'zone' body (gravity pocket or
 * force field) is drawn from its sensor polygon and the zone tag in its
 * partIds (model/zones parseZoneTag) as a translucent region tinted with the
 * theme palette (accentAlt: low gravity, with floating motes; accent: a
 * shooter, with chevrons along its force), BEHIND the terrain so the tint
 * shows only in the air; a 'bead' body is a small circle in one of three
 * palette colours (by body id).
 *
 * Each body gets a Container built once in BODY-LOCAL metres from its
 * manifest shapes; per frame only its position/rotation change.
 *
 * Invalidation (see `sync`), three tiers:
 *  1. Revision changed, or `resetSource()` / `setCartDesign()`: FULL content
 *     diff — every body's signature (role + partIds + all shape data) is
 *     recomputed, because the physics wrapper mutates `rec.shapes` IN PLACE
 *     (addChain/addPolygon/addCircle push into the existing array and bump the
 *     revision), so array identity says nothing across revisions.
 *     Cost: O(total manifest size), paid once per revision change.
 *  2. Same revision, identical role/shapes/partIds references (the physics
 *     wrapper's steady state): nothing to do. Cost: O(#bodies) reference
 *     compares per frame.
 *  3. Same revision, some references differ (a source that rebuilds arrays
 *     every frame, or a new world restarting at the same revision number):
 *     compare a STRUCTURAL fingerprint per changed body — role, partIds,
 *     shape count, and per shape its type, point count, end points (chains)
 *     or full geometry (polygons ≤ 8 vertices, circles). Cost: O(#bodies +
 *     #shapes) per frame, independent of chain point counts. A fingerprint
 *     difference escalates to tier 1. A new world at the SAME revision whose
 *     bodies match on all of that but differ only in interior chain points
 *     is not detected: sources must call `resetSource()` when they swap
 *     worlds (S6 does), which forces tier 1.
 * Only bodies whose signature actually changed are rebuilt, so streamed
 * terrain chunks or spawned pineapples never rebuild the rest. Terrain meshes
 * are rebuilt when the theme, the set of terrain bodies, any terrain body's
 * full signature (exact string compare, no hashing) or pose changes; shocks
 * are rebound whenever any body visual changes.
 *
 * Ownership: prop ART belongs to `LevelDef.props` (drawn in the decor layer
 * together with the blender goal). Manifest `prop` bodies are the solid
 * colliders of those props and are deliberately not drawn (as are `debug`
 * bodies), so a solid prop renders exactly once.
 */

import { Container, MeshSimple, NineSliceSprite, Sprite, Texture, TilingSprite, Graphics, GraphicsContext } from 'pixi.js';
import { resolveAttachments, type CompoundSpec, type ShapeSpec } from '../model/attach';
import type { CartDesign, PartKind } from '../model/cart';
import { cameraTransform, type Camera } from '../model/coords';
import type { Vec2 } from '../model/geometry';
import { hasSolidBody, type LevelDef, type PropDef, type ThemeId } from '../model/level';
import { parseZoneTag } from '../model/zones';
import type { BodyTransform, RenderBodyInfo, RenderShape, RenderSnapshot, SceneManifest } from '../model/snapshot';
import { BLENDER_SIZE } from '../model/goal';
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
import { chainPolylines, edgeStrip, fillMesh, horizonReferenceY, maxY, shadeMesh, type MeshData } from './terrainMesh';
import { getTheme, hexToNumber, themeAssetId, type Theme } from './themes';
import { SHADE_ID, type TextureProvider } from './textures';

/** How far below the deepest terrain point the fill extends (m). */
export const TERRAIN_FILL_DEPTH_M = 40;
/** World height of the standard blender goal (m): the shared solid body's height (UX1: 3.6 -> 9). */
export const BLENDER_HEIGHT_M = BLENDER_SIZE.y;
/** Visual thickness of the shock's guide rod (m). */
const SHOCK_SHAFT_M = 0.09;
const PIN_DIAMETER_M = 0.16;
/** Opacity of the funnel's palette.ink outline strokes (exported so contrast tests composite at it). */
export const FUNNEL_INK_ALPHA = 0.7;

/** LevelDef prop art id of the goal blender (drawn as the animated BlenderView). */
export const BLENDER_ART = 'blender';

/** Funnel outline in world metres (S1 run/funnel funnelGeometry walls + plug). */
export interface FunnelShape {
  walls: readonly (readonly Vec2[])[];
  plug: readonly Vec2[];
}

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

/** Last-seen identity of a manifest body (drawn or not), for cheap per-frame change detection. */
interface SeenBody {
  role: RenderBodyInfo['role'];
  shapes: readonly RenderShape[];
  partIds: readonly string[] | undefined;
  /** Full content signature (recomputed on every revision change). */
  sig: string;
  /** Structural fingerprint (bounded size; see file header, tier 3). */
  fp: string;
}

/**
 * Length-prefixed string token: arbitrary ids may contain the '|' / ','
 * delimiters, so raw joining would let different inputs collide. (Not
 * JSON.stringify: the per-frame path must stay free of it, see tests.)
 */
const str = (s: string): string => `${s.length}:${s}`;

/**
 * Structural fingerprint of a body: O(#shapes), independent of chain point
 * counts. Unambiguous: every string token is length-prefixed, every array is
 * count-prefixed, numbers never contain '|', and each shape's token layout is
 * fixed by its tag.
 */
export function bodyFingerprint(info: RenderBodyInfo): string {
  const ids = info.partIds ?? [];
  const parts: (string | number)[] = [str(info.role), ids.length, ...ids.map(str), info.shapes.length];
  for (const sh of info.shapes) {
    if (sh.type === 'chain') {
      const a = sh.points[0];
      const b = sh.points[sh.points.length - 1];
      parts.push('c', sh.points.length, a?.x ?? '', a?.y ?? '', b?.x ?? '', b?.y ?? '');
    } else if (sh.type === 'circle') {
      parts.push('o', str(sh.partId), sh.center.x, sh.center.y, sh.radius);
    } else {
      parts.push('p', str(sh.partId), sh.vertices.length);
      for (const v of sh.vertices.slice(0, 8)) parts.push(v.x, v.y);
    }
  }
  return parts.join('|');
}

/** Roles that get a body visual (terrain is meshed separately; prop/debug are not drawn). */
const DRAWN_ROLES: ReadonlySet<RenderBodyInfo['role']> = new Set(['cart', 'wheel', 'pineapple', 'zone', 'bead']);

/** Zone tint alpha (fill) and outline alpha. */
export const ZONE_FILL_ALPHA = 0.16;
export const ZONE_EDGE_ALPHA = 0.45;

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
  /** Zones (S9): behind the whole world (so behind the terrain), same transform as `world`. */
  private readonly zoneLayer = new Container();
  private readonly terrainLayer = new Container();
  /** Beads (S9): world child 6, after the pre-S9 layers. */
  private readonly beadLayer = new Container();
  /** One shared bead circle per radius (Graphics contexts are shareable). */
  private beadContexts = new Map<number, GraphicsContext>();
  /** LevelDef props + blender goal (owned by setLevel/placeLevelDecor only). */
  private readonly decorLayer = new Container();
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
  private seen = new Map<number, SeenBody>();
  private manifestRevision = -1;
  private forceSync = true;
  /** Bumped whenever any body visual is added, rebuilt or removed (drives shock rebinding). */
  private bodyGeneration = 0;
  private manifest: SceneManifest | null = null;
  /** What the current terrain meshes were built from (null = rebuild). */
  private terrainState: { theme: ThemeId; bodies: { id: number; sig: string; x: number; y: number; angle: number }[] } | null = null;
  private horizonY = 0;
  private blender: BlenderView | null = null;
  private readonly withBackground: boolean;

  constructor(
    private readonly textures: TextureProvider,
    opts: SceneRendererOptions = {},
  ) {
    this.theme = getTheme(opts.theme ?? 'beach');
    this.withBackground = opts.background ?? true;
    this.world.addChild(this.terrainLayer, this.decorLayer, this.cartLayer, this.wheelLayer, this.shockLayer, this.pineappleLayer, this.beadLayer);
    this.view.addChild(this.bgHost, this.zoneLayer, this.world);
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
    this.terrainState = null; // force re-skin
    // zone / bead tints come from the palette: rebuild them next sync
    for (const [bid, v] of this.bodies) {
      if (v.role === 'zone' || v.role === 'bead') {
        v.view.destroy({ children: true });
        this.bodies.delete(bid);
        this.forceSync = true;
      }
    }
    if (this.blender) this.placeLevelDecor();
    else this.drawFunnel();
  }

  /** Static level context: theme, props, blender goal. Terrain comes from the manifest. */
  setLevel(level: LevelDef | null): void {
    this.level = level;
    if (level) this.setTheme(level.theme);
    this.placeLevelDecor();
  }

  /** Cart design (for part kinds + coil-spring shocks). Pass null to fall back to geometry heuristics. */
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
    this.forceSync = true;
    this.shockKey = '';
  }

  /**
   * Declare that the next manifest comes from a different source (new physics
   * world / level restart). Optional — content changes are detected anyway —
   * but makes the switch explicit and forces a full re-diff.
   */
  resetSource(): void {
    this.forceSync = true;
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
    this.zoneLayer.scale.set(ct.scale);
    this.zoneLayer.position.set(ct.offsetX, ct.offsetY);
    this.background?.update(camera, this.horizonY);
  }

  // ---------------------------------------------------------------- bodies

  private sync(manifest: SceneManifest): void {
    this.manifest = manifest;
    if (!this.forceSync && manifest.revision === this.manifestRevision) {
      // tiers 2/3: same revision
      const tier = this.sameRevisionChange(manifest);
      if (tier === 'none') return;
      if (tier === 'refs') {
        // structurally identical content in new arrays: adopt the references, keep signatures
        for (const info of manifest.bodies) {
          const prev = this.seen.get(info.id)!;
          this.seen.set(info.id, { ...prev, shapes: info.shapes, partIds: info.partIds });
        }
        return;
      }
    }
    // tier 1: full content diff
    this.forceSync = false;
    this.manifestRevision = manifest.revision;

    const seen = new Map<number, SeenBody>();
    const live = new Set<number>();
    let changed = false;
    for (const info of manifest.bodies) {
      const sig = bodySignature(info);
      seen.set(info.id, { role: info.role, shapes: info.shapes, partIds: info.partIds, sig, fp: bodyFingerprint(info) });
      if (!DRAWN_ROLES.has(info.role)) continue;
      live.add(info.id);
      const existing = this.bodies.get(info.id);
      if (existing) {
        if (existing.sig === sig) continue;
        existing.view.destroy({ children: true });
      }
      const view = this.buildBody(info);
      this.layerFor(info.role).addChild(view);
      this.bodies.set(info.id, { id: info.id, role: info.role, sig, view });
      changed = true;
    }
    for (const [id, v] of this.bodies) {
      if (!live.has(id)) {
        v.view.destroy({ children: true });
        this.bodies.delete(id);
        changed = true;
      }
    }
    this.seen = seen;
    if (changed) this.bodyGeneration++;
  }

  /**
   * Same-revision change detection. 'none': every reference identical
   * (O(#bodies)). 'refs': some arrays are new but every changed body's
   * structural fingerprint matches (O(#bodies + #shapes)). 'content':
   * escalate to a full diff.
   */
  private sameRevisionChange(manifest: SceneManifest): 'none' | 'refs' | 'content' {
    if (manifest.bodies.length !== this.seen.size) return 'content';
    let refs = false;
    for (const info of manifest.bodies) {
      const s = this.seen.get(info.id);
      if (!s || s.role !== info.role) return 'content';
      if (s.shapes === info.shapes && s.partIds === info.partIds) continue;
      if (bodyFingerprint(info) !== s.fp) return 'content';
      refs = true;
    }
    return refs ? 'refs' : 'none';
  }

  private layerFor(role: RenderBodyInfo['role']): Container {
    switch (role) {
      case 'wheel':
        return this.wheelLayer;
      case 'pineapple':
        return this.pineappleLayer;
      case 'zone':
        return this.zoneLayer;
      case 'bead':
        return this.beadLayer;
      default:
        return this.cartLayer;
    }
  }

  private buildBody(info: RenderBodyInfo): Container {
    if (info.role === 'zone') return this.buildZone(info);
    if (info.role === 'bead') return this.buildBead(info);
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

  /** A zone: its sensor polygon, tinted by kind (see the file header). Unknown tags draw nothing. */
  private buildZone(info: RenderBodyInfo): Container {
    const c = new Container();
    c.label = `zone:${info.id}`;
    const look = parseZoneTag(info.partIds);
    const poly = info.shapes.find((sh) => sh.type === 'polygon');
    if (!look || !poly || poly.type !== 'polygon') return c;
    const pal = this.theme.palette;
    const color = hexToNumber(look.kind === 'gravity' ? pal.accentAlt : pal.accent);
    const flat = poly.vertices.flatMap((p) => [p.x, p.y]);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of poly.vertices) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    const g = new Graphics().poly(flat).fill({ color, alpha: ZONE_FILL_ALPHA }).poly(flat).stroke({ color, alpha: ZONE_EDGE_ALPHA, width: 0.08 });
    const w = x1 - x0;
    const h = y1 - y0;
    if (look.kind === 'gravity') {
      // floating motes on a fixed lattice (pure function of the rect: no randomness)
      for (let i = 0, n = Math.max(3, Math.round((w * h) / 6)); i < n; i++) {
        const fx = ((i * 0.618034) % 1 + 1) % 1;
        const fy = ((i * 0.414214 + 0.5) % 1 + 1) % 1;
        g.circle(x0 + fx * w, y0 + fy * h, 0.08 + 0.06 * (i % 3)).fill({ color, alpha: 0.35 });
      }
    } else {
      // chevrons pointing along the force, in rows
      const len = Math.hypot(look.force.x, look.force.y) || 1;
      const ux = look.force.x / len;
      const uy = look.force.y / len;
      const size = Math.min(0.6, Math.min(w, h) / 4);
      const step = size * 3;
      for (let cy = y0 + step / 2; cy < y1; cy += step) {
        for (let cx = x0 + step / 2; cx < x1; cx += step) {
          // a "V" whose tip points along (ux, uy)
          const tip = { x: cx + ux * size * 0.5, y: cy + uy * size * 0.5 };
          const back = { x: cx - ux * size * 0.5, y: cy - uy * size * 0.5 };
          const px = -uy * size * 0.6;
          const py = ux * size * 0.6;
          g.moveTo(back.x + px, back.y + py).lineTo(tip.x, tip.y).lineTo(back.x - px, back.y - py).stroke({ color, alpha: 0.5, width: 0.1 });
        }
      }
    }
    c.addChild(g);
    return c;
  }

  /** A bead: a shared circle context per radius, tinted from the palette by body id. */
  private buildBead(info: RenderBodyInfo): Container {
    const circle = info.shapes.find((sh) => sh.type === 'circle');
    if (!circle || circle.type !== 'circle') return new Container();
    let ctx = this.beadContexts.get(circle.radius);
    if (!ctx) {
      ctx = new GraphicsContext()
        .circle(0, 0, circle.radius)
        .fill({ color: 0xffffff })
        .circle(-circle.radius * 0.35, -circle.radius * 0.35, circle.radius * 0.3)
        .fill({ color: 0xffffff, alpha: 0.6 });
      this.beadContexts.set(circle.radius, ctx);
    }
    const g = new Graphics(ctx);
    g.position.set(circle.center.x, circle.center.y);
    const pal = this.theme.palette;
    g.tint = hexToNumber([pal.accent, pal.accentAlt, pal.ok][info.id % 3]!);
    const c = new Container();
    c.label = `bead:${info.id}`;
    c.addChild(g);
    return c;
  }

  private placeholderCircle(center: Vec2, r: number): Graphics {
    return new Graphics().circle(center.x, center.y, r).fill({ color: 0xff00ff, alpha: 0.5 });
  }

  private placeholderPoly(vertices: readonly Vec2[]): Graphics {
    return new Graphics().poly(vertices.flatMap((p) => [p.x, p.y])).fill({ color: 0xff00ff, alpha: 0.5 });
  }

  // ---------------------------------------------------------------- shocks

  private updateShocks(manifest: SceneManifest, byId: Map<number, BodyTransform>): void {
    const key = this.spec ? `${this.bodyGeneration}` : '';
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
      const tex = this.textures.texture(ART.spring[frame].id);
      if (s.canopy.texture !== tex) s.canopy.texture = tex;
      const rest = s.binding.restLength;
      const cs = Math.min(rest, 1.6) * 0.62 / tex.width; // coil frame ~62% of rest length along the axis
      s.canopy.scale.set(cs, cs * (0.92 + 0.16 * spread));
      s.canopy.position.set(Math.min(p.length * 0.12, 0.2), 0);
    }
  }

  private buildShock(binding: ShockBinding): ShockVisual {
    const view = new Container();
    const stickTex = this.textures.texture(ART.springRod.id);
    const stick = new Sprite(stickTex);
    stick.anchor.set(0, 0.5);
    stick.scale.y = SHOCK_SHAFT_M / 5; // 5 px of the 8 px texture is the shaft
    const canopy = new Sprite(this.textures.texture(ART.spring.half.id));
    canopy.anchor.set(ART.spring.apexX / 64, ART.spring.axisY / 96);
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
    // wait until every terrain body has a pose
    if (terrain.some((b) => !byId.has(b.id))) return;
    // exact comparison against what the meshes were built from (full signatures, no hashing)
    const state = {
      theme: this.theme.id,
      bodies: terrain.map((b) => {
        const t = byId.get(b.id)!;
        return { id: b.id, sig: this.seen.get(b.id)?.sig ?? bodySignature(b), x: t.x, y: t.y, angle: t.angle };
      }),
    };
    const prev = this.terrainState;
    if (
      prev &&
      prev.theme === state.theme &&
      prev.bodies.length === state.bodies.length &&
      prev.bodies.every((p, i) => {
        const q = state.bodies[i]!;
        return p.id === q.id && p.x === q.x && p.y === q.y && p.angle === q.angle && p.sig === q.sig;
      })
    ) {
      return;
    }
    this.terrainState = state;

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
    for (const ch of this.terrainLayer.removeChildren()) ch.destroy({ children: true });
    const chains = chainPolylines(polylines);
    if (chains.length === 0) return;
    const bottom = maxY(chains) + TERRAIN_FILL_DEPTH_M;
    this.horizonY = horizonReferenceY(chains) - this.theme.horizonLift;
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
    for (const ch of this.decorLayer.removeChildren()) ch.destroy({ children: true });
    this.blender = null;
    const level = this.level;
    if (!level) {
      this.drawFunnel();
      return;
    }
    // S6 (INTEGRATION #7): the level's 'blender' prop is the goal's SOLID
    // body (position = box centre, rotated by angle about it); the animated
    // BlenderView stands on that rotated box's bottom-centre, tilted with it.
    // Without one, it stands on the goal sensor's bottom-centre.
    // S6V: a solid prop with no physics body (model hasSolidBody false — only
    // possible in an unvalidated level) is skipped exactly as physics skips
    // it: never drawn, never the blender.
    const props = level.props.filter((p) => !p.solid || hasSolidBody(p));
    const blenderProp = props.find((p) => p.art === BLENDER_ART);
    for (const prop of props) {
      if (prop === blenderProp) continue;
      const art = PROP_ART.get(prop.art);
      let v: Container;
      const hasArt = !!art && this.textures.has(art.id);
      if (hasSolidBody(prop)) {
        // S6 (INTEGRATION #12): solid props are boxes CENTRED on `position`,
        // rotated by `angle` — the same convention as src/run/props.ts. Art
        // (anchored at its foot) stands on the box's bottom edge; without
        // art the box itself is drawn.
        if (hasArt) {
          const tex = this.textures.texture(art.id);
          const s = new Sprite(tex);
          s.anchor.set(art.anchor.x, art.anchor.y);
          s.scale.set(((prop.scale ?? 1) * art.metresTall) / tex.height);
          s.position.set(0, prop.size.y / 2);
          v = new Container();
          v.addChild(s);
        } else {
          v = this.solidPropView(prop.size);
        }
      } else if (hasArt && art) {
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
      this.decorLayer.addChild(v);
    }
    const g = level.goal.sensor;
    const outline = this.theme.goalOutline;
    this.blender = new BlenderView(this.textures, hexToNumber(this.theme.palette.blenderFill), outline ? hexToNumber(outline) : null);
    if (blenderProp) {
      const foot = blenderFoot(blenderProp);
      this.blender.view.position.set(foot.x, foot.y);
      this.blender.view.rotation = blenderProp.angle ?? 0;
    } else {
      this.blender.view.position.set(g.x + g.width / 2, g.y + g.height);
    }
    // drawn exactly as wide AND as tall as its solid collider (UX1 audit-1 #1: physics and art agree
    // for any blender size). The 160x340 art is squeezed non-uniformly to the collider's aspect (the
    // shared 3.75 x 9 m box is ~11% narrower than the art's own aspect; the jar reads fine at that).
    const blenderSize = blenderProp && hasSolidBody(blenderProp) ? blenderProp.size : BLENDER_SIZE;
    this.blender.view.scale.set(blenderSize.x / BLENDER_LAYOUT.baseWidth, blenderSize.y / BLENDER_LAYOUT.height);
    this.decorLayer.addChild(this.blender.view);
    this.drawFunnel();
  }

  private solidPropView(size: Vec2): Graphics {
    const ink = hexToNumber(this.theme.palette.ink);
    return new Graphics()
      .roundRect(-size.x / 2, -size.y / 2, size.x, size.y, Math.min(size.x, size.y) * 0.12)
      .fill({ color: hexToNumber(this.theme.palette.groundEdge) })
      .stroke({ color: ink, width: 0.06, alpha: 0.6 });
  }

  // ---------------------------------------------------------------- funnel

  private funnel: FunnelShape | null = null;
  private funnelOpen = false;
  private funnelView: Container | null = null;
  private funnelPlug: Graphics | null = null;

  /**
   * S6: the start funnel. Its walls/plug are manifest 'prop' bodies, which
   * are not drawn (see header), so the owner passes the funnel geometry (world
   * metres) here. Pass null to remove it.
   */
  setFunnel(shape: FunnelShape | null): void {
    this.funnel = shape;
    this.funnelOpen = false;
    this.drawFunnel();
  }

  /** Hide the plug once the load is released. */
  setFunnelOpen(open: boolean): void {
    this.funnelOpen = open;
    if (this.funnelPlug) this.funnelPlug.visible = !open;
  }

  private drawFunnel(): void {
    if (this.funnelView) {
      this.funnelView.destroy({ children: true });
      this.funnelView = null;
      this.funnelPlug = null;
    }
    const f = this.funnel;
    if (!f) return;
    const view = new Container();
    view.label = 'funnel';
    const ink = hexToNumber(this.theme.palette.ink);
    const body = hexToNumber(this.theme.palette.accentAlt);
    for (const wall of f.walls) {
      view.addChild(
        new Graphics()
          .poly(wall.flatMap((p) => [p.x, p.y]))
          .fill({ color: body })
          .stroke({ color: ink, width: 0.05, alpha: FUNNEL_INK_ALPHA }),
      );
    }
    const plug = new Graphics()
      .poly(f.plug.flatMap((p) => [p.x, p.y]))
      .fill({ color: hexToNumber(this.theme.palette.accent) })
      .stroke({ color: ink, width: 0.05, alpha: FUNNEL_INK_ALPHA });
    plug.visible = !this.funnelOpen;
    view.addChild(plug);
    // in front of the pineapples: the load shows through the open V top
    this.world.addChild(view);
    this.funnelView = view;
    this.funnelPlug = plug;
  }

  /** The current manifest (for callers that inspect what was drawn). */
  get lastManifest(): SceneManifest | null {
    return this.manifest;
  }

  destroy(): void {
    this.background?.destroy();
    this.view.destroy({ children: true });
    for (const ctx of this.beadContexts.values()) ctx.destroy();
    this.beadContexts.clear();
    this.bodies.clear();
    this.seen.clear();
    this.shocks = [];
  }

  /** Diagnostics for tests / the style guide (counts only; no internals exposed). */
  get stats(): { bodies: number; terrainChains: number; decor: number; shocks: number; funnel: boolean } {
    const fills = this.terrainLayer.children[0];
    return {
      bodies: this.bodies.size,
      terrainChains: fills ? fills.children.length : 0,
      decor: this.decorLayer.children.length,
      shocks: this.shocks.length,
      funnel: this.funnelView !== null,
    };
  }

  /** Terrain fill mesh vertex positions per chain (world metres; copies) — for tests. */
  terrainFillPositions(): Float32Array[] {
    const fills = this.terrainLayer.children[0];
    // copies: diagnostics must not be able to mutate the live GPU geometry
    return fills ? fills.children.map((m) => Float32Array.from((m as MeshSimple).geometry.getBuffer('aPosition').data as Float32Array)) : [];
  }
}

function mesh(data: MeshData, texture: Texture): MeshSimple {
  return new MeshSimple({ texture, vertices: data.positions, uvs: data.uvs, indices: data.indices });
}

/**
 * Where the BlenderView's foot goes for a blender prop: for a solid one, the
 * bottom-centre of its collider box — centre `position`, rotated by `angle`
 * (src/run/props.ts boxPolygon convention: local (0, +h/2) rotated); a
 * non-solid (decor) blender stands on its position.
 */
export function blenderFoot(prop: PropDef): Vec2 {
  if (!hasSolidBody(prop)) return { x: prop.position.x, y: prop.position.y };
  const a = prop.angle ?? 0;
  const half = prop.size.y / 2;
  return { x: prop.position.x - Math.sin(a) * half, y: prop.position.y + Math.cos(a) * half };
}
