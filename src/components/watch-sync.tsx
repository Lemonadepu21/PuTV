'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import {
  startWatchSync,
  syncWatchNow,
  getWatchSyncStatus,
  subscribeWatchSync,
  restoreWatchConflicts,
} from '@/lib/watch-sync';
import {
  scanLegacyWatch,
  importLegacyWatch,
  type LegacyScan,
} from '@/lib/watch-legacy';
import { useAuth } from './auth';
import { ConfirmDialog } from './confirm-dialog';
function useSyncStatus() {
  return useSyncExternalStore(
    subscribeWatchSync,
    getWatchSyncStatus,
    getWatchSyncStatus
  );
}
export function WatchSyncLifecycle({ context }: { context: string }) {
  useEffect(() => startWatchSync(context), [context]);
  return <LegacyWatchImport floating />;
}
export function HistorySyncTools() {
  const status = useSyncStatus(),
    [restore, setRestore] = useState(false);
  return (
    <div className="mb-4 space-y-2 text-xs text-muted">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span role="status">
          {status.phase === 'syncing'
            ? '正在同步…'
            : status.phase === 'offline'
              ? '离线 · 已保存在本机'
              : status.phase === 'error'
                ? '同步暂未完成 · 已保存在本机'
                : status.pending
                  ? `${status.pending} 项等待同步`
                  : status.lastSynced
                    ? '已同步'
                    : '正在检查同步'}
        </span>
        <button
          className="text-accent underline underline-offset-2"
          onClick={() => {
            void syncWatchNow();
          }}
        >
          立即同步
        </button>
      </div>
      {status.conflicts > 0 && (
        <div className="flex flex-wrap justify-between gap-2">
          <span>{status.conflicts} 项冲突保留了本机副本</span>
          <button
            className="text-accent underline"
            onClick={() => setRestore(true)}
          >
            处理冲突
          </button>
        </div>
      )}
      <LegacyWatchImport />
      <ConfirmDialog
        open={restore}
        title="使用本机更改？"
        message="这会重新提交保留的本机更改，覆盖当前档案对应记录，包括本机的删除操作。取消会继续保留服务端记录与本机副本。"
        confirmLabel="使用本机更改"
        onCancel={() => setRestore(false)}
        onConfirm={() => {
          setRestore(false);
          void restoreWatchConflicts();
        }}
      />
    </div>
  );
}
export function LegacyWatchImport({
  floating = false,
}: {
  floating?: boolean;
}) {
  const auth = useAuth(),
    [scan, setScan] = useState<LegacyScan | null>(null),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [message, setMessage] = useState('');
  const deferred = useLiveQuery(() => db.watchMeta.get('legacyDeferred'), []);
  useEffect(() => {
    let stopped = false;
    const refresh = () => {
      scanLegacyWatch()
        .then((result) => {
          if (!stopped) setScan(result);
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener('putv:legacy-imported', refresh);
    return () => {
      stopped = true;
      window.removeEventListener('putv:legacy-imported', refresh);
    };
  }, []);
  if (
    !auth.account ||
    !auth.profile ||
    !scan ||
    !scan.items.length ||
    (floating && deferred)
  )
    return null;
  const context = `${auth.account.id}:${auth.profile.id}`;
  return (
    <div
      className={
        floating
          ? 'fixed bottom-20 left-4 right-4 z-30 rounded-xl border border-line bg-surface p-4 shadow-lg lg:bottom-6 lg:left-auto lg:max-w-sm'
          : 'rounded-lg border border-line bg-surface p-3'
      }
    >
      <p className="text-sm text-content">
        检测到本机 {scan.histories} 条旧版记录
        {scan.progress ? `、${scan.progress} 条分集进度` : ''}
      </p>
      <p className="mt-1 text-xs text-muted">导入目标：{auth.profile.name}</p>
      {message && (
        <p role="status" className="my-2 text-xs text-muted">
          {message}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          className="btn-primary btn-sm"
          disabled={busy}
          onClick={() => setConfirm(true)}
        >
          {busy ? '正在导入…' : '导入记录'}
        </button>
        {floating && (
          <button
            className="btn-ghost btn-sm"
            disabled={busy}
            onClick={() => {
              void db.watchMeta.put({ key: 'legacyDeferred', value: 1 });
            }}
          >
            暂不导入
          </button>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        title={`导入到「${auth.profile.name}」？`}
        message="旧设备可能由多人共用，请确认这些记录属于此档案。不会删除原始记录，也不会覆盖服务端已有记录。"
        confirmLabel="确认导入"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          setBusy(true);
          setMessage('');
          importLegacyWatch(context, scan, (done, total) =>
            setMessage(`已处理 ${done}/${total}`)
          )
            .then(async (result) => {
              setMessage(
                `成功 ${result.success}，跳过 ${result.skipped}，冲突 ${result.conflicts}，失败 ${result.failed}`
              );
              setScan(await scanLegacyWatch());
            })
            .catch((error) =>
              setMessage(
                `${error instanceof Error ? error.message : '导入失败'}，可重试，原记录已保留`
              )
            )
            .finally(() => setBusy(false));
        }}
      />
    </div>
  );
}
