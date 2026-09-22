/**
 * Validation + version migration for CartDesign / LevelDef / ScoreBook JSON
 * (S0 contract 5).
 *
 * EVERY load path (localStorage carts & scores, level JSON, map-builder
 * import) goes through here. Corrupt or future-versioned data is rejected
 * with a structured, recoverable error the caller surfaces (toast for saves,
 * error panel in the map builder). Consumers never feed unvalidated JSON to
 * physics. Successful results are normalised copies containing only known
 * fields.
 */

import {
  CART_DESIGN_VERSION,
  CartDesign,
  CartPart,
  MAX_PARTS,
  PartKind,
} from './cart';
import type { Vec2 } from './geometry';
import { MAX_SCORE_ID_LENGTH, MAX_SCORE_LEVELS, MAX_SCORE_SEEDS, MAX_SCORE_VALUE, SCORE_BOOK_VERSION, TOTAL_PINEAPPLES, type EndlessSeedBest, type LevelBest, type ScoreBook } from './score';
import {
  DEFAULT_TERRAIN_FRICTION,
  DEFAULT_TERRAIN_RESTITUTION,
  LEVEL_DEF_VERSION,
  LevelDef,
  PropDef,
  Rect,
  THEME_IDS,
  TerrainSpan,
  ThemeId,
  ZoneDef,
} from './level';

export type ValidationErrorCode =
  | 'invalidJson'
  | 'notObject'
  | 'missingVersion'
  | 'futureVersion'
  | 'unsupportedVersion'
  | 'schema';

export interface ValidationError {
  code: ValidationErrorCode;
  /** Human-readable, safe to show in a toast / error panel. */
  message: string;
  /** JSON path of the offending value, e.g. "parts[3].radius". */
  path?: string;
}

export type ValidationResult<T> = { ok: true; value: T; migratedFrom?: number } | { ok: false; error: ValidationError };

/** A migration upgrades a document from version N to N+1. */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;
/** Keyed by the version it upgrades FROM. */
export type MigrationTable = Record<number, Migration>;

/** No older cart format exists yet; add `{ 1: v1ToV2 }` when v2 ships. */
export const CART_MIGRATIONS: MigrationTable = {};
export const LEVEL_MIGRATIONS: MigrationTable = {};
export const SCORE_MIGRATIONS: MigrationTable = {};

/**
 * Aggregate terrain limits for a whole LevelDef (untrusted imports): checked
 * on the RAW arrays before any point is copied, so a crafted file is rejected
 * with a recoverable error instead of exhausting memory.
 */
export const MAX_TERRAIN_SPANS = 2_000;
export const MAX_TERRAIN_POINTS_TOTAL = 200_000;
/** Per-span point limit (kept; the aggregate limit is the binding one). */
export const MAX_SPAN_POINTS = 100_000;

/** Max absolute coordinate accepted anywhere (px for carts, m for levels). */
const MAX_COORD = 1e6;

class SchemaError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}

