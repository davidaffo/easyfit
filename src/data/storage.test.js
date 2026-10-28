// @vitest-environment jsdom
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openAppStorage } from './storage.js';

const keys = ['easyfit-history', 'easyfit-profile', 'easyfit-workout'];
let handles;
async function open() {
  const storage = await openAppStorage();
  handles.push(storage);
  return storage;
}
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  handles = [];
  const values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  });
});
afterEach(() => {
  handles.forEach((storage) => storage.close());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('migrates existing records and archives even when localStorage rejects every write', async () => {
  const history = [{ id: 'previous' }];
  const workout = { id: 'active' };
  localStorage.setItem(keys[0], JSON.stringify(history));
  localStorage.setItem(keys[1], JSON.stringify({ goal: 'muscle' }));
  localStorage.setItem(keys[2], JSON.stringify(workout));
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new DOMException('Quota exceeded', 'QuotaExceededError');
  });
  const storage = await open();
  expect(storage.load(keys[0])).toEqual(history);
  expect(storage.load(keys[2])).toEqual(workout);
  expect(localStorage.getItem(keys[0])).toBeNull();
  // Larger than localStorage's usual capacity; history is never truncated.
  const completed = { ...workout, notes: 'x'.repeat(6 * 1024 * 1024) };
  expect(await storage.persistAppStateAtomically([
    [keys[0], [...history, completed]], [keys[1], { goal: 'strength' }], [keys[2], null],
  ])).toBe(true);
  const reloaded = await open();
  expect(reloaded.load(keys[0])).toEqual([...history, completed]);
  expect(reloaded.load(keys[1])).toEqual({ goal: 'strength' });
  expect(reloaded.load(keys[2], null)).toBeNull();
});

test('a failed migration preserves every original record and can be retried', async () => {
  keys.forEach((key) => localStorage.setItem(key, JSON.stringify({ key })));
  const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
    throw new DOMException('Unavailable', 'UnknownError');
  });
  await expect(open()).rejects.toThrow();
  keys.forEach((key) => expect(JSON.parse(localStorage.getItem(key))).toEqual({ key }));
  put.mockRestore();
  const storage = await open();
  keys.forEach((key) => expect(storage.load(key)).toEqual({ key }));
});

test('an aborted archive rolls back history and profile and preserves the active workout', async () => {
  const storage = await open();
  const initial = [[keys[0], []], [keys[1], { goal: 'muscle' }], [keys[2], { id: 'active' }]];
  expect(await storage.persistAppStateAtomically(initial)).toBe(true);
  const original = IDBObjectStore.prototype.put;
  const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
    if (key === keys[1]) throw new DOMException('Unavailable', 'UnknownError');
    return original.call(this, value, key);
  });
  expect(await storage.persistAppStateAtomically([
    [keys[0], [{ id: 'completed' }]], [keys[1], { goal: 'strength' }], [keys[2], null],
  ])).toBe(false);
  put.mockRestore();
  const reloaded = await open();
  initial.forEach(([key, value]) => expect(reloaded.load(key)).toEqual(value));
});

test('existing IndexedDB records take precedence over stale legacy data', async () => {
  const storage = await open();
  await storage.persist(keys[0], [{ id: 'new' }]);
  localStorage.setItem(keys[0], JSON.stringify([{ id: 'old' }]));
  expect((await open()).load(keys[0])).toEqual([{ id: 'new' }]);
});

test('writes commit in order and resetting removes every record', async () => {
  const storage = await open();
  await Promise.all([storage.persist(keys[0], [1]), storage.persist(keys[0], [1, 2])]);
  expect((await open()).load(keys[0])).toEqual([1, 2]);
  expect(await storage.persistAppStateAtomically(keys.map((key) => [key, null]))).toBe(true);
  const reloaded = await open();
  keys.forEach((key) => expect(reloaded.load(key, null)).toBeNull());
});
