import { resolveSession } from '@/server/identity';
export const SESSION_COOKIE = 'putv_session';
export const DEVICE_COOKIE = 'putv_device';
export function cookieValue(
  header: string | null,
  name: string
): string | undefined {
  const value = header
    ?.split(';')
    .find((part) => part.trim().startsWith(`${name}=`))
    ?.trim()
    .slice(name.length + 1);
  try {
    return value ? decodeURIComponent(value) : undefined;
  } catch {
    return undefined;
  }
}
export function identityFromRequest(req: Request) {
  return resolveSession(cookieValue(req.headers.get('cookie'), SESSION_COOKIE));
}
export function sessionFromCookieHeader(header: string | null) {
  return Boolean(resolveSession(cookieValue(header, SESSION_COOKIE)));
}
export function verifySession(token: string | undefined | null) {
  return Boolean(resolveSession(token));
}
