import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase, database } from '@/server/database';
import {
  createAccount,
  authenticate,
  createSession,
  resolveSession,
  revokeSession,
  setAccountStatus,
  checkInvitation,
  createProfile,
  ownedProfile,
  selectProfile,
  updateProfile,
  resetAccountPassword,
  registrationEnabled,
  rateLimit,
  changePassword,
  tokenHash,
} from '@/server/identity';
import { SESSION_COOKIE, cookieValue, sessionFromCookieHeader } from './auth';
import { assertSameOrigin, jsonBody, requireIdentity } from '@/server/http';
import { POST as register } from '@/app/api/auth/register/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { POST as legacy } from '@/app/api/auth/route';
import { POST as select } from '@/app/api/profiles/select/route';
import { GET as accounts } from '@/app/api/admin/accounts/route';
import { GET as status } from '@/app/api/status/route';
import { saveAvatar, readAvatar, cleanAvatar } from '@/server/avatars';
import sharp from 'sharp';
let dir: string;
const pass = '12345678';
beforeEach(() => {
  closeDatabase();
  dir = mkdtempSync(join(tmpdir(), 'putv-auth-'));
  process.env.SQLITE_PATH = join(dir, 'auth.sqlite');
  process.env.PASSWORD = 'invite-code';
  process.env.REGISTRATION_ENABLED = 'true';
});
afterEach(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SQLITE_PATH;
  delete process.env.PASSWORD;
  delete process.env.REGISTRATION_ENABLED;
  delete process.env.APP_ORIGIN;
  vi.unstubAllEnvs();
});
const req = (
  url: string,
  body?: unknown,
  token?: string,
  origin = 'https://local.test'
) =>
  new Request(`https://local.test${url}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      origin,
      'Content-Type': 'application/json',
      ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
async function user(name = 'alice') {
  return createAccount(name, pass);
}
async function session(name = 'alice') {
  const account = await user(name);
  const signed = createSession(account.id, 'd'.repeat(32));
  return { account, ...signed, identity: resolveSession(signed.token)! };
}

describe('身份与邀请码', () => {
  it('随机盐慢哈希，大小写登录，用户名唯一，邀请轮换不影响登录', async () => {
    const a = await user();
    const hash = database()
      .prepare('SELECT password_hash FROM accounts WHERE id=?')
      .get(a.id)!.password_hash;
    expect(hash).not.toContain(pass);
    expect(String(hash)).toMatch(/^scrypt\$/);
    expect((await authenticate('ALICE', pass)).id).toBe(a.id);
    await expect(user('ALICE')).rejects.toThrow('用户名已被使用');
    process.env.PASSWORD = 'changed';
    expect((await authenticate('alice', pass)).id).toBe(a.id);
  });
  it('邀请码错误、错误密码及参数受校验', async () => {
    expect(() => checkInvitation('bad')).toThrow('邀请码错误');
    await user();
    await expect(authenticate('alice', 'incorrect password')).rejects.toThrow(
      '用户名或密码错误'
    );
    await expect(user('a')).rejects.toThrow('用户名');
    await expect(createAccount('alice2', '1234567')).rejects.toThrow('密码');
  });
  it('注册自动创建普通账号和默认档案，并签发 HttpOnly Cookie', async () => {
    const res = await register(
      req('/api/auth/register', {
        username: 'Alice',
        password: pass,
        confirmPassword: pass,
        invitation: 'invite-code',
      })
    );
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=lax');
    const token = /putv_session=([a-f0-9]+)/.exec(cookie)![1];
    const identity = resolveSession(token)!;
    expect(identity.account.role).toBe('user');
    expect(identity.profile?.name).toBe('alice');
    expect(
      database().prepare('SELECT token_hash FROM sessions').get()!.token_hash
    ).not.toBe(token);
  });
  it('禁止注册注入 role / accountId，邀请码错误和确认密码错误有状态码', async () => {
    expect(
      (
        await register(
          req('/api/auth/register', {
            username: 'alice',
            password: pass,
            confirmPassword: pass,
            invitation: 'invite-code',
            role: 'admin',
          })
        )
      ).status
    ).toBe(400);
    expect(
      (
        await register(
          req('/api/auth/register', {
            username: 'alice',
            password: pass,
            confirmPassword: pass,
            invitation: 'bad',
          })
        )
      ).status
    ).toBe(403);
    expect(
      (
        await register(
          req('/api/auth/register', {
            username: 'alice',
            password: pass,
            confirmPassword: 'bad',
            invitation: 'invite-code',
          })
        )
      ).status
    ).toBe(400);
  });
  it('关闭注册不影响已有登录，也无需配置邀请码', async () => {
    await user();
    process.env.REGISTRATION_ENABLED = 'false';
    delete process.env.PASSWORD;
    expect(registrationEnabled()).toBe(false);
    expect(
      (
        await login(
          req('/api/auth/login', { username: 'alice', password: pass })
        )
      ).status
    ).toBe(200);
    expect((await register(req('/api/auth/register', {}))).status).toBe(403);
  });
  it('只允许 CLI 显式初始化一个管理员，普通首用户不会提升', async () => {
    const a = await user();
    expect(a.role).toBe('user');
    await createAccount('admin', pass, 'admin');
    await expect(createAccount('admin2', pass, 'admin')).rejects.toThrow(
      '已存在管理员'
    );
    expect(
      database()
        .prepare("SELECT COUNT(*) n FROM accounts WHERE role='admin'")
        .get()!.n
    ).toBe(1);
  });
});
describe('会话、权限与持久化', () => {
  it('撤销、过期、旧版 Cookie、恶意 Cookie 无法认证', async () => {
    const s = await session();
    expect(sessionFromCookieHeader(`${SESSION_COOKIE}=${s.token}`)).toBe(true);
    expect(sessionFromCookieHeader('ltv_session=9999999999999.sig')).toBe(
      false
    );
    expect(cookieValue('putv_session=%ZZ', SESSION_COOKIE)).toBeUndefined();
    revokeSession(s.identity.sessionId);
    expect(resolveSession(s.token)).toBeNull();
    const next = createSession(s.account.id, 'e'.repeat(32));
    database().prepare('UPDATE sessions SET expires_at=0').run();
    expect(resolveSession(next.token)).toBeNull();
    expect((await legacy()).status).toBe(410);
  });
  it('退出立即撤销服务端会话', async () => {
    const s = await session();
    expect((await logout(req('/api/auth/logout', {}, s.token))).status).toBe(
      200
    );
    expect(resolveSession(s.token)).toBeNull();
  });
  it('禁用、重置密码和撤销会话不受邀请码影响', async () => {
    const s = await session();
    setAccountStatus(s.account.id, 'disabled');
    expect(resolveSession(s.token)).toBeNull();
    setAccountStatus(s.account.id, 'active');
    expect(resolveSession(s.token)).toBeNull();
    const next = createSession(s.account.id, 'e'.repeat(32));
    await resetAccountPassword(s.account.id, '87654321');
    expect(resolveSession(next.token)).toBeNull();
    expect((await authenticate('alice', '87654321')).id).toBe(
      s.account.id
    );
  });
  it('普通用户不能访问管理员接口', async () => {
    const s = await session();
    expect(
      (await accounts(req('/api/admin/accounts', undefined, s.token))).status
    ).toBe(403);
    expect(() => requireIdentity(req('/api/profiles'))).toThrow('请登录');
  });
  it('会话在关闭和重开 SQLite 后仍有效，迁移只应用一次', async () => {
    const s = await session();
    closeDatabase();
    expect(resolveSession(s.token)?.account.id).toBe(s.account.id);
    expect(
      database().prepare('SELECT COUNT(*) n FROM schema_migrations').get()!.n
    ).toBe(2);
  });
  it('status 未登录不泄漏预置私有源、邀请或摘要', async () => {
    process.env.DEFAULT_SOURCES =
      '[{"name":"private","url":"https://private.example/api"}]';
    const res = await status(req('/api/status'));
    const data = await res.json();
    expect(data.defaultSources).toEqual([]);
    expect(JSON.stringify(data)).not.toContain('invite-code');
    delete process.env.DEFAULT_SOURCES;
  });
});
describe('档案归属与设备选择', () => {
  it('跨账号不能读取、更新或选择档案', async () => {
    const a = await session(),
      b = await session('bobby');
    expect(() => ownedProfile(a.account.id, b.identity.profile!.id)).toThrow(
      '无权'
    );
    expect(() =>
      updateProfile(a.account.id, b.identity.profile!.id, { name: 'evil' })
    ).toThrow('无权');
    expect(
      (
        await select(
          req(
            '/api/profiles/select',
            { profileId: b.identity.profile!.id },
            a.token
          )
        )
      ).status
    ).toBe(403);
  });
  it('多档案首次登录需选择，当前设备恢复选择且跨账号不继承', async () => {
    const s = await session();
    const p = createProfile(s.account.id, '家庭成员');
    const first = createSession(s.account.id, 'f'.repeat(32));
    expect(resolveSession(first.token)!.profile).toBeNull();
    selectProfile(resolveSession(first.token)!, p.id);
    const again = createSession(s.account.id, 'f'.repeat(32));
    expect(resolveSession(again.token)!.profile!.id).toBe(p.id);
    updateProfile(s.account.id, p.id, { isDefault: true });
    expect(
      resolveSession(again.token)!.profiles.filter((p) => p.is_default)
    ).toHaveLength(1);
    for (let i = 0; i < 6; i++) createProfile(s.account.id, `成员${i}`);
    expect(() => createProfile(s.account.id, '超额')).toThrow('上限');
  });
});
describe('密码与数据库约束', () => {
  it('更改自己的密码撤销其他会话，旧凭证不能在重置后签发会话', async () => {
    const s = await session();
    const auth = await authenticate('alice', pass);
    const other = createSession(s.account.id, 'b'.repeat(32));
    await changePassword(
      s.account.id,
      pass,
      'abcdefgh',
      s.identity.sessionId
    );
    expect(resolveSession(s.token)?.account.id).toBe(s.account.id);
    expect(resolveSession(other.token)).toBeNull();
    expect(() =>
      createSession(s.account.id, 'c'.repeat(32), '', auth.credentialHash)
    ).toThrow('状态已变化');
    await expect(
      changePassword(s.account.id, pass, 'Another password')
    ).rejects.toThrow('当前密码错误');
  });
  it('数据库拒绝跨账号选择档案，接口拒绝修改他人档案和管理员角色', async () => {
    const a = await session(),
      b = await session('bobby');
    expect(() =>
      database()
        .prepare('UPDATE sessions SET selected_profile_id=? WHERE token_hash=?')
        .run(b.identity.profile!.id, tokenHash(a.token))
    ).toThrow('ownership');
    const { PATCH } = await import('@/app/api/profiles/[id]/route');
    expect(
      (
        await PATCH(req('/api/profiles/x', { name: 'evil' }, a.token), {
          params: Promise.resolve({ id: b.identity.profile!.id }),
        })
      ).status
    ).toBe(403);
    const admin = await createAccount('admin', pass, 'admin');
    const adminSession = createSession(admin.id, 'a'.repeat(32));
    const { POST: revoke } = await import(
      '@/app/api/admin/accounts/[id]/revoke-sessions/route'
    );
    expect(
      (
        await revoke(req('/api/admin/accounts/revoke', {}, a.token), {
          params: Promise.resolve({ id: admin.id }),
        })
      ).status
    ).toBe(403);
    expect(
      (
        await revoke(
          req('/api/admin/accounts/revoke', {}, adminSession.token),
          { params: Promise.resolve({ id: admin.id }) }
        )
      ).status
    ).toBe(200);
    expect(resolveSession(adminSession.token)).toBeNull();
    expect(() => setAccountStatus(admin.id, 'disabled')).toThrow('普通账号');
    await expect(
      resetAccountPassword(admin.id, 'Another password')
    ).rejects.toThrow('普通账号');
  });
});
describe('CSRF、限流与图片', () => {
  it('限制同时解码图片的数量，并发替换不会残留旧头像', async () => {
    const s = await session();
    const data = await sharp({
      create: { width: 300, height: 400, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
    const results = await Promise.allSettled(
      [1, 2, 3].map(() =>
        saveAvatar(s.account.id, s.identity.profile!.id, data, {
          zoom: 1,
          x: 0.5,
          y: 0.5,
        })
      )
    );
    expect(
      results.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(2);
    const rejected = results.find(
      (result) => result.status === 'rejected'
    ) as PromiseRejectedResult;
    expect(rejected.reason.status).toBe(429);
    expect(
      await (await import('node:fs/promises')).readdir(join(dir, 'avatars'))
    ).toHaveLength(1);
  });

  it('生产 HTTPS 会话强制 Secure，HTTP 需要显式例外', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOW_INSECURE_HTTP', 'false');
    vi.stubEnv('COOKIE_SECURE', 'false');
    process.env.APP_ORIGIN = 'https://local.test';
    const response = await register(
      req('/api/auth/register', {
        username: 'alice',
        password: pass,
        confirmPassword: pass,
        invitation: 'invite-code',
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('Secure');
    process.env.APP_ORIGIN = 'http://local.test';
    expect((await login(req('/api/auth/login', {}))).status).toBe(503);
  });
  it('JSON 请求限制大小和参数，头像表单拒绝伪装文件、超限和越权', async () => {
    await expect(
      jsonBody(req('/', { value: 'x'.repeat(8200) }), ['value'])
    ).rejects.toThrow('过大');
    await expect(
      jsonBody(req('/', { accountId: 'other' }), [])
    ).rejects.toThrow('无效请求参数');
    const s = await session(),
      other = await session('bobby');
    const { POST: upload, GET: read } = await import(
      '@/app/api/profiles/[id]/avatar/route'
    );
    const make = (file: File) => {
      const form = new FormData();
      form.set('file', file);
      return new Request('https://local.test/api/profiles/avatar', {
        method: 'POST',
        headers: {
          origin: 'https://local.test',
          cookie: `${SESSION_COOKIE}=${s.token}`,
        },
        body: form,
      });
    };
    expect(
      (
        await upload(
          make(new File(['<svg/>'], 'fake.png', { type: 'image/png' })),
          { params: Promise.resolve({ id: s.identity.profile!.id }) }
        )
      ).status
    ).toBe(400);
    expect(
      (
        await upload(
          make(
            new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.jpg', {
              type: 'image/jpeg',
            })
          ),
          { params: Promise.resolve({ id: s.identity.profile!.id }) }
        )
      ).status
    ).toBe(413);
    expect(
      (
        await upload(make(new File(['x'], 'fake.png', { type: 'image/png' })), {
          params: Promise.resolve({ id: other.identity.profile!.id }),
        })
      ).status
    ).toBe(403);
    expect(
      (
        await read(req('/api/profiles/avatar'), {
          params: Promise.resolve({ id: s.identity.profile!.id }),
        })
      ).status
    ).toBe(401);
  });

  it('同源状态请求有效，跨源、无 Origin、非 JSON 请求失败', async () => {
    expect(() =>
      assertSameOrigin(
        req('/api/auth/login', {}, undefined, 'https://evil.test')
      )
    ).toThrow('来源');
    expect(() =>
      assertSameOrigin(
        new Request('https://local.test/api/profiles', { method: 'POST' })
      )
    ).toThrow('来源');
    await expect(
      jsonBody(
        new Request('https://local.test/', { method: 'POST', body: 'x' }),
        []
      )
    ).rejects.toThrow('JSON');
    expect(() => assertSameOrigin(req('/api/auth/login', {}))).not.toThrow();
  });
  it('持久化限流不受伪造代理 IP 影响', () => {
    for (let i = 0; i < 10; i++)
      expect(rateLimit('account:alice', 10)).toBe(true);
    closeDatabase();
    expect(rateLimit('account:alice', 10)).toBe(false);
  });
  it('头像由实际解码校验、正方形裁剪和 WebP 重编码，替换清理旧文件', async () => {
    const s = await session();
    const png = await sharp({
      create: { width: 600, height: 400, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
    const p = await saveAvatar(s.account.id, s.identity.profile!.id, png, {
      zoom: 2,
      x: 0.8,
      y: 0.2,
    });
    const output = await readAvatar(s.account.id, p.id);
    const info = await sharp(output).metadata();
    expect([info.width, info.height, info.format]).toEqual([256, 256, 'webp']);
    await expect(
      saveAvatar(s.account.id, p.id, Buffer.from('<svg/>'), {
        zoom: 1,
        x: 0,
        y: 0,
      })
    ).rejects.toThrow('无法解码');
    await expect(
      saveAvatar(s.account.id, p.id, png, { zoom: 5, x: 0, y: 0 })
    ).rejects.toThrow('裁剪');
    const old = p.avatar;
    updateProfile(s.account.id, p.id, { avatar: 'preset:green' });
    await cleanAvatar(old);
    await expect(
      (await import('node:fs/promises')).readdir(join(dir, 'avatars'))
    ).resolves.toEqual([]);
  });
});
