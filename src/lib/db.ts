import Dexie, { type EntityTable } from 'dexie';
import type { SourceConfig } from './types';
// 仅类型引入：store.ts 运行时会引用本模块，反向只取类型不会形成运行时循环
import type { LiveProbeEntry } from './store';
import {
  PERSIST_KEY,
  flushPendingPersist,
  localSettingsKey,
} from './persist-storage';

/**
 * IndexedDB 持久化（替代旧版 localStorage 数据库）：
 * - 观看历史不再冗余存储全集 URL 列表（旧版长剧 × 50 条极易撑爆 5MB 配额），
 *   只存定位信息（sourceKey+vodId+index），进入播放页时按需重新拉详情，
 *   顺带免费获得「剧集更新同步」能力。
 * - v2：直播测活缓存从 localStorage（随 zustand persist 整体重写）迁入独立表，
 *   高频写入不再拖累设置快照的序列化。
 */

export type {
  WatchHistory as HistoryEntry,
  WatchProgress as ProgressEntry,
} from './watch-types';
import {
  contentKey,
  episodeKey,
  recordKey,
  newWatchOperationId,
  WATCH_DIRTY,
  WATCH_URGENT,
  type WatchHistory as HistoryEntry,
  type WatchProgress as ProgressEntry,
  type WatchMutation,
  type WatchRecord,
  type WatchKind,
  type WatchValue,
} from './watch-types';
export interface WatchVersion {
  id: string;
  revision: number;
  record?: WatchRecord;
}
export interface WatchQueue extends WatchMutation {
  id: string;
}
export interface WatchConflict extends WatchQueue {
  error: string;
}
export interface WatchMeta {
  key: string;
  value: string | number;
}
export interface LegacyImportMarker {
  id: string;
  context: string;
  status: string;
}

export interface SearchHistoryEntry {
  text: string;
  timestamp: number;
}

export interface SegmentMetaEntry {
  /** Cache Storage 中的 key（归一化的分片绝对地址，或同源代理地址） */
  key: string;
  /** 所属剧集：`${source}:${vodId}:${episodeIndex}`，用于按集淘汰 */
  episodeKey: string;
  /** 片段序号（1 基，便于排查） */
  index: number;
  bytes: number;
  /** 预取时记录的真实耗时（毫秒），loader 命中缓存时合成进 hls.js stats 防 ABR 误判 */
  costMs: number;
  lastAccess: number;
}

export type DownloadStatus =
  | 'waiting'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'error';

export interface DownloadTaskEntry {
  id: string;
  /** 播放页 m3u8 地址（直连或代理形式，入队时的原样） */
  url: string;
  title: string;
  /** 输出格式 */
  format: 'TS' | 'MP4';
  status: DownloadStatus;
  finished: number;
  total: number;
  errorNum: number;
  createdAt: number;
  updatedAt: number;
}

