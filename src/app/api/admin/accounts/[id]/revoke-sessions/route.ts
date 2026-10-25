import { NextResponse } from 'next/server';
import { database } from '@/server/database';
import { IdentityError, revokeAccountSessions } from '@/server/identity';
import {
  assertSameOrigin,
  requireIdentity,
  responseError,
} from '@/server/http';
export const runtime = 'nodejs';
export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    requireIdentity(req, true);
    const id = (await context.params).id;
    if (!database().prepare('SELECT id FROM accounts WHERE id=?').get(id))
      throw new IdentityError('账号不存在', 404);
    revokeAccountSessions(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return responseError(error);
  }
}
