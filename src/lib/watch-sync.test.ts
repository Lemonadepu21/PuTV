import 'fake-indexeddb/auto';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { database, closeDatabase } from '@/server/database';
import { pullWatch, pushWatch } from '@/server/watch';
import { createLocalDatabase, queueWatch, type db } from './db';
import { createWatchSync } from './watch-sync';
import {
  episodeKey,
  newWatchOperationId,
  type WatchMutation,
  type WatchProgress,
} from './watch-types';
const network = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./client-api', () => ({ watchRequest: network.request }));
let dir: string,
  profile: string,
  offline = false,
  loseResponse = false,
  paused: Promise<void> | null = null;
let stores: (typeof db)[] = [],
  instances: ReturnType<typeof createWatchSync>[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-25T00:00:00Z'));
  const win = new EventTarget(),
    doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { onLine: true });
  closeDatabase();
  dir = mkdtempSync(join(tmpdir(), 'putv-engine-'));
  process.env.SQLITE_PATH = join(dir, 'sync.sqlite');
  const account = randomUUID();
  profile = randomUUID();
  const now = Date.now();
  database()
    .prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?)')
    .run(account, account, 'unused', 'user', 'active', now, now);
  database()
    .prepare('INSERT INTO profiles VALUES(?,?,?,?,?,?,?)')
    .run(profile, account, 'viewer', 'preset:blue', 1, now, now);
  offline = false;
  loseResponse = false;
  paused = null;
  network.request.mockReset();
  network.request.mockImplementation(
    async (
      path: string,
      _context: string,
      body?: { operations: WatchMutation[] },
      signal?: AbortSignal
    ) => {
      if (offline) throw new Error('offline');
      if (signal?.aborted) throw new Error('aborted');
      if (body) {
        if (paused) await paused;
        const result = { results: pushWatch(profile, body.operations) };
        if (loseResponse) {
          loseResponse = false;
          throw new Error('response lost');
        }
        return result;
      }
      return {
        context: 'account:profile',
        ...pullWatch(
          profile,
          new URL(path, 'https://test').searchParams.get('cursor')
        ),
      };
    }
  );
});
afterEach(async () => {
  instances.forEach((instance) => instance.stop());
  for (const local of stores) await local.delete();
  stores = [];
  instances = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SQLITE_PATH;
});
async function device() {
  const local = createLocalDatabase('device-' + randomUUID());
  await local.open();
  stores.push(local);
  const sync = createWatchSync('account:profile', local);
  instances.push(sync);
  return { local, sync };
}
async function write(local: typeof db, position: number, index = 0) {
  const key = episodeKey('source', 'film', index, 'https://cms.example/api'),
    value: WatchProgress = {
      key,
      sourceKey: 'source',
      sourceUrl: 'https://cms.example/api',
      vodId: 'film',
      episodeIndex: index,
      position,
      duration: 100,
      updatedAt: Date.now(),
    };
  await local.transaction(
    'rw',
    [local.progress, local.watchQueue, local.watchVersions, local.watchMeta],
    async () => {
      await local.progress.put(value);
      await queueWatch(local, 'progress', key, value);
    }
  );
}
async function clear(local: typeof db) {
  const cursor = String((await local.watchMeta.get('cursor'))?.value || '0');
  await local.progress.clear();
  await local.history.clear();
  await local.watchQueue.clear();
  await local.watchQueue.put({
    id: 'clear:',
    opId: newWatchOperationId(),
    kind: 'clear',
    key: '',
    value: null,
    deleted: true,
    modifiedAt: Date.now(),
    baseRevision: Number(cursor.slice(cursor.lastIndexOf(':') + 1)),
  });
}
const position = async (local: typeof db) =>
  (await local.progress.toArray())[0]?.position;
