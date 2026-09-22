import { describe, expect, it } from 'vitest';
import { CART_STORAGE_PREFIX } from '../../src/builder/constants';
import { exampleCart } from '../../src/builder/exampleCart';
import { CartStore, normalizeCartName, type StorageLike } from '../../src/builder/storage';

/** In-memory Storage mock with an optional byte quota and failure injection. */
class MockStorage implements StorageLike {
  map = new Map<string, string>();
  quota = Infinity;
  failWith: unknown = null;
  removeFailsWith: unknown = null;
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    if (this.failWith) throw this.failWith;
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.failWith) throw this.failWith;
    let used = 0;
    for (const [kk, vv] of this.map) if (kk !== k) used += kk.length + vv.length;
    if (used + k.length + v.length > this.quota) {
      const e = new Error('The quota has been exceeded.');
      e.name = 'QuotaExceededError';
      throw e;
    }
    this.map.set(k, v);
  }
  removeItem(k: string) {
    if (this.removeFailsWith) throw this.removeFailsWith;
    this.map.delete(k);
  }
}

const setup = () => {
  const mem = new MockStorage();
  return { mem, store: new CartStore(mem) };
};

describe('CartStore save/load', () => {
  it('round-trips a cart through model/validate', () => {
    const { store } = setup();
    const d = exampleCart();
    const saved = store.save('  My   cart ', d);
    expect(saved).toEqual({ ok: true, value: { name: 'My cart', partCount: 12 } });
    const loaded = store.load('My cart');
    expect(loaded.ok && loaded.value).toEqual({ ...d, name: 'My cart' });
    expect(store.list()).toEqual({ ok: true, value: { carts: [{ name: 'My cart', partCount: 12 }], problems: [] } });
  });

  it('names with odd characters are stored safely and listed sorted', () => {
    const { store } = setup();
    store.save('zeta/%?', exampleCart());
    store.save('Alpha "quoted"', exampleCart());
    const l = store.list();
    expect(l.ok && l.value.carts.map((c) => c.name)).toEqual(['Alpha "quoted"', 'zeta/%?']);
    expect(store.load('zeta/%?').ok).toBe(true);
  });

  it('overwrites an existing name and reports existence', () => {
    const { store } = setup();
    store.save('a', exampleCart());
    expect(store.exists('a')).toBe(true);
    expect(store.exists('b')).toBe(false);
    store.save('a', { version: 1, parts: [] });
    const l = store.load('a');
    expect(l.ok && l.value.parts).toEqual([]);
  });

  it('rejects empty / over-long names', () => {
    const { store, mem } = setup();
    expect(store.save('   ', exampleCart())).toMatchObject({ ok: false, error: { code: 'invalidName' } });
    expect(normalizeCartName('x'.repeat(101)).ok).toBe(false);
    expect(mem.map.size).toBe(0);
  });

  it('refuses to save a schema-invalid design', () => {
    const { store, mem } = setup();
    const bad = { version: 1 as const, parts: [{ id: 'a', kind: 'lime' as const, center: { x: 0, y: 0 }, radius: -1 }] };
    expect(store.save('bad', bad)).toMatchObject({ ok: false, error: { code: 'invalidDesign' } });
    expect(mem.map.size).toBe(0);
  });

  it('notFound for a missing name', () => {
    expect(setup().store.load('nope')).toMatchObject({ ok: false, error: { code: 'notFound' } });
  });

  it('remove deletes a saved cart', () => {
    const { store } = setup();
    store.save('a', exampleCart());
    expect(store.remove('a').ok).toBe(true);
    expect(store.exists('a')).toBe(false);
  });
});

