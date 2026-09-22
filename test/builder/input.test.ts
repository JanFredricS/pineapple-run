import { describe, expect, it } from 'vitest';
import type { CartDesign } from '../../src/model/cart';
import type { Vec2 } from '../../src/model/geometry';
import type { Tool } from '../../src/builder/edits';
import { initialEditorState, reduceEditor, type EditorAction, type EditorState } from '../../src/builder/editor';
import { InputRouter, type DraftView } from '../../src/builder/input';
import { buildPreview } from '../../src/builder/preview';
import type { BuilderView } from '../../src/builder/view';

/**
 * Harness mirroring builder.ts's wiring (same router, same editor reducer),
 * with a manual animation-frame queue and a counting buildPreview.
 */
function setup() {
  let editor: EditorState = initialEditorState();
  // identity view: screen px == design px, so y must be <= 0 to be in the build area
  let view: BuilderView = { scale: 1, offsetX: 0, offsetY: 0 };
  const log: string[] = [];
  let frames: Array<() => void> = [];
  let resolutions = 0;
  let draft: DraftView | null = null;
  let hover: string | null = null;

  const dispatch = (a: EditorAction) => {
    // builder.ts: design replacement resets input first
    if (a.type === 'clearAll' || a.type === 'load' || a.type === 'loadExample') router.reset();
    editor = reduceEditor(editor, a).state;
  };

  const router: InputRouter = new InputRouter({
    getDesign: () => editor.design,
    getTool: () => editor.tool,
    getSnap: () => editor.snap,
    getView: () => view,
    tolerance: () => 10,
    setView: (v) => (view = v),
    commit: (tool, snap, start, end) => {
      log.push(`commit:${tool}`);
      dispatch({ type: 'stroke', tool, snap, start, end, tolerance: 10 });
    },
    onDraft: (d) => (draft = d),
    onHover: (id) => (hover = id),
    onStrokeStart: () => log.push('start'),
    requestFrame: () => frames.push(() => router.frame()),
    buildPreview: (d: CartDesign) => {
      resolutions++;
      return buildPreview(d);
    },
  });

  const runFrame = () => {
    const f = frames;
    frames = [];
    for (const cb of f) cb();
  };

  return {
    router,
    dispatch,
    runFrame,
    log,
    get editor() {
      return editor;
    },
    get resolutions() {
      return resolutions;
    },
    get pendingFrames() {
      return frames.length;
    },
    get draft() {
      return draft;
    },
    get hover() {
      return hover;
    },
    setTool: (tool: Tool) => dispatch({ type: 'setTool', tool }),
  };
}

const P = (x: number, y: number): Vec2 => ({ x, y });

describe('InputRouter: stroke commits', () => {
  it('a plain stroke commits one straw', () => {
    const h = setup();
    h.router.down(1, P(10, -50), 0);
    h.router.move(1, P(80, -50), 16);
    h.router.up(1, P(80, -50), 32);
    expect(h.log).toEqual(['start', 'commit:straw']);
    expect(h.editor.design.parts.map((p) => p.kind)).toEqual(['straw']);
    expect(h.draft).toBeNull();
  });

  it('the tool is snapshotted at stroke start: a mid-stroke tool change does not change the committed kind', () => {
    const h = setup();
    h.router.down(1, P(10, -50), 0);
    h.router.move(1, P(60, -50), 16);
    // keyboard / programmatic tool change (no pointerdown) during the stroke
    h.setTool('wheel');
    h.router.up(1, P(80, -50), 32);
    expect(h.log).toEqual(['start', 'commit:straw']);
    expect(h.editor.design.parts.map((p) => p.kind)).toEqual(['straw']);
    expect(h.editor.tool).toBe('wheel');
  });

  it('snap is snapshotted too', () => {
    const h = setup();
    h.router.down(1, P(0, -50), 0);
    h.dispatch({ type: 'setSnap', snap: true });
    h.router.up(1, P(100, -57), 32); // ~4 deg: would snap flat if snap applied
    const s = h.editor.design.parts[0]!;
    expect(s.kind === 'straw' && s.b.y).toBe(-57);
  });
});

