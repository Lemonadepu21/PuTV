import { NextResponse } from 'next/server';
import { resetAccountPassword } from '@/server/identity';
import {
  assertSameOrigin,
  jsonBody,
  requireIdentity,
  responseError,
  throttle,
} from '@/server/http';
export const runtime = 'nodejs';
export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    const identity = requireIdentity(req, true);
    throttle('admin-reset', identity.account.id);
    const body = await jsonBody(req, ['password']);
    await resetAccountPassword((await context.params).id, body.password);
    return NextResponse.json({ success: true });
  } catch (error) {
    return responseError(error);
  }
}
