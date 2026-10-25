export interface WatchHistory {
  id: string;
  sourceKey: string;
  sourceUrl?: string;
  vodId: string;
  title: string;
  pic?: string;
  episodeIndex: number;
  totalEpisodes: number;
  playbackPosition: number;
  duration: number;
  timestamp: number;
  completed?: boolean;
}
export interface WatchProgress {
  key: string;
  position: number;
  duration: number;
  updatedAt: number;
  sourceKey?: string;
  sourceUrl?: string;
  vodId?: string;
  episodeIndex?: number;
  completed?: boolean;
}
export type WatchKind = 'history' | 'progress' | 'clear';
export type WatchValue = WatchHistory | WatchProgress;
export interface WatchMutation {
  opId: string;
  kind: WatchKind;
  key: string;
  value: WatchValue | null;
  deleted: boolean;
  baseRevision: number;
  modifiedAt: number;
}
export interface WatchRecord {
  opId?: string;
  kind: WatchKind;
  key: string;
  value: WatchValue | null;
  deleted: boolean;
  revision: number;
  modifiedAt: number;
  updatedAt: number;
}
export interface WatchResult {
  opId: string;
  status: 'applied' | 'duplicate' | 'skipped' | 'conflict' | 'invalid';
  record?: WatchRecord;
  error?: string;
}
export interface WatchPage {
  context: string;
  records: WatchRecord[];
  cursor: string;
  hasMore: boolean;
}
export const WATCH_DIRTY = 'putv:watch-dirty';
export const WATCH_URGENT = 'putv:watch-urgent';
export function contentKey(
  sourceKey: string,
  vodId: string,
  sourceUrl?: string
) {
  return JSON.stringify([sourceKey, sourceUrl || '', vodId]);
}
export function episodeKey(
  sourceKey: string,
  vodId: string,
  index: number,
  sourceUrl?: string
) {
  return JSON.stringify([sourceKey, sourceUrl || '', vodId, index]);
}
export const recordKey = (kind: WatchKind, key: string) => `${kind}:${key}`;

export function newWatchOperationId() {
  return Array.from(
    globalThis.crypto.getRandomValues(new Uint8Array(16)),
    (value) => value.toString(16).padStart(2, '0')
  ).join('');
}

export function watchMutationBody(m: WatchMutation): WatchMutation {
  return {
    opId: m.opId,
    kind: m.kind,
    key: m.key,
    value: m.value,
    deleted: m.deleted,
    baseRevision: m.baseRevision,
    modifiedAt: m.modifiedAt,
  };
}
