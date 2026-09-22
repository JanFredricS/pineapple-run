import { button, disposer, el, icon } from '../dom';
import { formatClock, formatDelivered, formatDistance, formatInt, ratingViewOf } from '../format';
import { CLOCK_SVG, DISTANCE_SVG, PINEAPPLE_SVG } from '../icons';
import type { EndlessResults, LevelResults, ResultsModel } from '../resultsModel';
import { randomSeed } from '../seed';
import { endlessLevelId } from '../catalog';

export interface ResultsActions {
  retry(): void;
  editCart(): void;
  levels(): void;
  /** Go to another course's build (next level / new endless seed). */
  selectLevel(levelId: string): void;
}

const op = (s: string) => el('span', { class: 'pr-eq__op', text: s, 'aria-hidden': 'true' });
const newBest = () => el('span', { class: 'pr-newbest', text: 'New best!' });

function levelPanel(m: LevelResults): HTMLElement[] {
  const eq = el('div', { class: 'pr-eq', 'data-testid': 'rating-equation' }, [
    el('span', { class: 'pr-eq__term', 'aria-label': `Time ${formatClock(m.seconds, { tenths: true })}` }, [icon(CLOCK_SVG), formatClock(m.seconds, { tenths: true })]),
    op('×'),
    el('span', { class: 'pr-eq__term', 'aria-label': `${m.delivered} of 15 delivered` }, [icon(PINEAPPLE_SVG), formatDelivered(m.delivered)]),
    op('='),
    el('span', {
      class: `pr-score pr-band-${m.rating.band}`,
      'data-band': m.rating.band,
      'data-testid': 'rating',
      'aria-label': `Efficiency rating ${m.rating.text}, ${m.rating.bandLabel}`,
      text: m.rating.text,
    }),
  ]);
  const meta = el('div', { class: 'pr-results__meta' });
  if (m.gaveUp) meta.append(el('span', { text: 'You gave up — no score recorded.' }));
  else if (m.newBest) {
    meta.append(newBest());
    if (m.previousBest) meta.append(el('span', { text: `Previous best ${ratingViewOf(m.previousBest.bestRating).text}` }));
  } else if (m.best) {
    meta.append(el('span', {}, ['Best ', el('strong', { text: ratingViewOf(m.best.bestRating).text }), ` (${formatClock(m.best.seconds)} × ${formatDelivered(m.best.delivered)})`]));
  }
  if (!m.gaveUp && !m.saved) meta.append(el('span', { text: '(not saved)' }));
  return [el('div', { class: 'pr-panel__head', text: `Your Efficiency Rating — ${m.courseName}` }), el('div', { class: 'pr-panel__body' }, [eq, meta])];
}

function endlessPanel(m: EndlessResults): HTMLElement[] {
  const eq = el('div', { class: 'pr-eq', 'data-testid': 'endless-equation' }, [
    el('span', { class: 'pr-eq__term', 'aria-label': `Distance ${m.view.distanceText}` }, [icon(DISTANCE_SVG), m.view.distanceText]),
    op('+'),
    el('span', { class: 'pr-eq__term', 'aria-label': `Carry bonus ${m.view.bonus}, ${m.view.aboard} aboard` }, [icon(PINEAPPLE_SVG), `${m.view.aboard} aboard`]),
    op('='),
    el('span', { class: 'pr-score pr-score--neutral', 'data-testid': 'endless-score', text: formatInt(m.view.score) }),
  ]);
  const meta = el('div', { class: 'pr-results__meta' }, [
    el('span', {}, ['Carry bonus ', el('strong', { text: `+${formatInt(m.view.bonus)}` })]),
    el('span', {}, ['Time ', el('strong', { text: formatClock(m.seconds) })]),
  ]);
  const bests = el('div', { class: 'pr-results__meta' }, [
    el('span', {}, [`Best on ${m.seed} `, el('strong', { text: formatDistance(m.seedBest) })]),
    m.newSeedBest ? newBest() : null,
    el('span', {}, ['Overall best ', el('strong', { text: formatDistance(m.overallBest) })]),
    m.newOverallBest ? el('span', { class: 'pr-newbest', text: 'Record!' }) : null,
    !m.saved ? el('span', { text: '(not saved)' }) : null,
  ]);
  return [el('div', { class: 'pr-panel__head', text: `Endless — seed ${m.seed}` }), el('div', { class: 'pr-panel__body' }, [eq, meta, bests])];
}

export function mountResultsScreen(host: HTMLElement, model: ResultsModel, actions: ResultsActions): { destroy(): void } {
  const d = disposer();
  const panel = el('div', { class: 'pr-panel', role: 'group' }, model.kind === 'level' ? levelPanel(model) : endlessPanel(model));
  const retry = button('Retry', actions.retry, { cls: 'pr-btn--primary', attrs: { 'data-testid': 'retry' } });
  const buttons: HTMLElement[] = [retry, button('Edit cart', actions.editCart), button('Courses', actions.levels)];
  if (model.kind === 'level' && model.next) {
    const next = model.next;
    const b = button(`Next: ${next.name}`, () => actions.selectLevel(next.levelId), { attrs: { 'data-testid': 'next' } });
    b.disabled = !model.nextUnlocked;
    if (!model.nextUnlocked) b.title = 'Deliver at least one pineapple in time to unlock';
    buttons.splice(1, 0, b);
  }
  if (model.kind === 'endless') {
    buttons.splice(1, 0, button('New seed', () => actions.selectLevel(endlessLevelId(randomSeed()))));
  }
  const actionsPanel = el('div', { class: 'pr-panel' }, [
    el('div', { class: 'pr-panel__head', text: 'Try again?' }),
    el('div', { class: 'pr-panel__body' }, [el('div', { class: 'pr-actions' }, buttons)]),
  ]);
  const root = el('section', { class: 'pr-screen pr-results', 'aria-label': 'Results' }, [panel, actionsPanel]);
  host.appendChild(root);
  d.listen(window, 'keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === 'Escape') actions.levels();
  });
  queueMicrotask(() => retry.focus({ preventScroll: true }));
  return {
    destroy() {
      d.dispose();
      root.remove();
    },
  };
}
