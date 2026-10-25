'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  api,
  onUnauthorized,
  reloadIdentity,
  STATUS_QUERY_KEY,
} from '@/lib/client-api';
import { applyEnvPresets } from '@/lib/subscription-sync';
import { useAppStore, hydrateLiveProbeResults } from '@/lib/store';
import { setLocalIdentity } from '@/lib/db';
import { setLocalStorageScope } from '@/lib/persist-storage';
import type {
  AuthStatusResponse,
  PublicAccount,
  ViewingProfile,
} from '@/lib/types';
import { AccountScreens, ProfileChooser } from './account-screens';
import { WatchSyncLifecycle } from './watch-sync';
import { GlobalDownloadManager } from './download-manager';
import { ThemeToggle } from './theme';

type Screen = 'watch' | 'select' | 'manage' | 'password' | 'admin';
interface AuthContextValue {
  checked: boolean;
  verified: boolean;
  setupRequired: boolean;
  version: string | null;
  account: PublicAccount | null;
  profile: ViewingProfile | null;
  profiles: ViewingProfile[];
  openLogin: () => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setScreen: (screen: Screen) => void;
}
const AuthContext = createContext<AuthContextValue>({
  checked: false,
  verified: false,
  setupRequired: false,
  version: null,
  account: null,
  profile: null,
  profiles: [],
  openLogin: () => {},
  logout: async () => {},
  refresh: async () => {},
  setScreen: () => {},
});
export function useAuth() {
  return useContext(AuthContext);
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatusResponse | null>(null),
    [checked, setChecked] = useState(false),
    [error, setError] = useState(''),
    [screen, setScreen] = useState<Screen>('watch');
  const client = useQueryClient();
  const initializedScope = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    const next = await api.status();
    if (next.account && next.profile) {
      const scope = `${next.account.id}:${next.profile.id}`;
      if (initializedScope.current && initializedScope.current !== scope) {
        window.location.replace('/');
        return;
      }
      if (initializedScope.current !== scope) {
        setLocalIdentity(next.account.id, next.profile.id);
        setLocalStorageScope(scope);
        await useAppStore.persist.rehydrate();
        await hydrateLiveProbeResults();
        await applyEnvPresets(next);
        initializedScope.current = scope;
      }
    }
    client.setQueryData(STATUS_QUERY_KEY, next);
    setStatus(next);
    setChecked(true);
    setError('');
  }, [client]);
  useEffect(() => {
    refresh().catch(() => {
      setError('无法连接账号服务，请检查服务器配置');
      setChecked(true);
    });
  }, [refresh]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === 'putv-identity-change') window.location.replace('/');
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  useEffect(
    () =>
      onUnauthorized(() => {
        client.clear();
        setStatus((previous) =>
          previous
            ? {
                ...previous,
                verified: false,
                account: null,
                profile: null,
                profiles: [],
              }
            : null
        );
        setScreen('watch');
      }),
    [client]
  );
  useEffect(() => {
    if (!status?.verified) return;
    const timer = setInterval(() => {
      refresh().catch(() => {});
    }, 60000);
    return () => clearInterval(timer);
  }, [status?.verified, refresh]);
  const logout = async () => {
    await api.logout();
    client.clear();
    reloadIdentity();
  };
  const account = status?.account || null,
    profile = status?.profile || null;
  const verified = Boolean(account && profile);
  return (
    <AuthContext.Provider
      value={{
        checked,
        verified,
        setupRequired: false,
        version: status?.version || null,
        account,
        profile,
        profiles: status?.profiles || [],
        openLogin: () => {
          refresh().catch(() => {});
        },
        logout,
        refresh,
        setScreen,
      }}
    >
      {account && profile && <><GlobalDownloadManager /><WatchSyncLifecycle context={`${account.id}:${profile.id}`}/></>}
      {!checked ? (
        <div
          role="status"
          className="flex min-h-screen items-center justify-center text-muted"
        >
          正在连接…
        </div>
      ) : error ? (
        <div className="m-auto max-w-md p-8">
          <p role="alert" className="text-danger">
            {error}
          </p>
          <button
            className="btn-primary mt-4"
            onClick={() => refresh().catch(() => {})}
          >
            重试
          </button>
        </div>
      ) : !account ? (
        <Login registrationEnabled={status?.registrationEnabled === true} />
      ) : (!profile && screen === 'watch') || screen === 'select' ? (
        <ProfileChooser />
      ) : screen !== 'watch' ? (
        <AccountScreens screen={screen} />
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}
function Login({ registrationEnabled }: { registrationEnabled: boolean }) {
  const [register, setRegister] = useState(false),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [confirmPassword, setConfirmPassword] = useState(''),
    [invitation, setInvitation] = useState(''),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setError('');
    if (register && password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    try {
      if (register)
        await api.register({ username, password, confirmPassword, invitation });
      else await api.login(username, password);
      reloadIdentity();
    } catch (err) {
      setError(
        err instanceof Error && err.message !== '需要登录'
          ? err.message
          : '用户名或密码错误，或账号已停用'
      );
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 sm:p-8">
        <div className="mb-6 flex items-center justify-between">
          <span className="text-xl font-semibold">PuTV</span>
          <ThemeToggle />
        </div>
        <h1 className="mb-6 text-2xl font-semibold">
          {register ? '创建账号' : '登录'}
        </h1>
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm">
            用户名
            <input
              required
              name="username"
              autoComplete="username"
              minLength={3}
              maxLength={32}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input mt-2 w-full"
            />
          </label>
          <label className="block text-sm">
            密码
            <input
              required
              name="password"
              type="password"
              autoComplete={register ? 'new-password' : 'current-password'}
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input mt-2 w-full"
            />
          </label>
          {register && (
            <>
              <label className="block text-sm">
                确认密码
                <input
                  required
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input mt-2 w-full"
                />
              </label>
              <label className="block text-sm">
                邀请码
                <input
                  required
                  name="invitation"
                  type="password"
                  autoComplete="off"
                  maxLength={512}
                  value={invitation}
                  onChange={(e) => setInvitation(e.target.value)}
                  className="input mt-2 w-full"
                />
              </label>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <button className="btn-primary min-h-11 w-full" disabled={loading}>
            {loading ? '正在提交…' : register ? '创建账号' : '登录'}
          </button>
        </form>
        {registrationEnabled && (
          <button
            className="mt-5 text-sm text-accent underline underline-offset-4"
            onClick={() => {
              setRegister(!register);
              setError('');
            }}
          >
            {register ? '已有账号，去登录' : '使用邀请码注册'}
          </button>
        )}
      </div>
    </main>
  );
}
