import 'server-only';
import { database, transaction } from './database.ts';
import { IdentityError } from './identity.ts';
import { requireIdentity } from './http';
import {
  contentKey,
  episodeKey,
  type WatchKind,
  type WatchMutation,
  type WatchRecord,
  type WatchResult,
  type WatchValue,
} from '@/lib/watch-types';

const kinds = ['history', 'progress', 'clear'];
export function requireWatchIdentity(req: Request) {
  const identity = requireIdentity(req);
  if (!identity.profile) throw new IdentityError('请先选择观看档案', 409);
  const context = `${identity.account.id}:${identity.profile.id}`;
  if (req.headers.get('x-putv-context') !== context)
    throw new IdentityError('账号或档案已切换，请刷新页面', 409);
  return { ...identity, profile: identity.profile, context };
}
function text(
  value: unknown,
  name: string,
  max: number,
  optional = false
): string {
  if (optional && (value === undefined || value === '')) return '';
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new IdentityError(`${name}无效`);
  return value;
}
function number(value: unknown, name: string, max: number, integer = false) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max ||
    (integer && !Number.isSafeInteger(value))
  )
    throw new IdentityError(`${name}无效`);
  return value;
}
function timestamp(value: unknown) {
  return number(value, '更新时间', Date.now() + 300000, true);
}
function url(value: unknown, name: string) {
  if (value === undefined || value === '') return undefined;
  const raw = text(value, name, 2048);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new IdentityError(`${name}无效`);
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    throw new IdentityError(`${name}无效`);
  return raw;
}
export function validateMutation(input: unknown): WatchMutation {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new IdentityError('记录格式错误');
  const m = input as Record<string, unknown>;
  if (
    Object.keys(m).some(
      (key) =>
        ![
          'opId',
          'kind',
          'key',
          'value',
          'deleted',
          'baseRevision',
          'modifiedAt',
        ].includes(key)
    )
  )
    throw new IdentityError('包含无效记录参数');
  const opId = text(m.opId, '操作编号', 80);
  if (!/^[a-zA-Z0-9_-]+$/.test(opId)) throw new IdentityError('操作编号无效');
  if (!kinds.includes(String(m.kind)) || typeof m.deleted !== 'boolean')
    throw new IdentityError('记录类型无效');
  const kind = m.kind as WatchKind,
    baseRevision = number(
      m.baseRevision,
      '版本',
      Number.MAX_SAFE_INTEGER,
      true
    ),
    modifiedAt = timestamp(m.modifiedAt);
  if (kind === 'clear') {
    if (m.key !== '' || m.value !== null || m.deleted !== true)
      throw new IdentityError('清空参数无效');
    return {
      opId,
      kind,
      key: '',
      value: null,
      deleted: true,
      baseRevision,
      modifiedAt,
    };
  }
  if (!m.value || typeof m.value !== 'object' || Array.isArray(m.value))
    throw new IdentityError('影片信息缺失');
  const v = m.value as Record<string, unknown>;
  const allowed =
    kind === 'history'
      ? [
          'id',
          'sourceKey',
          'sourceUrl',
          'vodId',
          'title',
          'pic',
          'episodeIndex',
          'totalEpisodes',
          'playbackPosition',
          'duration',
          'timestamp',
          'completed',
        ]
      : [
          'key',
          'sourceKey',
          'sourceUrl',
          'vodId',
          'episodeIndex',
          'position',
          'duration',
          'updatedAt',
          'completed',
        ];
  if (Object.keys(v).some((key) => !allowed.includes(key)))
    throw new IdentityError('包含无效影片参数');
  const sourceKey = text(v.sourceKey, '片源标识', 160),
    vodId = text(v.vodId, '影片标识', 160),
    sourceUrl = url(v.sourceUrl, '片源地址');
  if (!/^[\w-]+$/.test(vodId))
    throw new IdentityError('影片缺少稳定标识，已保留本机记录');
  const episodeIndex = number(v.episodeIndex, '集数', 100000, true),
    duration = number(v.duration, '时长', 604800);
  const position = number(
    kind === 'history' ? v.playbackPosition : v.position,
    '播放位置',
    604800
  );
  if (position > duration + 5) throw new IdentityError('播放位置超过时长');
  if (v.completed !== undefined && typeof v.completed !== 'boolean')
    throw new IdentityError('完成状态无效');
  const completed = v.completed === true;
  const key =
    kind === 'history'
      ? contentKey(sourceKey, vodId, sourceUrl)
      : episodeKey(sourceKey, vodId, episodeIndex, sourceUrl);
  if (m.key !== key) throw new IdentityError('影片标识不匹配');
  const base = {
    sourceKey,
    sourceUrl,
    vodId,
    episodeIndex,
    duration,
    completed,
  };
  const value: WatchValue =
    kind === 'history'
      ? {
          ...base,
          id: key,
          title: text(v.title, '片名', 300),
          pic: url(v.pic, '海报地址'),
          totalEpisodes: number(v.totalEpisodes, '总集数', 100000, true),
          playbackPosition: completed ? duration : Math.min(position, duration),
          timestamp: Math.min(timestamp(v.timestamp), Date.now()),
        }
      : {
          ...base,
          key,
          position: completed ? duration : Math.min(position, duration),
          updatedAt: Math.min(timestamp(v.updatedAt), Date.now()),
        };
  return {
    opId,
    kind,
    key,
    value,
    baseRevision,
    modifiedAt,
    deleted: m.deleted,
  };
}
interface Row {
  op_id: string;
  kind: WatchKind;
  record_key: string;
  value_json: string | null;
  deleted: number;
  revision: number;
  modified_at: number;
  updated_at: number;
}
function record(row: Row): WatchRecord {
  return {
    opId: row.op_id,
    kind: row.kind,
    key: row.record_key,
    value: row.value_json ? JSON.parse(row.value_json) : null,
    deleted: Boolean(row.deleted),
    revision: row.revision,
    modifiedAt: row.modified_at,
    updatedAt: row.updated_at,
  };
}
function find(profile: string, kind: WatchKind, key: string) {
  const row = database()
    .prepare(
      'SELECT * FROM watch_records WHERE profile_id=? AND kind=? AND record_key=?'
    )
    .get(profile, kind, key) as unknown as Row | undefined;
  return row ? record(row) : undefined;
}
function nextRevision() {
  return Number(
    database().prepare('INSERT INTO watch_clock DEFAULT VALUES').run()
      .lastInsertRowid
  );
}
function save(profile: string, change: WatchRecord) {
  database()
    .prepare(
      `INSERT INTO watch_records VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(profile_id,kind,record_key) DO UPDATE SET value_json=excluded.value_json,op_id=excluded.op_id,deleted=excluded.deleted,revision=excluded.revision,modified_at=excluded.modified_at,updated_at=excluded.updated_at`
    )
    .run(
      profile,
      change.kind,
      change.key,
      change.value ? JSON.stringify(change.value) : null,
      change.opId || '',
      Number(change.deleted),
      change.revision,
      change.modifiedAt,
      change.updatedAt
    );
}
export function pushWatch(
  profile: string,
  inputs: unknown[],
  importing = false
): WatchResult[] {
  if (inputs.length < 1 || inputs.length > 50)
    throw new IdentityError('每批需包含 1–50 条记录');
  return inputs.map((input) => {
    let mutation: WatchMutation;
    try {
      mutation = validateMutation(input);
    } catch (error) {
      return {
        opId:
          typeof (input as Record<string, unknown>)?.opId === 'string'
            ? String((input as Record<string, unknown>).opId).slice(0, 80)
            : '',
        status: 'invalid',
        error: error instanceof IdentityError ? error.message : '记录无效',
      };
    }
    return transaction(() => {
      const db = database(),
        m = mutation,
        now = Date.now();
      const prior = db
        .prepare(
          'SELECT result_json FROM watch_operations WHERE profile_id=? AND op_id=?'
        )
        .get(profile, m.opId);
      if (prior) {
        const saved = JSON.parse(String(prior.result_json)) as WatchResult;
        return saved.status === 'applied'
          ? { ...saved, status: 'duplicate' }
          : saved;
      }
      const current = find(profile, m.kind, m.key),
        clear = find(profile, 'clear', '');
      const maximum = Number(
        db.prepare('SELECT COALESCE(MAX(revision),0) n FROM watch_clock').get()!
          .n
      );
      if (m.baseRevision > maximum)
        return { opId: m.opId, status: 'invalid', error: '版本超出服务端范围' };
      let result: WatchResult;
      if (importing && (m.kind === 'clear' || m.deleted))
        result = { opId: m.opId, status: 'invalid', error: '导入不支持删除' };
      else if (importing && current)
        result = { opId: m.opId, status: 'skipped', record: current };
      else if (
        m.baseRevision < (clear?.revision || 0) ||
        (m.kind !== 'clear' &&
          current?.deleted &&
          m.baseRevision !== current.revision)
      )
        result = {
          opId: m.opId,
          status: 'conflict',
          record: current || clear,
          error: '记录已被删除或清空',
        };
      else {
        const latest =
          m.kind === 'clear'
            ? Number(
                db
                  .prepare(
                    'SELECT COALESCE(MAX(updated_at),0) n FROM watch_records WHERE profile_id=?'
                  )
                  .get(profile)!.n
              )
            : current?.updatedAt || 0;
        const stale =
          m.kind === 'clear'
            ? m.baseRevision <
              Number(
                db
                  .prepare(
                    'SELECT COALESCE(MAX(revision),0) n FROM watch_records WHERE profile_id=?'
                  )
                  .get(profile)!.n
              )
            : Boolean(current && m.baseRevision !== current.revision);
        // 版本一致允许主动回退；版本落后仅采纳时间可信且晚于服务端写入的近期操作。
        if (
          stale &&
          !(
            m.modifiedAt > latest &&
            m.modifiedAt <= now &&
            now - m.modifiedAt <= 120000
          )
        )
          result = {
            opId: m.opId,
            status: 'conflict',
            record: current || clear,
            error: '其他设备已有更新，保留服务端记录',
          };
        else {
          const change: WatchRecord = {
            opId: m.opId,
            kind: m.kind,
            key: m.key,
            value: m.value,
            deleted: m.deleted,
            revision: nextRevision(),
            modifiedAt: Math.min(m.modifiedAt, now),
            updatedAt: now,
          };
          if (m.kind === 'clear')
            db.prepare(
              'UPDATE watch_records SET deleted=1,revision=?,updated_at=? WHERE profile_id=?'
            ).run(change.revision, now, profile);
          save(profile, change);
          result = { opId: m.opId, status: 'applied', record: change };
        }
      }
      db.prepare('INSERT INTO watch_operations VALUES(?,?,?,?)').run(
        profile,
        m.opId,
        JSON.stringify(result),
        now
      );
      // 墓碑不清理；90 天后重试仍受记录版本和清空屏障保护。
      db.prepare('DELETE FROM watch_operations WHERE created_at<?').run(
        now - 90 * 86400000
      );
      return result;
    });
  });
}
export function pullWatch(profile: string, cursor: string | null, limit = 100) {
  const prefix = `${profile}:`;
  if (
    cursor &&
    (!cursor.startsWith(prefix) || !/^\d+$/.test(cursor.slice(prefix.length)))
  )
    throw new IdentityError('游标不属于当前档案');
  const since = cursor ? Number(cursor.slice(prefix.length)) : 0;
  if (!Number.isSafeInteger(since)) throw new IdentityError('游标无效');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    throw new IdentityError('分页数量需为 1–200');
  const clear = find(profile, 'clear', '');
  const rows = database()
    .prepare(
      `SELECT * FROM watch_records WHERE profile_id=? AND revision>? AND (kind='clear' OR revision>?) ORDER BY revision LIMIT ?`
    )
    .all(profile, since, clear?.revision || 0, limit + 1) as unknown as Row[];
  const records = rows.slice(0, limit).map(record);
  return {
    records,
    cursor: `${profile}:${records.at(-1)?.revision || since}`,
    hasMore: rows.length > limit,
  };
}
