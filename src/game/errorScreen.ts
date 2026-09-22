/**
 * Visible failure state for screen mounts (never a blank host): a heading,
 * the error text, and recovery actions (retry / navigate away).
 */

import type { Screen } from '../app';
import { button, el } from '../ui/dom';

export interface ErrorAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
  testId?: string;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return typeof err === 'string' && err ? err : 'Unknown error';
}

export function mountScreenError(host: HTMLElement, title: string, err: unknown, actions: readonly ErrorAction[]): Screen {
  const root = el(
    'section',
    {
      class: 'pr-screen pr-screen-error',
      role: 'alert',
      'data-testid': 'screen-error',
      style: 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center',
    },
    [
      el('h2', { text: title }),
      el('p', { class: 'pr-screen-error__detail', text: errorMessage(err) }),
      el(
        'div',
        { style: 'display:flex;gap:12px;flex-wrap:wrap;justify-content:center' },
        actions.map((a) => button(a.label, a.onClick, { cls: a.primary ? 'pr-btn--primary' : '', attrs: a.testId ? { 'data-testid': a.testId } : {} })),
      ),
    ],
  );
  host.appendChild(root);
  return { destroy: () => root.remove() };
}