export function createLocalDatabase(name: string) {
  const db = new Dexie(name) as Dexie & {
    history: EntityTable<HistoryEntry, 'id'>;
    progress: EntityTable<ProgressEntry, 'key'>;
    searchHistory: EntityTable<SearchHistoryEntry, 'text'>;
    liveProbe: EntityTable<LiveProbeEntry & { url: string }, 'url'>;
    segmentMeta: EntityTable<SegmentMetaEntry, 'key'>;
    downloads: EntityTable<DownloadTaskEntry, 'id'>;
    watchVersions: EntityTable<WatchVersion, 'id'>;
    watchQueue: EntityTable<WatchQueue, 'id'>;
    watchConflicts: EntityTable<WatchConflict, 'id'>;
    watchMeta: EntityTable<WatchMeta, 'key'>;
    legacyImports: EntityTable<LegacyImportMarker, 'id'>;
  };

  db.version(1).stores({
    history: 'id, timestamp',
    progress: 'key, updatedAt',
    searchHistory: 'text, timestamp',
  });

  // v2 仅新增表；Dexie 会自动继承低版本的表结构
  db.version(2).stores({
    liveProbe: 'url',
  });

  // v3：视频片段缓存元数据（Cache Storage 存字节、这里存 LRU 索引）与离线下载任务
  db.version(3).stores({
    segmentMeta: 'key, episodeKey, lastAccess',
    downloads: 'id, createdAt',
  });

  db.version(4)
    .stores({
      watchVersions: 'id',
      watchQueue: 'id, modifiedAt',
      watchConflicts: 'id',
      watchMeta: 'key',
      legacyImports: 'id',
    })
    .upgrade(async (tx) => {
      const histories = (await tx.table('history').toArray()) as HistoryEntry[];
      for (const entry of histories) {
        const id = contentKey(entry.sourceKey, entry.vodId, entry.sourceUrl);
        if (entry.id !== id) {
          await tx.table('history').put({ ...entry, id });
          await tx.table('history').delete(entry.id);
        }
      }
      for (const p of (await tx
        .table('progress')
        .toArray()) as ProgressEntry[]) {
        const match = /_(\d+)$/.exec(p.key);
        if (!match) continue;
        const history = histories.find(
          (h) =>
            `${h.sourceKey}_${h.vodId}` === p.key.slice(0, -match[0].length)
        );
        if (!history) continue;
        const episodeIndex = Number(match[1]),
          key = episodeKey(
            history.sourceKey,
            history.vodId,
            episodeIndex,
            history.sourceUrl
          );
        await tx.table('progress').put({
          ...p,
          key,
          sourceKey: history.sourceKey,
          sourceUrl: history.sourceUrl,
          vodId: history.vodId,
          episodeIndex,
        });
        await tx.table('progress').delete(p.key);
      }
    });

  return db;
}
// 旧 libretv 数据库保持原样，未登录与已认证档案使用独立数据库。
export let db = createLocalDatabase('putv-unassigned');
export function setLocalIdentity(accountId: string, profileId: string) {
  const name = `putv-${accountId}-${profileId}`;
  if (db.name === name) return;
  db.close();
  db = createLocalDatabase(name);
}

export const MAX_HISTORY = 100;
export const MAX_SEARCH_HISTORY = 10;

