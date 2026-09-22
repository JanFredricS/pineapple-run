/**
 * Input router (pure, no DOM): sits between the DOM listeners in builder.ts and
 * the gesture machine / editor. It owns every rule about WHEN input turns into
 * an edit, so those rules are unit-testable without a browser:
 *
 *  - The tool (and snap) are SNAPSHOTTED at strokeStart; a stroke always
 *    commits with the tool it started with, whatever the palette does meanwhile.
 *  - Any pointerdown outside the canvas (`outsideDown`, e.g. a palette tap)
 *    while a gesture is live cancels it via the machine (`reset`) — no commit.
 *  - `reset` (blur, visibility, Clear/Load/Example, phase change) cancels too.
 *  - Draft previews (which run resolveAttachments via `buildPreview`) are
 *    COALESCED: moves only record the latest coordinates and request a frame;
 *    `frame()` resolves at most once. Commits resolve synchronously.
 */

import type { CartDesign } from '../model/cart';
import type { Vec2 } from '../model/geometry';
import { hitTest, isInArea, makeDraft, nextPartId, type Draft, type DrawTool, type Tool } from './edits';
import { GestureMachine, type GestureEffect, type GestureEvent } from './gesture';
import type { PreviewModel } from './preview';
import { screenToDesign, zoomAbout, type BuilderView } from './view';

export interface DraftView {
  draft: Draft;
  /** Committed design + the draft part, resolved. */
  preview: PreviewModel;
  /** Current pointer position in screen px (for the floating label). */
  screenPos: Vec2;
}

export interface InputHost {
  getDesign(): CartDesign;
  getTool(): Tool;
  getSnap(): boolean;
  getView(): BuilderView;
  /** Delete-pick slop in design px for the current view. */
  tolerance(): number;
  setView(v: BuilderView): void;
  /** Called synchronously on stroke commit with the tool snapshotted at strokeStart (design px). */
  commit(tool: Tool, snap: boolean, start: Vec2, end: Vec2): void;
  /** Draft preview changed (null = no draft). */
  onDraft(d: DraftView | null): void;
  onHover(id: string | null): void;
  onStrokeStart(): void;
  /** Ask for `frame()` to be called on the next animation frame (idempotent is fine). */
  requestFrame(): void;
  /** Injected so tests can count resolutions. */
  buildPreview(design: CartDesign): PreviewModel;
}

export class InputRouter {
  private readonly machine = new GestureMachine();
  private stroke: { tool: Tool; snap: boolean } | null = null;
  private pending: { start: Vec2; pos: Vec2 } | null = null;
  private frameRequested = false;

  constructor(private readonly host: InputHost) {}

  get gestureState() {
    return this.machine.state;
  }

  /** Tool the live stroke will commit with (null when no stroke). */
  get strokeTool(): Tool | null {
    return this.stroke?.tool ?? null;
  }

  down(pointerId: number, pos: Vec2, time: number, button = 0): void {
    this.send({ type: 'down', pointerId, pos, time, button });
  }
  move(pointerId: number, pos: Vec2, time: number): void {
    this.send({ type: 'move', pointerId, pos, time });
  }
  up(pointerId: number, pos: Vec2, time: number): void {
    this.send({ type: 'up', pointerId, pos, time });
  }
  /** lostpointercapture: cancels only if the pointer is tracked. */
  cancel(pointerId: number): void {
    this.send({ type: 'cancel', pointerId });
  }
  /** pointercancel, blur, visibility, design replacement, phase change: full reset. */
  reset(): void {
    this.send({ type: 'reset' });
    this.stroke = null;
    this.pending = null;
  }
  /** A pointerdown anywhere outside the canvas (palette, panels, page). */
  outsideDown(): void {
    if (this.machine.state.name !== 'idle') this.reset();
  }

  /** Idle hover (mouse/pen) for the delete tool. Cheap: no resolution. */
  hover(pos: Vec2 | null): void {
    if (this.machine.state.name !== 'idle') return;
    if (!pos || this.host.getTool() !== 'delete') return this.host.onHover(null);
    this.host.onHover(hitTest(this.host.getDesign(), screenToDesign(pos, this.host.getView()), this.host.tolerance()));
  }

  /** Process the latest coalesced move: at most one preview resolution per call. */
  frame(): void {
    this.frameRequested = false;
    const p = this.pending;
    this.pending = null;
    if (!p || !this.stroke) return;
    const view = this.host.getView();
    const design = this.host.getDesign();
    if (this.stroke.tool === 'delete') {
      this.host.onHover(hitTest(design, screenToDesign(p.pos, view), this.host.tolerance()));
      return;
    }
    const s = screenToDesign(p.start, view);
    if (!isInArea(s)) return this.host.onDraft(null);
    const draft = makeDraft(this.stroke.tool as DrawTool, s, screenToDesign(p.pos, view), nextPartId(design), { snap: this.stroke.snap });
    const preview = this.host.buildPreview({ ...design, parts: [...design.parts, draft.part] });
    this.host.onDraft({ draft, preview, screenPos: p.pos });
  }

  private send(ev: GestureEvent): void {
    this.apply(this.machine.send(ev));
  }

  private schedule(start: Vec2, pos: Vec2): void {
    this.pending = { start, pos };
    if (!this.frameRequested) {
      this.frameRequested = true;
      this.host.requestFrame();
    }
  }

  private apply(effects: GestureEffect[]): void {
    const h = this.host;
    for (const fx of effects) {
      switch (fx.type) {
        case 'strokeStart':
          this.stroke = { tool: h.getTool(), snap: h.getSnap() };
          h.onStrokeStart();
          this.schedule(fx.pos, fx.pos);
          break;
        case 'strokeUpdate':
          if (this.stroke) this.schedule(fx.start, fx.pos);
          break;
        case 'strokeCommit': {
          const s = this.stroke;
          this.stroke = null;
          this.pending = null;
          h.onDraft(null);
          if (s) {
            const view = h.getView();
            h.commit(s.tool, s.snap, screenToDesign(fx.start, view), screenToDesign(fx.pos, view));
          }
          h.onHover(null);
          break;
        }
        case 'strokeCancel':
          this.stroke = null;
          this.pending = null;
          h.onDraft(null);
          h.onHover(null);
          break;
        case 'view':
          h.setView(zoomAbout(h.getView(), fx.factor, fx.from, fx.to));
          break;
      }
    }
  }
}
