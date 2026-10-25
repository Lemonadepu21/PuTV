import {
  registrationEnabled,
  checkInvitation,
  createAccount,
  IdentityError,
} from '@/server/identity';
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
    throttle('register');
    if (!registrationEnabled()) throw new IdentityError('当前已关闭注册', 403);
    const body = await jsonBody(req, [
      'username',
      'password',
      'confirmPassword',
      'invitation',
    ]);
    checkInvitation(body.invitation);
    if (body.password !== body.confirmPassword)
      throw new IdentityError('两次输入的密码不一致');
    const account = await createAccount(body.username, body.password);
    return loginResponse(req, account.id);
  } catch (error) {
    return responseError(error);
  }
}