it('两台设备双向同步、分集独立、相同请求不产生重复', async () => {
  const a = await device(),
    b = await device();
  await write(a.local, 20);
  await a.sync.sync();
  await b.sync.sync();
  expect(await position(b.local)).toBe(20);
  vi.setSystemTime(Date.now() + 1000);
  await write(b.local, 60);
  await write(b.local, 80, 1);
  await b.sync.sync();
  await a.sync.sync();
  expect(
    (await a.local.progress.toArray()).map((p) => p.position).sort()
  ).toEqual([60, 80]);
  expect(pullWatch(profile, null).records).toHaveLength(2);
});
it('断网不丢本地进度，网络恢复成功后才清队列', async () => {
  const a = await device();
  await write(a.local, 30);
  offline = true;
  await a.sync.sync();
  expect(await a.local.watchQueue.count()).toBe(1);
  expect(await position(a.local)).toBe(30);
  offline = false;
  await a.sync.sync();
  expect(await a.local.watchQueue.count()).toBe(0);
  expect(
    (pullWatch(profile, null).records[0].value as WatchProgress).position
  ).toBe(30);
});
it('提交期间新的拖动不会被旧响应覆盖，下一批保留主动回退', async () => {
  const a = await device();
  await write(a.local, 20);
  await a.sync.sync();
  await write(a.local, 80);
  let release!: () => void;
  paused = new Promise((resolve) => {
    release = resolve;
  });
  const job = a.sync.sync();
  while (
    !network.request.mock.calls.some((args) =>
      args[2]?.operations?.some(
        (m: WatchMutation) => (m.value as WatchProgress)?.position === 80
      )
    )
  )
    await new Promise<void>((resolve) => setImmediate(resolve));
  await write(a.local, 5);
  release();
  await job;
  paused = null;
  expect(await position(a.local)).toBe(5);
  expect(await a.local.watchQueue.count()).toBe(1);
  await a.sync.sync();
  expect(
    (pullWatch(profile, null).records[0].value as WatchProgress).position
  ).toBe(5);
});
it('响应丢失后重试幂等；另一设备的新记录仍优先于旧确认响应', async () => {
  const a = await device(),
    b = await device();
  await write(a.local, 20);
  await a.sync.sync();
  await write(a.local, 50);
  loseResponse = true;
  await a.sync.sync();
  expect(await a.local.watchQueue.count()).toBe(1);
  await b.sync.sync();
  vi.setSystemTime(Date.now() + 1000);
  await write(b.local, 80);
  await b.sync.sync();
  await a.sync.sync();
  expect(await position(a.local)).toBe(80);
  expect(await a.local.watchQueue.count()).toBe(0);
});
it('其他设备清空后，离线旧队列不能复活记录，冲突副本可主动恢复', async () => {
  const a = await device(),
    b = await device();
  await write(a.local, 20);
  await a.sync.sync();
  await b.sync.sync();
  await write(a.local, 50);
  vi.setSystemTime(Date.now() + 1000);
  await clear(b.local);
  await b.sync.sync();
  await a.sync.sync();
  expect(await a.local.progress.count()).toBe(0);
  expect(await a.local.watchConflicts.count()).toBe(1);
  expect(pullWatch(profile, null).records.filter((r) => !r.deleted)).toEqual(
    []
  );
  await a.sync.restore();
  expect(await position(a.local)).toBe(50);
  expect(await a.local.watchConflicts.count()).toBe(0);
});
it('清空响应丢失后仍可确认，并保留清空之后产生的新记录', async () => {
  const a = await device();
  await write(a.local, 20);
  await a.sync.sync();
  await clear(a.local);
  loseResponse = true;
  await a.sync.sync();
  vi.setSystemTime(Date.now() + 1000);
  await write(a.local, 40);
  await a.sync.sync();
  expect(await position(a.local)).toBe(40);
  expect(await a.local.watchConflicts.count()).toBe(0);
  expect(await a.local.watchQueue.count()).toBe(0);
});
it('停止旧档案任务后不再确认或清除旧队列，新档案不接收旧记录', async () => {
  const a = await device();
  await write(a.local, 25);
  let release!: () => void;
  paused = new Promise((resolve) => {
    release = resolve;
  });
  const job = a.sync.sync();
  while (!network.request.mock.calls.some((args) => args[2]))
    await new Promise<void>((resolve) => setImmediate(resolve));
  a.sync.stop();
  release();
  await job;
  expect(await a.local.watchQueue.count()).toBe(1);
  const other = createLocalDatabase('other-profile-' + randomUUID());
  await other.open();
  stores.push(other);
  expect(await other.watchQueue.count()).toBe(0);
  expect(await other.progress.count()).toBe(0);
});

it('已观察到清空之后的正常观看可以重新保存，无需强制恢复', async () => {
  const a = await device(),
    b = await device();
  await write(a.local, 20);
  await a.sync.sync();
  await b.sync.sync();
  await clear(b.local);
  await b.sync.sync();
  await a.sync.sync();
  await write(a.local, 40);
  await a.sync.sync();
  expect(await position(a.local)).toBe(40);
  expect(await a.local.watchConflicts.count()).toBe(0);
  expect(
    pullWatch(profile, null).records.find((r) => r.kind === 'progress')?.deleted
  ).toBe(false);
});
