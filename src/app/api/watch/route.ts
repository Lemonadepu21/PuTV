import { NextResponse } from 'next/server';
import { assertSameOrigin, jsonBody, responseError } from '@/server/http';
import { requireWatchIdentity, pullWatch, pushWatch } from '@/server/watch';
import { IdentityError } from '@/server/identity';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  try {
    const identity = requireWatchIdentity(req),
      params = new URL(req.url).searchParams;
    if ([...params.keys()].some((key) => !['cursor', 'limit'].includes(key)))
      throw new IdentityError('无效查询参数');
    return NextResponse.json(
      {
        context: identity.context,
        ...pullWatch(
          identity.profile.id,
          params.get('cursor'),
          Number(params.get('limit') || 100)
        ),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return responseError(error);
  }
}
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const identity = requireWatchIdentity(req),
      body = await jsonBody(req, ['operations'], 262144);
    if (!Array.isArray(body.operations))
      throw new IdentityError('缺少同步记录');
    return NextResponse.json(
      { results: pushWatch(identity.profile.id, body.operations) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return responseError(error);
  }
}
