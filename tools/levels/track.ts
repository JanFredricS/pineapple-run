/**
 * Tiny authoring DSL for the premade levels (S6). A Track walks left to
 * right emitting terrain points (metres, y-down: positive dy goes DOWN,
 * negative dy goes UP), so a course reads like a route description:
 *
 *   t.flat(16).ease(30, 2).washboard(9, 0.5, 4 / 3).gap(1.2).finish()
 *
 * Output is a plain LevelDef — the same JSON the S3 map builder imports and
 * exports (validated by model/validate in the test that writes levels/*.json),
 * so every premade level stays editable in tools/mapbuilder.
 *
 * Besides the LevelDef, a Track records FEATURES (kind + x-range, for the
 * tests' gap probes and a feature census) and PACE NOTES (target speeds
 * along x) that the scripted test driver uses to prove the example cart can
 * finish. Pace notes are test data only; they are not part of the LevelDef.
 */

import type { Vec2 } from '../../src/model/geometry';
import {
  DEFAULT_TERRAIN_FRICTION,
  DEFAULT_TERRAIN_RESTITUTION,
  LEVEL_DEF_VERSION,
  type LevelDef,
  type PropDef,
  type TerrainSpan,
  type ThemeId,
} from '../../src/model/level';
import { funnelFor } from '../../src/game/startArea';

export type FeatureKind = 'plateau' | 'valley' | 'crest' | 'drop' | 'ramp' | 'launchLip' | 'washboard' | 'kicker' | 'gap' | 'steps' | 'finish';

export interface Feature {
  kind: FeatureKind;
  x0: number;
  x1: number;
}

export interface PaceNote {
  /** From this x on (metres)… */
  x: number;
  /** …hold about this speed (m/s). */
  speed: number;
}

export interface AuthoredLevel {
  level: LevelDef;
  features: Feature[];
  pace: PaceNote[];
}

