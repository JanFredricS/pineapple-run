/** Unit tests for the pure S1 run helpers (no physics). */
import { describe, expect, it } from 'vitest';
import { PINEAPPLE_RADIUS } from '../../src/physics/cargo';
import { CAMERA_OFFSET_PX, CameraFollow } from '../../src/run/camera';
import { FUNNEL_HEIGHT, FUNNEL_OUTLET_HALF_WIDTH, FUNNEL_WALL_ANGLE, funnelGeometry } from '../../src/run/funnel';
import { DriveInput, bindTouchButton, sideForKey } from '../../src/run/input';
import { circleTouchesRect, expandBox, pointInBox, shapesWorldAABB, unionBoxes } from '../../src/run/shapes';
import { TerrainIndex } from '../../src/run/terrainQuery';

describe('DriveInput', () => {
  it('maps ←/→ and A/D; both sides or none = coast', () => {
    const i = new DriveInput();
    expect(i.direction).toBe(0);
    i.keyDown('ArrowRight');
    expect(i.direction).toBe(1);
    i.keyDown('KeyA');
    expect(i.direction).toBe(0);
    i.keyUp('ArrowRight');
    expect(i.direction).toBe(-1);
    i.keyUp('KeyA');
    expect(i.direction).toBe(0);
    expect(sideForKey('KeyD')).toBe('right');
    expect(sideForKey('ArrowLeft')).toBe('left');
    expect(sideForKey('Space')).toBeNull();
    expect(i.keyDown('Space')).toBe(false);
  });

  it('tracks each source separately (two keys / two fingers on one side)', () => {
    const i = new DriveInput();
    i.keyDown('ArrowRight');
    i.keyDown('KeyD');
    i.keyUp('ArrowRight');
    expect(i.direction).toBe(1);
    i.keyUp('KeyD');
    expect(i.direction).toBe(0);
    i.touchStart('left', 1);
    i.touchStart('left', 2);
    i.touchEnd(1);
    expect(i.direction).toBe(-1);
    i.touchEnd(2);
    expect(i.direction).toBe(0);
    // a pointer sliding to the other button moves sides, never holds both
    i.touchStart('left', 3);
    i.touchStart('right', 3);
    expect(i.direction).toBe(1);
    expect(i.isHeld('left')).toBe(false);
  });

  it('clear() drops every held key and pointer (blur / visibility)', () => {
    const i = new DriveInput();
    i.keyDown('ArrowRight');
    i.touchStart('right', 7);
    i.clear();
    expect(i.direction).toBe(0);
    // a stale keyup after the clear is harmless
    i.keyUp('ArrowRight');
    expect(i.direction).toBe(0);
  });

  describe('bindTouchButton wiring (the harness buttons use exactly this)', () => {
    const setup = () => {
      const input = new DriveInput();
      const right = Object.assign(new EventTarget(), { captured: [] as number[], setPointerCapture(id: number) { this.captured.push(id); } });
      const left = new EventTarget();
      const unbindR = bindTouchButton(right, 'right', input);
      const unbindL = bindTouchButton(left, 'left', input);
      const fire = (el: EventTarget, type: string, pointerId: number) => {
        const e = Object.assign(new Event(type, { cancelable: true }), { pointerId });
        el.dispatchEvent(e);
        return e;
      };
      return { input, right, left, fire, unbind: () => (unbindR(), unbindL()) };
    };

    it('pointerdown drives (with capture); pointerup releases only that finger', () => {
      const { input, right, fire } = setup();
      expect(fire(right, 'pointerdown', 1).defaultPrevented).toBe(true);
      expect(right.captured).toEqual([1]);
      fire(right, 'pointerdown', 2);
      fire(right, 'pointerup', 1);
      expect(input.direction).toBe(1); // finger 2 still down
      fire(right, 'pointerup', 2);
      expect(input.direction).toBe(0);
    });

    it('pointercancel clears ALL input: other fingers and held keys too', () => {
      const { input, right, left, fire } = setup();
      input.keyDown('KeyD');
      fire(right, 'pointerdown', 1);
      fire(left, 'pointerdown', 2);
      fire(left, 'pointerup', 2);
      fire(right, 'pointerdown', 3);
      fire(right, 'pointercancel', 1);
      expect(input.direction).toBe(0);
      expect(input.isHeld('right')).toBe(false);
      expect(input.hasSource('key:KeyD')).toBe(false);
      expect(input.hasSource('pointer:3')).toBe(false);
    });

    it('lostpointercapture while the pointer is still held is a cancellation (full clear); after a normal pointerup it is a no-op', () => {
      const { input, right, left, fire } = setup();
      input.keyDown('ArrowRight');
      fire(left, 'pointerdown', 4);
      fire(left, 'pointerup', 4);
      fire(left, 'lostpointercapture', 4); // browsers fire this after every pointerup
      expect(input.direction).toBe(1); // the held key survives
      fire(right, 'pointerdown', 5);
      fire(right, 'lostpointercapture', 5); // capture stolen mid-press
      expect(input.direction).toBe(0);
      expect(input.hasSource('key:ArrowRight')).toBe(false);
    });

    it('unbinds', () => {
      const { input, right, fire, unbind } = setup();
      unbind();
      fire(right, 'pointerdown', 1);
      expect(input.direction).toBe(0);
    });
  });

  it('bindKeyboard listens for keydown/keyup, prevents default for drive keys only, and unbinds', () => {
    const target = new EventTarget();
    const i = new DriveInput();
    const unbind = i.bindKeyboard(target);
    const key = (type: string, code: string) => {
      const e = Object.assign(new Event(type, { cancelable: true }), { code });
      target.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(key('keydown', 'KeyD')).toBe(true);
    expect(i.direction).toBe(1);
    expect(key('keydown', 'KeyX')).toBe(false);
    expect(key('keyup', 'KeyD')).toBe(true);
    expect(i.direction).toBe(0);
    unbind();
    key('keydown', 'KeyD');
    expect(i.direction).toBe(0);
  });
});

describe('CameraFollow', () => {
  it('moves 10% of the way per step toward right-most x − 100 px', () => {
    const cam = new CameraFollow({ x: 0, y: 0 });
    const off = CAMERA_OFFSET_PX / 30;
    cam.snap({ x: 10, y: 5 });
    expect(cam.position).toEqual({ x: 10 + off, y: 5 });
    cam.step({ x: 20, y: 5 });
    expect(cam.position.x).toBeCloseTo(10 + off + 0.1 * 10, 12);
    for (let i = 0; i < 200; i++) cam.step({ x: 20, y: 5 });
    expect(cam.position.x).toBeCloseTo(20 + off, 6);
  });

  it('holds still without a target and interpolates between steps', () => {
    const cam = new CameraFollow({ x: 0, y: 0 });
    cam.snap({ x: 0, y: 0 });
    const p0 = cam.position;
    cam.step({ x: 10, y: 0 });
    const p1 = cam.position;
    expect(cam.interpolated(0.5).x).toBeCloseTo((p0.x + p1.x) / 2, 12);
    cam.step(null);
    expect(cam.position).toEqual(p1);
    expect(cam.interpolated(0.3)).toEqual(p1);
  });
});

describe('shapes', () => {
  it('circleTouchesRect: inside, edge contact, corner miss', () => {
    const r = { x: 0, y: 0, width: 2, height: 1 };
    expect(circleTouchesRect({ x: 1, y: 0.5 }, 0.1, r)).toBe(true);
    expect(circleTouchesRect({ x: 2.3, y: 0.5 }, 0.3, r)).toBe(true);
    expect(circleTouchesRect({ x: 2.3, y: 0.5 }, 0.29, r)).toBe(false);
    expect(circleTouchesRect({ x: 2.25, y: -0.25 }, 0.3, r)).toBe(false); // corner: dist 0.354
  });

  it('shapesWorldAABB rotates body-local shapes; unions and margins', () => {
    const shapes = [
      { type: 'polygon' as const, partId: 'a', vertices: [{ x: -1, y: -0.1 }, { x: 1, y: -0.1 }, { x: 1, y: 0.1 }, { x: -1, y: 0.1 }] },
      { type: 'circle' as const, partId: 'b', center: { x: 1, y: 0 }, radius: 0.5 },
    ];
    const box = shapesWorldAABB(shapes, { x: 10, y: 5, angle: Math.PI / 2 })!;
    expect(box.minX).toBeCloseTo(9.5, 9);
    expect(box.maxX).toBeCloseTo(10.5, 9);
    expect(box.minY).toBeCloseTo(4, 9);
    expect(box.maxY).toBeCloseTo(6.5, 9);
    expect(shapesWorldAABB([], { x: 0, y: 0, angle: 0 })).toBeNull();
    const u = unionBoxes([box, null, { minX: 0, minY: 0, maxX: 1, maxY: 1 }])!;
    expect(u).toEqual({ minX: 0, minY: 0, maxX: 10.5, maxY: box.maxY });
    const e = expandBox({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, { side: 0.5, top: 2, bottom: 0 });
    expect(e).toEqual({ minX: -0.5, maxX: 1.5, minY: -2, maxY: 1 });
    expect(pointInBox({ x: 1.5, y: -2 }, e)).toBe(true);
    expect(pointInBox({ x: 1.6, y: 0 }, e)).toBe(false);
  });
});

describe('TerrainIndex', () => {
  const spans = [
    { id: 'a', points: [{ x: -10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 }] },
    { id: 'b', points: [{ x: 8, y: 5 }, { x: 20, y: 5 }] },
  ];
  const t = new TerrainIndex(spans);

  it('knows the extent and measures distance to the nearest segment', () => {
    expect([t.minX, t.maxX]).toEqual([-10, 20]);
    expect(t.distanceTo({ x: -5, y: 9 })).toBeCloseTo(1, 12);
    expect(t.distanceTo({ x: 2.5, y: 7.5 - Math.SQRT2 * 0.5 }, 1)).toBeCloseTo(0.5, 9);
    expect(t.distanceTo({ x: 100, y: 5 })).toBe(Infinity);
  });

  it('circleTouches respects gaps between spans', () => {
    const r = PINEAPPLE_RADIUS;
    expect(t.circleTouches({ x: -3, y: 10 - r }, r)).toBe(true);
    expect(t.circleTouches({ x: -3, y: 10 - r - 0.2 }, r)).toBe(false);
    expect(t.circleTouches({ x: 6.5, y: 5 - r }, r)).toBe(false); // over the gap x 5..8
    expect(t.circleTouches({ x: 12, y: 5 - r }, r)).toBe(true);
  });

  it('handles empty terrain', () => {
    const e = new TerrainIndex([]);
    expect([e.minX, e.maxX]).toEqual([0, 0]);
    expect(e.circleTouches({ x: 0, y: 0 }, 1)).toBe(false);
  });
});

describe('funnelGeometry', () => {
  it('holds 15 pineapples inside the V, above the plug, without overlaps', () => {
    const outlet = { x: 5, y: 4 };
    const g = funnelGeometry(outlet, 15);
    expect(g.spawns).toHaveLength(15);
    const r = PINEAPPLE_RADIUS;
    for (const p of g.spawns) {
      const h = outlet.y - p.y;
      expect(h).toBeGreaterThanOrEqual(r);
      expect(h).toBeLessThanOrEqual(FUNNEL_HEIGHT - r);
      // clear of both walls: horizontal clearance r / sin(angle)
      const half = FUNNEL_OUTLET_HALF_WIDTH + h / Math.tan(FUNNEL_WALL_ANGLE);
      expect(Math.abs(p.x - outlet.x) + r / Math.sin(FUNNEL_WALL_ANGLE)).toBeLessThanOrEqual(half);
    }
    for (let i = 0; i < g.spawns.length; i++) {
      for (let j = i + 1; j < g.spawns.length; j++) {
        const a = g.spawns[i]!;
        const b = g.spawns[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(2 * r);
      }
    }
    // the plug spans the outlet, just below it
    const xs = g.plug.map((v) => v.x);
    expect(Math.min(...xs)).toBeLessThan(outlet.x - FUNNEL_OUTLET_HALF_WIDTH);
    expect(Math.max(...xs)).toBeGreaterThan(outlet.x + FUNNEL_OUTLET_HALF_WIDTH);
    expect(Math.min(...g.plug.map((v) => v.y))).toBe(outlet.y);
  });

  it('is deterministic per seed', () => {
    expect(funnelGeometry({ x: 0, y: 0 }, 15, 7)).toEqual(funnelGeometry({ x: 0, y: 0 }, 15, 7));
    expect(funnelGeometry({ x: 0, y: 0 }, 15, 7)).not.toEqual(funnelGeometry({ x: 0, y: 0 }, 15, 8));
  });
});
