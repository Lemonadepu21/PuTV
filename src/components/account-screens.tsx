'use client';
import { useEffect, useState } from 'react';
import { useAuth } from './auth';
import { identityApi, reloadIdentity } from '@/lib/client-api';
import type { ViewingProfile, PublicAccount } from '@/lib/types';
import { ThemeToggle } from './theme';

const presets = ['blue', 'green', 'amber', 'purple', 'rose', 'slate'];
const presetLabels: Record<string, string> = {
  blue: '蓝色',
  green: '绿色',
  amber: '琥珀色',
  purple: '紫色',
  rose: '玫瑰色',
  slate: '灰色',
};
const colors: Record<string, string> = {
  blue: 'bg-blue-700',
  green: 'bg-emerald-700',
  amber: 'bg-amber-700',
  purple: 'bg-violet-700',
  rose: 'bg-rose-700',
  slate: 'bg-slate-600',
};
export function ProfileAvatar({
  profile,
  small = false,
}: {
  profile: ViewingProfile;
  small?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [profile.avatar]);
  const size = small ? 'h-8 w-8 text-sm' : 'h-24 w-24 text-3xl';
  return profile.avatar.startsWith('upload:') && !failed ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      onError={() => setFailed(true)}
      src={`/api/profiles/${profile.id}/avatar?v=${encodeURIComponent(profile.avatar)}`}
      className={`${size} rounded-xl object-cover`}
    />
  ) : (
    <span
      aria-hidden="true"
      className={`${size} ${colors[profile.avatar.slice(7)] || colors.blue} inline-flex items-center justify-center rounded-xl font-semibold text-white`}
    >
      {profile.name.slice(0, 1)}
    </span>
  );
}
export function AccountEntry() {
  const auth = useAuth();
  if (!auth.profile) return null;
  return (
    <button
      type="button"
      aria-label={`账号与档案：${auth.profile.name}`}
      className="ml-1 rounded-xl"
      onClick={() => auth.setScreen('manage')}
    >
      <ProfileAvatar profile={auth.profile} small />
    </button>
  );
}
function Frame({
  title,
  children,
  selecting = false,
}: {
  title: string;
  selecting?: boolean;
  children: React.ReactNode;
}) {
  const auth = useAuth(),
    [error, setError] = useState('');
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-8 sm:px-8">
      <div className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <span className="text-xl font-semibold">PuTV</span>
        <div className="flex gap-2">
          <ThemeToggle />
          {(auth.profile || !selecting) && (
            <button
              className="btn-ghost"
              onClick={() => auth.setScreen(auth.profile ? 'watch' : 'select')}
            >
              {auth.profile ? '返回首页' : '返回选择'}
            </button>
          )}
          <button
            className="btn-ghost"
            onClick={() => auth.logout().catch((err) => setError(err.message))}
          >
            退出登录
          </button>
        </div>
      </div>
      <h1
        className={`mb-8 text-2xl font-semibold ${selecting ? 'text-center' : ''}`}
      >
        {title}
      </h1>
      {error && (
        <p role="alert" className="mb-4 text-danger">
          {error}
        </p>
      )}
      {children}
    </main>
  );
}
export function ProfileChooser() {
  const auth = useAuth(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const select = async (id: string) => {
    setBusy(true);
    try {
      await identityApi('/api/profiles/select', 'POST', { profileId: id });
      reloadIdentity();
    } catch (err) {
      setError(String((err as Error).message));
      setBusy(false);
    }
  };
  return (
    <Frame title="谁在观看？" selecting>
      <div className="flex flex-wrap justify-center gap-6 py-8">
        {auth.profiles.map((profile, index) => (
          <button
            disabled={busy}
            autoFocus={index === 0}
            aria-pressed={auth.profile?.id === profile.id}
            key={profile.id}
            className="flex w-28 flex-col items-center gap-3 rounded-xl p-2 hover:bg-hover"
            onClick={() => select(profile.id)}
          >
            <ProfileAvatar profile={profile} />
            <span className="max-w-full truncate">{profile.name}</span>
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="mt-6 text-center">
        <button className="btn-ghost" onClick={() => auth.setScreen('manage')}>
          管理档案
        </button>
      </div>
    </Frame>
  );
}
export function AccountScreens({
  screen,
}: {
  screen: 'manage' | 'password' | 'admin';
}) {
  const auth = useAuth();
  return (
    <Frame
      title={
        screen === 'password'
          ? '修改密码'
          : screen === 'admin'
            ? '账号管理'
            : '观看档案'
      }
    >
      {screen === 'manage' ? (
        <>
          <div className="mb-8 flex flex-wrap gap-3">
            <button
              className="btn-ghost"
              onClick={() => auth.setScreen('select')}
            >
              切换档案
            </button>
            <button
              className="btn-ghost"
              onClick={() => auth.setScreen('password')}
            >
              修改密码
            </button>
            {auth.account?.role === 'admin' && (
              <button
                className="btn-ghost"
                onClick={() => auth.setScreen('admin')}
              >
                账号管理
              </button>
            )}
          </div>
          <div className="space-y-5">
            {auth.profiles.map((p) => (
              <ProfileEditor key={p.id} profile={p} />
            ))}
          </div>
          <CreateProfile />
        </>
      ) : screen === 'password' ? (
        <PasswordForm />
      ) : (
        <AdminAccounts />
      )}
    </Frame>
  );
}
function CreateProfile() {
  const auth = useAuth(),
    [name, setName] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-8 flex flex-wrap gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await identityApi('/api/profiles', 'POST', { name });
          setName('');
          await auth.refresh();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="min-w-0 flex-1">
        <span className="sr-only">新档案名称</span>
        <input
          className="input w-full"
          placeholder="新档案名称"
          required
          maxLength={32}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button className="btn-primary" disabled={busy}>
        创建档案
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
function ProfileEditor({ profile }: { profile: ViewingProfile }) {
  const auth = useAuth(),
    [name, setName] = useState(profile.name),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const update = async (body: unknown) => {
    setBusy(true);
    setError('');
    try {
      await identityApi(`/api/profiles/${profile.id}`, 'PATCH', body);
      await auth.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-4">
        <ProfileAvatar profile={profile} />
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            update({ name });
          }}
        >
          <label className="block text-sm">
            档案昵称
            <input
              className="input my-2 w-full"
              required
              maxLength={32}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy}>
              保存名称
            </button>
            {profile.is_default ? (
              <span className="px-3 py-2 text-sm text-muted">默认档案</span>
            ) : (
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={() => update({ isDefault: true })}
              >
                设为默认
              </button>
            )}
          </div>
        </form>
      </div>
      <div className="my-4 flex flex-wrap gap-2" aria-label="预设头像">
        {presets.map((color) => (
          <button
            key={color}
            type="button"
            disabled={busy}
            aria-label={`选择 ${presetLabels[color]}头像`}
            aria-pressed={profile.avatar === `preset:${color}`}
            className={`h-10 w-10 rounded-lg border-2 text-white ${colors[color]} ${profile.avatar === `preset:${color}` ? 'border-accent' : 'border-transparent'}`}
            onClick={() => update({ avatar: `preset:${color}` })}
          >
            {profile.avatar === `preset:${color}`
              ? '✓'
              : profile.name.slice(0, 1)}
          </button>
        ))}
      </div>
      <AvatarUpload profileId={profile.id} onSaved={auth.refresh} />
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
function AvatarUpload({
  profileId,
  onSaved,
}: {
  profileId: string;
  onSaved: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null),
    [url, setUrl] = useState(''),
    [ratio, setRatio] = useState(1),
    [zoom, setZoom] = useState(1),
    [x, setX] = useState(0.5),
    [y, setY] = useState(0.5),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!file) {
      setUrl('');
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  const width = zoom * Math.max(1, ratio),
    height = zoom * Math.max(1, 1 / ratio);
  return (
    <div>
      <label className="block text-sm text-muted">
        上传头像（JPG、PNG、WebP，最大 2MB）
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="mt-2 block w-full text-sm"
          disabled={busy}
          onChange={(e) => {
            const next = e.target.files?.[0];
            setError('');
            if (!next) return;
            if (next.size > 2 * 1024 * 1024) {
              setError('图片最大为 2MB');
              return;
            }
            setFile(next);
            setZoom(1);
            setX(0.5);
            setY(0.5);
          }}
        />
      </label>
      {url && (
        <div className="mt-4 max-w-xs space-y-3">
          <div className="relative aspect-square overflow-hidden rounded-xl bg-chip">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt="头像裁剪预览"
              onLoad={(e) =>
                setRatio(
                  e.currentTarget.naturalWidth / e.currentTarget.naturalHeight
                )
              }
              onError={() => setError('无法读取图片')}
              className="absolute max-w-none"
              style={{
                width: `${width * 100}%`,
                height: `${height * 100}%`,
                left: `${-(width - 1) * x * 100}%`,
                top: `${-(height - 1) * y * 100}%`,
              }}
            />
          </div>
          {[
            ['缩放', zoom, setZoom, 1, 4],
            ['水平位置', x, setX, 0, 1],
            ['垂直位置', y, setY, 0, 1],
          ].map(([label, value, set, min, max]) => (
            <label key={String(label)} className="block text-sm">
              {String(label)}
              <input
                className="mt-1 block w-full"
                type="range"
                min={Number(min)}
                max={Number(max)}
                step="0.01"
                value={Number(value)}
                onChange={(e) =>
                  (set as (n: number) => void)(Number(e.target.value))
                }
              />
            </label>
          ))}
          <div className="flex gap-2">
            <button
              className="btn-primary"
              disabled={busy || Boolean(error)}
              onClick={async () => {
                if (!file) return;
                setBusy(true);
                const body = new FormData();
                body.set('file', file);
                body.set('zoom', String(zoom));
                body.set('x', String(x));
                body.set('y', String(y));
                try {
                  await identityApi(
                    `/api/profiles/${profileId}/avatar`,
                    'POST',
                    body
                  );
                  setFile(null);
                  await onSaved();
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? '正在保存…' : '保存裁剪'}
            </button>
            <button
              className="btn-ghost"
              disabled={busy}
              onClick={() => setFile(null)}
            >
              取消
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
function PasswordForm() {
  const [current, setCurrent] = useState(''),
    [next, setNext] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="max-w-sm space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (next !== confirmation) {
          setMessage('两次输入的密码不一致');
          return;
        }
        setBusy(true);
        try {
          await identityApi('/api/auth/change-password', 'POST', {
            currentPassword: current,
            password: next,
          });
          setCurrent('');
          setNext('');
          setConfirmation('');
          setMessage('密码已修改，其他设备已退出');
        } catch (err) {
          setMessage((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {[
        ['当前密码', current, setCurrent, 'current-password'],
        ['新密码', next, setNext, 'new-password'],
        ['确认新密码', confirmation, setConfirmation, 'new-password'],
      ].map(([label, value, set, complete]) => (
        <label key={String(label)} className="block text-sm">
          {String(label)}
          <input
            className="input mt-2 w-full"
            required
            minLength={8}
            maxLength={128}
            type="password"
            autoComplete={String(complete)}
            value={String(value)}
            onChange={(e) => (set as (v: string) => void)(e.target.value)}
          />
        </label>
      ))}
      {message && (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      )}
      <button className="btn-primary" disabled={busy}>
        修改密码
      </button>
    </form>
  );
}
function AdminAccounts() {
  const [accounts, setAccounts] = useState<PublicAccount[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [target, setTarget] = useState(''),
    [password, setPassword] = useState('');
  const load = () =>
    identityApi<{ accounts: PublicAccount[] }>('/api/admin/accounts').then(
      (data) => setAccounts(data.accounts)
    );
  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);
  const act = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    setError('');
    try {
      await identityApi(url, method, body);
      setPassword('');
      setTarget('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {accounts.map((account) => (
        <section
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4"
          key={account.id}
        >
          <div>
            <p className="font-medium">{account.username}</p>
            <p className="text-sm text-muted">
              {account.role === 'admin' ? '管理员' : '普通用户'} ·{' '}
              {account.status === 'active' ? '正常' : '已停用'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-ghost"
              disabled={busy}
              onClick={() =>
                act(`/api/admin/accounts/${account.id}/revoke-sessions`, 'POST')
              }
            >
              撤销会话
            </button>
            {account.role === 'user' && (
              <>
                <button
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() =>
                    act(`/api/admin/accounts/${account.id}`, 'PATCH', {
                      status:
                        account.status === 'active' ? 'disabled' : 'active',
                    })
                  }
                >
                  {account.status === 'active' ? '禁用' : '启用'}
                </button>
                <button
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => setTarget(account.id)}
                >
                  重置密码
                </button>
              </>
            )}{' '}
          </div>
        </section>
      ))}
      {target && (
        <form
          className="flex flex-wrap gap-3 rounded-xl border border-line p-4"
          onSubmit={(e) => {
            e.preventDefault();
            act(`/api/admin/accounts/${target}/reset-password`, 'POST', {
              password,
            });
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="block text-sm">普通账号新密码</span>
            <input
              className="input mt-2 w-full"
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="btn-primary" disabled={busy}>
            确认重置
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setTarget('')}
          >
            取消
          </button>
        </form>
      )}
    </div>
  );
}
