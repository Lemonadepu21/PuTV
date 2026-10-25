import { NextResponse } from 'next/server';
import { ownedProfile, updateProfile } from '@/server/identity';
import {
  assertSameOrigin,
  jsonBody,
  requireIdentity,
  responseError,
} from '@/server/http';
import { cleanAvatar } from '@/server/avatars';
export const runtime = 'nodejs';
export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    const identity = requireIdentity(req);
    const body = await jsonBody(req, ['name', 'avatar', 'isDefault']);
    const id = (await context.params).id;
    const old = ownedProfile(identity.account.id, id).avatar;
    const profile = updateProfile(identity.account.id, id, body);
    await cleanAvatar(old);
    return NextResponse.json({ profile });
  } catch (error) {
    return responseError(error);
  }
}
