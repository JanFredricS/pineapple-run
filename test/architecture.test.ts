/**
 * Module-boundary rules from PLAN.md "Architecture":
 *  - src/physics/engine.ts is the ONLY module that imports box2d3-wasm;
 *  - src/model/ is pure: no Pixi, no physics, no DOM-facing modules.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const srcDir = join(root, 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|mjs)$/.test(name) ? [p] : [];
  });
}

const files = walk(srcDir).map((p) => ({
  path: relative(root, p).split('\\').join('/'),
  imports: [...readFileSync(p, 'utf8').matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
    (m) => (m[1] ?? m[2])!,
  ),
}));

describe('architecture', () => {
  it('finds the source files', () => {
    expect(files.some((f) => f.path === 'src/physics/engine.ts')).toBe(true);
  });

  it('only src/physics/engine.ts imports box2d3-wasm', () => {
    const offenders = files
      .filter((f) => f.imports.some((i) => i.includes('box2d')))
      .map((f) => f.path)
      .filter((p) => p !== 'src/physics/engine.ts');
    expect(offenders).toEqual([]);
  });

  it('src/model is pure (no pixi, physics, render or spike imports)', () => {
    const offenders = files
      .filter((f) => f.path.startsWith('src/model/'))
      .flatMap((f) =>
        f.imports
          .filter((i) => /pixi|box2d|\/physics\/|\/render\/|\/spike\/|^\.\.\/(physics|render|spike|ui|audio|builder|run)\b/.test(i))
          .map((i) => `${f.path} -> ${i}`),
      );
    expect(offenders).toEqual([]);
  });
});
