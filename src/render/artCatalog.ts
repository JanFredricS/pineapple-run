/**
 * Theme-independent art: cart parts, pineapple, blender goal, props, builder
 * backdrop. Each entry carries the metadata the renderer needs to fit the
 * sprite to a physics shape (e.g. which texture circle equals the collision
 * circle), so pose math never hard-codes texture coordinates.
 */

import pineapple from '../../assets/svg/parts/pineapple.svg?raw';
import lime from '../../assets/svg/parts/lime.svg?raw';
import cap from '../../assets/svg/parts/cap.svg?raw';
import straw from '../../assets/svg/parts/straw.svg?raw';
import strawEnd from '../../assets/svg/parts/straw-end.svg?raw';
import cube from '../../assets/svg/parts/cube.svg?raw';
import umbrellaOpen from '../../assets/svg/parts/umbrella-open.svg?raw';
import umbrellaHalf from '../../assets/svg/parts/umbrella-half.svg?raw';
import umbrellaClosed from '../../assets/svg/parts/umbrella-closed.svg?raw';
import umbrellaStick from '../../assets/svg/parts/umbrella-stick.svg?raw';
import pin from '../../assets/svg/parts/pin.svg?raw';
import blenderBase from '../../assets/svg/blender/base.svg?raw';
import blenderJar from '../../assets/svg/blender/jar.svg?raw';
import blenderBlades from '../../assets/svg/blender/blades.svg?raw';
import blenderLid from '../../assets/svg/blender/lid.svg?raw';
import palm from '../../assets/svg/props/palm.svg?raw';
import funnel from '../../assets/svg/props/funnel.svg?raw';
import napkin from '../../assets/svg/builder/napkin.svg?raw';
import type { SvgAssetDef } from './assets';
import { shadeAssetDef } from './textures';
import type { Vec2 } from '../model/geometry';

/** A circle in texture (design px) coordinates that maps onto a collision circle. */
export interface CircleFit {
  cx: number;
  cy: number;
  r: number;
}

export const ART = {
  pineapple: { id: 'part/pineapple', svg: pineapple, fit: { cx: 48, cy: 78, r: 40 } },
  lime: { id: 'part/lime', svg: lime, fit: { cx: 64, cy: 64, r: 62 } },
  cap: { id: 'part/cap', svg: cap, fit: { cx: 64, cy: 64, r: 62 } },
  /** Repeat texture: u along the straw, v across its thickness. */
  straw: { id: 'part/straw', svg: straw, repeat: true },
  strawEnd: { id: 'part/straw-end', svg: strawEnd },
  /** Nine-slice, `border` px corners. */
  cube: { id: 'part/cube', svg: cube, border: 16 },
  umbrella: {
    open: { id: 'part/umbrella-open', svg: umbrellaOpen },
    half: { id: 'part/umbrella-half', svg: umbrellaHalf },
    closed: { id: 'part/umbrella-closed', svg: umbrellaClosed },
    /** Shaft passes through (x, 48) of the 64x96 canopy textures; apex near x=4..6. */
    axisY: 48,
    apexX: 5,
  },
  umbrellaStick: { id: 'part/umbrella-stick', svg: umbrellaStick },
  pin: { id: 'part/pin', svg: pin },
  blender: {
    base: { id: 'blender/base', svg: blenderBase },
    jar: { id: 'blender/jar', svg: blenderJar },
    blades: { id: 'blender/blades', svg: blenderBlades },
    lid: { id: 'blender/lid', svg: blenderLid },
  },
  props: {
    palm: { id: 'prop/palm', svg: palm, anchor: { x: 90 / 200, y: 1 }, metresTall: 7 },
    funnel: { id: 'prop/funnel', svg: funnel, anchor: { x: 0.5, y: 1 }, metresTall: 2.4 },
  },
  napkin: { id: 'builder/napkin', svg: napkin, repeat: true },
} as const;

/**
 * Blender composite layout, in blender-local design px with the origin at the
 * base's bottom-centre (y up is negative). Jar interior polygon is the
 * piña-colada fill mask (jar.svg px, offset by the jar's placement).
 */
export const BLENDER_LAYOUT = {
  base: { x: -80, y: -124 },
  jar: { x: -72, y: -316 },
  lid: { x: -68, y: -340 },
  /** Blades hub (blades.svg (42,20)) sits at the jar bottom centre. */
  blades: { x: 0, y: -134, hubX: 42, hubY: 20 },
  /** Jar interior (fill region) in jar.svg px: top-left, top-right, bottom-right, bottom-left. */
  jarInterior: [
    { x: 20, y: 22 },
    { x: 124, y: 22 },
    { x: 104, y: 190 },
    { x: 40, y: 190 },
  ] as readonly Vec2[],
  /** Total height (design px) — used to scale the composite to world metres. */
  height: 340,
  /** Base width (design px), used to fit the base over the goal sensor. */
  baseWidth: 160,
} as const;

/** Prop art id (LevelDef.props[].art) -> atlas entry. Unknown ids render a placeholder. */
export interface PropArt {
  id: string;
  anchor: { x: number; y: number };
  metresTall: number;
}
export const PROP_ART: ReadonlyMap<string, PropArt> = new Map<string, PropArt>([
  ['palm', ART.props.palm],
  ['funnel', ART.props.funnel],
]);

/** Every theme-independent asset. */
export function coreAssetDefs(): SvgAssetDef[] {
  const u = ART.umbrella;
  const b = ART.blender;
  return [
    ART.pineapple,
    ART.lime,
    ART.cap,
    { ...ART.straw, repeat: true },
    ART.strawEnd,
    ART.cube,
    u.open,
    u.half,
    u.closed,
    ART.umbrellaStick,
    ART.pin,
    b.base,
    b.jar,
    b.blades,
    b.lid,
    ART.props.palm,
    ART.props.funnel,
    { ...ART.napkin, repeat: true },
  ]
    .map((a): SvgAssetDef => ({ id: a.id, svg: a.svg, ...('repeat' in a && a.repeat ? { repeat: true } : {}) }))
    .concat(shadeAssetDef());
}
