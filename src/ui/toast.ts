/** Small non-blocking toasts (body-level, survive screen changes). */

import { el } from './dom';

let host: HTMLElement | null = null;

function toastHost(): HTMLElement {
  if (host && host.isConnected) return host;
  host = el('div', { class: 'pr-toasts', role: 'status', 'aria-live': 'polite' });
  document.body.appendChild(host);
  return host;
}

export function showToast(message: string, ms = 4500): void {
  const t = el('div', { class: 'pr-toast', text: message });
  toastHost().appendChild(t);
  const remove = () => t.remove();
  t.addEventListener('click', remove);
  setTimeout(remove, ms);
}
