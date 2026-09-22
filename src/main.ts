import { App } from './app';

const host = document.getElementById('app');
if (!host) throw new Error('#app missing');

const app = new App(host);
app.start().catch((err: unknown) => {
  console.error(err);
  host.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
