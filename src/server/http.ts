import 'server-only';
import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import {
  cookieValue,
  DEVICE_COOKIE,
  identityFromRequest,
  SESSION_COOKIE,
} from '@/lib/auth';
import {
  createSession,
  IdentityError,
  rateLimit,
  type Identity,
} from './identity.ts';

export function requireIdentity(req: Request, admin = false): Identity {
  const identity = identityFromRequest(req);
  if (!identity) throw new IdentityError('请登录后继续', 401);
  if (admin && identity.account.role !== 'admin')
    throw new IdentityError('需要管理员权限', 403);
  return identity;
}
export function assertSameOrigin(req: Request) {
  let expected: URL;
  try {
    expected = new URL(process.env.APP_ORIGIN || req.url);
  } catch {
    throw new IdentityError('APP_ORIGIN 配置无效', 503);
  }
  if (
    process.env.NODE_ENV === 'production' &&
    expected.protocol !== 'https:' &&
    process.env.ALLOW_INSECURE_HTTP !== 'true'
  )
    throw new IdentityError('生产环境需要 HTTPS 和 APP_ORIGIN 配置', 503);
  const origin = req.headers.get('origin');
  if (
    !origin ||
    origin !== expected.origin ||
    req.headers.get('sec-fetch-site') === 'cross-site'
  )
    throw new IdentityError('请求来源无效，请从本站操作', 403);
}
export async function jsonBody(req: Request, allowed: string[]) {
  if (!req.headers.get('content-type')?.startsWith('application/json'))
    throw new IdentityError('需要 JSON 请求');
  const reader = req.body?.getReader();
  let bytes = 0,
    text = '';
  if (!reader) throw new IdentityError('请求内容为空');
  const decoder = new TextDecoder();
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    bytes += result.value.byteLength;
    if (bytes > 8192) {
      await reader.cancel();
      throw new IdentityError('请求内容过大', 413);
    }
    text += decoder.decode(result.value, { stream: true });
  }
  text += decoder.decode();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    throw new IdentityError('请求格式错误');
  }
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key))
  )
    throw new IdentityError('包含无效请求参数');
  return body;
}
export function throttle(action: string, account?: unknown) {
  // 全局额度不信任代理头，伪造 IP 不能绕过；账号额度进一步限制定向猜测。
  if (!rateLimit(`global:${action}`, action === 'register' ? 20 : 100))
    throw new IdentityError('操作过于频繁，请稍后重试', 429);
  if (
    typeof account === 'string' &&
    !rateLimit(`${action}:${account.toLowerCase()}`, 10)
  )
    throw new IdentityError('该账号尝试次数过多，请稍后重试', 429);
}
export function responseError(error: unknown) {
  if (error instanceof IdentityError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status, headers: { 'Cache-Control': 'no-store' } }
    );
  console.error(
    '[PuTV identity]',
    error instanceof Error ? error.message : 'unknown error'
  );
  return NextResponse.json(
    { error: '账号服务暂时不可用，请检查服务器持久化目录和日志' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } }
  );
}
export function identityResponse(identity: Identity | null) {
  return {
    verified: Boolean(identity),
    account: identity?.account || null,
    profiles: identity?.profiles || [],
    profile: identity?.profile || null,
    expiresAt: identity?.expiresAt || null,
  };
}
export function loginResponse(
  req: Request,
  accountId: string,
  credentialHash?: string
) {
  const prior = cookieValue(req.headers.get('cookie'), DEVICE_COOKIE);
  const device =
    prior && /^[a-f0-9]{32}$/.test(prior)
      ? prior
      : randomBytes(16).toString('hex');
  const session = createSession(
    accountId,
    device,
    req.headers.get('user-agent') || '',
    credentialHash
  );
  const response = NextResponse.json(
    { success: true },
    { headers: { 'Cache-Control': 'no-store' } }
  );
  const secure =
    process.env.COOKIE_SECURE === 'true' ||
    (process.env.ALLOW_INSECURE_HTTP !== 'true' &&
      process.env.NODE_ENV === 'production') ||
    new URL(process.env.APP_ORIGIN || req.url).protocol === 'https:';
  const options = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
  };
  response.cookies.set(SESSION_COOKIE, session.token, {
    ...options,
    maxAge: Math.floor((session.expiresAt - Date.now()) / 1000),
  });
  response.cookies.set(DEVICE_COOKIE, device, {
    ...options,
    maxAge: 365 * 86400,
  });
  response.cookies.set('ltv_session', '', { ...options, maxAge: 0 });
  return response;
}
