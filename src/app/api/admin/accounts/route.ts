import { NextResponse } from 'next/server';
import { database } from '@/server/database';
import { requireIdentity, responseError } from '@/server/http';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  try {
    requireIdentity(req, true);
    return NextResponse.json(
      {
        accounts: database()
          .prepare(
            'SELECT id,username,role,status,created_at,updated_at FROM accounts ORDER BY created_at'
          )
          .all(),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return responseError(error);
  }
}
