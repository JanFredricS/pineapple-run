/**
 * Builder-local constants (S2). Geometry RULES (min sizes, snap radius,
 * welding) live in model/cart.ts + model/attach.ts and are never duplicated
 * here; these are UI/interaction tunables only.
 *
 * Design-frame convention used by the builder's mock start area: design
 * y = 0 is the start-area ground line (y-down, so the cart is drawn at
 * negative y). An integrating level should set `LevelDef.cartStart` to the
 * world position of the ground at the start plateau.
 */

/** Axis-aligned rectangle in design px. */
export interface Area {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Where parts may be drawn (design px). Draft points are clamped into it —
 * the original likewise ignored build clicks outside its start area.
 * 360 x 210 px = 12 m x 7 m.
 */
export const BUILD_AREA: Area = { minX: -20, minY: -210, maxX: 340, maxY: 0 };

/** Mock start-area props (drawn only; S3/S6 replace with the real level). */
export const MOCK_FUNNEL = { x: 115, y: -250, topWidth: 110, bottomWidth: 36, height: 50 };

/**
 * A second pointer landing within this many ms of the first one's
 * pointerdown cancels the in-progress draw and becomes pinch-zoom/pan.
 */
export const GESTURE_GRACE_MS = 250;

/** Angle-snap increment (degrees) for straws and shocks. */
export const ANGLE_SNAP_DEG = 15;

/** View zoom limits (screen px per design px). */
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 6;

/** Touch-friendly hit tolerance for the delete tool, in SCREEN px. */
export const HIT_TOLERANCE_SCREEN_PX = 10;

/** Coordinates are rounded to this many decimals when a part is committed. */
export const COORD_DECIMALS = 2;

/** localStorage key prefix for named carts. */
export const CART_STORAGE_PREFIX = 'pineapple-run.cart.';
