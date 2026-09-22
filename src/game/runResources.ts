/**
 * Run-mount resource acquisition (DOM/Pixi-free so it is unit-testable).
 *
 * The run screen needs three things loaded concurrently: the page-shared Pixi
 * Application, the page-shared theme textures, and a per-run RunSession (a
 * fresh WASM physics world + terrain + controller). The first two are cached
 * for the page and never released here; the session is owned by the mount.
 *
 * Promise.all would lose the session handle if another loader rejected after
 * the session had been created (the session would leak: world, terrain bodies,
 * controller listeners). allSettled keeps every outcome, so any fulfilled
 * session is destroyed before the first failure is rethrown.
 */

export interface Destroyable {
  destroy(): void;
}

export interface RunLoaders<A, L, S extends Destroyable> {
  app: () => Promise<A>;
  lib: () => Promise<L>;
  session: () => Promise<S>;
}

export interface RunResources<A, L, S extends Destroyable> {
  app: A;
  lib: L;
  session: S;
}

export async function acquireRunResources<A, L, S extends Destroyable>(
  loaders: RunLoaders<A, L, S>,
): Promise<RunResources<A, L, S>> {
  // Loaders are invoked inside the async bodies so a synchronous throw is a
  // rejection like any other (and cannot skip cleanup of the others).
  const [app, lib, session] = await Promise.allSettled([
    (async () => loaders.app())(),
    (async () => loaders.lib())(),
    (async () => loaders.session())(),
  ]);
  if (app.status === 'fulfilled' && lib.status === 'fulfilled' && session.status === 'fulfilled') {
    return { app: app.value, lib: lib.value, session: session.value };
  }
  if (session.status === 'fulfilled') session.value.destroy();
  const failed = [app, lib, session].find((r): r is PromiseRejectedResult => r.status === 'rejected');
  throw failed?.reason;
}
