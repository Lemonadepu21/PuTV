import 'server-only';
import {
  randomBytes,
  randomUUID,
  scrypt as cryptoScrypt,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { database, transaction } from './database.ts';

let hashing = 0;
async function derive(value: string, salt: string) {
  if (hashing >= 2) throw new IdentityError('账号验证繁忙，请稍后重试', 429);
  hashing++;
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      cryptoScrypt(
        value,
        salt,
        64,
        { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
        (error, key) => (error ? reject(error) : resolve(key))
      )
    );
  } finally {
    hashing--;
  }
}
export class IdentityError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export interface Account {
  id: string;
  username: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
}
export interface Profile {
  id: string;
  account_id: string;
  name: string;
  avatar: string;
  is_default: number;
}
export interface Identity {
  account: Account;
  profiles: Profile[];
  profile: Profile | null;
  sessionId: string;
  expiresAt: number;
}
export const PRESET_AVATARS = [
  'blue',
  'green',
  'amber',
  'purple',
  'rose',
  'slate',
];
export function username(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9_\-\u4e00-\u9fff]{3,32}$/.test(value)
  )
    throw new IdentityError(
      '用户名需为 3–32 位字母、数字、中文、下划线或短横线'
    );
  return value.toLowerCase();
}
export function password(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 8 ||
    value.length > 128 ||
    Buffer.byteLength(value) > 512
  )
    throw new IdentityError('密码需为 8–128 个字符');
  return value;
}
export function profileName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > 32 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new IdentityError('档案名称需为 1–32 个可显示字符');
  return value.trim();
}
export function presetAvatar(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !PRESET_AVATARS.includes(value.replace(/^preset:/, ''))
  )
    throw new IdentityError('请选择有效的预设头像');
  return `preset:${value.replace(/^preset:/, '')}`;
}
export async function hashPassword(value: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(value, salt);
  return `scrypt$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(value: string, hash: string) {
  const [method, salt, hex] = hash.split('$');
  if (
    method !== 'scrypt' ||
    !/^[a-f0-9]{32}$/.test(salt || '') ||
    !/^[a-f0-9]{128}$/.test(hex || '')
  )
    return false;
  const key = await derive(value, salt);
  return timingSafeEqual(key, Buffer.from(hex, 'hex'));
}
export const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
export function registrationEnabled() {
  return process.env.REGISTRATION_ENABLED !== 'false';
}
export function checkInvitation(value: unknown) {
  const expected = process.env.PASSWORD || '';
  if (!expected) throw new IdentityError('管理员尚未配置注册邀请码', 503);
  if (
    typeof value !== 'string' ||
    value.length > 512 ||
    !timingSafeEqual(
      createHash('sha256').update(value).digest(),
      createHash('sha256').update(expected).digest()
    )
  )
    throw new IdentityError('邀请码错误', 403);
}
export async function createAccount(
  name: unknown,
  secret: unknown,
  role: 'admin' | 'user' = 'user'
) {
  const user = username(name),
    pass = password(secret);
  const hash = await hashPassword(pass);
  return transaction(() => {
    const db = database();
    if (
      role === 'admin' &&
      db.prepare("SELECT id FROM accounts WHERE role='admin'").get()
    )
      throw new IdentityError('已存在管理员，初始化不会覆盖已有账号', 409);
    if (db.prepare('SELECT id FROM accounts WHERE username=?').get(user))
      throw new IdentityError('用户名已被使用', 409);
    const id = randomUUID(),
      profileId = randomUUID(),
      now = Date.now();
    db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?)').run(
      id,
      user,
      hash,
      role,
      'active',
      now,
      now
    );
    db.prepare('INSERT INTO profiles VALUES(?,?,?,?,?,?,?)').run(
      profileId,
      id,
      user,
      'preset:blue',
      1,
      now,
      now
    );
    return { id, username: user, role, status: 'active' } as Account;
  });
}
export function listProfiles(accountId: string): Profile[] {
  return database()
    .prepare(
      'SELECT id,account_id,name,avatar,is_default FROM profiles WHERE account_id=? ORDER BY is_default DESC,created_at,id'
    )
    .all(accountId) as unknown as Profile[];
}
export function ownedProfile(accountId: string, profileId: unknown): Profile {
  if (typeof profileId !== 'string' || profileId.length > 64)
    throw new IdentityError('档案参数无效');
  const profile = database()
    .prepare(
      'SELECT id,account_id,name,avatar,is_default FROM profiles WHERE id=? AND account_id=?'
    )
    .get(profileId, accountId) as unknown as Profile | undefined;
  if (!profile) throw new IdentityError('无权访问此档案', 403);
  return profile;
}
export async function authenticate(
  name: unknown,
  secret: unknown
): Promise<Account & { credentialHash: string }> {
  const user = username(name),
    pass = password(secret);
  const row = database()
    .prepare('SELECT * FROM accounts WHERE username=?')
    .get(user) as unknown as (Account & { password_hash: string }) | undefined;
  // 未知账号同样执行慢哈希，降低账号存在性时序差异。
  const valid = await verifyPassword(
    pass,
    row?.password_hash || `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`
  );
  if (!row || !valid || row.status !== 'active')
    throw new IdentityError('用户名或密码错误，或账号已停用', 401);
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.status,
    credentialHash: row.password_hash,
  };
}
export function createSession(
  accountId: string,
  deviceId: string,
  userAgent = '',
  credentialHash?: string
) {
  return transaction(() => {
    const db = database(),
      now = Date.now();
    const account = db
      .prepare('SELECT status,password_hash FROM accounts WHERE id=?')
      .get(accountId);
    if (
      !account ||
      account.status !== 'active' ||
      (credentialHash !== undefined && account.password_hash !== credentialHash)
    )
      throw new IdentityError('账号状态已变化，请重新登录', 401);
    const profiles = listProfiles(accountId);
    const previous = db
      .prepare(
        'SELECT selected_profile_id FROM sessions WHERE account_id=? AND device_id=? ORDER BY created_at DESC LIMIT 1'
      )
      .get(accountId, deviceId);
    const profile =
      profiles.length === 1
        ? profiles[0]
        : profiles.find((p) => p.id === previous?.selected_profile_id);
    const token = randomBytes(32).toString('hex'),
      id = randomUUID();
    const days = Number(process.env.SESSION_DAYS || 30);
    const expiresAt =
      now +
      (Number.isFinite(days) ? Math.max(1, Math.min(365, days)) : 30) *
        86400000;
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,?,?)').run(
      id,
      accountId,
      tokenHash(token),
      expiresAt,
      null,
      now,
      now,
      profile?.id || null,
      deviceId,
      userAgent.slice(0, 256)
    );
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(
      now - 30 * 86400000
    );
    return { token, expiresAt };
  });
}
export function resolveSession(
  token: string | undefined | null
): Identity | null {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const db = database(),
    now = Date.now();
  const row = db
    .prepare(
      `SELECT s.id session_id,s.selected_profile_id,s.expires_at,s.last_used_at,a.id,a.username,a.role,a.status
    FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND a.status='active'`
    )
    .get(tokenHash(token), now);
  if (!row) return null;
  const account = {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.status,
  } as Account;
  const profiles = listProfiles(account.id);
  if (now - Number(row.last_used_at) > 60000)
    db.prepare('UPDATE sessions SET last_used_at=? WHERE id=?').run(
      now,
      row.session_id!
    );
  return {
    account,
    profiles,
    profile: profiles.find((p) => p.id === row.selected_profile_id) || null,
    sessionId: String(row.session_id),
    expiresAt: Number(row.expires_at),
  };
}
export function revokeSession(sessionId: string) {
  database()
    .prepare('UPDATE sessions SET revoked_at=? WHERE id=?')
    .run(Date.now(), sessionId);
}
export function revokeAccountSessions(accountId: string) {
  database()
    .prepare('UPDATE sessions SET revoked_at=? WHERE account_id=?')
    .run(Date.now(), accountId);
}
export function createProfile(
  accountId: string,
  name: unknown,
  avatar: unknown = 'preset:blue'
) {
  const label = profileName(name),
    icon = presetAvatar(avatar);
  return transaction(() => {
    const limit = Number(process.env.MAX_PROFILES || 8);
    if (
      listProfiles(accountId).length >=
      (Number.isFinite(limit) ? Math.max(1, Math.min(32, limit)) : 8)
    )
      throw new IdentityError('已达到档案数量上限', 409);
    const id = randomUUID(),
      now = Date.now();
    database()
      .prepare('INSERT INTO profiles VALUES(?,?,?,?,?,?,?)')
      .run(id, accountId, label, icon, 0, now, now);
    return ownedProfile(accountId, id);
  });
}
export function updateProfile(
  accountId: string,
  profileId: string,
  body: Record<string, unknown>
) {
  return transaction(() => {
    const old = ownedProfile(accountId, profileId);
    const name = body.name === undefined ? old.name : profileName(body.name);
    const avatar =
      body.avatar === undefined ? old.avatar : presetAvatar(body.avatar);
    if (body.isDefault !== undefined && body.isDefault !== true)
      throw new IdentityError('默认档案参数无效');
    if (body.isDefault)
      database()
        .prepare('UPDATE profiles SET is_default=0 WHERE account_id=?')
        .run(accountId);
    database()
      .prepare(
        'UPDATE profiles SET name=?,avatar=?,is_default=?,updated_at=? WHERE id=? AND account_id=?'
      )
      .run(
        name,
        avatar,
        body.isDefault ? 1 : old.is_default,
        Date.now(),
        profileId,
        accountId
      );
    return ownedProfile(accountId, profileId);
  });
}
export function selectProfile(identity: Identity, profileId: unknown) {
  const profile = ownedProfile(identity.account.id, profileId);
  database()
    .prepare(
      'UPDATE sessions SET selected_profile_id=? WHERE id=? AND account_id=?'
    )
    .run(profile.id, identity.sessionId, identity.account.id);
  return profile;
}
export async function changePassword(
  accountId: string,
  current: unknown,
  next: unknown,
  keepSession?: string
) {
  const old = password(current),
    replacement = password(next);
  const row = database()
    .prepare(
      "SELECT password_hash FROM accounts WHERE id=? AND status='active'"
    )
    .get(accountId);
  if (!row || !(await verifyPassword(old, String(row.password_hash))))
    throw new IdentityError('当前密码错误', 403);
  const hash = await hashPassword(replacement);
  transaction(() => {
    const result = database()
      .prepare(
        "UPDATE accounts SET password_hash=?,updated_at=? WHERE id=? AND password_hash=? AND status='active'"
      )
      .run(hash, Date.now(), accountId, String(row.password_hash));
    if (!result.changes)
      throw new IdentityError('账号状态已变化，请重新登录', 401);
    database()
      .prepare('UPDATE sessions SET revoked_at=? WHERE account_id=? AND id<>?')
      .run(Date.now(), accountId, keepSession || '');
  });
}
export function adminTarget(id: string): Account {
  const row = database()
    .prepare(
      "SELECT id,username,role,status FROM accounts WHERE id=? AND role='user'"
    )
    .get(id) as unknown as Account | undefined;
  if (!row) throw new IdentityError('只能管理普通账号', 403);
  return row;
}
export function setAccountStatus(id: string, status: unknown) {
  if (status !== 'active' && status !== 'disabled')
    throw new IdentityError('账号状态无效');
  return transaction(() => {
    adminTarget(id);
    database()
      .prepare('UPDATE accounts SET status=?,updated_at=? WHERE id=?')
      .run(status, Date.now(), id);
    if (status === 'disabled') revokeAccountSessions(id);
  });
}
export async function resetAccountPassword(id: string, next: unknown) {
  adminTarget(id);
  const hash = await hashPassword(password(next));
  transaction(() => {
    adminTarget(id);
    database()
      .prepare('UPDATE accounts SET password_hash=?,updated_at=? WHERE id=?')
      .run(hash, Date.now(), id);
    revokeAccountSessions(id);
  });
}
export function rateLimit(bucket: string, max: number, duration = 600000) {
  const key = tokenHash(bucket),
    now = Date.now();
  return transaction(() => {
    const db = database();
    db.prepare('DELETE FROM auth_attempts WHERE reset_at<?').run(now);
    db.prepare(
      `INSERT INTO auth_attempts VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1`
    ).run(key, now + duration);
    return (
      Number(
        db.prepare('SELECT count FROM auth_attempts WHERE bucket=?').get(key)
          ?.count
      ) <= max
    );
  });
}
