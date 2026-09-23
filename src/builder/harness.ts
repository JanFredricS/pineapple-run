/**
 * S2 builder harness page (builder-harness.html): the builder standalone
 * against the mock start area. "Test Cart" prints the CartDesign JSON and
 * offers it as a download (S6 wires the hook to the run phase instead).
 */

import type { CartDesign } from '../model/cart';
import { mountBuilder } from './builder';

const host = document.getElementById('builder');
const output = document.getElementById('output');
const json = document.getElementById('json');
const download = document.getElementById('download');
const close = document.getElementById('close');
if (!host || !output || !json || !download || !close) throw new Error('builder harness markup missing');

let lastJson = '';

download.addEventListener('click', () => {
  const blob = new Blob([lastJson], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cart.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
close.addEventListener('click', () => {
  output.hidden = true;
});

const start = (initialDesign?: CartDesign): void => {
  mountBuilder(host, {
    ...(initialDesign ? { initialDesign } : {}),
    onTestCart(design, spec) {
      lastJson = JSON.stringify(design, null, 1);
      json.textContent = lastJson;
      output.hidden = false;
      console.info('[builder] Test Cart', { design, bodies: spec.bodies.length, joints: spec.joints.length });
    },
    // GL1: the builder tore itself down after a WebGL context loss: re-mount with its design
    onContextLost: (design) => start(design),
  })
    .then((builder) => {
      // handy for poking at the builder from devtools
      (window as unknown as { builder: typeof builder }).builder = builder;
    })
    .catch((err: unknown) => {
      console.error(err);
      host.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
    });
};
start();
