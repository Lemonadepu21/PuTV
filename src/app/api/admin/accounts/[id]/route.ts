import { NextResponse } from 'next/server';
import { setAccountStatus } from '@/server/identity';
import {
  assertSameOrigin,
  jsonBody,
  requireIdentity,
  responseError,
} from '@/server/http';
export const runtime = 'nodejs';
export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    requireIdentity(req, true);
    const body = await jsonBody(req, ['status']);
    setAccountStatus((await context.params).id, body.status);
    return NextResponse.json({ success: true });
  } catch (error) {
    return responseError(error);
  }
}
