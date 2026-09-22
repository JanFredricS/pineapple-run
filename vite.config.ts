import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { precachePlugin } from './src/ui/precache';

// box2d3-wasm's package entry picks the threaded "deluxe" build whenever SIMD
// is available outside a browser (e.g. Node/Vitest). We always want the
// single-threaded "compat" build (GitHub Pages cannot send COOP/COEP headers),
// so we alias straight to it. Only src/physics/engine.ts imports this alias.
const box2dCompat = fileURLToPath(
  new URL('./node_modules/box2d3-wasm/build/dist/es/compat/Box2D.compat.mjs', import.meta.url),
);

export default defineConfig({
  base: '/pineapple-run/',
  plugins: [precachePlugin()],
  resolve: {
    alias: {
      '#box2d-compat': box2dCompat,
    },
  },
  optimizeDeps: {
    exclude: ['box2d3-wasm'],
  },
  build: {
    target: 'es2022',
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        builder: fileURLToPath(new URL('./builder-harness.html', import.meta.url)),
        'run-harness': fileURLToPath(new URL('./run-harness.html', import.meta.url)),
        uiHarness: fileURLToPath(new URL('./ui-harness.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