describe('InputRouter: palette / outside taps', () => {
  it('a palette tap (pointerdown outside the canvas) during a stroke cancels it: no commit, no draft', () => {
    const h = setup();
    h.router.down(1, P(10, -50), 0);
    h.router.move(1, P(80, -50), 16);
    h.runFrame();
    expect(h.draft).not.toBeNull();
    // second finger taps a palette button -> window capture listener -> outsideDown
    h.router.outsideDown();
    h.setTool('wheel'); // the button's own action then runs
    expect(h.draft).toBeNull();
    expect(h.router.gestureState).toEqual({ name: 'idle' });
    // the first finger lifts on the canvas: nothing is committed
    h.router.up(1, P(90, -50), 40);
    expect(h.log).toEqual(['start']);
    expect(h.editor.design.parts).toEqual([]);
  });

  it('outsideDown when idle is a no-op', () => {
    const h = setup();
    h.router.outsideDown();
    h.router.down(1, P(10, -50), 0);
    h.router.up(1, P(80, -50), 10);
    expect(h.log).toEqual(['start', 'commit:straw']);
  });

  it('pending frame after a cancel does not resurrect the draft', () => {
    const h = setup();
    h.router.down(1, P(10, -50), 0);
    h.router.move(1, P(80, -50), 16);
    h.router.outsideDown();
    h.runFrame();
    expect(h.draft).toBeNull();
    expect(h.resolutions).toBe(0);
  });
});

describe('InputRouter: design replacement during a stroke', () => {
  for (const action of [{ type: 'clearAll' }, { type: 'loadExample' }, { type: 'load', design: { version: 1, parts: [] } }] as EditorAction[]) {
    it(`${action.type} while a stroke is live cancels it first`, () => {
      const h = setup();
      h.router.down(1, P(10, -50), 0);
      h.router.move(1, P(80, -50), 16);
      h.dispatch(action);
      const after = structuredClone(h.editor.design);
      h.router.up(1, P(90, -50), 40);
      expect(h.log).toEqual(['start']);
      expect(h.editor.design).toEqual(after);
      expect(h.draft).toBeNull();
    });
  }
});

describe('InputRouter: preview coalescing', () => {
  it('N moves within one frame resolve the preview exactly once, with the latest coordinates', () => {
    const h = setup();
    h.router.down(1, P(10, -50), 0);
    for (let i = 1; i <= 25; i++) h.router.move(1, P(10 + i * 4, -50), i);
    expect(h.resolutions).toBe(0);
    expect(h.pendingFrames).toBe(1);
    h.runFrame();
    expect(h.resolutions).toBe(1);
    const part = h.draft!.draft.part;
    expect(part.kind === 'straw' && part.b).toEqual(P(110, -50));
    expect(h.draft!.screenPos).toEqual(P(110, -50));
    // a frame with no new moves does no work
    h.runFrame();
    expect(h.resolutions).toBe(1);
  });

  it('commit resolves synchronously even with an unprocessed frame pending', () => {
    const h = setup();
    h.router.down(1, P(10, -50), 0);
    h.router.move(1, P(50, -50), 5);
    h.router.move(1, P(80, -50), 6);
    h.router.up(1, P(80, -50), 7);
    const s = h.editor.design.parts[0]!;
    expect(s.kind === 'straw' && s.b).toEqual(P(80, -50));
    h.runFrame();
    expect(h.resolutions).toBe(0);
    expect(h.draft).toBeNull();
  });
});

describe('InputRouter: cancel paths', () => {
  it('lostpointercapture for the drawing pointer cancels; for an untracked pointer it is ignored', () => {
    const h = setup();
    h.router.down(1, P(10, -50), 0);
    h.router.cancel(7);
    h.router.up(1, P(80, -50), 10);
    expect(h.log).toEqual(['start', 'commit:straw']);
    h.router.down(2, P(10, -80), 20);
    h.router.cancel(2);
    h.router.up(2, P(80, -80), 30);
    expect(h.log).toEqual(['start', 'commit:straw', 'start']);
  });

  it('pinch pointercancel is a full reset to idle', () => {
    const h = setup();
    h.router.down(1, P(10, -50), 0);
    h.router.down(2, P(100, -50), 10);
    expect(h.router.gestureState.name).toBe('pinch');
    h.router.reset();
    expect(h.router.gestureState).toEqual({ name: 'idle' });
  });

  it('delete tool: the pick under the finger updates per frame and the commit deletes', () => {
    const h = setup();
    h.router.down(1, P(10, -50), 0);
    h.router.up(1, P(80, -50), 10);
    h.setTool('delete');
    h.router.down(2, P(45, -50), 20);
    h.runFrame();
    expect(h.hover).toBe(h.editor.design.parts[0]!.id);
    h.router.up(2, P(45, -50), 30);
    expect(h.editor.design.parts).toEqual([]);
    expect(h.log.at(-1)).toBe('commit:delete');
  });
});
