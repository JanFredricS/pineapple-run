import { App } from './app';
import { createAppAudio } from './game/appAudio';

const host = document.getElementById('app');
if (!host) throw new Error('#app missing');

// One GameAudio for the page; it unlocks on the first tap/key anywhere.
const audio = createAppAudio(document);
const app = new App(host, { name: 'title' }, { audio });
// Dev-server builds only (browser checks inspect the live audio state).
if (import.meta.env.DEV) (window as unknown as { __prAudio?: unknown }).__prAudio = audio;
app.start().catch((err: unknown) => {
  console.error(err);
  host.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
