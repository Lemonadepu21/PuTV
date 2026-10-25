import { NextResponse } from 'next/server';
import {
  assertSameOrigin,
  requireIdentity,
  responseError,
  throttle,
} from '@/server/http';
import { ownedProfile } from '@/server/identity';
import { avatarForm, readAvatar, saveAvatar } from '@/server/avatars';
export const runtime = 'nodejs';
export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    const identity = requireIdentity(req);
    const { id } = await context.params;
    ownedProfile(identity.account.id, id);
    throttle('avatar', identity.account.id);
    const { data, crop } = await avatarForm(req);
    return NextResponse.json({
      profile: await saveAvatar(identity.account.id, id, data, crop),
    });
  } catch (error) {
    return responseError(error);
  }
}
export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const identity = requireIdentity(req);
    return new Response(
      new Uint8Array(
        await readAvatar(identity.account.id, (await context.params).id)
      ),
      {
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        },
      }
    );
  } catch (error) {
    return responseError(error);
  }
}
