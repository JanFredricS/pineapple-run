import { describe, expect, it } from 'vitest';
import { PressRegistry } from '../../src/builder/pressRegistry';

describe('PressRegistry', () => {
  it('default scheduler works when called as a method (no "Illegal invocation")', async () => {
    const reg = new PressRegistry<{ isConnected: boolean }>();
    const gone = { isConnected: false };
    expect(() => reg.register(gone, () => {})).not.toThrow();
    await Promise.resolve();
    expect(reg.size).toBe(0);
  });

  it('prunes elements that left the document, so re-rendered panels do not accumulate closures', () => {
    const queue: Array<() => void> = [];
    const reg = new PressRegistry<{ isConnected: boolean }>((fn) => queue.push(fn));
    const flush = () => queue.splice(0).forEach((f) => f());
    const fixed = { isConnected: true };
    reg.register(fixed, () => {});
    flush();
    // re-render a panel 50 times: each render detaches the previous buttons
    let current: Array<{ isConnected: boolean }> = [];
    for (let r = 0; r < 50; r++) {
      for (const b of current) b.isConnected = false;
      current = [0, 1, 2].map(() => ({ isConnected: false }));
      for (const b of current) reg.register(b, () => {});
      for (const b of current) b.isConnected = true; // attached synchronously after creation
      flush();
    }
    expect(reg.size).toBe(1 + 3);
  });

  it('releaseAll releases live presses and drops detached ones', () => {
    const reg = new PressRegistry<{ isConnected: boolean }>(() => {});
    const released: string[] = [];
    const a = { isConnected: true };
    const b = { isConnected: true };
    reg.register(a, () => released.push('a'));
    reg.register(b, () => released.push('b'));
    b.isConnected = false;
    reg.releaseAll();
    expect(released).toEqual(['a']);
    expect(reg.size).toBe(1);
  });
});