export function notifyWatch(urgent = false) {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event(urgent ? WATCH_URGENT : WATCH_DIRTY));
}
export async function queueWatch(
  local: typeof db,
  kind: WatchKind,
  key: string,
  value: WatchValue | null,
  deleted = false,
  modifiedAt = Date.now()
) {
  const id = recordKey(kind, key),
    known = await local.watchVersions.get(id),
    clear = await local.watchMeta.get('clearRevision');
  const previous = await local.watchQueue.get(id);
  await local.watchQueue.put({
    id,
    opId: newWatchOperationId(),
    kind,
    key,
    value,
    deleted,
    modifiedAt,
    baseRevision: Math.max(
      previous?.baseRevision ?? known?.revision ?? 0,
      Number(clear?.value || 0)
    ),
  });
}
const writableTables = (local: typeof db) => [
  local.history,
  local.progress,
  local.watchQueue,
  local.watchVersions,
  local.watchMeta,
];
export async function upsertHistory(
  entry: Omit<HistoryEntry, 'id'>
): Promise<void> {
  const local = db,
    id = contentKey(entry.sourceKey, entry.vodId, entry.sourceUrl);
  await local.transaction('rw', writableTables(local), async () => {
    const existing = await local.history.get(id);
    const merged: HistoryEntry = {
      ...existing,
      ...entry,
      id,
      completed: entry.completed ?? false,
      playbackPosition:
        entry.playbackPosition > 10
          ? entry.playbackPosition
          : existing?.episodeIndex === entry.episodeIndex
            ? existing?.playbackPosition || 0
            : 0,
      duration:
        entry.duration ||
        (existing?.episodeIndex === entry.episodeIndex
          ? existing.duration
          : 0) ||
        0,
      timestamp: Date.now(),
    };
    await local.history.put(merged);
    await queueWatch(local, 'history', id, merged);
    const count = await local.history.count();
    if (count > MAX_HISTORY) {
      const old = await local.history
        .orderBy('timestamp')
        .limit(count - MAX_HISTORY)
        .primaryKeys();
      await local.history.bulkDelete(old);
    }
  });
  notifyWatch();
}
export async function updateHistoryProgress(
  sourceKey: string,
  vodId: string,
  position: number,
  duration: number,
  sourceUrl?: string,
  episodeIndex?: number
): Promise<void> {
  if (
    !Number.isFinite(position) ||
    !Number.isFinite(duration) ||
    position < 0 ||
    duration <= 0
  )
    return;
  const local = db,
    id = contentKey(sourceKey, vodId, sourceUrl);
  await local.transaction('rw', writableTables(local), async () => {
    const existing = await local.history.get(id);
    if (
      !existing ||
      (episodeIndex !== undefined && existing.episodeIndex !== episodeIndex)
    )
      return;
    if (
      Math.abs(existing.playbackPosition - position) < 2 &&
      Math.abs(existing.duration - duration) < 2
    )
      return;
    const updated = {
      ...existing,
      playbackPosition: Math.min(position, duration),
      duration,
      timestamp: Date.now(),
      completed: false,
    };
    await local.history.put(updated);
    await queueWatch(local, 'history', id, updated);
  });
  notifyWatch();
}
export async function removeHistory(
  sourceKey: string,
  vodId: string,
  sourceUrl?: string
): Promise<void> {
  const local = db,
    id = contentKey(sourceKey, vodId, sourceUrl);
  await local.transaction('rw', writableTables(local), async () => {
    const old = await local.history.get(id);
    if (!old) return;
    await local.history.delete(id);
    await queueWatch(local, 'history', id, old, true);
  });
  notifyWatch(true);
}
export async function clearAllHistory(): Promise<void> {
  const local = db;
  await local.transaction('rw', writableTables(local), async () => {
    await local.history.clear();
    await local.progress.clear();
    await local.watchQueue.clear();
    const cursor = String((await local.watchMeta.get('cursor'))?.value || '0'),
      revision = Number(cursor.slice(cursor.lastIndexOf(':') + 1)) || 0;
    await local.watchQueue.put({
      id: recordKey('clear', ''),
      opId: newWatchOperationId(),
      kind: 'clear',
      key: '',
      value: null,
      deleted: true,
      modifiedAt: Date.now(),
      baseRevision: revision,
    });
  });
  notifyWatch(true);
}
export function progressKeyOf(
  sourceKey: string,
  vodId: string,
  index: number,
  sourceUrl?: string
): string {
  return episodeKey(sourceKey, vodId, index, sourceUrl);
}
export async function getSavedProgress(
  sourceKey: string,
  vodId: string,
  index: number,
  sourceUrl?: string
) {
  return (
    (await db.progress.get(episodeKey(sourceKey, vodId, index, sourceUrl))) ||
    (await db.progress.get(`${sourceKey}_${vodId}_${index}`))
  );
}
export async function saveProgress(
  sourceKey: string,
  vodId: string,
  episodeIndex: number,
  position: number,
  duration: number,
  sourceUrl?: string
): Promise<void> {
  if (
    !Number.isFinite(position) ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    position < 0
  )
    return;
  const local = db,
    key = episodeKey(sourceKey, vodId, episodeIndex, sourceUrl);
  await local.transaction('rw', writableTables(local), async () => {
    const old = await local.progress.get(key);
    if (
      old &&
      !old.completed &&
      Math.abs(old.position - position) < 2 &&
      Math.abs(old.duration - duration) < 2
    )
      return;
    const value: ProgressEntry = {
      key,
      sourceKey,
      sourceUrl,
      vodId,
      episodeIndex,
      position: Math.min(position, duration),
      duration,
      updatedAt: Date.now(),
      completed: false,
    };
    await local.progress.put(value);
    await queueWatch(local, 'progress', key, value);
  });
  notifyWatch();
}
export async function clearProgress(
  sourceKey: string,
  vodId: string,
  episodeIndex: number,
  sourceUrl?: string
): Promise<void> {
  const local = db,
    key = episodeKey(sourceKey, vodId, episodeIndex, sourceUrl);
  await local.transaction('rw', writableTables(local), async () => {
    const old = await local.progress.get(key),
      history = await local.history.get(
        contentKey(sourceKey, vodId, sourceUrl)
      );
    const duration = old?.duration || history?.duration || 0;
    const value: ProgressEntry = {
      key,
      sourceKey,
      sourceUrl,
      vodId,
      episodeIndex,
      position: duration,
      duration,
      updatedAt: Date.now(),
      completed: true,
    };
    await local.progress.put(value);
    await queueWatch(local, 'progress', key, value);
    if (history?.episodeIndex === episodeIndex) {
      const changed = {
        ...history,
        playbackPosition: duration,
        duration,
        timestamp: Date.now(),
        completed: episodeIndex + 1 >= history.totalEpisodes,
      };
      await local.history.put(changed);
      await queueWatch(local, 'history', history.id, changed);
    }
  });
  notifyWatch(true);
}
export async function bootstrapWatch(local: typeof db) {
  if (await local.watchMeta.get('bootstrapped')) return;
  await local.transaction('rw', writableTables(local), async () => {
    for (const h of await local.history.toArray())
      if (!(await local.watchQueue.get(recordKey('history', h.id))))
        await queueWatch(local, 'history', h.id, h, false, h.timestamp);
    for (const p of await local.progress.toArray())
      if (
        p.sourceKey &&
        p.vodId &&
        p.episodeIndex !== undefined &&
        !(await local.watchQueue.get(recordKey('progress', p.key)))
      )
        await queueWatch(local, 'progress', p.key, p, false, p.updatedAt);
    await local.watchMeta.put({ key: 'bootstrapped', value: 1 });
  });
}
export async function applyWatch(local: typeof db, records: WatchRecord[]) {
  await local.transaction(
    'rw',
    [...writableTables(local), local.watchConflicts],
    async () => {
      for (const r of records) {
        const id = recordKey(r.kind, r.key),
          known = await local.watchVersions.get(id);
        if (known && known.revision >= r.revision) continue;
        if (r.kind === 'clear') {
          const clear = Number(
            (await local.watchMeta.get('clearRevision'))?.value || 0
          );
          if (clear >= r.revision) continue;
          await local.watchMeta.put({
            key: 'clearRevision',
            value: r.revision,
          });
          // 删除屏障优先，离线未确认变更留在冲突库，不能静默复活已删除数据。
          for (const pending of await local.watchQueue.toArray())
            if (pending.baseRevision < r.revision) {
              await local.watchConflicts.put({
                ...pending,
                id: pending.opId,
                error: '其他设备已清空记录',
              });
              await local.watchQueue.delete(pending.id);
            }
          await local.history.clear();
          await local.progress.clear();
          for (const pending of await local.watchQueue.toArray())
            if (!pending.deleted && pending.value) {
              if (pending.kind === 'history')
                await local.history.put(pending.value as HistoryEntry);
              if (pending.kind === 'progress')
                await local.progress.put(pending.value as ProgressEntry);
            }
        } else if (
          !(await local.watchQueue.get(id)) &&
          !(await local.watchQueue.get(recordKey('clear', '')))
        ) {
          const table = r.kind === 'history' ? local.history : local.progress;
          if (r.deleted) await table.delete(r.key);
          else if (r.value) await table.put(r.value as never);
        }
        await local.watchVersions.put({ id, revision: r.revision, record: r });
      }
    }
  );
}

