import { authenticate } from '@/server/identity';
import {
  assertSameOrigin,
  jsonBody,
  loginResponse,
  responseError,
  throttle,
} from '@/server/http';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const body = await jsonBody(req, ['username', 'password']);
    throttle('login', body.username);
    const account = await authenticate(body.username, body.password);
    return loginResponse(req, account.id, account.credentialHash);
  } catch (error) {
    return responseError(error);
  }
}
