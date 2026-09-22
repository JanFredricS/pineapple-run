/**
 * Registry of live palette presses (button -> release). Buttons are rebuilt
 * whenever the carts panel / confirm boxes re-render, so entries whose element
 * has left the document are pruned: once after each synchronous build (a
 * microtask, so freshly created buttons have been attached by then) and on
 * every `releaseAll` (input reset). Nothing accumulates.
 */
export class PressRegistry<T extends { readonly isConnected: boolean }> {
  private readonly entries = new Map<T, () => void>();
  private pruneQueued = false;

  constructor(private readonly defer: (fn: () => void) => void = (fn) => queueMicrotask(fn)) {}

  register(el: T, release: () => void): void {
    this.entries.set(el, release);
    if (this.pruneQueued) return;
    this.pruneQueued = true;
    this.defer(() => {
      this.pruneQueued = false;
      this.prune();
    });
  }

  prune(): void {
    for (const el of [...this.entries.keys()]) if (!el.isConnected) this.entries.delete(el);
  }

  /** Release every live press (on input reset). */
  releaseAll(): void {
    this.prune();
    for (const release of this.entries.values()) release();
  }

  get size(): number {
    return this.entries.size;
  }
}
