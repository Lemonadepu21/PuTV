import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { database, closeDatabase } from './database';
import {
  createSession,
  resolveSession,
  createProfile,
  selectProfile,
  setAccountStatus,
} from './identity';
import { pullWatch, pushWatch } from './watch';
import {
  contentKey,
  episodeKey,
  type WatchMutation,
  type WatchRecord,
} from '@/lib/watch-types';
import { GET, POST } from '@/app/api/watch/route';
import { POST as importRoute } from '@/app/api/watch/import/route';
let dir: string, profile: string, token: string, account: string;
function fixture(role = 'user') {
  const id = randomUUID(),
    profile = randomUUID(),
    now = Date.now();
  database()
    .prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?)')
    .run(id, id, 'unused', role, 'active', now, now);
  database()
    .prepare('INSERT INTO profiles VALUES(?,?,?,?,?,?,?)')
    .run(profile, id, 'viewer', 'preset:blue', 1, now, now);
  const signed = createSession(id, randomUUID());
  return { account: id, profile, token: signed.token };
}
beforeEach(() => {
  closeDatabase();
  dir = mkdtempSync(join(tmpdir(), 'putv-sync-'));
  process.env.SQLITE_PATH = join(dir, 'sync.sqlite');
  ({ account, profile, token } = fixture());
});
afterEach(() => {
  vi.useRealTimers();
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SQLITE_PATH;
});
function mutation(
  kind: 'history' | 'progress' = 'history',
  index = 0
): WatchMutation {
  const sourceKey = 'custom_source_1',
    vodId = 'video_1',
    sourceUrl = 'https://cms.example/api.php',
    now = Date.now();
  const key =
    kind === 'history'
      ? contentKey(sourceKey, vodId, sourceUrl)
      : episodeKey(sourceKey, vodId, index, sourceUrl);
  return {
    opId: randomUUID(),
    kind,
    key,
    baseRevision: 0,
    deleted: false,
    modifiedAt: now,
    value:
      kind === 'history'
        ? {
            id: key,
            sourceKey,
            sourceUrl,
            vodId,
            title: 'Test film',
            episodeIndex: index,
            totalEpisodes: 12,
            playbackPosition: 20,
            duration: 100,
            timestamp: now,
          }
        : {
            key,
            sourceKey,
            sourceUrl,
            vodId,
            episodeIndex: index,
            position: 20,
            duration: 100,
            updatedAt: now,
          },
  };
}
function push(m: WatchMutation) {
  return pushWatch(profile, [m])[0];
}
function request(
  method = 'GET',
  body?: unknown,
  cookie = token,
  context = `${account}:${profile}`,
  origin = 'https://local.test',
  query = ''
) {
  return new Request('https://local.test/api/watch' + query, {
    method,
    headers: {
      origin,
      'Content-Type': 'application/json',
      'X-PuTV-Context': context,
      cookie: `putv_session=${cookie}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
it('迁移重复启动不重建账号或历史', () => {
  const m = mutation();
  push(m);
  closeDatabase();
  expect(pullWatch(profile, null).records).toHaveLength(1);
  expect(
    database().prepare('SELECT COUNT(*) n FROM schema_migrations').get()!.n
  ).toBe(2);
  expect(resolveSession(token)).not.toBeNull();
});
it('重复操作幂等、标题相同不同源及分集各自独立', () => {
  const m = mutation();
  expect(push(m).status).toBe('applied');
  expect(push(m).status).toBe('duplicate');
  const other = mutation();
  other.value!.sourceUrl = 'https://other.example/api.php';
  other.key = contentKey(
    other.value!.sourceKey!,
    other.value!.vodId!,
    other.value!.sourceUrl
  );
  (other.value as { id: string }).id = other.key;
  push(other);
  push(mutation('progress', 0));
  push(mutation('progress', 1));
  expect(pullWatch(profile, null).records).toHaveLength(4);
});
it('相同毫秒多次修改仍有不漏项的分页游标', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T00:00:00Z'));
  for (let i = 0; i < 5; i++) push(mutation('progress', i));
  const seen: WatchRecord[] = [];
  let cursor: null | string = null;
  for (let i = 0; i < 5; i++) {
    const page = pullWatch(profile, cursor, 1);
    seen.push(...page.records);
    cursor = page.cursor;
  }
  expect(new Set(seen.map((r) => r.revision)).size).toBe(5);
  expect(pullWatch(profile, cursor).records).toEqual([]);
});
it('拒绝其他档案游标、伪造查询及过大批次', async () => {
  const other = fixture();
  expect(() => pullWatch(profile, `${other.profile}:0`)).toThrow('游标');
  expect(() => pushWatch(profile, Array(51).fill(mutation()))).toThrow('1–50');
  expect(
    (
      await GET(
        request(
          'GET',
          undefined,
          token,
          undefined,
          undefined,
          '?profileId=' + other.profile
        )
      )
    ).status
  ).toBe(400);
});
it('普通用户、管理员均不能跨账号或跨活动档案读取', async () => {
  push(mutation());
  const other = fixture(),
    admin = fixture('admin');
  expect(
    (await GET(request('GET', undefined, other.token, `${account}:${profile}`)))
      .status
  ).toBe(409);
  expect(
    (await GET(request('GET', undefined, admin.token, `${account}:${profile}`)))
      .status
  ).toBe(409);
  const child = createProfile(account, 'child');
  selectProfile(resolveSession(token)!, child.id);
  expect((await GET(request())).status).toBe(409);
  const response = await GET(
    request('GET', undefined, token, `${account}:${child.id}`)
  );
  expect((await response.json()).records).toEqual([]);
});
it('切换档案时旧请求不能写入新档案，禁用会话立即失效', async () => {
  const child = createProfile(account, 'child');
  selectProfile(resolveSession(token)!, child.id);
  expect(
    (await POST(request('POST', { operations: [mutation()] }))).status
  ).toBe(409);
  setAccountStatus(account, 'disabled');
  expect((await GET(request())).status).toBe(401);
});
it('批次非法行明确报错，合法行仍保存，拒绝 accountId 注入和 CSRF', async () => {
  const good = mutation(),
    bad = mutation('progress');
  (bad.value as { position: number }).position = -1;
  const response = await POST(request('POST', { operations: [good, bad] }));
  expect(response.status).toBe(200);
  expect(
    (await response.json()).results.map((r: { status: string }) => r.status)
  ).toEqual(['applied', 'invalid']);
  expect(pullWatch(profile, null).records).toHaveLength(1);
  expect(
    (
      await POST(
        request('POST', { operations: [mutation()], accountId: 'other' })
      )
    ).status
  ).toBe(400);
  expect(
    (
      await POST(
        request(
          'POST',
          { operations: [mutation()] },
          token,
          undefined,
          'https://evil.test'
        )
      )
    ).status
  ).toBe(403);
});
it('无登录、无活动档案均不可同步', async () => {
  expect((await GET(request('GET', undefined, ''))).status).toBe(401);
  database().prepare('UPDATE sessions SET selected_profile_id=NULL').run();
  expect((await GET(request())).status).toBe(409);
});
it('旧进度不覆盖更新；已确认版本允许主动拖动回退', () => {
  vi.useFakeTimers();
  const time = Date.now();
  vi.setSystemTime(time);
  const first = mutation('progress'),
    saved = push(first).record!;
  vi.setSystemTime(time + 1000);
  const latest = { ...mutation('progress'), baseRevision: saved.revision };
  (latest.value as { position: number }).position = 80;
  const newer = push(latest).record!;
  vi.setSystemTime(time + 5000);
  const late = { ...first, opId: randomUUID(), modifiedAt: time - 1000 };
  expect(push(late).status).toBe('conflict');
  const backward = { ...mutation('progress'), baseRevision: newer.revision };
  (backward.value as { position: number }).position = 5;
  expect((push(backward).record!.value as { position: number }).position).toBe(
    5
  );
});
it('可信的近期播放更新优先；异常未来时间拒绝', () => {
  vi.useFakeTimers();
  const time = Date.now();
  vi.setSystemTime(time);
  push(mutation('progress'));
  vi.setSystemTime(time + 5000);
  const newer = mutation('progress');
  (newer.value as { position: number }).position = 70;
  expect(push(newer).status).toBe('applied');
  const future = mutation();
  future.modifiedAt = Date.now() + 3600000;
  expect(push(future).status).toBe('invalid');
});
it('删除墓碑阻止离线旧快照复活，且不删除分集进度', () => {
  const m = mutation(),
    first = push(m).record!;
  push(mutation('progress'));
  const deleted = push({
    ...m,
    opId: randomUUID(),
    baseRevision: first.revision,
    deleted: true,
  }).record!;
  expect(deleted.deleted).toBe(true);
  const late = { ...m, opId: randomUUID(), modifiedAt: Date.now() };
  expect(push(late).status).toBe('conflict');
  expect(pushWatch(profile, [m], true)[0].status).toBe('duplicate');
  expect(
    pushWatch(profile, [{ ...m, opId: randomUUID() }], true)[0].status
  ).toBe('skipped');
  expect(
    pullWatch(profile, null).records.find((r) => r.kind === 'progress')?.deleted
  ).toBe(false);
});
it('清空产生屏障，未知离线旧记录也不能复活；不影响其他档案', () => {
  push(mutation());
  const other = fixture();
  pushWatch(other.profile, [mutation()]);
  const max = pullWatch(profile, null).records.at(-1)!.revision;
  const clear = push({
    opId: randomUUID(),
    kind: 'clear',
    key: '',
    value: null,
    deleted: true,
    baseRevision: max,
    modifiedAt: Date.now(),
  }).record!;
  expect(pullWatch(profile, null).records).toEqual([clear]);
  expect(push(mutation('progress', 7)).status).toBe('conflict');
  expect(
    push({ ...mutation('progress', 7), baseRevision: clear.revision }).status
  ).toBe('applied');
  expect(pullWatch(other.profile, null).records[0].deleted).toBe(false);
});
it('离线清空不无条件删除其他设备更新；可以按最新版本再次清空', () => {
  vi.useFakeTimers();
  const time = Date.now();
  vi.setSystemTime(time);
  const old = mutation();
  const saved = push(old).record!;
  vi.setSystemTime(time + 1000);
  const latest = push({ ...mutation(), baseRevision: saved.revision }).record!;
  const staleClear: WatchMutation = {
    opId: randomUUID(),
    kind: 'clear',
    key: '',
    value: null,
    deleted: true,
    baseRevision: saved.revision,
    modifiedAt: time,
  };
  expect(push(staleClear).status).toBe('conflict');
  vi.setSystemTime(time + 2000);
  expect(
    push({
      ...staleClear,
      opId: randomUUID(),
      baseRevision: latest.revision,
      modifiedAt: Date.now(),
    }).status
  ).toBe('applied');
});
it('导入需要当前目标确认上下文，重复导入去重且返回计数', async () => {
  const m = mutation();
  const first = await importRoute(request('POST', { operations: [m] }));
  expect((await first.json()).counts).toEqual({
    success: 1,
    skipped: 0,
    conflicts: 0,
    failed: 0,
  });
  const duplicate = await importRoute(request('POST', { operations: [m] }));
  expect((await duplicate.json()).counts.success).toBe(1);
  const existing = await importRoute(
    request('POST', { operations: [{ ...m, opId: randomUUID() }] })
  );
  expect((await existing.json()).counts.skipped).toBe(1);
  expect(pullWatch(profile, null).records).toHaveLength(1);
});
it('拒绝畸形字段、URL、超时长、非有限值及标识不匹配', () => {
  for (const change of [
    { ...mutation(), accountId: 'evil' },
    { ...mutation(), key: 'forged' },
    {
      ...mutation(),
      value: { ...mutation().value, pic: 'javascript:alert(1)' },
    },
    {
      ...mutation('progress'),
      value: { ...mutation('progress').value, position: Infinity },
    },
    {
      ...mutation('progress'),
      value: { ...mutation('progress').value, position: 1010 },
    },
  ])
    expect(pushWatch(profile, [change])[0].status).toBe('invalid');
});

it('版本落后且时钟偏快的操作采用保守冲突策略', () => {
  const first = mutation('progress');
  push(first);
  const skewed = { ...mutation('progress'), modifiedAt: Date.now() + 60000 };
  expect(push(skewed).status).toBe('conflict');
  expect(
    (pullWatch(profile, null).records[0].value as { position: number }).position
  ).toBe(20);
});