const fail = (path: string, msg: string): never => {
  throw new SchemaError(path, `${path}: ${msg}`);
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function obj(v: unknown, path: string): Record<string, unknown> {
  if (!isObject(v)) fail(path, 'expected an object');
  return v as Record<string, unknown>;
}

function num(v: unknown, path: string, opts: { min?: number; max?: number; positive?: boolean } = {}): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fail(path, 'expected a finite number');
  const n = v as number;
  if (Math.abs(n) > MAX_COORD) fail(path, 'number out of range');
  if (opts.positive && !(n > 0)) fail(path, 'expected a positive number');
  if (opts.min !== undefined && n < opts.min) fail(path, `expected >= ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) fail(path, `expected <= ${opts.max}`);
  return n;
}

function str(v: unknown, path: string, maxLen = 200): string {
  if (typeof v !== 'string' || v.length === 0) return fail(path, 'expected a non-empty string');
  if ((v as string).length > maxLen) fail(path, `string longer than ${maxLen}`);
  return v as string;
}

function vec2(v: unknown, path: string): Vec2 {
  const o = obj(v, path);
  return { x: num(o.x, `${path}.x`), y: num(o.y, `${path}.y`) };
}

function arr(v: unknown, path: string, maxLen: number): unknown[] {
  if (!Array.isArray(v)) return fail(path, 'expected an array');
  if ((v as unknown[]).length > maxLen) fail(path, `more than ${maxLen} entries`);
  return v as unknown[];
}

/**
 * Check the version field and run migrations up to `current`.
 * Exported for tests and for future document kinds (scores, settings).
 */
export function migrateDocument(
  raw: unknown,
  current: number,
  migrations: MigrationTable,
  kind: string,
): ValidationResult<Record<string, unknown>> {
  if (!isObject(raw)) return { ok: false, error: { code: 'notObject', message: `${kind} is not a JSON object` } };
  const v = raw.version;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    return { ok: false, error: { code: 'missingVersion', message: `${kind} has no valid version`, path: 'version' } };
  }
  if (v > current) {
    return {
      ok: false,
      error: {
        code: 'futureVersion',
        message: `${kind} was saved by a newer version of the game (v${v}; this build reads up to v${current})`,
        path: 'version',
      },
    };
  }
  let doc: Record<string, unknown> = raw;
  for (let from = v; from < current; from++) {
    const m = Object.prototype.hasOwnProperty.call(migrations, from) ? migrations[from] : undefined;
    if (!m) {
      return {
        ok: false,
        error: { code: 'unsupportedVersion', message: `${kind} v${from} can no longer be loaded`, path: 'version' },
      };
    }
    doc = m(doc);
    if (!isObject(doc) || doc.version !== from + 1) {
      return {
        ok: false,
        error: { code: 'unsupportedVersion', message: `${kind} migration from v${from} failed`, path: 'version' },
      };
    }
  }
  return v < current ? { ok: true, value: doc, migratedFrom: v } : { ok: true, value: doc };
}

function wrap<T>(fn: () => T, migratedFrom?: number): ValidationResult<T> {
  try {
    const value = fn();
    return migratedFrom === undefined ? { ok: true, value } : { ok: true, value, migratedFrom };
  } catch (e) {
    if (e instanceof SchemaError) return { ok: false, error: { code: 'schema', message: e.message, path: e.path } };
    throw e;
  }
}

function parseJson(text: string, kind: string): ValidationResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: { code: 'invalidJson', message: `${kind} is not valid JSON` } };
  }
}

// ---------------------------------------------------------------- CartDesign

const PART_KINDS: readonly PartKind[] = ['straw', 'cube', 'lime', 'wheel', 'shock'];

function cartPart(v: unknown, path: string): CartPart {
  const o = obj(v, path);
  const id = str(o.id, `${path}.id`, 64);
  const kind = o.kind;
  if (typeof kind !== 'string' || !PART_KINDS.includes(kind as PartKind)) {
    return fail(`${path}.kind`, `unknown part kind`);
  }
  switch (kind as PartKind) {
    case 'straw':
    case 'shock':
      return { id, kind: kind as 'straw' | 'shock', a: vec2(o.a, `${path}.a`), b: vec2(o.b, `${path}.b`) };
    case 'cube':
      return {
        id,
        kind: 'cube',
        center: vec2(o.center, `${path}.center`),
        width: num(o.width, `${path}.width`, { positive: true }),
        height: num(o.height, `${path}.height`, { positive: true }),
        angle: num(o.angle ?? 0, `${path}.angle`),
      };
    case 'lime':
    case 'wheel':
      return {
        id,
        kind: kind as 'lime' | 'wheel',
        center: vec2(o.center, `${path}.center`),
        radius: num(o.radius, `${path}.radius`, { positive: true }),
      };
  }
}

export function validateCartDesign(raw: unknown): ValidationResult<CartDesign> {
  const m = migrateDocument(raw, CART_DESIGN_VERSION, CART_MIGRATIONS, 'Cart');
  if (!m.ok) return m;
  const doc = m.value;
  return wrap(() => {
    const parts = arr(doc.parts, 'parts', MAX_PARTS).map((p, i) => cartPart(p, `parts[${i}]`));
    const seen = new Set<string>();
    parts.forEach((p, i) => {
      if (seen.has(p.id)) fail(`parts[${i}].id`, `duplicate part id "${p.id}"`);
      seen.add(p.id);
    });
    const out: CartDesign = { version: CART_DESIGN_VERSION, parts };
    if (doc.name !== undefined) out.name = str(doc.name, 'name', 100);
    return out;
  }, m.migratedFrom);
}

export function parseCartDesign(text: string): ValidationResult<CartDesign> {
  const j = parseJson(text, 'Cart');
  return j.ok ? validateCartDesign(j.value) : j;
}

// ------------------------------------------------------------------ LevelDef

function rect(v: unknown, path: string): Rect {
  const o = obj(v, path);
  return {
    x: num(o.x, `${path}.x`),
    y: num(o.y, `${path}.y`),
    width: num(o.width, `${path}.width`, { positive: true }),
    height: num(o.height, `${path}.height`, { positive: true }),
  };
}

function span(v: unknown, path: string): TerrainSpan {
  const o = obj(v, path);
  const id = str(o.id, `${path}.id`, 64);
  const points = arr(o.points, `${path}.points`, MAX_SPAN_POINTS).map((p, i) => vec2(p, `${path}.points[${i}]`));
  if (points.length < 2) fail(`${path}.points`, 'a span needs at least 2 points');
  for (let i = 1; i < points.length; i++) {
    if (!(points[i]!.x > points[i - 1]!.x)) fail(`${path}.points[${i}].x`, 'span x must strictly increase');
  }
  return { id, points };
}

function zone(v: unknown, path: string): ZoneDef {
  const o = obj(v, path);
  const id = str(o.id, `${path}.id`, 64);
  const kind = o.kind;
  if (kind === 'gravity') {
    return { id, kind, rect: rect(o.rect, `${path}.rect`), gravityScale: num(o.gravityScale, `${path}.gravityScale`, { min: -10, max: 10 }) };
  }
  if (kind === 'force') {
    return { id, kind, rect: rect(o.rect, `${path}.rect`), force: vec2(o.force, `${path}.force`) };
  }
  return fail(`${path}.kind`, 'unknown zone kind');
}

function prop(v: unknown, path: string): PropDef {
  const o = obj(v, path);
  const out: PropDef = { id: str(o.id, `${path}.id`, 64), art: str(o.art, `${path}.art`, 64), position: vec2(o.position, `${path}.position`) };
  if (o.angle !== undefined) out.angle = num(o.angle, `${path}.angle`);
  if (o.scale !== undefined) out.scale = num(o.scale, `${path}.scale`, { positive: true });
  if (o.solid !== undefined) {
    if (typeof o.solid !== 'boolean') fail(`${path}.solid`, 'expected a boolean');
    out.solid = o.solid as boolean;
  }
  if (o.size !== undefined) out.size = vec2(o.size, `${path}.size`);
  if (out.solid && !out.size) fail(`${path}.size`, 'solid props need a size');
  return out;
}

export function validateLevelDef(raw: unknown): ValidationResult<LevelDef> {
  const m = migrateDocument(raw, LEVEL_DEF_VERSION, LEVEL_MIGRATIONS, 'Level');
  if (!m.ok) return m;
  const doc = m.value;
  return wrap(() => {
    const theme = doc.theme;
    if (typeof theme !== 'string' || !THEME_IDS.includes(theme as ThemeId)) fail('theme', 'unknown theme');
    const t = obj(doc.terrain, 'terrain');
    const rawSpans = arr(t.spans, 'terrain.spans', MAX_TERRAIN_SPANS);
    let totalPoints = 0;
    rawSpans.forEach((s, i) => {
      const pts = isObject(s) && Array.isArray(s.points) ? s.points.length : 0;
      totalPoints += pts;
      if (totalPoints > MAX_TERRAIN_POINTS_TOTAL) {
        fail(`terrain.spans[${i}].points`, `terrain has more than ${MAX_TERRAIN_POINTS_TOTAL} points in total`);
      }
    });
    const spans = rawSpans.map((s, i) => span(s, `terrain.spans[${i}]`));
    if (spans.length === 0) fail('terrain.spans', 'at least one span is required');
    const spanIds = new Set<string>();
    spans.forEach((s, i) => {
      if (spanIds.has(s.id)) fail(`terrain.spans[${i}].id`, `duplicate span id "${s.id}"`);
      spanIds.add(s.id);
      if (i > 0) {
        const prevEnd = spans[i - 1]!.points[spans[i - 1]!.points.length - 1]!.x;
        if (s.points[0]!.x < prevEnd) fail(`terrain.spans[${i}]`, 'spans must be ordered left to right without overlap');
      }
    });
    const g = obj(doc.goal, 'goal');
    const zones = arr(doc.zones ?? [], 'zones', 1000).map((z, i) => zone(z, `zones[${i}]`));
    const props = arr(doc.props ?? [], 'props', 10_000).map((p, i) => prop(p, `props[${i}]`));
    const level: LevelDef = {
      version: LEVEL_DEF_VERSION,
      id: str(doc.id, 'id', 64),
      name: str(doc.name, 'name', 100),
      theme: theme as ThemeId,
      terrain: {
        spans,
        friction: num(t.friction ?? DEFAULT_TERRAIN_FRICTION, 'terrain.friction', { min: 0, max: 10 }),
        restitution: num(t.restitution ?? DEFAULT_TERRAIN_RESTITUTION, 'terrain.restitution', { min: 0, max: 1 }),
      },
      cartStart: vec2(doc.cartStart, 'cartStart'),
      funnel: vec2(doc.funnel, 'funnel'),
      goal: { sensor: rect(g.sensor, 'goal.sensor'), lineX: num(g.lineX, 'goal.lineX') },
      props,
      zones,
      killY: num(doc.killY, 'killY'),
    };
    return level;
  }, m.migratedFrom);
}

export function parseLevelDef(text: string): ValidationResult<LevelDef> {
  const j = parseJson(text, 'Level');
  return j.ok ? validateLevelDef(j.value) : j;
}

// ----------------------------------------------------------------- ScoreBook

function levelBestEntry(v: unknown, path: string): LevelBest {
  const o = obj(v, path);
  const bestRating = num(o.bestRating, `${path}.bestRating`, { min: 0, max: 100 });
  if (!Number.isInteger(bestRating)) fail(`${path}.bestRating`, 'expected an integer');
  const delivered = num(o.delivered, `${path}.delivered`, { min: 0, max: TOTAL_PINEAPPLES });
  if (!Number.isInteger(delivered)) fail(`${path}.delivered`, 'expected an integer');
  return {
    levelId: str(o.levelId, `${path}.levelId`, MAX_SCORE_ID_LENGTH),
    bestRating,
    seconds: num(o.seconds, `${path}.seconds`, { min: 0, max: MAX_SCORE_VALUE }),
    delivered,
  };
}

function seedBestEntry(v: unknown, path: string): EndlessSeedBest {
  const o = obj(v, path);
  return {
    seed: str(o.seed, `${path}.seed`, MAX_SCORE_ID_LENGTH),
    bestDistance: num(o.bestDistance, `${path}.bestDistance`, { min: 0, max: MAX_SCORE_VALUE }),
  };
}

export function validateScoreBook(raw: unknown): ValidationResult<ScoreBook> {
  const m = migrateDocument(raw, SCORE_BOOK_VERSION, SCORE_MIGRATIONS, 'Saved scores');
  if (!m.ok) return m;
  const doc = m.value;
  return wrap(() => {
    const levels = arr(doc.levels, 'levels', MAX_SCORE_LEVELS).map((l, i) => levelBestEntry(l, `levels[${i}]`));
    const levelIds = new Set<string>();
    levels.forEach((l, i) => {
      if (levelIds.has(l.levelId)) fail(`levels[${i}].levelId`, `duplicate level "${l.levelId}"`);
      levelIds.add(l.levelId);
    });
    const e = obj(doc.endless, 'endless');
    const seeds = arr(e.seeds, 'endless.seeds', MAX_SCORE_SEEDS).map((s, i) => seedBestEntry(s, `endless.seeds[${i}]`));
    const seedIds = new Set<string>();
    seeds.forEach((s, i) => {
      if (seedIds.has(s.seed)) fail(`endless.seeds[${i}].seed`, `duplicate seed "${s.seed}"`);
      seedIds.add(s.seed);
    });
    const overallBestDistance = num(e.overallBestDistance, 'endless.overallBestDistance', { min: 0, max: MAX_SCORE_VALUE });
    const maxSeed = seeds.reduce((mx, s) => Math.max(mx, s.bestDistance), 0);
    if (overallBestDistance < maxSeed) fail('endless.overallBestDistance', 'smaller than a per-seed best');
    return { version: SCORE_BOOK_VERSION, levels, endless: { overallBestDistance, seeds } };
  }, m.migratedFrom);
}

export function parseScoreBook(text: string): ValidationResult<ScoreBook> {
  const j = parseJson(text, 'Saved scores');
  return j.ok ? validateScoreBook(j.value) : j;
}
