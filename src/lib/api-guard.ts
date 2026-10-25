import { NextResponse } from 'next/server';
import { identityFromRequest } from './auth';
import { assertSameOrigin, responseError } from '@/server/http';

export function guardRequest(req: Request): NextResponse | null {
  try {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) assertSameOrigin(req);
    if (!identityFromRequest(req))
      return NextResponse.json(
        { error: '未登录' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      );
    return null;
  } catch (error) {
    return responseError(error);
  }
}
export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}
