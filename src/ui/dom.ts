/** Tiny DOM helpers for the S5 screens. Text always goes in via textContent. */

import './ui.css';

type Attrs = Record<string, string | number | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') e.className = String(v);
    else if (k === 'text') e.textContent = String(v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

/** Parse one of our own static SVG icon strings (icons.ts) into a node. */
export function icon(svg: string): Element {
  const t = document.createElement('template');
  t.innerHTML = svg;
  return t.content.firstElementChild!;
}

export function button(
  label: string,
  onClick: () => void,
  opts: { cls?: string; icon?: string; attrs?: Attrs } = {},
): HTMLButtonElement {
  const b = el('button', { type: 'button', class: `pr-btn ${opts.cls ?? ''}`.trim(), ...opts.attrs });
  if (opts.icon) b.append(icon(opts.icon));
  if (label) b.append(el('span', { text: label }));
  b.addEventListener('click', onClick);
  return b;
}

export interface Disposer {
  add(fn: () => void): void;
  listen<T extends EventTarget>(target: T, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void;
  dispose(): void;
}

export function disposer(): Disposer {
  const fns: (() => void)[] = [];
  return {
    add: (fn) => fns.push(fn),
    listen(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      fns.push(() => target.removeEventListener(type, fn, opts));
    },
    dispose() {
      while (fns.length) {
        try {
          fns.pop()!();
        } catch (e) {
          console.error(e);
        }
      }
    },
  };
}
