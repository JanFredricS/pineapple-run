/**
 * S2 boundary rules: the builder never touches physics, and every attachment
 * decision in the preview comes from model/attach (resolveAttachments).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(__dirname, '..', '..', 'src', 'builder');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ name: f, text: readFileSync(join(dir, f), 'utf8') }));
const importsOf = (text: string) => [...text.matchAll(/from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);

describe('builder architecture', () => {
  it('never imports physics, box2d, spike or the app shell', () => {
    const bad = files.flatMap((f) => importsOf(f.text).filter((i) => /box2d|physics|spike|\.\.\/app\b/.test(i)).map((i) => `${f.name} -> ${i}`));
    expect(bad).toEqual([]);
  });

  it('pure modules (everything but the DOM/Pixi layer) do not import pixi', () => {
    const domLayer = new Set(['builder.ts', 'render.ts', 'harness.ts']);
    const bad = files.filter((f) => !domLayer.has(f.name) && importsOf(f.text).some((i) => i.includes('pixi'))).map((f) => f.name);
    expect(bad).toEqual([]);
  });

  it('the preview is derived from resolveAttachments', () => {
    const preview = files.find((f) => f.name === 'preview.ts')!.text;
    expect(preview).toMatch(/resolveAttachments\(design\)/);
  });
});
