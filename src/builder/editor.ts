/**
 * Builder editor state + reducer (pure): what the palette buttons and
 * completed strokes do to the CartDesign. The DOM layer (builder.ts) only
 * dispatches actions and renders the result.
 */

import { CART_DESIGN_VERSION, type CartDesign } from '../model/cart';
import type { Vec2 } from '../model/geometry';
import { applyStroke, clearAll, type EditOutcome, type Tool } from './edits';
import { exampleCart } from './exampleCart';

export interface EditorState {
  design: CartDesign;
  tool: Tool;
  snap: boolean;
}

export type EditorAction =
  | { type: 'setTool'; tool: Tool }
  | { type: 'setSnap'; snap: boolean }
  /**
   * A completed stroke in design px; `tolerance` = delete pick slop (design px).
   * `tool`/`snap` are the values snapshotted when the stroke STARTED (default:
   * the current ones) — a mid-stroke palette change never alters the commit.
   */
  | { type: 'stroke'; start: Vec2; end: Vec2; tolerance: number; tool?: Tool; snap?: boolean }
  | { type: 'clearAll' }
  | { type: 'loadExample' }
  /** Replace the design (must already be validated, e.g. from CartStore). */
  | { type: 'load'; design: CartDesign };

export interface EditorStep {
  state: EditorState;
  outcome?: EditOutcome;
}

export const emptyDesign = (): CartDesign => ({ version: CART_DESIGN_VERSION, parts: [] });

export const initialEditorState = (design: CartDesign = emptyDesign()): EditorState => ({ design, tool: 'straw', snap: false });

export function reduceEditor(state: EditorState, action: EditorAction): EditorStep {
  switch (action.type) {
    case 'setTool':
      return { state: { ...state, tool: action.tool } };
    case 'setSnap':
      return { state: { ...state, snap: action.snap } };
    case 'stroke': {
      const r = applyStroke(state.design, action.tool ?? state.tool, action.start, action.end, {
        snap: action.snap ?? state.snap,
        tolerance: action.tolerance,
      });
      return { state: r.design === state.design ? state : { ...state, design: r.design }, outcome: r.outcome };
    }
    case 'clearAll': {
      const { name: _name, ...rest } = clearAll(state.design);
      return { state: { ...state, design: rest } };
    }
    case 'loadExample':
      return { state: { ...state, design: exampleCart() } };
    case 'load':
      return { state: { ...state, design: action.design } };
  }
}