/** Blender goal: solid body size (m); centre sits on the pit floor (S1 props: position = box centre). */
export const BLENDER_SIZE: Readonly<Vec2> = { x: 1.5, y: 3.6 };
/** Goal pit: depth below the lip, floor length, drop run, sensor height above the floor (m). */
export const PIT = { depth: 2.5, floor: 9, dropRun: 1.5, sensor: 2.2, lineAfterLip: 0.3, blenderFromDrop: 6.5 } as const;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export class Track {
  private spans: TerrainSpan[] = [];
  private pts: Vec2[] = [];
  private props: PropDef[] = [];
  readonly features: Feature[] = [];
  readonly pace: PaceNote[] = [];
  x: number;
  y: number;
  readonly cartStart: Vec2;
  private goal: LevelDef['goal'] | null = null;
  private spanNo = 0;

  /**
   * Start wall at `x0`, ground at `groundY`; the cart starts `cartOffset`
   * metres right of the wall (design x = 0 there).
   */
  constructor(
    x0: number,
    groundY: number,
    cartOffset = 2.5,
  ) {
    this.pts.push({ x: x0 - 0.1, y: groundY - 8 }, { x: x0, y: groundY });
    this.x = x0;
    this.y = groundY;
    this.cartStart = { x: x0 + cartOffset, y: groundY };
  }

  private push(x: number, y: number): void {
    const last = this.pts[this.pts.length - 1];
    const p = { x: r3(x), y: r3(y) };
    if (last && p.x <= last.x) throw new Error(`Track: x must increase (${p.x} <= ${last.x})`);
    this.pts.push(p);
    this.x = p.x;
    this.y = p.y;
  }

  private feature<T>(kind: FeatureKind, fn: () => T): this {
    const x0 = this.x;
    fn();
    this.features.push({ kind, x0, x1: this.x });
    return this;
  }

  /** Target speed (m/s) for the scripted driver from here on. */
  speed(v: number): this {
    this.pace.push({ x: this.x, speed: v });
    return this;
  }

  flat(len: number, kind: FeatureKind | null = null): this {
    const go = () => this.push(this.x + len, this.y);
    if (kind) return this.feature(kind, go);
    go();
    return this;
  }

  /** Straight segment by (dx, dy). */
  line(dx: number, dy: number, kind: FeatureKind | null = null): this {
    const go = () => this.push(this.x + dx, this.y + dy);
    if (kind) return this.feature(kind, go);
    go();
    return this;
  }

  /** Smooth S-curve (cosine ease) by (dx, dy), sampled every ~`step` m. */
  ease(dx: number, dy: number, kind: FeatureKind | null = null, step = 1): this {
    const go = () => {
      const x0 = this.x;
      const y0 = this.y;
      const n = Math.max(2, Math.ceil(dx / step));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        this.push(x0 + dx * t, y0 + (dy * (1 - Math.cos(Math.PI * t))) / 2);
      }
    };
    if (kind) return this.feature(kind, go);
    go();
    return this;
  }

  /** Smooth hump of height h (up; h < 0 makes a dip) over dx, back to the same level. */
  hump(dx: number, h: number, kind: FeatureKind | null = null, step = 1): this {
    const go = () => {
      const x0 = this.x;
      const y0 = this.y;
      const n = Math.max(4, Math.ceil(dx / step));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        this.push(x0 + dx * t, y0 - (h * (1 - Math.cos(2 * Math.PI * t))) / 2);
      }
    };
    if (kind) return this.feature(kind, go);
    go();
    return this;
  }

  /** The original's washboard: n triangular bumps `h` tall, `pitch` apart. */
  washboard(n: number, h: number, pitch: number): this {
    return this.feature('washboard', () => {
      for (let i = 0; i < n; i++) {
        this.push(this.x + pitch / 2, this.y - h);
        this.push(this.x + pitch / 2, this.y + h);
      }
    });
  }

  /** Launch lip / kicker: rise `h` over `dx` (straight), then fall `drop` over `dropRun`. */
  kicker(dx: number, h: number, dropRun: number, drop: number, kind: FeatureKind = 'kicker'): this {
    return this.feature(kind, () => {
      this.push(this.x + dx, this.y - h);
      this.push(this.x + dropRun, this.y + drop);
    });
  }

  /** Staircase: n steps of `rise` (negative = up) each `tread` long, with a short `riser` run. */
  steps(n: number, tread: number, rise: number, riser = 0.3): this {
    return this.feature('steps', () => {
      for (let i = 0; i < n; i++) {
        this.push(this.x + riser, this.y + rise);
        this.push(this.x + tread, this.y);
      }
    });
  }

  /**
   * A real hole: the current span ends here and the next starts `width`
   * metres on, `dy` lower (positive) or higher (negative). The far edge
   * gets a small bevel so wheels do not snag on a knife edge.
   */
  gap(width: number, dy = 0): this {
    return this.feature('gap', () => {
      this.endSpan();
      const x = this.x + width;
      const y = this.y + dy;
      this.pts = [{ x: r3(x), y: r3(y + 0.25) }, { x: r3(x + 0.35), y: r3(y) }];
      this.x = r3(x + 0.35);
      this.y = r3(y);
    });
  }

  private endSpan(): void {
    if (this.pts.length >= 2) this.spans.push({ id: `span-${this.spanNo++}`, points: this.pts });
    this.pts = [];
  }

  /** Decorative prop at x, standing on the terrain (y given; art anchors bottom-centre). */
  decor(art: string, x: number, y: number, scale = 1): this {
    this.props.push({ id: `${art}-${this.props.length}`, art, position: { x: r3(x), y: r3(y) }, scale });
    return this;
  }

  /**
   * Goal: from the current point (the lip), a drop into the blender pit, the
   * pit floor, and a back wall. The blender is a SOLID prop standing on the
   * floor (S1 convention: position = box CENTRE); the base sensor is the
   * bottom PIT.sensor metres of the pit; every pineapple past the lip line
   * counts as delivered.
   */
  finish(): this {
    return this.feature('finish', () => {
      const lipX = this.x;
      this.push(this.x + PIT.dropRun, this.y + PIT.depth);
      const floorY = this.y;
      const pitX0 = this.x;
      this.push(this.x + PIT.floor, this.y);
      const pitX1 = this.x;
      this.push(this.x + 0.1, this.y - 8);
      this.goal = {
        sensor: { x: pitX0, y: r3(floorY - PIT.sensor), width: r3(pitX1 - pitX0), height: PIT.sensor },
        lineX: r3(lipX + PIT.lineAfterLip),
      };
      this.props.push({
        id: 'blender',
        art: 'blender',
        solid: true,
        position: { x: r3(pitX0 + PIT.blenderFromDrop), y: r3(floorY - BLENDER_SIZE.y / 2) },
        size: { ...BLENDER_SIZE },
      });
    });
  }

  build(meta: { id: string; name: string; theme: ThemeId }): AuthoredLevel {
    if (!this.goal) throw new Error('Track: call finish() before build()');
    this.endSpan();
    let maxY = -Infinity;
    for (const s of this.spans) for (const p of s.points) maxY = Math.max(maxY, p.y);
    const funnel = funnelFor(this.cartStart);
    const level: LevelDef = {
      version: LEVEL_DEF_VERSION,
      id: meta.id,
      name: meta.name,
      theme: meta.theme,
      terrain: { spans: this.spans, friction: DEFAULT_TERRAIN_FRICTION, restitution: DEFAULT_TERRAIN_RESTITUTION },
      cartStart: { ...this.cartStart },
      funnel: { x: r3(funnel.x), y: r3(funnel.y) },
      goal: this.goal,
      props: this.props,
      zones: [],
      killY: Math.ceil(maxY + 15),
    };
    return { level, features: this.features, pace: this.pace };
  }
}