describe('CartStore failure handling', () => {
  it('quota exceeded: recoverable error, nothing written, previous save intact', () => {
    const { store, mem } = setup();
    store.save('small', { version: 1, parts: [] });
    const before = new Map(mem.map);
    mem.quota = [...mem.map].reduce((n, [k, v]) => n + k.length + v.length, 0) + 50;
    const r = store.save('big', exampleCart());
    expect(r).toMatchObject({ ok: false, error: { code: 'quota', name: 'big' } });
    expect(!r.ok && r.error.message).toMatch(/Storage is full/);
    expect(mem.map).toEqual(before);
    // overwriting "small" with something too big also leaves the old copy
    const r2 = store.save('small', exampleCart());
    expect(r2).toMatchObject({ ok: false, error: { code: 'quota' } });
    expect(store.load('small').ok).toBe(true);
  });

  it('legacy quota error shapes (code 22 / Firefox name) are recognised', () => {
    const { store, mem } = setup();
    mem.failWith = { name: 'NS_ERROR_DOM_QUOTA_REACHED' };
    expect(store.save('x', exampleCart())).toMatchObject({ ok: false, error: { code: 'quota' } });
    mem.failWith = Object.assign(new Error('full'), { code: 22 });
    expect(store.save('x', exampleCart())).toMatchObject({ ok: false, error: { code: 'quota' } });
  });

  it('storage unavailable (SecurityError / disabled) is surfaced, never thrown', () => {
    const store = new CartStore(() => {
      throw Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' });
    });
    expect(store.save('x', exampleCart())).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(store.load('x')).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(store.list()).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(store.remove('x')).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(store.exists('x')).toBe(false);
  });

  it('corrupted JSON: load reports it and discards the entry', () => {
    const { store, mem } = setup();
    mem.map.set(CART_STORAGE_PREFIX + 'broken', '{"version":1,"parts":[{');
    const r = store.load('broken');
    expect(r).toMatchObject({ ok: false, error: { code: 'corrupt', name: 'broken', cause: { code: 'invalidJson' } } });
    expect(!r.ok && r.error.message).toMatch(/damaged and has been discarded/);
    expect(mem.map.has(CART_STORAGE_PREFIX + 'broken')).toBe(false);
  });

  it('schema-invalid saved JSON is corrupt too (never reaches the builder unvalidated)', () => {
    const { store, mem } = setup();
    mem.map.set(CART_STORAGE_PREFIX + 'evil', JSON.stringify({ version: 1, parts: [{ id: 'a', kind: 'rocket' }] }));
    expect(store.load('evil')).toMatchObject({ ok: false, error: { code: 'corrupt', cause: { code: 'schema' } } });
  });

  it('list discards corrupt entries, reports them, and keeps good ones', () => {
    const { store, mem } = setup();
    store.save('good', exampleCart());
    mem.map.set(CART_STORAGE_PREFIX + 'bad', 'not json');
    mem.map.set(CART_STORAGE_PREFIX + '%E0%A4%A', '{}'); // undecodable name
    mem.map.set('some.other.app', 'untouched');
    const l = store.list();
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    expect(l.value.carts).toEqual([{ name: 'good', partCount: 12 }]);
    expect(l.value.problems.map((p) => p.code)).toEqual(['corrupt', 'corrupt']);
    expect([...mem.map.keys()].sort()).toEqual([CART_STORAGE_PREFIX + 'good', 'some.other.app']);
  });

  it('future-versioned saves are NOT deleted: listed as unloadable, load explains why', () => {
    const { store, mem } = setup();
    const key = CART_STORAGE_PREFIX + 'future';
    mem.map.set(key, JSON.stringify({ version: 99, parts: [] }));
    const r = store.load('future');
    expect(r).toMatchObject({ ok: false, error: { code: 'incompatibleVersion' } });
    expect(!r.ok && r.error.message).toMatch(/newer version/);
    expect(mem.map.has(key)).toBe(true);
    const l = store.list();
    expect(l.ok && l.value.carts).toEqual([{ name: 'future', partCount: null, problem: expect.stringMatching(/newer version/) }]);
  });

  it('the stored name wins over a name embedded in the JSON', () => {
    const { store, mem } = setup();
    mem.map.set(CART_STORAGE_PREFIX + 'outer', JSON.stringify({ version: 1, name: 'inner', parts: [] }));
    const r = store.load('outer');
    expect(r.ok && r.value.name).toBe('outer');
  });

  it('damaged entry that cannot be removed: reported once as unavailable (not "discarded"), then not repeated by list', () => {
    const { mem, store } = setup();
    store.save('good', exampleCart());
    mem.map.set(`${CART_STORAGE_PREFIX}broken`, '{nope');
    mem.map.set(`${CART_STORAGE_PREFIX}%E0%A4%A`, '{}'); // undecodable name
    mem.removeFailsWith = Object.assign(new Error('read-only'), { name: 'SecurityError' });

    const first = store.list();
    if (!first.ok) throw new Error('list failed');
    expect(first.value.carts.map((c) => c.name)).toEqual(['good']);
    expect(first.value.problems.map((p) => p.code)).toEqual(['unavailable', 'unavailable']);
    for (const p of first.value.problems) {
      expect(p.message).toMatch(/could not be removed/);
      expect(p.message).not.toMatch(/discarded/);
    }
    expect(mem.map.has(`${CART_STORAGE_PREFIX}broken`)).toBe(true);

    // no toast loop: later lists are quiet
    const again = store.list();
    expect(again.ok && again.value.problems).toEqual([]);
    expect(again.ok && again.value.carts.map((c) => c.name)).toEqual(['good']);

    // an explicit load still fails honestly
    expect(store.load('broken')).toMatchObject({ ok: false, error: { code: 'unavailable', name: 'broken' } });

    // once removal works again, the entry is discarded normally
    mem.removeFailsWith = null;
    expect(store.load('broken')).toMatchObject({ ok: false, error: { code: 'corrupt' } });
    expect(mem.map.has(`${CART_STORAGE_PREFIX}broken`)).toBe(false);
  });
});
