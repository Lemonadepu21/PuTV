import { db, bootstrapWatch, applyWatch, type WatchQueue } from './db';
import { watchRequest } from './client-api';
import {
  recordKey,
  newWatchOperationId,
  watchMutationBody,
  WATCH_DIRTY,
  WATCH_URGENT,
  type WatchResult,
  type WatchPage,
} from './watch-types';

export interface WatchSyncStatus {
  phase: 'idle' | 'syncing' | 'offline' | 'error';
  pending: number;
  conflicts: number;
  lastSynced: number;
  error: string;
}
let status: WatchSyncStatus = {
  phase: 'idle',
  pending: 0,
  conflicts: 0,
  lastSynced: 0,
  error: '',
};
const listeners = new Set<() => void>();
export function getWatchSyncStatus() {
  return status;
}
export function subscribeWatchSync(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publish(patch: Partial<WatchSyncStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((listener) => listener());
}
let current: ReturnType<typeof createWatchSync> | undefined;
export function startWatchSync(context: string) {
  current?.stop();
  const instance = createWatchSync(context, db);
  current = instance;
  void instance.sync();
  return () => {
    instance.stop();
    if (current === instance) current = undefined;
  };
}
export function syncWatchNow() {
  return current?.sync() || Promise.resolve();
}
export async function restoreWatchConflicts() {
  if (!current) return;
  await current.restore();
}
export function createWatchSync(context: string, local: typeof db) {
  let stopped = false,
    running: Promise<void> | null = null,
    timer: ReturnType<typeof setTimeout> | undefined,
    timerDue = 0;
  const abort = new AbortController();
  publish({
    phase: 'idle',
    pending: 0,
    conflicts: 0,
    lastSynced: 0,
    error: '',
  });
  const counts = async () => {
    try {
      const pending = await local.watchQueue.count(),
        conflicts = await local.watchConflicts.count();
      if (!stopped) publish({ pending, conflicts });
    } catch {
      /* 本地存储不可用不阻断播放器。 */
    }
  };
  const request = <T>(path: string, body?: unknown) =>
    watchRequest<T>(path, context, body, abort.signal);
  async function pull() {
    let more = true;
    while (more && !stopped) {
      const cursor = String((await local.watchMeta.get('cursor'))?.value || '');
      const page = await request<WatchPage>(
        '/api/watch' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')
      );
      if (stopped) return;
      if (page.context !== context) throw new Error('观看档案已切换');
      for (const record of page.records) {
        const pending = await local.watchQueue.get(
          recordKey(record.kind, record.key)
        );
        if (pending && pending.opId === record.opId)
          await acknowledge(pending, {
            opId: pending.opId,
            status: 'duplicate',
            record,
          });
      }
      await applyWatch(local, page.records);
      await local.watchMeta.put({ key: 'cursor', value: page.cursor });
      more = page.hasMore;
    }
  }
  async function acknowledge(sent: WatchQueue, result: WatchResult) {
    const accepted =
      result.status === 'applied' ||
      result.status === 'duplicate' ||
      result.status === 'skipped';
    let record = result.record;
    await local.transaction(
      'rw',
      [
        local.watchQueue,
        local.watchVersions,
        local.watchMeta,
        local.watchConflicts,
      ],
      async () => {
        const pending = await local.watchQueue.get(sent.id);
        if (record) {
          const known = await local.watchVersions.get(
            recordKey(record.kind, record.key)
          );
          if (known?.record && known.revision >= record.revision)
            record = known.record;
        }
        if (accepted && record) {
          if (pending?.opId === sent.opId)
            await local.watchQueue.delete(sent.id);
          else if (pending)
            await local.watchQueue.put({
              ...pending,
              baseRevision: Math.max(pending.baseRevision, record.revision),
            });
          if (pending?.opId === sent.opId && record) {
            const key = recordKey(record.kind, record.key),
              known = await local.watchVersions.get(key);
            if (known?.revision === record.revision)
              await local.watchVersions.delete(key);
          }
          if (sent.kind === 'clear')
            for (const later of await local.watchQueue.toArray())
              if (later.modifiedAt >= sent.modifiedAt)
                await local.watchQueue.put({
                  ...later,
                  baseRevision: record.revision,
                });
        } else if (pending?.opId === sent.opId) {
          await local.watchConflicts.put({
            ...sent,
            id: sent.opId,
            error: result.error || '其他设备已有更新',
          });
          await local.watchQueue.delete(sent.id);
          if (sent.kind === 'clear') {
            await local.watchMeta.put({ key: 'cursor', value: '' });
            await local.watchVersions.clear();
          } else if (record) {
            const key = recordKey(record.kind, record.key),
              known = await local.watchVersions.get(key);
            if (known?.revision === record.revision)
              await local.watchVersions.delete(key);
          }
        }
      }
    );
    if (record) await applyWatch(local, [record]);
  }
  async function run() {
    if (stopped) return;
    publish({ phase: 'syncing', error: '' });
    try {
      await bootstrapWatch(local);
      await pull();
      // 固定快照分批发送；播放期间产生的新队列留给下一轮，避免无限同步循环。
      const all = await local.watchQueue.orderBy('modifiedAt').toArray();
      const clear = all.find((item) => item.kind === 'clear');
      const batches: WatchQueue[][] = [];
      if (clear) batches.push([clear]);
      const rest = all.filter((item) => item.kind !== 'clear');
      for (let i = 0; i < rest.length; i += 20)
        batches.push(rest.slice(i, i + 20));
      for (const original of batches) {
        if (stopped) return;
        const operations: WatchQueue[] = [];
        for (const item of original) {
          const latest = await local.watchQueue.get(item.id);
          if (latest?.opId === item.opId) operations.push(latest);
        }
        if (!operations.length) continue;
        const response = await request<{ results: WatchResult[] }>(
          '/api/watch',
          { operations: operations.map(watchMutationBody) }
        );
        if (stopped) return;
        for (const sent of operations) {
          const result = response.results.find(
            (result) => result.opId === sent.opId
          );
          if (!result) throw new Error('同步响应不完整，稍后重试');
          await acknowledge(sent, result);
        }
      }
      await pull();
      if (!stopped)
        publish({ phase: 'idle', lastSynced: Date.now(), error: '' });
    } catch (error) {
      if (!stopped)
        publish({
          phase:
            typeof navigator !== 'undefined' && !navigator.onLine
              ? 'offline'
              : 'error',
          error:
            error instanceof Error ? error.message : '同步失败，已保留本机记录',
        });
    } finally {
      if (!stopped) await counts();
    }
  }
  function sync() {
    if (stopped) return Promise.resolve();
    if (running) return running;
    running = run().finally(() => {
      running = null;
    });
    return running;
  }
  function schedule(urgent = false) {
    void counts();
    const due = Date.now() + (urgent ? 100 : 20000);
    if (timer && timerDue <= due) return;
    if (timer) clearTimeout(timer);
    timerDue = due;
    timer = setTimeout(
      () => {
        timer = undefined;
        void sync();
      },
      urgent ? 100 : 20000
    );
  }
  const dirty = () => schedule(),
    urgent = () => schedule(true),
    visible = () => {
      void sync();
    },
    hide = () => {
      void sync();
    };
  window.addEventListener(WATCH_DIRTY, dirty);
  window.addEventListener(WATCH_URGENT, urgent);
  window.addEventListener('online', urgent);
  window.addEventListener('focus', urgent);
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('pagehide', hide);
  const interval = setInterval(() => {
    void sync();
  }, 20000);
  return {
    sync,
    async restore() {
      await sync();
      await local.transaction(
        'rw',
        [
          local.watchQueue,
          local.watchConflicts,
          local.watchVersions,
          local.watchMeta,
          local.history,
          local.progress,
        ],
        async () => {
          for (const item of (await local.watchConflicts.toArray()).sort(
            (a, b) => a.modifiedAt - b.modifiedAt
          )) {
            const id = recordKey(item.kind, item.key),
              known = await local.watchVersions.get(id),
              clear = Number(
                (await local.watchMeta.get('clearRevision'))?.value || 0
              );
            const cursor = String(
              (await local.watchMeta.get('cursor'))?.value || '0'
            );
            const baseRevision =
              item.kind === 'clear'
                ? Number(cursor.slice(cursor.lastIndexOf(':') + 1))
                : Math.max(known?.revision || 0, clear);
            if (item.kind === 'clear') {
              await local.history.clear();
              await local.progress.clear();
              await local.watchQueue.clear();
            }
            await local.watchQueue.put({
              ...watchMutationBody(item),
              id,
              opId: newWatchOperationId(),
              modifiedAt: Date.now(),
              baseRevision,
            });
            await local.watchConflicts.delete(item.id);
            if (item.kind === 'history' && item.value) {
              if (item.deleted) await local.history.delete(item.key);
              else await local.history.put(item.value as never);
            }
            if (item.kind === 'progress' && item.value) {
              if (item.deleted) await local.progress.delete(item.key);
              else await local.progress.put(item.value as never);
            }
          }
        }
      );
      await sync();
    },
    stop() {
      stopped = true;
      abort.abort();
      if (timer) clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener(WATCH_DIRTY, dirty);
      window.removeEventListener(WATCH_URGENT, urgent);
      window.removeEventListener('online', urgent);
      window.removeEventListener('focus', urgent);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('pagehide', hide);
    },
  };
}