export async function addSearchHistory(text: string): Promise<void> {
  const t = text.trim().slice(0, 50);
  if (!t) return;
  await db.searchHistory.put({ text: t, timestamp: Date.now() });
  const count = await db.searchHistory.count();
  if (count > MAX_SEARCH_HISTORY) {
    const oldest = await db.searchHistory
      .orderBy('timestamp')
      .limit(count - MAX_SEARCH_HISTORY)
      .toArray();
    await db.searchHistory.bulkDelete(oldest.map((o) => o.text));
  }
}

export async function removeSearchHistory(text: string): Promise<void> {
  await db.searchHistory.delete(text);
}

export async function clearSearchHistory(): Promise<void> {
  await db.searchHistory.clear();
}

/** 撤销「清空搜索记录」：按原时间戳回填，保持原有顺序 */
export async function restoreSearchHistory(
  entries: SearchHistoryEntry[]
): Promise<void> {
  if (entries.length === 0) return;
  await db.searchHistory.bulkPut(entries);
}

// —— 直播测活缓存（TTL 过滤由调用方负责，本层只管存取） ——

export async function loadLiveProbeResults(): Promise<
  Record<string, LiveProbeEntry>
> {
  const rows = await db.liveProbe.toArray();
  const out: Record<string, LiveProbeEntry> = {};
  for (const r of rows) out[r.url] = r;
  return out;
}

