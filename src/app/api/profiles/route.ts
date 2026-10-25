import { NextResponse } from 'next/server';
import { createProfile } from '@/server/identity';
import {
  assertSameOrigin,
  jsonBody,
  requireIdentity,
  responseError,
  throttle,
} from '@/server/http';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  try {
    const identity = requireIdentity(req);
    return NextResponse.json(
      { profiles: identity.profiles, profile: identity.profile },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return responseError(error);
  }
}
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const identity = requireIdentity(req);
    throttle('profiles', identity.account.id);
    const body = await jsonBody(req, ['name', 'avatar']);
    return NextResponse.json(
      { profile: createProfile(identity.account.id, body.name, body.avatar) },
      { status: 201 }
    );
  } catch (error) {
    return responseError(error);
  }
}
