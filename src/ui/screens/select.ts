import { COURSES, endlessLevelId, isUnlocked, lockReason, type CourseInfo } from '../catalog';
import { button, disposer, el, icon } from '../dom';
import { formatClock, formatDelivered, formatDistance, ratingViewOf } from '../format';
import { BACK_SVG, DICE_SVG, LOCK_SVG } from '../icons';
import type { ScoreStore } from '../scoreStore';
import { randomSeed, validateSeed } from '../seed';
import type { ScoreBook } from '../../model/score';

export interface SelectScreenOptions {
  store: ScoreStore;
  onSelect(levelId: string): void;
  onBack(): void;
  /** Seed pre-filled in the endless card (default: a fresh random seed). */
  initialSeed?: string;
}

function courseCard(book: ScoreBook, c: CourseInfo, onSelect: (id: string) => void): HTMLElement {
  const unlocked = isUnlocked(book, c.levelId);
  const best = book.levels.find((l) => l.levelId === c.levelId);
  const art = el('div', { class: 'pr-card__art', 'data-theme': c.theme });
  // S6T #6: the recovered course is kept vertex-exact and is labelled expert content.
  if (c.bonus) art.append(el('span', { class: 'pr-card__tag', text: 'Bonus · Expert' }));
  if (best) {
    const v = ratingViewOf(best.bestRating);
    art.append(el('span', { class: `pr-badge pr-band-${v.band}`, text: v.text, title: `Best: ${v.text} (${v.bandLabel})` }));
  } else if (unlocked) {
    art.append(el('span', { class: 'pr-badge pr-badge--none', text: 'New' }));
  }
  if (!unlocked) art.append(el('div', { class: 'pr-card__lock' }, [icon(LOCK_SVG), el('span', { text: lockReason(c.levelId) })]));
  const card = el(
    'button',
    {
      type: 'button',
      class: 'pr-card',
      'data-level': c.levelId,
      'aria-disabled': unlocked ? undefined : 'true',
      'aria-label': unlocked ? `${c.name}${best ? `, best ${best.bestRating}%` : ''}` : `${c.name}, locked. ${lockReason(c.levelId)}`,
    },
    [
      art,
      el('div', { class: 'pr-card__body' }, [
        el('div', { class: 'pr-card__name', text: c.name }),
        el('div', { class: 'pr-card__blurb', text: c.blurb }),
        el('div', {
          class: 'pr-card__foot',
          text: !unlocked ? 'Locked' : best ? `Best ${formatClock(best.seconds)} × ${formatDelivered(best.delivered)}` : 'Not played yet',
        }),
      ]),
    ],
  );
  card.addEventListener('click', () => {
    if (unlocked) onSelect(c.levelId);
  });
  return card;
}

function endlessCard(book: ScoreBook, initialSeed: string, onSelect: (id: string) => void): HTMLElement {
  const input = el('input', {
    type: 'text',
    value: initialSeed,
    maxlength: 16,
    spellcheck: 'false',
    autocomplete: 'off',
    autocapitalize: 'characters',
    enterkeyhint: 'go',
    'aria-label': 'Endless seed',
    'data-testid': 'seed-input',
  });
  const msg = el('div', { class: 'pr-seed__msg', 'aria-live': 'polite' });
  const bestLine = el('div', { class: 'pr-card__blurb' });
  const play = button('Play endless', () => submit(), { cls: 'pr-btn--primary' });
  const overall = book.endless.overallBestDistance;

  const refresh = () => {
    const v = validateSeed(input.value);
    input.setAttribute('aria-invalid', String(!v.ok));
    play.disabled = !v.ok;
    if (!v.ok) {
      msg.textContent = v.message;
      msg.dataset.error = 'true';
      return;
    }
    delete msg.dataset.error;
    const seedBest = book.endless.seeds.find((s) => s.seed === v.seed);
    msg.textContent = seedBest ? `Best on this seed: ${formatDistance(seedBest.bestDistance)}` : 'New seed';
  };
  const submit = () => {
    const v = validateSeed(input.value);
    if (!v.ok) {
      refresh();
      input.focus();
      return;
    }
    onSelect(endlessLevelId(v.seed));
  };
  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  const dice = button('', () => {
    input.value = randomSeed();
    refresh();
  }, { cls: 'pr-btn--icon', icon: DICE_SVG, attrs: { 'aria-label': 'Random seed', title: 'Random seed' } });

  bestLine.textContent = overall > 0 ? `Overall best: ${formatDistance(overall)}` : 'Drive as far as you can without losing every pineapple.';
  refresh();
  const art = el('div', { class: 'pr-card__art', 'data-theme': 'endless' }, [el('span', { class: 'pr-card__tag', text: 'Endless' })]);
  return el('div', { class: 'pr-card pr-card--endless', 'data-level': 'endless', role: 'group', 'aria-label': 'Endless mode' }, [
    art,
    el('div', { class: 'pr-card__body' }, [
      el('div', { class: 'pr-card__name', text: 'Endless' }),
      bestLine,
      el('div', { class: 'pr-seed' }, [input, dice]),
      msg,
      play,
    ]),
  ]);
}

export function mountSelectScreen(host: HTMLElement, opts: SelectScreenOptions): { destroy(): void } {
  const d = disposer();
  const book = opts.store.load();
  const cards = el('div', { class: 'pr-cards' });
  for (const c of COURSES) cards.append(courseCard(book, c, opts.onSelect));
  cards.append(endlessCard(book, opts.initialSeed ?? randomSeed(), opts.onSelect));
  const root = el('section', { class: 'pr-screen pr-select', 'aria-label': 'Choose a course' }, [
    el('div', { class: 'pr-bar' }, [
      button('', opts.onBack, { cls: 'pr-btn--icon', icon: BACK_SVG, attrs: { 'aria-label': 'Back to title' } }),
      el('h2', { text: 'Choose a course' }),
    ]),
    cards,
  ]);
  host.appendChild(root);
  d.listen(window, 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape' && !(e.target instanceof HTMLInputElement)) opts.onBack();
  });
  return {
    destroy() {
      d.dispose();
      root.remove();
    },
  };
}
