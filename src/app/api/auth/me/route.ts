import { NextResponse } from 'next/server';
import { identityFromRequest } from '@/lib/auth';
import { identityResponse, responseError } from '@/server/http';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  try {
    return NextResponse.json(identityResponse(identityFromRequest(req)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return responseError(error);
  }
}
