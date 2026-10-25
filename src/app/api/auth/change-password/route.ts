import { NextResponse } from 'next/server';
import { changePassword } from '@/server/identity';
import {
  assertSameOrigin,
  jsonBody,
  requireIdentity,
  responseError,
  throttle,
} from '@/server/http';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const identity = requireIdentity(req);
    throttle('change-password', identity.account.id);
    const body = await jsonBody(req, ['currentPassword', 'password']);
    await changePassword(
      identity.account.id,
      body.currentPassword,
      body.password,
      identity.sessionId
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return responseError(error);
  }
}
