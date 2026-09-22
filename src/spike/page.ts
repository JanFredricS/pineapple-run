/**
 * S0 stability spike page: the hand-written spike cart (12 straws, 4 powered
 * wheels) + 15 pineapples on washboard test terrain, built through the
 * production path, drawn with the debug overlay.
 *
 * Controls: ← / → (or A / D) drive, R resets. On touch screens, hold the
 * on-screen ◀ / ▶ buttons. Input is cleared whenever the page loses focus or
 * visibility (the loop also pauses then).
 */

import { Application, Text } from 'pixi.js';
import type { Camera } from '../model/coords';
import type { DriveDirection } from '../physics/compound';
import { FrameLoop } from '../physics/clock';
import { PhysicsWorld } from '../physics/engine';
import { DebugDraw } from '../render/debugDraw';
import { countAboard, createSpikeScene, type SpikeScene } from './scene';

export interface SpikePage {
  destroy(): void;
}

export async function mountSpikePage(host: HTMLElement): Promise<SpikePage> {
  const app = new Application();
  await app.init({ resizeTo: host, background: 0x1d2330, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2) });
  host.appendChild(app.canvas);

  let world = await PhysicsWorld.create();
  let scene: SpikeScene = createSpikeScene(world);
  const debug = new DebugDraw();
  app.stage.addChild(debug.view);

  const hud = new Text({ text: '', style: { fill: 0xffffff, fontSize: 14, fontFamily: 'monospace' } });
  hud.position.set(10, 10);
  app.stage.addChild(hud);

  // ------------------------------------------------------------ input
  const held = { left: false, right: false };
  const drive = (): DriveDirection => (held.right === held.left ? 0 : held.right ? 1 : -1);
  const clearInput = () => {
    held.left = false;
    held.right = false;
  };
  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') held.left = down;
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') held.right = down;
    else if (e.code === 'KeyR' && down) reset();
    else return;
    e.preventDefault();
  };
  const onKeyDown = onKey(true);
  const onKeyUp = onKey(false);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  const buttons = touchButtons(host, held);

  // ------------------------------------------------------------ camera
  const camera: Camera = { center: { x: 0, y: 8 }, zoom: 1, viewportWidth: 1, viewportHeight: 1 };
  let fps = 60;
  let lastFrame = performance.now();

  // Reset creates a new world asynchronously. A generation token makes only
  // the latest request win; stale or post-destroy creations are destroyed
  // immediately, so no world is ever orphaned.
  let generation = 0;
  let pageDestroyed = false;
  const reset = () => {
    const gen = ++generation;
    if (!world.isDestroyed) world.destroy();
    void PhysicsWorld.create().then((w) => {
      if (pageDestroyed || gen !== generation) {
        w.destroy();
        return;
      }
      world = w;
      scene = createSpikeScene(world);
      loop.clock.reset();
    });
  };

  const loop = new FrameLoop({
    step() {
      if (world.isDestroyed) return;
      scene.cart.setDrive(drive());
      scene.step();
    },
    render(alpha) {
      if (world.isDestroyed) return;
      const now = performance.now();
      fps = fps * 0.9 + (1000 / Math.max(1, now - lastFrame)) * 0.1;
      lastFrame = now;

      const snap = world.snapshot(alpha);
      const chassis = snap.bodies.find((b) => b.id === scene.chassis);
      const w = app.screen.width;
      const h = app.screen.height;
      camera.viewportWidth = w;
      camera.viewportHeight = h;
      // fit ~24 m of course across narrow (phone) screens, 1:1 on desktop
      camera.zoom = Math.min(1.5, Math.max(0.5, w / (24 * 30)));
      if (chassis) {
        camera.center.x += (chassis.x + 3 - camera.center.x) * 0.15;
        camera.center.y += (chassis.y - 2 - camera.center.y) * 0.15;
      }
      debug.draw(world.manifest(), snap, world.debugJointLines(snap), camera);
      hud.text =
        `fps ${fps.toFixed(0)}  t ${snap.simTime.toFixed(1)} s  step ${snap.step}\n` +
        `aboard ${countAboard(world, scene)}/15  x ${chassis ? chassis.x.toFixed(1) : '?'} m\n` +
        `←/→ drive   R reset${loop.clock.paused ? '   [paused]' : ''}`;
    },
    onPauseChange(paused) {
      if (paused) clearInput();
    },
  });
  loop.bindVisibility();
  loop.start();

  return {
    destroy() {
      pageDestroyed = true;
      generation++;
      loop.stop();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      buttons.remove();
      debug.destroy();
      if (!world.isDestroyed) world.destroy();
      app.destroy(true, { children: true });
    },
  };
}

/** Two hold-to-drive buttons for touch screens. */
function touchButtons(host: HTMLElement, held: { left: boolean; right: boolean }): HTMLElement {
  const bar = document.createElement('div');
  bar.style.cssText =
    'position:absolute;left:0;right:0;bottom:calc(16px + env(safe-area-inset-bottom,0px));display:flex;justify-content:space-between;padding:0 16px;pointer-events:none';
  const mk = (label: string, key: 'left' | 'right') => {
    const b = document.createElement('button');
    b.textContent = label;
    b.setAttribute('aria-label', key === 'left' ? 'Drive left' : 'Drive right');
    b.style.cssText =
      'pointer-events:auto;width:72px;height:72px;border-radius:50%;border:2px solid #fff6;background:#fff2;color:#fff;font-size:28px;touch-action:none';
    const on = (e: PointerEvent) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      held[key] = true;
    };
    const off = () => {
      held[key] = false;
    };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('lostpointercapture', off);
    return b;
  };
  bar.append(mk('◀', 'left'), mk('▶', 'right'));
  host.appendChild(bar);
  return bar;
}
