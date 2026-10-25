import { NextResponse } from 'next/server';
import { selectProfile } from '@/server/identity';
import {
  assertSameOrigin,
  jsonBody,
  requireIdentity,
  responseError,
} from '@/server/http';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const identity = requireIdentity(req);
    const body = await jsonBody(req, ['profileId']);
    return NextResponse.json({
      profile: selectProfile(identity, body.profileId),
    });
  } catch (error) {
    return responseError(error);
  }
}
