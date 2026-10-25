import { NextResponse } from 'next/server';
import { identityFromRequest, SESSION_COOKIE } from '@/lib/auth';
import { revokeSession } from '@/server/identity';
import { assertSameOrigin, responseError } from '@/server/http';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const identity = identityFromRequest(req);
    if (identity) revokeSession(identity.sessionId);
    const response = NextResponse.json({ success: true });
    response.cookies.set(SESSION_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return responseError(error);
  }
}