export async function saveLiveProbeResults(
  entries: Record<string, LiveProbeEntry>
): Promise<void> {
  const rows = Object.entries(entries).map(([url, e]) => ({ ...e, url }));
  if (rows.length > 0) await db.liveProbe.bulkPut(rows);
}

export async function clearLiveProbeResultsDb(): Promise<void> {
  await db.liveProbe.clear();
}

// —— 配置导入导出（兼容旧版 LibreTV-Settings JSON 结构的导出格式） ——

export async function exportConfig(): Promise<string> {
  // 导出前 flush：把节流缓冲中的最新设置落盘，避免导出的是 800ms 前的旧快照
  flushPendingPersist();
  const history = await db.history.toArray();
  const settings = localStorage.getItem(localSettingsKey());

  const data: Record<string, unknown> = {
    viewingHistory: JSON.stringify(history),
  };
  if (settings) data[PERSIST_KEY] = settings;

  return JSON.stringify({
    name: 'LibreTV-Settings',
    time: Date.now().toString(),
    cfgVer: '2.0.0',
    data,
  });
}

export async function importConfig(content: string): Promise<void> {
  const config = JSON.parse(content) as {
    name?: string;
    data?: Record<string, string>;
  };
  if (config.name !== 'LibreTV-Settings') throw new Error('配置文件格式不正确');
  const data = config.data || {};

  if (typeof data[PERSIST_KEY] === 'string') {
    // 关键：先 flush 节流缓冲中的旧状态再写导入配置，否则缓冲会在
    // 之后 flush 时用导入前的旧状态覆盖刚写入的配置（导入静默丢失）
    flushPendingPersist();
    localStorage.setItem(localSettingsKey(), data[PERSIST_KEY]);
  }

  if (typeof data['viewingHistory'] === 'string') {
    // 兼容旧版历史结构（含全集 URL 列表），只迁移定位信息
    const legacy = JSON.parse(data['viewingHistory']) as Record<
      string,
      unknown
    >[];
    for (const item of legacy.slice(0, MAX_HISTORY)) {
      const sourceKey = String(item.sourceCode || item.sourceName || '');
      const vodId = String(item.vod_id || '');
      const title = String(item.title || '未知视频');
      if (!sourceKey || !vodId) continue;
      const totalEpisodes = Array.isArray(item.episodes)
        ? item.episodes.length
        : 0;
      await upsertHistory({
        sourceKey,
        vodId,
        title,
        episodeIndex:
          typeof item.episodeIndex === 'number' ? item.episodeIndex : 0,
        totalEpisodes,
        playbackPosition:
          typeof item.playbackPosition === 'number' ? item.playbackPosition : 0,
        duration: typeof item.duration === 'number' ? item.duration : 0,
        timestamp:
          typeof item.timestamp === 'number' ? item.timestamp : Date.now(),
      });
    }
  }
}

export type { SourceConfig };
