/**
 * Gravity zones and force fields (S9 exotic physics): LevelDef zones of kind
 * 'gravity' (low-gravity pockets) and 'force' ("gravity shooters") become
 * static Box2D SENSOR bodies (role 'zone', partIds = model/zones zoneTag), and
 * this field turns sensor membership into per-body gravity scale and force.
 *
 * Determinism: membership changes only through Box2D's sensor begin/end
 * events of the previous fixed step (deterministic, fixed-step, no clock);
 * the gravity scale and force a body feels are pure functions of its
 * membership SET (model/zones: min scale, summed acceleration × mass). Order
 * of the per-step loop is by body handle.
 *
 * Per fixed step (RunController.step):
 *   preStep():  for every member body — set its gravity scale when it
 *               changed, apply mass × acceleration at its centre (Box2D
 *               clears forces after each step, so this runs every step);
 *               bodies that left every zone get scale 1 back once.
 *   world.step()
 *   postStep(): read the step's sensor events and update membership counts
 *               (one count per overlapping visitor SHAPE, so a multi-shape
 *               cart body stays in while any of its shapes does).
 *
 * Visitors: every shape on a dynamic body in a world created with
 * `sensorVisitors: true` (cart parts, pineapples), except shapes that opt out
 * (the bead ocean's beads). Destroyed bodies drop out on the next preStep.
 */

import type { ZoneDef } from '../model/level';
import { accelerationOf, gravityScaleOf, isFieldZone, rectCentre, rectLocalBox, zoneTag, type FieldZone } from '../model/zones';
import type { BodyHandle, PhysicsWorld } from '../physics/engine';

export interface ZoneBody {
  zone: FieldZone;
  handle: BodyHandle;
}

export class ZoneField {
  readonly zones: readonly ZoneBody[];
  private readonly bySensor = new Map<BodyHandle, FieldZone>();
  /** body -> (zone -> overlapping shape count). */
  private readonly members = new Map<BodyHandle, Map<FieldZone, number>>();
  /** Gravity scale last set on a body by this field (absent = never touched, i.e. 1). */
  private readonly applied = new Map<BodyHandle, number>();

  constructor(
    private readonly world: PhysicsWorld,
    zones: readonly ZoneDef[],
  ) {
    const field = zones.filter(isFieldZone);
    if (field.length > 0 && !world.sensorVisitors) {
      throw new Error('ZoneField: the world must be created with sensorVisitors (else no body can enter a zone)');
    }
    this.zones = field.map((zone) => {
      const handle = world.createBody({ type: 'static', position: rectCentre(zone.rect), role: 'zone', partIds: zoneTag(zone) });
      world.addSensorPolygon(handle, rectLocalBox(zone.rect), zone.id);
      this.bySensor.set(handle, zone);
      return { zone, handle };
    });
  }

  /** Apply gravity scales and forces for the coming step. */
  preStep(): void {
    const w = this.world;
    const handles = new Set<BodyHandle>([...this.members.keys(), ...this.applied.keys()]);
    for (const h of [...handles].sort((a, b) => a - b)) {
      if (!w.hasBody(h)) {
        this.members.delete(h);
        this.applied.delete(h);
        continue;
      }
      const inside = this.members.get(h);
      // level order, so the float sum does not depend on the order the zones were entered
      const zs = inside ? this.zones.map((z) => z.zone).filter((z) => inside.has(z)) : [];
      const scale = gravityScaleOf(zs);
      if ((this.applied.get(h) ?? 1) !== scale) w.setGravityScale(h, scale);
      if (scale === 1) this.applied.delete(h);
      else this.applied.set(h, scale);
      const a = accelerationOf(zs);
      if (a.x !== 0 || a.y !== 0) {
        const m = w.getMass(h);
        w.applyForceToCenter(h, { x: a.x * m, y: a.y * m });
      }
    }
  }

  /** Update membership from the sensor events of the step just taken. */
  postStep(): void {
    const { begin, end } = this.world.sensorEvents();
    for (const e of begin) {
      const z = this.bySensor.get(e.sensor);
      if (!z) continue;
      let m = this.members.get(e.visitor);
      if (!m) this.members.set(e.visitor, (m = new Map()));
      m.set(z, (m.get(z) ?? 0) + 1);
    }
    for (const e of end) {
      const z = this.bySensor.get(e.sensor);
      const m = this.members.get(e.visitor);
      if (!z || !m) continue;
      const n = (m.get(z) ?? 0) - 1;
      if (n > 0) m.set(z, n);
      else m.delete(z);
      if (m.size === 0) this.members.delete(e.visitor);
    }
  }

  /** Zone ids a body is in (sorted), for tests / debug. */
  zonesOf(handle: BodyHandle): string[] {
    const m = this.members.get(handle);
    return m ? [...m.keys()].map((z) => z.id).sort() : [];
  }

  /** Bodies currently inside the zone with this id (ascending handles). */
  membersOf(zoneId: string): BodyHandle[] {
    const out: BodyHandle[] = [];
    for (const [h, m] of this.members) if ([...m.keys()].some((z) => z.id === zoneId)) out.push(h);
    return out.sort((a, b) => a - b);
  }

  destroy(): void {
    for (const z of this.zones) if (this.world.hasBody(z.handle)) this.world.destroyBody(z.handle);
    this.members.clear();
    this.applied.clear();
  }
}
