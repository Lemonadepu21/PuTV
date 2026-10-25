import 'fake-indexeddb/auto';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import Dexie from 'dexie';
import {
  db,
  setLocalIdentity,
  createLocalDatabase,
  upsertHistory,
  saveProgress,
  updateHistoryProgress,
  clearProgress,
  clearAllHistory,
  removeHistory,
  bootstrapWatch,
  applyWatch,
  getSavedProgress,
} from './db';
import {
  contentKey,
  episodeKey,
  recordKey,
  type WatchRecord,
} from './watch-types';
import { scanLegacyWatch, importLegacyWatch } from './watch-legacy';
const transport = vi.hoisted(() => ({
  request: vi.fn(),
  sync: vi.fn(async () => {}),
}));
vi.mock('./client-api', () => ({ watchRequest: transport.request }));
vi.mock('./watch-sync', () => ({ syncWatchNow: transport.sync }));
const base = () => ({
  sourceKey: 'custom_source_1',
  sourceUrl: 'https://cms.example/api',
  vodId: 'video_1',
  title: 'Film',
  episodeIndex: 0,
  totalEpisodes: 3,
  playbackPosition: 0,
  duration: 0,
  timestamp: Date.now(),
});
beforeEach(async () => {
  transport.request.mockReset();
  setLocalIdentity('account-' + crypto.randomUUID(), 'profile');
  await db.open();
});
afterEach(async () => {
  await db.delete();
  for (const name of ['libretv', 'putv-unassigned']) await Dexie.delete(name);
  vi.unstubAllGlobals();
});
it('旧 v3 数据安全升级，身份不按片名合并，孤立旧进度保留', async () => {
  const name = 'old-' + crypto.randomUUID(),
    old = new Dexie(name);
  old.version(1).stores({
    history: 'id,timestamp',
    progress: 'key,updatedAt',
    searchHistory: 'text,timestamp',
  });
  old.version(2).stores({ liveProbe: 'url' });
  old.version(3).stores({
    segmentMeta: 'key,episodeKey,lastAccess',
    downloads: 'id,createdAt',
  });
  await old.open();
  await old.table('history').put({ ...base(), id: 'custom_source_1_video_1' });
  await old.table('progress').put({
    key: 'custom_source_1_video_1_0',
    position: 30,
    duration: 100,
    updatedAt: Date.now(),
  });
  await old.table('progress').put({
    key: 'orphan_2',
    position: 40,
    duration: 100,
    updatedAt: Date.now(),
  });
  old.close();
  const migrated = createLocalDatabase(name);
  await migrated.open();
  expect(await migrated.history.count()).toBe(1);
  expect(
    (
      await migrated.progress.get(
        episodeKey(base().sourceKey, base().vodId, 0, base().sourceUrl)
      )
    )?.position
  ).toBe(30);
  expect(await migrated.progress.get('orphan_2')).toBeDefined();
  expect(migrated.verno).toBe(4);
  await migrated.delete();
});
it('历史、分集进度和零秒回退在本机持久化并合并待同步队列', async () => {
  await upsertHistory(base());
  await saveProgress(
    base().sourceKey,
    base().vodId,
    0,
    40,
    100,
    base().sourceUrl
  );
  await saveProgress(
    base().sourceKey,
    base().vodId,
    0,
    0,
    100,
    base().sourceUrl
  );
  await saveProgress(
    base().sourceKey,
    base().vodId,
    1,
    70,
    100,
    base().sourceUrl
  );
  expect(
    (
      await getSavedProgress(
        base().sourceKey,
        base().vodId,
        0,
        base().sourceUrl
      )
    )?.position
  ).toBe(0);
  expect(await db.watchQueue.count()).toBe(3);
  const name = db.name;
  db.close();
  await db.open();
  expect(db.name).toBe(name);
  expect(await db.watchQueue.count()).toBe(3);
});
it('不同 URL 的同源短 ID 不碰撞，不同档案缓存和队列隔离', async () => {
  const first = db;
  await upsertHistory(base());
  await upsertHistory({ ...base(), sourceUrl: 'https://other.example/api' });
  expect(await first.history.count()).toBe(2);
  setLocalIdentity('other-account', 'other-profile');
  await db.open();
  expect(await db.history.count()).toBe(0);
  expect(await db.watchQueue.count()).toBe(0);
  await first.delete();
});
it('单条删除保留原有分集进度，清空同时清理进度并持久化删除意图', async () => {
  await upsertHistory(base());
  await saveProgress(
    base().sourceKey,
    base().vodId,
    0,
    30,
    100,
    base().sourceUrl
  );
  await removeHistory(base().sourceKey, base().vodId, base().sourceUrl);
  expect(await db.history.count()).toBe(0);
  expect(await db.progress.count()).toBe(1);
  expect(
    (
      await db.watchQueue.get(
        recordKey(
          'history',
          contentKey(base().sourceKey, base().vodId, base().sourceUrl)
        )
      )
    )?.deleted
  ).toBe(true);
  await clearAllHistory();
  expect(await db.progress.count()).toBe(0);
  expect((await db.watchQueue.toArray()).map((row) => row.kind)).toEqual([
    'clear',
  ]);
});
it('切集后的旧回调不能覆盖新集历史；播完保存完成状态', async () => {
  await upsertHistory(base());
  await upsertHistory({ ...base(), episodeIndex: 2 });
  await updateHistoryProgress(
    base().sourceKey,
    base().vodId,
    80,
    100,
    base().sourceUrl,
    0
  );
  expect((await db.history.toArray())[0].episodeIndex).toBe(2);
  expect((await db.history.toArray())[0].playbackPosition).toBe(0);
  await saveProgress(
    base().sourceKey,
    base().vodId,
    2,
    95,
    100,
    base().sourceUrl
  );
  await clearProgress(base().sourceKey, base().vodId, 2, base().sourceUrl);
  expect(
    (
      await getSavedProgress(
        base().sourceKey,
        base().vodId,
        2,
        base().sourceUrl
      )
    )?.completed
  ).toBe(true);
  expect((await db.history.toArray())[0].completed).toBe(true);
});
it('远程清空优先，未确认的本机更改保留为可恢复冲突', async () => {
  await upsertHistory(base());
  const r: WatchRecord = {
    kind: 'clear',
    key: '',
    value: null,
    deleted: true,
    revision: 10,
    modifiedAt: Date.now(),
    updatedAt: Date.now(),
  };
  await applyWatch(db, [r]);
  expect(await db.history.count()).toBe(0);
  expect(await db.watchQueue.count()).toBe(0);
  expect(await db.watchConflicts.count()).toBe(1);
  await upsertHistory(base());
  expect((await db.watchQueue.toArray())[0].baseRevision).toBe(10);
  expect((await db.watchConflicts.toArray())[0].value).toHaveProperty(
    'title',
    'Film'
  );
});
it('较旧服务端版本不回滚缓存，有待提交更改时保留本地并缓存最新服务端版本', async () => {
  await upsertHistory(base());
  const h = (await db.history.toArray())[0],
    r: WatchRecord = {
      kind: 'history',
      key: h.id,
      value: { ...h, playbackPosition: 60, duration: 100 },
      deleted: false,
      revision: 5,
      modifiedAt: Date.now(),
      updatedAt: Date.now(),
    };
  await applyWatch(db, [r]);
  expect((await db.history.get(h.id))?.playbackPosition).toBe(0);
  expect(
    (await db.watchVersions.get(recordKey('history', h.id)))?.record?.value
  ).toHaveProperty('playbackPosition', 60);
  await db.watchQueue.clear();
  await applyWatch(db, [{ ...r, revision: 6 }]);
  await applyWatch(db, [r]);
  expect((await db.history.get(h.id))?.playbackPosition).toBe(60);
});
it('已有归属数据只初始化一次，不会自动上传未分配旧库', async () => {
  await upsertHistory(base());
  await db.watchQueue.clear();
  await bootstrapWatch(db);
  expect(await db.watchQueue.count()).toBe(1);
  await db.watchQueue.clear();
  await bootstrapWatch(db);
  expect(await db.watchQueue.count()).toBe(0);
  expect(transport.request).not.toHaveBeenCalled();
});
async function legacy() {
  const old = new Dexie('libretv');
  old.version(1).stores({ history: 'id,timestamp', progress: 'key,updatedAt' });
  await old.open();
  await old.table('history').put({ ...base(), id: 'custom_source_1_video_1' });
  await old.table('progress').put({
    key: 'custom_source_1_video_1_0',
    position: 40,
    duration: 100,
    updatedAt: Date.now(),
  });
  old.close();
}
it('检测旧记录不上传、不改原库；确认导入后标记，重复扫描不再提示', async () => {
  await legacy();
  const scan = await scanLegacyWatch();
  expect(scan.histories).toBe(1);
  expect(scan.progress).toBe(1);
  expect(transport.request).not.toHaveBeenCalled();
  transport.request.mockImplementation(async (_url, _context, body) => ({
    results: body.operations.map((m: { opId: string }) => ({
      opId: m.opId,
      status: 'applied',
    })),
  }));
  expect(await importLegacyWatch('account:profile', scan)).toEqual({
    success: 2,
    skipped: 0,
    conflicts: 0,
    failed: 0,
  });
  expect((await scanLegacyWatch()).items).toHaveLength(0);
  const old = new Dexie('libretv');
  await old.open();
  expect(old.verno).toBe(1);
  expect(
    await old.table('history').get('custom_source_1_video_1')
  ).toBeDefined();
  old.close();
});
it('导入失败和部分失败保留原始记录与重试入口', async () => {
  await legacy();
  const scan = await scanLegacyWatch();
  transport.request.mockRejectedValueOnce(new Error('offline'));
  await expect(importLegacyWatch('a:p', scan)).rejects.toThrow('offline');
  expect((await scanLegacyWatch()).items).toHaveLength(2);
  transport.request.mockImplementation(async (_url, _context, body) => ({
    results: body.operations.map((m: { opId: string }, i: number) => ({
      opId: m.opId,
      status: i ? 'invalid' : 'applied',
    })),
  }));
  expect((await importLegacyWatch('a:p', scan)).failed).toBe(1);
  expect((await scanLegacyWatch()).items).toHaveLength(1);
});
