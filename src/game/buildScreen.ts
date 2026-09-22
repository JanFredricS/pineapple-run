/**
 * AppState 'build': the real S2 builder over the course's real start area
 * (terrain near the start + the S1 funnel, INTEGRATION #6). "Test Cart"
 * stores the design as the tested cart and dispatches `startRun`.
 */

import type { AppAction, AppState, MountContext, Screen } from '../app';
import { mountBuilder, type BuilderHandle } from '../builder/builder';
import { parseRunTarget } from '../ui/catalog';
import { button, el } from '../ui/dom';
import { draftDesign, setDraftDesign, setTestedDesign } from './cartState';
import { courseFor } from './courses';
import { startAreaPx } from './startArea';
import './game.css';

type Dispatch = (action: AppAction) => Promise<void> | void;

export async function mountBuildScreen(
  host: HTMLElement,
  state: Extract<AppState, { name: 'build' }>,
  dispatch: Dispatch,
  ctx: MountContext,
): Promise<Screen> {
  const course = courseFor(state.levelId);
  if (!course) return mountMissingCourse(host, state.levelId, 'Back to levels', () => void dispatch({ type: 'backToSelect' }));

  const root = el('div', { class: 'pr-build', style: 'position:absolute;inset:0' });
  const builderHost = el('div', { style: 'position:absolute;inset:0' });
  const target = parseRunTarget(state.levelId);
  const title = target.kind === 'endless' ? `Endless ${target.seed}` : (target.course?.name ?? state.levelId);
  const back = button('Levels', () => void dispatch({ type: 'backToSelect' }), { cls: 'pr-build__back', attrs: { 'data-testid': 'build-back' } });
  const bar = el('div', { class: 'pr-build__bar' }, [back, el('span', { class: 'pr-build__title', text: title })]);
  root.append(builderHost, bar);
  host.appendChild(root);

  let builder: BuilderHandle | null = null;
  let destroyed = false;
  try {
    builder = await mountBuilder(builderHost, {
      initialDesign: draftDesign(),
      startArea: startAreaPx(course.level, course.source),
      onChange: (d) => setDraftDesign(d),
      onTestCart: (d) => {
        if (destroyed || !ctx.isCurrent()) return;
        setTestedDesign(d);
        void dispatch({ type: 'startRun' });
      },
    });
  } catch (err) {
    root.remove();
    throw err;
  }
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      builder?.destroy();
      root.remove();
    },
  };
}

/** Unknown level id: say so and offer the way back (never a blank screen). */
export function mountMissingCourse(host: HTMLElement, levelId: string, label: string, onBack: () => void): Screen {
  const root = el('section', { class: 'pr-screen', style: 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px' }, [
    el('h2', { text: `Course "${levelId}" not found` }),
    button(label, onBack, { cls: 'pr-btn--primary' }),
  ]);
  host.appendChild(root);
  return { destroy: () => root.remove() };
}
