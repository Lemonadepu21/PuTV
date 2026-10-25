import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createThrottledStorage,
  flushPendingPersist,
  setLocalStorageScope,
} from './persist-storage';

let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  setLocalStorageScope('unassigned');
});
afterEach(() => {
  flushPendingPersist();
  vi.unstubAllGlobals();
});
describe('身份本地配置隔离', () => {
  it('切换档案先完成旧档案待写内容，新档案不会读到它或旧版数据', () => {
    values.set('libretv-settings', 'legacy settings');
    const storage = createThrottledStorage();
    setLocalStorageScope('account-a:profile-a');
    storage.setItem('libretv-settings', 'a settings');
    setLocalStorageScope('account-b:profile-b');
    expect(storage.getItem('libretv-settings')).toBeNull();
    storage.setItem('libretv-settings', 'b settings');
    flushPendingPersist();
    setLocalStorageScope('account-a:profile-a');
    expect(storage.getItem('libretv-settings')).toBe('a settings');
    expect(values.get('libretv-settings')).toBe('legacy settings');
    setLocalStorageScope('account-b:profile-b');
    expect(storage.getItem('libretv-settings')).toBe('b settings');
  });
  it('IndexedDB 使用独立档案名称，保留原 schema 且不打开或删除旧库', async () => {
    const { db: initial, setLocalIdentity } = await import('./db');
    const Dexie = (await import('dexie')).default;
    const open = vi.spyOn(Dexie.prototype, 'open'),
      remove = vi.spyOn(Dexie.prototype, 'delete');
    setLocalIdentity('account-a', 'profile-a');
    const first = (await import('./db')).db;
    expect(first.name).toBe('putv-account-a-profile-a');
    expect(first.verno).toBe(4);
    setLocalIdentity('account-b', 'profile-b');
    expect((await import('./db')).db.name).toBe('putv-account-b-profile-b');
    expect(initial.name).not.toBe('libretv');
    expect(open).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    open.mockRestore();
    remove.mockRestore();
  });
});
