import { NextResponse } from 'next/server';
import { assertSameOrigin, jsonBody, responseError } from '@/server/http';
import { requireWatchIdentity, pushWatch } from '@/server/watch';
import { IdentityError } from '@/server/identity';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const identity = requireWatchIdentity(req),
      body = await jsonBody(req, ['operations'], 262144);
    if (!Array.isArray(body.operations))
      throw new IdentityError('缺少导入记录');
    const results = pushWatch(identity.profile.id, body.operations, true),
      counts = { success: 0, skipped: 0, conflicts: 0, failed: 0 };
    for (const result of results) {
      if (result.status === 'applied' || result.status === 'duplicate')
        counts.success++;
      else if (result.status === 'skipped') counts.skipped++;
      else if (result.status === 'conflict') counts.conflicts++;
      else counts.failed++;
    }
    return NextResponse.json(
      { results, counts },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return responseError(error);
  }
}
