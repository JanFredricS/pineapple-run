/**
 * Debug-draw overlay: simple Pixi lines drawn ONLY from the render contract
 * (SceneManifest + RenderSnapshot) plus the physics wrapper's joint lines.
 * No physics objects reach this module.
 */

import { Container, Graphics } from 'pixi.js';
import { cameraTransform, type Camera } from '../model/coords';
import type { Vec2 } from '../model/geometry';
import type { BodyRole, BodyTransform, RenderSnapshot, SceneManifest } from '../model/snapshot';

export interface DebugJointLine {
  a: Vec2;
  b: Vec2;
  kind: 'revolute' | 'distance';
}

const ROLE_COLOR: Record<BodyRole, number> = {
  cart: 0x7fd4ff,
  wheel: 0xffd166,
  pineapple: 0xf4a259,
  terrain: 0x8bd17c,
  prop: 0xc3a6ff,
  debug: 0xffffff,
};

export class DebugDraw {
  readonly view = new Container();
  private readonly staticG = new Graphics();
  private readonly dynamicG = new Graphics();
  private readonly jointG = new Graphics();
  private staticKey = '';

  constructor() {
    this.view.addChild(this.staticG, this.dynamicG, this.jointG);
  }

  draw(manifest: SceneManifest, snapshot: RenderSnapshot, joints: DebugJointLine[], camera: Camera): void {
    const t = cameraTransform(camera);
    this.view.scale.set(t.scale);
    this.view.position.set(t.offsetX, t.offsetY);
    const px = 1 / t.scale; // one screen pixel in metres

    const byId = new Map<number, BodyTransform>(snapshot.bodies.map((b) => [b.id, b]));

    // Static geometry only changes with the manifest (or line width with zoom).
    const key = `${manifest.revision}:${t.scale}`;
    const redrawStatic = key !== this.staticKey;
    if (redrawStatic) {
      this.staticKey = key;
      this.staticG.clear();
    }
    this.dynamicG.clear();

    for (const body of manifest.bodies) {
      const isStatic = body.role === 'terrain' || body.role === 'prop';
      if (isStatic && !redrawStatic) continue;
      const g = isStatic ? this.staticG : this.dynamicG;
      const tr = byId.get(body.id);
      if (!tr) continue;
      const color = ROLE_COLOR[body.role];
      const c = Math.cos(tr.angle);
      const s = Math.sin(tr.angle);
      const w = (p: Vec2): Vec2 => ({ x: tr.x + c * p.x - s * p.y, y: tr.y + s * p.x + c * p.y });
      for (const shape of body.shapes) {
        if (shape.type === 'circle') {
          const ctr = w(shape.center);
          g.circle(ctr.x, ctr.y, shape.radius).stroke({ width: 1.5 * px, color });
          // a spoke so rotation is visible
          const rim = w({ x: shape.center.x + shape.radius, y: shape.center.y });
          g.moveTo(ctr.x, ctr.y).lineTo(rim.x, rim.y).stroke({ width: 1.5 * px, color });
        } else if (shape.type === 'polygon') {
          const pts = shape.vertices.map(w).flatMap((p) => [p.x, p.y]);
          g.poly(pts, true).stroke({ width: 1.5 * px, color });
        } else {
          const pts = shape.points.map(w);
          const first = pts[0];
          if (!first) continue;
          g.moveTo(first.x, first.y);
          for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
          g.stroke({ width: 2 * px, color });
        }
      }
    }

    this.jointG.clear();
    for (const j of joints) {
      if (j.kind === 'revolute') {
        this.jointG.circle(j.a.x, j.a.y, 3 * px).stroke({ width: 1.5 * px, color: 0xff4d6d });
      } else {
        this.jointG.moveTo(j.a.x, j.a.y).lineTo(j.b.x, j.b.y).stroke({ width: 1.5 * px, color: 0xff4d6d });
      }
      // gap marker: anchors should coincide (revolute) — draw the error vector
      if (Math.hypot(j.a.x - j.b.x, j.a.y - j.b.y) > 2 * px && j.kind === 'revolute') {
        this.jointG.moveTo(j.a.x, j.a.y).lineTo(j.b.x, j.b.y).stroke({ width: 2 * px, color: 0xff0000 });
      }
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
