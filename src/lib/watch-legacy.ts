import Dexie from 'dexie';
import { createLocalDatabase, db } from './db';
import {
  contentKey,
  episodeKey,
  type WatchHistory,
  type WatchProgress,
  type WatchMutation,
  type WatchResult,
} from './watch-types';
import { watchRequest } from './client-api';
import { syncWatchNow } from './watch-sync';

interface LegacyItem {
  id: string;
  operation: WatchMutation;
}
export interface LegacyScan {
  histories: number;
  progress: number;
  items: LegacyItem[];
}
const markerDatabase = () => createLocalDatabase('putv-unassigned');
// 内容指纹用于识别旧库是否变化，不作为账号凭证。
function localFingerprint(value: unknown) {
  const text = JSON.stringify(value);
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ text.charCodeAt(i);
  }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}
export async function scanLegacyWatch(): Promise<LegacyScan> {
  const markers = markerDatabase(),
    items: LegacyItem[] = [];
  let histories = 0,
    progress = 0;
  try {
    const done = new Set(
      (await markers.legacyImports.toArray()).map((item) => item.id)
    );
    for (const name of ['libretv', 'putv-unassigned']) {
      if (!(await Dexie.exists(name))) continue;
      // 动态读取原库结构，不声明版本，避免升级或改写原版表。
      const legacy = new Dexie(name);
      try {
        await legacy.open();
        const list = legacy.tables.some((t) => t.name === 'history')
          ? ((await legacy.table('history').toArray()) as WatchHistory[])
          : [];
        const positions = legacy.tables.some((t) => t.name === 'progress')
          ? ((await legacy.table('progress').toArray()) as WatchProgress[])
          : [];
        for (const h of list) {
          const key = contentKey(h.sourceKey, h.vodId, h.sourceUrl),
            value = { ...h, id: key };
          const id = `${name}:history:${h.id}:${localFingerprint(value)}`;
          if (done.has(id)) continue;
          histories++;
          items.push({
            id,
            operation: {
              opId: `legacy_${localFingerprint(id)}`,
              kind: 'history',
              key,
              value,
              deleted: false,
              baseRevision: 0,
              modifiedAt: h.timestamp,
            },
          });
        }
        for (const p of positions) {
          let sourceKey = p.sourceKey,
            vodId = p.vodId,
            sourceUrl = p.sourceUrl,
            index = p.episodeIndex;
          if (!sourceKey || !vodId || index === undefined) {
            const match = /_(\d+)$/.exec(p.key);
            if (!match) continue;
            const h = list.find(
              (h) =>
                `${h.sourceKey}_${h.vodId}` === p.key.slice(0, -match[0].length)
            );
            if (!h) continue;
            sourceKey = h.sourceKey;
            vodId = h.vodId;
            sourceUrl = h.sourceUrl;
            index = Number(match[1]);
          }
          const key = episodeKey(sourceKey, vodId, index, sourceUrl),
            value = {
              ...p,
              key,
              sourceKey,
              vodId,
              sourceUrl,
              episodeIndex: index,
            };
          const id = `${name}:progress:${p.key}:${localFingerprint(value)}`;
          if (done.has(id)) continue;
          progress++;
          items.push({
            id,
            operation: {
              opId: `legacy_${localFingerprint(id)}`,
              kind: 'progress',
              key,
              value,
              deleted: false,
              baseRevision: 0,
              modifiedAt: p.updatedAt,
            },
          });
        }
      } finally {
        legacy.close();
      }
    }
    return { histories, progress, items };
  } finally {
    markers.close();
  }
}
export async function importLegacyWatch(
  context: string,
  scan: LegacyScan,
  onProgress?: (done: number, total: number) => void
) {
  const markers = markerDatabase(),
    local = db,
    counts = { success: 0, skipped: 0, conflicts: 0, failed: 0 };
  try {
    for (let i = 0; i < scan.items.length; i += 20) {
      const batch = scan.items.slice(i, i + 20),
        response = await watchRequest<{ results: WatchResult[] }>(
          '/api/watch/import',
          context,
          { operations: batch.map((item) => item.operation) }
        );
      if (db !== local) throw new Error('档案已切换，请重新确认导入目标');
      for (const item of batch) {
        const result = response.results.find(
          (result) => result.opId === item.operation.opId
        );
        if (
          result &&
          ['applied', 'duplicate', 'skipped'].includes(result.status)
        ) {
          await markers.legacyImports.put({
            id: item.id,
            context,
            status: result.status,
          });
          if (result.status === 'skipped') counts.skipped++;
          else counts.success++;
        } else if (result?.status === 'conflict') counts.conflicts++;
        else counts.failed++;
      }
      onProgress?.(Math.min(i + 20, scan.items.length), scan.items.length);
    }
    await syncWatchNow();
    return counts;
  } finally {
    markers.close();
    if (typeof window !== 'undefined')
      window.dispatchEvent(new Event('putv:legacy-imported'));
  }
}
