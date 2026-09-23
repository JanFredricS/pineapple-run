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
 * UX1 (Jan: "The build area is too small"): 360 x 210 px (12 x 7 m) ->
 * 530 x 210 px = 17.67 m x 7 m (1.47x wider, 1.47x the area).
 *  - It grows LEFT (behind the cart): the right edge stays at 340 px because
 *    the recovered 2008 course's plateau ends at 355.7 px (its vertices are
 *    fixed) and the premade courses' first hazards start right after their
 *    plateau. The funnel (design x 115) ends up near the middle of the area.
 *  - It does NOT grow taller: the funnel outlet must clear the area's top
 *    (startArea.ts FUNNEL_OFFSET_PX), and raising it even 0.5 m changed the
 *    tuned pour into the example cart chaotically (measured: the original
 *    course's expert line lost the load at 87 m, the kitchen pace line fell
 *    to 12/15 while flooring it got 15/15; at 1.5x height, workbench 3/15).
 * Old designs (inside the old area) all still fit.
 */
export const BUILD_AREA: Area = { minX: -190, minY: -210, maxX: 340, maxY: 0 };

/** Mock start-area props (drawn only; S3/S6 replace with the real level): 40 px above the build area. */
export const MOCK_FUNNEL = { x: 115, y: BUILD_AREA.minY - 40, topWidth: 110, bottomWidth: 36, height: 50 };

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
